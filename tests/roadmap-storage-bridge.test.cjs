'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const http = require('node:http');
const { createService } = require('../services/workspace/index.cjs');

function browser(service, initial = {}, options = {}) {
  const values = new Map(Object.entries(initial).map(([name, value]) => [name, typeof value === 'string' ? value : JSON.stringify(value)]));
  const listeners = new Set(), calls = [];
  const context = { TextEncoder, Uint8Array, crypto: webcrypto, console, setTimeout, clearTimeout, localStorage: { get length() { return values.size; }, key: i => [...values.keys()][i] ?? null, getItem: name => values.get(name) ?? null, setItem: (name, value) => values.set(name, String(value)), removeItem: name => values.delete(name) }, ...options };
  context.window = context;
  context.electronAPI = { studioOps: { async invoke(domain, action, payload) {
    calls.push({ domain, action, payload: structuredClone(payload) });
    try { return await service.handle(action, structuredClone(payload)); }
    catch (error) { return { __lvxError: { code: error.code || 'OPERATION_FAILED', message: error.message, details: error.details } }; }
  }, onEvent(callback) { listeners.add(callback); return () => listeners.delete(callback); } } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../studio-storage.js'), 'utf8'), context, { filename: 'studio-storage.js' });
  return { api: context.LVXWorkspaceBridge, context, values, calls, emit: event => { for (const callback of listeners) callback(event); } };
}
async function setup(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-storage-bridge-'));
  const workspaceRoot = path.join(root, 'project'); fs.mkdirSync(workspaceRoot);
  const service = createService({ workspaceRoot, dataDir: path.join(root, 'private'), ...options });
  t.after(async () => { await service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, workspaceRoot, service };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('BRIDGE real SQLite suite backend creates, versions, edits, deletes and publishes committed values', async t => {
  const { service } = await setup(t);
  const h = browser(service), backend = h.api.createBackend();
  t.after(() => backend.dispose());
  await backend.initialize();
  const observed = [];
  const unsubscribe = await backend.subscribeToChanges(suites => observed.push(suites.map(suite => suite.name)));
  const suite = { name: 'first', code: 'assert(true)' };
  const id = await backend.saveSuite(suite);
  assert.equal(suite.id, id);
  assert.equal((await backend.getAllSuites())[0].name, 'first');
  await backend.beginEdit(id);
  await backend.updateSuite(id, { name: 'edited' });
  assert.deepEqual((await service.handle('list', { collection: 'versions' })).records.map(record => record.value.suiteSnapshot.name), ['first']);
  assert.equal((await service.handle('read', { collection: 'suites', id })).value.name, 'edited');
  assert.equal(backend.getStatusMessage().includes('SQLite'), true);
  await backend.deleteSuite(id);
  assert.equal((await backend.getAllSuites()).length, 0);
  assert.deepEqual(plain(observed), [[], ['first'], ['edited'], []]);
  unsubscribe();
});

test('BRIDGE pinned edits survive background refresh; conflicts retain drafts and never create phantom versions', async t => {
  const { service } = await setup(t);
  const one = browser(service).api.createBackend(), two = browser(service).api.createBackend();
  t.after(() => { one.dispose(); two.dispose(); });
  const id = await one.saveSuite({ id: 'shared', name: 'original', description: 'original' });
  await one.beginEdit(id); await two.beginEdit(id);
  await one.updateSuite(id, { name: 'A' });
  await two.getAllSuites();
  await assert.rejects(two.updateSuite(id, { description: 'B' }), error => error.code === 'CONFLICT' && error.details.current.value.name === 'A');
  assert.equal(two.edits.has(id), true);
  assert.equal((await service.handle('list', { collection: 'versions' })).records.length, 1);
  await two.mergeSuite(id, { name: 'A', description: 'B' });
  assert.deepEqual((await service.handle('read', { collection: 'suites', id })).value.description, 'B');
  await one.reloadSuite(id); await one.updateSuite(id, { name: 'C' });
  assert.equal((await service.handle('read', { collection: 'suites', id })).value.description, 'B');
});

test('BRIDGE old workspace drafts cannot write into another selected folder', async t => {
  const f = await setup(t), h = browser(f.service), backend = h.api.createBackend();
  t.after(() => backend.dispose());
  await backend.saveSuite({ id: 'same', name: 'first project' });
  await backend.beginEdit('same');
  const other = path.join(f.root, 'other'); fs.mkdirSync(other);
  await f.service.setWorkspace(other);
  await assert.rejects(backend.updateSuite('same', { name: 'wrong project' }), { code: 'WORKSPACE_CHANGED' });
  assert.equal((await f.service.handle('list')).records.length, 0);
});

function legacyFixture() {
  return {
    pipeline_test_suites: [{ id: 'suite-1', name: 'Existing suite', code: 'assert(1)', dataSetId: 'data-1', tags: ['existing'] }],
    test_data_sets: [{ id: 'data-1', name: 'Data', headers: ['n'], data: [{ n: 0 }] }],
    test_environments: [{ id: 'env-1', name: 'Local', variables: { TARGET: 'http://localhost', API_KEY: 'do-not-migrate' } }],
    active_environment: 'env-1',
    lvx_pipelines: [{ id: 'pipe-1', name: 'Pipeline', nodes: [{ id: 'node-1', data: { suiteId: 'suite-1' } }] }],
    lvx_unit_tests: [{ id: 'unit-1', name: 'Units', code: 'assert(true)' }],
    baseline_screenshots: { 'Main page / desktop': 'data:image/png;base64,AA==' },
    test_execution_history: [{ id: 'run-1', suiteId: 'suite-1', status: 'SUCCESS' }],
    test_comments: { 'suite-1': [{ id: 'comment-1', text: 'Preserve me' }] },
    suite_versions_suite_ignored: [],
    'suite_versions_suite-1': [{ versionId: 'v1', timestamp: '2026-10-24', suiteSnapshot: { id: 'suite-1', name: 'Before' } }],
    views: [{ id: 'view-1', name: 'Team view' }],
    storage_config: { apiKey: 'do-not-migrate-settings' },
    sharing_backend_config: { apiKey: 'do-not-migrate-credentials' },
    notification_integrations: [{ apiKey: 'do-not-migrate-notification-key' }]
  };
}

test('BRIDGE explicit legacy migration includes project dependencies and history in one SQLite transaction, retains originals', async t => {
  const { service } = await setup(t), h = browser(service, legacyFixture());
  const before = [...h.values];
  const preview = await h.api.previewLegacy({ includeVersions: true });
  assert.equal(preview.valid, true); assert.equal(preview.alreadyMigrated, false);
  for (const collection of ['suites', 'datasets', 'environments', 'pipelines', 'unit-tests', 'baselines', 'history', 'comments', 'versions', 'views']) assert.ok(preview.counts[collection] >= 1, collection);
  assert.equal(JSON.stringify(preview).includes('do-not-migrate'), false);
  assert.equal(preview.omittedCredentialFields, 4, 'All four original secrets, including preserved connection drafts, are excluded');
  const result = await h.api.migrateLegacy({ includeVersions: true, expectedFingerprint: preview.sourceFingerprint });
  assert.equal(result.originalsRetained, true);
  const transactions = h.calls.filter(call => call.action === 'transact');
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].payload.records.at(-1).collection, 'migrations');
  assert.deepEqual([...h.values], before);
  const archive = await service.handle('backup');
  const importedSettings=archive.payload.records.filter(record=>record.collection==='legacy-config');
  for(const key of ['storage_config','sharing_backend_config','notification_integrations'])assert.ok(importedSettings.some(record=>record.value.key===key&&record.value.applyRequired),'Preserved explicit-review settings '+key);
  assert.equal(JSON.stringify(importedSettings).includes('do-not-migrate'),false);
  assert.equal((await service.handle('previewImport', { archive })).valid, true);
  assert.equal(archive.payload.records.some(record => record.collection === 'baselines'), true);
  assert.equal(archive.payload.records.find(record => record.collection === 'suites').value.dependencies[0].id, 'data-1');
  assert.equal((await h.api.migrateLegacy({ includeVersions: true })).alreadyMigrated, true);
  assert.equal(h.calls.filter(call => call.action === 'transact').length, 1);
});

test('BRIDGE quota/abort never commits partial records or migration marker and safe retry is idempotent', async t => {
  const f = await setup(t), h = browser(f.service, { pipeline_test_suites: [{ id: 'one', name: 'one' }], test_data_sets: [{ id: 'data', data: [{ n: 1 }] }] });
  const original = h.context.electronAPI.studioOps.invoke;
  let fail = true;
  h.context.electronAPI.studioOps.invoke = async (domain, action, payload) => {
    if (action === 'transact' && fail) return { __lvxError: { code: 'ABORTED', message: 'Injected failure before SQLite transaction' } };
    return original(domain, action, payload);
  };
  await assert.rejects(h.api.migrateLegacy({ includeVersions: false }), { code: 'ABORTED' });
  assert.equal((await f.service.handle('list')).records.length, 0);
  fail = false;
  await h.api.migrateLegacy({ includeVersions: false });
  const count = (await f.service.handle('list')).records.length;
  await h.api.migrateLegacy({ includeVersions: false });
  assert.equal((await f.service.handle('list')).records.length, count);
  const low = await setup(t, { quotaBytes: 20 });
  const tiny = browser(low.service, { pipeline_test_suites: [{ id: 'one', name: 'long enough to exceed the quota' }] });
  await assert.rejects(tiny.api.migrateLegacy({ includeVersions: false }), { code: 'QUOTA' });
  assert.equal((await low.service.handle('list')).records.length, 0);
});

test('BRIDGE lost response after COMMIT is recovered by the durable marker without duplicating data', async t => {
  const { service } = await setup(t), h = browser(service, { pipeline_test_suites: [{ id: 'one', name: 'one' }] });
  const original = h.context.electronAPI.studioOps.invoke;
  let lost = true;
  h.context.electronAPI.studioOps.invoke = async (...args) => {
    const result = await original(...args);
    if (args[1] === 'transact' && lost) { lost = false; throw new Error('response channel closed after commit'); }
    return result;
  };
  await assert.rejects(h.api.migrateLegacy({ includeVersions: false }), /response channel/);
  const retry = await h.api.migrateLegacy({ includeVersions: false });
  assert.equal(retry.alreadyMigrated, true);
  assert.equal((await service.handle('list')).records.length, 2);
});

test('BRIDGE concurrent migration attempts share one committed marker and never duplicate the snapshot', async t => {
  const { service } = await setup(t);
  const one = browser(service, { pipeline_test_suites: [{ id: 'one', name: 'same source' }] });
  const two = browser(service, { pipeline_test_suites: [{ id: 'one', name: 'same source' }] });
  const results = await Promise.all([one.api.migrateLegacy({ includeVersions: false }), two.api.migrateLegacy({ includeVersions: false })]);
  assert.equal(results.every(result => result.status === 'SUCCESS'), true);
  assert.equal(results.filter(result => result.alreadyMigrated).length, 1);
  assert.equal((await service.handle('list', { collection: 'migrations' })).records.length, 1);
  assert.equal((await service.handle('list', { collection: 'suites' })).records.length, 1);
});

test('BRIDGE invalid or changed legacy input and differing desktop edits never get silently overwritten', async t => {
  const { service } = await setup(t), h = browser(service, { pipeline_test_suites: [{ id: 'one', name: 'original' }] });
  const preview = await h.api.previewLegacy({ includeVersions: false });
  h.values.set('pipeline_test_suites', JSON.stringify([{ id: 'one', name: 'changed' }]));
  await assert.rejects(h.api.migrateLegacy({ includeVersions: false, expectedFingerprint: preview.sourceFingerprint }), { code: 'SOURCE_CHANGED' });
  assert.equal((await service.handle('list')).records.length, 0);
  await service.handle('transact', { records: [{ collection: 'suites', id: 'one', value: { id: 'one', name: 'desktop edited' }, expectedRevision: null }] });
  assert.equal((await h.api.previewLegacy({ includeVersions: false })).valid, false);
  await assert.rejects(h.api.migrateLegacy({ includeVersions: false }), { code: 'MIGRATION_INVALID' });
  h.values.set('pipeline_test_suites', '{broken json');
  assert.equal((await h.api.previewLegacy({ includeVersions: false })).valid, false);
  assert.equal((await service.handle('list')).records.length, 1);
});

function idbDatabase(records, { abort = false } = {}) {
  const stats = { transactions: 0, closed: 0 };
  return { stats, objectStoreNames: { contains: name => name === 'version_histories' }, close() { stats.closed++; }, transaction(names, mode) {
    assert.deepEqual(Array.from(names), ['version_histories']); assert.equal(mode, 'readonly'); stats.transactions++;
    let aborted = false;
    const tx = { abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); }, objectStore() { return { openCursor() {
      const request = {}; let index = 0;
      const next = () => queueMicrotask(() => {
        if (aborted) return;
        request.result = index < records.length ? { value: structuredClone(records[index++]), continue: next } : null;
        request.onsuccess?.();
        if (request.result === null) queueMicrotask(() => { if (abort) tx.onabort?.(); else tx.oncomplete?.(); });
      });
      next(); return request;
    } }; } };
    return tx;
  } };
}

