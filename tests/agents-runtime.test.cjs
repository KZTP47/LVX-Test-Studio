'use strict';
// All provider traffic in this file is a deterministic QA fixture. No live
// provider request, credential inspection or native user conversation is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createService, normalizeBoard } = require('../services/agents/index.cjs');
const { createNativeTransport, buildInvocation, resolveExecutable } = require('../services/agents/native.cjs');
const workspaceModule = require('../services/workspace/index.cjs');

const SID = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function board(overrides = {}) {
  return { schemaVersion: 1, id: 'board', name: 'QA fixture board', goal: 'Exact fixture goal\nÅäö 😀', acceptanceCriteria: 'Fixture checks pass', mode: 'manual', maxTurns: 4, concurrency: 1, nodes: [{ id: 'a', name: 'Fixture A', provider: 'codex', model: '', effort: '', permission: 'native', instructions: '', position: { x: 0, y: 0 } }], edges: [], ...overrides };
}
const taskInput = (goal = board().goal, criteria = board().acceptanceCriteria) => `[Task context]\nGoal:\n${goal}\nAcceptance criteria:\n${criteria}`;
function memoryWorkspace() {
  const records = new Map(); let revision = 0, binding = 'fixture';
  return { records, setBinding(v) { binding = v; }, async handle(action, p) {
    if (p.workspaceRoot !== binding) throw Error('Fixture workspace binding mismatch');
    if (action === 'list') return { records: [...records.values()].filter(r => r.collection === p.collection).map(r => structuredClone(r)), revision };
    if (action === 'read') return structuredClone(records.get(`${p.collection}/${p.id}`) || null);
    if (action === 'transact') {
      for (const r of p.records) if ((records.get(`${r.collection}/${r.id}`)?.revision ?? null) !== r.expectedRevision) throw Object.assign(Error('Fixture conflict'), { code: 'CONFLICT' });
      for (const r of p.records) { const key = `${r.collection}/${r.id}`; if (r.delete) records.delete(key); else records.set(key, { collection: r.collection, id: r.id, value: structuredClone(r.value), revision: revision + 1 }); }
      revision++; return { revision };
    }
    throw Error('Fixture unsupported action ' + action);
  } };
}
async function setup(t, options = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-agent-fixture-')), root = path.join(temp, 'workspace'); fs.mkdirSync(root);
  const workspace = options.realStore ? workspaceModule.createService({ workspaceRoot: root, dataDir: path.join(temp, 'private') }) : memoryWorkspace();
  workspace.setBinding?.(fs.realpathSync(root));
  const calls = [], nativeTransport = options.nativeTransport || { probe: async id => ({ id, installed: true, login: 'native-login-not-checked', supports: { resume: true, permissions: ['native'] } }), execute: async args => { calls.push(args); return { status: 'completed', nativeSessionId: args.session.nativeSessionId || SID, text: `Fixture response ${calls.length}`, protocol: [] }; } };
  const events = [];
  const service = createService({ workspaceRoot: root, workspace, nativeTransport, emit: e => events.push(e), ...options });
  t.after(async () => { await service.close(); await workspace.close?.(); fs.rmSync(temp, { recursive: true, force: true }); });
  const saved = await service.handle('saveBoard', { board: board(options.board), expectedRevision: null });
  return { service, workspace, calls, events, root, temp, saved };
}
async function settle(service, runId) {
  for (let n = 0; n < 200; n++) { const snapshot = await service.handle('snapshot', { boardId: 'board', limit: 500 }); const run = snapshot.runs.find(r => r.id === runId); if (run && !['queued', 'running'].includes(run.status)) return snapshot; await delay(10); }
  throw Error('Fixture run did not settle');
}
function fixtureTransport(t, scenario = 'success', extra = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-native-protocol-fixture-')), script = path.join(temp, 'fixture.cjs');
  fs.writeFileSync(script, String.raw`
const fs=require('node:fs');
const [provider,scenario,receipt,...args]=process.argv.slice(2);
if(args.includes('--version')){process.stdout.write('fixture-cli 1.0');process.exit(0);}
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
fs.writeFileSync(receipt,JSON.stringify({provider,args,input,cwd:process.cwd()}));
const sid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const emit=o=>process.stdout.write(JSON.stringify(o)+'\n');
if(scenario==='partialhang'){
emit({type:'thread.started',thread_id:sid});emit({type:'item.completed',item:{type:'agent_message',text:'Fixture partial exact Å😀\n'+'tail'.repeat(6000)}});process.stderr.write('Fixture diagnostic before stop');setInterval(()=>{},1000);return;
}
if(scenario==='dead'){process.stderr.write('fixture process failed');process.exit(7);}
if(scenario==='malformed'){process.stdout.write('{bad json}\n');return;}
if(scenario==='hang'){setInterval(()=>{},1000);return;}
if(scenario==='treehang'){
const childScript="setTimeout(()=>require('node:fs').writeFileSync(process.argv[1],'fixture descendant escaped'),700);setInterval(()=>{},1000)";
require('node:child_process').spawn(process.execPath,['-e',childScript,receipt+'.descendant'],{stdio:'ignore',windowsHide:true});
setInterval(()=>{},1000);return;
}
const id=scenario==='mismatch'?other:sid;
const body=scenario==='terse'?'Done.':scenario==='large'?'Å😀'.repeat(10000):'Full fixture text Åäö 😀\nline2'+('tail'.repeat(6000));
if(provider==='codex'){
emit({type:'thread.started',thread_id:id});
if(scenario==='blocked'){emit({type:'turn.failed',error:{message:'Permission approval required'}});return;}
if(scenario==='limit'){emit({type:'turn.failed',error:{message:'Rate limit reached'}});return;}
emit({type:'item.completed',item:{id:'m',type:'agent_message',text:scenario==='empty'?'':body}});
if(scenario!=='truncated')emit({type:'turn.completed',usage:{input_tokens:1,output_tokens:2}});
}else if(provider==='claude'){
emit({type:'system',subtype:'init',session_id:id});
emit({type:'assistant',session_id:id,message:{id:'m',content:[{type:'text',text:scenario==='empty'?'':body}],stop_reason:scenario==='limit'?'max_tokens':'end_turn'}});
if(scenario!=='truncated')emit({type:'result',session_id:id,subtype:scenario==='blocked'?'error_during_execution':'success',is_error:scenario==='blocked',permission_denials:scenario==='blocked'?[{tool_name:'Bash'}]:[]});
}else{
emit({type:'init',session_id:id,model:'fixture'});
emit({type:'message',role:'assistant',content:scenario==='empty'?'':body,delta:true});
if(scenario!=='truncated')emit({type:'result',status:scenario==='blocked'||scenario==='limit'?'error':'success',error:scenario==='blocked'?{type:'permission',message:'Permission denied'}:scenario==='limit'?{type:'quota',message:'Quota limit reached'}:undefined});
}
});
`, 'utf8');
  let count = 0; const receipts = [];
  const transport = createNativeTransport({ resolve: provider => { const receipt = path.join(temp, `receipt-${count++}.json`); receipts.push(receipt); return { command: process.execPath, prefix: [script, provider, scenario, receipt] }; }, timeoutMs: 2000, ...extra });
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  return { transport, receipts };
}

test('schema rejects bad topology, unsupported guarantees, plaintext keys and invalid defaults', () => {
  const b = board(); assert.deepEqual(normalizeBoard(b), b);
  for (const bad of [board({ edges: [{ id: 'e', source: 'a', target: 'missing' }] }), board({ maxTurns: 0 }), board({ concurrency: 5 }), board({ nodes: [b.nodes[0], b.nodes[0]] }), board({ nodes: [{ ...b.nodes[0], provider: 'gemini', permission: 'read-only' }] }), board({ nodes: [{ ...b.nodes[0], provider: 'api', apiConfig: { provider: 'openai', apiKey: 'plaintext' } }] })]) assert.throws(() => normalizeBoard(bad));
});

