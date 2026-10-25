'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const { createService } = require('../services/workspace/index.cjs');
const { Store, sha256 } = require('../services/workspace/store.cjs');
const { csvRecords } = require('../services/workspace/datasets.cjs');

async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-workspace-'));
  const workspaceRoot = path.join(root, 'project'); fs.mkdirSync(workspaceRoot);
  const dataDir = path.join(root, 'private');
  const events = [];
  const args = { dataDir, workspaceRoot, emit: event => events.push(event), ...options };
  const service = createService(args);
  const instances = [service];
  t.after(async () => { for (const instance of instances) await instance.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, workspaceRoot, dataDir, service, events, reopen() { const instance = createService(args); instances.push(instance); return instance; } };
}
const newRecord = (id, value = { name: id }, collection = 'suites') => ({ collection, id, value, expectedRevision: null });

test('FW-19 SQLite transactions survive reopen and abort every record on error or quota', async t => {
  const f = await fixture(t, { quotaBytes: 120 });
  await f.service.handle('transact', { records: [newRecord('a'), newRecord('b')] });
  const first = await f.service.handle('read', { collection: 'suites', id: 'a' });
  await assert.rejects(f.service.handle('transact', { records: [{ ...newRecord('a', { changed: true }), expectedRevision: first.revision }, newRecord('large', { text: 'x'.repeat(500) })] }), { code: 'QUOTA' });
  assert.deepEqual((await f.service.handle('read', { collection: 'suites', id: 'a' })).value, { name: 'a' });
  assert.equal(await f.service.handle('read', { collection: 'suites', id: 'large' }), null);
  await assert.rejects(f.service.handle('transact', { records: [newRecord('c'), { ...newRecord('a'), expectedRevision: 99 }] }), { code: 'CONFLICT' });
  assert.equal(await f.service.handle('read', { collection: 'suites', id: 'c' }), null);
  const reopened = f.reopen();
  assert.equal((await reopened.handle('list')).records.length, 2);
  assert.equal(f.events.length, 1);
  assert.equal((await reopened.handle('status')).schemaVersion, 2);
});

test('FW-19 interrupted schema migration rolls back and an explicit abort is atomic', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'workspace.sqlite');
  assert.throws(() => new Store(file, { beforeMigration() { throw new Error('simulated interruption'); } }), { code: 'WORKSPACE_UNAVAILABLE' });
  const check = new DatabaseSync(file);
  assert.equal(check.prepare('PRAGMA user_version').get().user_version, 0);
  assert.equal(check.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='records'").get().n, 0);
  check.close();
  const store = new Store(file);
  try {
    assert.throws(() => store.transact([newRecord('aborted')], { failBeforeCommit: true }), { code: 'ABORTED' });
    assert.equal(store.list().records.length, 0);
    assert.equal(store.revision(), 0);
  } finally { store.close(); }
});

test('FW-19 actual process termination during a write or migration leaves no partial transaction', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-crash-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'workspace.sqlite');
  const modulePath = require.resolve('../services/workspace/store.cjs');
  const interrupted = spawnSync(process.execPath, ['-e', `const {Store}=require(${JSON.stringify(modulePath)}); new Store(${JSON.stringify(file)},{beforeMigration(){process.exit(17)}});`], { windowsHide: true });
  assert.equal(interrupted.status, 17);
  let store = new Store(file); store.transact([newRecord('kept')]); store.close();
  const writing = spawnSync(process.execPath, ['-e', `const {Store}=require(${JSON.stringify(modulePath)}); const s=new Store(${JSON.stringify(file)}); s.db.exec('BEGIN IMMEDIATE'); s.db.prepare('DELETE FROM records').run(); process.exit(18);`], { windowsHide: true });
  assert.equal(writing.status, 18);
  store = new Store(file);
  try { assert.equal(store.list().records[0].id, 'kept'); } finally { store.close(); }
});

