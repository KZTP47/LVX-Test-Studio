'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const modulePromise=import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'../agent-board.js'))).toString('base64'));
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const board=id=>({id,revision:1,value:{schemaVersion:1,id,name:id,nodes:[],edges:[],panels:[]}});
const snapshot=id=>({board:board(id),messages:[],events:[],sessions:[],runs:[],cursor:0,hasMore:false});
test('Board controls initialize without waiting for provider or workflow discovery; late catalog results preserve edits',async()=>{
 const {createBoardController}=await modulePromise,probe=defer(),workflows=defer();let started=false;
 const c=createBoardController({workspaceRoot:'fixture',invoke:async(action,payload)=>action==='listBoards'?{records:[board('new-board-3')]}:action==='capabilities'?(started=true,probe.promise):action==='listWorkflows'?workflows.promise:snapshot(payload.boardId)});
 const ready=c.task(()=>c.initialize({background:true}));
 const result=await Promise.race([ready.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),80))]);
 probe.resolve({providers:[]});workflows.resolve({records:[]});await ready;
 assert.equal(result,true,'Optional discovery must not hold the control busy lock');assert.equal(started,true);assert.equal(c.state.busy,0);
 await c.load('new-board-3');c.edit(b=>b.name='Kept draft');await Promise.resolve();assert.equal(c.state.draft.name,'Kept draft');assert.equal(c.state.dirty,true);c.destroy();
});
test('Provider refreshes coalesce and discovery errors leave unrelated board actions available',async()=>{
 const {createBoardController}=await modulePromise,pending=defer();let calls=0;
 const c=createBoardController({workspaceRoot:'fixture',invoke:async action=>{if(action==='capabilities'){calls++;return pending.promise;}return{records:[]};}});
 const a=c.capabilities(),b=c.capabilities();pending.reject(Error('Fixture unavailable'));await Promise.allSettled([a,b]);assert.equal(calls,1);assert.equal(c.state.busy,0);assert.equal(c.state.capabilitiesLoading,false);assert.match(c.state.capabilitiesError,/Fixture unavailable/);c.newBoard();assert.ok(c.state.draft);c.destroy();
});
test('Late snapshots cannot replace a newer board selection',async()=>{
 const {createBoardController}=await modulePromise,slow=defer();const c=createBoardController({workspaceRoot:'fixture',invoke:async(action,payload)=>payload.boardId==='slow'?slow.promise:snapshot(payload.boardId)});
 const old=c.load('slow');await c.load('new-board-3');slow.resolve(snapshot('slow'));await old;assert.equal(c.state.record.id,'new-board-3');c.destroy();
});
test('Workspace list filters board records before crossing the service boundary, retaining unfiltered compatibility',()=>{
 const {Store}=require('../services/workspace/store.cjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-scoped-history-')),s=new Store(path.join(dir,'runtime.sqlite'));
 try{s.transact([{collection:'agent-messages',id:'a',expectedRevision:null,value:{boardId:'one',text:'first'}},{collection:'agent-messages',id:'b',expectedRevision:null,value:{boardId:'two',text:'unrelated'}}]);assert.equal(s.list('agent-messages').records.length,2);assert.deepEqual(s.list('agent-messages',{boardId:'one'}).records.map(r=>r.id),['a']);assert.throws(()=>s.list('workflows',{boardId:'one'}),/board|agent/i);assert.throws(()=>s.list('agent-messages',{boardId:'bad/id'}));}finally{s.close();}
});
test('Native discovery coalesces, caches successful results and explicit refresh checks again without holding board operations',async()=>{
 const {createService}=require('../services/agents/index.cjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-discovery-cache-'));let probes=0;const ready=defer();
 const svc=createService({workspaceRoot:dir,workspace:{handle:async action=>action==='list'?{records:[]}:null},nativeTransport:{probe:async id=>{probes++;await ready.promise;return{id,installed:true};}}});
 try{const a=svc.handle('capabilities',{}),b=svc.handle('capabilities',{});await svc.handle('listBoards',{});ready.resolve();await Promise.all([a,b]);assert.equal(probes,3);await svc.handle('capabilities',{});assert.equal(probes,3);await svc.handle('capabilities',{refresh:true});assert.equal(probes,6);}finally{await svc.close();}
});
