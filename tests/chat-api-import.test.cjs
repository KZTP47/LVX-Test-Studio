'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createService}=require('../services/agents/index.cjs');
const {discover}=require('../services/api-atlas/discovery.cjs');
const model=import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'../agent-board.js'),'utf8')).toString('base64'));
const uuid=()=>crypto.randomUUID();
const board=()=>({schemaVersion:1,id:'fixture',name:'Fixture existing council',goal:'',acceptanceCriteria:'',mode:'manual',maxTurns:2,concurrency:1,nodes:['reviewer','other'].map((id,index)=>({id,name:id,provider:'codex',permission:'native',model:'',instructions:'',position:{x:index*200,y:40},appearance:{color:'#49cde5',icon:'robot',avatar:'',zoom:1,hue:0}})),edges:[]});
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-chat-send-')),records=new Map();let revision=0,turns=0;
 const workspace={async handle(action,p){if(action==='read')return structuredClone(records.get(p.collection+'/'+p.id)||null);if(action==='list')return {records:[...records.values()].filter(r=>r.collection===p.collection).map(r=>structuredClone(r))};if(action==='transact'){for(const row of p.records)assert.equal(records.get(row.collection+'/'+row.id)?.revision??null,row.expectedRevision);revision++;for(const row of p.records)records.set(row.collection+'/'+row.id,{...row,revision});return {revision};}throw Error(action);}};
 const service=createService({workspaceRoot:root,workspace,nativeTransport:{probe:async()=>({installed:true}),execute:async()=>({status:'completed',nativeSessionId:'11111111-1111-4111-8111-111111111111',text:'Fixture answer '+(++turns),protocol:[]})}});
 t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
 await service.handle('saveBoard',{board:board(),expectedRevision:null});
 const controller=(await model).createBoardController({workspaceRoot:root,invoke:(action,payload)=>service.handle(action,payload)});await controller.load('fixture');
 return {root,service,controller,records,get turns(){return turns;}};
}
async function settled(service){for(let i=0;i<150;i++){const s=await service.handle('snapshot',{boardId:'fixture'});if(s.messages.some(m=>m.role==='assistant'))return s;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Turn did not complete');}

test('invalid unrelated avatar draft cannot block an existing agent send and is never silently saved',async t=>{
 const f=await fixture(t),bad='data:image/png;base64,SGVsbG8=';
 f.controller.edit(b=>{b.nodes[1].appearance.avatar=bad;});
 await assert.rejects(f.controller.save(),/invalid image data/);
 await f.controller.send('reviewer','The exact pending message');await settled(f.service);
 assert.equal(f.turns,1);assert.equal(f.controller.state.draft.nodes[1].appearance.avatar,bad);assert.equal(f.controller.state.dirty,true);
 assert.equal((await f.service.handle('getBoard',{boardId:'fixture'})).record.value.nodes[1].appearance.avatar,'');
});

test('runtime settings can save and dispatch independently while cosmetic drafts are preserved',async t=>{
 const f=await fixture(t),before=(await f.service.handle('getBoard',{boardId:'fixture'})).record;
 f.controller.edit(b=>{b.nodes[1].appearance.avatar='data:image/png;base64,SGVsbG8=';b.goal='New task goal';b.nodes[0].position.x=900;});
 await f.controller.send('reviewer','Send after executable update');await settled(f.service);
 const after=(await f.service.handle('getBoard',{boardId:'fixture'})).record;
 assert.equal(after.value.goal,'New task goal');assert.deepEqual(after.value.nodes.map(n=>n.appearance),before.value.nodes.map(n=>n.appearance));assert.deepEqual(after.value.nodes[0].position,before.value.nodes[0].position);
 assert.equal(f.controller.state.draft.nodes[0].position.x,900);assert.equal(f.controller.state.dirty,true);assert.equal(f.controller.state.conflict,false);
});

test('runtime-only save retains canonical legacy pictures and rejects stale revisions and invalid executable settings',async t=>{
 const f=await fixture(t),prior=(await f.service.handle('getBoard',{boardId:'fixture'})).record;
 prior.value.nodes[1].appearance.avatar='data:image/png;base64,SGVsbG8=';f.records.get('agent-boards/fixture').value=prior.value;
 const draft=structuredClone(prior.value);draft.goal='Next goal';draft.nodes[1].appearance.avatar='https://bad.test/image.svg';
 const saved=await f.service.handle('saveBoard',{board:draft,expectedRevision:prior.revision,runtimeOnly:true});
 assert.equal(saved.record.value.nodes[1].appearance.avatar,prior.value.nodes[1].appearance.avatar);
 await assert.rejects(f.service.handle('saveBoard',{board:draft,expectedRevision:prior.revision,runtimeOnly:true}),{code:'CONFLICT'});
 draft.nodes[0].permission='unsafe-invalid';await assert.rejects(f.service.handle('saveBoard',{board:draft,expectedRevision:saved.record.revision,runtimeOnly:true}),/permission/i);
});

test('configured exported service URLs match providers with an explicit default-only caveat',async()=>{
 const spec={swagger:'2.0',info:{title:'Catalogue',version:'1'},host:'catalogue',schemes:['http'],paths:{'/catalogue':{get:{responses:{200:{description:'ok'}}}}}};
 const atlas=await discover([{id:'front',fullName:'fixture/front',files:[{path:'api/endpoints.js',content:'var domain=""; module.exports={catalogueUrl:util.format("http://catalogue%s",domain),cartsUrl:util.format("http://carts%s/carts",domain)};'}]},{id:'cat',fullName:'fixture/catalogue',files:[{path:'api-spec/catalogue.json',content:JSON.stringify(spec)}]}]);
 assert.equal(atlas.connections.length,2);const edge=atlas.connections.find(e=>e.url==='http://catalogue');assert.equal(edge.target,'cat');assert.equal(edge.endpointId,null);assert.equal(edge.method,'CONFIG');assert.equal(edge.defaultOnly,true);assert.match(edge.confidence,/runtime override/);
 assert.ok(atlas.externalNodes.some(node=>node.title==='carts'));
 const unknown=await discover([{id:'front',fullName:'fixture/front',files:[{path:'config.js',content:'module.exports={url:util.format("http://provider%s",process.env.DOMAIN)};'}]}]);assert.equal(unknown.connections.length,0);
});

test('Flask literal decorators discover GET, explicit methods and public connection overrides without assuming dynamic methods',async()=>{
 const atlas=await discover([{id:'echo',fullName:'fixture/httpbin',apiBaseUrl:'https://httpbin.org',files:[{path:'httpbin/core.py',content:'@app.route("/get")\ndef get(): pass\n@app.route("/anything",\n methods=("GET", "POST"))\ndef anything(): pass\n@app.route("/unknown", methods=runtime_methods)\ndef unknown(): pass'}]}]);
 assert.equal(atlas.endpoints.length,3);assert.ok(atlas.endpoints.every(e=>e.baseUrl==='https://httpbin.org'));assert.ok(atlas.endpoints.some(e=>e.method==='POST'&&e.path==='/anything'));assert.ok(!atlas.endpoints.some(e=>e.path==='/unknown'));
});