test('FW-19 corrupt database fails closed and recovers a verified backup without deleting the original', async t => {
  const f = await fixture(t);
  await f.service.handle('transact', { records: [newRecord('kept')] });
  await f.service.handle('backup');
  await f.service.close();
  const subdir = fs.readdirSync(path.join(f.dataDir, 'workspaces'))[0];
  const file = path.join(f.dataDir, 'workspaces', subdir, 'workspace.sqlite');
  fs.writeFileSync(file, 'deliberately broken database');
  const broken = f.reopen();
  assert.equal((await broken.handle('status')).status, 'ERROR');
  await assert.rejects(broken.handle('list'), { code: 'WORKSPACE_UNAVAILABLE' });
  const result = await broken.handle('recover');
  assert.equal(result.recovered, true);
  assert.equal(fs.readFileSync(result.preservedDatabase, 'utf8'), 'deliberately broken database');
  assert.equal((await broken.handle('read', { collection: 'suites', id: 'kept' })).value.name, 'kept');
});

test('FW-19 workspace binding separates folders and rejects unavailable or unknown actions', async t => {
  const f = await fixture(t);
  await f.service.handle('transact', { records: [newRecord('first')] });
  const second = path.join(f.root, 'second'); fs.mkdirSync(second);
  await f.service.setWorkspace(second);
  assert.equal((await f.service.handle('list')).records.length, 0);
  await f.service.setWorkspace(f.workspaceRoot);
  assert.equal((await f.service.handle('list')).records.length, 1);
  await assert.rejects(f.service.setWorkspace(path.join(f.root, 'not-existing')), { code: 'VALIDATION' });
  assert.equal((await f.service.handle('list')).records.length, 1);
  await assert.rejects(f.service.handle('not-an-action'), { code: 'UNKNOWN_ACTION' });
  await f.service.setWorkspace(null);
  await assert.rejects(f.service.handle('list'), { code: 'WORKSPACE_REQUIRED' });
});

test('FW-20 independent connections reject stale changes and permit explicit merged saves', async t => {
  const f = await fixture(t);
  const second = f.reopen();
  await f.service.handle('transact', { records: [newRecord('shared', { title: 'original', description: 'original' })] });
  const a = await f.service.handle('read', { collection: 'suites', id: 'shared' });
  const b = await second.handle('read', { collection: 'suites', id: 'shared' });
  await f.service.handle('transact', { records: [{ ...a, value: { ...a.value, title: 'window A' }, expectedRevision: a.revision }] });
  let conflict;
  try { await second.handle('transact', { records: [{ ...b, value: { ...b.value, description: 'window B' }, expectedRevision: b.revision }] }); }
  catch (error) { conflict = error; }
  assert.equal(conflict.code, 'CONFLICT');
  assert.equal(conflict.details.current.value.title, 'window A');
  const latest = conflict.details.current;
  await second.handle('transact', { records: [{ ...latest, value: { ...latest.value, description: 'window B' }, expectedRevision: latest.revision }] });
  assert.deepEqual((await f.service.handle('read', { collection: 'suites', id: 'shared' })).value, { title: 'window A', description: 'window B' });
});

test('FW-20 deletion/recreation never reuses a revision and missing revision cannot bypass conflicts', async t => {
  const f = await fixture(t);
  await f.service.handle('transact', { records: [newRecord('same')] });
  const original = await f.service.handle('read', { collection: 'suites', id: 'same' });
  await f.service.handle('transact', { records: [{ ...original, expectedRevision: original.revision, delete: true }] });
  await f.service.handle('transact', { records: [newRecord('same', { new: true })] });
  await assert.rejects(f.service.handle('transact', { records: [{ ...original, expectedRevision: original.revision }] }), { code: 'CONFLICT' });
  await assert.rejects(f.service.handle('transact', { records: [{ collection: 'suites', id: 'same', value: {} }] }), { code: 'VALIDATION' });
});

