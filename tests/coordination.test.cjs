'use strict';
// Disposable canonical SQLite workspaces and deterministic provider/check
// callbacks. No user projects, accounts or provider requests are touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createService } = require('../services/coordination/index.cjs');
const { createService: createWorkspace } = require('../services/workspace/index.cjs');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const code = expected => error => { assert.equal(error.code, expected, error.message); return true; };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function setup(t, options = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-coordination-'));
  const root = path.join(temp, 'workspace'); fs.mkdirSync(root);
  const workspace = createWorkspace({ dataDir: path.join(temp, 'data'), workspaceRoot: root });
  const events = [], calls = [];
  async function put(collection, id, value) { const prior = await workspace.handle('read', { collection, id }); await workspace.handle('transact', { records: [{ collection, id, value, expectedRevision: prior?.revision ?? null }] }); return workspace.handle('read', { collection, id }); }
  const read = (collection, id) => workspace.handle('read', { collection, id });
  await put('agent-boards', 'board', { id: 'board', nodes: [{ id: 'alice', provider: 'codex' }, { id: 'bob', provider: 'gemini' }] });
  await put('workflows', 'flow', { id: 'flow', nodes: [{ id: 'n1', type: 'wait' }, { id: 'n2', type: 'unit-test' }], edges: [{ id: 'e1', source: 'n1', target: 'n2' }] });
  async function context(args) {
    assert.equal(args.workspaceRoot, root);
    const r = await read('workflows', args.workflowId); if (!r) throw Object.assign(Error('Missing workflow'), { code: 'NOT_FOUND' });
    const selected = args.nodeIds.length ? args.nodeIds : r.value.nodes.map(n => n.id);
    if (selected.some(id => !r.value.nodes.some(n => n.id === id))) throw Object.assign(Error('Missing node'), { code: 'NOT_FOUND' });
    return { workflowId: r.id, revision: r.revision, hash: digest(r.value), selectedNodeIds: selected, workflow: r.value, nodeCatalog: [] };
  }
  const callbacks = {
    sendTask: async args => { assert.equal(args.workspaceRoot, root); calls.push(args); const run = { id: args.task.operationId, boardId: args.mission.boardId, status: 'completed', finishedAt: '2026-10-25T10:00:00.000Z', requestFingerprint: digest(args.packet) }; await put('agent-runs', run.id, run); return { run }; },
    getTaskRun: async args => { assert.equal(args.workspaceRoot, root); return (await read('agent-runs', args.task.runId))?.value; },
    graphContext: context,
    runChecks: async args => { assert.equal(args.workspaceRoot, root); const c = await context({ workspaceRoot: root, workflowId: args.mission.workflowId, nodeIds: args.task.workflowNodeIds }); return { runId: crypto.randomUUID(), workflowId: c.workflowId, revision: c.revision, hash: c.hash, status: 'SUCCESS', fresh: true, selectedNodeIds: c.selectedNodeIds, executedNodeIds: c.selectedNodeIds, results: c.selectedNodeIds.map(nodeId => ({ nodeId, status: 'SUCCESS' })) }; },
    ...options.callbacks
  };
  let service = createService({ workspace, workspaceRoot: root, ...callbacks, emit: e => events.push(e) });
  const h = (action, payload = {}) => service.handle(action, { workspaceRoot: root, ...payload });
  const missionInput = { id: 'project', name: 'Release checks', goal: 'Verify the next release', criteria: 'Evidence is inspectable', boardId: 'board', ...(options.workflow ? { workflowId: 'flow' } : {}) };
  const mission = (await h('saveMission', { mission: missionInput, expectedRevision: null })).record;
  async function add(id = 'task', changes = {}) { return (await h('saveTask', { missionId: mission.id, task: { id, title: `Work ${id}`, description: 'Build and inspect', criteria: 'Tests pass', agentId: 'alice', dependsOn: [], workflowNodeIds: [], ...changes }, expectedRevision: null })).record; }
  async function action(name, record, extra = {}) { return h(name, { missionId: record.value.missionId, taskId: record.id, expectedRevision: record.revision, ...extra }); }
  async function complete(record) { const start = await action('startTask', record), submit = await action('submitTask', start.record); return (await action('reviewTask', submit.record, { decision: 'approve', comment: 'Independently inspected' })).record; }
  async function restart() { await service.close(); service = createService({ workspace, workspaceRoot: root, ...callbacks, emit: e => events.push(e) }); return service; }
  t.after(async () => { await service.close(); await workspace.close(); fs.rmSync(temp, { recursive: true, force: true }); });
  return { temp, root, workspace, h, put, read, add, action, complete, restart, mission, missionInput, calls, events, callbacks, get service() { return service; } };
}

