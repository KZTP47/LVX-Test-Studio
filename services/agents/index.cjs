'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { createNativeTransport, SUPPORTS, MAX_BYTES, UUID, errorState } = require('./native.cjs');
const conversations = require('./conversations.cjs');
const { createSessionProof } = require('./session-proof.cjs');

const COLLECTIONS = ['agent-boards', 'agent-sessions', 'agent-runs', 'agent-messages', 'agent-events'];
const KEY = /^[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,63}$/;
const TERMINAL = new Set(['completed', 'blocked', 'limit', 'partial', 'error', 'cancelled', 'interrupted']);
const now = () => new Date().toISOString();
const copy = value => JSON.parse(JSON.stringify(value));
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Editable future task wording is separate from the executable graph. An
// admitted run owns its immutable taskContext, even while the board is edited.
const boardRuntime = b => ({ mode: b.mode, maxTurns: b.maxTurns, concurrency: b.concurrency, acceptanceWorkflowId: b.acceptanceWorkflowId, nodes: b.nodes.map(({ position, appearance, ...n }) => n), edges: b.edges, ...(b.projects?.length?{projects:b.projects.map(({id,path})=>({id,path}))}:{}) });
const projectPath = (board,node,root) => (node.activeProjectId || node.projectId) ? board.projects?.find(project=>project.id===(node.activeProjectId || node.projectId))?.path : root;
const runSnapshotFingerprint = run => digest([run.id, run.boardId, run.kind, run.maxTurns, run.requestFingerprint, run.acceptanceCriteria, run.taskContext || null]);
function fail(code, message) { const error = Error(message); error.code = code; throw error; }
function id(value, label) { if (typeof value !== 'string' || !KEY.test(value)) fail('VALIDATION', `${label} needs a simple identifier of at most 64 characters.`); return value; }
function text(value, label, max = MAX_BYTES) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > max) fail('VALIDATION', `${label} must be text no larger than ${max} bytes.`);
  return value;
}

