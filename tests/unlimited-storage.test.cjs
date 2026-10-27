'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { webcrypto, randomUUID } = require('node:crypto');
const { Store, sha256, decodeBase64 } = require('../services/workspace/store.cjs');
const { exportArchive, verifyArchive, importArchive } = require('../services/workspace/archive.cjs');
const { createMachinaWorkspace, normalizePolicy } = require('../services/workspace/machina.cjs');
const { createRetentionService, normalizePreferences } = require('../services/workspace/retention.cjs');
const { putArtifact, readArtifact } = require('../services/workspace/artifacts.cjs');
const { createTeam } = require('../services/workspace/team.cjs');
const { validatePayload, preparePreviewHtml, assertScopedPath } = require('../services/security/boundaries.cjs');
const legacy = require('../legacy-importer.js');
const MiB = 1024 * 1024;

// These isolated SQLite files and session/log files are LVX-managed runtime
// state. Folder JSON files below are deliberately generated test fixtures, never
// copies of user projects or portable user saves. Everything is removed on exit.
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-unlimited-storage-'));
  const workspaceRoot = path.join(root, 'project'), dataDir = path.join(root, 'runtime');
  fs.mkdirSync(workspaceRoot);
  const store = new Store(path.join(dataDir, 'workspace.sqlite'), options);
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, workspaceRoot, dataDir, store };
}
const record = (id, value = {}) => ({ collection: 'suites', id, value, expectedRevision: null });

test('uncapped bridge validates over 16 MiB and 40,000 nesting levels while rejecting unsafe data', () => {
  const text = 'x'.repeat(16 * MiB + 1);
  assert.equal(validatePayload({ text }).text.length, text.length);
  const deep = {}; let cursor = deep;
  for (let i = 0; i < 40000; i++) { cursor.child = {}; cursor = cursor.child; }
  assert.equal(validatePayload(deep), deep);
  const shared = { safe: true };
  assert.doesNotThrow(() => validatePayload({ a: shared, b: shared }));
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => validatePayload(cyclic), /cycles/);
  for (const value of [Infinity, NaN, undefined, 1n, new Date(), new Map(), () => {}]) assert.throws(() => validatePayload(value));
  assert.throws(() => validatePayload(JSON.parse('{"__proto__":{"polluted":true}}')), /Unsafe/);
  assert.throws(() => validatePayload({ constructor: 'unsafe' }), /Unsafe/);
  let invoked = false;
  const getter = Object.defineProperty({}, 'danger', { enumerable: true, get() { invoked = true; return 1; } });
  assert.throws(() => validatePayload(getter), /plain/); assert.equal(invoked, false);
  assert.throws(() => validatePayload({ [Symbol('unsafe')]: true }), /plain/);
  assert.equal({}.polluted, undefined);
});

test('workspace stores over 512 MiB without a default quota; explicit byte budgets still roll back', t => {
  const f = fixture(t);
  assert.equal(f.store.usage().quotaBytes, 0);
  const insert = f.store.db.prepare('INSERT INTO artifacts VALUES(?,?,?,?,zeroblob(?),?,?)');
  f.store.transaction(() => {
    for (let i = 0; i < 17; i++) insert.run(`large-${i}`, 'large-run', 'generated blob', 'application/octet-stream', 32 * MiB, 'fixture', new Date().toISOString());
  });
  assert.ok(f.store.usage().totalBytes > 512 * MiB);
  f.store.transact([record('after-former-quota', { preserved: true })]);
  assert.equal(f.store.read('suites', 'after-former-quota').value.preserved, true);
  const bounded = new Store(path.join(f.dataDir, 'explicit.sqlite'), { quotaBytes: 20 });
  try {
    assert.throws(() => bounded.transact([record('too-large', { text: 'x'.repeat(100) })]), { code: 'QUOTA' });
    assert.equal(bounded.read('suites', 'too-large'), null); assert.equal(bounded.revision(), 0);
  } finally { bounded.close(); }
  for (const quotaBytes of [-1, Infinity, NaN, 1.5]) assert.throws(() => new Store(path.join(f.dataDir, 'invalid.sqlite'), { quotaBytes }), { code: 'VALIDATION' });
});

