const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function harness(files, overrides = {}) {
  const values = new Map(), nodes = new Map(), blobs = [];
  const localStorage = new Proxy({
    getItem: k => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k),
    key: i => [...values.keys()][i], get length() { return values.size; }
  }, { ownKeys: () => [...values.keys()], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });
  const node = () => ({ value: '', textContent: '', innerHTML: '', disabled: false, style: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, click() {}, remove() {},
    appendChild(el) { this.children.push(el); }, removeChild() {},
    addEventListener(type, fn) { this.listeners ||= {}; this.listeners[type] = fn; },
    querySelector() { this.button ||= node(); return this.button; } });
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
    createElement: node, querySelector: () => null, querySelectorAll: () => [], body: node(), addEventListener() {} };
  const context = { localStorage, document, console: { log() {}, warn() {}, error() {} }, Blob, URL: { createObjectURL(blob) { assert.ok(blob instanceof Blob); blobs.push(blob); return 'blob:fixture'; }, revokeObjectURL() {} },
    navigator: {}, confirm: () => true, setTimeout, clearTimeout, CustomEvent: class {},
    location: { hash: '', pathname: '/' }, addEventListener() {}, dispatchEvent() {}, showMessage() {},
    ...overrides };
  context.window = context;
  vm.createContext(context);
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  return { c: context, nodes, values, blobs };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('S07 complete CSV quoted records preserve multiline, CRLF, quotes and whitespace; malformed rows reject', () => {
  const { c } = harness(['data-manager.js']);
  assert.deepEqual(plain(c.dataManager.parseCSV('name,note\r\nAda," line1\nline2, ""quoted"" "\r\n')), { headers: ['name', 'note'], data: [{ name: 'Ada', note: ' line1\nline2, "quoted" ' }] });
  for (const csv of ['a,b\n1', 'a\n"unterminated', 'a,a\n1,2', 'a\n"x"oops']) assert.throws(() => c.dataManager.parseCSV(csv));
});

test('S08/S16 dataset edit/save and exported CSV round-trip quoted headers, numeric zero and generated numbers', async () => {
  const { c, nodes, blobs } = harness(['data-manager.js']);
  const id = c.dataManager.saveDataSet({ name: 'fixture', headers: ['a,b', 'quote"', 'n'], data: [{ 'a,b': 'x,y\nnext', 'quote"': 'a"b', n: 0 }] });
  c.editDataSet(id); c.saveManualDataSet();
  assert.deepEqual(plain(c.dataManager.getDataSet(id).data), [{ 'a,b': 'x,y\nnext', 'quote"': 'a"b', n: '0' }]);
  c.exportDataSet(id);
  assert.equal(c.dataManager.parseCSV(await blobs[0].text()).data[0].n, '0');
  c.document.getElementById('data-set-name-generate').value = 'generated';
  c.document.getElementById('generate-row-count').value = '1';
  c.document.getElementById('generate-pattern').value = '{{number:5:5}}';
  c.generateAndSaveDataSet();
  const generated = c.dataManager.getAllDataSets().find(d => d.name === 'generated');
  assert.equal(generated.data[0].number, 5); c.exportDataSet(generated.id);
  assert.equal(c.dataManager.parseCSV(await blobs[1].text()).data[0].number, '5');
});

test('S09 data and environment placeholders treat keys and replacement values literally', () => {
  const { c } = harness(['data-manager.js', 'environment-manager.js']);
  assert.equal(c.dataManager.replaceVariables('${a.b} ${aXb} ${[}', { 'a.b': '$&', '[': '$`' }), '$& ${aXb} $`');
  const id = c.environmentManager.saveEnvironment({ name: 'fixture', variables: { 'a.b': '$&', '[': '$1' } });
  assert.equal(c.environmentManager.replaceEnvironmentVariables('${env.a.b} ${env.aXb} ${env.[}', id), '$& ${env.aXb} $1');
});

test('S15 replacement upload failure disables saving and stale async completion is ignored', async () => {
  const { c } = harness(['data-manager.js']);
  const upload = file => c.handleDataFileUpload({ target: { files: [file] } });
  await upload({ name: 'first.csv', text: async () => 'a\nfirst' });
  assert.equal(c.document.getElementById('save-uploaded-data-btn').disabled, false);
  await upload({ name: 'bad.csv', text: async () => 'invalid' });
  assert.equal(c.document.getElementById('save-uploaded-data-btn').disabled, true);
  c.saveUploadedDataSet(); assert.equal(c.dataManager.getAllDataSets().length, 0);
  let resolveOld;
  const old = upload({ name: 'old.csv', text: () => new Promise(r => resolveOld = r) });
  await upload({ name: 'new.csv', text: async () => 'a\nnew' });
  resolveOld('a\nold'); await old;
  c.saveUploadedDataSet(); assert.equal(c.dataManager.getAllDataSets()[0].data[0].a, 'new');
});

