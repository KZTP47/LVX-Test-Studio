'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Y = require('yaml');
const workspaceModule = require('../services/workspace/index.cjs');
const { createService } = require('../services/github-studio/index.cjs');
const { createDemoTransport } = require('../services/github-studio/demo-remote.cjs');
const fingerprint = source => crypto.createHash('sha256').update(source).digest('hex');
const repository = 'example/web-client';

async function fixture(t, { transport = null } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-github-integration-'));
  const rootA = path.join(temp, 'project-a'), rootB = path.join(temp, 'project-b'), dataDir = path.join(temp, 'private-data');
  fs.mkdirSync(rootA); fs.mkdirSync(rootB);
  let root = rootA, workspace = workspaceModule.createService({ dataDir, workspaceRoot: root });
  const options = () => ({ workspace, getWorkspaceRoot: () => root, request: transport || (async () => { throw Error('Unexpected live network access in integration test.'); }) });
  let service = createService(options());
  const invoke = (action, payload = {}) => service.handle(action, { workspaceRoot: root, repository, simulated: !transport, ...payload });
  const close = async () => { await service.close(); await workspace.close(); };
  t.after(async () => { await close(); fs.rmSync(temp, { recursive: true, force: true }); });
  return {
    invoke, rootA, rootB, dataDir, get service() { return service; }, get workspace() { return workspace; }, get root() { return root; },
    async restart() { await close(); workspace = workspaceModule.createService({ dataDir, workspaceRoot: root }); service = createService(options()); },
    async switchRoot(next) { root = next; await workspace.setWorkspace(next); await service.setWorkspace(next); },
    async switchStoreOnly(next) { root = next; await workspace.setWorkspace(next); }
  };
}
async function demo(f) { return f.invoke('demo'); }
async function preview(f, repo, files, extra = {}) {
  return f.invoke('previewStage', { repository: repo.fullName, ref: 'main', baseCommit: repo.commit, baseTree: repo.baseTree, files, stagedPaths: files.filter(file => file.content !== file.originalContent || file.isDeleted).map(file => file.path), message: 'Reviewed integration coverage', mode: 'pr', ...extra });
}
function applyFiles(files, changes) {
  for (const change of changes) {
    const prior = files.find(file => file.path === change.path);
    if (prior) { if (change.expectedSource !== undefined) assert.equal(prior.content, change.expectedSource); prior.content = change.content; }
    else files.push(change);
  }
}

test('real SQLite workspace persists an immutable demo snapshot and edited drafts across service restart', async t => {
  const f = await fixture(t), repo = await demo(f);
  assert.equal(repo.files.filter(file => file.kind === 'workflow').length, 2);
  assert.equal(repo.files.filter(file => file.kind === 'test').length, 3);
  assert.equal(repo.simulated, true); assert.match(repo.commit, /^[a-f0-9]{40}$/);
  const files = structuredClone(repo.files), ci = files.find(file => file.path === '.github/workflows/ci.yml');
  const changed = await f.invoke('workflowEdit', { source: ci.content, expectedHash: fingerprint(ci.content), operation: { type: 'updateJob', id: 'test', patch: { name: 'Reviewed test job' } } });
  ci.content = changed.source;
  await f.workspace.handle('transact', { workspaceRoot: f.root, records: [{ collection: 'github-studio-drafts', id: 'draft', value: { ...repo, files }, expectedRevision: null }] });
  await f.restart();
  const saved = await f.workspace.handle('read', { workspaceRoot: f.root, collection: 'github-studio-drafts', id: 'draft' });
  assert.equal(saved.value.files.find(file => file.path === ci.path).content, changed.source);
  assert.equal(saved.value.files.find(file => file.path === ci.path).originalContent, ci.originalContent);
  const remote = await demo(f); assert.equal(remote.commit, repo.commit); assert.equal(remote.files.find(file => file.path === ci.path).content, ci.originalContent);
  const databases = fs.readdirSync(path.join(f.dataDir, 'workspaces'), { recursive: true }); assert.ok(databases.some(file => String(file).endsWith('workspace.sqlite')));
});