test('transactions and verified archives cross 10,000 records and artifacts and preserve atomic integrity', t => {
  const source = fixture(t), target = fixture(t);
  const rows = Array.from({ length: 10001 }, (_, i) => record(`record-${i}`, { index: i }));
  source.store.transact(rows);
  const insert = source.store.db.prepare('INSERT INTO artifacts VALUES(?,?,?,?,?,?,?)');
  const data = Buffer.from('test evidence');
  source.store.transaction(() => { for (let i = 0; i < 10001; i++) insert.run(`artifact-${i}`, 'run', `evidence-${i}`, 'text/plain', data, sha256(data), new Date().toISOString()); });
  const archive = exportArchive(source.store);
  assert.equal(archive.payload.records.length, 10001); assert.equal(archive.payload.artifacts.length, 10001);
  assert.equal(verifyArchive(archive).valid, true);
  assert.equal(importArchive(target.store, archive, { expectedWorkspaceRevision: 0 }).importedRecords, 10001);
  assert.equal(target.store.list().records.length, 10001);
  assert.equal(target.store.db.prepare('SELECT count(*) AS n FROM artifacts').get().n, 10001);
  archive.payload.records[0].value.index = -1;
  assert.equal(verifyArchive(archive).valid, false);
  const before = target.store.revision();
  assert.throws(() => importArchive(target.store, archive, { mode: 'replace', expectedWorkspaceRevision: before }), { code: 'ARCHIVE_INVALID' });
  assert.equal(target.store.list().records.length, 10001); assert.equal(target.store.revision(), before);
  assert.throws(() => target.store.transact([record('rollback-a'), { ...record('record-1'), expectedRevision: null }]), { code: 'CONFLICT' });
  assert.equal(target.store.read('suites', 'rollback-a'), null);
  const identifier = 'identifier-'.repeat(50);
  target.store.transact([record(identifier)]); assert.equal(target.store.read('suites', identifier).id, identifier);
});

test('artifacts over 96 MiB and session archives over 128 MiB round-trip without losing checksums', async t => {
  const f = fixture(t), service = createMachinaWorkspace(f);
  const data = Buffer.alloc(97 * MiB, 0x41), dataBase64 = data.toString('base64');
  assert.equal(decodeBase64(dataBase64).length, data.length);
  const saved = putArtifact(f.store, { runId: 'big-evidence', name: 'e'.repeat(501), mimeType: 'application/octet-stream', dataBase64 });
  const read = readArtifact(f.store, { id: saved.artifact.id });
  assert.equal(read.checksum, sha256(data)); assert.equal(read.dataBase64, dataBase64);
  const session = await service.handle('saveSession');
  assert.ok(session.sizeBytes > 128 * MiB);
  const loaded = await service.handle('readSession', { id: session.id });
  assert.equal(loaded.validation.valid, true); assert.equal(loaded.archive.payload.artifacts[0].checksum, saved.artifact.checksum);
  for (const invalid of ['a', 'AA', 'AA==\n', '!!==', 'AB==']) assert.throws(() => decodeBase64(invalid), { code: 'VALIDATION' });
  assert.throws(() => decodeBase64('AAAA', 2), /budget/);
  f.store.db.prepare('UPDATE artifacts SET checksum=? WHERE id=?').run('corrupt', saved.artifact.id);
  assert.throws(() => readArtifact(f.store, { id: saved.artifact.id }), { code: 'CORRUPT_ARTIFACT' });
  await assert.rejects(service.handle('readSession', { id: '../escape' }), { code: 'VALIDATION' });
  service.close();
});

test('legacy imports cross folder/depth/10 MiB/50 MiB/10,000-record limits and remain revision-safe', async t => {
  const f = fixture(t), service = createMachinaWorkspace(f);
  const folder = path.join(f.workspaceRoot, 'fixtures'); fs.mkdirSync(folder);
  for (let i = 0; i < 501; i++) fs.writeFileSync(path.join(folder, `${i}.json`), '{}');
  const nested = path.join(folder, ...Array(15).fill('nested')); fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'deep.json'), '{}');
  assert.equal(legacy.collectLegacyImportFiles(folder).length, 502);
  assert.throws(() => legacy.collectLegacyImportFiles(folder, { maxFiles: 500 }), /budget/);
  assert.throws(() => legacy.collectLegacyImportFiles(folder, { maxDepth: 12 }), /budget/);
  assert.throws(() => legacy.collectLegacyImportFiles(folder, { maxFiles: -1 }), /budgets/);
  let wrapped = { suites: [{ id: 'deep', name: 'Nested suite', code: 'true' }] };
  for (let i = 0; i < 80; i++) wrapped = { state: wrapped };
  assert.equal(legacy.extractImportPayload(wrapped).suites.length, 1);
  const suites = Array.from({ length: 10001 }, (_, i) => ({ id: `legacy-${i}`, name: `Legacy ${i}`, code: 'true' }));
  suites[0].code = 'x'.repeat(51 * MiB);
  const preview = await service.handle('previewLegacyImport', { content: { suites } });
  assert.equal(preview.valid, true); assert.equal(preview.recordCount, suites.length);
  assert.equal(f.store.list().records.length, 0);
  const imported = await service.handle('importLegacy', { token: preview.token, expectedWorkspaceRevision: preview.revision });
  assert.equal(imported.importedRecords, suites.length);
  assert.equal(f.store.read('suites', 'legacy-0').value.code.length, 51 * MiB);
  assert.equal(f.store.read('suites', 'legacy-10000').value.requiresTrustReview, true);
  const stale = await service.handle('previewLegacyImport', { content: { suites: [{ name: 'Stale', code: 'true' }] } });
  f.store.transact([record('newer-change')]);
  await assert.rejects(service.handle('importLegacy', { token: stale.token, expectedWorkspaceRevision: stale.revision }), { code: 'CONFLICT' });
  const invalid = await service.handle('previewLegacyImport', { content: 'invalid JSON' });
  assert.equal(invalid.valid, false);
  await assert.rejects(service.handle('previewLegacyImport', { path: '../outside.json' }), { code: 'PATH_SCOPE' });
  service.close();
});