function collaborationHarness() {
  const h = harness(['collaboration.js', 'collaboration-ui.js', 'collaboration-ui2.js']);
  const persisted = new Map(); let refreshes = 0;
  h.c.testSuites = [];
  h.c.LVXApp = { getStorage: () => ({ saveSuite: async suite => { persisted.set(suite.id, plain(suite)); }, updateSuite: async (id, suite) => { assert.ok(persisted.has(id)); persisted.set(id, plain(suite)); } }),
    refreshSuites: async () => { refreshes++; h.c.testSuites = [...persisted.values()].map(plain); } };
  return { ...h, persisted, refreshes: () => refreshes };
}

test('S04/S05 public file export/import round-trips single and bulk through committed storage with fresh IDs', async () => {
  const h = collaborationHarness(), { c, blobs, persisted } = h;
  c.testSuites = [{ id: 'original-1', name: 'One', code: 'first' }, { id: 'original-2', name: 'Two', code: 'second' }];
  c.exportAllSuites();
  await c.handleImportFile({ files: [{ name: 'bulk.json', size: blobs[0].size, text: () => blobs[0].text() }], value: '' });
  assert.equal(persisted.size, 2); assert.equal(h.refreshes(), 1);
  assert.ok([...persisted.keys()].every(id => !id.startsWith('original-')));
  const exported = c.collaborationManager.exportForTeam([...persisted.values()][0]);
  await c.handleImportFile({ files: [{ name: 'single.json', size: exported.size, text: () => exported.blob.text() }], value: '' });
  assert.equal(persisted.size, 3); assert.equal(c.testSuites.length, 3);
  assert.throws(() => c.collaborationManager.importFromTeamExport({ format: 'lvx-machina-bulk-export', suites: [{ name: 'ok' }, null] }));
});

test('S04 backend import and snapshot restore await persistence; rejection leaves in-memory suites unchanged', async () => {
  const h = collaborationHarness(), { c, persisted } = h;
  c.collaborationManager.importFromBackendShareLink = async () => ({ id: 'remote', name: 'Shared', code: 'initial' });
  await c.importFromSharedLink('fixture');
  const id = c.testSuites[0].id; assert.notEqual(id, 'remote'); assert.equal(persisted.size, 1);
  const snapshot = c.collaborationManager.createVersionSnapshot(c.testSuites[0], 'initial');
  persisted.set(id, { ...persisted.get(id), code: 'changed' }); await c.LVXApp.refreshSuites();
  await c.restoreVersionById(snapshot.id); assert.equal(persisted.get(id).code, 'initial');
  const before = JSON.stringify(c.testSuites); const messages = [];
  c.showMessage = (message, type) => messages.push({ message, type });
  c.LVXApp.getStorage = () => ({ saveSuite: async () => { throw Error('commit rejected'); } });
  await c.importFromSharedLink('fixture');
  assert.equal(JSON.stringify(c.testSuites), before);
  assert.equal(messages.at(-1).type, 'error');
});

test('S06 email modal listener retains actual Blob and suite name in closure without sending', async () => {
  const { c } = collaborationHarness();
  const exported = c.collaborationManager.exportForTeam({ id: '1', name: 'Quoted "suite"', code: 'fixture' });
  let passed;
  c.sendEmailWithFile = async (...args) => { passed = args; };
  const modal = c.showEmailRecipientModal(exported, 'Quoted "suite"');
  assert.ok(!modal.innerHTML.includes('sendEmailWithFile('));
  await modal.querySelector().listeners.click();
  assert.equal(passed[0], exported); assert.ok(passed[0].blob instanceof Blob);
  assert.equal(JSON.parse(await passed[0].blob.text()).suite.name, 'Quoted "suite"');
});

test('S14 retained collaboration snapshots have monotonically increasing version ordinals', () => {
  const { c } = collaborationHarness();
  for (let i = 0; i < 25; i++) c.collaborationManager.createVersionSnapshot({ id: 'one', name: 'One' });
  const history = c.collaborationManager.getVersionHistory('one');
  assert.equal(history.length, 25); assert.deepEqual(plain(history.map(v => v.version)), Array.from({ length: 25 }, (_, i) => i + 1));
});

test('S03 IndexedDB saves and deletes resolve only on commit; abort rejects after request success', async () => {
  const { c } = harness(['indexeddb-version-storage.js'], { indexedDB: { open() { return {}; } } });
  for (const method of ['saveVersionHistory', 'deleteVersionHistory']) {
    const adapter = new c.IndexedDBVersionStorage(); const request = {}, transaction = { objectStore: () => ({ put: () => request, delete: () => request }) };
    adapter.db = { transaction: () => transaction };
    let settled = false; const operation = adapter[method]('suite', []).then(() => settled = true);
    request.onsuccess?.(); await Promise.resolve(); assert.equal(settled, false);
    transaction.oncomplete(); await operation; assert.equal(settled, true);
    const aborted = adapter[method]('suite', []); request.onsuccess?.(); transaction.onabort();
    await assert.rejects(aborted, /aborted/);
  }
});