test('facade binds pure editing to the exact selected workspace and rejects stale source hashes', async t => {
  const f = await fixture(t), repo = await demo(f), ci = repo.files.find(file => file.kind === 'workflow');
  await assert.rejects(f.service.handle('workflowInspect', { workspaceRoot: f.rootB, source: ci.content }), /selected project|project folder/i);
  await assert.rejects(f.invoke('workflowEdit', { source: ci.content, expectedHash: 'stale', operation: { type: 'setWorkflow', patch: { name: 'Wrong source' } } }), /changed|Reload/i);
  const file = repo.files.find(file => file.path === 'tests/login.spec.ts');
  await assert.rejects(f.invoke('discoverTests', { path: '../tests/login.spec.ts', source: file.content }), /relative|traversal/i);
  await assert.rejects(f.invoke('editTest', { path: file.path, source: file.content, expectedHash: 'stale', operation: { type: 'add', title: 'Wrong' } }), /changed|Reload/i);
  await f.switchRoot(f.rootB);
  await assert.rejects(f.service.handle('workflowInspect', { workspaceRoot: f.rootA, source: ci.content }), /selected project|project folder/i);
  assert.equal((await f.workspace.handle('list', { collection: 'github-studio-drafts' })).records.length, 0);
});

test('workflow and test CRUD plus scaffold auto-wiring produce one coherent multi-file draft', async t => {
  const f = await fixture(t), repo = await demo(f), files = structuredClone(repo.files), login = files.find(file => file.path === 'tests/login.spec.ts');
  const discovery = await f.invoke('discoverTests', { path: login.path, source: login.content });
  const caseItem = discovery.cases.find(item => item.kind === 'case'); assert.ok(caseItem); assert.ok(caseItem.tags.includes('@smoke'));
  const renamed = await f.invoke('editTest', { path: login.path, source: login.content, expectedHash: discovery.fingerprint, caseId: caseItem.id, operation: { type: 'rename', title: 'sign in with valid account @smoke' } });
  assert.ok(renamed.source.includes('// Login helpers stay untouched by case edits.')); login.content = renamed.source;
  const added = await f.invoke('editTest', { path: login.path, source: login.content, expectedHash: renamed.discovery.fingerprint, operation: { type: 'add', title: 'reject invalid password', bodySource: "await page.goto('/login');\nawait expect(page.getByRole('alert')).toBeVisible();" } });
  login.content = added.source; assert.equal(added.discovery.cases.filter(item => item.kind === 'case').length, 2);
  const newlyAdded = added.discovery.cases.find(item => item.title === 'reject invalid password');
  const deleted = await f.invoke('editTest', { path: login.path, source: login.content, expectedHash: added.discovery.fingerprint, caseId: newlyAdded.id, operation: { type: 'delete' } });
  login.content = deleted.source; assert.equal(deleted.discovery.cases.filter(item => item.kind === 'case').length, 1);
  const ci = files.find(file => file.path === '.github/workflows/ci.yml');
  const created = await f.invoke('createTestFile', { path: 'tests/new.spec.ts', paths: files.map(file => file.path), framework: 'playwright', title: 'new login coverage', tags: ['@smoke'], bodySource: "await page.goto('/new');", wire: { path: ci.path, source: ci.content, jobId: 'test' } });
  assert.equal(created.files.length, 2); applyFiles(files, created.files);
  assert.equal(files.find(file => file.path === 'tests/new.spec.ts').originalContent, null);
  const job = Y.parse(ci.content).jobs.test; assert.match(job.steps.at(-1).run, /npx playwright test/); assert.match(job.steps.at(-1).run, /new/); assert.ok(ci.content.includes('# Repository checks'));
  const all = await f.invoke('repositoryTests', { files });
  assert.equal(all.discoveries.length, 4); for (const path of ['tests/login.spec.ts', 'tests/checkout.spec.ts', 'src/price.test.ts', 'tests/new.spec.ts']) assert.ok(all.mapping.links.some(link => link.filePath === path), path);
  const staged = await preview(f, repo, files); assert.deepEqual(staged.changes.map(change => change.path).sort(), ['.github/workflows/ci.yml', 'tests/login.spec.ts', 'tests/new.spec.ts']); assert.match(staged.diff, /new login coverage/);
  const result = await f.invoke('publish', { previewId: staged.previewId, operationId: crypto.randomUUID() }); assert.equal(result.state, 'complete');
  const published = await f.invoke('snapshot', { ref: result.branch });
  for (const changed of staged.changes) assert.equal(published.files.find(file => file.path === changed.path).content, files.find(file => file.path === changed.path).content);
  const persisted = await f.workspace.handle('list', { collection: 'github-studio-demo-remotes' }); assert.equal(persisted.records[0].value.commits.length, 2, 'All three source changes share one child commit');
  assert.equal((await demo(f)).commit, repo.commit, 'PR-only publishing preserves destination branch');
});