test('FW-21 complete archive includes dependencies and binary evidence, redacts secrets, imports atomically', async t => {
  const f = await fixture(t, { redact: value => JSON.parse(JSON.stringify(value).replaceAll('very-private-value', '[REDACTED]')) });
  await f.service.handle('transact', { records: [newRecord('data', { rows: [{ count: 0 }] }, 'datasets'), newRecord('pipeline', { dependencies: [{ collection: 'datasets', id: 'data' }], apiKey: 'private-api-key', nested: { password: 'private-password', secretReference: 'secret:123' }, note: 'very-private-value' }, 'pipelines'), newRecord('secret', { ciphertext: 'never-export' }, 'credentials')] });
  const binary = Buffer.from([0, 255, 45, 129]);
  await f.service.handle('putArtifact', { runId: 'run-1', name: 'result.bin', dataBase64: binary.toString('base64') });
  const archive = await f.service.handle('backup');
  const serialized = JSON.stringify(archive);
  for (const secret of ['private-api-key', 'private-password', 'never-export', 'very-private-value']) assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes('secret:123'), true);
  const preview = await f.service.handle('previewImport', { archive });
  assert.equal(preview.valid, true); assert.equal(preview.records, 2); assert.equal(preview.artifacts, 1);
  await f.service.handle('import', { archive, mode: 'replace', expectedWorkspaceRevision: preview.revision });
  const stored = await f.service.handle('readArtifact', { id: archive.payload.artifacts[0].id });
  assert.deepEqual(Buffer.from(stored.dataBase64, 'base64'), binary);
  assert.equal((await f.service.handle('read', { collection: 'pipelines', id: 'pipeline' })).value.nested.secretReference, 'secret:123');
  const selected = await f.service.handle('backup', { recordIds: [{ collection: 'pipelines', id: 'pipeline' }] });
  assert.deepEqual(selected.payload.records.map(record => record.collection), ['datasets', 'pipelines']);
});

test('FW-21 tampering, missing dependencies and stale previews cannot change workspace state', async t => {
  const f = await fixture(t);
  await f.service.handle('transact', { records: [newRecord('existing')] });
  const archive = await f.service.handle('backup');
  const altered = structuredClone(archive); altered.payload.records[0].value.name = 'tampered';
  assert.equal((await f.service.handle('previewImport', { archive: altered })).valid, false);
  await assert.rejects(f.service.handle('import', { archive: altered, mode: 'replace', expectedWorkspaceRevision: 1 }), { code: 'ARCHIVE_INVALID' });
  const preview = await f.service.handle('previewImport', { archive });
  await f.service.handle('transact', { records: [newRecord('later')] });
  await assert.rejects(f.service.handle('import', { archive, mode: 'replace', expectedWorkspaceRevision: preview.revision }), { code: 'CONFLICT' });
  assert.equal((await f.service.handle('list')).records.length, 2);
  const missing = structuredClone(archive);
  missing.payload.records[0].value.dependencies = [{ collection: 'missing', id: 'absent' }];
  missing.manifest.payloadChecksum = sha256(JSON.stringify(missing.payload));
  assert.equal((await f.service.handle('previewImport', { archive: missing })).valid, false);
});

test('FW-21 import quota rolls back replace instead of deleting existing project data', async t => {
  const f = await fixture(t, { quotaBytes: 70 });
  await f.service.handle('transact', { records: [newRecord('kept')] });
  const archive = await f.service.handle('backup');
  archive.payload.records[0].value = { text: 'x'.repeat(200) };
  archive.manifest.payloadChecksum = sha256(JSON.stringify(archive.payload));
  const preview = await f.service.handle('previewImport', { archive });
  await assert.rejects(f.service.handle('import', { archive, mode: 'replace', expectedWorkspaceRevision: preview.revision }), { code: 'QUOTA' });
  assert.equal((await f.service.handle('read', { collection: 'suites', id: 'kept' })).value.name, 'kept');
});

test('FW-21 text evidence is redacted and sensitive binary evidence fails closed', async t => {
  const redact = value => JSON.parse(JSON.stringify(value).replaceAll('sensitive-known-value', '[REDACTED]'));
  const f = await fixture(t, { redact });
  await f.service.handle('putArtifact', { runId: 'run', name: 'output.log', mimeType: 'text/plain', dataBase64: Buffer.from('result sensitive-known-value').toString('base64') });
  const archive = await f.service.handle('backup');
  assert.equal(Buffer.from(archive.payload.artifacts[0].dataBase64, 'base64').toString().includes('sensitive-known-value'), false);
  await f.service.handle('putArtifact', { runId: 'run', name: 'binary.bin', dataBase64: Buffer.from('sensitive-known-value\0').toString('base64') });
  await assert.rejects(f.service.handle('backup'), { code: 'SECRET_ARTIFACT' });
  assert.equal((await f.service.handle('backup', { includeArtifacts: false })).payload.artifacts.length, 0);
});