test('task completion requires native dispatch, submission and explicit review, with durable inspectable evidence', async t => {
  const f = await setup(t), task = await f.add();
  const start = await f.action('startTask', task);
  assert.equal(start.record.value.status, 'active'); assert.equal(start.run.id, start.record.value.runId);
  assert.equal(f.calls.length, 1); assert.match(f.calls[0].packet, /Verify the next release/); assert.match(f.calls[0].packet, /Tests pass/);
  assert.equal(f.calls[0].packet, start.record.value.packet); assert.equal(digest(f.calls[0].packet), start.record.value.packetHash);
  const submitted = await f.action('submitTask', start.record);
  assert.equal(submitted.record.value.status, 'review'); assert.equal(submitted.record.value.evidence.provider.status, 'completed');
  assert.equal(submitted.record.value.evidence.checks, null); assert.match(submitted.record.value.evidence.meaning, /semantic correctness/);
  const done = (await f.action('reviewTask', submitted.record, { decision: 'approve', comment: 'Inspected output' })).record;
  assert.equal(done.value.status, 'done'); assert.equal(done.value.review.comment, 'Inspected output'); assert.equal(done.value.history.length, 5);
  await f.restart(); assert.deepEqual((await f.h('listTasks', { missionId: 'project' })).records[0], done);
  assert.ok(f.events.every(e => e.domain === 'coordination' && e.workspaceRoot === f.root));
});

test('canonical graph checks are required for attached workflows and include genuine native check evidence', async t => {
  const f = await setup(t, { workflow: true }), task = await f.add('task', { workflowNodeIds: ['n2'] });
  const start = await f.action('startTask', task); assert.match(start.record.value.packet, /Canonical workflow context/); assert.match(start.record.value.packet, /unit-test/);
  const submit = await f.action('submitTask', start.record);
  assert.deepEqual(submit.record.value.evidence.checks.executedNodeIds, ['n2']);
  assert.equal(submit.record.value.evidence.checks.fresh, true);
  const done = await f.action('reviewTask', submit.record, { decision: 'approve' }); assert.equal(done.record.value.status, 'done');
});

test('whole workflow is checked when no node subset is selected', async t => {
  const f = await setup(t, { workflow: true }), task = await f.add();
  const start = await f.action('startTask', task), submit = await f.action('submitTask', start.record);
  assert.deepEqual(submit.record.value.evidence.checks.executedNodeIds, ['n1', 'n2']);
});

test('native whole-graph empty selection expands to every saved node for evidence requirements', async t => {
  const f = await setup(t, { workflow: true }), real = f.callbacks.graphContext;
  f.callbacks.graphContext = async args => ({ ...await real(args), selectedNodeIds: [] }); await f.restart();
  const task = await f.add(), start = await f.action('startTask', task), submit = await f.action('submitTask', start.record);
  assert.deepEqual(submit.record.value.evidence.checks.selectedNodeIds, ['n1', 'n2']);
});

test('client status/evidence cannot bypass the service-owned state machine', async t => {
  const f = await setup(t);
  await assert.rejects(f.add('fake', { status: 'done', evidence: { provider: { status: 'completed' } } }), code('INVALID_TRANSITION'));
  const task = await f.add('task', { evidence: { provider: { status: 'completed' } }, review: { decision: 'approve' }, history: [{ action: 'fake' }], runId: 'fake' });
  assert.equal(task.value.evidence, undefined); assert.equal(task.value.runId, undefined); assert.equal(task.value.history[0].action, 'task-created');
  await assert.rejects(f.action('submitTask', task), code('INVALID_TRANSITION'));
  await assert.rejects(f.action('reviewTask', task, { decision: 'approve' }), code('INVALID_TRANSITION'));
  await assert.rejects(f.h('saveTask', { missionId: 'project', task: { ...task.value, status: 'active' }, expectedRevision: task.revision }), code('INVALID_TRANSITION'));
});