test('scaffolding rejects duplicate or shell-sensitive paths and reusable auto-wire targets atomically', async t => {
  const f = await fixture(t), repo = await demo(f), ci = repo.files.find(file => file.path === '.github/workflows/ci.yml');
  const base = { path: 'tests/new.spec.ts', framework: 'playwright', title: 'New', bodySource: "await page.goto('/');", paths: repo.files.map(file => file.path) };
  await assert.rejects(f.invoke('createTestFile', { ...base, path: 'TESTS/LOGIN.SPEC.TS' }), /already exists/i);
  for (const path of ['notes.txt', 'src/helper.ts', '.github/workflows/new.yml']) await assert.rejects(f.invoke('createTestFile', { ...base, path }), /test|supported|extension|source|file/i);
  await assert.rejects(f.invoke('createTestFile', { ...base, path: 'tests/new name.spec.ts', wire: { path: ci.path, source: ci.content, jobId: 'test' } }), /simple file paths/i);
  const reusable = repo.files.find(file => file.path.endsWith('release.yaml'));
  await assert.rejects(f.invoke('createTestFile', { ...base, wire: { path: reusable.path, source: reusable.content, jobId: 'verify' } }), /Reusable workflow jobs/i);
  const unchanged = await demo(f); assert.equal(unchanged.commit, repo.commit); assert.deepEqual(unchanged.files.map(file => file.path), repo.files.map(file => file.path));
});

test('facade blocks invalid staged workflow/test source even when renderer lies about file kind', async t => {
  const f = await fixture(t), repo = await demo(f);
  for (const [target, broken] of [['.github/workflows/ci.yml', 'jobs: [broken'], ['tests/login.spec.ts', "import {test} from '@playwright/test'; test('broken', () => { if ();"]]) {
    for (const suppliedKind of ['workflow', 'test', 'context', undefined]) {
      const files = structuredClone(repo.files), file = files.find(file => file.path === target); file.content = broken; file.kind = suppliedKind;
      await assert.rejects(preview(f, repo, files, { stagedPaths: [target] }), /Fix|invalid|syntax|Workflow|YAML|source/i, target + ' kind=' + suppliedKind);
    }
    const files = structuredClone(repo.files), file = files.find(file => file.path === target); file.content = broken; file.staged = true;
    await assert.rejects(preview(f, repo, files, { stagedPaths: undefined }), /Fix|invalid|syntax|Workflow|YAML|source/i, target + ' implicit staged paths');
  }
  assert.equal((await demo(f)).commit, repo.commit);
});