test('native argv omits blank overrides, retains exact stdin and uses explicit bound resume', () => {
  const n = board().nodes[0];
  assert.deepEqual(buildInvocation('codex', { node: n, text: ' Å😀\n--danger ' }), { args: ['exec', '--skip-git-repo-check', '--json', '-'], input: ' Å😀\n--danger ' });
  const r = buildInvocation('codex', { node: { ...n, permission: 'read-only', model: 'model', effort: 'high' }, session: { nativeSessionId: SID }, text: 'x' });
  assert.deepEqual(r.args, ['exec', '-c', 'sandbox_mode="read-only"', '--model', 'model', '-c', 'model_reasoning_effort="high"', 'resume', SID, '--skip-git-repo-check', '--json', '-']);
  assert.throws(() => buildInvocation('codex', { node: n, session: { nativeSessionId: '--last' }, text: 'x' }), /invalid/);
  assert.throws(() => buildInvocation('gemini', { node: { ...n, provider: 'gemini', permission: 'workspace-write' }, text: 'x' }), /cannot guarantee/);
});

for (const provider of ['codex', 'claude', 'gemini']) {
  test(`actual fixture process ${provider}: Unicode/full body, argv and same-session resume`, async t => {
    const f = fixtureTransport(t), node = { ...board().nodes[0], provider }, prompt = '  Exact user text\nÅäö 😀\n--arg $(unsafe)';
    const one = await f.transport.execute({ node, session: {}, text: prompt, workspaceRoot: os.tmpdir() });
    assert.equal(one.status, 'completed'); assert.equal(one.nativeSessionId, SID); assert.ok(one.text.endsWith('tail'.repeat(6000))); assert.match(one.text, /Åäö 😀\nline2/);
    const receipt = JSON.parse(fs.readFileSync(f.receipts[0], 'utf8')); assert.equal(receipt.input, prompt); assert.equal(receipt.cwd.toLowerCase(), os.tmpdir().toLowerCase());
    assert.ok(!receipt.args.some(a => /yolo|dangerously|system-prompt|model|effort/.test(a)));
    const two = await f.transport.execute({ node, session: { nativeSessionId: SID }, text: prompt, workspaceRoot: os.tmpdir() });
    assert.equal(two.status, 'completed'); const again = JSON.parse(fs.readFileSync(f.receipts[1], 'utf8')); assert.ok(again.args.includes(SID)); assert.ok(again.args.includes(provider === 'codex' ? 'resume' : '--resume'));
  });
  test(`actual fixture ${provider}: blocked/limit/partial/zero and session mismatch never green`, async t => {
    for (const [scenario, expected] of [['blocked', 'blocked'], ['limit', 'limit'], ['truncated', 'partial'], ['empty', 'error'], ['mismatch', 'error']]) {
      const f = fixtureTransport(t, scenario); const result = await f.transport.execute({ node: { ...board().nodes[0], provider }, session: { nativeSessionId: SID }, text: 'fixture', workspaceRoot: os.tmpdir() });
      assert.equal(result.status, expected, `${provider} ${scenario}: ${result.error}`); assert.ok(result.error); assert.notEqual(result.status, 'completed');
    }
  });
}

test('native process malformed, dead, bounded output, timeout and cancellation outcomes', async t => {
  for (const [scenario, expected, opts] of [['malformed', 'error'], ['dead', 'error'], ['large', 'limit', { maxBytes: 1000 }], ['hang', 'limit', { timeoutMs: 150 }]]) {
    const f = fixtureTransport(t, scenario, opts); const result = await f.transport.execute({ node: board().nodes[0], session: {}, text: 'fixture', workspaceRoot: os.tmpdir() }); assert.equal(result.status, expected, scenario);
  }
  const f = fixtureTransport(t, 'hang'), controller = new AbortController();
  const running = f.transport.execute({ node: board().nodes[0], session: {}, text: 'fixture', workspaceRoot: os.tmpdir(), signal: controller.signal }); setTimeout(() => controller.abort(), 50); assert.equal((await running).status, 'cancelled');
  controller.abort(); assert.equal((await f.transport.execute({ node: board().nodes[0], text: 'fixture', signal: controller.signal })).status, 'cancelled');
});

test('capability checks invoke only version and never infer login', async t => {
  const f = fixtureTransport(t); const p = await f.transport.probe('codex'); assert.equal(p.version, 'fixture-cli 1.0'); assert.equal(p.login, 'native-login-not-checked');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-resolution-fixture-'));
  try { fs.writeFileSync(path.join(temp, 'codex.cmd'), '@echo fixture'); assert.equal(resolveExecutable('codex', { env: { PATH: temp }, platform: 'win32' }), null); }
  finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('official Codex npm entry is resolved without executing Windows cmd shims', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-codex-npm-fixture-')); t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const entry = path.join(temp, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'); fs.mkdirSync(path.dirname(entry), { recursive: true }); fs.writeFileSync(entry, '// official entry path fixture; never executed');
  const resolved = resolveExecutable('codex', { env: { PATH: temp }, platform: 'win32' }); assert.equal(resolved.command, process.execPath); assert.deepEqual(resolved.prefix, [entry]); assert.equal(resolved.env.ELECTRON_RUN_AS_NODE, '1');
});

test('canonical SQLite records survive reopen; request UUID dedupes exact text and session resumes', async t => {
  const h = await setup(t, { realStore: true }), requestId = crypto.randomUUID(), input = '  Preserve whitespace Å😀\n' + 'full'.repeat(7000);
  const one = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: input, requestId });
  const duplicate = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: input, requestId }); assert.equal(duplicate.runId, one.runId);
  const s = await settle(h.service, one.runId); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].text, input); assert.equal(s.runs[0].acceptance, 'UNREVIEWED'); assert.equal(s.messages.find(m => m.role === 'user').text, input);
  await assert.rejects(h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'different', requestId }), /already used/);
  const two = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'next', requestId: crypto.randomUUID() }); await settle(h.service, two.runId); assert.equal(h.calls[1].session.nativeSessionId, SID);
  await h.service.close(); const reopened = createService({ workspaceRoot: h.root, workspace: h.workspace, nativeTransport: { probe: async () => ({}), execute: () => { throw Error('No replay allowed'); } } });
  try { const restored = await reopened.handle('exportBoard', { boardId: 'board' }); assert.equal(restored.messages.length, 4); assert.equal(restored.sessions[0].nativeSessionId, SID); assert.equal(restored.messages.find(m => m.role === 'user').text, input); }
  finally { await reopened.close(); }
});

test('idle queue serializes simultaneous sends; pause holds peers and current turn finishes', async t => {
  const pending = [], starts = []; const nativeTransport = { probe: async () => ({}), execute: args => { starts.push(args); return new Promise(resolve => pending.push(resolve)); } };
  const h = await setup(t, { nativeTransport });
  const first = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'one', requestId: crypto.randomUUID() });
  const second = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'two', requestId: crypto.randomUUID() });
  await delay(20); assert.equal(starts.length, 1); await h.service.handle('pause', { boardId: 'board' }); pending.shift()({ status: 'completed', text: 'first result', nativeSessionId: SID }); await settle(h.service, first.runId); await delay(20); assert.equal(starts.length, 1);
  assert.equal((await h.service.handle('snapshot', { boardId: 'board' })).paused, true);
  await h.service.handle('resume', { boardId: 'board' }); await delay(20); assert.equal(starts.length, 2); assert.equal(starts[1].session.nativeSessionId, SID); pending.shift()({ status: 'completed', text: 'second result', nativeSessionId: SID }); await settle(h.service, second.runId);
});