test('optimistic revisions reject stale edits without destroying the current task or draft', async t => {
  const f = await setup(t), task = await f.add();
  const newer = await f.h('saveTask', { missionId: 'project', task: { ...task.value, title: 'Saved newer title' }, expectedRevision: task.revision });
  await assert.rejects(f.h('saveTask', { missionId: 'project', task: { ...task.value, title: 'Stale draft' }, expectedRevision: task.revision }), code('CONFLICT'));
  assert.equal((await f.read('agent-tasks', task.id)).value.title, newer.record.value.title);
  await assert.rejects(f.action('startTask', task), code('CONFLICT'));
  await assert.rejects(f.h('saveMission', { mission: { ...f.missionInput, name: 'Draft' } }), code('CONFLICT'));
});

test('dependency cycles, missing dependencies and cross-project references are rejected', async t => {
  const f = await setup(t), a = await f.add('a'), b = await f.add('b', { dependsOn: ['a'] });
  await assert.rejects(f.h('saveTask', { missionId: 'project', task: { ...a.value, dependsOn: ['b'] }, expectedRevision: a.revision }), code('DEPENDENCY_CYCLE'));
  await assert.rejects(f.add('self', { dependsOn: ['self'] }), code('DEPENDENCY_CYCLE'));
  await assert.rejects(f.add('missing', { dependsOn: ['missing-other'] }), code('NOT_FOUND'));
  await f.h('saveMission', { mission: { ...f.missionInput, id: 'other' }, expectedRevision: null });
  await assert.rejects(f.h('saveTask', { missionId: 'other', task: { ...b.value, id: 'foreign', missionId: 'other', dependsOn: ['a'] }, expectedRevision: null }), code('NOT_FOUND'));
});

test('only approved dependencies unblock work; distinct agents cannot bypass a pending prerequisite', async t => {
  const f = await setup(t), a = await f.add('a'), b = await f.add('b', { agentId: 'bob', dependsOn: ['a'] });
  await assert.rejects(f.action('startTask', b), code('DEPENDENCY_BLOCKED'));
  const start = await f.action('startTask', a), submit = await f.action('submitTask', start.record);
  await assert.rejects(f.action('startTask', b), code('DEPENDENCY_BLOCKED'));
  await f.action('reviewTask', submit.record, { decision: 'approve' });
  assert.equal((await f.action('startTask', b)).record.value.status, 'active');
});

test('active owners cannot be assigned concurrently, including across projects sharing a board', async t => {
  const f = await setup(t), a = await f.add('a'), b = await f.add('b');
  await f.action('startTask', a); await assert.rejects(f.action('startTask', b), code('OWNER_BUSY'));
  await f.h('saveMission', { mission: { ...f.missionInput, id: 'other' }, expectedRevision: null });
  const other = (await f.h('saveTask', { missionId: 'other', task: { ...b.value, id: 'other-task', missionId: 'other' }, expectedRevision: null })).record;
  await assert.rejects(f.action('startTask', other), code('OWNER_BUSY'));
  assert.equal(f.calls.length, 1);
  const bob = await f.add('bob-task', { agentId: 'bob' }); assert.equal((await f.action('startTask', bob)).record.value.status, 'active');
});

test('wrong-board and absent agents are rejected before dispatch', async t => {
  const f = await setup(t);
  await f.put('agent-boards', 'other-board', { id: 'other-board', nodes: [{ id: 'foreign' }] });
  await assert.rejects(f.add('foreign-task', { agentId: 'foreign' }), code('AGENT_REQUIRED'));
  const task = await f.add(); await f.put('agent-boards', 'board', { id: 'board', nodes: [] });
  await assert.rejects(f.action('startTask', task), code('AGENT_REQUIRED')); assert.equal(f.calls.length, 0);
  await assert.rejects(f.h('saveMission', { mission: { ...f.missionInput, id: 'bad', boardId: 'missing' }, expectedRevision: null }), code('BOARD_REQUIRED'));
});