test('retention defaults preserve all history and explicit unbounded policies retain complete receipts', async t => {
  const f = fixture(t), service = createRetentionService(f);
  const rows = Array.from({ length: 1001 }, (_, i) => ({ collection: 'runs', id: `old-${i}`, expectedRevision: null, value: { timestamp: '2000-01-01', status: 'SUCCESS' } }));
  f.store.transact(rows);
  assert.equal(normalizePreferences().mode, 'unlimited');
  assert.equal(normalizePolicy().mode, 'unlimited');
  assert.equal((await service.handle('autoCleanup')).deletedCount, 0);
  assert.equal(f.store.list('runs').records.length, 1001);
  const preferences = { mode: 'custom', showWarningAt: 100, customPolicies: { execution_history: { enabled: true, maxAgeDays: 1, maxEntries: 0 }, versions: { maxEntries: 1000001, maxAgeDays: 36501 } } };
  await service.handle('setPreferences', { preferences, expectedRevision: null });
  const oldestPreview = await service.handle('previewCleanup');
  for (let i = 0; i < 11; i++) await service.handle('previewCleanup');
  const removed = await service.handle('applyCleanup', { token: oldestPreview.token, expectedWorkspaceRevision: oldestPreview.revision });
  assert.equal(removed.deletedCount, 1001);
  const effects = f.store.read('storage-settings', 'retention-effects');
  f.store.transact([{ ...effects, expectedRevision: effects.revision, value: { ...effects.value, completed: Array.from({ length: 101 }, (_, i) => ({ id: `completed-${i}`, text: 'x'.repeat(22000) })) } }]);
  const warnings = Array.from({ length: 101 }, (_, i) => `${i}: ${'warning '.repeat(200)}`);
  await service.handle('acknowledgeEffects', { id: removed.effectReceiptId, result: { warnings } });
  const state = await service.handle('pendingEffects');
  assert.equal(state.completed.length, 102); assert.equal(state.completedPrunedCount, 0);
  assert.deepEqual(state.completed.at(-1).nativeEffects.warnings, warnings);
  assert.equal(state.completed.at(-1).truncated, false);
  assert.ok(Buffer.byteLength(JSON.stringify(state.completed)) > 2 * MiB);
  for (const maxEntries of [-1, Infinity, 1.1]) assert.throws(() => normalizePreferences({ customPolicies: { versions: { maxEntries } } }), { code: 'VALIDATION' });
  const policy = normalizePolicy({ mode: 'custom', sessionRetention: { maxExports: 1001 }, logRetention: { maxFiles: 10001, maxAgeDays: 36501, maxTotalSizeMB: 10001 } });
  assert.equal(policy.sessionRetention.maxExports, 1001); assert.equal(policy.logRetention.maxFiles, 10001);
  service.close();
});

test('saved-session and log retention preserve all by default and apply only caller-selected budgets', async t => {
  const f = fixture(t), service = createMachinaWorkspace(f);
  for (let i = 0; i < 7; i++) await service.handle('saveSession');
  for (let i = 0; i < 51; i++) await service.handle('appendLog', { value: { line: i } });
  const logs = await service.handle('appendLog', { content: 'x'.repeat(10 * MiB + 1) });
  assert.equal(logs.cleanup.logs.length, 52); assert.equal(logs.cleanup.deletedCount, 0);
  assert.equal((await service.handle('listSessions')).sessions.length, 7);
  const result = await service.handle('setRetention', { expectedRevision: null, policy: { mode: 'custom', sessionRetention: { maxExports: 2, enabled: true, keepForever: false }, logRetention: { enabled: true, maxFiles: 3, maxAgeDays: 0, maxTotalSizeMB: 0 } } });
  assert.equal(result.cleanup.deleteSessions.length, 5); assert.equal(result.cleanup.deleteLogs.length, 49);
  assert.equal((await service.handle('listSessions')).sessions.length, 2);
  service.close();
});

async function request(url, token, body, { abort = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, value: JSON.parse(Buffer.concat(chunks)) }));
    });
    req.on('error', error => abort ? resolve({ aborted: true }) : reject(error));
    if (abort) { req.write('{"records":['); setImmediate(() => req.destroy()); } else req.end(body);
  });
}