test('linked fulltext directed peer delivery is bounded by run budget; manual chat stays manual', async t => {
  const n = board().nodes[0], full = 'Full fixture peer Å😀\n' + 'x'.repeat(30000), calls = [];
  const nativeTransport = { probe: async () => ({}), execute: async args => { calls.push(args); return { status: 'completed', text: full, nativeSessionId: SID }; } };
  const h = await setup(t, { nativeTransport, board: { mode: 'linked', maxTurns: 3, nodes: [n, { ...n, id: 'b', name: 'Fixture B' }, { ...n, id: 'c', name: 'Unlinked fixture C' }], edges: [{ id: 'ab', source: 'a', target: 'b', enabled: true }, { id: 'ba', source: 'b', target: 'a', enabled: true }] } });
  const run = await h.service.handle('runGoal', { boardId: 'board', requestId: crypto.randomUUID() }), snapshot = await settle(h.service, run.runId);
  assert.equal(calls.length, 3); assert.equal(calls[0].text, taskInput()); assert.equal(calls[1].text, `${taskInput()}\n\n[Peer message from a to b]\n${full}`); assert.equal(calls[2].text, `${taskInput()}\n\n[Peer message from b to a]\n${full}`); assert.ok(!calls.some(c => c.node.id === 'c')); assert.equal(snapshot.runs[0].status, 'limit'); assert.equal(snapshot.runs[0].turns, 3); assert.equal(snapshot.messages.filter(m => m.role === 'peer').at(-1).text, full);
  const manual = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'manual fixture', requestId: crypto.randomUUID() }); await settle(h.service, manual.runId); assert.equal(calls.length, 4);
});

test('board concurrency is bounded and each agent has one worker across different runs', async t => {
  const n = board().nodes[0], pending = [], active = new Set(); let peak = 0;
  const nativeTransport = { probe: async () => ({}), execute: args => { assert.ok(!active.has(args.node.id)); active.add(args.node.id); peak = Math.max(peak, active.size); return new Promise(resolve => pending.push(() => { active.delete(args.node.id); resolve({ status: 'completed', text: 'fixture', nativeSessionId: SID }); })); } };
  const h = await setup(t, { nativeTransport, board: { concurrency: 2, nodes: [n, { ...n, id: 'b' }, { ...n, id: 'c' }] } });
  const run = await h.service.handle('runGoal', { boardId: 'board', agentIds: ['a', 'b', 'c'], requestId: crypto.randomUUID() }); await delay(30); assert.equal(pending.length, 2); assert.equal(peak, 2); pending.shift()(); await delay(30); assert.equal(pending.length, 2); pending.shift()(); pending.shift()(); await settle(h.service, run.runId); assert.equal(peak, 2);
});

test('new generation fences late output and provider change requires explicit reset', async t => {
  let resolveTurn; const h = await setup(t, { nativeTransport: { probe: async () => ({}), execute: () => new Promise(resolve => { resolveTurn = resolve; }) } });
  const run = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'old fixture', requestId: crypto.randomUUID() }); await delay(20);
  const session = await h.service.handle('newSession', { boardId: 'board', agentId: 'a', expectedGeneration: 1 }); assert.equal(session.generation, 2); resolveTurn({ status: 'completed', text: 'STALE SHOULD NEVER APPEAR', nativeSessionId: SID }); await delay(30);
  const snap = await h.service.handle('snapshot', { boardId: 'board' }); assert.equal(snap.sessions[0].generation, 2); assert.equal(snap.sessions[0].nativeSessionId, null); assert.ok(!snap.messages.some(m => m.text.includes('STALE'))); assert.equal(snap.runs.find(r => r.id === run.runId).status, 'cancelled');
  await assert.rejects(h.service.handle('newSession', { boardId: 'board', agentId: 'a', expectedGeneration: 1 }), /generation changed/);
});

test('session mismatch and resume failures remain explicit, without fresh-session retry', async t => {
  let count = 0; const h = await setup(t, { nativeTransport: { probe: async () => ({}), execute: async args => { count++; return count === 1 ? { status: 'completed', text: 'fixture first', nativeSessionId: SID } : { status: 'completed', text: 'fixture mismatched', nativeSessionId: OTHER }; } } });
  const first = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'one', requestId: crypto.randomUUID() }); await settle(h.service, first.runId);
  const second = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'two', requestId: crypto.randomUUID() }), s = await settle(h.service, second.runId); assert.equal(count, 2); assert.equal(s.runs.find(r => r.id === second.runId).status, 'error'); assert.equal(s.sessions[0].nativeSessionId, SID);
  const br = (await h.service.handle('getBoard', { boardId: 'board' })).record;
  await assert.rejects(h.service.handle('saveBoard', { board: { ...br.value, nodes: [{ ...br.value.nodes[0], provider: 'claude' }] }, expectedRevision: br.revision }), /new conversation/);
});

test('cancel is run-scoped; deletion/edits refuse active turns and new workspace drains before selection', async t => {
  const starts = []; const nativeTransport = { probe: async () => ({}), execute: args => new Promise(resolve => { starts.push(args); args.signal.addEventListener('abort', () => setTimeout(() => resolve({ status: 'cancelled', text: '' }), 30), { once: true }); }) };
  const h = await setup(t, { nativeTransport });
  const one = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture', requestId: crypto.randomUUID() }); await delay(20);
  const two = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'queued fixture', requestId: crypto.randomUUID() });
  await assert.rejects(h.service.handle('deleteBoard', { boardId: 'board', expectedRevision: h.saved.record.revision }), /Stop/);
  await assert.rejects(h.service.handle('saveBoard', { board: { ...h.saved.record.value, concurrency: 2 }, expectedRevision: h.saved.record.revision }), /Stop active/);
  await h.service.handle('cancel', { boardId: 'board', runId: two.runId }); assert.equal(starts[0].signal.aborted, false); const cancelled = await settle(h.service, two.runId); assert.equal(cancelled.runs.find(r => r.id === two.runId).status, 'cancelled');
  const other = path.join(h.temp, 'other'); fs.mkdirSync(other); await h.service.setWorkspace(other); h.workspace.setBinding(fs.realpathSync(other)); assert.equal(starts[0].signal.aborted, true); assert.deepEqual((await h.service.handle('listBoards')).records.map(r => r.id), ['board']); // memory fixture deliberately shares records; real workspace binding is host-owned
  assert.ok(!(await h.service.handle('snapshot', { boardId: 'board' })).messages.some(m => m.role === 'assistant'));
});

test('restart marks durable queued effects interrupted; explicit UUID repeat cannot replay', async t => {
  const h = await setup(t); await h.service.handle('pause', { boardId: 'board' }); const requestId = crypto.randomUUID();
  const sent = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture restart', requestId });
  // A second service models a crash/reopen without graceful cancellation.
  let launches = 0; const reopened = createService({ workspace: h.workspace, workspaceRoot: h.root, nativeTransport: { probe: async () => ({}), execute: async () => { launches++; return { status: 'completed', text: 'must not replay' }; } } });
  try { const s = await reopened.handle('snapshot', { boardId: 'board' }); assert.equal(s.messages[0].state, 'interrupted'); assert.equal(s.runs[0].status, 'interrupted'); await reopened.handle('resume', { boardId: 'board' }); await reopened.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture restart', requestId }); await delay(30); assert.equal(launches, 0); assert.equal(sent.runId, s.runs[0].id); }
  finally { await reopened.close(); }
});

test('snapshot pages a monotonic board-local cursor without truncating messages; export strips credentials', async t => {
  const h = await setup(t); const sent = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture ' + 'long'.repeat(6000), requestId: crypto.randomUUID() }); await settle(h.service, sent.runId);
  let cursor = 0, hasMore = true; const all = [];
  while (hasMore) { const s = await h.service.handle('snapshot', { boardId: 'board', afterSequence: cursor, limit: 2 }); all.push(...s.messages, ...s.events); assert.ok(s.cursor >= cursor); cursor = s.cursor; hasMore = s.hasMore; }
  const uniqueRecords = [...new Map(all.map(v => [v.id || `event:${v.sequence}`, v])).values()];
  const seq = uniqueRecords.map(v => v.sequence); assert.equal(new Set(seq).size, seq.length); assert.ok(all.find(m => m.role === 'user').text.endsWith('long'.repeat(6000)));
  const exported = await h.service.handle('exportBoard', { boardId: 'board' }); assert.equal(exported.schemaVersion, 1); assert.equal(exported.messages.length, 2);
  await assert.rejects(h.service.handle('snapshot', { boardId: 'board', limit: 501 }), /page size/);
});

test('API keeps exact current prompt and complete conversation history; refusal/limit separate from acceptance', async t => {
  const calls = [], node = { ...board().nodes[0], provider: 'api', apiConfig: { provider: 'custom', customEndpoint: 'http://127.0.0.1:12345/v1', apiKey: 'secret:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } };
  const h = await setup(t, { board: { nodes: [node] }, requestAI: async args => { calls.push(args); return { success: true, generatedText: calls.length === 1 ? 'Fixture full result Å😀' : 'Fixture partial', finishReason: calls.length === 1 ? 'stop' : 'length' }; } });
  const one = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: '  Exact fixture one\n', requestId: crypto.randomUUID() }); await settle(h.service, one.runId);
  const two = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: '  Exact fixture two\n', requestId: crypto.randomUUID() }); const s = await settle(h.service, two.runId);
  assert.equal(calls[0].prompt, '  Exact fixture one\n'); assert.equal(calls[1].prompt, '  Exact fixture two\n'); assert.deepEqual(calls[1].messages, [{ role: 'user', content: '  Exact fixture one\n' }, { role: 'assistant', content: 'Fixture full result Å😀' }, { role: 'user', content: '  Exact fixture two\n' }]); assert.equal(calls[1].systemPrompt, ''); assert.equal(s.runs.find(r => r.id === two.runId).status, 'limit'); assert.ok(s.runs.every(r => r.acceptance === 'UNREVIEWED'));
  assert.ok(!JSON.stringify(await h.service.handle('exportBoard', { boardId: 'board' })).includes('secret:'));
});

