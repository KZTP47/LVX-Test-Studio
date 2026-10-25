'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createService}=require('../services/agents/index.cjs');
const {createNativeTransport}=require('../services/agents/native.cjs');
const {parseGeneratedTests,validateGeneratedTests}=require('../services/agents/generated-tests.cjs');
const {createService:createWorkspace}=require('../services/workspace/index.cjs');
const SID='11111111-1111-4111-8111-111111111111';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const node=id=>({id,name:'Fixture '+id,provider:'codex',position:{x:0,y:0},permission:'native'});
const board={schemaVersion:1,id:'board',name:'Fixture board',goal:'Inspect',acceptanceCriteria:'Prove it',mode:'linked',maxTurns:2,concurrency:1,nodes:[node('a'),node('b')],edges:[{id:'ab',source:'a',target:'b',enabled:true}]};
async function setup(t,execute){const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-nine-agents-'));const workspace=createWorkspace({workspaceRoot:temp,dataDir:path.join(temp,'private')});const events=[];const service=createService({workspaceRoot:temp,workspace,nativeTransport:{probe:async()=>({installed:true}),execute},emit:e=>events.push(e)});t.after(async()=>{await service.close();await workspace.close();fs.rmSync(temp,{recursive:true,force:true});});await service.handle('saveBoard',{board,expectedRevision:null});return {service,workspace,events,temp};}
async function until(fn){for(let i=0;i<200;i++){const r=await fn();if(r)return r;await wait(10);}throw Error('Fixture did not settle');}
const bundle=(id='generated')=>({format:'lvx-tests',records:[{collection:'suites',id,value:{name:'Imported runnable check',language:'javascript',code:'assert(2 + 2 === 4);'}}]});

test('native protocol exposes visible text before process exit, excludes hidden reasoning and tool payloads',async t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-nine-native-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const script=path.join(temp,'provider.cjs');fs.writeFileSync(script,`process.stdin.resume();const emit=e=>console.log(JSON.stringify(e));emit({type:'thread.started',thread_id:'${SID}'});emit({type:'item.completed',item:{type:'reasoning',text:'PRIVATE_REASONING_CONTROL'}});emit({type:'item.started',item:{type:'command_execution',command:'PRIVATE_COMMAND_CONTROL'}});emit({type:'item.completed',item:{type:'agent_message',text:'Visible progress Åäö'}});setTimeout(()=>{emit({type:'turn.completed'});},500);`);
  let settled=false;const updates=[];const native=createNativeTransport({resolve:()=>({command:process.execPath,prefix:[script]})});
  const running=native.execute({node:node('a'),session:{},text:'hello',workspaceRoot:temp,onProgress:p=>updates.push({...p,beforeExit:!settled})}).then(r=>(settled=true,r));
  await until(()=>updates.find(p=>p.text==='Visible progress Åäö'));assert.equal(settled,false);assert.ok(updates.some(p=>p.beforeExit&&p.text==='Visible progress Åäö'));assert.ok(!JSON.stringify(updates).includes('PRIVATE_'));
  const result=await running;assert.equal(result.status,'completed');assert.equal(result.text,'Visible progress Åäö');
});

test('running progress survives snapshots and cannot bleed into a completed attempt',async t=>{
  let release,late;const {service,events}=await setup(t,async args=>{late=args.onProgress;args.onProgress({status:'Writing reply…',text:'Provider visible partial'});await new Promise(r=>release=r);return {status:'completed',text:'Final',nativeSessionId:SID};});
  const requestId=crypto.randomUUID();await service.handle('send',{boardId:'board',agentId:'a',text:'Inspect',requestId});
  const snapshot=await until(async()=>{const s=await service.handle('snapshot',{boardId:'board'});return s.activity.find(a=>a.text)?s:null;});assert.equal(snapshot.activity[0].text,'Provider visible partial');assert.ok(snapshot.activity[0].startedAt);assert.ok(events.some(e=>e.type==='activity'&&e.agentId==='a'));
  release();await until(async()=>{const s=await service.handle('snapshot',{boardId:'board'});return s.runs[0]?.status==='completed';});late({text:'LATE CONTROL'});assert.equal((await service.handle('snapshot',{boardId:'board'})).activity.length,0);
});

test('explicit collaborative chat forwards exact completed replies and retains directed evidence; plain chat does not',async t=>{
  const calls=[];const {service}=await setup(t,async args=>{calls.push(args);return {status:'completed',text:'Reply from '+args.node.id,nativeSessionId:SID};});
  const id=crypto.randomUUID();await service.handle('send',{boardId:'board',agentId:'a',text:'Say hello together',collaborate:true,requestId:id});
  const snapshot=await until(async()=>{const s=await service.handle('snapshot',{boardId:'board',limit:500});return s.runs.find(r=>r.id===id)?.status==='completed'?s:null;});
  const peer=snapshot.messages.find(m=>m.role==='peer');assert.equal(peer.from,'a');assert.equal(peer.to,'b');assert.equal(peer.text,'Reply from a');assert.equal(peer.state,'completed');assert.equal(calls.length,2);assert.equal(calls[0].text,'Say hello together');assert.ok(calls[1].text.includes('[Peer message from a to b]'));
  const single=crypto.randomUUID();await service.handle('send',{boardId:'board',agentId:'a',text:'Only you',requestId:single});await until(async()=>{const s=await service.handle('snapshot',{boardId:'board'});return s.runs.find(r=>r.id===single)?.status==='completed';});assert.equal(calls.length,3);
});