// Cosmetic data never participates in executable settings or native sessions.
// Only self-contained raster images are accepted; SVG and remote URLs can carry
// active content or disclose a workspace to an external image host.
function normalizeAppearance(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('VALIDATION', 'Agent appearance must be an object.');
  const color = input.color ?? '#49cde5';
  if (typeof color !== 'string' || !/^#[a-f0-9]{6}$/i.test(color)) fail('VALIDATION', 'Agent color must be a six-digit hex color.');
  const icon = input.icon ?? 'robot';
  if (!['robot', 'code', 'shield', 'book', 'target', 'network'].includes(icon)) fail('VALIDATION', 'Choose a supported agent icon.');
  const avatar = input.avatar ?? '';
  if (typeof avatar !== 'string' || avatar.length > 350000) fail('VALIDATION', 'Agent picture must be a raster image smaller than 256 KB.');
  if (avatar) {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(avatar);
    if (!match) fail('VALIDATION', 'Agent picture must be an embedded PNG, JPEG or WebP image.');
    const bytes = Buffer.from(match[2], 'base64');
    const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!valid || bytes.length > 256 * 1024 || bytes.toString('base64') !== match[2]) fail('VALIDATION', 'Agent picture has invalid or oversized image data.');
  }
  const zoom = input.zoom === undefined ? 1 : input.zoom, hue = input.hue === undefined ? 0 : input.hue;
  if (!Number.isFinite(zoom) || zoom < 1 || zoom > 3 || !Number.isFinite(hue) || hue < 0 || hue > 360) fail('VALIDATION', 'Picture zoom or hue is outside its allowed range.');
  const bubbleColor=input.bubbleColor??color;if(!/^#[a-f0-9]{6}$/i.test(bubbleColor))fail('VALIDATION','Chat bubble color must be a six-digit hex color.');
  return { color, ...(input.bubbleColor!==undefined?{bubbleColor}:{}), icon, avatar, zoom, hue };
}

function legacyMessageInput(message) {
  return message.role === 'peer' ? `[Peer message from ${message.from} to ${message.to}]\n${message.text}` : message.text;
}

function composeTransportInput(message, node) {
  let input = legacyMessageInput(message);
  if (message.taskContext) {
    const { goal, acceptanceCriteria } = message.taskContext;
    text(goal, 'Run goal'); text(acceptanceCriteria, 'Run acceptance criteria');
    const context = `[Task context]\nGoal:\n${goal}\nAcceptance criteria:\n${acceptanceCriteria}`;
    // A starter's raw body already is the goal, so include that text once.
    input = message.role === 'user' && message.text === goal ? context : `${context}\n\n${input}`;
  }
  // Gemini has no additive instruction flag. Record the user's explicit prefix
  // here so transportInput is exactly the stdin passed to the native adapter.
  if (node.provider === 'gemini' && node.instructions) input = `${node.instructions}\n\n${input}`;
  return text(input, 'Composed transport input');
}

function historicalInput(message) {
  if (Object.hasOwn(message, 'transportInput')) return text(message.transportInput, 'Recorded transport input');
  // Compatibility for old rows only. Never add task context that was not
  // present in the original transport, or replay a new undispatched message.
  return Object.hasOwn(message, 'runSnapshotFingerprint') ? null : legacyMessageInput(message);
}

function normalizeBoard(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('VALIDATION', 'Board must be an object.');
  const b = copy(input);
  if (b.schemaVersion !== 1) fail('VALIDATION', 'Unsupported agent board schema.');
  id(b.id, 'Board ID');
  text(b.name, 'Board name', 300); if (!b.name.trim()) fail('VALIDATION', 'Give the board a name.');
  b.goal = text(b.goal ?? '', 'Goal');
  b.acceptanceCriteria = text(b.acceptanceCriteria ?? '', 'Acceptance criteria');
  if (!['manual', 'linked'].includes(b.mode)) fail('VALIDATION', 'Board mode must be manual or linked.');
  b.maxTurns ??= 10; b.concurrency ??= 1;
  if (!Number.isInteger(b.maxTurns) || b.maxTurns < 1 || b.maxTurns > 100) fail('VALIDATION', 'Turn budget must be 1–100.');
  if (!Number.isInteger(b.concurrency) || b.concurrency < 1 || b.concurrency > 4) fail('VALIDATION', 'Concurrency must be 1–4.');
  if (!Array.isArray(b.nodes) || b.nodes.length > 40 || !Array.isArray(b.edges) || b.edges.length > 200) fail('VALIDATION', 'Board supports up to 40 agents and 200 directed links.');
  const nodes = new Set(), edges = new Set(), pairs = new Set();
  const projects=new Set();
  if(b.projects!==undefined){
    if(!Array.isArray(b.projects)||b.projects.length>20)fail('VALIDATION','A board supports up to twenty project folders.');
    b.projects=b.projects.map(project=>{
      id(project.id,'Project folder ID');if(project.id==='__workspace__'||projects.has(project.id))fail('VALIDATION','Project folder IDs must be unique.');projects.add(project.id);
      text(project.name,'Folder name',300);if(!project.name.trim())fail('VALIDATION','Give each project folder a name.');
      text(project.path,'Folder path',4000);if(!path.isAbsolute(project.path)||project.path.includes('\0'))fail('VALIDATION','Project folder paths must be absolute.');
      if(!project.position||![project.position.x,project.position.y].every(value=>Number.isFinite(value)&&Math.abs(value)<=1e6))fail('VALIDATION','Folder positions must be finite canvas coordinates.');
      return {id:project.id,name:project.name,path:project.path,position:{...project.position}};
    });
  }
  b.nodes = b.nodes.map(node => {
    id(node.id, 'Agent ID'); if (nodes.has(node.id)) fail('VALIDATION', 'Agent IDs must be unique.'); nodes.add(node.id);
    text(node.name, 'Agent name', 300); if (!node.name.trim()) fail('VALIDATION', 'Give each agent a name.');
    if (!SUPPORTS[node.provider]) fail('VALIDATION', 'Unknown agent provider.');
    const permission = node.permission || 'native';
    if (!SUPPORTS[node.provider].permissions.includes(permission)) fail('VALIDATION', `${node.provider} does not support the selected permission guarantee.`);
    const model = text(node.model ?? '', 'Model', 300), effort = text(node.effort ?? '', 'Effort', 30);
    if (model && (/^\s*-/.test(model) || /[\s\u0000-\u001f]/.test(model))) fail('VALIDATION', 'Model must be a model identifier without whitespace or a leading option dash.');
    if (effort && (!SUPPORTS[node.provider].effort || !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort))) fail('VALIDATION', 'Unsupported provider effort selection.');
    if (node.provider === 'claude' && ['none', 'minimal', 'ultra'].includes(effort)) fail('VALIDATION', 'Claude effort must be low, medium, high, xhigh or max.');
    if (!node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y) || Math.abs(node.position.x) > 1e6 || Math.abs(node.position.y) > 1e6) fail('VALIDATION', 'Agent positions must be finite canvas coordinates.');
    const result = { id: node.id, name: node.name, provider: node.provider, model, effort, permission, instructions: text(node.instructions ?? '', 'Explicit agent additions', 128 * 1024), position: { x: node.position.x, y: node.position.y } };
    if(node.projectId!==undefined&&node.projectId!==''){if(!projects.has(node.projectId))fail('VALIDATION','Assign the agent to a folder that exists on this board.');result.projectId=node.projectId;}
    const assigned=node.projectIds??(node.projectId?[node.projectId]:[]);if(node.projectId&&Array.isArray(assigned)&&!assigned.includes(node.projectId))assigned.push(node.projectId);if(!Array.isArray(assigned)||assigned.some(p=>p!==''&&!projects.has(p)))fail('VALIDATION','Choose project folders on this board.');if(node.projectIds!==undefined||node.projectId!==undefined||node.activeProjectId!==undefined){result.projectIds=[...new Set(assigned)];result.activeProjectId=node.activeProjectId??node.projectId??'';}if(result.activeProjectId&&!result.projectIds.includes(result.activeProjectId))fail('VALIDATION','Active folder must be assigned to the agent.');
    if (node.appearance !== undefined) result.appearance = normalizeAppearance(node.appearance);
    if (node.provider === 'api') {
      const c = node.apiConfig || {};
      if (!['custom', 'openai', 'anthropic', 'google'].includes(c.provider)) fail('VALIDATION', 'Choose an API provider.');
      if (c.apiKey && !/^secret:[a-f0-9-]{36}$/i.test(c.apiKey)) fail('VALIDATION', 'API keys must use an OS-protected secret reference.');
      const apiModel = text(c.model ?? model, 'API model', 300);
      if ((model || apiModel) && /^\s*-|\s/.test(model || apiModel)) fail('VALIDATION', 'API model must be a model identifier without whitespace or a leading option dash.');
      if (c.provider !== 'custom' && !(model || apiModel).trim()) fail('VALIDATION', 'Choose an explicit API model for OpenAI, Anthropic or Google; there is no generic API provider default.');
      if (c.provider === 'custom') {
        let url; try { url = new URL(c.customEndpoint); } catch { fail('VALIDATION', 'Custom API endpoint must be an HTTP(S) URL.'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('VALIDATION', 'API endpoint cannot contain embedded credentials.');
      }
      result.apiConfig = { provider: c.provider, model: apiModel, customEndpoint: text(c.customEndpoint ?? '', 'API endpoint', 4000), ...(c.apiKey ? { apiKey: c.apiKey } : {}) };
    }
    return result;
  });
  b.edges = b.edges.map(edge => {
    id(edge.id, 'Link ID'); if (edges.has(edge.id)) fail('VALIDATION', 'Link IDs must be unique.'); edges.add(edge.id);
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) fail('VALIDATION', 'Every link must address existing agents.');
    const pair = `${edge.source}:${edge.target}`; if (pairs.has(pair)) fail('VALIDATION', 'Duplicate directed links are not allowed.'); pairs.add(pair);
    if (edge.enabled !== undefined && typeof edge.enabled !== 'boolean') fail('VALIDATION', 'Link enabled must be boolean.');
    return { id: edge.id, source: edge.source, target: edge.target, enabled: edge.enabled !== false };
  });
  const result = { schemaVersion: 1, id: b.id, name: b.name, goal: b.goal, acceptanceCriteria: b.acceptanceCriteria, mode: b.mode, maxTurns: b.maxTurns, concurrency: b.concurrency, nodes: b.nodes, edges: b.edges };
  if(b.projects!==undefined)result.projects=b.projects;
  if (b.acceptanceWorkflowId) result.acceptanceWorkflowId = id(b.acceptanceWorkflowId, 'Acceptance workflow ID');
  if (b.view) {
    if (![b.view.zoom, b.view.panX, b.view.panY].every(Number.isFinite) || b.view.zoom < 0.1 || b.view.zoom > 4) fail('VALIDATION', 'Canvas view has invalid coordinates or zoom.');
    result.view = { zoom: b.view.zoom, panX: b.view.panX, panY: b.view.panY };
    if(b.view.workspacePosition!==undefined){if(!b.view.workspacePosition||![b.view.workspacePosition.x,b.view.workspacePosition.y].every(value=>Number.isFinite(value)&&Math.abs(value)<=1e6))fail('VALIDATION','Workspace folder position is invalid.');result.view.workspacePosition={x:b.view.workspacePosition.x,y:b.view.workspacePosition.y};}
  }
  if (b.panels !== undefined) {
    if (!Array.isArray(b.panels) || b.panels.length > 40) fail('VALIDATION', 'Board supports up to forty chat windows.');
    const panelIds = new Set();
    result.panels = b.panels.map(p => {
      if (!p || !nodes.has(p.agentId) || panelIds.has(p.agentId)) fail('VALIDATION', 'Each chat window must refer to a different existing agent.');
      panelIds.add(p.agentId);
      if (![p.x,p.y,p.width,p.height].every(Number.isFinite) || Math.abs(p.x)>100000 || Math.abs(p.y)>100000 || p.width<280 || p.width>2400 || p.height<240 || p.height>2400 || typeof p.minimized !== 'boolean') fail('VALIDATION', 'Chat window position or size is invalid.');
      if(p.maximized!==undefined&&typeof p.maximized!=='boolean')fail('VALIDATION','Chat maximized state must be boolean.');
      return { agentId:p.agentId,x:p.x,y:p.y,width:p.width,height:p.height,minimized:p.minimized,...(p.maximized!==undefined?{maximized:p.maximized}:{}) };
    });
  }
  return result;
}