test('BRIDGE IndexedDB versions are read only after transaction commit and merged without replacing local originals', async t => {
  const { service } = await setup(t);
  const version = { versionId: 'committed-version', suiteSnapshot: { name: 'old committed' } };
  const db = idbDatabase([{ suiteId: 'one', versions: [version] }]);
  const h = browser(service, { pipeline_test_suites: [{ id: 'one', name: 'one' }], 'suite_versions_one': [{ versionId: 'local-version', suiteSnapshot: { name: 'old local' } }] }, { indexedDBVersionControl: { ready: Promise.resolve(true), storage: { db } } });
  const preview = await h.api.previewLegacy({ includeVersions: true });
  assert.equal(preview.versionCoverage, 'complete'); assert.equal(preview.counts.versions, 2);
  await h.api.migrateLegacy({ includeVersions: true });
  assert.equal((await service.handle('list', { collection: 'versions' })).records.length, 2);
  assert.ok(db.stats.transactions >= 2); assert.equal(db.stats.closed, 0);
  const aborted = idbDatabase([{ suiteId: 'one', versions: [version] }], { abort: true });
  const broken = browser(service, {}, { indexedDBVersionControl: { storage: { db: aborted } } });
  await assert.rejects(broken.api.previewLegacy({ includeVersions: true }), { code: 'VERSION_READ' });
});

