'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { createGraphService, applyOperations, safeContext, hash } = require('../services/coordination/graph.cjs');
const GraphEngine = require('../graph-engine.js');
async function setup(t, overrides = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-graph-coordination-')), root = path.join(temp, 'project'); fs.mkdirSync(root);
  const workspace = require('../services/workspace/index.cjs').createService({ dataDir: path.join(temp, 'data'), workspaceRoot: root });
  t.after(() => workspace.close());
  const workflow = { schemaVersion: 1, name: 'Real saved graph', nodes: [{ id: 'wait', type: 'wait-delay', position: { x: 0, y: 0 }, data: { name: 'Wait', delayMs: 0 } }], edges: [] };
  await workspace.handle('transact', { records: [{ collection: 'workflows', id: 'workflow', value: workflow, expectedRevision: null }] });
  const calls = [], service = createGraphService({ workspace, getWorkspaceRoot: () => root, agents: { handle: async () => { throw Error('Unexpected agent launch'); } }, execute: async payload => { calls.push(payload); return { id: crypto.randomUUID(), status: 'SUCCESS', results: Object.fromEntries(payload.workflow.nodes.map(node => [node.id, { status: 'SUCCESS' }])) }; }, ...overrides });
  const invoke = (action, payload = {}) => service.handle(action, { workspaceRoot: root, workflowId: 'workflow', ...payload });
  return { workspace, root, workflow, service, calls, invoke };
}
test('All existing node types and invalid/incomplete configurations can be interpreted without launching them', async t => {
  const { invoke, workspace } = await setup(t);
  const record = await workspace.handle('read', { collection: 'workflows', id: 'workflow' });
  const workflow = { ...record.value, nodes: GraphEngine.nodeTypes().map(type => ({ id: type, type, data: { name: type } })), edges: [] };
  await workspace.handle('transact', { records: [{ collection: 'workflows', id: record.id, value: workflow, expectedRevision: record.revision }] });
  const context = await invoke('graphContext', { nodeIds: ['ai-unit-test'] });
  assert.equal(context.nodeCatalog.length, GraphEngine.nodeTypes().length); assert.equal(context.workflow.nodes.length, GraphEngine.nodeTypes().length);
  assert.deepEqual(context.selectedNodeIds, ['ai-unit-test']); assert.equal(context.summary.validation.valid, false); assert.match(context.packet, /ai-unit-test/);
  await assert.rejects(invoke('graphContext', { nodeIds: ['absent'] }), /Select nodes/);
});
test('Graph snapshots redact credential values and references including validation metadata', async t => {
  const { invoke, workspace } = await setup(t);
  const record = await workspace.handle('read', { collection: 'workflows', id: 'workflow' });
  record.value.nodes[0].data.apiKey = 'private-credential'; record.value.nodes[0].data.auth = { token: 'private-token' };
  record.value.nodes[0].data.ref = 'secret:11111111-1111-4111-8111-111111111111';
  await workspace.handle('transact', { records: [{ ...record, expectedRevision: record.revision }] });
  const context = JSON.stringify(await invoke('graphContext'));
  for (const secret of ['private-credential', 'private-token', 'secret:1111']) assert.ok(!context.includes(secret));
  assert.match(context, /REDACTED/);
  assert.equal(safeContext({ url: 'https://user:pass@example.com' }).url, 'https://[REDACTED]@example.com');
});
test('Preview/apply is atomic, preserves unrelated settings and credentials, rejects stale and duplicate apply', async t => {
  const { invoke, workspace } = await setup(t);
  let before = await workspace.handle('read', { collection: 'workflows', id: 'workflow' });
  before.value.nodes[0].data.apiConfig = { model: 'old', apiKey: 'secret:11111111-1111-4111-8111-111111111111' };
  await workspace.handle('transact', { records: [{ ...before, expectedRevision: before.revision }] });
  before = await workspace.handle('read', { collection: 'workflows', id: 'workflow' });
  const proposal = { baseRevision: before.revision, summary: 'Improve delay', operations: [{ op: 'updateNode', nodeId: 'wait', changes: { data: { delayMs: 1, apiConfig: { model: 'new' } } } }] };
  const preview = await invoke('previewGraphProposal', { proposal });
  assert.equal(preview.preview.validation.valid, true); assert.equal(preview.preview.changes[0].kind, 'updated');
  assert.equal((await workspace.handle('read', { collection: 'workflows', id: 'workflow' })).revision, before.revision);
  const applied = await invoke('applyGraphProposal', { proposalId: preview.record.id, expectedRevision: preview.record.revision });
  assert.equal(applied.workflow.value.nodes[0].data.delayMs, 1); assert.equal(applied.workflow.value.nodes[0].data.apiConfig.model, 'new');
  assert.match(applied.workflow.value.nodes[0].data.apiConfig.apiKey, /^secret:/); assert.equal(applied.workflow.value.nodes[0].data.name, 'Wait');
  await assert.rejects(invoke('applyGraphProposal', { proposalId: preview.record.id, expectedRevision: preview.record.revision }), /changed|already applied/);
  const stale = await invoke('previewGraphProposal', { proposal: { ...proposal, baseRevision: applied.workflow.revision } });
  await workspace.handle('transact', { records: [{ ...applied.workflow, expectedRevision: applied.workflow.revision, value: { ...applied.workflow.value, name: 'User edit' } }] });
  await assert.rejects(invoke('applyGraphProposal', { proposalId: stale.record.id, expectedRevision: stale.record.revision }), /graph changed/);
  assert.equal((await workspace.handle('read', { collection: 'workflows', id: 'workflow' })).value.name, 'User edit');
});
test('Invalid edges, cycles, unsupported nodes, credentials, prototype keys and unknown operations fail before writes', async t => {
  const { invoke, workflow } = await setup(t), ctx = await invoke('graphContext');
  const badOperations = [
    [{ op: 'addNode', node: { id: 'bad', type: 'unsupported', data: {} } }],
    [{ op: 'addEdge', edge: { id: 'bad', source: 'wait', target: 'absent' } }],
    [{ op: 'addEdge', edge: { id: 'bad', source: 'wait', target: 'wait' } }],
    [{ op: 'updateNode', nodeId: 'wait', changes: { id: 'replace' } }],
    [{ op: 'updateNode', nodeId: 'wait', changes: { data: { apiKey: 'leak' } } }],
    [{ op: 'updateNode', nodeId: 'wait', changes: JSON.parse('{"data":{"__proto__":{"polluted":true}}}') }],
    [{ op: 'runCommand', command: 'not allowed' }]
  ];
  for (const operations of badOperations) await assert.rejects(invoke('previewGraphProposal', { proposal: { baseRevision: ctx.revision, summary: 'Invalid fixture', operations } }));
  assert.equal((await invoke('listGraphProposals')).records.length, 0); assert.equal({}.polluted, undefined);
  const changed = applyOperations(workflow, [{ op: 'addNode', node: { id: 'second', type: 'wait-delay', data: { delayMs: 0 } } }, { op: 'addEdge', edge: { id: 'ok', source: 'wait', target: 'second' } }, { op: 'removeNode', nodeId: 'wait' }]);
  assert.equal(changed.workflow.nodes.length, 1); assert.equal(changed.workflow.edges.length, 0);
});
test('Checks execute selected dependency closure and store genuine revision-bound evidence', async t => {
  const { invoke, workspace, calls } = await setup(t);
  const record = await workspace.handle('read', { collection: 'workflows', id: 'workflow' });
  record.value.nodes.push({ id: 'second', type: 'wait-delay', data: { delayMs: 0 } }, { id: 'unrelated', type: 'wait-delay', data: { delayMs: 0 } }); record.value.edges.push({ id: 'link', source: 'wait', target: 'second' });
  await workspace.handle('transact', { records: [{ ...record, expectedRevision: record.revision }] });
  const result = await invoke('runGraphChecks', { nodeIds: ['second'] });
  assert.equal(result.status, 'SUCCESS'); assert.equal(result.fresh, true); assert.deepEqual(result.executedNodeIds.sort(), ['second', 'wait']);
  assert.deepEqual(calls[0].selectedNodeIds, ['second']); assert.equal(result.hash, hash(record.value));
  assert.equal((await workspace.handle('read', { collection: 'agent-graph-checks', id: result.id })).value.runId, result.runId);
  const runnerGraph = { nodes: [{ id: 'runner', type: 'start-runner', data: {} }, { id: 'isolated', type: 'wait-delay', data: {} }], edges: [] };
  assert.deepEqual(GraphEngine.executionPlan(runnerGraph, { selectedNodeIds: ['isolated'] }).workflow.nodes.map(node => node.id), ['isolated']);
});
test('Check cancellation is scoped to its request and no unrelated run can be cancelled', async t => {
  let started; const start = new Promise(resolve => { started = resolve; });
  const { invoke } = await setup(t, { execute: async ({ signal }) => { started(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); return { id: crypto.randomUUID(), status: 'CANCELLED', results: { wait: { status: 'CANCELLED' } } }; } });
  const request = crypto.randomUUID(), pending = invoke('runGraphChecks', { runId: request }); await start;
  await assert.rejects(invoke('cancelGraphChecks', { runId: crypto.randomUUID() }), /no longer running/);
  assert.equal((await invoke('cancelGraphChecks', { runId: request })).cancelled, true); assert.equal((await pending).status, 'CANCELLED');
});
test('Workspace binding and board membership prevent foreign requests', async t => {
  const { invoke, service } = await setup(t);
  await assert.rejects(service.handle('graphContext', { workspaceRoot: '/foreign', workflowId: 'workflow' }), /original workspace/);
  await assert.rejects(invoke('analyzeGraph', { boardId: 'missing', agentId: 'none', instruction: 'Inspect this graph' }), /Choose an agent/);
});
test('Credential policy covers native names, serialized headers, schema secrets, derived errors and ancestor replacement', async t => {
  const {invoke,workspace}=await setup(t);let record=await workspace.handle('read',{collection:'workflows',id:'workflow'});
  Object.assign(record.value.nodes[0].data,{api_token:'FAKE_API_TOKEN',auth:'FAKE_AUTH',private_key:'FAKE_PRIVATE_KEY',headersJson:'{"Authorization":"FAKE_HEADER"}',parameterSchema:{custom:{secret:true}},parameters:{custom:'FAKE_CUSTOM'},apiConfig:{apiKey:'secret:11111111-1111-4111-8111-111111111111'}});
  await workspace.handle('transact',{records:[{...record,expectedRevision:record.revision}]});
  const context=await invoke('graphContext');for(const secret of ['FAKE_API_TOKEN','FAKE_AUTH','FAKE_PRIVATE_KEY','FAKE_HEADER','FAKE_CUSTOM','secret:1111'])assert.ok(!context.packet.includes(secret),secret);
  for(const data of [{api_token:'NEW'},{auth:'NEW'},{private_key:'NEW'},{headersJson:'{"Authorization":"NEW"}'},{url:'https://fake-token@example.com'},{parameters:{custom:'NEW'}},{apiConfig:null},{apiConfig:[]},{apiConfig:'replacement'},{headersJson:{replacement:true}}])await assert.rejects(invoke('previewGraphProposal',{proposal:{baseRevision:context.revision,summary:'Invalid credential change',operations:[{op:'updateNode',nodeId:'wait',changes:{data}}]}}));
  record=await workspace.handle('read',{collection:'workflows',id:'workflow'});record.value.nodes[0].type='secret:11111111-1111-4111-8111-111111111111';
  await workspace.handle('transact',{records:[{...record,expectedRevision:record.revision}]});
  const invalid=await invoke('graphContext');assert.equal(invalid.summary.validation.valid,false);assert.ok(!invalid.packet.includes('secret:1111'));
});