test('S01 verified migration is visible through active reader, subsequent saves extend it, originals remain and failed commits keep fallback', async () => {
  const { c, values } = harness(['version-control.js', 'indexeddb-version-storage.js'], { indexedDB: { open() { return {}; } } });
  const legacy = [{ versionId: 'legacy', timestamp: '2026-01-01', suiteSnapshot: { name: 'Original', code: 'v1' } }];
  values.set('suite_versions_suite', JSON.stringify(legacy));
  const records = new Map(); const adapter = new c.IndexedDBVersionStorage();
  adapter.getVersionHistory = async id => records.get(id) || [];
  adapter.saveVersionHistory = async (id, versions) => { records.set(id, plain(versions)); };
  assert.equal(await adapter.migrateFromLocalStorage(), 1); assert.ok(values.has('suite_versions_suite'));
  const backend = new c.VersionControlWithIndexedDB(); backend.storage = adapter; backend.initialized = true; backend.ready = Promise.resolve(true);
  c.indexedDBVersionControl = backend;
  assert.equal((await c.versionControl.getVersionHistory('suite'))[0].versionId, 'legacy');
  await Promise.all([c.versionControl.saveVersion('suite', { name: 'Second' }), c.versionControl.saveVersion('suite', { name: 'Third' })]);
  assert.equal((await c.versionControl.getVersionHistory('suite')).length, 3);
  assert.equal((await c.versionControl.restoreVersion('suite', 'legacy')).name, 'Original');
  await c.openVersionHistory(null, 'suite'); await c.exportVersionHistory();
  assert.equal(await adapter.migrateFromLocalStorage(), 0);
  values.set('suite_versions_failure', JSON.stringify(legacy)); adapter.saveVersionHistory = async () => { throw Error('commit rejected'); };
  await assert.rejects(adapter.migrateFromLocalStorage(), /commit rejected/);
  assert.ok(values.has('suite_versions_failure')); assert.equal(values.has('idb_migrated_failure'), false);
});

test('S11 security dashboard consumes real manager counts and signals absent historic details', () => {
  const { c } = harness(['reporting-dashboard.js', 'security-testing.js']);
  c.securityManager._saveToHistory({ id: 'critical', timestamp: new Date().toISOString(), type: 'code', summary: { total: 1, critical: 1, high: 0, medium: 0, low: 0 }, policyPassed: false });
  c.Chart = class { constructor() {} destroy() {} };
  c.refreshSecurityDashboard();
  assert.equal(c.document.getElementById('sec-stat-total-vulns').textContent, 1);
  assert.equal(c.document.getElementById('sec-stat-critical').textContent, 1);
  assert.equal(c.document.getElementById('compliance-score').textContent, 75);
  assert.match(c.document.getElementById('top-vulnerabilities-body').innerHTML, /details unavailable|critical/i);
});

test('S12 all dashboard widgets receive one filtered history and All Time trends include old executions', () => {
  const { c, values } = harness(['reporting-dashboard.js']);
  const history = [{ suiteId: 'recent', suiteName: 'Recent', timestamp: new Date().toISOString(), status: 'PASSED', executionTime: 1 }, { suiteId: 'old', suiteName: 'Old', timestamp: new Date(Date.now() - 90 * 86400000).toISOString(), status: 'FAILED', executionTime: 10000 }];
  values.set('test_execution_history', JSON.stringify(history));
  const received = {}; for (const name of ['renderSummaryStatistics','renderTrendChart','renderDistributionChart','renderFlakyTests','renderSlowestTests','renderMostRunTests','renderRecentExecutions']) c[name] = (...args) => received[name] = args;
  c.document.getElementById('dashboard-timeframe').value = '7'; c.refreshDashboard();
  for (const [name, args] of Object.entries(received)) assert.equal(args[name === 'renderTrendChart' ? 1 : 0].length, 1);
  const recent = c.testHistoryManager.getRecentHistory(7);
  assert.equal(c.testHistoryManager.getSlowestTests(5, recent)[0].suiteName, 'Recent');
  assert.equal(c.testHistoryManager.getMostRunTests(5, recent).length, 1);
  c.document.getElementById('dashboard-timeframe').value = 'all'; c.refreshDashboard();
  assert.equal(received.renderTrendChart[0], null);
  assert.equal(c.testHistoryManager.getExecutionTrends(null, received.renderTrendChart[1]).length, 2);
});