test('FW-22 real HTTP team service enforces identity roles, tenant isolation and immediate revocation', async t => {
  const f = await fixture(t);
  const team = await f.service.handle('startTeam', { workspaceId: 'alpha' });
  assert.equal(team.sharing, 'loopback-only');
  const editor = await f.service.handle('createTeamIdentity', { name: 'Editor', role: 'editor' });
  const viewer = await f.service.handle('createTeamIdentity', { name: 'Viewer', role: 'viewer' });
  const other = await f.service.handle('createTeamIdentity', { name: 'Other tenant', role: 'editor', workspaceId: 'beta' });
  async function request(token, suffix, payload, tenant = 'alpha', origin) {
    const response = await fetch(`${team.url}/v1/workspaces/${tenant}/${suffix}`, { method: payload ? 'POST' : 'GET', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(payload ? { 'content-type': 'application/json' } : {}), ...(origin ? { origin } : {}) }, body: payload ? JSON.stringify(payload) : undefined });
    return { status: response.status, body: await response.json() };
  }
  assert.equal((await request(null, 'records')).status, 401);
  assert.equal((await request(viewer.token, 'transact', { records: [newRecord('not-allowed')] })).status, 403);
  assert.equal((await request(editor.token, 'transact', { records: [newRecord('shared')] })).status, 200);
  assert.equal((await request(viewer.token, 'records')).body.records[0].collection, 'suites');
  assert.equal((await request(other.token, 'records')).status, 403);
  assert.equal((await request(other.token, 'records', null, 'beta')).body.records.length, 0);
  assert.equal((await request(editor.token, 'identities', { name: 'Impersonation', role: 'owner' })).status, 403);
  assert.equal((await request(team.ownerToken, 'identities')).body.identities.length, 3);
  assert.equal((await request(team.ownerToken, 'revoke', { id: editor.identity.id })).status, 200);
  assert.equal((await request(editor.token, 'records')).status, 401);
  assert.equal((await request(viewer.token, 'records', null, 'alpha', 'https://evil.example')).status, 403);
  const archive = JSON.stringify(await f.service.handle('backup'));
  for (const token of [team.ownerToken, editor.token, viewer.token]) assert.equal(archive.includes(token), false);
  assert.equal((await f.service.handle('listTeamIdentities')).identities.find(user => user.id === editor.identity.id).revoked, true);
});

