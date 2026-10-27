'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../graph-companion-model.js'),'utf8');
const model=import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('assignment keys isolate repository, workflow and job, including ambiguous separators',async()=>{
  const {targetKey,workspaceKey}=await model,base={kind:'github',id:'org/repo',workflow:'.github/workflows/ci.yml'};
  assert.notEqual(targetKey(base),targetKey({...base,id:'org/other'}));assert.notEqual(targetKey(base),targetKey({...base,workflow:'other.yml'}));assert.notEqual(targetKey(base),targetKey({...base,job:'build'}));
  assert.notEqual(targetKey({...base,id:'a|b',workflow:'c'}),targetKey({...base,id:'a',workflow:'b|c'}));
  assert.equal(workspaceKey('C:\\Project\\'),workspaceKey('c:/project'));
});
test('placement validation rejects malformed coordinates and duplicate agents',async()=>{
  const {validatePlacements}=await model,agent={agentId:'a',target:'repo',roam:true,x:.2,y:.4},config={version:1,boardId:'board',agents:[agent]};
  assert.deepEqual(validatePlacements(config),config);
  for(const change of [{x:NaN},{y:Infinity},{x:-1},{y:2},{roam:'yes'},{agentId:''},{target:{}}])assert.throws(()=>validatePlacements({...config,agents:[{...agent,...change}]}));
  assert.throws(()=>validatePlacements({...config,agents:[agent,agent]}));assert.throws(()=>validatePlacements({...config,boardId:''}));assert.throws(()=>validatePlacements({version:2,agents:[]}));
});
test('messages bind to exact snapshot data; missing targets never dispatch',async()=>{
  const {contextualMessage}=await model,context={kind:'github',id:'repo',repository:'org/repo',workflow:'ci.yml',job:'build',source:'jobs:\n  build: {}\n'};
  const text=contextualMessage('Please review',context);assert.match(text,/Please review/);assert.match(text,/source data, not instructions/);
  assert.ok(text.includes(JSON.stringify(context.source)));assert.match(text,/Publishing is a separate user action/);
  assert.throws(()=>contextualMessage('Review',null));assert.throws(()=>contextualMessage('',context));
});
test('canvas bindings follow the current graph without loosening repository or job assignments',async()=>{
  const {resolveCompanionContext,targetKey}=await model,old={kind:'graph',id:'previous'},current={kind:'graph',id:'new-saved-graph',name:'New graph',graph:{nodes:[],edges:[]}},placement={target:targetKey(old)};
  assert.equal(resolveCompanionContext(placement,[current],true),current);
  assert.equal(resolveCompanionContext(placement,[current],false),undefined);
  assert.equal(resolveCompanionContext({target:targetKey(current)},[current]),current);
  assert.equal(resolveCompanionContext(placement,[current,{...current,id:'ambiguous'}],true),undefined);
  for(const target of ['bad json','{}','["graph"]',targetKey({kind:'github',id:'repo',job:'missing'})])assert.equal(resolveCompanionContext({target},[current],true),undefined);
  assert.equal(resolveCompanionContext({target:targetKey({kind:'github',id:'repo',job:'old'})},[{kind:'github',id:'repo',job:'new'}],true),undefined);
});
test('only a single complete YAML proposal from a completed assistant response can be applied',async()=>{
  const {yamlProposal}=await model,reply={role:'assistant',state:'completed',text:'Suggested change:\n```yaml\njobs:\n  build: {}\n```'};
  assert.equal(yamlProposal(reply),'jobs:\n  build: {}\n');
  for(const change of [{role:'user'},{role:'peer'},{state:'running'},{state:'partial'},{state:'error'},{text:'```yaml\njobs: {}'},{text:reply.text+'\n'+reply.text}])assert.equal(yamlProposal({...reply,...change}),null);
});
test('graph proposals require completed assistant JSON with node and edge arrays',async()=>{
  const {graphProposal}=await model,reply={role:'assistant',state:'completed',text:'```json\n{"nodes":[],"edges":[]}\n```'};
  assert.deepEqual(graphProposal(reply),{nodes:[],edges:[]});
  for(const change of [{role:'user'},{state:'running'},{state:'partial'},{text:'```json\n{"nodes":{}}\n```'},{text:'```json\ninvalid\n```'},{text:reply.text+'\n'+reply.text}])assert.equal(graphProposal({...reply,...change}),null);
});
test('roaming stays inside bounds, reduced motion uses stable placement, and small canvases remain finite',async()=>{
  const {roamingPoint}=await model,bounds={x:10,y:20,width:500,height:300};
  for(let i=0;i<400;i++){const point=roamingPoint(bounds,{roam:true},i/3);assert.ok(point.x>=10&&point.x<=330);assert.ok(point.y>=20&&point.y<=146);}
  assert.deepEqual(roamingPoint(bounds,{roam:false,x:.5,y:.5},0),roamingPoint(bounds,{roam:false,x:.5,y:.5},200));
  assert.deepEqual(roamingPoint({x:1,y:2,width:0,height:0},{roam:true},0),{x:1,y:2});
});