test('BRIDGE existing IndexedDB discovery never creates a missing database and reports uninspectable coverage', async t => {
  const { service } = await setup(t);
  let opens = 0;
  const absent = browser(service, {}, { indexedDB: { databases: async () => [], open() { opens++; throw new Error(); } } });
  assert.equal((await absent.api.previewLegacy()).versionCoverage, 'absent'); assert.equal(opens, 0);
  const unsupported = browser(service, {}, { indexedDB: { open() { opens++; } } });
  await assert.rejects(unsupported.api.previewLegacy(), { code: 'VERSION_COVERAGE' });
  assert.equal(opens, 0);
});

test('BRIDGE version cursor beyond the former ceiling migrates every record atomically', async t => {
  const { service } = await setup(t);
  const db = idbDatabase([{ suiteId: 'one', versions: Array.from({ length: 10000 }, (_, i) => ({ versionId: `version-${i}` })) }]);
  const h = browser(service, { pipeline_test_suites: [{ id: 'one', name: 'one' }] }, { indexedDBVersionControl: { storage: { db } } });
  await h.api.migrateLegacy({ includeVersions: true });
  const records = (await service.handle('list', { collection: 'versions' })).records;
  assert.equal(records.length, 10000);
  assert.equal(records.filter(record => record.value.versionId === 'version-9999').length, 1);
  assert.equal((await service.handle('list', { collection: 'suites' })).records.length, 1);
});