test('FW-22 concurrent HTTP editors receive one success and one conflict, not a lost update', async t => {
  const f = await fixture(t);
  const team = await f.service.handle('startTeam');
  const send = async records => { const response = await fetch(`${team.url}/v1/workspaces/default/transact`, { method: 'POST', headers: { authorization: `Bearer ${team.ownerToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ records }) }); return { status: response.status, body: await response.json() }; };
  const first = await send([newRecord('shared')]);
  const revision = first.body.changes[0].revision;
  const results = await Promise.all([send([{ ...newRecord('shared', { edit: 'A' }), expectedRevision: revision }]), send([{ ...newRecord('shared', { edit: 'B' }), expectedRevision: revision }])]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  await assert.rejects(f.service.handle('revokeTeamIdentity', { id: team.owner.id }), { code: 'LAST_OWNER' });
  await f.service.handle('stopTeam');
  assert.equal((await f.service.handle('teamStatus')).running, false);
});

test('FW-23 binary artifacts survive reopen; retention previews changes and never deletes pinned runs', async t => {
  const f = await fixture(t);
  const a = await f.service.handle('putArtifact', { runId: 'pinned', name: 'keep.bin', dataBase64: Buffer.from('1234567890').toString('base64') });
  await f.service.handle('putArtifact', { runId: 'discard', name: 'discard.bin', dataBase64: Buffer.from('abcdefghij').toString('base64') });
  await f.service.handle('pinArtifact', { runId: 'pinned', pinned: true });
  const reopened = f.reopen();
  assert.equal((await reopened.handle('readArtifact', { id: a.artifact.id })).dataBase64, Buffer.from('1234567890').toString('base64'));
  const preview = await reopened.handle('retention', { maxBytes: 0 });
  assert.equal(preview.dryRun, true); assert.equal(preview.removed.length, 1); assert.equal(preview.limitBlockedByPinned, true);
  assert.equal((await reopened.handle('artifacts')).artifacts.length, 2);
  await reopened.handle('retention', { maxBytes: 0, dryRun: false });
  const remaining = await reopened.handle('artifacts');
  assert.equal(remaining.artifacts.length, 1); assert.equal(remaining.artifacts[0].runId, 'pinned');
  assert.equal(remaining.artifactBytes, 10); assert.ok(remaining.diskBytes > 0);
});

test('FW-23 invalid artifact or quota does not leave partial blobs and corrupted evidence fails checksum', async t => {
  const f = await fixture(t, { quotaBytes: 8 });
  await assert.rejects(f.service.handle('putArtifact', { runId: 'run', name: 'bad', dataBase64: 'not base64' }), { code: 'VALIDATION' });
  await assert.rejects(f.service.handle('putArtifact', { runId: 'run', name: 'large', dataBase64: Buffer.from('0123456789').toString('base64') }), { code: 'QUOTA' });
  assert.equal((await f.service.handle('artifacts')).artifacts.length, 0);
  await assert.rejects(f.service.handle('readArtifact', { id: 'missing' }), { code: 'NOT_FOUND' });
  const added = await f.service.handle('putArtifact', { runId: 'run', name: 'small', dataBase64: Buffer.from('ok').toString('base64') });
  const directory = fs.readdirSync(path.join(f.dataDir, 'workspaces'))[0];
  const connection = new DatabaseSync(path.join(f.dataDir, 'workspaces', directory, 'workspace.sqlite'));
  connection.prepare('UPDATE artifacts SET data=? WHERE id=?').run(Buffer.from('bad'), added.artifact.id); connection.close();
  await assert.rejects(f.service.handle('readArtifact', { id: added.artifact.id }), { code: 'CORRUPT_ARTIFACT' });
});

test('FW-23 multi-megabyte binary evidence validates without a repeated-group regex and round-trips exactly', async t => {
  const f = await fixture(t);
  const binary = Buffer.alloc(2 * 1024 * 1024, 0xa7);
  const added = await f.service.handle('putArtifact', { runId: 'large-run', name: 'capture.bin', dataBase64: binary.toString('base64') });
  assert.equal(added.artifact.bytes, binary.length);
  assert.deepEqual(Buffer.from((await f.service.handle('readArtifact', { id: added.artifact.id })).dataBase64, 'base64'), binary);
  const archive = await f.service.handle('backup');
  assert.equal((await f.service.handle('previewImport', { archive })).valid, true);
});

test('FW-24 typed validation reports row-level required/type/range errors, retaining zero and false', async t => {
  const f = await fixture(t);
  const schema = [{ name: 'age', type: 'integer', required: true, min: 0, max: 100 }, { name: 'active', type: 'boolean', required: true }, { name: 'date', type: 'date' }];
  const result = await f.service.handle('validateDataset', { schema, rows: [{ age: 0, active: false, date: '2024-02-29' }, { age: -1, active: 'yes', date: '2024-02-30' }, { age: '', active: true }], maxErrors: 2 });
  assert.equal(result.totalRows, 3); assert.equal(result.validRows, 1); assert.equal(result.invalidRows, 2); assert.equal(result.errorCount, 4); assert.equal(result.errorsTruncated, true);
  assert.equal(result.errors[0].row, 2); assert.equal(result.errors[0].column, 'age');
  assert.equal((await f.service.handle('validateDataset', { schema, rows: [] })).status, 'FAILURE');
});

test('FW-24 CSV streaming handles UTF-8 and quoted multiline records at one-byte chunk boundaries', async () => {
  const bytes = Buffer.from('\uFEFFname,value\r\n"Åsa\nA","a""b"\r\nZero,0\r\n');
  const chunks = Array.from(bytes, byte => Buffer.from([byte]));
  const records = [];
  for await (const record of csvRecords(chunks)) records.push(record);
  assert.deepEqual(records, [['name', 'value'], ['Åsa\nA', 'a"b'], ['Zero', '0']]);
  await assert.rejects(async () => { for await (const row of csvRecords([Buffer.from('a,b\n"never closed')])) void row; }, { code: 'CSV_INVALID' });
});

test('FW-24 large workspace CSV validates with bounded previews and rejects workspace escapes', async t => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.workspaceRoot, 'large.csv'), 'id,active\n' + Array.from({ length: 40000 }, (_, i) => `${i},${i % 2 ? 'true' : 'false'}`).join('\n'));
  const result = await f.service.handle('validateDataset', { filePath: 'large.csv', schema: [{ name: 'id', type: 'integer', min: 0 }, { name: 'active', type: 'boolean' }], sampleSize: 3 });
  assert.equal(result.status, 'SUCCESS'); assert.equal(result.totalRows, 40000); assert.equal(result.sample.length, 3); assert.equal(result.streamed, true);
  fs.writeFileSync(path.join(f.root, 'outside.csv'), 'id\n1');
  await assert.rejects(f.service.handle('validateDataset', { filePath: '../outside.csv', schema: [{ name: 'id', type: 'integer' }] }), { code: 'PATH_SCOPE' });
});

test('FW-24 synthetic data is repeatable and schema-valid; masking is explicit, consistent and non-mutating', async t => {
  const f = await fixture(t);
  const schema = [{ name: 'id', type: 'integer', min: 1, max: 3 }, { name: 'email', type: 'email' }, { name: 'active', type: 'boolean' }];
  const a = await f.service.handle('generateDataset', { schema, count: 20, seed: 'repeat' });
  const b = await f.service.handle('generateDataset', { schema, count: 20, seed: 'repeat' });
  assert.deepEqual(a, b);
  assert.equal((await f.service.handle('validateDataset', { schema, rows: a.rows })).status, 'SUCCESS');
  const input = [{ email: 'one@example.com', id: 0 }, { email: 'one@example.com', id: 1 }];
  const masked = await f.service.handle('maskDataset', { rows: input, columns: ['email'], seed: 'private' });
  assert.equal(masked.rows[0].email, masked.rows[1].email); assert.notEqual(masked.rows[0].email, input[0].email); assert.equal(input[0].email, 'one@example.com'); assert.equal(masked.rows[0].id, 0);
  await assert.rejects(f.service.handle('maskDataset', { rows: input, columns: [] }), { code: 'VALIDATION' });
});

test('FW-24 existing visual dataset editor streams CSV, preserves zero, escapes content and calls typed tools', async () => {
  const nodes = new Map(), values = new Map(), calls = [];
  const context = { TextDecoder, console, document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, { innerHTML: '', classList: { remove() {} } }); return nodes.get(id); } }, localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }, electronAPI: { studioOps: { invoke: async (...args) => { calls.push(args); return { status: 'SUCCESS' }; } } } };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../data-manager.js'), 'utf8'), context);
  const bytes = Buffer.from('name,zero\n"Åsa\nA",0\n');
  const file = { stream() { let i = 0; return { getReader() { return { async read() { return i < bytes.length ? { done: false, value: bytes.subarray(i, ++i) } : { done: true }; }, releaseLock() {}, async cancel() {} }; } }; } };
  const parsed = await context.dataManager.parseCSVFile(file);
  assert.equal(parsed.data[0].name, 'Åsa\nA'); assert.equal(parsed.data[0].zero, '0');
  const id = context.dataManager.saveDataSet({ name: '<img src=x onerror=alert(1)>', headers: ['n'], data: [{ n: 0 }] });
  context.selectDataSetForView(id);
  assert.equal(nodes.get('data-set-details').innerHTML.includes('<img'), false);
  assert.ok(nodes.get('data-set-details').innerHTML.includes('>0</td>'));
  await context.dataManager.validateTypedDataSet(id, [{ name: 'n', type: 'integer' }]);
  assert.equal(calls[0][0], 'workspace'); assert.equal(calls[0][1], 'validateDataset');
  await assert.rejects(context.dataManager.parseCSVFile(file, { maxRows: 0 }));
});