test('S13 all generated CI gates parse actual JSON summaries and reject mixed failures, errors, pending and missing evidence', () => {
  const { c } = harness(['cicd-integration.js']); const manager = c.cicdConfiguration;
  const code = manager._ciResultCheck();
  for (const generate of ['generateGitHubActionsWorkflow', 'generateGitLabCI', 'generateJenkinsPipeline']) assert.ok(manager[generate](['fixture']).includes(code));
  const bundledPython = path.join(require('node:os').homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  const python = process.env.LVX_TEST_PYTHON || (fs.existsSync(bundledPython) ? bundledPython : 'python3');
  const valid = { summary: { total: 2, passed: 2, failed: 0, errors: 0 }, status: 'SUCCESS' };
  const cases = [[valid, 0], [{ ...valid.summary }, 0], [{ summary: { total: 2, passed: 1, failed: 1, errors: 0 } }, 1], [{ summary: { total: 1, passed: 0, failed: 0, errors: 1 } }, 1], [{ summary: { total: 0, passed: 0, failed: 0, errors: 0 } }, 1], [{ passed: 2 }, 1], [{ ...valid, status: 'PENDING' }, 1], [{ ...valid, error: 'execution unavailable' }, 1], [{ ...valid, results: [{ status: 'ERROR' }] }, 1], [{ ...valid, summary: { total: '2', passed: 2, failed: 0, errors: 0 } }, 1]];
  for (const [payload, expected] of cases) {
    const result = spawnSync(python, ['-c', code], { input: JSON.stringify(payload, null, 2), encoding: 'utf8' });
    assert.equal(result.status, expected, JSON.stringify(payload) + result.stderr);
  }
});

test('S01 integration hunt: one failed legacy migration keeps existing committed histories visible, failed writes do not split stores', async () => {
  const { c, values } = harness(['version-control.js', 'indexeddb-version-storage.js'], { indexedDB: { open() { return {}; } } });
  const backend = new c.VersionControlWithIndexedDB();
  const existing = [{ versionId: 'committed', timestamp: '2026-01-02', suiteSnapshot: { name: 'Committed' } }];
  const legacy = [{ versionId: 'older', timestamp: '2026-01-01', suiteSnapshot: { name: 'Legacy' } }];
  values.set('suite_versions_pending', JSON.stringify(legacy));
  backend.storage = { initialize: async () => {}, migrateFromLocalStorage: async () => { throw Error('one record is malformed'); },
    getVersionHistory: async () => plain(existing), saveVersionHistory: async () => { throw Error('commit rejected'); } };
  backend.ready = backend.initialize(); c.indexedDBVersionControl = backend;
  assert.equal(await backend.ready, true); assert.equal(backend.initialized, true);
  assert.equal((await c.versionControl.getVersionHistory('previously-migrated'))[0].versionId, 'committed');
  assert.deepEqual(plain((await c.versionControl.getVersionHistory('pending')).map(v => v.versionId)), ['older', 'committed']);
  await assert.rejects(c.versionControl.saveVersion('pending', { name: 'Uncommitted' }), /commit rejected/);
  assert.deepEqual(JSON.parse(values.get('suite_versions_pending')), legacy);
  assert.equal(values.has('idb_migrated_pending'), false);
});

test('S01 fallback writes invalidate migration marker so newer local snapshots migrate on recovery', async () => {
  const { c, values } = harness(['indexeddb-version-storage.js'], { indexedDB: { open() { return {}; } } });
  const backend = new c.VersionControlWithIndexedDB();
  values.set('idb_migrated_suite', 'previous');
  await backend.saveVersion('suite', { name: 'Saved while offline' });
  assert.equal(values.has('idb_migrated_suite'), false);
  assert.equal(JSON.parse(values.get('suite_versions_suite'))[0].suiteSnapshot.name, 'Saved while offline');
});

test('S11 unavailable scan evidence cannot display perfect compliance', () => {
  const { c } = harness(['reporting-dashboard.js', 'security-testing.js']);
  c.Chart = class { destroy() {} };
  c.securityManager._saveToHistory({ id: 'error', timestamp: new Date().toISOString(), summary: { total: 0 }, status: 'ERROR', error: 'scanner unavailable', policyPassed: false });
  c.refreshSecurityDashboard();
  assert.equal(c.document.getElementById('compliance-score').textContent, 'Incomplete');
});

test('S07/S08 empty single-column values survive serializer/parser round-trip', () => {
  const { c } = harness(['data-manager.js']);
  const csv = c.dataManager.serializeCSV(['value'], [{ value: '' }]);
  assert.deepEqual(plain(c.dataManager.parseCSV(csv)), { headers: ['value'], data: [{ value: '' }] });
});