test('BRIDGE portable archive restore uses reviewed revision and does not rewrite browser originals', async t => {
  const { service } = await setup(t), h = browser(service, { pipeline_test_suites: [{ id: 'one', name: 'one' }] });
  await h.api.migrateLegacy({ includeVersions: false });
  const archive = await h.api.backup();
  const preview = await h.api.previewArchive(archive);
  await h.api.restoreArchive(archive, { mode: 'replace', expectedWorkspaceRevision: preview.revision });
  assert.equal((await service.handle('list', { collection: 'suites' })).records.length, 1);
  assert.equal(h.values.get('pipeline_test_suites'), JSON.stringify([{ id: 'one', name: 'one' }]));
});

test('BRIDGE anonymous duplicate records and unsupported IDs remain complete and dependency references are remapped', async t => {
  const { service } = await setup(t);
  const h = browser(service, {
    pipeline_test_suites: [{ id: 'suite with spaces', name: 'Original id retained', dataSetId: 'data with spaces' }],
    test_data_sets: [{ id: 'data with spaces', data: [{ n: 0 }] }],
    test_execution_history: [{ status: 'SUCCESS' }, { status: 'SUCCESS' }],
    test_environments: [{ id: 'env', variables: { OPENAI_API_KEY: 'secret-value', DB_PASSWORD: 'other-secret-value', secretReference: 'secret:valid' } }]
  });
  const preview = await h.api.previewLegacy({ includeVersions: false });
  assert.equal(preview.valid, true); assert.equal(preview.counts.history, 2);
  assert.equal(JSON.stringify(preview).includes('secret-value'), false);
  assert.equal(JSON.stringify(preview).includes('secret:valid'), true);
  await h.api.migrateLegacy({ includeVersions: false });
  const suite = (await service.handle('list', { collection: 'suites' })).records[0];
  const data = (await service.handle('list', { collection: 'datasets' })).records[0];
  assert.equal(suite.value.legacyOriginalId, 'suite with spaces');
  assert.equal(suite.value.dataSetId, data.id);
  const archive = await service.handle('backup');
  assert.equal((await service.handle('previewImport', { archive })).valid, true);
});