test('active/reviewed briefs and project semantics are protected while names remain editable', async t => {
  const f = await setup(t), task = await f.add(), start = await f.action('startTask', task);
  await assert.rejects(f.h('saveTask', { missionId: 'project', task: { ...start.record.value, title: 'Changed brief' }, expectedRevision: start.record.revision }), code('ACTIVE_TASK'));
  await assert.rejects(f.h('saveMission', { mission: { ...f.missionInput, goal: 'Changed goal' }, expectedRevision: f.mission.revision }), code('ACTIVE_TASK'));
  assert.equal((await f.h('saveMission', { mission: { ...f.missionInput, name: 'Release checks renamed' }, expectedRevision: f.mission.revision })).record.value.name, 'Release checks renamed');
});

test('rework preserves history, clears current evidence and permits a fresh edited brief and native run', async t => {
  const f = await setup(t), task = await f.add(), start = await f.action('startTask', task), submit = await f.action('submitTask', start.record);
  const rework = await f.action('reviewTask', submit.record, { decision: 'rework', comment: 'Handle the empty response' });
  assert.equal(rework.record.value.status, 'todo'); assert.equal(rework.record.value.evidence, null); assert.equal(rework.record.value.runId, null);
  assert.equal(rework.record.value.history.at(-1).evidence.provider.id, start.run.id);
  const edited = await f.h('saveTask', { missionId: 'project', task: { ...rework.record.value, description: 'Also handle empty responses' }, expectedRevision: rework.record.revision });
  const next = await f.action('startTask', edited.record); assert.notEqual(next.run.id, start.run.id); assert.match(next.record.value.packet, /Also handle empty responses/);
});

test('pending runs cannot be submitted; terminal failed runs block tasks and allow explicit retry', async t => {
  const f = await setup(t), task = await f.add(), start = await f.action('startTask', task);
  await f.put('agent-runs', start.run.id, { ...start.run, status: 'running' });
  await assert.rejects(f.action('submitTask', start.record), code('RUN_PENDING'));
  assert.equal((await f.read('agent-tasks', task.id)).value.status, 'active');
  await f.put('agent-runs', start.run.id, { ...start.run, status: 'cancelled' });
  await assert.rejects(f.action('submitTask', start.record), code('RUN_FAILED'));
  const blocked = await f.read('agent-tasks', task.id); assert.equal(blocked.value.status, 'blocked');
  assert.equal((await f.action('startTask', blocked)).record.value.status, 'active');
});

test('dispatch failures leave recoverable blocked evidence and no automatic replay', async t => {
  const f = await setup(t); f.callbacks.sendTask = async () => { throw Object.assign(Error('Permission approval needed'), { code: 'APPROVAL_REQUIRED' }); };
  await f.restart(); const task = await f.add();
  await assert.rejects(f.action('startTask', task), code('APPROVAL_REQUIRED'));
  const blocked = await f.read('agent-tasks', task.id); assert.equal(blocked.value.status, 'blocked'); assert.match(blocked.value.error, /Permission/); assert.equal(blocked.value.runId, blocked.value.operationId);
  await f.restart(); assert.equal(f.calls.length, 0); assert.equal((await f.h('listTasks', { missionId: 'project' })).records[0].value.status, 'blocked');
});

test('restart interrupts active ownership and never silently retries native side effects', async t => {
  const f = await setup(t), task = await f.add(), start = await f.action('startTask', task);
  await f.put('agent-runs', start.run.id, { ...start.run, status: 'running' }); await f.restart();
  const restored = (await f.h('listTasks', { missionId: 'project' })).records[0];
  assert.equal(restored.value.status, 'blocked'); assert.equal(restored.value.runId, start.run.id); assert.match(restored.value.error, /nothing was replayed/); assert.equal(f.calls.length, 1);
  await assert.rejects(f.action('startTask', restored), code('RUN_PENDING'));
  await assert.rejects(f.h('saveTask', { missionId: 'project', task: { ...restored.value, status: 'todo', title: 'Bypass the running owner' }, expectedRevision: restored.revision }), code('RUN_PENDING'));
  const other = await f.add('other-task'); await assert.rejects(f.action('startTask', other), code('OWNER_BUSY'));
});