function createService(options = {}) {
  const { workspace, emit = () => {}, requestAI, redact = value => value, runAcceptance } = options;
  if (!workspace?.handle) throw Error('Agent runtime requires the canonical workspace service.');
  const native = options.nativeTransport || createNativeTransport({...(options.dataDir?{configFile:path.join(options.dataDir,'provider-tools.json')}:{}) ,...options.nativeOptions});
  const sessionProof = createSessionProof(options.dataDir);
  const projectFolders = require('./project-folders.cjs').createProjectFolders(options.dataDir);
  let root = options.workspaceRoot ? fs.realpathSync(options.workspaceRoot) : null;
  let initialized = false, closed = false, transitioning = false, epoch = 0, chain = Promise.resolve(), pumpScheduled = false;
  const generatedPreviews = new Map();
  const active = new Map(), quarantined = new Set(), acceptanceRuns = new Map(), admissions = new Map();
  const admissionFingerprint = (board, message) => digest([root, boardRuntime(board), message.id, message.boardId, message.agentId, message.from, message.to, message.role, message.text, message.runId, message.generation, message.sourceGeneration, message.parentMessageId, message.edgeId, message.taskContext || null, message.transportInput, message.runSnapshotFingerprint]);
  function admit(board, messages) { for (const m of messages) if (m.state === 'queued') admissions.set(m.id, admissionFingerprint(board, m)); }

  // Only short persistence/control mutations hold this lock. Provider work never
  // holds it: pause/cancel and incoming messages remain responsive during a turn.
  function serialized(fn) { const operation = chain.then(fn); chain = operation.catch(() => {}); return operation; }
  function requireRoot() { if (closed) fail('CLOSED', 'Agent service is closed.'); if (!root) fail('WORKSPACE_REQUIRED', 'Choose a workspace first.'); if (transitioning) fail('WORKSPACE_CHANGED', 'Workspace selection is changing; reload the board.'); }
  function assertBinding(payload) {
    requireRoot();
    if (payload.workspaceRoot !== undefined) {
      let binding; try { binding = typeof payload.workspaceRoot === 'string' && fs.realpathSync(payload.workspaceRoot); } catch {}
      if (binding !== root) fail('WORKSPACE_CHANGED', 'Workspace changed; reload this board.');
    }
  }
  async function call(action, payload = {}, binding = root) {
    if (!binding || binding !== root) fail('WORKSPACE_CHANGED', 'Workspace changed; no old agent results were saved.');
    return workspace.handle(action, { ...payload, workspaceRoot: binding });
  }
  const read = (collection, key) => call('read', { collection, id: key });
  const list = async collection => (await call('list', { collection })).records;
  const values = async (collection, boardId) => (await list(collection)).filter(r => r.value.boardId === boardId);
  async function boardRecord(boardId) { id(boardId, 'Board ID'); const r = await read('agent-boards', boardId); if (!r) fail('NOT_FOUND', 'Agent board was not found in this workspace.'); return r; }
  async function sessionRecord(boardId, agentId) { return read('agent-sessions', `${boardId}:${agentId}`); }
  const mutation = (collection, recordId, value, record) => ({ collection, id: recordId, expectedRevision: record?.revision ?? null, value });

  async function transaction(boardId, changes = [], eventSpecs = [], newMessages = [], statePatch = {}) {
    const cursorId = `${boardId}:cursor`, cursor = await read('agent-events', cursorId);
    const state = { boardId, recordType: 'cursor', sequence: 0, paused: false, ...cursor?.value, ...statePatch };
    const notifications = [];
    for (const message of newMessages) {
      message.sequence = ++state.sequence;
      changes.push(mutation('agent-messages', message.id, message));
    }
    for (const spec of eventSpecs) {
      const event = { domain: 'agents', type: 'event', workspaceRoot: root, boardId, sequence: ++state.sequence, createdAt: now(), ...spec };
      changes.push(mutation('agent-events', `${boardId}:${state.sequence}`, event)); notifications.push(event);
    }
    changes.push(mutation('agent-events', cursorId, state, cursor));
    await call('transact', { records: changes });
    for (const event of notifications) { try { emit(copy(event)); } catch { /* committed evidence survives a detached renderer */ } }
    return state;
  }
  async function state(boardId) { return (await read('agent-events', `${boardId}:cursor`))?.value || { sequence: 0, paused: false }; }
  function newSessionValue(board, node, generation = 1) { return { boardId: board.id, agentId: node.id, provider: node.provider, workspaceRoot: root, workingDirectory:node.provider==='api'?root:projectPath(board,node,root), activeProjectId:node.activeProjectId||node.projectId||'', name:'Conversation '+generation, nativeSessionId: null, generation, status: 'idle', createdAt: now() }; }
  function message(board, node, run, role, body, extra = {}) {
    return { id: crypto.randomUUID(), boardId: board.id, agentId: node.id, from: role === 'user' ? 'user' : node.id, to: node.id, role, text: body, createdAt: now(), state: 'queued', runId: run.id, runSnapshotFingerprint: runSnapshotFingerprint(run), ...(run.taskContext ? { taskContext: copy(run.taskContext) } : {}), ...extra };
  }

  async function initialize() {
    requireRoot(); if (initialized) return;
    // No queued or launched effect is replayed after process restart. The user
    // sees interrupted evidence and may explicitly send a new request.
    for (const b of await list('agent-boards')) {
      const changes = [], events = [];
      for (const m of await values('agent-messages', b.id)) if (['queued', 'running'].includes(m.value.state)) changes.push(mutation('agent-messages', m.id, { ...m.value, state: 'interrupted', error: 'Application restarted; previous delivery was not replayed.' }, m));
      for (const r of await values('agent-runs', b.id)) if (!TERMINAL.has(r.value.status)) changes.push(mutation('agent-runs', r.id, { ...r.value, status: 'interrupted', error: 'Application restarted; review prior effects before a new request.', finishedAt: now() }, r));
      for (const s of await values('agent-sessions', b.id)) {
        const node = b.value.nodes.find(n => n.id === s.value.agentId);
        const invalidBinding = s.value.workspaceRoot !== root || !node || s.value.provider !== node.provider || s.id !== `${b.id}:${s.value.agentId}` || (s.value.nativeSessionId && !sessionProof.verify(s.value));
        if (invalidBinding) changes.push(mutation('agent-sessions', s.id, { ...s.value, status: 'blocked', lastError: 'Imported or foreign native conversation binding is untrusted. Explicitly create a new conversation before running this agent.' }, s));
        else if (s.value.status === 'running') changes.push(mutation('agent-sessions', s.id, { ...s.value, status: 'interrupted', lastError: 'Previous process ended during a turn. Resume identity may be available; no automatic retry.' }, s));
      }
      if (changes.length) { events.push({ kind: 'recovery-interrupted', messageIds: changes.filter(c => c.collection === 'agent-messages').map(c => c.id), message: 'Pending and running work requires explicit review; nothing was replayed.' }); await transaction(b.id, changes, events); }
    }
    initialized = true;
  }

  function schedule() {
    if (pumpScheduled || closed || transitioning) return;
    pumpScheduled = true;
    setImmediate(() => { pumpScheduled = false; void serialized(pump).catch(error => { try { emit({ domain: 'agents', type: 'runtime-error', workspaceRoot: root, error: redact(error.message) }); } catch {} }); });
  }
  async function refreshRun(boardId, runId, forcedError) {
    const r = await read('agent-runs', runId); if (!r || TERMINAL.has(r.value.status)) return;
    const messages = (await values('agent-messages', boardId)).map(r => r.value).filter(m => m.runId === runId && m.role !== 'assistant');
    if (messages.some(m => ['queued', 'running'].includes(m.state))) return;
    const priority = ['cancelled', 'interrupted', 'error', 'blocked', 'partial', 'limit'];
    const status = priority.find(s => messages.some(m => m.state === s)) || 'completed';
    const next = { ...r.value, status, finishedAt: now(), ...(forcedError ? { error: forcedError } : {}) };
    await transaction(boardId, [mutation('agent-runs', runId, next, r)], [{ kind: 'run-finished', runId, status, acceptance: next.acceptance }]);
  }

  async function pump() {
    if (closed || transitioning || !root || !initialized) return;
    for (const br of await list('agent-boards')) {
      const board = br.value;
      if ((await state(board.id)).paused) continue;
      const queued = (await values('agent-messages', board.id)).filter(r => r.value.state === 'queued').sort((a, b) => a.value.sequence - b.value.sequence);
      for (const mr of queued) {
        if (active.size >= 4) break;
        const m = mr.value, agentKey = `${board.id}:${m.agentId}`;
        if (active.has(agentKey) || quarantined.has(agentKey)) continue;
        if ([...active.values()].filter(a => a.boardId === board.id).length >= board.concurrency) break;
        const rr = await read('agent-runs', m.runId);
        if (!rr || TERMINAL.has(rr.value.status)) continue;
        if (admissions.get(m.id) !== admissionFingerprint(board, m) || m.runSnapshotFingerprint !== runSnapshotFingerprint(rr.value)) {
          admissions.delete(m.id);
          await transaction(board.id, [mutation('agent-messages', m.id, { ...m, state: 'interrupted', error: 'Queued delivery was imported, modified or belongs to an earlier runtime. Review it and send explicitly; it was not replayed.' }, mr)], [{ kind: 'delivery-unadmitted', runId: m.runId, messageId: m.id }]);
          await refreshRun(board.id, m.runId); continue;
        }
        const node = board.nodes.find(n => n.id === m.agentId), sr = await sessionRecord(board.id, m.agentId);
        const session = sr?.value;
        if (!node || !session || session.generation !== m.generation || session.provider !== node.provider || session.workspaceRoot !== root || session.boardId !== board.id || session.agentId !== node.id || (session.nativeSessionId && !sessionProof.verify(session))) {
          await transaction(board.id, [mutation('agent-messages', m.id, { ...m, state: 'cancelled', error: 'Conversation generation or provider changed before delivery.' }, mr)], [{ kind: 'delivery-fenced', runId: m.runId, messageId: m.id }]);
          await refreshRun(board.id, m.runId); continue;
        }
        if (['blocked', 'error', 'partial', 'interrupted', 'limit', 'cancelled'].includes(session.status)) {
          // An explicit new send can resume a previously failed session. Already
          // queued peers cannot blindly continue after an ambiguous effect.
          if (m.role === 'peer' || m.sequence <= (session.failureFenceSequence || 0)) {
            await transaction(board.id, [mutation('agent-messages', m.id, { ...m, state: 'blocked', error: 'Previous turn needs review. Send explicitly or create a new conversation.' }, mr)], [{ kind: 'delivery-blocked', runId: m.runId, messageId: m.id }]);
            await refreshRun(board.id, m.runId); continue;
          }
        }
        if (rr.value.turns >= rr.value.maxTurns) {
          await transaction(board.id, [mutation('agent-messages', m.id, { ...m, state: 'limit', error: 'Run turn budget reached before delivery.' }, mr)], [{ kind: 'turn-limit', runId: m.runId, messageId: m.id }]);
          await refreshRun(board.id, m.runId); continue;
        }
        let transportInput;
        try { transportInput = composeTransportInput(m, node);if(node.provider!=='api'&&(node.projectIds||[]).length>1){const folders=node.projectIds.map(id=>projectFolders.assertAllowed(root,id?board.projects.find(p=>p.id===id).path:root));transportInput='[Project folders assigned by the user]\n'+folders.join('\n')+'\nUse these folders as needed for this task.\n\n'+transportInput;} }
        catch (error) {
          admissions.delete(m.id);
          await transaction(board.id, [mutation('agent-messages', m.id, { ...m, state: 'error', error: redact(error.message) }, mr)], [{ kind: 'input-rejected', runId: m.runId, messageId: m.id, error: redact(error.message) }]);
          await refreshRun(board.id, m.runId, redact(error.message)); continue;
        }
        const controller = new AbortController(), capturedEpoch = epoch;
        const running = { ...m, transportInput, state: 'running', startedAt: now(), attemptId: crypto.randomUUID(), runRequestFingerprint: rr.value.requestFingerprint };
        await transaction(board.id, [mutation('agent-messages', m.id, running, mr), mutation('agent-sessions', sr.id, { ...session, status: 'running', activeAttemptId: running.attemptId, lastError: null }, sr), mutation('agent-runs', rr.id, { ...rr.value, status: 'running', turns: rr.value.turns + 1 }, rr)], [{ kind: 'turn-started', runId: m.runId, messageId: m.id, agentId: node.id, generation: session.generation, provider: node.provider, nativeSessionId: session.nativeSessionId, instructionMode: node.instructions ? 'explicit-user-additions' : 'native-default' }]);
        admissions.delete(m.id);
        const binding = root;
        const work = { startedAt: running.startedAt, progress: { status: 'Starting provider…', text: '', updatedAt: running.startedAt }, boardId: board.id, agentId: node.id, runId: m.runId, messageId: m.id, generation: session.generation, controller, promise: null };
        active.set(agentKey, work);
        work.promise = Promise.resolve().then(() => executeTurn(board, node, session, running, controller.signal, binding)).catch(error => ({ status: controller.signal.aborted ? 'cancelled' : errorState(error.message), text: '', error: redact(error.message) })).then(result => serialized(async () => {
          try { if (capturedEpoch === epoch && binding === root) await finishTurn(board, node, session, running, result); }
          catch (error) { quarantined.add(agentKey); throw error; }
          finally { if (active.get(agentKey) === work) active.delete(agentKey); schedule(); }
        }));
        // A persistence failure is surfaced and cannot trigger effect replay.
        work.promise.catch(error => { if (active.get(agentKey) === work) active.delete(agentKey); try { emit({ domain: 'agents', type: 'runtime-error', workspaceRoot: binding, boardId: board.id, error: redact(error.message) }); } catch {} });
      }
    }
  }

  async function executeTurn(board, node, session, m, signal, binding) {
    const input = m.transportInput;
    const onProgress = update => {
      const work=active.get(board.id+':'+node.id);
      if(binding!==root||signal.aborted||!work||work.messageId!==m.id)return;
      const progress={status:String(update.status||'Working…').slice(0,200),text:redact(String(update.text||'')).slice(0,MAX_BYTES),updatedAt:now()};
      work.progress=progress;
      if(Date.now()-(work.lastProgressEmit||0)<100)return;work.lastProgressEmit=Date.now();
      // Ephemeral UI output is attempt-bound; it is never a second executable message.
      try{emit({domain:'agents',type:'activity',workspaceRoot:binding,boardId:board.id,agentId:node.id,messageId:m.id,attemptId:m.attemptId,progress});}catch{}
    };
    onProgress({status:node.provider==='api'?'Waiting for the API reply (this connection returns text when complete)…':'Starting the native agent…'});
    const workingDirectory=node.provider==='api'?binding:projectFolders.assertAllowed(binding,projectPath(board,node,binding));
    if(node.provider!=='api'&&(session.workingDirectory||session.workspaceRoot)!==workingDirectory)fail('SESSION_RESET_REQUIRED','This conversation belongs to a different folder. Start a new conversation before working in another folder.');
    const assignedDirectories=node.provider==='api'?[]:(node.projectIds||[]).map(id=>projectFolders.assertAllowed(binding,id?board.projects.find(p=>p.id===id).path:binding));
    if (node.provider !== 'api') return native.execute({ node:{...node,additionalDirectories:assignedDirectories.filter(p=>p!==workingDirectory)}, session, text: input, workspaceRoot: workingDirectory, signal, onProgress, onSession: nativeSessionId => serialized(async () => {
      if (binding !== root || signal.aborted) return;
      const current = await sessionRecord(board.id, node.id);
      const input = await read('agent-messages', m.id);
      if (!current || current.value.generation !== session.generation || current.value.status !== 'running') return;
      if (current.value.activeAttemptId !== m.attemptId || input?.value.attemptId !== m.attemptId || admissionFingerprint(board, input.value) !== admissionFingerprint(board, m)) fail('STATE_CHANGED', 'Active native attempt was replaced or modified. No foreign record was updated.');
      if (!UUID.test(nativeSessionId) || (current.value.nativeSessionId && current.value.nativeSessionId !== nativeSessionId)) fail('SESSION_MISMATCH', 'Native session identity changed during execution.');
      if (!current.value.nativeSessionId) {
        const bound = { ...current.value, nativeSessionId };
        bound.nativeSessionProof = sessionProof.sign(bound);
        await transaction(board.id, [mutation('agent-sessions', current.id, bound, current)], [{ kind: 'session-bound', agentId: node.id, generation: session.generation, nativeSessionId, runId: m.runId }]);
      }
    }) });
    if (!requestAI) fail('API_UNAVAILABLE', 'The configured API adapter is unavailable.');
    const history = (await values('agent-messages', board.id)).map(r => r.value).filter(v => v.agentId === node.id && v.generation === session.generation && v.sequence < m.sequence && ['completed', 'blocked', 'limit', 'partial', 'error'].includes(v.state)).sort((a, b) => a.sequence - b.sequence).map(v => ({ role: v.role === 'peer' ? 'user' : v.role, content: v.role === 'assistant' ? v.text : historicalInput(v) })).filter(v => v.content !== null);
    let result;
    try { result = await requestAI({ ...node.apiConfig, model: node.model || node.apiConfig.model, prompt: input, systemPrompt: node.instructions || '', messages: [...history, { role: 'user', content: input }], signal }); }
    catch (error) {
      if (!['AI_BLOCKED', 'AI_INCOMPLETE'].includes(error.code)) throw error;
      const status = signal.aborted ? 'cancelled' : error.code === 'AI_BLOCKED' ? 'blocked' : /length|max_tokens|MAX_TOKENS/i.test(error.finishReason || '') ? 'limit' : 'partial';
      return { status, text: error.partialText || '', error: redact(error.message), metadata: { transport: 'configured-api', nativeSession: false, historyMessages: history.length, finishReason: error.finishReason || null, completionStatus: error.code === 'AI_BLOCKED' ? 'BLOCKED' : 'INCOMPLETE' } };
    }
    const output = result.generatedText || '';
    let status = 'completed', error;
    if (result.refusal || result.blockReason || result.completionStatus === 'BLOCKED') { status = 'blocked'; error = String(result.refusal || result.blockReason || `API blocked: ${result.finishReason || 'provider policy'}`); }
    else if (/length|max_tokens|MAX_TOKENS|token_limit/i.test(result.finishReason || '')) { status = 'limit'; error = 'API output reached its token limit.'; }
    else if (/content_filter|SAFETY|RECITATION|BLOCKLIST|PROHIBITED_CONTENT/i.test(result.finishReason || '')) { status = 'blocked'; error = `API stopped: ${result.finishReason}`; }
    else if (result.completionStatus === 'INCOMPLETE') { status = 'partial'; error = `API did not complete: ${result.finishReason || 'incomplete output'}`; }
    else if (!output.trim()) { status = 'error'; error = 'API returned no assistant text.'; }
    else if (result.success === false) { status = 'error'; error = result.error || 'API request failed.'; }
    else if (result.completionStatus !== 'COMPLETE' && !(!result.completionStatus && ['stop', 'end_turn', 'stop_sequence', 'STOP'].includes(result.finishReason))) { status = 'partial'; error = 'API returned text without an explicit completion receipt. Output was retained; automatic peer delivery was withheld.'; }
    if (Buffer.byteLength(output) > MAX_BYTES) return { status: 'partial', text: '', error: 'API output exceeded the safety limit; no silent truncation was performed.' };
    if (signal.aborted) status = 'cancelled';
    return { status, text: output, error, protocol: [], metadata: { transport: 'configured-api', nativeSession: false, historyMessages: history.length, finishReason: result.finishReason || null, completionStatus: result.completionStatus || 'UNKNOWN', usage: result.usage || null } };
  }

  async function finishTurn(board, node, session, running, result) {
    const mr = await read('agent-messages', running.id), sr = await sessionRecord(board.id, node.id), rr = await read('agent-runs', running.runId);
    if (!mr || !rr) return;
    if (sr?.value.generation !== session.generation || sr.value.provider !== node.provider || !['running', 'cancelled'].includes(mr.value.state)) return;
    if (mr.value.attemptId !== running.attemptId || sr.value.activeAttemptId !== running.attemptId || rr.value.requestFingerprint !== running.runRequestFingerprint || runSnapshotFingerprint(rr.value) !== running.runSnapshotFingerprint || admissionFingerprint(board, mr.value) !== admissionFingerprint(board, running) || (sr.value.nativeSessionId && !sessionProof.verify(sr.value))) fail('STATE_CHANGED', 'Active agent records were replaced or modified during execution. Result was quarantined and foreign records were preserved.');
    if (mr.value.state === 'cancelled') result = { ...result, status: 'cancelled', error: 'Cancelled by user; prior native effects may have occurred.' };
    if (!TERMINAL.has(result.status)) result = { ...result, status: 'error', error: 'Transport returned an invalid outcome.' };
    if (result.nativeSessionId && (!UUID.test(result.nativeSessionId) || (session.nativeSessionId && session.nativeSessionId !== result.nativeSessionId))) result = { ...result, status: 'error', nativeSessionId: null, error: 'Native session identity mismatch; no replacement session was accepted.' };
    const safeError = result.error ? redact(result.error) : null;
    const finishedInput = { ...mr.value, state: result.status, finishedAt: now(), ...(safeError ? { error: safeError } : {}) };
    const nextSession = { ...sr.value, nativeSessionId: result.nativeSessionId || sr.value.nativeSessionId, status: result.status === 'completed' ? 'idle' : result.status, activeAttemptId: null, lastError: safeError, ...(result.status !== 'completed' ? { failedAt: now(), failureFenceSequence: (await state(board.id)).sequence } : {}) };
    if (nextSession.nativeSessionId) nextSession.nativeSessionProof = sessionProof.sign(nextSession);
    const newMessages = [], events = [{ kind: 'turn-finished', runId: running.runId, messageId: running.id, agentId: node.id, generation: session.generation, status: result.status, nativeSessionId: nextSession.nativeSessionId, ...(safeError ? { error: safeError } : {}) }];
    let assistant;
    if (typeof result.text === 'string' && result.text.length) {
      assistant = message(board, node, rr.value, 'assistant', result.text, { from: node.id, to: 'user', state: result.status, generation: session.generation, parentMessageId: running.id });
      newMessages.push(assistant);
    }
    const turnEvidence = { messageId: running.id, agentId: node.id, generation: session.generation, status: result.status, nativeSessionId: nextSession.nativeSessionId, ...(result.invocation ? { invocation: result.invocation } : {}), ...(result.metadata ? { metadata: result.metadata } : {}), protocol: result.protocol || [], stderr: result.stderr || '', ...(safeError ? { error: safeError } : {}) };
    const nextRun = { ...rr.value, turnEvidence: [...(rr.value.turnEvidence || []), turnEvidence] };
    if (result.status === 'completed' && assistant && (rr.value.kind === 'collaboration' || (rr.value.kind === 'goal' && board.mode === 'linked'))) {
      const targets = rr.value.recipientId ? (node.id===rr.value.starterId?[{id:'direct-'+rr.value.id,source:node.id,target:rr.value.recipientId}]:[]) : board.edges.filter(e=>e.enabled&&e.source===node.id);
      for (const edge of targets) {
        const target = board.nodes.find(n => n.id === edge.target), ts = await sessionRecord(board.id, target.id);
        if (!ts) continue;
        const peer = message(board, target, rr.value, 'peer', result.text, { from: node.id, to: target.id, generation: ts.value.generation, sourceGeneration: session.generation, parentMessageId: assistant.id, edgeId: edge.id });
        if (rr.value.turns >= rr.value.maxTurns) { peer.state = 'limit'; peer.error = 'Turn budget reached; peer body preserved but was not delivered.'; }
        newMessages.push(peer); events.push({ kind: peer.state === 'limit' ? 'turn-limit' : 'peer-queued', runId: running.runId, messageId: peer.id, from: node.id, to: target.id, parentMessageId: assistant.id });
      }
    }
    await transaction(board.id, [mutation('agent-messages', running.id, finishedInput, mr), mutation('agent-sessions', sr.id, nextSession, sr), mutation('agent-runs', rr.id, nextRun, rr)], events, newMessages);
    admit(board, newMessages);
    await refreshRun(board.id, running.runId, safeError);
  }

  async function cancelMatching(boardId, runId, agentId) {
    const changes = [], runIds = new Set();
    for (const r of await values('agent-messages', boardId)) if (['queued', 'running'].includes(r.value.state) && (!runId || r.value.runId === runId) && (!agentId || r.value.agentId === agentId)) {
      admissions.delete(r.id);
      changes.push(mutation('agent-messages', r.id, { ...r.value, state: 'cancelled', error: 'Cancelled by user.', finishedAt: now() }, r)); runIds.add(r.value.runId);
    }
    for (const a of active.values()) if (a.boardId === boardId && (!runId || a.runId === runId) && (!agentId || a.agentId === agentId)) a.controller.abort();
    const acceptance = acceptanceRuns.get(boardId);
    if (acceptance && !agentId && (!runId || acceptance.runId === runId)) acceptance.controller.abort();
    for (const s of await values('agent-sessions', boardId)) if (s.value.status === 'running' && (!agentId || s.value.agentId === agentId) && [...active.values()].some(a => a.boardId === boardId && a.agentId === s.value.agentId && (!runId || a.runId === runId))) changes.push(mutation('agent-sessions', s.id, { ...s.value, status: 'cancelled', failureFenceSequence: (await state(boardId)).sequence, lastError: 'Cancelled; prior native effects may have occurred.' }, s));
    if (changes.length) await transaction(boardId, changes, [{ kind: 'cancelled', messageIds: changes.filter(c => c.collection === 'agent-messages').map(c => c.id), ...(runId ? { runId } : {}), ...(agentId ? { agentId } : {}) }]);
    for (const r of runIds) await refreshRun(boardId, r);
  }

  async function submit(board, payload, kind) {
    if (acceptanceRuns.has(board.id)) fail('ACTIVE_ACCEPTANCE', 'Wait for or stop acceptance checks before starting more agent work.');
    if (!UUID.test(payload.requestId || '')) fail('VALIDATION', 'A UUID requestId is required for idempotent delivery.');
    let starters;
    if (kind === 'manual' || kind === 'collaboration') { text(payload.text, 'Message'); if (!payload.text.trim()) fail('VALIDATION', 'Enter a message.'); starters = [payload.agentId]; }
    else {
      if (!board.goal.trim()) fail('VALIDATION', 'Write a project goal before running agents.');
      starters = payload.agentIds?.length ? payload.agentIds : board.nodes.slice(0, 1).map(n => n.id);
      if (!Array.isArray(starters) || !starters.length || new Set(starters).size !== starters.length || starters.length > board.maxTurns) fail('VALIDATION', 'Select distinct starter agents within the turn budget.');
    }
    if (!starters.every(a => board.nodes.some(n => n.id === a))) fail('VALIDATION', 'Choose agents belonging to this board.');
    const taskContext = kind === 'goal' ? { goal: board.goal, acceptanceCriteria: board.acceptanceCriteria } : null;
    const fingerprint = digest({ boardId: board.id, kind, starters, recipientId:payload.recipientId||null, text: kind !== 'goal' ? payload.text : board.goal, ...(taskContext ? { taskContext } : {}) });
    const existing = await read('agent-runs', payload.requestId);
    if (existing) {
      if (existing.value.requestFingerprint !== fingerprint) fail('CONFLICT', 'This request ID was already used for different work.');
      const m = (await values('agent-messages', board.id)).find(r => r.value.runId === existing.id && r.value.role === 'user');
      return kind === 'manual' ? { message: m?.value, runId: existing.id } : { runId: existing.id };
    }
    const run = { ...(payload.recipientId?{recipientId:payload.recipientId,starterId:payload.agentId}:{}), id: payload.requestId, boardId: board.id, kind, status: 'queued', acceptance: 'UNREVIEWED', acceptanceCriteria: board.acceptanceCriteria, ...(taskContext ? { taskContext } : {}), createdAt: now(), startSequence: (await state(board.id)).sequence + 1, turns: 0, maxTurns: kind === 'manual' ? 1 : Math.max(payload.recipientId?2:1,board.maxTurns), requestFingerprint: fingerprint, turnEvidence: [] };
    const changes = [mutation('agent-runs', run.id, run)], messages = [];
    for (const agentId of starters) {
      const node = board.nodes.find(n => n.id === agentId), sr = await sessionRecord(board.id, agentId);
      const session = sr?.value || newSessionValue(board, node);
      if(node.provider!=='api')projectFolders.assertAllowed(root,projectPath(board,node,root));
      if (session.provider !== node.provider || session.workspaceRoot !== root || (node.provider!=='api'&&(session.workingDirectory||session.workspaceRoot)!==projectPath(board,node,root)) || session.boardId !== board.id || session.agentId !== node.id || (session.nativeSessionId && !sessionProof.verify(session))) fail('SESSION_MISMATCH', 'Session binding is foreign, imported or does not match this provider/workspace/folder. Create a new conversation explicitly.');
      if (quarantined.has(`${board.id}:${agentId}`)) fail('SESSION_RESET_REQUIRED', 'A previous turn could not persist its result. Review effects and explicitly create a new conversation before sending.');
      if (node.provider !== 'api' && session.status !== 'idle' && session.status !== 'running' && !session.nativeSessionId) fail('SESSION_RESET_REQUIRED', 'Previous native execution has no proven session identity. Review effects and explicitly create a new conversation; no fresh session was started.');
      if (!sr) changes.push(mutation('agent-sessions', `${board.id}:${agentId}`, session));
      messages.push(message(board, node, run, 'user', kind !== 'goal' ? payload.text : board.goal, { generation: session.generation }));
    }
    await transaction(board.id, changes, [{ kind: 'run-queued', runId: run.id, status: 'queued', agentIds: starters }], messages);
    admit(board, messages);
    schedule();
    return kind === 'manual' ? { message: messages[0], runId: run.id } : { runId: run.id };
  }

  function exportSafe(value) {
    const scrub = v => {
      if (Array.isArray(v)) return v.map(scrub);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !/apiKey|authToken|password|credential|authorization|secretReference|nativeSessionProof/i.test(k)).map(([k, val]) => [k, scrub(val)]));
      return typeof v === 'string' ? redact(v).replace(/secret:[a-f0-9-]{36}/gi, '[REDACTED REFERENCE]') : v;
    };
    return scrub(copy(value));
  }

  async function handleLocked(action, payload) {
    assertBinding(payload);
    await initialize();
    if (action === 'capabilities') {
      const providers = []; for (const provider of ['codex', 'claude', 'gemini']) providers.push(await native.probe(provider));
      providers.push({ id: 'api', name: 'Configured API', installed: !!requestAI, login: 'native-login-not-checked', supports: SUPPORTS.api });
      return { providers, limits: { maxTurns: 100, concurrency: 4, globalConcurrency: 4, maxAgents: 40, maxLinks: 200, messageBytes: MAX_BYTES, nativeOutputBytes: MAX_BYTES, snapshotPage: 500 } };
    }
    if (action === 'validateBoard') { try { normalizeBoard(payload.board); return { valid: true, errors: [] }; } catch (e) { return { valid: false, errors: [e.message] }; } }
    if(action==='configureProvider'){if(!native.configure)fail('UNSUPPORTED','This native adapter does not support choosing a tool.');return native.configure(payload.provider,payload.path);}
    if(action==='loginInvocation'){if(!native.loginInvocation)fail('UNSUPPORTED','This native adapter does not support native login.');return native.loginInvocation(payload.provider);}
    if (action === 'listBoards') return { records: await list('agent-boards') };
    if (action === 'approveProjectFolder') return projectFolders.approve(root,payload.path);
    if (action === 'projectFolderStatus') return projectFolders.status(root,payload.path);
    if (action === 'listWorkflows') return { records: await list('workflows') };
    if (action === 'saveBoard') {
      const board = normalizeBoard(payload.board), prior = await read('agent-boards', board.id);
      if ((prior?.revision ?? null) !== payload.expectedRevision) fail('CONFLICT', 'Board changed in another window. Reload before saving.');
      if (prior) {
        const pending = (await values('agent-messages', board.id)).some(m => ['queued', 'running'].includes(m.value.state));
        if ((pending || acceptanceRuns.has(board.id)) && digest(boardRuntime(prior.value)) !== digest(boardRuntime(board))) fail('ACTIVE_RUN', 'Stop active or queued turns and acceptance checks before changing executable agent settings or links. Goal wording is snapshotted per run.');
        for (const old of prior.value.nodes) {
          const next = board.nodes.find(n => n.id === old.id), sr = await sessionRecord(board.id, old.id);
          if (sr?.value.nativeSessionId && next && (['provider', 'instructions', 'permission', 'model', 'effort'].some(k => old[k] !== next[k]))) fail('SESSION_RESET_REQUIRED', 'Create a new conversation before changing a native agent folder, provider, model, effort, permissions or instructions.');
          if (next && sr && !sr.value.nativeSessionId && old.provider !== next.provider && sr.value.status !== 'idle') fail('SESSION_RESET_REQUIRED', 'Create a new conversation before changing this provider.');
        }
      }
      const changes = [mutation('agent-boards', board.id, board, prior)];
      for (const node of board.nodes) {
        const sr = await sessionRecord(board.id, node.id);
        if (!sr) changes.push(mutation('agent-sessions', `${board.id}:${node.id}`, newSessionValue(board, node)));
        else if(node.provider!=='api'&&(sr.value.workingDirectory||root)!==projectPath(board,node,root)){
          const directory=projectPath(board,node,root),cached=conversations.entries(sr.value).filter(c=>!c.archived&&c.provider===node.provider&&c.workingDirectory===directory).at(-1);
          const next=cached||newSessionValue(board,node,conversations.nextGeneration(sr.value));
          if(next.nativeSessionId&&!sessionProof.verify(next))fail('SESSION_MISMATCH','The saved conversation cannot be resumed on this computer. Start a new chat for this folder.');
          changes.push(mutation('agent-sessions',sr.id,conversations.activate(sr.value,next),sr));
        }
        else if (!sr.value.nativeSessionId && sr.value.status === 'idle' && (sr.value.provider !== node.provider||(sr.value.workingDirectory||root)!==(node.provider==='api'?root:projectPath(board,node,root)))) changes.push(mutation('agent-sessions', sr.id, { ...sr.value, provider: node.provider, workingDirectory:projectPath(board,node,root) }, sr));
      }
      await transaction(board.id, changes, [{ kind: 'board-saved' }]);
      return { record: await read('agent-boards', board.id) };
    }
    const br = await boardRecord(payload.boardId), board = br.value;
    switch (action) {
      case 'getBoard': return { record: br };
      case 'deleteBoard': {
        if ((await values('agent-messages', board.id)).some(r => ['queued', 'running'].includes(r.value.state)) || [...active.values()].some(a => a.boardId === board.id) || acceptanceRuns.has(board.id)) fail('ACTIVE_RUN', 'Stop and drain this board before deleting it.');
        if (payload.expectedRevision !== br.revision) fail('CONFLICT', 'Board changed before deletion.');
        const records = [{ collection: 'agent-boards', id: br.id, expectedRevision: br.revision, delete: true }];
        for (const c of COLLECTIONS.slice(1)) for (const r of await values(c, board.id)) records.push({ collection: c, id: r.id, expectedRevision: r.revision, delete: true });
        if (records.length > 10000) fail('LIMIT', 'Board history exceeds one atomic deletion. Export and use workspace retention tools.');
        await call('transact', { records }); return { deleted: true };
      }
      case 'previewGeneratedTests': {
        const generated=require('./generated-tests.cjs');
        const parsed=await generated.validateGeneratedTests(generated.parseGeneratedTests(payload.text,payload.filename));
        const preview=await require('./test-import.cjs').previewTestImport(parsed,{read});
        const token=crypto.randomUUID();if(generatedPreviews.size>=25)generatedPreviews.delete(generatedPreviews.keys().next().value);generatedPreviews.set(token,{...preview,boardId:board.id,root,epoch,created:Date.now()});
        for(const [key,value] of generatedPreviews)if(Date.now()-value.created>15*60*1000)generatedPreviews.delete(key);
        return {...preview,token};
      }
      case 'importGeneratedTests': {
        const tokens=payload.tokens||[payload.token];
        if(!Array.isArray(tokens)||!tokens.length||tokens.length>25||new Set(tokens).size!==tokens.length)fail('VALIDATION','Choose up to 25 distinct reviewed exports.');
        const previews=tokens.map(token=>generatedPreviews.get(token));
        if(previews.some(p=>!p||p.root!==root||p.epoch!==epoch||p.boardId!==board.id||Date.now()-p.created>15*60*1000))fail('STALE_PREVIEW','Choose the file again to review it in this workspace.');
        if(payload.reviewed!==true)fail('REVIEW_REQUIRED','Review the test source before importing.');
        const helper=require('./test-import.cjs');
        const plan=await helper.planTestImport(previews,{read,mode:payload.mode||'library',bundleName:payload.bundleName,duplicatePolicy:payload.duplicatePolicy,duplicatePolicies:payload.duplicatePolicies});
        const result=await helper.importTestPlan(plan,{transact:records=>call('transact',{records})});
        for(const token of tokens)generatedPreviews.delete(token);
        return result;
      }
      case 'snapshot': {
        const after = payload.afterSequence ?? 0, limit = payload.limit ?? 200;
        if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500) fail('VALIDATION', 'Snapshot cursor must be nonnegative and page size 1–500.');
        const s = await state(board.id);
        const messages = (await values('agent-messages', board.id)).map(r => r.value), events = (await values('agent-events', board.id)).map(r => r.value).filter(e => e.recordType !== 'cursor');
        const page = [...messages.map(value => ({ kind: 'message', value })), ...events.map(value => ({ kind: 'event', value }))].filter(x => x.value.sequence > after).sort((a, b) => a.value.sequence - b.value.sequence);
        const items = page.slice(0, limit), pageEvents = items.filter(x => x.kind === 'event').map(x => x.value);
        const referenced = new Set(pageEvents.flatMap(e => [...(e.messageIds || []), ...(e.messageId ? [e.messageId] : [])]));
        const pageMessages = new Map(items.filter(x => x.kind === 'message').map(x => [x.value.id, x.value]));
        for (const m of messages) if (referenced.has(m.id)) pageMessages.set(m.id, m);
        const sessions = (await values('agent-sessions', board.id)).map(({value}) => {const {nativeSessionProof,conversations:stored,...session}=value;return {...session,conversations:conversations.summaries(value)};});
        return { activity: [...active.values()].filter(w=>w.boardId===board.id).map(w=>({agentId:w.agentId,messageId:w.messageId,startedAt:w.startedAt,...w.progress})), board: br, sessions, runs: (await values('agent-runs', board.id)).map(r => r.value), messages: [...pageMessages.values()].sort((a, b) => a.sequence - b.sequence), events: pageEvents, cursor: items.at(-1)?.value.sequence ?? after, hasMore: page.length > limit, paused: s.paused, latestSequence: s.sequence, acceptanceRunning: acceptanceRuns.has(board.id) };
      }
      case 'send': {
        const pending=(await values('agent-messages',board.id)).some(r=>['running','queued'].includes(r.value.state));
        if(payload.recipientId){
          if(payload.recipientId===payload.agentId||!board.nodes.some(n=>n.id===payload.recipientId))fail('VALIDATION','Choose another agent on this board.');
          if(!pending){const edge=board.edges.find(e=>e.source===payload.agentId&&e.target===payload.recipientId);if(edge)edge.enabled=true;else board.edges.push({id:crypto.randomUUID(),source:payload.agentId,target:payload.recipientId,enabled:true});board.mode='linked';board.maxTurns=Math.max(2,board.maxTurns);await transaction(board.id,[mutation('agent-boards',br.id,board,br)],[{kind:'route-enabled',from:payload.agentId,to:payload.recipientId}]);}
          payload.collaborate=true;
        } else if(payload.collaborate&&!board.edges.some(e=>e.enabled&&e.source===payload.agentId))fail('VALIDATION','Choose a recipient in this chat, or connect this agent to another agent.');
        return submit(board,payload,payload.collaborate?'collaboration':'manual');
      }
      case 'runGoal': return submit(board, payload, 'goal');
      case 'pause': case 'resume': {
        const paused = action === 'pause';
        await transaction(board.id, [], [{ kind: paused ? 'paused' : 'resumed' }], [], { paused });
        if (!paused) schedule(); return { paused };
      }
      case 'cancel': if (payload.runId && (await read('agent-runs', payload.runId))?.value?.boardId !== board.id) fail('NOT_FOUND', 'Run does not belong to this board.'); if(payload.agentId&&!board.nodes.some(n=>n.id===payload.agentId))fail('NOT_FOUND','Agent was not found.');await cancelMatching(board.id, payload.runId,payload.agentId); return { cancelled: true };
      case 'newSession': case 'selectConversation': case 'archiveConversation': case 'restoreConversation': case 'deleteConversation': case 'renameConversation': {
        const node=board.nodes.find(n=>n.id===payload.agentId);if(!node)fail('NOT_FOUND','Agent was not found.');
        if(action==='newSession')await cancelMatching(board.id,null,node.id);
        const sr=await sessionRecord(board.id,node.id),current=sr.value;
        if(action!=='newSession'&&([...active.values()].some(a=>a.boardId===board.id&&a.agentId===node.id)||(await values('agent-messages',board.id)).some(r=>r.value.agentId===node.id&&['queued','running'].includes(r.value.state))))fail('ACTIVE_RUN','This agent is working. Stop its run or wait, then change chats.');
        if(action==='newSession'&&payload.expectedGeneration!==current.generation)fail('CONFLICT','Conversation generation changed. Refresh and try again.');
        const generation=payload.generation??current.generation;
        let all=conversations.entries(current),chosen=all.find(c=>c.generation===generation),next=current;
        if(!chosen)fail('NOT_FOUND','Conversation was not found.');
        let changes=[];
        if(action==='newSession') {next=conversations.activate(current,newSessionValue(board,node,conversations.nextGeneration(current)));if(payload.name)next.name=text(payload.name,'Chat name',300);}
        if(action==='selectConversation') {if(chosen.nativeSessionId&&!sessionProof.verify(chosen))fail('SESSION_MISMATCH','This saved native chat belongs to another installation. Start a new chat.');chosen.archived=false;next=conversations.activate(current,chosen);const project=board.projects?.find(p=>p.path===chosen.workingDirectory);node.activeProjectId=project?.id||'';node.projectId=node.activeProjectId;changes.push(mutation('agent-boards',br.id,board,br));}
        if(action==='renameConversation') {chosen.name=text(payload.name,'Chat name',300);if(!chosen.name.trim())fail('VALIDATION','Give the chat a name.');next=conversations.activate({...current,conversations:all.filter(c=>c.generation!==current.generation)},current.generation===generation?chosen:current);}
        if(action==='restoreConversation') {chosen.archived=false;next={...current,conversations:all.filter(c=>c.generation!==current.generation)};if(current.generation===generation)next.archived=false;}
        if(action==='archiveConversation'||action==='deleteConversation') {
          chosen.archived=true;
          if(action==='deleteConversation') {all=all.filter(c=>c.generation!==generation);for(const r of await values('agent-messages',board.id))if(r.value.agentId===node.id&&r.value.generation===generation)changes.push({collection:'agent-messages',id:r.id,expectedRevision:r.revision,delete:true});}
          if(current.generation===generation){const fresh=newSessionValue(board,node,conversations.nextGeneration(current));next={...fresh,conversations:all};}
          else next={...current,conversations:all.filter(c=>c.generation!==current.generation)};
        }
        changes.push(mutation('agent-sessions',sr.id,next,sr));await transaction(board.id,changes,[{kind:'conversation-changed',agentId:node.id,generation:next.generation,operation:action}]);quarantined.delete(`${board.id}:${node.id}`);return action==='newSession'?next:conversations.summaries(next);
      }
      case 'exportBoard': return exportSafe({ schemaVersion: 1, board, sessions: (await values('agent-sessions', board.id)).map(r => r.value), messages: (await values('agent-messages', board.id)).map(r => r.value).sort((a, b) => a.sequence - b.sequence), events: (await values('agent-events', board.id)).map(r => r.value).filter(e => e.recordType !== 'cursor').sort((a, b) => a.sequence - b.sequence), runs: (await values('agent-runs', board.id)).map(r => r.value) });
      case 'runAcceptance': fail('INTERNAL', 'Acceptance dispatch must run outside the control lock.');
      default: fail('UNKNOWN_ACTION', `Unknown agents action: ${action}`);
    }
  }

  async function handle(action, payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('VALIDATION', 'Agent action payload must be an object.');
    if(action==='connection'){
      const captured=await serialized(async()=>{assertBinding(payload);return{root,epoch};});
      if(payload.provider==='api')return {provider:'api',state:'configuration',ready:null,modelPromptSent:false,summary:'Review the endpoint, model and encrypted credential in Agent settings. Connection repair does not send a test prompt.'};
      if(!native.diagnose)fail('UNSUPPORTED','Connection diagnostics are unavailable for this adapter.');
      const result=await native.diagnose(payload.provider);
      return serialized(()=>{assertBinding(payload);if(root!==captured.root||epoch!==captured.epoch)fail('WORKSPACE_CHANGED','Workspace changed during the connection check. Reopen repair in the current board.');return result;});
    }
    if (action === 'runAcceptance') {
      const preparation = await serialized(async () => {
        assertBinding(payload); await initialize(); const br = await boardRecord(payload.boardId);
        if (!runAcceptance) fail('ACCEPTANCE_UNAVAILABLE', 'No acceptance workflow executor is connected.');
        if (!br.value.acceptanceWorkflowId) fail('VALIDATION', 'Select an acceptance workflow first.');
        if (acceptanceRuns.has(br.id)) fail('ACTIVE_ACCEPTANCE', 'Acceptance checks are already running for this board.');
        if ((await values('agent-messages', br.id)).some(m => ['queued', 'running'].includes(m.value.state))) fail('ACTIVE_RUN', 'Finish or stop agent turns before running acceptance checks.');
        const runs = (await values('agent-runs', br.id)).map(r => r.value).filter(r => TERMINAL.has(r.status)).sort((a, b) => (b.startSequence || 0) - (a.startSequence || 0) || b.createdAt.localeCompare(a.createdAt));
        await transaction(br.id, [], [{ kind: 'acceptance-started', workflowId: br.value.acceptanceWorkflowId, ...(runs[0] ? { runId: runs[0].id } : {}) }]);
        let complete;
        const entry = { controller: new AbortController(), runId: runs[0]?.id, promise: new Promise(resolve => { complete = resolve; }), complete: () => complete() };
        acceptanceRuns.set(br.id, entry);
        return { board: br.value, acceptanceCriteria: runs[0]?.taskContext?.acceptanceCriteria ?? runs[0]?.acceptanceCriteria ?? br.value.acceptanceCriteria, binding: root, capturedEpoch: epoch, sequence: (await state(br.id)).sequence, runId: runs[0]?.id, entry };
      });
      const { entry } = preparation;
      try {
        if (entry.controller.signal.aborted) fail('CANCELLED', 'Acceptance checks were cancelled before starting.');
        const result = await runAcceptance({ boardId: preparation.board.id, workflowId: preparation.board.acceptanceWorkflowId, workspaceRoot: preparation.binding, acceptanceCriteria: preparation.acceptanceCriteria, signal: entry.controller.signal });
        await serialized(async () => {
          if (epoch !== preparation.capturedEpoch || root !== preparation.binding) fail('WORKSPACE_CHANGED', 'Workspace changed during acceptance.');
          if (entry.controller.signal.aborted || result?.status === 'CANCELLED') {
            await transaction(preparation.board.id, [], [{ kind: 'acceptance-cancelled', workflowId: preparation.board.acceptanceWorkflowId, result: exportSafe(result) }]); return;
          }
          if ((await state(preparation.board.id)).sequence !== preparation.sequence) fail('ACCEPTANCE_STALE', 'Board changed during acceptance; results were not assigned to a different run. Run checks again when agents are idle.');
          const status = result?.status === 'SUCCESS' || result?.status === 'VERIFIED' ? 'VERIFIED' : 'FAILED';
          const changes = [];
          for (const r of await values('agent-runs', preparation.board.id)) if (r.id === preparation.runId) changes.push(mutation('agent-runs', r.id, { ...r.value, acceptance: status, acceptanceEvidence: exportSafe(result) }, r));
          await transaction(preparation.board.id, changes, [{ kind: 'acceptance-finished', acceptance: status, workflowId: preparation.board.acceptanceWorkflowId, result: exportSafe(result) }]);
        });
        return result;
      } catch (error) {
        await serialized(async () => {
          if (epoch === preparation.capturedEpoch && root === preparation.binding) await transaction(preparation.board.id, [], [{ kind: entry.controller.signal.aborted ? 'acceptance-cancelled' : 'acceptance-error', workflowId: preparation.board.acceptanceWorkflowId, error: redact(error.message) }]);
        });
        throw error;
      } finally {
        await serialized(async () => { if (acceptanceRuns.get(preparation.board.id) === entry) acceptanceRuns.delete(preparation.board.id); });
        entry.complete();
      }
    }
    return serialized(() => handleLocked(action, payload));
  }

  async function drain() {
    await serialized(async () => {
      transitioning = true;
      if (root && initialized) for (const b of await list('agent-boards')) await cancelMatching(b.id);
      for (const a of active.values()) a.controller.abort();
      for (const a of acceptanceRuns.values()) a.controller.abort();
    });
    await Promise.allSettled([...active.values(), ...acceptanceRuns.values()].map(a => a.promise));
    await chain;
  }
  async function setWorkspace(nextRoot) {
    const candidate = nextRoot ? fs.realpathSync(nextRoot) : null;
    await drain();
    await serialized(async () => { epoch++; root = candidate; initialized = false; transitioning = false; active.clear(); admissions.clear(); quarantined.clear(); generatedPreviews.clear(); });
    return { workspaceRoot: root };
  }
  async function close() { await drain(); await serialized(async () => { closed = true; root = null; epoch++; active.clear(); admissions.clear(); quarantined.clear(); }); }
  return { handle, setWorkspace, close };
}

module.exports = { createService, normalizeBoard, TERMINAL };