test('offline direct, PR-only and merge modes survive real SQLite and transport restarts', async t => {
  for (const mode of ['direct', 'pr', 'merge']) await t.test(mode, async child => {
    const f = await fixture(child), repo = await demo(f), files = structuredClone(repo.files), ci = files.find(file => file.path === '.github/workflows/ci.yml');
    ci.content += '\n# Reviewed ' + mode + ' publication\n';
    const plan = await preview(f, repo, files, { mode, newBranch: 'lvx/integration-' + mode });
    const operationId = crypto.randomUUID(), result = await f.invoke('publish', { previewId: plan.previewId, operationId });
    assert.equal(result.state, 'complete'); assert.equal(result.mode, mode);
    assert.equal(Boolean(result.prNumber), mode !== 'direct'); assert.equal(Boolean(result.merged), mode === 'merge');
    await f.restart();
    const recovered = await f.invoke('operation', { operationId }); assert.equal(recovered.state, 'complete'); assert.equal(recovered.commitSha, result.commitSha);
    const ref = mode === 'pr' ? result.branch : 'main';
    const snapshot = await f.invoke('snapshot', { ref });
    assert.equal(snapshot.files.find(file => file.path === ci.path).content, ci.content);
    const unchanged = repo.files.find(file => file.path === 'tests/login.spec.ts'); assert.equal(snapshot.files.find(file => file.path === unchanged.path).content, unchanged.content);
    if (mode === 'pr') assert.equal((await f.invoke('snapshot', { ref: 'main' })).commit, repo.commit);
    else assert.notEqual(snapshot.commit, repo.commit);
    const repeated = await f.invoke('reconcile', { operationId }); assert.equal(repeated.commitSha, result.commitSha); assert.equal(repeated.state, 'complete');
  });
});

test('staging authenticates immutable originals and deleting a malformed file remains possible', async t => {
  const f = await fixture(t), repo = await demo(f), files = structuredClone(repo.files), file = files.find(file => file.path === 'tests/login.spec.ts');
  file.content += '// changed\n'; file.originalContent = 'forged original';
  await assert.rejects(preview(f, repo, files), { code: 'SOURCE_MISMATCH' });
  const deletedFiles = structuredClone(repo.files), deleted = deletedFiles.find(file => file.path === 'tests/login.spec.ts'); deleted.content = 'broken syntax {{'; deleted.isDeleted = true;
  const plan = await preview(f, repo, deletedFiles, { stagedPaths: [deleted.path], mode: 'direct' }); assert.equal(plan.changes[0].status, 'deleted');
  const outcome = await f.invoke('publish', { previewId: plan.previewId, operationId: crypto.randomUUID() }); assert.equal(outcome.state, 'complete');
  assert.equal((await demo(f)).files.some(file => file.path === deleted.path), false);
});

test('switching projects after a remote write cannot deposit an old-project journal into the new SQLite store', async t => {
  const transport = createDemoTransport(), f = await fixture(t, { transport });
  const repo = await f.invoke('snapshot', { repository: transport.state.repository }), files = structuredClone(repo.files), file = files.find(file => file.path === 'tests/cart.test.ts'); file.content += '// reviewed change\n';
  const plan = await preview(f, repo, files, { repository: transport.state.repository, mode: 'direct' });
  transport.state.after = async call => { if (call.path === '/graphql') { transport.state.after = null; await f.switchStoreOnly(f.rootB); } };
  const operationId = crypto.randomUUID();
  await assert.rejects(f.service.handle('publish', { workspaceRoot: f.rootA, repository: transport.state.repository, previewId: plan.previewId, operationId }), /Project|project|Workspace|workspace/);
  const foreign = await f.workspace.handle('read', { collection: 'github-publish-operations', id: operationId, workspaceRoot: f.rootB }); assert.equal(foreign, null);
  await f.switchRoot(f.rootA);
  await f.restart();
  const recovered = await f.invoke('reconcile', { repository: transport.state.repository, simulated: false, operationId }); assert.equal(recovered.state, 'complete');
  assert.equal(transport.state.calls.filter(call => call.path === '/graphql').length, 1);
});