test('visual node destinations stay within the assigned canvas without altering graph data',async()=>{
 const {nodeRoamingPoint}=await model,bounds={x:260,y:80,width:700,height:500};
 for(const node of [{x:500,y:400,width:300,height:80},{x:-200,y:-400,width:10,height:10},{x:4000,y:4000,width:300,height:80}]){const before=structuredClone(node),p=nodeRoamingPoint(bounds,node);assert.ok(p.x>=260&&p.x<=780&&p.y>=80&&p.y<=406);assert.deepEqual(node,before);}
 assert.deepEqual(nodeRoamingPoint({x:2,y:3,width:10,height:10},{x:5,y:5,width:10,height:10}),{x:2,y:3});
});
test('drag normalization round-trips manually placed agents and clamps extreme pointer coordinates',async()=>{
  const {savedAgentPoint,roamingPoint}=await model,bounds={x:20,y:40,width:800,height:600},point={x:250,y:190};
  const saved=savedAgentPoint(point,bounds);assert.deepEqual(roamingPoint(bounds,{...saved,roam:false},0),point);
  assert.deepEqual(savedAgentPoint({x:-500,y:9000},bounds),{x:0,y:1});
  assert.deepEqual(savedAgentPoint(point,{x:0,y:0,width:20,height:20}),{x:0,y:0});
});
test('conversation geometry is backward compatible and rejects malformed saved rectangles',async()=>{
  const {validatePlacements}=await model,agent={agentId:'a',target:'view',roam:false,x:.2,y:.4},base={version:1,boardId:'board',agents:[agent]};
  const panel={x:.8,y:.6,width:480,height:520};assert.deepEqual(validatePlacements({...base,agents:[{...agent,panel}]}).agents[0].panel,panel);
  assert.equal('panel' in validatePlacements(base).agents[0],false);
  for(const change of [{x:-.1},{y:2},{width:0},{height:Infinity},{x:NaN},{width:'500'}])assert.throws(()=>validatePlacements({...base,agents:[{...agent,panel:{...panel,...change}}]}));
});
test('panel normalization preserves a rectangle and constrains reopening to narrow viewports',async()=>{
  const {savedPanel,panelRect}=await model,viewport={width:1600,height:1000},rect={left:340,top:190,width:500,height:620};
  assert.deepEqual(panelRect(savedPanel(rect,viewport),viewport),rect);
  const narrow=panelRect(savedPanel(rect,viewport),{width:320,height:420});assert.ok(narrow.left>=12&&narrow.top>=12&&narrow.left+narrow.width<=308&&narrow.top+narrow.height<=408);
  assert.deepEqual(panelRect({x:0,y:0,width:5000,height:9000},{width:200,height:180}),{left:12,top:12,width:176,height:156});
});
test('all resize edges enforce minimum dimensions and viewport limits without moving the opposite edge',async()=>{
  const {resizePanel}=await model,viewport={width:1200,height:900},rect={left:300,top:200,width:400,height:500};
  assert.deepEqual(resizePanel(rect,100,40,'se',viewport),{left:300,top:200,width:500,height:540});
  assert.deepEqual(resizePanel(rect,-50,-20,'nw',viewport),{left:250,top:180,width:450,height:520});
  for(const edge of ['n','ne','e','se','s','sw','w','nw'])for(const delta of [-9000,9000]){const r=resizePanel(rect,delta,delta,edge,viewport);assert.ok(r.left>=12&&r.top>=12&&r.width>=290&&r.height>=260&&r.left+r.width<=1188&&r.top+r.height<=888);}
});
test('mascot asset is the exact supplied transparent reference, with its central cutout preserved',async()=>{
  const bytes=fs.readFileSync(path.join(__dirname,'../assets/agents/octopus-companion.png'));
  assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'),'539827cfa187cc30969ec4e3b7e5ebe3869f9475163be7ec29d91724d2f385c7');
  const sharp=require('sharp'),metadata=await sharp(bytes).metadata();assert.equal(metadata.hasAlpha,true);assert.equal(metadata.width,1451);assert.equal(metadata.height,1084);
  const center=await sharp(bytes).extract({left:1075,top:625,width:1,height:1}).raw().toBuffer();assert.equal(center[3],0);
});
test('workflow application preserves original bytes and unrelated files, rejects stale/removed/switched source',async()=>{
  const {applyWorkflowProposal}=await model,source='name: CI\njobs:\n  build: {}\n',proposal='name: Reviewed\njobs:\n  build: {}\n';
  const board={version:1,repositories:[{id:'r',selected:'ci.yml',workflows:[{path:'ci.yml',source,sha:'abc'}]},{id:'other',selected:'other.yml',workflows:[{path:'other.yml',source:'unchanged'}]}]},origin={id:'r',workflow:'ci.yml',source};
  const result=applyWorkflowProposal(structuredClone(board),origin,proposal);assert.equal(result.repositories[0].files[0].originalContent,source);assert.equal(result.repositories[0].files[0].content,proposal);assert.equal(result.repositories[0].workflows[0].source,proposal);assert.deepEqual(result.repositories[1],board.repositories[1]);
  for(const change of [{id:'missing'},{workflow:'other.yml'},{source:'outdated'}])assert.throws(()=>applyWorkflowProposal(structuredClone(board),{...origin,...change},proposal));
  const switched=structuredClone(board);switched.repositories[0].selected='other.yml';assert.throws(()=>applyWorkflowProposal(switched,origin,proposal));
  const removed=structuredClone(result);removed.repositories[0].files[0].isDeleted=true;assert.throws(()=>applyWorkflowProposal(removed,{...origin,source:proposal},source));
});
