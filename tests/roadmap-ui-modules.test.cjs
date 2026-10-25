'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { validateManifest, renderBundle, buildUI } = require('../scripts/build-ui.cjs');
const root = path.resolve(__dirname, '..');
const manifest = () => JSON.parse(fs.readFileSync(path.join(root, 'ui-modules.json'), 'utf8'));

test('MODULES dependency declaration covers every retained app script and emits deterministic synchronous classic code', () => {
  const source = manifest(), ordered = validateManifest(source), index = new Map(ordered.map((item, i) => [item.id, i]));
  for (const item of ordered) for (const id of item.dependsOn) assert.ok(index.get(id) < index.get(item.id));
  for (const id of ['script', 'protected-config', 'runtime-assets', 'icons', 'studio-storage', 'studio-accessibility', 'visual-web-tester', 'unit-testing']) assert.ok(index.has(id), id);
  const result = renderBundle(source), reversed = structuredClone(source); reversed.modules.reverse();
  assert.equal(renderBundle(reversed).content, result.content);
  assert.equal(result.modules.includes('runtime-assets'), false); assert.ok(result.externals.includes('icons.js'));
  assert.ok(result.content.includes('window.onload = async function')); assert.ok(result.content.includes("document.addEventListener('DOMContentLoaded'"));
  assert.equal(result.content.includes('document.createElement("script")'), false);
  assert.doesNotThrow(() => new vm.Script(result.content));
});

test('MODULES unknown dependencies, cycles, duplicate ids/sources and missing source files fail before any output', () => {
  for (const [mutate, expected] of [
    [m => m.modules[0].dependsOn.push('missing'), /Unknown UI dependency/],
    [m => m.modules.find(x => x.id === 'script').dependsOn.push('unit-testing'), /cycle/],
    [m => m.modules.push(structuredClone(m.modules[0])), /Duplicate/],
    [m => m.modules.push({ id: 'duplicate-source', source: 'script.js', dependsOn: [] }), /Duplicate UI module source/],
    [m => m.modules.push({ id: 'missing-source', source: 'missing-file.js', dependsOn: [] }), /Missing UI module source/],
    [m => m.modules[0].dependsOn.push('icons', 'icons'), /duplicate UI dependencies/],
    [m => m.modules[0].source = '../outside.js', /Invalid UI module source/]
  ]) { const m = manifest(); mutate(m); assert.throws(() => renderBundle(m), expected); }
});

test('MODULES stale generated output is rejected and fresh output contains all current source fingerprints', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-ui-build-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.writeFileSync(path.join(folder, 'sample.js'), 'window.sample = 1;');
  const sample = { schemaVersion: 1, output: 'assets/app.js', modules: [{ id: 'sample', source: 'sample.js', dependsOn: [] }] };
  const one = buildUI({ root: folder, manifest: sample }); assert.equal(buildUI({ root: folder, manifest: sample, check: true }).sha256, one.sha256);
  fs.writeFileSync(path.join(folder, 'sample.js'), 'window.sample = 2;'); assert.throws(() => buildUI({ root: folder, manifest: sample, check: true }), /stale/);
  const two = buildUI({ root: folder, manifest: sample }); assert.notEqual(one.sha256, two.sha256);
  assert.equal(buildUI({ check: true }).content, renderBundle(manifest()).content);
});

test('MODULES application-rendered icon sources are semantic SVG calls and compatibility hydration is explicit only', () => {
  const assigned = manifest().modules.filter(item => !item.external).map(item => item.source);
  for (const file of assigned.filter(file => file.endsWith('.js') && file !== 'icons.js' && !file.startsWith('assets/'))) {
    const source = fs.readFileSync(path.join(root, file), 'utf8'); assert.equal(/\p{Extended_Pictographic}/u.test(source), false, file);
    assert.equal(/'\$\{window\.LVXIcons/.test(source), false, 'Literal unevaluated icon in ' + file);
  }
  const icons = fs.readFileSync(path.join(root, 'icons.js'), 'utf8'); assert.equal(icons.includes('new MutationObserver'), false); assert.ok(icons.includes('hydrateImported:hydrate'));
  const context = { window: {}, document: { addEventListener() { throw Error('No application hydration observer'); } }, Intl }; vm.createContext(context); vm.runInContext(icons, context);
  const labelled = context.window.LVXIcons.svg('trash', 'Delete <draft>'); assert.match(labelled, /role="img"/); assert.match(labelled, /Delete &lt;draft&gt;/); assert.equal(labelled.includes('aria-hidden="true"'), false);
  assert.match(context.window.LVXIcons.svg('trash'), /aria-hidden="true"/);
});

test('MODULES derived native unit code checks original imported definition before execution', async () => {
  for (const kind of ['unittest', 'custom']) {
    const calls = [], context = { window: null, document: { readyState: 'loading', addEventListener() {} }, localStorage: { getItem() { return null; } }, console, setTimeout, clearTimeout, Date, Math, Promise };
    context.window = context; context.electronAPI = { studioOps: { invoke: async (domain, action, payload) => { calls.push({ domain, action, payload }); if (domain === 'host') throw Error('Review imported workflow first'); throw Error('Execution must not run'); } } };
    vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(root, 'unit-testing.js'), 'utf8'), context);
    const definition = { id: 'imported-unit', imported: true, test_framework: kind, test_code: kind === 'unittest' ? 'while True: pass' : 'while(true){}' };
    const result = await context[kind === 'unittest' ? 'executePythonUnitTest' : 'executeJavaScriptUnitTest'](definition);
    assert.equal(result.status, 'FAIL'); assert.match(result.error, /Review imported/); assert.equal(calls.length, 1); assert.equal(calls[0].payload.definition, definition);
  }
});

