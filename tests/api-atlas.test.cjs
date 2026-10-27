'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { discover, candidatePath, contractSchema } = require('../services/api-atlas/discovery.cjs');
const { run, validateDefinition, schemaValidate } = require('../services/api-atlas/runner.cjs');

let server, origin;
const requests = [];
const secrets = { resolveSecret: value => value };
test.before(async () => {
  server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ url: request.url, method: request.method, headers: request.headers, body });
    if (request.url === '/slow') {
      const timer = setTimeout(() => response.end('{}'), 500);
      response.on('close', () => clearTimeout(timer));
      return;
    }
    if (request.url === '/redirect') { response.writeHead(302, { location: '/orders' }).end(); return; }
    if (request.url === '/text') { response.end('not JSON'); return; }
    response.setHeader('content-type', 'application/json');
    response.setHeader('x-contract-version', 'v1');
    if (request.url === '/missing') { response.writeHead(404).end('{"error":"missing"}'); return; }
    response.end(JSON.stringify({ id: 42, name: 'Ada', email: 'ada@example.test' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
});
test.after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

function definition(overrides = {}) {
  return { kind: 'api', method: 'GET', url: origin + '/orders', expectedStatus: 200, timeoutMs: 2000, ...overrides };
}
function repository(id, files, extra = {}) {
  return { id, fullName: 'acme/' + id, commit: 'immutable-commit-' + id, selected: '.github/workflows/ci.yml', files, ...extra };
}
const jsonFile = (path, value) => ({ path, content: JSON.stringify(value) });
function apiDocument(baseUrl = origin, extra = {}) {
  return {
    openapi: '3.0.3', info: { title: 'Orders', version: '1' }, servers: [{ url: baseUrl }],
    paths: { '/orders': { get: { summary: 'List orders', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } } } } } },
    components: { schemas: { Order: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } }, additionalProperties: true } } }, ...extra
  };
}

test('OpenAPI JSON yields immutable endpoint provenance and an executable referenced response contract', async () => {
  const atlas = await discover([repository('orders', [jsonFile('api/openapi.json', apiDocument())])]);
  assert.equal(atlas.services.length, 1);
  assert.equal(atlas.services[0].workflow, '.github/workflows/ci.yml');
  assert.equal(atlas.endpoints.length, 1);
  const endpoint = atlas.endpoints[0];
  assert.equal(endpoint.method, 'GET');
  assert.equal(endpoint.baseUrl, origin);
  assert.equal(endpoint.evidence[0].commit, 'immutable-commit-orders');
  assert.equal(endpoint.evidence[0].pointer, '#/paths/~1orders/get');
  assert.ok(endpoint.schema.$defs);
  assert.equal((await run(definition({ kind: 'contract', schema: endpoint.schema }), secrets)).status, 'PASSED');
  assert.equal((await schemaValidate(endpoint.schema, { id: 'bad' })).valid, false);
  const again = await discover([repository('orders', [jsonFile('api/openapi.json', apiDocument())])]);
  assert.equal(again.endpoints[0].id, endpoint.id);
});

test('OpenAPI YAML resolves only in-snapshot relative references and server variables', async () => {
  const content = `openapi: 3.1.0\ninfo:\n  title: Inventory\n  version: '1'\nservers:\n  - url: ${origin}/{version}\n    variables:\n      version:\n        default: v2\npaths:\n  /stock:\n    get:\n      responses:\n        '200':\n          description: stock\n          content:\n            application/json:\n              schema:\n                $ref: './models/stock.yaml'\n`;
  const atlas = await discover([repository('inventory', [{ path: 'api/openapi.yaml', content }, { path: 'api/models/stock.yaml', content: 'type: object\nrequired: [available]\nproperties:\n  available:\n    type: boolean\n' }])]);
  assert.equal(atlas.diagnostics.length, 0);
  assert.equal(atlas.endpoints[0].baseUrl, origin + '/v2');
  assert.equal(atlas.endpoints[0].dialect, '2020-12');
  assert.equal((await schemaValidate(atlas.endpoints[0].schema, { available: true }, '2020-12')).valid, true);
  assert.equal((await schemaValidate(atlas.endpoints[0].schema, { available: 'yes' }, '2020-12')).valid, false);
});

