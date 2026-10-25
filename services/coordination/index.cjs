'use strict';

// Mission coordination is a durable control plane. Provider work and native
// checks run outside its lock; every later write is fenced by its saved claim.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const KEY = /^[a-zA-Z0-9][a-zA-Z0-9_.@:-]{0,159}$/;
const STATES = new Set(['todo', 'active', 'review', 'done', 'blocked']);
const TERMINAL_FAILURE = new Set(['blocked', 'limit', 'partial', 'error', 'cancelled', 'interrupted']);
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = () => new Date().toISOString();
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function identifier(value, label) { if (typeof value !== 'string' || !KEY.test(value)) fail('VALIDATION', `${label} needs a simple identifier.`); return value; }
function text(value, label, limit = 65536) { if (typeof value !== 'string' || Buffer.byteLength(value) > limit || value.includes('\0')) fail('VALIDATION', `${label} must be text no larger than ${limit} bytes.`); return value; }
function required(value, label, limit) { const result = text(value, label, limit); if (!result.trim()) fail('VALIDATION', `${label} cannot be empty.`); return result; }
function ids(value, label) { if (!Array.isArray(value) || value.length > 1000 || new Set(value).size !== value.length) fail('VALIDATION', `${label} must be a list of distinct identifiers.`); return value.map(v => identifier(v, label)); }
function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('VALIDATION', `${label} must be an object.`); return value; }
function unwrap(result) { return result?.run || result?.record?.value || result?.value || result; }
function workspacePath(value) { if (value === null) return null; if (typeof value !== 'string' || !path.isAbsolute(value) || !fs.statSync(value).isDirectory()) fail('VALIDATION', 'Choose an existing absolute workspace folder.'); return fs.realpathSync(value); }