test('acceptance invokes only explicit callback and never infers approval from provider prose', async t => {
  let invocation; const h = await setup(t, { board: { acceptanceWorkflowId: 'fixture-checks' }, runAcceptance: async args => { invocation = args; return { status: 'ERROR', results: { check: 'Fixture failure' } }; } });
  const run = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture', requestId: crypto.randomUUID() }); let s = await settle(h.service, run.runId); assert.equal(s.runs[0].acceptance, 'UNREVIEWED');
  assert.equal((await h.service.handle('runAcceptance', { boardId: 'board' })).status, 'ERROR'); s = await h.service.handle('snapshot', { boardId: 'board' }); assert.equal(s.runs[0].acceptance, 'FAILED'); assert.equal(invocation.workflowId, 'fixture-checks'); assert.equal(invocation.workspaceRoot, fs.realpathSync(h.root));
});

test('atomic commit failure causes no launch, event or half-saved board', async t => {
  const h = await setup(t), original = h.workspace.handle.bind(h.workspace); let reject = true;
  h.workspace.handle = async (action, p) => { if (action === 'transact' && reject) throw Error('Fixture commit rejection'); return original(action, p); };
  const before = h.events.length; await assert.rejects(h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture', requestId: crypto.randomUUID() }), /commit rejection/); await delay(20); assert.equal(h.calls.length, 0); assert.equal(h.events.length, before); reject = false; assert.equal((await h.service.handle('snapshot', { boardId: 'board' })).runs.length, 0);
});

test('incremental snapshot returns updated input states through event references', async t => {
  let complete; const h = await setup(t, { nativeTransport: { probe: async () => ({}), execute: () => new Promise(resolve => { complete = resolve; }) } });
  const sent = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture incremental', requestId: crypto.randomUUID() }); await delay(20);
  const running = await h.service.handle('snapshot', { boardId: 'board', limit: 500 }); assert.equal(running.messages[0].state, 'running');
  complete({ status: 'completed', nativeSessionId: SID, text: 'fixture final' }); await settle(h.service, sent.runId);
  const increment = await h.service.handle('snapshot', { boardId: 'board', afterSequence: running.cursor, limit: 500 });
  assert.equal(increment.messages.find(m => m.id === sent.message.id).state, 'completed'); assert.ok(increment.cursor > running.cursor);
});

test('post-effect persistence failure quarantines agent, never launches next queued request', async t => {
  let complete; const launches = []; const h = await setup(t, { nativeTransport: { probe: async () => ({}), execute: args => { launches.push(args); return new Promise(resolve => { complete = resolve; }); } } });
  await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture first', requestId: crypto.randomUUID() }); await delay(20);
  await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture second', requestId: crypto.randomUUID() });
  const original = h.workspace.handle.bind(h.workspace); let failure = true;
  h.workspace.handle = async (action, payload) => { if (action === 'transact' && failure && payload.records.some(r => r.collection === 'agent-messages' && r.value?.role === 'assistant')) throw Error('Fixture quota after provider effect'); return original(action, payload); };
  complete({ status: 'completed', text: 'fixture actual provider effect', nativeSessionId: SID }); await delay(40); failure = false;
  assert.equal(launches.length, 1); assert.ok(h.events.some(e => e.type === 'runtime-error'));
  await assert.rejects(h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'no silent retry', requestId: crypto.randomUUID() }), /could not persist/);
  const reset = await h.service.handle('newSession', { boardId: 'board', agentId: 'a', expectedGeneration: 1 }); assert.equal(reset.generation, 2);
});

test('unproven prior native execution requires explicit reset; no automatic fresh launch', async t => {
  let launches = 0; const h = await setup(t, { nativeTransport: { probe: async () => ({}), execute: async () => { launches++; return { status: 'error', text: '', error: 'Fixture lost process before identity' }; } } });
  const one = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture', requestId: crypto.randomUUID() }); await settle(h.service, one.runId);
  await assert.rejects(h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'should require reset', requestId: crypto.randomUUID() }), /no proven session identity/); assert.equal(launches, 1);
});

test('native session binding is committed before completion; cancelled identity remains resumable', async t => {
  const h = await setup(t, { nativeTransport: { probe: async () => ({}), execute: async args => { await args.onSession(SID); return new Promise(resolve => args.signal.addEventListener('abort', () => resolve({ status: 'cancelled', text: '', nativeSessionId: SID }), { once: true })); } } });
  const sent = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture', requestId: crypto.randomUUID() }); await delay(20);
  const before = await h.service.handle('snapshot', { boardId: 'board' }); assert.equal(before.sessions[0].nativeSessionId, SID); assert.equal(before.sessions[0].status, 'running'); assert.ok(before.events.some(e => e.kind === 'session-bound'));
  await h.service.handle('cancel', { boardId: 'board' }); await settle(h.service, sent.runId);
});

test('typed API blocked/incomplete errors retain full partial text and never route it', async t => {
  const n = { ...board().nodes[0], provider: 'api', apiConfig: { provider: 'openai', model: 'fixture-explicit-model' } }; let calls = 0;
  const h = await setup(t, { board: { mode: 'linked', nodes: [n, { ...n, id: 'b' }], edges: [{ id: 'ab', source: 'a', target: 'b', enabled: true }] }, requestAI: async () => { calls++; throw Object.assign(Error('Fixture token exhaustion'), { code: 'AI_INCOMPLETE', finishReason: 'length', partialText: 'Fixture partial Å😀' + 'fulltail'.repeat(4000) }); } });
  const run = await h.service.handle('runGoal', { boardId: 'board', requestId: crypto.randomUUID() }), s = await settle(h.service, run.runId); assert.equal(s.runs[0].status, 'limit'); assert.equal(calls, 1); assert.ok(s.messages.find(m => m.role === 'assistant').text.endsWith('fulltail'.repeat(4000))); assert.equal(s.messages.filter(m => m.role === 'peer').length, 0);
});