test('External and missing OpenAPI references fail closed without contacting a remote resolver', async () => {
  const before = requests.length;
  for (const ref of [origin + '/external-schema', 'file:///C:/private/schema.json', './missing.json']) {
    const doc = apiDocument();
    doc.paths['/orders'].get.responses[200].content['application/json'].schema = { $ref: ref };
    const atlas = await discover([repository('orders', [jsonFile('openapi.json', doc)])]);
    assert.equal(atlas.endpoints.length, 0, ref);
    assert.ok(atlas.diagnostics.some(item => /Cannot resolve/.test(item.message)), ref);
  }
  assert.equal(requests.length, before);
});

test('Node and Python literal calls connect only to a uniquely matching provider with source locations', async () => {
  const atlas = await discover([
    repository('orders', [jsonFile('openapi.json', apiDocument())]),
    repository('checkout', [{ path: 'src/index.js', content: `// service call\nfetch('${origin}/orders');\naxios.post('${origin}/unknown', {});\nfetch('https://unrelated.invalid/orders');\nfetch('/orders');\n` }]),
    repository('reporting', [{ path: 'report.py', content: `import requests\nrequests.get('${origin}/orders')\n@app.get('/report')\ndef report(): pass\n` }])
  ]);
  const matched = atlas.connections.filter(item => item.target === 'orders');
  assert.equal(matched.length, 2);
  assert.deepEqual(matched.map(item => item.source).sort(), ['checkout', 'reporting']);
  assert.ok(matched.every(item => item.endpointId === atlas.endpoints.find(endpoint => endpoint.serviceId === 'orders').id));
  assert.ok(matched.every(item => item.evidence.line === 2 && item.confidence === 'Static URL match'));
  assert.equal(atlas.connections.filter(item => item.target === null).length, 3);
  assert.ok(atlas.endpoints.some(item => item.serviceId === 'reporting' && item.path === '/report'));
});

test('Ambiguous providers and dynamic URLs remain explicitly unresolved', async () => {
  const atlas = await discover([
    repository('orders-a', [jsonFile('openapi.json', apiDocument())]),
    repository('orders-b', [jsonFile('openapi.json', apiDocument())]),
    repository('checkout', [{ path: 'caller.ts', content: `fetch('${origin}/orders');\nfetch(\`${origin}/orders/\${orderId}\`);` }])
  ]);
  assert.equal(atlas.connections.length, 2);
  assert.ok(atlas.connections.every(item => item.target === null && item.confidence === 'Unresolved target'));
  assert.match(atlas.coverage, /missing edge does not prove no connection/);
});

test('Response-object references retain their contract and base-path calls resolve to the provider', async () => {
  const doc = apiDocument(origin + '/api');
  const response = doc.paths['/orders'].get.responses[200];
  doc.components.responses = { OrdersResponse: response };
  doc.paths['/orders'].get.responses[200] = { $ref: '#/components/responses/OrdersResponse' };
  const atlas = await discover([repository('orders', [jsonFile('openapi.json', doc)]), repository('checkout', [{ path: 'client.js', content: `fetch('${origin}/api/orders');` }])]);
  assert.ok(atlas.endpoints[0].schema, 'response reference must retain response validation');
  assert.equal((await schemaValidate(atlas.endpoints[0].schema, { id: 'invalid' })).valid, false);
  assert.equal(atlas.connections[0].target, 'orders');
  assert.equal(atlas.connections[0].endpointId, atlas.endpoints[0].id);
});

test('A later fetch options object cannot change an earlier call method', async () => {
  const doc = apiDocument();
  doc.paths['/orders'].post = { responses: { 201: { description: 'Created' } } };
  const atlas = await discover([repository('orders', [jsonFile('openapi.json', doc)]), repository('checkout', [{ path: 'calls.js', content: `fetch('${origin}/orders');\nfetch('${origin}/orders', { method: 'POST' });` }])]);
  assert.deepEqual(atlas.connections.map(item => item.method), ['GET', 'POST']);
  assert.ok(atlas.connections.every(item => item.target === 'orders'));
});

