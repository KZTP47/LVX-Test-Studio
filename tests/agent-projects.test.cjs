'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const modulePromise=import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../agent-projects.js')).toString('base64'));
const clone=value=>JSON.parse(JSON.stringify(value));
const record=(id,value,revision=1)=>({id,value,revision});
async function fixture(){
  const api=await modulePromise,calls=[],mission=record('m',{id:'m',name:'My project',goal:'Improve checks',criteria:'Pass and review',boardId:'b',workflowId:'w'}),board=record('b',{name:'Team',nodes:[{id:'a',name:'Owner'}]}),workflow=record('w',{name:'Visual graph',nodes:[{id:'n',type:'delay',data:{name:'Wait'}}],edges:[]});
  const tasks=new Map(),missions=new Map([[mission.id,mission]]),proposals=new Map();let failures={},sequence=0,blockCheck=null;
  const invoke=async(domain,action,payload)=>{
    calls.push({domain,action,payload:clone(payload)});
    if(failures[action])throw Object.assign(Error(failures[action]),{code:'CONFLICT'});
    if(domain==='workspace'&&action==='list')return {records:[clone(workflow)]};
    if(domain==='agents'&&action==='listBoards')return {records:[clone(board)]};
    if(action==='listMissions')return {records:[...missions.values()].map(clone)};
    if(action==='listTasks')return {records:[...tasks.values()].map(clone)};
    if(action==='saveMission'){const prior=missions.get(payload.mission.id);assert.equal(payload.expectedRevision,prior?.revision??null);const saved=record(payload.mission.id,clone(payload.mission),(prior?.revision||0)+1);missions.set(saved.id,saved);return {record:clone(saved)};}
    if(action==='saveTask'){const prior=tasks.get(payload.task.id);assert.equal(payload.expectedRevision,prior?.revision??null);const saved=record(payload.task.id,{...clone(payload.task),missionId:payload.missionId,status:prior?.value.status||'todo'},(prior?.revision||0)+1);tasks.set(saved.id,saved);return {record:clone(saved)};}
    if(['startTask','submitTask','reviewTask'].includes(action)){const prior=tasks.get(payload.taskId);assert.equal(payload.expectedRevision,prior.revision);const saved=record(prior.id,{...prior.value,status:action==='startTask'?'active':action==='submitTask'?'review':payload.decision==='approve'?'done':'todo'},prior.revision+1);tasks.set(saved.id,saved);return {record:clone(saved),run:{id:'run-task',status:'queued'}};}
    if(action==='graphContext')return {workflowId:'w',revision:workflow.revision,hash:'hash',workflow:clone(workflow.value),nodeCatalog:[{type:'delay'}],selectedNodeIds:payload.nodeIds,packet:'EXACT GRAPH INPUT'};
    if(action==='listGraphProposals')return {records:[...proposals.values()].map(clone)};
    if(action==='previewGraphProposal'){const saved=record('p',{...payload.proposal,status:'previewed'});proposals.set(saved.id,saved);return {record:clone(saved),preview:{before:clone(workflow.value),after:{...clone(workflow.value),nodes:[{id:'n',type:'delay',data:{name:'Changed'}}]},validation:{valid:true,errors:[]}}};}
    if(action==='applyGraphProposal'){assert.equal(payload.expectedRevision,proposals.get(payload.proposalId).revision);workflow.revision++;workflow.value.nodes[0].data.name='Changed';return {record:record('p',{status:'applied'},2),workflow:clone(workflow)};}
    if(action==='analyzeGraph')return {run:{id:'analysis',status:'queued'},context:{workflowId:'w',revision:workflow.revision,workflow:clone(workflow.value),packet:'EXACT GRAPH INPUT'}};
    if(action==='snapshot')return {runs:[{id:'good',status:'completed'},{id:'bad',status:'partial'}],messages:[{id:'mg',runId:'good',agentId:'a',role:'assistant',sequence:2,text:'```lvx-graph-patch\n{"baseRevision":1,"operations":[{"op":"removeNode","nodeId":"n"}]}\n```'},{id:'mb',runId:'bad',agentId:'a',role:'assistant',sequence:1,text:'```lvx-graph-patch\n{}\n```'}],cursor:3,hasMore:false};
    if(action==='runGraphChecks'){if(blockCheck)return blockCheck;return {id:'execution',runId:'execution',status:'FAILED',fresh:false,workflowId:'w',revision:workflow.revision,results:[]};}
    if(action==='cancelGraphChecks')return {cancelled:true};
    throw Error('Unexpected '+domain+'/'+action);
  };
  const controller=api.createProjectController({workspaceRoot:'F:/fixture',invoke,idFactory:()=>`generated-${++sequence}`});
  return {api,controller,calls,tasks,workflow,failures,setCheck(promise){blockCheck=promise;}};
}
test('graph parser accepts raw and explicitly fenced edits; rejects ambiguous and unsupported changes',async()=>{
  const {parseGraphProposal}=await modulePromise,p={baseRevision:4,summary:'Change wait',operations:[{op:'updateNode',nodeId:'n',changes:{data:{delay:20}}}]},raw=JSON.stringify(p);
  assert.deepEqual(parseGraphProposal(raw),p);assert.deepEqual(parseGraphProposal('Explanation\n```lvx-graph-patch\n'+raw+'\n```\nReview please.'),p);
  for(const bad of ['', '{}','[]','{"baseRevision":0,"operations":[{"op":"removeNode"}]}','{"baseRevision":1,"operations":[{"op":"executeShell"}]}','```json\n'+raw+'\n```'])assert.throws(()=>parseGraphProposal(bad));
  assert.throws(()=>parseGraphProposal('```lvx-graph-patch\n'+raw+'\n```\n```lvx-graph-patch\n'+raw+'\n```'),/more than one/);
});
test('visual diff covers additions, removals and updates without mutating graph',async()=>{
  const {summarizeGraphDiff}=await modulePromise,before={nodes:[{id:'old',data:{name:'Old'}},{id:'same',name:'Before'}],edges:[{id:'e',source:'old',target:'same'}]},after={nodes:[{id:'same',name:'After'},{id:'new',name:'New'}],edges:[]},saved=clone(before);
  const changes=summarizeGraphDiff({before,after});assert.deepEqual(changes.map(c=>[c.kind,c.action,c.label]),[['node','Changed','After'],['node','Added','New'],['node','Removed','Old'],['connection','Removed','e']]);assert.deepEqual(before,saved);
});
test('cards escape names, descriptions, owner and prerequisite labels; show real states separately',async()=>{
  const {renderTaskCards,taskStatus}=await modulePromise,tasks=[record('x',{title:'<script>x</script>',description:'<img onerror="bad">',agentId:'a',dependsOn:['d'],status:'review'}),record('d',{title:'<dependency>',status:'done'})];
  const html=renderTaskCards(tasks,[record('b',{nodes:[{id:'a',name:'<owner>'}]})],record('m',{boardId:'b',workflowId:'w'}));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&lt;owner&gt;'));assert.ok(html.includes('&lt;dependency&gt;'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.match(html,/Ready for your review/);assert.match(html,/Whole linked workflow/);assert.equal(taskStatus({status:'done'}),'Reviewed and complete');
});
test('graph overview and review evidence remain readable and escape graph-authored strings',async()=>{
  const {renderGraphOverview,renderTaskEvidence}=await modulePromise;
  const html=renderGraphOverview({nodes:[{id:'a',type:'security-scan',data:{name:'<bad node>'}},{id:'b',type:'wait',data:{name:'Wait'}}],edges:[{id:'edge',source:'a',target:'b'}]});
  assert.match(html,/2 graph nodes and 1 directed connections/);assert.match(html,/&lt;bad node&gt;/);assert.ok(!html.includes('<bad node>'));assert.match(html,/#f5b9b9/);assert.match(html,/<path d="M/);assert.match(renderGraphOverview({nodes:[],edges:[]}),/No nodes/);
  const summary=renderTaskEvidence({runId:'native',evidence:{provider:{status:'completed'},checks:{status:'SUCCESS',fresh:true},meaning:'<semantic>'},review:{decision:'approve',comment:'<reviewer>'}});assert.match(summary,/completed/);assert.match(summary,/current graph evidence/);assert.match(summary,/Approved/);assert.match(summary,/&lt;semantic&gt;/);assert.match(summary,/&lt;reviewer&gt;/);
});
test('initialization binds all three domains to the exact selected workspace',async()=>{
  const f=await fixture();await f.controller.initialize();assert.equal(f.controller.state.boards.length,1);assert.equal(f.controller.state.workflows.length,1);assert.equal(f.calls.length,3);assert.ok(f.calls.every(c=>c.payload.workspaceRoot==='F:/fixture'));assert.ok(f.calls.every(c=>!c.action.startsWith('run')));
});
test('project and task saves retain ownership, dependency and graph selections with canonical revisions',async()=>{
  const f=await fixture(),c=f.controller;await c.initialize();await c.openMission('m');c.editMission({goal:'New goal'});await c.saveMission();assert.equal(c.state.mission.revision,2);await c.newTask();c.editTask({title:'Exercise graph',agentId:'a',dependsOn:['prior'],workflowNodeIds:['n'],criteria:'Check output'});await c.saveTask();assert.equal(c.state.task.revision,1);assert.equal(c.state.task.value.agentId,'a');assert.deepEqual(c.state.task.value.dependsOn,['prior']);assert.deepEqual(c.state.task.value.workflowNodeIds,['n']);c.editTask({title:'Updated'});await c.saveTask();assert.equal(c.state.task.revision,2);assert.equal(f.calls.filter(call=>call.action==='saveTask').at(-1).payload.expectedRevision,1);
});
test('failed save preserves draft and revision, rejects silent project switching and keeps refresh safe',async()=>{
  const f=await fixture(),c=f.controller;await c.initialize();await c.openMission('m');c.editMission({goal:'Do not lose this goal'});f.failures.saveMission='Changed by someone else';await assert.rejects(c.saveMission(),/Changed by someone else/);assert.equal(c.state.missionDraft.goal,'Do not lose this goal');assert.equal(c.state.mission.revision,1);assert.equal(c.state.missionDirty,true);await assert.rejects(c.newMission(),/Save your draft/);await c.refresh();assert.equal(c.state.missionDraft.goal,'Do not lose this goal');c.discard();assert.equal(c.state.missionDraft.goal,'Improve checks');
});
test('task progression invokes explicit server transitions; review never sets completion locally',async()=>{
  const f=await fixture(),c=f.controller;await c.initialize();await c.openMission('m');await c.newTask();c.editTask({title:'Task',agentId:'a'});await c.saveTask();const taskId=c.state.task.id;await c.transition('startTask',taskId);assert.equal(c.state.task.value.status,'active');await c.transition('submitTask',taskId);assert.equal(c.state.task.value.status,'review');c.state.reviewComment='I checked the result';await c.transition('reviewTask',taskId,'approve');assert.equal(c.state.task.value.status,'done');assert.equal(f.calls.find(call=>call.action==='reviewTask').payload.comment,'I checked the result');assert.equal(f.calls.find(call=>call.action==='reviewTask').payload.expectedRevision,3);
});
test('graph analysis needs an inspectable snapshot and preserves user request without hidden editing instructions',async()=>{
  const f=await fixture(),c=f.controller;await c.initialize();c.selectGraph({graphWorkflowId:'w',graphBoardId:'b',graphAgentId:'a'});c.state.instruction='Explain this wait';await assert.rejects(c.analyze(),/snapshot/);await c.snapshot();c.state.nodeIds=['n'];await c.analyze();const request=f.calls.find(call=>call.action==='analyzeGraph');assert.equal(request.payload.instruction,'Explain this wait');assert.deepEqual(request.payload.nodeIds,['n']);assert.equal(c.state.context.packet,'EXACT GRAPH INPUT');assert.equal(c.state.analysis.status,'queued');assert.ok(!f.calls.some(call=>call.action==='applyGraphProposal'||call.action==='runGraphChecks'));
});
test('editing instructions are visible opt-in text bound to the inspected revision',async()=>{
  const {graphEditInstructions}=await modulePromise;assert.throws(()=>graphEditInstructions(null),/snapshot/);const text=graphEditInstructions({revision:7});assert.match(text,/"baseRevision":7/);assert.match(text,/lvx-graph-patch/);assert.match(text,/Do not apply the edit/);
});
test('exact analysis input is immutable when later snapshots or graph selection change',async()=>{
  const f=await fixture(),c=f.controller;await c.initialize();c.selectGraph({graphWorkflowId:'w',graphBoardId:'b',graphAgentId:'a'});c.state.instruction='Analyze';await c.snapshot();await c.analyze();const sent=c.state.analysisPacket;c.state.context.packet='A different later snapshot';assert.equal(c.state.analysisPacket,sent);c.selectGraph({graphWorkflowId:'other'});assert.equal(c.state.analysisPacket,'');assert.equal(c.state.analysis,null);
});
test('completed native replies can supply proposals while partial replies are excluded',async()=>{
  const f=await fixture(),c=f.controller;await c.initialize();c.selectGraph({graphBoardId:'b',graphAgentId:'a'});await c.loadReplies();assert.equal(c.state.replies.length,1);assert.equal(c.state.replies[0].id,'mg');c.useReply('mg');assert.equal(f.api.parseGraphProposal(c.state.proposalText).baseRevision,1);assert.throws(()=>c.useReply('missing'),/Choose a completed reply/);
});
test('proposal preview is separate from explicit apply and conflicts retain preview and source text',async()=>{
  const f=await fixture(),c=f.controller;await c.initialize();c.selectGraph({graphWorkflowId:'w'});c.state.proposalText=JSON.stringify({baseRevision:1,summary:'Wait label',operations:[{op:'updateNode',nodeId:'n',changes:{data:{name:'Changed'}}}]});await assert.rejects(c.apply(),/Preview/);await c.preview();assert.equal(f.workflow.revision,1);assert.ok(c.state.proposal.preview.validation.valid);f.failures.applyGraphProposal='Graph is stale';await assert.rejects(c.apply(),/Graph is stale/);assert.ok(c.state.proposal);assert.match(c.state.proposalText,/Wait label/);delete f.failures.applyGraphProposal;await c.apply();assert.equal(f.workflow.revision,2);assert.equal(c.state.proposal,null);assert.equal(c.state.context.revision,2);assert.equal(c.state.workflows[0].value.nodes[0].data.name,'Changed');
});
test('failed or stale graph checks remain genuine evidence and never turn into verified claims',async()=>{
  const f=await fixture(),c=f.controller;await c.initialize();c.selectGraph({graphWorkflowId:'w'});c.state.nodeIds=['n'];await c.runChecks();assert.equal(c.state.checks.status,'FAILED');assert.equal(c.state.checks.fresh,false);assert.deepEqual(f.calls.find(call=>call.action==='runGraphChecks').payload.nodeIds,['n']);assert.equal(c.state.checkRunId,'');
});
test('check cancellation uses the client request token during pending execution and preserves final result',async()=>{
  const f=await fixture(),c=f.controller;await c.initialize();c.selectGraph({graphWorkflowId:'w'});let resolve;f.setCheck(new Promise(done=>resolve=done));const running=c.runChecks();await new Promise(done=>setImmediate(done));const token=c.state.checkRunId;assert.ok(token);await c.cancelChecks();assert.equal(f.calls.find(call=>call.action==='cancelGraphChecks').payload.runId,token);resolve({runId:'native-run',status:'CANCELLED',fresh:true});await running;assert.equal(c.state.checks.status,'CANCELLED');assert.equal(c.state.checkRunId,'');
});
test('closed controllers and unbound workspaces cannot invoke another project',async()=>{
  const {createProjectController}=await modulePromise;let calls=0;const c=createProjectController({workspaceRoot:'',invoke:async()=>{calls++;}});await assert.rejects(c.initialize(),/workspace/);assert.equal(calls,0);c.destroy();await assert.rejects(c.initialize(),/closed/);assert.equal(calls,0);
});
test('workspace-bound response rejects foreign project data before it becomes UI state',async()=>{
  const {createProjectController}=await modulePromise,c=createProjectController({workspaceRoot:'F:/one',invoke:async()=>({workspaceRoot:'F:/two',records:[record('foreign',{name:'Foreign'})]})});await assert.rejects(c.initialize(),/Workspace changed/);assert.deepEqual(c.state.missions,[]);
});
