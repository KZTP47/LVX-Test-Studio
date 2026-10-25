'use strict';
const crypto = require('node:crypto');
const GraphEngine = require('../../graph-engine.js');
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code, message) => { throw Object.assign(Error(message), { code }); };
const TYPES = GraphEngine.nodeTypes();
const { secretField } = require('../protect-configuration.cjs');
const sensitive = key => secretField.test(key) || /credential|secretReference|nativeSessionProof|^(?:cookie|set-cookie)$/i.test(key);
const jsonSetting = key => /^(?:headers|headersJson|headerJson|body|requestBody)$/i.test(key);
const credentialValue = (parent, key) => key === 'value' && (parent?.secret === true || parent?.isSecret === true || sensitive(parent?.key || parent?.name || '')) || ['value','expected','text'].includes(key) && /fill|input|type/i.test(String(parent?.action || parent?.type || '')) && /password|passwd|api[_-]?key|access[_-]?token/i.test(String(parent?.selector || parent?.name || parent?.field || ''));
function safeContext(value, redact = value => value) {
  function clean(value, parent, field = '') {
    if (credentialValue(parent, field)) return '[REDACTED]';
    if (Array.isArray(value)) return value.map(child => clean(child));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sensitive(key) || field === 'parameters' && (parent?.parameterSchema?.[key]?.secret === true || parent?.parameter_schema?.[key]?.secret === true) ? '[REDACTED]' : clean(child, value, key)]));
    if (typeof value === 'string' && jsonSetting(field) && /^\s*[\[{]/.test(value)) { try { return JSON.stringify(clean(JSON.parse(value))); } catch {} }
    return typeof value === 'string' ? value.replace(/secret:[a-f0-9-]{36}/gi, '[REDACTED REFERENCE]').replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[REDACTED]@') : value;
  }
  return clean(redact(copy(value)));
}
function noCredentials(value, parent, field = '') {
  if (credentialValue(parent, field)) fail('VALIDATION', 'Credential values must be configured in the protected node dialog.');
  if (Array.isArray(value)) return value.forEach(child => noCredentials(child));
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key) || sensitive(key)) fail('VALIDATION', 'Graph proposals cannot contain credentials or unsafe object keys. Configure credentials in the node dialog.');
    noCredentials(child, value, key);
  }
  if (typeof value === 'string' && /secret:[a-f0-9-]{36}|\[REDACTED(?: REFERENCE)?\]/i.test(value)) fail('VALIDATION', 'Do not put redacted placeholders or credential references into graph edits. Existing credentials are preserved automatically.');
  if (typeof value === 'string' && /https?:\/\/[^\s/@]+@/i.test(value)) fail('VALIDATION', 'URLs containing credentials must be configured in the protected node dialog.');
  if (typeof value === 'string' && jsonSetting(field) && /^\s*[\[{]/.test(value)) { let parsed; try { parsed = JSON.parse(value); } catch { fail('VALIDATION', 'JSON request settings must be valid JSON.'); } noCredentials(parsed); }
}
function validate(workflow) {
  const result = GraphEngine.validate(workflow, { strict: true });
  if (!result.valid) fail('INVALID_GRAPH', result.errors.join(' '));
  if (!workflow.nodes.length) fail('INVALID_GRAPH', 'A workflow needs at least one node.');
  return result;
}
function applyOperations(workflow, operations) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 200) fail('VALIDATION', 'Provide between 1 and 200 graph changes.');
  const next = copy(workflow), changes = [];
  for (const operation of operations) {
    noCredentials(operation);
    const node = next.nodes.find(node => node.id === operation.nodeId);
    switch (operation.op) {
      case 'addNode':
        if (!operation.node || next.nodes.some(node => node.id === operation.node.id)) fail('VALIDATION', 'The added node needs a new unique ID.');
        next.nodes.push(copy(operation.node)); changes.push({ kind: 'added', entity: 'node', id: operation.node.id, label: operation.node.data?.name || operation.node.id }); break;
      case 'updateNode': {
        if (!node) fail('NOT_FOUND', 'The node to change no longer exists.');
        const allowed = ['type', 'data', 'position', 'retry', 'resources', 'onFailure', 'inputs', 'outputs'];
        if (!operation.changes || typeof operation.changes !== 'object' || Array.isArray(operation.changes) || Object.keys(operation.changes).some(key => !allowed.includes(key))) fail('VALIDATION', 'Node updates support type, settings, position, retry, resources, failure behavior and ports.');
        const prior = copy(node);
        for (const [key, value] of Object.entries(operation.changes)) {
          if (key === 'data') {
            if (!value || typeof value !== 'object' || Array.isArray(value)) fail('VALIDATION', 'Node settings must be an object.');
            for (const name of Object.keys(value.parameters || {})) if (node.data?.parameterSchema?.[name]?.secret === true || node.data?.parameter_schema?.[name]?.secret === true) fail('VALIDATION', 'Secret parameters must be changed in the protected node dialog.');
            const protectedValue = (value, key) => JSON.stringify(safeContext({[key]:value})) !== JSON.stringify({[key]:value});
            const merge = (prior, incoming) => Object.fromEntries([...new Set([...Object.keys(prior || {}), ...Object.keys(incoming)])].map(key => {
              if (!(key in incoming)) return [key, prior[key]];
              if (incoming[key] && typeof incoming[key] === 'object' && !Array.isArray(incoming[key])) {
                if (prior?.[key] !== undefined && (typeof prior[key] !== 'object' || Array.isArray(prior[key]) || prior[key] === null) && protectedValue(prior[key], key)) fail('VALIDATION', 'This change would replace protected credential settings. Use the node configuration dialog.');
                return [key, merge(prior?.[key] && typeof prior[key] === 'object' && !Array.isArray(prior[key]) ? prior[key] : {}, incoming[key])];
              }
              if (prior?.[key] !== undefined && protectedValue(prior[key], key)) fail('VALIDATION', 'This change would replace protected credential settings. Use the node configuration dialog.');
              return [key, copy(incoming[key])];
            }));
            node.data = merge(node.data, value);
          } else node[key] = copy(value);
        }
        changes.push({ kind: 'updated', entity: 'node', id: node.id, label: node.data?.name || node.id, before: prior, after: copy(node) }); break;
      }
      case 'removeNode':
        if (!node) fail('NOT_FOUND', 'The node to remove no longer exists.');
        next.nodes = next.nodes.filter(item => item.id !== node.id);
        for (const edge of next.edges.filter(edge => edge.source === node.id || edge.target === node.id)) changes.push({ kind: 'removed', entity: 'edge', id: edge.id || `${edge.source}->${edge.target}`, source: edge.source, target: edge.target });
        next.edges = next.edges.filter(edge => edge.source !== node.id && edge.target !== node.id);
        changes.push({ kind: 'removed', entity: 'node', id: node.id, label: node.data?.name || node.id }); break;
      case 'addEdge': {
        const edge = operation.edge;
        if (!edge || !edge.id || next.edges.some(item => item.id === edge.id || item.source === edge.source && item.target === edge.target)) fail('VALIDATION', 'The connection needs a unique ID and must not already exist.');
        next.edges.push(copy(edge)); changes.push({ kind: 'added', entity: 'edge', id: edge.id, source: edge.source, target: edge.target }); break;
      }
      case 'removeEdge': {
        const edge = next.edges.find(edge => edge.id === operation.edgeId);
        if (!edge) fail('NOT_FOUND', 'The connection to remove no longer exists.');
        next.edges = next.edges.filter(item => item !== edge); changes.push({ kind: 'removed', entity: 'edge', id: edge.id, source: edge.source, target: edge.target }); break;
      }
      default: fail('VALIDATION', 'Unknown graph change. Use addNode, updateNode, removeNode, addEdge or removeEdge.');
    }
  }
  validate(next);
  return { workflow: next, changes };
}
function createGraphService({ workspace, getWorkspaceRoot, agents, execute, cancel, assertAllowed = async () => {}, redact = value => value, emit = () => {} }) {
  const activeChecks = new Map();
  const read = (collection, id, binding) => workspace.handle('read', { collection, id, workspaceRoot: binding });
  const list = (collection, binding) => workspace.handle('list', { collection, workspaceRoot: binding });
  const bindingFor = payload => {
    const binding = getWorkspaceRoot();
    if (!binding || payload.workspaceRoot !== binding) fail('WORKSPACE_CHANGED', 'Choose the original workspace before using graph collaboration.');
    return binding;
  };
  const stillBound = binding => { if (getWorkspaceRoot() !== binding) fail('WORKSPACE_CHANGED', 'Workspace changed during graph collaboration. Return to the original project.'); };
  async function graph(workflowId, binding) {
    const record = await read('workflows', workflowId, binding);
    if (!record) fail('NOT_FOUND', 'Save a graph workflow before asking an agent to work on it.');
    if (!Array.isArray(record.value.nodes) || !Array.isArray(record.value.edges)) fail('INVALID_GRAPH', 'The saved graph has no readable nodes or connections.');
    return record;
  }
  async function context(payload) {
    const binding = bindingFor(payload), record = await graph(payload.workflowId, binding);
    const nodeIds = payload.nodeIds || [];
    if (!Array.isArray(nodeIds) || nodeIds.some(id => !record.value.nodes.some(node => node.id === id))) fail('VALIDATION', 'Select nodes that belong to this saved graph.');
    const workflow = safeContext(record.value, redact), validation = GraphEngine.validate(record.value, { strict: true });
    const selectedNodeIds = [...new Set(nodeIds)];
    const recent = (await list('runs', binding)).records || [];
    const result = { workflowId: record.id, revision: record.revision, hash: hash(record.value), workflow, selectedNodeIds,
      summary: { name: workflow.name || record.id, nodeCount: workflow.nodes.length, edgeCount: workflow.edges.length, validation: { valid: validation.valid, errors: validation.errors }, roots: workflow.nodes.filter(node => !workflow.edges.some(edge => edge.target === node.id)).map(node => node.id),
        nodes: workflow.nodes.map(node => ({ id: node.id, name: node.data?.name || node.id, type: GraphEngine.normalizeNodeType(node.type), upstream: workflow.edges.filter(edge => edge.target === node.id).map(edge => edge.source), downstream: workflow.edges.filter(edge => edge.source === node.id).map(edge => edge.target), selected: selectedNodeIds.includes(node.id) })),
        latestRuns: recent.filter(run => run.value.workflowHash === hash(GraphEngine.validate(record.value, { strict: true }).workflow)).slice(-5).map(run => safeContext({ id: run.id, status: run.value.status, results: run.value.results }, redact)) },
      nodeCatalog: TYPES.map(type => ({ type, name: require('../machina-catalog.cjs').nodes.find(node => node.id === type)?.name || type, supports: 'inspect settings, dependencies, ports, execution and reviewed edits' })) };
    const cleaned = safeContext(result, redact);
    cleaned.packet = '[Saved LVX workflow graph]\n' + JSON.stringify(cleaned, null, 2);
    stillBound(binding); return cleaned;
  }
  async function performChecks(payload, controller) {
    const binding = bindingFor(payload), record = await graph(payload.workflowId, binding);
    validate(record.value);
    const nodeIds = payload.nodeIds || [];
    if (!Array.isArray(nodeIds) || nodeIds.some(id => !record.value.nodes.some(node => node.id === id))) fail('VALIDATION', 'The selected check nodes no longer exist.');
    let selected = copy(record.value);
    if (nodeIds.length) {
      const keep = new Set(nodeIds), visit = id => { for (const edge of record.value.edges.filter(edge => edge.target === id)) if (!keep.has(edge.source)) { keep.add(edge.source); visit(edge.source); } };
      nodeIds.forEach(visit); selected.nodes = selected.nodes.filter(node => keep.has(node.id)); selected.edges = selected.edges.filter(edge => keep.has(edge.source) && keep.has(edge.target));
      // Explicit selections execute all chosen dependency closures, including nodes outside runner scopes.
    }
    await assertAllowed(record.value, binding); stillBound(binding);
    if (controller.signal.aborted) fail('CANCELLED', 'Graph checks were stopped before launch.');
    const run = await execute({ workflow: selected, workspaceRoot: binding, selectedNodeIds: nodeIds.length ? nodeIds : undefined, signal: controller.signal });
    stillBound(binding);
    const current = await graph(record.id, binding), fresh = current.revision === record.revision && hash(current.value) === hash(record.value);
    const result = { ...safeContext(run, redact), id: run.id, runId: run.id, workflowId: record.id, revision: record.revision, hash: hash(record.value), status: run.status, fresh, selectedNodeIds: nodeIds, executedNodeIds: Object.keys(run.results || {}) };
    if (result.executedNodeIds.length === 0) result.status = 'ERROR';
    await workspace.handle('transact', { workspaceRoot: binding, records: [{ collection: 'agent-graph-checks', id: run.id, value: result, expectedRevision: null }] });
    emit({ type: 'graph-checks-finished', workflowId: record.id, runId: run.id, status: result.status, fresh }); return result;
  }
  async function runChecks(payload) {
    const binding = bindingFor(payload), id = payload.runId || crypto.randomUUID();
    if (!/^[a-f0-9-]{36}$/i.test(id)) fail('VALIDATION', 'A graph check request ID must be a UUID.');
    if (activeChecks.has(id)) fail('CONFLICT', 'This graph check is already running.');
    const controller = new AbortController(), entry = { binding, controller, promise: null };
    activeChecks.set(id, entry);
    try { entry.promise = performChecks(payload, controller); return await entry.promise; }
    finally { activeChecks.delete(id); }
  }
  async function handle(action, payload = {}) {
    const binding = bindingFor(payload);
    if (action === 'graphContext') return context(payload);
    if (action === 'runGraphChecks') return runChecks(payload);
    if (action === 'cancelGraphChecks') { const entry = activeChecks.get(payload.runId); if (!entry || entry.binding !== binding) fail('NOT_FOUND', 'This graph check is no longer running.'); entry.controller.abort(); return { cancelled: true }; }
    if (action === 'analyzeGraph') {
      if (typeof payload.instruction !== 'string' || !payload.instruction.trim() || payload.instruction.length > 128 * 1024) fail('VALIDATION', 'Describe what you want the agent to examine or improve.');
      const ctx = await context(payload), board = await read('agent-boards', payload.boardId, binding);
      if (!board?.value.nodes.some(node => node.id === payload.agentId)) fail('NOT_FOUND', 'Choose an agent from the saved board.');
      await assertAllowed(board.value, binding); stillBound(binding);
      ctx.packet = payload.instruction + '\n\n' + ctx.packet;
      const sent = await agents.handle('send', { workspaceRoot: binding, boardId: board.id, agentId: payload.agentId, text: ctx.packet, requestId: crypto.randomUUID() });
      const run = await read('agent-runs', sent.runId, binding);
      return { run: run?.value || sent, context: ctx };
    }
    if (action === 'listGraphProposals') return { records: ((await list('agent-graph-proposals', binding)).records || []).filter(record => record.value.workflowId === payload.workflowId) };
    if (action === 'previewGraphProposal') {
      const record = await graph(payload.workflowId, binding), proposal = payload.proposal;
      if (!proposal || proposal.baseRevision !== record.revision) fail('CONFLICT', 'The saved graph changed. Refresh its snapshot and ask for an updated proposal.');
      if (typeof proposal.summary !== 'string' || !proposal.summary.trim() || proposal.summary.length > 20000) fail('VALIDATION', 'Give the proposed changes a short explanation.');
      const changed = applyOperations(record.value, proposal.operations), id = crypto.randomUUID();
      const value = { id, workflowId: record.id, baseRevision: record.revision, baseHash: hash(record.value), summary: proposal.summary, operations: copy(proposal.operations), status: 'preview', createdAt: new Date().toISOString(), afterHash: hash(changed.workflow) };
      stillBound(binding);
      await workspace.handle('transact', { workspaceRoot: binding, records: [{ collection: 'agent-graph-proposals', id, value, expectedRevision: null }] });
      return { record: await read('agent-graph-proposals', id, binding), preview: { before: safeContext(record.value, redact), after: safeContext(changed.workflow, redact), changes: safeContext(changed.changes, redact), validation: { valid: true, errors: [] } } };
    }
    if (action === 'applyGraphProposal') {
      const proposal = await read('agent-graph-proposals', payload.proposalId, binding);
      if (!proposal || proposal.revision !== payload.expectedRevision || proposal.value.status !== 'preview') fail('CONFLICT', 'This proposal changed or was already applied. Preview it again.');
      const record = await graph(proposal.value.workflowId, binding);
      if (record.revision !== proposal.value.baseRevision || hash(record.value) !== proposal.value.baseHash) fail('CONFLICT', 'The graph changed after preview. Your existing edits were preserved.');
      const changed = applyOperations(record.value, proposal.value.operations);
      if (hash(changed.workflow) !== proposal.value.afterHash) fail('CONFLICT', 'The proposal changed after preview.');
      await assertAllowed(record.value, binding); stillBound(binding);
      await workspace.handle('transact', { workspaceRoot: binding, records: [
        { collection: 'workflows', id: record.id, value: changed.workflow, expectedRevision: record.revision },
        { collection: 'agent-graph-proposals', id: proposal.id, value: { ...proposal.value, status: 'applied', appliedAt: new Date().toISOString() }, expectedRevision: proposal.revision }
      ] });
      emit({ type: 'graph-proposal-applied', workflowId: record.id, proposalId: proposal.id });
      return { record: await read('agent-graph-proposals', proposal.id, binding), workflow: await read('workflows', record.id, binding) };
    }
    fail('UNKNOWN_ACTION', 'Unknown graph collaboration operation.');
  }
  async function drain() { const entries = [...activeChecks.values()]; entries.forEach(entry => entry.controller.abort()); await Promise.allSettled(entries.map(entry => entry.promise)); }
  return { handle, context, runChecks, drain };
}
module.exports = { createGraphService, applyOperations, safeContext, hash };