test('acceptance is independently cancellable and workspace switch drains its callback', async t => {
  let checks = 0, seenSignal;
  const h = await setup(t, { board: { acceptanceWorkflowId: 'fixture-workflow' }, runAcceptance: args => { checks++; seenSignal = args.signal; return new Promise(resolve => args.signal.addEventListener('abort', () => setTimeout(() => resolve({ status: 'CANCELLED', fixture: true }), 20), { once: true })); } });
  const acceptance = h.service.handle('runAcceptance', { boardId: 'board' }); await delay(20);
  await assert.rejects(h.service.handle('runAcceptance', { boardId: 'board' }), /already running/);
  await assert.rejects(h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture', requestId: crypto.randomUUID() }), /acceptance checks/);
  await h.service.handle('cancel', { boardId: 'board' }); assert.equal(seenSignal.aborted, true); assert.equal((await acceptance).status, 'CANCELLED');
  const second = h.service.handle('runAcceptance', { boardId: 'board' }); await delay(20); await h.service.setWorkspace(h.root); assert.equal((await second).status, 'CANCELLED'); assert.equal(checks, 2);
});

test('real SQLite workspace selection cannot leak records or late results across projects', async t => {
  const h = await setup(t, { realStore: true }), other = path.join(h.temp, 'second-project'); fs.mkdirSync(other);
  await h.service.setWorkspace(other); await h.workspace.setWorkspace(other);
  assert.deepEqual((await h.service.handle('listBoards')).records, []); await assert.rejects(h.service.handle('snapshot', { boardId: 'board' }), /not found/);
  await h.service.setWorkspace(h.root); await h.workspace.setWorkspace(h.root); assert.equal((await h.service.handle('listBoards')).records.length, 1);
  await assert.rejects(h.service.handle('send', { boardId: 'board', workspaceRoot: other, agentId: 'a', text: 'fixture stale', requestId: crypto.randomUUID() }), /Workspace changed/);
});

test('paused queued state and event are one transaction; revision conflicts preserve board', async t => {
  const h = await setup(t), original = h.workspace.handle.bind(h.workspace), calls = [];
  h.workspace.handle = async (action, payload) => { if (action === 'transact') calls.push(payload.records); return original(action, payload); };
  await h.service.handle('pause', { boardId: 'board' }); const records = calls.at(-1); assert.ok(records.some(r => r.value?.kind === 'paused')); assert.ok(records.some(r => r.value?.recordType === 'cursor' && r.value.paused === true));
  await assert.rejects(h.service.handle('saveBoard', { board: { ...h.saved.record.value, name: 'stale fixture' }, expectedRevision: 999 }), /another window/); assert.equal((await h.service.handle('getBoard', { boardId: 'board' })).record.value.name, 'QA fixture board');
});

test('imported foreign or unsigned native IDs cannot resume; explicit newSession repairs binding', async t => {
  const h = await setup(t, { realStore: true });
  const first = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture original', requestId: crypto.randomUUID() }); await settle(h.service, first.runId);
  const original = await h.workspace.handle('read', { collection: 'agent-sessions', id: 'board:a' });
  for (const alteration of [{ workspaceRoot: path.join(h.temp, 'foreign-project') }, { nativeSessionId: OTHER }, { nativeSessionProof: undefined }]) {
    const record = await h.workspace.handle('read', { collection: 'agent-sessions', id: 'board:a' });
    await h.workspace.handle('transact', { records: [{ collection: 'agent-sessions', id: record.id, expectedRevision: record.revision, value: { ...original.value, ...alteration } }] });
    await assert.rejects(h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture import must block', requestId: crypto.randomUUID() }), /foreign|imported/);
  }
  assert.equal(h.calls.length, 1);
  await h.service.handle('newSession', { boardId: 'board', agentId: 'a', expectedGeneration: 1 });
  const second = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture deliberately fresh', requestId: crypto.randomUUID() }); await settle(h.service, second.runId); assert.equal(h.calls[1].session.nativeSessionId, null);
  const exported = await h.service.handle('exportBoard', { boardId: 'board' }); assert.ok(!JSON.stringify(exported).includes('nativeSessionProof'));
});

test('native provenance is scoped to app installation as well as complete session tuple', async t => {
  const { createSessionProof } = require('../services/agents/session-proof.cjs');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-provenance-fixture-')); t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const one = createSessionProof(path.join(temp, 'app-one')), two = createSessionProof(path.join(temp, 'app-two'));
  const s = { workspaceRoot: temp, boardId: 'b', agentId: 'a', provider: 'codex', generation: 1, nativeSessionId: SID }; s.nativeSessionProof = one.sign(s);
  assert.equal(one.verify(s), true); assert.equal(two.verify(s), false); assert.equal(createSessionProof(path.join(temp, 'app-one')).verify(s), true);
  for (const change of [{ workspaceRoot: 'foreign' }, { boardId: 'other' }, { agentId: 'other' }, { provider: 'claude' }, { generation: 2 }, { nativeSessionId: OTHER }]) assert.equal(one.verify({ ...s, ...change }), false);
});

test('native cancellation kills owned descendant process tree before it can write late output', async t => {
  const f = fixtureTransport(t, 'treehang'), controller = new AbortController();
  const result = f.transport.execute({ node: board().nodes[0], session: {}, text: 'fixture process tree', workspaceRoot: os.tmpdir(), signal: controller.signal });
  for (let n = 0; n < 100 && !fs.existsSync(f.receipts[0]); n++) await delay(5);
  assert.ok(fs.existsSync(f.receipts[0]), 'fixture parent started'); controller.abort(); assert.equal((await result).status, 'cancelled'); await delay(800);
  assert.equal(fs.existsSync(f.receipts[0] + '.descendant'), false);
});

test('acceptance verdict applies only to latest run and stale board checks cannot certify work', async t => {
  let finish; const h = await setup(t, { board: { acceptanceWorkflowId: 'fixture-workflow' }, runAcceptance: () => new Promise(resolve => { finish = resolve; }) });
  const one = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture one', requestId: crypto.randomUUID() }); await settle(h.service, one.runId); await delay(2);
  const two = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture two', requestId: crypto.randomUUID() }); await settle(h.service, two.runId);
  const check = h.service.handle('runAcceptance', { boardId: 'board' }); await delay(20); finish({ status: 'SUCCESS', fixture: true }); await check;
  const s = await h.service.handle('snapshot', { boardId: 'board' }); assert.equal(s.runs.find(r => r.id === one.runId).acceptance, 'UNREVIEWED'); assert.equal(s.runs.find(r => r.id === two.runId).acceptance, 'VERIFIED');
  const stale = h.service.handle('runAcceptance', { boardId: 'board' }); await delay(20); const br = (await h.service.handle('getBoard', { boardId: 'board' })).record;
  await h.service.handle('saveBoard', { board: { ...br.value, name: 'Renamed fixture during checks' }, expectedRevision: br.revision }); finish({ status: 'SUCCESS', fixture: true }); await assert.rejects(stale, /Board changed during acceptance/);
});

test('every service action including acceptance rejects a stale explicit workspace binding before effects', async t => {
  let checks = 0; const h = await setup(t, { board: { acceptanceWorkflowId: 'fixture-workflow' }, runAcceptance: async () => { checks++; return { status: 'SUCCESS' }; } });
  const other = path.join(h.temp, 'stale-project'); fs.mkdirSync(other);
  for (const action of ['capabilities', 'listBoards', 'getBoard', 'saveBoard', 'deleteBoard', 'snapshot', 'send', 'runGoal', 'pause', 'resume', 'cancel', 'newSession', 'exportBoard', 'validateBoard', 'runAcceptance', 'listWorkflows']) await assert.rejects(h.service.handle(action, { workspaceRoot: other, boardId: 'board', board: board(), expectedRevision: null }), /Workspace changed/, action);
  assert.equal(checks, 0); assert.equal(h.calls.length, 0);
});

test('same-profile exact archived queue stays inert after cancel and import during an initialized runtime', async t => {
  const h = await setup(t); await h.service.handle('pause', { boardId: 'board' });
  const sent = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture archive exact replay', requestId: crypto.randomUUID() });
  const archivedRun = await h.workspace.handle('read', { collection: 'agent-runs', id: sent.runId, workspaceRoot: h.root });
  const archivedMessage = await h.workspace.handle('read', { collection: 'agent-messages', id: sent.message.id, workspaceRoot: h.root });
  await h.service.handle('cancel', { boardId: 'board' });
  const records = [];
  for (const r of [archivedRun, archivedMessage]) { const current = await h.workspace.handle('read', { collection: r.collection, id: r.id, workspaceRoot: h.root }); records.push({ collection: r.collection, id: r.id, expectedRevision: current.revision, value: r.value }); }
  await h.workspace.handle('transact', { workspaceRoot: h.root, records }); await h.service.handle('resume', { boardId: 'board' }); const s = await settle(h.service, sent.runId);
  assert.equal(h.calls.length, 0); assert.equal(s.runs.find(r => r.id === sent.runId).status, 'interrupted'); assert.ok(s.events.some(e => e.kind === 'delivery-unadmitted'));
});

test('modified canonical active message is preserved and completion is quarantined without routing', async t => {
  let complete; const h = await setup(t, { nativeTransport: { probe: async () => ({}), execute: () => new Promise(resolve => { complete = resolve; }) } });
  const sent = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture original active', requestId: crypto.randomUUID() }); await delay(20);
  const current = await h.workspace.handle('read', { collection: 'agent-messages', id: sent.message.id, workspaceRoot: h.root });
  await h.workspace.handle('transact', { workspaceRoot: h.root, records: [{ collection: current.collection, id: current.id, expectedRevision: current.revision, value: { ...current.value, text: 'Foreign canonical replacement fixture' } }] });
  complete({ status: 'completed', nativeSessionId: SID, text: 'Must not attach to replacement' }); await delay(40);
  const s = await h.service.handle('snapshot', { boardId: 'board' }); assert.equal(s.messages.find(m => m.id === sent.message.id).text, 'Foreign canonical replacement fixture'); assert.equal(s.messages.filter(m => m.role === 'assistant').length, 0); assert.ok(h.events.some(e => e.type === 'runtime-error' && /replaced or modified/.test(e.error)));
  await assert.rejects(h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture next', requestId: crypto.randomUUID() }), /could not persist/);
});

test('real native stop retains full cancelled partial output, protocol and stderr without peer routing', async t => {
  const f = fixtureTransport(t, 'partialhang'); const h = await setup(t, { nativeTransport: f.transport });
  const sent = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture stop evidence', requestId: crypto.randomUUID() });
  let started;
  for (let n = 0; n < 200; n++) { started = await h.service.handle('snapshot', { boardId: 'board', limit: 500 }); if (started.sessions[0].nativeSessionId) break; await delay(5); }
  assert.equal(started.sessions[0].nativeSessionId, SID);
  await h.service.handle('cancel', { boardId: 'board', runId: sent.runId }); await h.service.setWorkspace(h.root);
  const s = await h.service.handle('snapshot', { boardId: 'board', limit: 500 }), assistant = s.messages.find(m => m.role === 'assistant');
  assert.equal(assistant.state, 'cancelled'); assert.equal(assistant.text, 'Fixture partial exact Å😀\n' + 'tail'.repeat(6000)); assert.equal(s.messages.filter(m => m.role === 'peer').length, 0);
  const evidence = s.runs[0].turnEvidence[0]; assert.equal(evidence.status, 'cancelled'); assert.ok(evidence.protocol.some(e => e.item?.text === assistant.text)); assert.equal(evidence.stderr, 'Fixture diagnostic before stop'); assert.equal(s.runs[0].acceptance, 'UNREVIEWED');
});

test('API text without a completion receipt remains partial and never forwards a linked peer', async t => {
  const n = { ...board().nodes[0], provider: 'api', apiConfig: { provider: 'custom', customEndpoint: 'http://127.0.0.1:12345/fixture' } }; let calls = 0;
  const h = await setup(t, { board: { mode: 'linked', nodes: [n, { ...n, id: 'b' }], edges: [{ id: 'ab', source: 'a', target: 'b', enabled: true }] }, requestAI: async () => { calls++; return { success: true, generatedText: 'Fixture unknown completion Å😀', completionStatus: 'UNKNOWN', finishReason: null }; } });
  const sent = await h.service.handle('runGoal', { boardId: 'board', requestId: crypto.randomUUID() }), s = await settle(h.service, sent.runId);
  assert.equal(calls, 1); assert.equal(s.runs[0].status, 'partial'); assert.equal(s.messages.find(m => m.role === 'assistant').text, 'Fixture unknown completion Å😀'); assert.equal(s.messages.filter(m => m.role === 'peer').length, 0); assert.match(s.runs[0].error, /without an explicit completion receipt/); assert.equal(s.runs[0].acceptance, 'UNREVIEWED');
});

test('native timeout with observed identity persists its reason and cannot auto-continue already queued input', async t => {
  const f = fixtureTransport(t, 'partialhang', { timeoutMs: 250 }); let launches = 0;
  const h = await setup(t, { nativeTransport: { probe: f.transport.probe, execute: args => { launches++; return f.transport.execute(args); } } });
  const one = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture timeout', requestId: crypto.randomUUID() });
  const two = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'fixture already queued', requestId: crypto.randomUUID() });
  await settle(h.service, one.runId); const s = await settle(h.service, two.runId);
  assert.equal(launches, 1); assert.equal(s.runs.find(r => r.id === one.runId).status, 'partial'); assert.equal(s.runs.find(r => r.id === two.runId).status, 'blocked'); assert.match(s.sessions[0].lastError, /time limit/); assert.match(s.messages.find(m => m.id === two.message.id).error, /Previous turn needs review/);
});

for (const provider of ['codex', 'claude', 'gemini']) {
  test(`shared goal context reaches fresh ${provider} peer after terse output, with exact recorded stdin`, async t => {
    const f = fixtureTransport(t, 'terse'), n = { ...board().nodes[0], provider };
    const goal = 'Build the fixture report Å😀\nKeep the original purpose.', criteria = 'Fixture report contains exact totals.\nKeep the final Unicode tail: äö.';
    const h = await setup(t, { realStore: true, nativeTransport: f.transport, board: { goal, acceptanceCriteria: criteria, mode: 'linked', maxTurns: 2, nodes: [n, { ...n, id: 'b', name: 'Fixture reviewer' }], edges: [{ id: 'ab', source: 'a', target: 'b', enabled: true }] } });
    const sent = await h.service.handle('runGoal', { boardId: 'board', agentIds: ['a'], requestId: crypto.randomUUID() }), s = await settle(h.service, sent.runId);
    const receipts = f.receipts.map(file => JSON.parse(fs.readFileSync(file, 'utf8'))), starter = s.messages.find(m => m.role === 'user'), peer = s.messages.find(m => m.role === 'peer');
    assert.equal(receipts.length, 2); assert.equal(s.runs[0].turns, 2); assert.equal(s.runs[0].status, 'completed'); assert.deepEqual(s.runs[0].taskContext, { goal, acceptanceCriteria: criteria });
    assert.equal(starter.text, goal); assert.equal(peer.text, 'Done.'); assert.equal(peer.text.includes(goal), false); assert.deepEqual(peer.taskContext, s.runs[0].taskContext);
    assert.equal(receipts[0].input, taskInput(goal, criteria)); assert.equal(receipts[0].input.split(goal).length - 1, 1, 'starter goal appears once');
    assert.equal(receipts[1].input, `${taskInput(goal, criteria)}\n\n[Peer message from a to b]\nDone.`); assert.equal(receipts[0].input, starter.transportInput); assert.equal(receipts[1].input, peer.transportInput);
    assert.equal(receipts[1].args.some(arg => /--resume|resume/.test(arg)), false, 'downstream uses a fresh native session');
  });
}

test('paused goal snapshot survives board wording edits and sends original context to later linked recipients', async t => {
  const n = board().nodes[0], calls = []; let completeFirst, acceptanceCriteria;
  const h = await setup(t, { realStore: true, board: { mode: 'linked', acceptanceWorkflowId: 'fixture-checks', nodes: [n, { ...n, id: 'b' }], edges: [{ id: 'ab', source: 'a', target: 'b', enabled: true }] }, nativeTransport: { probe: async () => ({}), execute: args => { calls.push(args); return calls.length === 1 ? new Promise(resolve => { completeFirst = resolve; }) : Promise.resolve({ status: 'completed', text: 'Reviewed.', nativeSessionId: SID }); } }, runAcceptance: async args => { acceptanceCriteria = args.acceptanceCriteria; return { status: 'SUCCESS', fixture: true }; } });
  await h.service.handle('pause', { boardId: 'board' }); const requestId = crypto.randomUUID();
  const sent = await h.service.handle('runGoal', { boardId: 'board', requestId });
  assert.equal((await h.service.handle('runGoal', { boardId: 'board', requestId })).runId, sent.runId);
  const queued = await h.service.handle('snapshot', { boardId: 'board' }); assert.equal(calls.length, 0); assert.equal(Object.hasOwn(queued.messages[0], 'transportInput'), false); assert.deepEqual(queued.messages[0].taskContext, { goal: board().goal, acceptanceCriteria: board().acceptanceCriteria });
  let br = (await h.service.handle('getBoard', { boardId: 'board' })).record;
  await h.service.handle('saveBoard', { board: { ...br.value, goal: 'Future fixture goal', acceptanceCriteria: 'Future fixture criteria' }, expectedRevision: br.revision });
  await assert.rejects(h.service.handle('runGoal', { boardId: 'board', requestId }), /already used/);
  await h.service.handle('resume', { boardId: 'board' }); await delay(20); assert.equal(calls.length, 1); assert.equal(calls[0].text, taskInput());
  br = (await h.service.handle('getBoard', { boardId: 'board' })).record;
  await h.service.handle('saveBoard', { board: { ...br.value, goal: 'Another future fixture goal', acceptanceCriteria: 'Another future fixture criterion' }, expectedRevision: br.revision });
  completeFirst({ status: 'completed', text: 'Done.', nativeSessionId: SID }); const s = await settle(h.service, sent.runId);
  assert.equal(calls.length, 2); assert.equal(calls[1].text, `${taskInput()}\n\n[Peer message from a to b]\nDone.`); assert.equal(s.board.value.goal, 'Another future fixture goal'); assert.deepEqual(s.runs[0].taskContext, { goal: board().goal, acceptanceCriteria: board().acceptanceCriteria });
  await h.service.handle('runAcceptance', { boardId: 'board' }); assert.equal(acceptanceCriteria, board().acceptanceCriteria, 'acceptance reports the same original run criteria');
});

test('API continuation retains actual contextual peer input while a later manual send stays exact', async t => {
  const n = { ...board().nodes[0], provider: 'api', apiConfig: { provider: 'custom', customEndpoint: 'http://127.0.0.1:12345/fixture' } }, calls = [];
  const h = await setup(t, { realStore: true, board: { mode: 'linked', nodes: [n, { ...n, id: 'b' }], edges: [{ id: 'ab', source: 'a', target: 'b', enabled: true }] }, requestAI: async args => { calls.push(args); return { success: true, generatedText: ['Done.', 'Reviewed.', 'Acknowledged.'][calls.length - 1], finishReason: 'stop', completionStatus: 'COMPLETE' }; } });
  const goalRun = await h.service.handle('runGoal', { boardId: 'board', agentIds: ['a'], requestId: crypto.randomUUID() }); const goalSnapshot = await settle(h.service, goalRun.runId);
  const peer = goalSnapshot.messages.find(m => m.role === 'peer'), exactPeerInput = `${taskInput()}\n\n[Peer message from a to b]\nDone.`;
  assert.equal(calls[0].prompt, taskInput()); assert.equal(calls[0].prompt, goalSnapshot.messages.find(m => m.role === 'user').transportInput); assert.deepEqual(calls[0].messages, [{ role: 'user', content: taskInput() }]);
  assert.equal(calls.length, 2); assert.equal(calls[1].prompt, exactPeerInput); assert.equal(peer.transportInput, exactPeerInput); assert.equal(peer.text, 'Done.');
  const br = (await h.service.handle('getBoard', { boardId: 'board' })).record;
  await h.service.handle('saveBoard', { board: { ...br.value, goal: 'New unrelated fixture purpose', acceptanceCriteria: 'New unrelated criterion' }, expectedRevision: br.revision });
  const manualText = '  Exact manual follow-up Å😀\nNo new task context.  ';
  const manual = await h.service.handle('send', { boardId: 'board', agentId: 'b', text: manualText, requestId: crypto.randomUUID() }); const s = await settle(h.service, manual.runId);
  assert.equal(calls.length, 3); assert.equal(calls[2].prompt, manualText); assert.deepEqual(calls[2].messages, [{ role: 'user', content: exactPeerInput }, { role: 'assistant', content: 'Reviewed.' }, { role: 'user', content: manualText }]);
  const sentManual = s.messages.find(m => m.id === manual.message.id); assert.equal(sentManual.transportInput, manualText); assert.equal(Object.hasOwn(sentManual, 'taskContext'), false); assert.equal(Object.hasOwn(s.runs.find(r => r.id === manual.runId), 'taskContext'), false); assert.equal(calls[2].systemPrompt, '');
});

test('legacy API history reconstructs only original raw/header input and skips new undispatched input', async t => {
  const n = { ...board().nodes[0], provider: 'api', apiConfig: { provider: 'custom', customEndpoint: 'http://127.0.0.1:12345/fixture' } }, calls = [];
  const h = await setup(t, { realStore: true, board: { nodes: [n] }, requestAI: async args => { calls.push(args); return { success: true, generatedText: 'Fixture reply', finishReason: 'stop' }; } });
  const cursor = await h.workspace.handle('read', { collection: 'agent-events', id: 'board:cursor' });
  const old = (id, role, body, sequence, extra = {}) => ({ collection: 'agent-messages', id, expectedRevision: null, value: { id, boardId: 'board', agentId: 'a', from: role === 'peer' ? 'old-peer' : role === 'user' ? 'user' : 'a', to: 'a', role, text: body, createdAt: '2020-01-01T00:00:00.000Z', state: 'completed', runId: 'old-fixture', generation: 1, sequence, ...extra } });
  await h.workspace.handle('transact', { records: [old('old-user', 'user', 'Legacy fixture raw goal', 2), old('old-peer', 'peer', 'Legacy fixture full peer Å😀', 3), old('old-answer', 'assistant', 'Legacy fixture answer', 4), old('never-dispatched', 'user', 'Do not replay this undispatched fixture', 5, { state: 'error', taskContext: { goal: 'Do not invent this context', acceptanceCriteria: 'Never sent' }, runSnapshotFingerprint: 'fixture-new-row' }), { collection: cursor.collection, id: cursor.id, expectedRevision: cursor.revision, value: { ...cursor.value, sequence: 5 } }] });
  const sent = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: 'Current fixture manual message', requestId: crypto.randomUUID() }); await settle(h.service, sent.runId);
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].messages, [{ role: 'user', content: 'Legacy fixture raw goal' }, { role: 'user', content: '[Peer message from old-peer to a]\nLegacy fixture full peer Å😀' }, { role: 'assistant', content: 'Legacy fixture answer' }, { role: 'user', content: 'Current fixture manual message' }]); assert.equal(JSON.stringify(calls[0].messages).includes(board().acceptanceCriteria), false);
});