test('identical offline repository names in different projects have independent history and operation journals', async t => {
  const f = await fixture(t), a = await demo(f), files = structuredClone(a.files), changed = files.find(file => file.kind === 'workflow'); changed.content += '# project A only\n';
  const plan = await preview(f, a, files, { mode: 'direct' }), operationId = crypto.randomUUID();
  const result = await f.invoke('publish', { previewId: plan.previewId, operationId }); assert.equal(result.state, 'complete');
  await f.switchRoot(f.rootB);
  const b = await demo(f); assert.equal(b.commit, a.commit); assert.equal(b.files.find(file => file.path === changed.path).content.includes('# project A only'), false);
  await assert.rejects(f.invoke('operation', { operationId }), { code: 'OPERATION_NOT_FOUND' });
  await f.switchRoot(f.rootA); await f.restart();
  assert.equal((await demo(f)).commit, result.commitSha); assert.equal((await f.invoke('operation', { operationId })).state, 'complete');
});

test('stage previews freeze source and options and expire across facade restart', async t => {
  const f = await fixture(t), repo = await demo(f), files = structuredClone(repo.files), changed = files.find(file => file.path === 'src/price.test.ts'); changed.content += '// reviewed source\n';
  const staged = await preview(f, repo, files, { mode: 'pr', newBranch: 'lvx/frozen' });
  changed.content += '// unreviewed later text\n';
  const result = await f.invoke('publish', { previewId: staged.previewId, operationId: crypto.randomUUID(), mode: 'direct', message: 'Ignore review' }); assert.equal(result.mode, 'pr');
  const snapshot = await f.invoke('snapshot', { ref: result.branch }); const actual = snapshot.files.find(file => file.path === changed.path).content;
  assert.ok(actual.includes('// reviewed source')); assert.equal(actual.includes('// unreviewed later text'), false);
  const expired = await preview(f, repo, files, { mode: 'direct' });
  await f.restart();
  await assert.rejects(f.invoke('publish', { previewId: expired.previewId, operationId: crypto.randomUUID() }), { code: 'PREVIEW_EXPIRED' });
  assert.equal((await demo(f)).commit, repo.commit);
});

test('parallel first demo imports share one durable repository initialization', async t => {
  const f = await fixture(t);
  const snapshots = await Promise.all([demo(f), demo(f), demo(f)]);
  assert.equal(new Set(snapshots.map(repo => repo.commit)).size, 1);
  const saved = await f.workspace.handle('list', { collection: 'github-studio-demo-remotes' }); assert.equal(saved.records.length, 1);
  await f.restart(); assert.equal((await demo(f)).commit, snapshots[0].commit);
});

test('facade exposes bounded matrices, commit-bound runs and local reusable source without remote writes', async t => {
  const f = await fixture(t), repo = await demo(f);
  const matrix = await f.invoke('matrix', { matrix: { node: [20, 22], os: ['linux', 'windows'] } }); assert.equal(matrix.total, 4); assert.equal(matrix.combinations.length, 4);
  assert.equal((await f.invoke('matrix', { matrix: '${{ fromJSON(inputs.matrix) }}' })).dynamic, true);
  const runs = await f.invoke('listRuns', { expectedCommit: repo.commit, workflowPath: '.github/workflows/ci.yml' }); assert.equal(runs.runs.length, 1); assert.equal(runs.runs[0].headSha, repo.commit);
  const run = runs.runs[0], jobs = await f.invoke('runJobs', { expectedCommit: repo.commit, runId: run.id, attempt: run.attempt }); assert.ok(jobs.jobs.length > 0);
  await assert.rejects(f.invoke('runJobs', { expectedCommit: 'a'.repeat(40), runId: run.id, attempt: run.attempt }), { code: 'STALE_RUN' });
  const reusable = await f.invoke('inspectReusable', { commit: repo.commit, workflowPath: '.github/workflows/release.yaml', jobId: 'verify' }); assert.equal(reusable.commit, repo.commit); assert.equal(reusable.content, repo.files.find(file => file.path === '.github/workflows/ci.yml').content);
  const state = (await f.workspace.handle('list', { collection: 'github-studio-demo-remotes' })).records[0].value;
  assert.equal(state.commits.length, 1); assert.equal(state.pulls.length, 0);
});