test('collaboration rejects missing outgoing routes rather than inventing a conversation',async t=>{const {service}=await setup(t,async()=>({status:'completed',text:'Unused'}));await assert.rejects(service.handle('send',{boardId:'board',agentId:'b',text:'Hello',collaborate:true,requestId:crypto.randomUUID()}),/recipient/);});

test('generated test preview parses actual data only; rejects malformed source, prose and credentials',()=>{
  assert.equal(parseGeneratedTests('Here is the export:\n```json\n'+JSON.stringify(bundle())+'\n```').counts.suites,1);
  assert.throws(()=>parseGeneratedTests('I saved 69 tests somewhere'),/No LVX tests/);
  const malformed=bundle();malformed.records[0].value.code='const {';assert.throws(()=>parseGeneratedTests(JSON.stringify(malformed)),/not valid/);
  const credential=bundle();credential.records[0].value.apiKey='PRIVATE CONTROL';assert.throws(()=>parseGeneratedTests(JSON.stringify(credential)),/credential/);
  const unknown=bundle();unknown.records[0].value.language='unsupported';assert.throws(()=>parseGeneratedTests(JSON.stringify(unknown)),/Unsupported/);
});

test('reviewed imports create real suites atomically, require consent, preserve existing records and never run',async t=>{
  let calls=0;const {service,workspace}=await setup(t,async()=>{calls++;return {status:'completed',text:'Unused'};});
  const preview=await service.handle('previewGeneratedTests',{boardId:'board',text:JSON.stringify(bundle())});assert.equal((await workspace.handle('list',{collection:'suites'})).records.length,0);
  await assert.rejects(service.handle('importGeneratedTests',{boardId:'board',token:preview.token}),/Review/);
  const imported=await service.handle('importGeneratedTests',{boardId:'board',token:preview.token,reviewed:true});assert.equal(imported.executionStarted,false);assert.equal((await workspace.handle('read',{collection:'suites',id:'generated'})).value.code,'assert(2 + 2 === 4);');assert.equal(calls,0);
  const conflict=await service.handle('previewGeneratedTests',{boardId:'board',text:JSON.stringify(bundle())});assert.deepEqual(conflict.conflicts,['suites/generated']);await assert.rejects(service.handle('importGeneratedTests',{boardId:'board',token:conflict.token,reviewed:true}),/Nothing was overwritten/);
  const first=await service.handle('previewGeneratedTests',{boardId:'board',text:JSON.stringify(bundle('new-one'))});const duplicate=await service.handle('previewGeneratedTests',{boardId:'board',text:JSON.stringify(bundle('new-one'))});await assert.rejects(service.handle('importGeneratedTests',{boardId:'board',tokens:[first.token,duplicate.token],reviewed:true}),/duplicate/);assert.equal(await workspace.handle('read',{collection:'suites',id:'new-one'}),null);
});

test('generated checks reject unsupported engines/steps and invalid source or project modes',()=>{
  const check=overrides=>JSON.stringify({format:'lvx-tests',records:[{collection:'checks',id:'visual',value:{name:'Visual check',engine:'javascript',steps:[{type:'compare',actual:'1',expected:'1'}],...overrides}}]});
  assert.throws(()=>parseGeneratedTests(check({engine:'invented-engine'})),/Unsupported check engine/);
  assert.throws(()=>parseGeneratedTests(check({steps:[{type:'invented-step'}]})),/Unsupported visual step/);
  assert.throws(()=>parseGeneratedTests(check({customSource:true,source:''})),/executable source/);
  assert.throws(()=>parseGeneratedTests(check({customSource:true,source:'const {'})),/not valid LVX/);
  assert.throws(()=>parseGeneratedTests(check({engine:'jest',steps:[]})),/project folder/);
  assert.throws(()=>parseGeneratedTests(check({steps:[{type:'repeat',count:2,children:{}}]})),/Nested test steps/);
  assert.equal(parseGeneratedTests(check({engine:'jest',steps:[],projectPath:'./project'})).counts.checks,1);
  assert.equal(parseGeneratedTests(check({engine:'playwright',customSource:true,steps:[],source:'await page.goto("https://example.test");'})).counts.checks,1);
});

test('canonical visual compiler rejects malformed arguments and parameters before preview admission',async t=>{
  const {service,workspace}=await setup(t,async()=>({status:'completed',text:'Unused'}));
  const document=overrides=>JSON.stringify({format:'lvx-tests',records:[{collection:'checks',id:'visual',value:{name:'Visual check',engine:'javascript',steps:[{type:'compare',actual:'1',expected:'1'}],parameterRows:[],...overrides}}]});
  for(const overrides of [{steps:[{type:'compare',operator:'invented'}]},{steps:[{type:'repeat',count:'not-a-number',children:[]}]},{steps:[{type:'click',selector:'#wrong-engine'}]},{parameterRows:[{name:'1 invalid name',value:'x'}]}])await assert.rejects(service.handle('previewGeneratedTests',{boardId:'board',text:document(overrides)}),/comparison|Repeat count|Browser steps|Parameter names/);
  assert.equal((await workspace.handle('list',{collection:'checks'})).records.length,0);
  const parsed=parseGeneratedTests(document({steps:[{type:'compare',actual:'1',expected:'1'}]}));assert.equal((await validateGeneratedTests(parsed)).counts.checks,1);
});
