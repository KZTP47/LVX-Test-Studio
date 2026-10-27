'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function folder(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-capacity-integration-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('review approval persists more than eight MiB and more than one hundred history entries',async t=>{
 const root=folder(t),service=require('../services/execution/index.cjs').createService({workspaceRoot:root,dataDir:path.join(root,'.state')});t.after(()=>service.close());
 const workflow={schemaVersion:1,nodes:[{id:'review',type:'code-review',data:{sourceCode:'original',outputPath:'reviewed.js'}}],edges:[]};
 const started=await service.handle('runWorkflow',{workflow});let pending;for(let i=0;i<1000;i++){pending=(await service.handle('pendingReviews'))[0];if(pending)break;await pause(5);}assert.ok(pending);
 const finalCode='// '+ 'x'.repeat(8*1024*1024+1),history=Array.from({length:101},(_,i)=>({prompt:'Revision '+i,originalCode:'before',suggestedCode:'after',status:'accepted',timestamp:new Date().toISOString()}));
 const accepted=await service.handle('reviewDecision',{id:started.id,decisionId:pending.decisionId,decision:'approve',finalCode,history});assert.equal(accepted.finalCode,finalCode);assert.equal(accepted.history.length,101);
 let completed;for(let i=0;i<1000;i++){completed=await service.handle('getRun',{id:started.id});if(completed.status!=='RUNNING')break;await pause(5);}assert.equal(completed.status,'SUCCESS',completed.error);assert.equal(completed.results.review.artifacts.historyCount,101);assert.equal(fs.readFileSync(path.join(root,'reviewed.js'),'utf8'),finalCode);
});
test('large test bodies and deep graphs avoid JavaScript argument and call-stack limits',async()=>{
 const parser=require('../services/github-studio/test-source.cjs'),source="test('large',()=>{\n"+'// x\n'.repeat(150000)+'});';const result=await parser.discover({path:'large.test.js',source,frameworkHint:'jest'});assert.equal(result.cases.length,1);
 const Graph=require('../graph-engine.js'),nodes=Array.from({length:12000},(_,i)=>({id:'n'+i,type:'script',data:{engine:'javascript',code:'assert(true);'}})),edges=nodes.slice(1).map((n,i)=>({source:'n'+i,target:n.id}));
 assert.equal(Graph.executionPlan({nodes,edges},{selectedNodeId:nodes.at(-1).id}).workflow.nodes.length,12000);assert.deepEqual(new Graph()._resolveInputs(nodes.at(-1),edges,{results:{}}),{$provenance:{}});
 const {compileSteps}=await import('../studio-model.js');const cyclic=[];cyclic.push({type:'repeat',count:1,children:cyclic});assert.throws(()=>compileSteps(cyclic),/cycle/);
});
test('legacy commands without deadlines are tracked and stopped with their descendants',async t=>{
 const root=folder(t),marker=path.join(root,'heartbeat'),registry=require('../services/legacy-processes.cjs');
 const childCode=`setInterval(()=>require('fs').writeFileSync(${JSON.stringify(marker)},String(Date.now())),20);`;
 const child=registry.track(spawn(process.execPath,['-e',`require('child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'});setInterval(()=>{},1000);`],{windowsHide:true,detached:process.platform!=='win32'}));t.after(()=>registry.stopAll());
 for(let i=0;i<500&&!fs.existsSync(marker);i++)await pause(10);assert.ok(fs.existsSync(marker));await registry.stopAll();const stamp=fs.readFileSync(marker,'utf8');await pause(80);assert.equal(fs.readFileSync(marker,'utf8'),stamp);assert.ok(child.exitCode!==null||child.signalCode);
 const subsequent=registry.track(spawn(process.execPath,['-e','process.exit(0)'],{windowsHide:true}));await new Promise(resolve=>subsequent.once('close',resolve));assert.equal(subsequent.exitCode,0);
});