test('BRIDGE malformed declared dependency or duplicate ID prevents partial legacy import', async t => {
  const { service } = await setup(t);
  const h = browser(service, { pipeline_test_suites: [{ id: 'one', dependencies: [{ collection: 'datasets', id: 'absent' }] }] });
  assert.equal((await h.api.previewLegacy({ includeVersions: false })).valid, false);
  await assert.rejects(h.api.migrateLegacy({ includeVersions: false }), { code: 'MIGRATION_INVALID' });
  h.values.set('pipeline_test_suites', JSON.stringify([{ id: 'same', name: 'A' }, { id: 'same', name: 'B' }]));
  assert.equal((await h.api.previewLegacy({ includeVersions: false })).valid, false);
  assert.equal((await service.handle('list')).records.length, 0);
});

test('BRIDGE a successful background status write keeps an open editor protected from later external edits', async t => {
  const { service } = await setup(t);
  const one = browser(service).api.createBackend(), two = browser(service).api.createBackend();
  t.after(() => { one.dispose(); two.dispose(); });
  await one.saveSuite({ id: 'one', name: 'original' });
  await one.beginEdit('one');
  await one.updateSuite('one', { last_run_status: 'SUCCESS' });
  await two.getAllSuites(); await two.updateSuite('one', { name: 'external edit' });
  await one.getAllSuites();
  await assert.rejects(one.updateSuite('one', { name: 'unsaved editor value' }), { code: 'CONFLICT' });
});

test('BRIDGE actual Chromium IndexedDB transaction and browser localStorage migrate into real SQLite', { timeout: 30000 }, async t => {
  const f = await setup(t);
  const playwright = require('playwright');
  const bundled = path.resolve(__dirname, '../.external/playwright-browsers');
  const browserFolders = fs.readdirSync(bundled).filter(name => /^chromium-\d+$/.test(name)).sort().reverse();
  const executable = browserFolders.map(name => path.join(bundled, name, process.platform === 'win32' ? 'chrome-win64/chrome.exe' : 'chrome-linux/chrome')).find(file => fs.existsSync(file));
  assert.ok(executable, 'Pinned Chromium payload must be installed before browser verification.');
  const server = http.createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Storage bridge integration</title>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const chromium = await playwright.chromium.launch({ executablePath: executable, headless: true });
  t.after(() => chromium.close());
  const page = await chromium.newPage();
  await page.exposeFunction('__workspaceCall', async (action, payload) => {
    try { return await f.service.handle(action, payload); }
    catch (error) { return { __lvxError: { code: error.code, message: error.message, details: error.details } }; }
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    window.electronAPI = { studioOps: { invoke: (_domain, action, payload) => window.__workspaceCall(action, payload) } };
    localStorage.setItem('pipeline_test_suites', JSON.stringify([{ id: 'browser-suite', name: 'Actual browser source' }]));
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('LVX_Machina_Versions', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('version_histories', { keyPath: 'suiteId' });
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(['version_histories'], 'readwrite');
      transaction.objectStore('version_histories').put({ suiteId: 'browser-suite', versions: [{ versionId: 'browser-version', timestamp: '2026-10-24', suiteSnapshot: { id: 'browser-suite', name: 'Actual IndexedDB snapshot' } }] });
      transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  });
  await page.addScriptTag({ path: path.resolve(__dirname, '../studio-storage.js') });
  const result = await page.evaluate(async () => {
    const preview = await window.LVXWorkspaceBridge.previewLegacy({ includeVersions: true });
    const committed = await window.LVXWorkspaceBridge.migrateLegacy({ includeVersions: true, expectedFingerprint: preview.sourceFingerprint });
    return { preview, committed, original: localStorage.getItem('pipeline_test_suites') };
  });
  assert.equal(result.preview.versionCoverage, 'complete'); assert.equal(result.preview.counts.versions, 1);
  assert.equal(result.committed.status, 'SUCCESS'); assert.ok(result.original.includes('Actual browser source'));
  const versions = await f.service.handle('list', { collection: 'versions' });
  assert.equal(versions.records[0].value.suiteSnapshot.name, 'Actual IndexedDB snapshot');
});