test('Deleted and dependency sources are excluded while malformed descriptions surface diagnostics', async () => {
  assert.equal(candidatePath('node_modules/client/openapi.json'), false);
  assert.equal(candidatePath('.git/openapi.json'), false);
  const atlas = await discover([repository('bad', [
    { path: 'deleted.js', content: "app.get('/deleted', handler)", isDeleted: true },
    { path: 'node_modules/client/routes.js', content: "app.get('/dependency', handler)" },
    { path: 'openapi.json', content: '{broken' },
    { path: 'duplicate.yaml', content: 'openapi: 3.0.3\nopenapi: 3.1.0' }
  ])]);
  assert.equal(atlas.endpoints.length, 0);
  assert.equal(atlas.diagnostics.length, 2);
  await assert.rejects(discover(null), /snapshots/);
  await assert.rejects(discover([{ id: 'x', files: [] }]), /incomplete/);
});

test('Postman import extracts nested requests, variables and status without executing scripts', async () => {
  const atlas = await discover([repository('checkout', [jsonFile('tests/api.postman_collection.json', {
    info: { schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    variable: [{ key: 'base', value: origin }],
    item: [{ name: 'Folder', item: [{ name: 'Create order', request: { method: 'POST', url: '{{base}}/orders', header: [{ key: 'content-type', value: 'application/json' }, { key: 'ignore', value: 'value', disabled: true }], body: { mode: 'raw', raw: '{"item":42}' } }, event: [{ listen: 'test', script: { exec: ['pm.response.to.have.status(201);', 'throw new Error("DO NOT EXECUTE")'] } }] }] }, { name: 'Multipart upload', request: { method: 'POST', url: '{{base}}/upload', body: { mode: 'formdata', formdata: [] } } }]
  })])]);
  assert.equal(atlas.candidates.length, 2);
  const candidate = atlas.candidates[0];
  assert.equal(candidate.url, origin + '/orders');
  assert.equal(candidate.expectedStatus, 201);
  assert.deepEqual(candidate.headers, { 'content-type': 'application/json' });
  assert.equal(candidate.body, '{"item":42}');
  assert.equal(candidate.evidence.kind, 'Postman');
  assert.match(candidate.review, /never executed/);
  assert.match(atlas.candidates[1].blocked, /body mode/);
  assert.throws(() => validateDefinition(definition({ ...atlas.candidates[1], timeoutMs: 1000 })), /body mode/);
});

test('Pact imports exact HTTP interactions and blocks native provider-state/matcher verification', async () => {
  const interactions = [
    { description: 'Exact order', request: { method: 'GET', path: '/orders' }, response: { status: 200, body: { id: 42, name: 'Ada', email: 'ada@example.test' } } },
    { description: 'Seeded order', providerStates: [{ name: 'Order exists' }], request: { method: 'GET', path: '/orders' }, response: { status: 200, body: { id: 42 } } },
    { description: 'Matched order', request: { method: 'GET', path: '/orders' }, response: { status: 200, body: { id: 42 }, matchingRules: { body: {} } } },
    { description: 'Async message', contents: { id: 42 } }
  ];
  const atlas = await discover([repository('orders', [jsonFile('openapi.json', apiDocument())]), repository('checkout', [jsonFile('pacts/checkout-orders.json', { consumer: { name: 'checkout' }, provider: { name: 'Orders' }, interactions })])]);
  assert.equal(atlas.candidates.length, 3);
  assert.equal(atlas.connections.length, 3);
  assert.ok(atlas.connections.every(item => item.source === 'checkout' && item.target === 'orders' && item.endpointId));
  const candidate = atlas.candidates[0];
  assert.equal(candidate.kind, 'contract');
  assert.equal(candidate.url, origin + '/orders');
  assert.equal((await run(definition({ ...candidate, timeoutMs: 2000 }), secrets)).status, 'PASSED');
  assert.match(candidate.review, /does not publish Pact verification/);
  for (const blocked of atlas.candidates.slice(1)) assert.throws(() => validateDefinition(definition({ ...blocked, timeoutMs: 1000 })), /native Pact/);
  assert.ok(atlas.diagnostics.some(item => /native Pact verifier/.test(item.message)));
});

test('Recursive JSON pointer contracts preserve escaped names and reject missing/external references', async () => {
  const document = { components: { schemas: { 'a/b~c': { type: 'object', properties: { child: { $ref: '#/components/schemas/a~1b~0c' } } } } } };
  const schema = contractSchema({ $ref: '#/components/schemas/a~1b~0c' }, document);
  assert.equal((await schemaValidate(schema, { child: { child: {} } })).valid, true);
  assert.equal((await schemaValidate(schema, { child: 2 })).valid, false);
  assert.throws(() => contractSchema({ $ref: '#/missing' }, document), /Missing schema/);
  assert.throws(() => contractSchema({ $ref: 'https://example.test/schema' }, document), /External/);
  assert.equal((await schemaValidate(contractSchema({ type: 'string', nullable: true }, {}), null)).valid, true);
});

test('Pact query and expected response headers survive import and fail on header mismatch', async () => {
  const pact = { consumer: { name: 'checkout' }, provider: { name: 'Orders' }, interactions: [{ description: 'Filtered orders', request: { method: 'GET', path: '/orders', query: { state: ['open', 'pending'] } }, response: { status: 200, headers: { 'X-Contract-Version': 'v1' }, body: { id: 42, name: 'Ada', email: 'ada@example.test' } } }] };
  const atlas = await discover([repository('orders', [jsonFile('openapi.json', apiDocument())]), repository('checkout', [jsonFile('pacts/orders.json', pact)])]);
  const candidate = atlas.candidates[0];
  assert.deepEqual(new URL(candidate.url).searchParams.getAll('state'), ['open', 'pending']);
  assert.equal(candidate.expectedHeaders['X-Contract-Version'], 'v1');
  const positive = await run(definition({ ...candidate, timeoutMs: 2000 }), secrets);
  assert.equal(positive.status, 'PASSED');
  const negative = await run(definition({ ...candidate, timeoutMs: 2000, expectedHeaders: { 'x-contract-version': 'v2' } }), secrets);
  assert.equal(negative.status, 'FAILED');
  assert.ok(negative.checks.some(check => !check.passed));
});

test('API execution sends a real request and retains decisive status/body failure evidence', async () => {
  const success = await run(definition({ bodyContains: 'Ada' }), secrets);
  assert.equal(success.status, 'PASSED');
  assert.equal(success.statusCode, 200);
  assert.ok(success.duration >= 0);
  assert.equal(success.checks.length, 2);
  assert.match(success.finishedAt, /^\d{4}-/);
  const missing = await run(definition({ url: origin + '/missing' }), secrets);
  assert.equal(missing.status, 'FAILED');
  assert.deepEqual(missing.checks[0], { name: 'HTTP status', expected: 200, actual: 404, passed: false });
  const bodyFailure = await run(definition({ bodyContains: 'nonexistent' }), secrets);
  assert.equal(bodyFailure.status, 'FAILED');
  assert.equal(bodyFailure.checks[1].passed, false);
});

test('Contract checks fail on wrong types, required properties, formats and additional fields', async () => {
  const pass = await run(definition({ kind: 'contract', schema: { type: 'object', required: ['id', 'email'], properties: { id: { type: 'integer' }, email: { type: 'string', format: 'email' }, name: { type: 'string' } }, additionalProperties: false } }), secrets);
  assert.equal(pass.status, 'PASSED');
  for (const schema of [
    { type: 'object', properties: { id: { type: 'string' } } },
    { type: 'object', required: ['missing'], properties: { missing: { type: 'string' } } },
    { type: 'object', properties: { name: { type: 'string', format: 'email' } } },
    { type: 'object', properties: { id: { type: 'integer' } }, additionalProperties: false }
  ]) {
    const result = await run(definition({ kind: 'contract', schema }), secrets);
    assert.equal(result.status, 'FAILED');
    assert.ok(result.checks.find(check => check.name === 'Response JSON schema').violations.length > 0);
  }
  const exact = await run(definition({ kind: 'contract', expectedBody: { id: 42 } }), secrets);
  assert.equal(exact.status, 'FAILED');
  assert.equal(exact.checks.find(check => check.name === 'Exact Pact response body').passed, false);
  await assert.rejects(run(definition({ kind: 'contract', url: origin + '/text', schema: { type: 'object' } }), secrets), /not valid JSON/);
});

test('Unsupported schema assertions and unresolved schema references never receive a passing result', async () => {
  await assert.rejects(run(definition({ kind: 'contract', schema: { type: 'object', unsupportedAssertion: true } }), secrets), /unknown keyword|unsupportedAssertion/);
  await assert.rejects(schemaValidate({ type: 'object', discriminator: { propertyName: 'kind' }, properties: { kind: { type: 'string' } } }, { kind: 'unrecognized' }), /discriminator|unsupported|unknown keyword/i);
  await assert.rejects(schemaValidate({ $ref: 'https://example.test/schema.json' }, {}), /resolve reference/);
  assert.equal((await schemaValidate(false, {})).valid, false);
});

test('Draft 2020-12 validation enforces dependentRequired rather than ignoring the assertion', async () => {
  const schema = { type: 'object', properties: { id: { type: 'integer' }, token: { type: 'string' } }, dependentRequired: { id: ['token'] } };
  assert.equal((await schemaValidate(schema, { id: 42, token: 'ok' }, '2020-12')).valid, true);
  assert.equal((await schemaValidate(schema, { id: 42 }, '2020-12')).valid, false);
});

test('Protected credential references resolve at request time and final evidence is redacted', async () => {
  const reference = 'secret:11111111-1111-1111-1111-111111111111';
  const result = await run(definition({ method: 'POST', headers: { authorization: 'Bearer ' + reference, 'content-type': 'application/json' }, body: JSON.stringify({ token: reference }) }), {
    resolveSecret: value => { assert.equal(value, reference); return 'sensitive-token'; },
    redact: value => JSON.parse(JSON.stringify(value).replace(/Ada/g, '[redacted]'))
  });
  assert.equal(requests.at(-1).headers.authorization, 'Bearer sensitive-token');
  assert.deepEqual(JSON.parse(requests.at(-1).body), { token: 'sensitive-token' });
  assert.equal(result.status, 'PASSED');
  assert.ok(!result.response.includes('Ada'));
});

test('HTTP timeouts, cancellation and redirects produce errors without successful evidence', async () => {
  await assert.rejects(run(definition({ url: origin + '/slow', timeoutMs: 20 }), secrets), /timeout|abort|deadline/i);
  const abort = new AbortController();
  const pending = run(definition({ url: origin + '/slow' }), { ...secrets, signal: abort.signal });
  setTimeout(() => abort.abort(), 20);
  await assert.rejects(pending, /abort|cancel/i);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(schemaValidate({ type: 'object' }, {}, 'draft-07', cancelled.signal), /cancelled/);
  const workerAbort = new AbortController();
  const schemaPending = schemaValidate({ type: 'object' }, {}, 'draft-07', workerAbort.signal);
  workerAbort.abort();
  await assert.rejects(schemaPending, /cancelled/);
  await assert.rejects(run(definition({ url: origin + '/redirect' }), secrets), /fetch failed|redirect/i);
});

test('Latency budgets contribute a failed check even when HTTP status succeeds', async () => {
  const result = await run(definition({ url: origin + '/slow', maxLatency: 1 }), secrets);
  assert.equal(result.statusCode, 200);
  assert.equal(result.status, 'FAILED');
  const latency = result.checks.find(check => check.name === 'Response time');
  assert.equal(latency.passed, false);
  assert.ok(latency.actual > latency.expected);
});

test('Malformed test definitions fail before network traffic', async () => {
  const before = requests.length;
  for (const patch of [
    { kind: 'unknown' }, { method: 'TRACE' }, { url: 'file:///C:/private' },
    { url: 'http://user:pass@127.0.0.1/orders' }, { url: origin + '/orders/{id}' },
    { url: origin + '/{{unresolved}}' }, { expectedStatus: 0 }, { expectedStatus: 600 },
    { expectedStatus: '200' }, { timeoutMs: 0 }, { timeoutMs: -1 }, { timeoutMs: 1.2 },
    { kind: 'contract' }, { maxLatency: -1 }, { maxLatency: NaN }, { blocked: 'Native verifier required' }
  ]) await assert.rejects(run(definition(patch), secrets));
  assert.equal(requests.length, before);
});