for (const invalid of ['failure', 'not-fresh', 'wrong-hash', 'wrong-revision', 'empty-execution', 'missing-node', 'empty-results', 'failing-result']) {
  test(`native evidence rejects ${invalid} rather than accepting an agent success claim`, async t => {
    const f = await setup(t, { workflow: true }); const real = f.callbacks.runChecks;
    f.callbacks.runChecks = async args => { const r = await real(args); if (invalid === 'failure') r.status = 'FAILURE'; if (invalid === 'not-fresh') r.fresh = false; if (invalid === 'wrong-hash') r.hash = '0'.repeat(64); if (invalid === 'wrong-revision') r.revision++; if (invalid === 'empty-execution') r.executedNodeIds = []; if (invalid === 'missing-node') r.executedNodeIds = ['n1']; if (invalid === 'empty-results') r.results = []; if (invalid === 'failing-result') r.results[0].status = 'FAILURE'; return r; };
    await f.restart(); const task = await f.add(), start = await f.action('startTask', task);
    await assert.rejects(f.action('submitTask', start.record), code('CHECKS_FAILED'));
    assert.equal((await f.read('agent-tasks', task.id)).value.status, 'active');
  });
}

test('graph changes during native checks prevent stale evidence being submitted', async t => {
  const f = await setup(t, { workflow: true }), real = f.callbacks.runChecks;
  f.callbacks.runChecks = async args => { const result = await real(args), flow = await f.read('workflows', 'flow'); await f.put('workflows', 'flow', { ...flow.value, name: 'Changed during check' }); return result; };
  await f.restart(); const task = await f.add(), start = await f.action('startTask', task);
  await assert.rejects(f.action('submitTask', start.record), code('STALE_EVIDENCE'));
});

test('graph changes after submission prevent approval until explicit rework and fresh checks', async t => {
  const f = await setup(t, { workflow: true }), task = await f.add(), start = await f.action('startTask', task), submit = await f.action('submitTask', start.record);
  const flow = await f.read('workflows', 'flow'); await f.put('workflows', 'flow', { ...flow.value, name: 'Updated saved graph' });
  await assert.rejects(f.action('reviewTask', submit.record, { decision: 'approve' }), code('STALE_EVIDENCE'));
  assert.equal((await f.read('agent-tasks', task.id)).value.status, 'review');
  const rework = await f.action('reviewTask', submit.record, { decision: 'rework' }); assert.equal((await f.complete(rework.record)).value.status, 'done');
});

test('native run changes after submission cannot be approved', async t => {
  const f = await setup(t), task = await f.add(), start = await f.action('startTask', task), submit = await f.action('submitTask', start.record);
  await f.put('agent-runs', start.run.id, { ...start.run, requestFingerprint: 'changed' });
  await assert.rejects(f.action('reviewTask', submit.record, { decision: 'approve' }), code('STALE_EVIDENCE'));
});

test('callback success is insufficient without matching canonical native run evidence', async t => {
  const f = await setup(t); f.callbacks.getTaskRun = async ({ task }) => ({ id: task.runId, boardId: 'board', status: 'completed' });
  await f.restart(); const task = await f.add(), start = await f.action('startTask', task);
  await f.put('agent-runs', start.run.id, { ...start.run, status: 'running' });
  await assert.rejects(f.action('submitTask', start.record), code('RUN_PENDING'));
});

test('binding is mandatory and rejects foreign workspace requests', async t => {
  const f = await setup(t), other = path.join(f.temp, 'other'); fs.mkdirSync(other);
  await assert.rejects(f.service.handle('listMissions'), code('WORKSPACE_CHANGED'));
  await assert.rejects(f.h('listMissions', { workspaceRoot: other }), code('WORKSPACE_CHANGED'));
  assert.equal((await f.h('listMissions')).records.length, 1);
});

test('workspace switches fence late dispatch results and keep callbacks bound to the original root', async t => {
  const f = await setup(t), entered = deferred(), release = deferred();
  f.callbacks.sendTask = async args => { entered.resolve(args); await release.promise; return { run: { id: args.task.operationId, boardId: 'board', status: 'completed' } }; };
  await f.restart(); const task = await f.add(), pending = f.action('startTask', task); const rejected = assert.rejects(pending, code('WORKSPACE_CHANGED'));
  const args = await entered.promise; assert.equal(args.workspaceRoot, f.root);
  const other = path.join(f.temp, 'other'); fs.mkdirSync(other); await f.service.setWorkspace(other); release.resolve(); await rejected;
  assert.equal((await f.read('agent-tasks', task.id)).value.runId, null);
});