test('team API accepts requests over 2 MiB; aborts and unsafe JSON cannot alter stored data', async t => {
  const f = fixture(t), team = createTeam(f.store);
  t.after(() => team.stop());
  const started = await team.start({ workspaceId: 'test', ownerName: 'Owner '.repeat(50) });
  const url = `${started.url}/v1/workspaces/test/transact`;
  const body = JSON.stringify({ records: [record('large-team', { text: 'x'.repeat(2 * MiB + 1) })] });
  const result = await request(url, started.ownerToken, body);
  assert.equal(result.status, 200);
  assert.equal(f.store.list().records[0].value.text.length, 2 * MiB + 1);
  const revision = f.store.revision();
  assert.equal((await request(url, started.ownerToken, null, { abort: true })).aborted, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.store.revision(), revision);
  const unsafe = await request(url, started.ownerToken, '{"records":[],"__proto__":{"polluted":true}}');
  assert.equal(unsafe.status, 400); assert.equal(f.store.revision(), revision);
  const viewer = team.create({ name: 'viewer', role: 'viewer', workspaceId: 'test' });
  assert.equal((await request(url, viewer.token, body)).status, 403);
});

test('inline HTML previews accept over 8 MiB and retain sandbox policy and workspace path trust', t => {
  const f = fixture(t), html = '<p>test</p>' + ' '.repeat(8 * MiB + 1);
  const result = preparePreviewHtml(html);
  assert.ok(result.endsWith(html)); assert.match(result, /Content-Security-Policy/); assert.match(result, /frame-src 'none'/);
  assert.throws(() => preparePreviewHtml({ html }), /text/);
  assert.throws(() => assertScopedPath(f.workspaceRoot, '../outside', { mustExist: false }), /outside/);
});

function bridgeBrowser(service, initial, db) {
  const values = new Map(Object.entries(initial).map(([name, value]) => [name, JSON.stringify(value)]));
  const context = { TextEncoder, Uint8Array, crypto: webcrypto, console, indexedDBVersionControl: { storage: { db } },
    localStorage: { get length() { return values.size; }, key: i => [...values.keys()][i], getItem: name => values.get(name) ?? null },
    electronAPI: { studioOps: { invoke: async (_domain, action, payload) => service.handle(action, structuredClone(payload)) } } };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../studio-storage.js'), 'utf8'), context);
  return { api: context.LVXWorkspaceBridge, values };
}

function versionDatabase(versions, abort = false) {
  return { objectStoreNames: { contains: name => name === 'version_histories' }, transaction() {
    const tx = { objectStore() { return { openCursor() {
      const req = {};
      queueMicrotask(() => {
        req.result = { value: { suiteId: 'one', versions }, continue() { queueMicrotask(() => { req.result = null; req.onsuccess(); abort ? tx.onabort() : tx.oncomplete(); }); } };
        req.onsuccess();
      }); return req;
    } }; } }; return tx;
  } };
}

test('legacy browser migration captures over 9,999 versions and 32 MiB without touching originals', async t => {
  const f = fixture(t);
  const service = { async handle(action, p) {
    if (action === 'status') return { status: 'SUCCESS', workspaceRoot: f.workspaceRoot };
    if (action === 'list') return f.store.list(p?.collection);
    if (action === 'read') return f.store.read(p.collection, p.id);
    if (action === 'transact') return f.store.transact(p.records, { expectedWorkspaceRevision: p.expectedWorkspaceRevision });
    throw Error(`Unexpected bridge action ${action}`);
  } };
  const versions = Array.from({ length: 10000 }, (_, i) => ({ versionId: `v-${i}`, timestamp: '2026-01-01', suiteSnapshot: { name: 'Old suite', code: 'x'.repeat(1700) } }));
  assert.ok(Buffer.byteLength(JSON.stringify(versions), 'utf16le') > 32 * MiB);
  const browser = bridgeBrowser(service, { pipeline_test_suites: [{ id: 'one', name: 'One', code: 'true' }] }, versionDatabase(versions));
  const original = browser.values.get('pipeline_test_suites');
  const preview = await browser.api.previewLegacy();
  assert.equal(preview.valid, true); assert.equal(preview.counts.versions, 10000);
  const imported = await browser.api.migrateLegacy({ expectedFingerprint: preview.sourceFingerprint });
  assert.equal(imported.status, 'SUCCESS'); assert.equal(f.store.list('versions').records.length, 10000);
  assert.equal(browser.values.get('pipeline_test_suites'), original);
  const aborted = bridgeBrowser(service, {}, versionDatabase([], true));
  await assert.rejects(aborted.api.previewLegacy(), { code: 'VERSION_READ' });
});