function createService({ workspace, workspaceRoot = null, sendTask, getTaskRun, graphContext, runChecks, emit = () => {} } = {}) {
  if (!workspace?.handle) throw Error('Coordination requires the canonical workspace service.');
  let root = workspacePath(workspaceRoot);
  let closed = false, initialized = false, chain = Promise.resolve(), generation = 0;
  const live = new Set(), submissions = new Set();
  function serialized(fn) { const operation = chain.then(fn); chain = operation.catch(() => {}); return operation; }
  function binding(payload) {
    if (closed) fail('CLOSED', 'Project coordination is closed.');
    if (!root) fail('WORKSPACE_REQUIRED', 'Choose a workspace first.');
    let candidate; try { candidate = typeof payload.workspaceRoot === 'string' && fs.realpathSync(payload.workspaceRoot); } catch {}
    if (candidate !== root) fail('WORKSPACE_CHANGED', 'Workspace changed; reopen the project before continuing.');
    return { root, generation };
  }
  function current(ticket) { if (closed || root !== ticket.root || generation !== ticket.generation) fail('WORKSPACE_CHANGED', 'Workspace changed during the operation; no result was applied.'); }
  async function call(action, payload = {}) {
    const ticket = { root, generation };
    const status = await workspace.handle('status', { workspaceRoot: ticket.root });
    current(ticket);
    if (status.workspaceRoot !== ticket.root) fail('WORKSPACE_CHANGED', 'The canonical workspace changed. Reopen this project before continuing.');
    const result = await workspace.handle(action, { ...payload, workspaceRoot: ticket.root }); current(ticket); return result;
  }
  // One canonical SQLite snapshot prevents skew between mission, dependencies,
  // board membership and concurrent ownership checks.
  async function snapshot() { return call('list'); }
  function find(s, collection, id) { return s.records.find(r => r.collection === collection && r.id === id); }
  function missionRecord(s, id) { identifier(id, 'Project ID'); const r = find(s, 'agent-missions', id); if (!r) fail('NOT_FOUND', 'Project was not found in this workspace.'); return r; }
  function taskRecord(s, missionId, taskId) { identifier(taskId, 'Task ID'); const r = find(s, 'agent-tasks', taskId); if (!r || r.value.missionId !== missionId) fail('NOT_FOUND', 'Task does not belong to this project.'); return r; }
  function revision(r, expected) { if ((r?.revision ?? null) !== expected || (expected !== null && (!Number.isSafeInteger(expected) || expected < 1))) fail('CONFLICT', 'This record changed. Reload it before saving; your draft has been kept.'); }
  function tasks(s, missionId) { return s.records.filter(r => r.collection === 'agent-tasks' && r.value.missionId === missionId); }
  function board(s, mission, agentId) { const b = find(s, 'agent-boards', mission.boardId); if (!b) fail('BOARD_REQUIRED', 'Choose an existing agent board for this project.'); if (agentId && !b.value.nodes?.some(n => n.id === agentId)) fail('AGENT_REQUIRED', 'Choose an agent belonging to this project’s board.'); return b; }
  function dependencyCheck(s, missionId, task, requireDone = false) {
    for (const dependency of task.dependsOn) {
      if (dependency === task.id) fail('DEPENDENCY_CYCLE', 'A task cannot depend on itself.');
      const other = taskRecord(s, missionId, dependency);
      if (requireDone && other.value.status !== 'done') fail('DEPENDENCY_BLOCKED', `Finish and approve dependency “${other.value.title}” first.`);
    }
    const all = new Map(tasks(s, missionId).map(r => [r.id, r.value])); all.set(task.id, task);
    const visiting = new Set(), visited = new Set();
    function visit(id) { if (visiting.has(id)) fail('DEPENDENCY_CYCLE', 'Task dependencies cannot form a cycle.'); if (visited.has(id)) return; visiting.add(id); for (const dep of all.get(id)?.dependsOn || []) visit(dep); visiting.delete(id); visited.add(id); }
    for (const id of all.keys()) visit(id);
  }
  function append(record, action, details = {}) {
    const history = record.history || [];
    if (history.length >= 2000) fail('HISTORY_LIMIT', 'This task has reached its history limit. Create a follow-up task to preserve its complete history.');
    return { ...record, updatedAt: now(), history: [...history, { action, at: now(), ...copy(details) }] };
  }
  async function commit(s, collection, recordId, value, prior) {
    await call('transact', { expectedWorkspaceRevision: s.revision, records: [{ collection, id: recordId, expectedRevision: prior?.revision ?? null, value }] });
    const record = await call('read', { collection, id: recordId });
    try { emit({ domain: 'coordination', type: 'changed', workspaceRoot: root, collection, id: recordId, revision: record.revision }); } catch {}
    return record;
  }
  async function initialize() {
    if (initialized) return;
    const s = await snapshot();
    const interrupted = s.records.filter(r => r.collection === 'agent-tasks' && r.value.status === 'active');
    if (interrupted.length) {
      await call('transact', { expectedWorkspaceRevision: s.revision, records: interrupted.map(r => ({ collection: r.collection, id: r.id, expectedRevision: r.revision, value: append({ ...r.value, status: 'blocked', operationId: null, error: 'Application restarted during this task. Review the existing conversation and effects before explicitly restarting; nothing was replayed.' }, 'interrupted') })) });
    }
    initialized = true;
  }
  async function contextFor(mission, task, workspaceBinding = root) {
    if (!mission.workflowId) { if (task.workflowNodeIds.length) fail('WORKFLOW_REQUIRED', 'Choose a workflow before selecting its nodes.'); return null; }
    if (typeof graphContext !== 'function') fail('CHECKS_UNAVAILABLE', 'Workflow context is unavailable.');
    const context = await graphContext({ workspaceRoot: workspaceBinding, workflowId: mission.workflowId, nodeIds: task.workflowNodeIds });
    object(context, 'Workflow context');
    if (context.workflowId !== mission.workflowId || !Number.isSafeInteger(context.revision) || context.revision < 1 || !/^[a-f0-9]{64}$/i.test(context.hash || '')) fail('EVIDENCE_INVALID', 'Workflow context has no canonical revision and fingerprint.');
    let selected = ids(context.selectedNodeIds, 'Selected workflow nodes');
    if (!selected.length && !task.workflowNodeIds.length) selected = ids(context.workflow?.nodes?.map(n => n.id) || [], 'Whole workflow nodes');
    if (!selected.length || task.workflowNodeIds.some(id => !selected.includes(id))) fail('EVIDENCE_INVALID', 'Selected workflow nodes were not found in the canonical graph.');
    return { ...copy(context), selectedNodeIds: selected };
  }
  async function priorRunSettled(s, mission, task) {
    if (!task.runId) return;
    const canonical = find(s, 'agent-runs', task.runId);
    const run = typeof getTaskRun === 'function' ? unwrap(await getTaskRun({ workspaceRoot: root, mission: copy(mission), task: copy(task) })) : canonical?.value;
    // Native dispatch uses a durable request ID before launching the provider.
    // No canonical request and no callback run means that send was not admitted.
    if (!canonical && !run) return;
    if (!run || run.id !== task.runId || run.boardId !== mission.boardId || !['completed', ...TERMINAL_FAILURE].includes(run.status)) fail('RUN_PENDING', 'The previous native run may still be working. Stop or finish it before editing or restarting this task.');
  }
  function packetFor(mission, task, context) {
    const packet = `Project: ${mission.name}\nGoal:\n${mission.goal}\nProject acceptance criteria:\n${mission.criteria}\n\nTask: ${task.title}\nTask description:\n${task.description}\nTask acceptance criteria:\n${task.criteria}\nDependencies: ${task.dependsOn.join(', ') || '(none)'}\n${context ? `\nCanonical workflow context (revision ${context.revision}, SHA-256 ${context.hash}):\n${JSON.stringify(context, null, 2)}` : ''}`;
    return text(packet, 'Task and workflow packet', 4 * 1024 * 1024);
  }
  function nativeRun(result, mission, task) {
    const run = unwrap(result);
    if (!run || run.id !== task.runId || run.boardId !== mission.boardId) fail('EVIDENCE_INVALID', 'The native run does not match this task and board.');
    if (run.status !== 'completed') fail(TERMINAL_FAILURE.has(run.status) ? 'RUN_FAILED' : 'RUN_PENDING', `The agent run is ${run.status || 'unavailable'}; only a completed native run can be submitted.`);
    return { id: run.id, boardId: run.boardId, status: run.status, ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}), ...(run.requestFingerprint ? { requestFingerprint: run.requestFingerprint } : {}) };
  }
  function checksEvidence(result, context) {
    object(result, 'Native check evidence');
    const runId = identifier(result.runId || result.id, 'Native check run ID');
    if (result.status !== 'SUCCESS' || result.fresh !== true || result.workflowId !== context.workflowId || result.hash !== context.hash || result.revision !== context.revision) fail('CHECKS_FAILED', 'Native workflow checks did not pass against the current saved graph.');
    const executed = ids(result.executedNodeIds, 'Executed workflow nodes');
    const results = Array.isArray(result.results) ? result.results : result.results && typeof result.results === 'object' ? Object.entries(result.results).map(([nodeId, r]) => ({ ...r, nodeId })) : [];
    if (!executed.length || context.selectedNodeIds.some(id => !executed.includes(id)) || !results.length || results.some(r => !r || r.status !== 'SUCCESS') || context.selectedNodeIds.some(id => !results.some(r => (r.nodeId || r.id) === id && r.status === 'SUCCESS'))) fail('CHECKS_FAILED', 'Every selected workflow node must have genuine passing execution evidence.');
    return { runId, workflowId: context.workflowId, revision: context.revision, hash: context.hash, status: 'SUCCESS', fresh: true, selectedNodeIds: context.selectedNodeIds, executedNodeIds: executed, results: results.map(r => ({ ...(r.nodeId ? { nodeId: r.nodeId } : {}), ...(r.id ? { id: r.id } : {}), status: r.status })) };
  }
  async function prepare(action, payload) {
    const ticket = binding(payload); await initialize();
    const s = await snapshot();
    if (action === 'listMissions') return { result: { records: s.records.filter(r => r.collection === 'agent-missions') } };
    if (action === 'saveMission') {
      const input = object(payload.mission, 'Project'), id = identifier(input.id, 'Project ID'), prior = find(s, 'agent-missions', id); revision(prior, payload.expectedRevision);
      const value = { id, name: required(input.name, 'Project name', 300), goal: required(input.goal, 'Project goal'), criteria: text(input.criteria ?? '', 'Project acceptance criteria'), boardId: identifier(input.boardId, 'Agent board ID'), ...(input.workflowId ? { workflowId: identifier(input.workflowId, 'Workflow ID') } : {}) };
      board(s, value);
      if (value.workflowId && !find(s, 'workflows', value.workflowId)) fail('NOT_FOUND', 'The selected workflow is not saved in this workspace.');
      if (prior && tasks(s, id).some(t => ['active', 'review', 'done'].includes(t.value.status)) && ['goal', 'criteria', 'boardId', 'workflowId'].some(k => prior.value[k] !== value[k])) fail('ACTIVE_TASK', 'This project has active or reviewed work. Create a new project to change its goal, board or workflow without invalidating its evidence.');
      if (prior && tasks(s, id).some(t => !value.workflowId && t.value.workflowNodeIds.length)) fail('WORKFLOW_REQUIRED', 'Tasks still refer to workflow nodes. Clear those node selections before removing the workflow.');
      return { result: { record: await commit(s, 'agent-missions', id, append({ ...value, createdAt: prior?.value.createdAt || now(), history: prior?.value.history || [] }, prior ? 'project-updated' : 'project-created'), prior) } };
    }
    const mr = missionRecord(s, payload.missionId), mission = mr.value;
    if (action === 'listTasks') return { result: { records: tasks(s, mission.id) } };
    if (action === 'saveTask') {
      const input = object(payload.task, 'Task'), id = identifier(input.id, 'Task ID'), existing = find(s, 'agent-tasks', id); if (existing && existing.value.missionId !== mission.id) fail('CONFLICT', 'Task ID already belongs to another project.'); revision(existing, payload.expectedRevision);
      if (input.missionId !== undefined && input.missionId !== mission.id) fail('VALIDATION', 'Task belongs to another project.');
      const status = input.status ?? existing?.value.status ?? 'todo';
      if (!STATES.has(status) || (!existing && status !== 'todo') || (existing && status !== existing.value.status && !(existing.value.status === 'blocked' && status === 'todo'))) fail('INVALID_TRANSITION', 'Use Start, Submit and Review to change task status.');
      if (existing && ['active', 'review', 'done'].includes(existing.value.status)) fail('ACTIVE_TASK', 'Active and reviewed tasks preserve their exact brief and owner. Request rework before editing a task in review.');
      if (existing?.value.status === 'blocked') await priorRunSettled(s, mission, existing.value);
      const value = { id, missionId: mission.id, title: required(input.title, 'Task title', 500), description: text(input.description ?? '', 'Task description'), criteria: text(input.criteria ?? '', 'Task acceptance criteria'), agentId: identifier(input.agentId, 'Task owner'), dependsOn: ids(input.dependsOn ?? [], 'Task dependencies'), workflowNodeIds: ids(input.workflowNodeIds ?? [], 'Workflow nodes'), status };
      board(s, mission, value.agentId); dependencyCheck(s, mission.id, value);
      if (value.workflowNodeIds.length && !mission.workflowId) fail('WORKFLOW_REQUIRED', 'Choose a workflow before selecting its nodes.');
      if (value.workflowNodeIds.length) await contextFor(mission, value);
      const record = append({ ...value, createdAt: existing?.value.createdAt || now(), history: existing?.value.history || [] }, existing ? 'task-updated' : 'task-created', { brief: copy(value) });
      return { result: { record: await commit(s, 'agent-tasks', id, record, existing) } };
    }
    const tr = taskRecord(s, mission.id, payload.taskId), task = tr.value; revision(tr, payload.expectedRevision);
    board(s, mission, task.agentId); dependencyCheck(s, mission.id, task, true);
    if (action === 'startTask') {
      if (!['todo', 'blocked'].includes(task.status)) fail('INVALID_TRANSITION', 'Only pending or blocked tasks can be started.');
      if (typeof sendTask !== 'function') fail('PROVIDER_UNAVAILABLE', 'Native agent dispatch is unavailable.');
      if (task.status === 'blocked') await priorRunSettled(s, mission, task);
      const busy = s.records.find(r => {
        if (r.collection !== 'agent-tasks' || r.id === task.id || r.value.agentId !== task.agentId || find(s, 'agent-missions', r.value.missionId)?.value.boardId !== mission.boardId) return false;
        if (r.value.status === 'active') return true;
        const native = r.value.runId && find(s, 'agent-runs', r.value.runId)?.value;
        return r.value.status === 'blocked' && native && !['completed', ...TERMINAL_FAILURE].includes(native.status);
      });
      if (busy) fail('OWNER_BUSY', `This agent already owns the active task “${busy.value.title}”.`);
      const context = await contextFor(mission, task), packet = packetFor(mission, task, context), operationId = crypto.randomUUID();
      const record = await commit(s, 'agent-tasks', task.id, append({ ...task, status: 'active', operationId, runId: null, evidence: null, review: null, error: null, packet, packetHash: hash(packet), ...(context ? { graphAtStart: { workflowId: context.workflowId, revision: context.revision, hash: context.hash } } : {}) }, 'task-started', { operationId, packetHash: hash(packet) }), tr);
      return { action, ticket, mission: copy(mission), task: record.value, record, packet };
    }
    if (action === 'submitTask') {
      if (task.status !== 'active' || !task.runId) fail('INVALID_TRANSITION', 'Start a task and wait for its native run before submitting it.');
      if (typeof getTaskRun !== 'function') fail('PROVIDER_UNAVAILABLE', 'Native agent evidence is unavailable.');
      const claim = `${root}\0${task.id}`;
      if (submissions.has(claim)) fail('TASK_BUSY', 'This task’s native checks are already running. Wait for them before submitting again.');
      submissions.add(claim);
      return { action, ticket, mission: copy(mission), task: copy(task), record: tr, claim };
    }
    if (action === 'reviewTask') {
      if (task.status !== 'review') fail('INVALID_TRANSITION', 'Only submitted tasks can be reviewed.');
      if (!['approve', 'rework'].includes(payload.decision)) fail('VALIDATION', 'Choose Approve or Request rework.');
      const comment = text(payload.comment ?? '', 'Review comment');
      if (payload.decision === 'rework') return { result: { record: await commit(s, 'agent-tasks', task.id, append({ ...task, status: 'todo', review: { decision: 'rework', comment, at: now(), evidence: task.evidence }, evidence: null, runId: null, operationId: null }, 'rework-requested', { comment, evidence: task.evidence }), tr) } };
      if (!task.evidence?.provider || task.evidence.packetHash !== task.packetHash) fail('EVIDENCE_INVALID', 'Task submission has no matching native completion evidence.');
      return { action, ticket, mission: copy(mission), task: copy(task), record: tr, comment };
    }
    fail('UNKNOWN_ACTION', `Unknown coordination action: ${String(action)}`);
  }
  async function updateClaim(prepared, fn) {
    return serialized(async () => {
      current(prepared.ticket); const s = await snapshot();
      const mr = missionRecord(s, prepared.mission.id), tr = taskRecord(s, mr.id, prepared.task.id);
      revision(tr, prepared.record.revision);
      if (tr.value.operationId !== prepared.task.operationId || ['goal', 'criteria', 'boardId', 'workflowId'].some(k => mr.value[k] !== prepared.mission[k])) fail('CONFLICT', 'Project or task changed during execution; no result was applied.');
      board(s, mr.value, tr.value.agentId); dependencyCheck(s, mr.id, tr.value, true);
      if (prepared.evidenceContext) {
        const workflow = find(s, 'workflows', prepared.evidenceContext.workflowId);
        if (!workflow || workflow.revision !== prepared.evidenceContext.revision) fail('STALE_EVIDENCE', 'The workflow changed before evidence could be saved. Submit current checks again.');
      }
      if (prepared.providerEvidence) {
        const run = find(s, 'agent-runs', prepared.providerEvidence.id);
        if (!run || hash(nativeRun(run.value, prepared.mission, prepared.task)) !== hash(prepared.providerEvidence)) fail('STALE_EVIDENCE', 'The canonical native run changed before evidence could be saved.');
      }
      return { record: await commit(s, 'agent-tasks', tr.id, fn(tr.value), tr) };
    });
  }
  async function execute(p) {
    if (p.action === 'startTask') {
      let run;
      try {
        run = unwrap(await sendTask({ workspaceRoot: p.ticket.root, mission: copy(p.mission), task: copy(p.task), packet: p.packet })); current(p.ticket);
        if (!run?.id || run.boardId !== p.mission.boardId) fail('EVIDENCE_INVALID', 'Native agent dispatch returned an unrelated run.'); identifier(run.id, 'Agent run ID');
        const result = await updateClaim(p, task => append({ ...task, runId: run.id }, 'agent-dispatched', { runId: run.id }));
        return { ...result, run: copy(run) };
      } catch (error) {
        // A persisted blocked record prevents a restart from silently replaying
        // an ambiguous send. Keep a returned run ID for inspection, if known.
        try { await updateClaim(p, task => append({ ...task, status: 'blocked', error: text(String(error.message), 'Dispatch error'), runId: run?.id || task.operationId }, 'dispatch-blocked', { code: error.code || 'ERROR' })); } catch {}
        throw error;
      }
    }
    let provider;
    try { provider = nativeRun(await getTaskRun({ workspaceRoot: p.ticket.root, mission: copy(p.mission), task: copy(p.task) }), p.mission, p.task); }
    catch (error) {
      if (error.code === 'RUN_FAILED' && p.action === 'submitTask') await updateClaim(p, task => append({ ...task, status: 'blocked', error: error.message }, 'agent-run-failed'));
      throw error;
    }
    current(p.ticket); p.providerEvidence = provider;
    const context = await contextFor(p.mission, p.task, p.ticket.root); current(p.ticket);
    p.evidenceContext = context;
    if (p.action === 'submitTask') {
      let checks = null;
      if (context) {
        if (typeof runChecks !== 'function') fail('CHECKS_UNAVAILABLE', 'Native workflow checks are unavailable; this task cannot be approved.');
        checks = checksEvidence(await runChecks({ workspaceRoot: p.ticket.root, mission: copy(p.mission), task: copy(p.task) }), context); current(p.ticket);
        const latest = await contextFor(p.mission, p.task, p.ticket.root); current(p.ticket);
        if (latest.hash !== context.hash || latest.revision !== context.revision) fail('STALE_EVIDENCE', 'The workflow changed during its checks. Submit again against the current graph.');
      }
      const evidence = { provider, checks, packetHash: p.task.packetHash, collectedAt: now(), meaning: 'Native execution completed; semantic correctness still requires explicit review.' };
      return updateClaim(p, task => append({ ...task, status: 'review', evidence, review: null }, 'task-submitted', { evidence }));
    }
    if (hash(provider) !== hash(p.task.evidence.provider)) fail('STALE_EVIDENCE', 'The native run changed after submission. Request rework and submit fresh evidence.');
    if (context && (!p.task.evidence.checks || p.task.evidence.checks.hash !== context.hash || p.task.evidence.checks.revision !== context.revision)) fail('STALE_EVIDENCE', 'The saved graph changed after submission. Request rework and run current checks before approval.');
    return updateClaim(p, task => append({ ...task, status: 'done', review: { decision: 'approve', comment: p.comment, at: now(), evidenceHash: hash(task.evidence) } }, 'task-approved', { comment: p.comment, evidenceHash: hash(task.evidence) }));
  }
  async function handle(action, payload = {}) {
    object(payload, 'Coordination request');
    const p = await serialized(() => prepare(action, payload));
    if (p.result) return p.result;
    const operation = execute(p); live.add(operation);
    try { return await operation; } finally { live.delete(operation); if (p.claim) submissions.delete(p.claim); }
  }
  async function setWorkspace(next) {
    const candidate = workspacePath(next);
    return serialized(() => { generation++; root = candidate; initialized = false; });
  }
  async function close() { await serialized(() => { closed = true; generation++; root = null; }); await Promise.allSettled([...live]); }
  async function drain() { await serialized(() => { generation++; }); await Promise.allSettled([...live]); }
  return { handle, setWorkspace, drain, close };
}

module.exports = { createService };