test('explicit Gemini user additions appear once in recorded actual stdin while raw manual body stays exact', async t => {
  const f = fixtureTransport(t, 'terse'), instructions = 'Fixture user-authored additional instructions Å😀';
  const h = await setup(t, { nativeTransport: f.transport, board: { nodes: [{ ...board().nodes[0], provider: 'gemini', instructions }] } });
  const raw = '  Exact fixture manual text\nÅ😀  ';
  const sent = await h.service.handle('send', { boardId: 'board', agentId: 'a', text: raw, requestId: crypto.randomUUID() }); const s = await settle(h.service, sent.runId), m = s.messages.find(m => m.id === sent.message.id), receipt = JSON.parse(fs.readFileSync(f.receipts[0], 'utf8'));
  assert.equal(m.text, raw); assert.equal(Object.hasOwn(m, 'taskContext'), false); assert.equal(m.transportInput, `${instructions}\n\n${raw}`); assert.equal(receipt.input, m.transportInput); assert.equal(receipt.input.split(instructions).length - 1, 1); assert.equal(receipt.input.includes('[Task context]'), false);
});

test('queued message/run task context and transport tampering never bypass admission', async t => {
  for (const scenario of ['message-goal', 'message-criteria', 'run-goal', 'both-contexts', 'planned-transport']) {
    const h = await setup(t); await h.service.handle('pause', { boardId: 'board' }); const sent = await h.service.handle('runGoal', { boardId: 'board', requestId: crypto.randomUUID() });
    const snap = await h.service.handle('snapshot', { boardId: 'board' }), m = snap.messages.find(m => m.role === 'user'), records = [];
    if (scenario.startsWith('message') || scenario === 'both-contexts' || scenario === 'planned-transport') {
      const r = await h.workspace.handle('read', { workspaceRoot: h.root, collection: 'agent-messages', id: m.id });
      const value = scenario === 'planned-transport' ? { ...r.value, transportInput: 'Injected fixture transport' } : { ...r.value, taskContext: { ...r.value.taskContext, [scenario === 'message-criteria' ? 'acceptanceCriteria' : 'goal']: 'Tampered fixture context' } };
      records.push({ collection: r.collection, id: r.id, expectedRevision: r.revision, value });
    }
    if (scenario === 'run-goal' || scenario === 'both-contexts') { const r = await h.workspace.handle('read', { workspaceRoot: h.root, collection: 'agent-runs', id: sent.runId }); records.push({ collection: r.collection, id: r.id, expectedRevision: r.revision, value: { ...r.value, taskContext: { ...r.value.taskContext, goal: 'Tampered fixture context' } } }); }
    await h.workspace.handle('transact', { workspaceRoot: h.root, records }); await h.service.handle('resume', { boardId: 'board' }); const settled = await settle(h.service, sent.runId);
    assert.equal(h.calls.length, 0, scenario); assert.equal(settled.runs.find(r => r.id === sent.runId).status, 'interrupted', scenario);
  }
});