test('slow native checks leave list/read operations responsive and reject concurrent duplicate submission', async t => {
  const f = await setup(t, { workflow: true }), entered = deferred(), release = deferred(), real = f.callbacks.runChecks;
  f.callbacks.runChecks = async args => { entered.resolve(); await release.promise; return real(args); }; await f.restart();
  const task = await f.add(), start = await f.action('startTask', task), first = f.action('submitTask', start.record); await entered.promise;
  assert.equal((await f.h('listTasks', { missionId: 'project' })).records[0].value.status, 'active');
  const second = f.action('submitTask', start.record); const rejected = assert.rejects(second, code('TASK_BUSY')); await rejected; release.resolve();
  assert.equal((await first).record.value.status, 'review'); await rejected;
});

test('native node-keyed check results are accepted and every selected node needs its own passing result', async t => {
  const f = await setup(t, { workflow: true }), real = f.callbacks.runChecks;
  f.callbacks.runChecks = async args => { const r = await real(args); r.results = Object.fromEntries(r.results.map(v => [v.nodeId, { status: v.status }])); return r; };
  await f.restart(); const task = await f.add(), start = await f.action('startTask', task), submit = await f.action('submitTask', start.record);
  assert.deepEqual(submit.record.value.evidence.checks.results.map(v => v.nodeId), ['n1', 'n2']);
  const rework = await f.action('reviewTask', submit.record, { decision: 'rework' }), next = await f.action('startTask', rework.record);
  f.callbacks.runChecks = async args => { const r = await real(args); r.results = { n1: { status: 'SUCCESS' } }; return r; };
  // The callback object was captured when the service was created; replace its
  // underlying function via restart and explicitly restart the interrupted task.
  await f.restart(); const blocked = (await f.h('listTasks', { missionId: 'project' })).records[0];
  const last = await f.action('startTask', blocked);
  await assert.rejects(f.action('submitTask', last.record), code('CHECKS_FAILED'));
  assert.notEqual(next.run.id, last.run.id);
});

test('canonical workspace switches are detected even when coordinator binding was not updated', async t => {
  const f = await setup(t), other = path.join(f.temp, 'foreign'); fs.mkdirSync(other);
  await f.workspace.setWorkspace(other);
  await assert.rejects(f.h('listMissions'), code('WORKSPACE_CHANGED'));
});

test('invalid selected graph nodes, duplicate dependencies and foreign mission task IDs are rejected', async t => {
  const f = await setup(t, { workflow: true }), task = await f.add();
  await assert.rejects(f.add('missing-node', { workflowNodeIds: ['missing'] }), code('NOT_FOUND'));
  await assert.rejects(f.add('duplicate', { dependsOn: ['task', 'task'] }), code('VALIDATION'));
  await assert.rejects(f.add('foreign', { missionId: 'foreign' }), code('VALIDATION'));
  await assert.rejects(f.action('startTask', task, { missionId: 'missing' }), code('NOT_FOUND'));
});

test('missing workflow/check/provider callbacks produce explicit recoverable errors', async t => {
  const f = await setup(t, { workflow: true }); f.callbacks.runChecks = null; await f.restart();
  const task = await f.add(), start = await f.action('startTask', task);
  await assert.rejects(f.action('submitTask', start.record), code('CHECKS_UNAVAILABLE'));
  await assert.rejects(f.h('saveMission', { mission: { ...f.missionInput, id: 'missing-flow', workflowId: 'missing' }, expectedRevision: null }), code('NOT_FOUND'));
});

test('drain fences outstanding work before handoff, without replay or evidence commits', async t => {
  const f = await setup(t), entered = deferred(), release = deferred();
  f.callbacks.sendTask = async args => { entered.resolve(); await release.promise; return { run: { id: args.task.operationId, boardId: 'board', status: 'completed' } }; }; await f.restart();
  const task = await f.add(), pending = f.action('startTask', task), rejected = assert.rejects(pending, code('WORKSPACE_CHANGED')); await entered.promise;
  const drained = f.service.drain(); release.resolve(); await drained; await rejected;
  assert.equal((await f.read('agent-tasks', task.id)).value.runId, null);
});