test('MODULES real Chromium loads synchronous app bundle before DOM-ready and renders SVG without an icon observer', async t => {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.external/playwright-browsers');
  const { chromium } = require('playwright'), { createServer } = require('../scripts/dev-server.cjs');
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close()); const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  // Use the generated artifact even while root integrates its script tag into index.html.
  await page.route('**/index.html', async route => {
    let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    for (const item of manifest().modules.filter(item => !item.external)) html = html.replace(new RegExp('<script src="' + item.source.replaceAll('.', '\\.') + '"></script>\\s*', 'g'), '');
    html = html.replace(/<script src="assets\/app-modules\.js"><\/script>/g, '');
    html = html.replace('</body>', '<script src="assets/app-modules.js"></script><script>document.addEventListener("DOMContentLoaded",()=>window.__moduleReady={unit:typeof openUnitTestingModal,pipeline:typeof openPipelineEditor,icons:typeof LVXIcons.svg})</script></body>');
    await route.fulfill({ contentType: 'text/html', body: html });
  });
  await page.goto('http://127.0.0.1:' + server.address().port + '/index.html');
  await page.waitForFunction(() => window.__moduleReady && window.LVXApp);
  assert.deepEqual(await page.evaluate(() => window.__moduleReady), { unit: 'function', pipeline: 'function', icons: 'function' });
  const result = await page.evaluate(async () => {
    openEnvironmentManager(); const env = environmentManager.getActiveEnvironment(); selectEnvironmentForView(env.id);
    localStorage.setItem('notification_integrations', JSON.stringify([{ id: 'fixture', name: 'Fixture notification', type: 'webhook', enabled: true }])); openIntegrationsModal();
    const icons = document.querySelectorAll('#environment-details svg[data-icon],#integrations-list svg[data-icon]').length;
    const legacy = document.createElement('div'); legacy.id = 'legacy-fixture'; legacy.textContent = String.fromCodePoint(0x1F4BE); document.body.append(legacy);
    await new Promise(resolve => requestAnimationFrame(resolve)); const untouched = legacy.querySelector('svg') === null; LVXIcons.hydrateImported(legacy);
    const payloads = []; integrationsManager._request = async (_url, options) => { payloads.push(JSON.parse(options.body)); return new Response('{}', { status: 200 }); };
    await integrationsManager._sendSlackNotification({ webhookUrl: 'http://fixture' }, { status: 'SUCCESS', suiteName: 'Fixture' });
    await integrationsManager._sendDiscordNotification({ webhookUrl: 'http://fixture' }, { status: 'FAILURE', suiteName: 'Fixture' });
    return { icons, untouched, importedSvg: !!legacy.querySelector('svg[data-icon="save"]'), payloads, badge: getStatusBadge('PASS'), severity: getSeverityIcon('CRITICAL') };
  });
  assert.ok(result.icons >= 4, 'Directly rendered environment and integration icons'); assert.equal(result.untouched, true); assert.equal(result.importedSvg, true);
  assert.match(result.badge, /data-icon="check"/); assert.match(result.severity, /aria-label="CRITICAL severity"/);
  const payload = JSON.stringify(result.payloads); assert.equal(payload.includes('<svg'), false); assert.equal(/\p{Extended_Pictographic}/u.test(payload), false); assert.match(payload, /Passed:/); assert.match(payload, /Failed:/);
  assert.deepEqual(errors, []);
});