test('active message/run context or recorded-input tampering quarantines late output', async t => {
  for (const scenario of ['message-context', 'run-context', 'transport-input']) {
    let complete; const h = await setup(t, { nativeTransport: { probe: async () => ({}), execute: () => new Promise(resolve => { complete = resolve; }) } });
    const sent = await h.service.handle('runGoal', { boardId: 'board', requestId: crypto.randomUUID() }); await delay(20);
    const s = await h.service.handle('snapshot', { boardId: 'board' }), m = s.messages.find(m => m.role === 'user');
    const r = await h.workspace.handle('read', { workspaceRoot: h.root, collection: scenario === 'run-context' ? 'agent-runs' : 'agent-messages', id: scenario === 'run-context' ? sent.runId : m.id });
    const value = scenario === 'transport-input' ? { ...r.value, transportInput: 'Injected fixture input' } : { ...r.value, taskContext: { ...r.value.taskContext, acceptanceCriteria: 'Tampered active fixture criteria' } };
    await h.workspace.handle('transact', { workspaceRoot: h.root, records: [{ collection: r.collection, id: r.id, expectedRevision: r.revision, value }] });
    complete({ status: 'completed', text: 'Do not attach to tampered fixture', nativeSessionId: SID }); await delay(30);
    const result = await h.service.handle('snapshot', { boardId: 'board' }); assert.equal(result.messages.filter(m => m.role === 'assistant').length, 0, scenario); assert.ok(h.events.some(e => e.type === 'runtime-error' && /replaced or modified/.test(e.error)), scenario);
  }
});

