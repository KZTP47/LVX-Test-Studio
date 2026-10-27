'use strict';
const { isDeepStrictEqual } = require('node:util');
const { Worker } = require('node:worker_threads');
const path = require('node:path');
function validateDefinition(test) {
  if (!test || !['api', 'contract'].includes(test.kind)) throw Error('Choose an API or contract test.');
  const target = new URL(test.url);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || /\{[^}]+\}|\$\{/.test(test.url)) throw Error('Enter an HTTP(S) URL with resolved parameters and no embedded credentials.');
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(test.method)) throw Error('Choose an HTTP method.');
  if (!Number.isInteger(test.expectedStatus) || test.expectedStatus < 100 || test.expectedStatus > 599) throw Error('Expected status must be between 100 and 599.');
  if (!Number.isSafeInteger(test.timeoutMs) || test.timeoutMs < 1) throw Error('Set a positive timeout in milliseconds.');
  if (test.kind === 'contract' && test.schema === undefined && !Object.hasOwn(test, 'expectedBody')) throw Error('Add a response schema or an exact Pact response body.');
  if (test.blocked) throw Error(test.blocked);
  for (const key of ['headers', 'expectedHeaders']) if (test[key] !== undefined && (!test[key] || typeof test[key] !== 'object' || Array.isArray(test[key]) || Object.values(test[key]).some(value => typeof value !== 'string'))) throw Error(key + ' must be a JSON object with text values.');
  if (test.maxLatency != null && (!Number.isFinite(test.maxLatency) || test.maxLatency < 0)) throw Error('Maximum latency must be a nonnegative number.');
  return test;
}
function schemaValidate(schema, value, dialect, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(Error('Test cancelled.')); return; }
    const worker = new Worker(path.join(__dirname, 'schema-worker.cjs'), { workerData: { schema, value, dialect }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    const timer = setTimeout(() => finish(Error('Schema validation exceeded its five second budget.')), 5000);
    const abort = () => finish(Error('Test cancelled.'));
    let settled = false;
    function finish(error, report) { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); void worker.terminate(); error ? reject(error) : resolve(report); }
    signal?.addEventListener('abort', abort, { once: true });
    worker.on('message', report => report.error ? finish(Error(report.error)) : finish(null, report));
    worker.on('error', finish); worker.on('exit', code => { if (!settled) finish(Error('Schema worker exited without evidence (' + code + ').')); });
  });
}
async function run(test, { resolveSecret, redact = value => value, signal, fetch: fetchImpl = fetch } = {}) {
  validateDefinition(test);
  if (test.schema !== undefined) await schemaValidate(test.schema, null, test.dialect, signal);
  const resolveAssertion = async value => {
    if (Array.isArray(value)) return Promise.all(value.map(resolveAssertion));
    if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, child]) => [key, await resolveAssertion(child)])));
    if (typeof value !== 'string') return value;
    for (const match of value.matchAll(/secret:[a-f0-9-]{36}/g)) { if (!resolveSecret) throw Error('A protected assertion credential is unavailable.'); value = value.split(match[0]).join(await resolveSecret(match[0])); }
    return value;
  };
  const expectedBody = Object.hasOwn(test, 'expectedBody') ? await resolveAssertion(test.expectedBody) : undefined;
  const expectedHeaders = await resolveAssertion(test.expectedHeaders || {});
  const started = performance.now(), checks = [];
  const response = await require('../protected-request.cjs').protectedRequest({ ...test, includeResponseHeaders: true, body: test.body || undefined }, { resolveSecret, redact: value => value, signal, fetch: fetchImpl });
  checks.push({ name: 'HTTP status', expected: test.expectedStatus, actual: response.status, passed: response.status === test.expectedStatus });
  const duration = Math.round(performance.now() - started);
  if (test.maxLatency > 0) checks.push({ name: 'Response time', expected: test.maxLatency, actual: duration, passed: duration <= test.maxLatency });
  if (test.bodyContains) checks.push({ name: 'Response contains text', expected: test.bodyContains, passed: response.body.includes(test.bodyContains) });
  for (const [name, expected] of Object.entries(expectedHeaders)) {
    const actual = response.headers[name.toLowerCase()];
    checks.push({ name: 'Response header: ' + name, expected, actual, passed: actual === expected });
  }
  if (test.kind === 'contract') {
    let body; try { body = JSON.parse(response.body); } catch { throw Error('Contract response is not valid JSON.'); }
    if (test.schema !== undefined) {
      const report = await schemaValidate(test.schema, body, test.dialect, signal);
      checks.push({ name: 'Response JSON schema', passed: report.valid, violations: report.errors });
    }
    if (Object.hasOwn(test, 'expectedBody')) checks.push({ name: 'Exact Pact response body', passed: isDeepStrictEqual(body, expectedBody) });
  }
  const publicHeaders = Object.fromEntries(Object.entries(response.headers).filter(([key]) => key === 'content-type' || Object.keys(test.expectedHeaders || {}).some(name => name.toLowerCase() === key)));
  return redact({ status: checks.every(check => check.passed) ? 'PASSED' : 'FAILED', duration, statusCode: response.status, checks, response: response.body, responseHeaders: publicHeaders, finishedAt: new Date().toISOString() });
}
module.exports = { run, validateDefinition, schemaValidate };