test('task context and exact transport input are complete and redacted in board exports', async t => {
  const marker = 'FIXTURE_PRIVATE_MARKER', goal = `Fixture goal ${marker}\n` + 'end'.repeat(3000), criteria = `Fixture criteria ${marker} Å😀`;
  const h = await setup(t, { board: { goal, acceptanceCriteria: criteria }, redact: value => typeof value === 'string' ? value.split(marker).join('[REDACTED FIXTURE]') : value });
  const sent = await h.service.handle('runGoal', { boardId: 'board', requestId: crypto.randomUUID() }); await settle(h.service, sent.runId);
  const exported = await h.service.handle('exportBoard', { boardId: 'board' }), m = exported.messages.find(m => m.role === 'user');
  assert.equal(JSON.stringify(exported).includes(marker), false); assert.ok(m.text.endsWith('end'.repeat(3000))); assert.equal(m.transportInput, taskInput(m.taskContext.goal, m.taskContext.acceptanceCriteria)); assert.deepEqual(exported.runs[0].taskContext, m.taskContext);
});

test('oversized composed context fails before provider dispatch without truncating stored context', async t => {
  const goal = 'G'.repeat(4 * 1024 * 1024), acceptanceCriteria = 'C'.repeat(4 * 1024 * 1024);
  const h = await setup(t, { board: { goal, acceptanceCriteria } });
  const sent = await h.service.handle('runGoal', { boardId: 'board', requestId: crypto.randomUUID() }), s = await settle(h.service, sent.runId), input = s.messages.find(m => m.role === 'user');
  assert.equal(h.calls.length, 0); assert.equal(s.runs[0].turns, 0); assert.equal(s.runs[0].status, 'error'); assert.equal(Object.hasOwn(input, 'transportInput'), false); assert.equal(input.text, goal); assert.deepEqual(input.taskContext, { goal, acceptanceCriteria }); assert.match(input.error, /Composed transport input.*no larger/);
});

test('appearance and chat windows round trip without changing native sessions or queued admissions', async t => {
  const {service,calls}=await setup(t);
  let first=await service.handle('send',{boardId:'board',agentId:'a',text:'Fixture first session',requestId:crypto.randomUUID()});
  await settle(service,first.runId);
  await service.handle('pause',{boardId:'board'});
  const queued=await service.handle('send',{boardId:'board',agentId:'a',text:'Fixture queued while appearance changes',requestId:crypto.randomUUID()});
  const prior=(await service.handle('getBoard',{boardId:'board'})).record;
  const value=structuredClone(prior.value);
  value.nodes[0].appearance={color:'#eb64af',icon:'shield',avatar:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',zoom:1.4,hue:42};
  value.panels=[{agentId:'a',x:20,y:40,width:390,height:410,minimized:true}];
  const saved=await service.handle('saveBoard',{board:value,expectedRevision:prior.revision});
  assert.deepEqual(saved.record.value.nodes[0].appearance,value.nodes[0].appearance);
  assert.deepEqual(saved.record.value.panels,value.panels);
  await service.handle('resume',{boardId:'board'});
  const complete=await settle(service,queued.runId);
  assert.equal(complete.runs.find(r=>r.id===queued.runId).status,'completed');
  assert.equal(calls.length,2);assert.equal(calls[1].session.nativeSessionId,SID);
  const exported=await service.handle('exportBoard',{boardId:'board'});
  assert.deepEqual(exported.board.nodes[0].appearance,value.nodes[0].appearance);
  assert.deepEqual(exported.board.panels,value.panels);
});

test('appearance validation rejects executable, external, forged and oversized pictures and invalid windows', () => {
  const valid=board();
  const mutate=change=>{const value=structuredClone(valid);change(value);return ()=>normalizeBoard(value);};
  for(const avatar of ['https://example.invalid/picture.png','javascript:alert(1)','data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=','data:image/png;base64,PHN2Zz48L3N2Zz4=','data:image/png;base64,'+'A'.repeat(350001)]) assert.throws(mutate(b=>b.nodes[0].appearance={avatar}),/picture/i);
  assert.throws(mutate(b=>b.nodes[0].appearance={color:'url(https://example.invalid)'}),/color/i);
  assert.throws(mutate(b=>b.nodes[0].appearance={icon:'<script>'}),/icon/i);
  assert.throws(mutate(b=>b.nodes[0].appearance={zoom:Infinity}),/zoom/i);
  assert.throws(mutate(b=>b.panels=[{agentId:'missing',x:0,y:0,width:300,height:300,minimized:false}]),/existing agent/i);
  assert.throws(mutate(b=>b.panels=[{agentId:'a',x:0,y:0,width:0,height:300,minimized:false}]),/size/i);
  assert.equal(Object.hasOwn(normalizeBoard(valid).nodes[0],'appearance'),false,'Legacy boards retain their original schema representation');
});
