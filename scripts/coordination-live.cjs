'use strict';
// A real installed provider is invoked here. No credentials/configuration are
// read or changed; work is confined to a fresh disposable project and graph.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {launch,waitFor}=require('./coordination-e2e.cjs');const {root,hash,sourceManifest}=require('./source-manifest.cjs');
async function run(){
 const source=sourceManifest(),checks=[],attempts=[];let client;
 try{
 client=await launch();const {invoke}=client,workflowId=crypto.randomUUID(); const git=require('node:child_process').spawnSync('git',['init','--quiet',client.workspace],{encoding:'utf8',windowsHide:true});if(git.status!==0)throw Error('Disposable Git project setup failed: '+git.stderr);
 await invoke('workspace','transact',{records:[{collection:'workflows',id:workflowId,expectedRevision:null,value:{schemaVersion:1,name:'Live read-only graph integration test',nodes:[{id:'live-wait',type:'wait-delay',position:{x:400,y:100},data:{name:'Before live review',delayMs:0}}],edges:[]}}]});
 const caps=await invoke('agents','capabilities');
 for(const provider of caps.providers.filter(provider=>provider.id!=='api'&&provider.installed)){
  const boardId=crypto.randomUUID(),agentId=crypto.randomUUID();
  await invoke('agents','saveBoard',{expectedRevision:null,board:{schemaVersion:1,id:boardId,name:'Live integration test '+provider.id,goal:'Inspect the supplied saved graph',acceptanceCriteria:'A valid graph proposal followed by real checks',mode:'manual',maxTurns:1,concurrency:1,nodes:[{id:agentId,name:'Live '+provider.id,provider:provider.id,model:'',effort:'',instructions:'',permission:provider.id==='codex'?'read-only':'native',position:{x:0,y:0}}],edges:[]}});
  const context=await invoke('coordination','graphContext',{workflowId});
  const instruction='This is a bounded LVX integration test in a disposable project. Inspect only the graph supplied below; no tools, file changes, network browsing or shell commands are needed. Explain what its only node does. Then propose ONLY renaming the live-wait node to After live review while preserving delayMs=0. Return one lvx-graph-patch JSON code block with baseRevision '+context.revision+', a short summary and operations:[{"op":"updateNode","nodeId":"live-wait","changes":{"data":{"name":"After live review"}}}]. Do not apply anything; the user will review the proposal in Studio.';
  const sent=await invoke('coordination','analyzeGraph',{workflowId,boardId,agentId,instruction});
  let state;
  try{state=await waitFor(async()=>{const snapshot=await invoke('agents','snapshot',{boardId});const run=snapshot.runs.find(run=>run.id===sent.run.id);return run&&['completed','blocked','error','limit','partial','cancelled','interrupted'].includes(run.status)?{snapshot,run}:null;},'live '+provider.id+' provider turn',120000);}
  catch(error){await invoke('agents','cancel',{boardId,runId:sent.run.id});attempts.push({provider:provider.id,status:'TIMEOUT',reason:'No terminal response within two minutes; scoped test run cancelled.'});continue;}
  const assistant=state.snapshot.messages.find(message=>message.role==='assistant'&&message.runId===sent.run.id&&message.state==='completed');
  if(state.run.status!=='completed'||!assistant){const problem=state.snapshot.messages.find(message=>message.runId===sent.run.id&&message.error);attempts.push({provider:provider.id,status:state.run.status,reason:String(problem?.error||state.run.error||'Provider did not return a complete successful response.').slice(0,2000)});continue;}
  const {parseGraphProposal}=await import('../agent-projects.js');
  try{
   const proposal=parseGraphProposal(assistant.text);const preview=await invoke('coordination','previewGraphProposal',{workflowId,proposal});assert.equal(preview.preview.after.nodes[0].data.name,'After live review');assert.equal(preview.preview.after.nodes[0].data.delayMs,0);
   await invoke('coordination','applyGraphProposal',{proposalId:preview.record.id,expectedRevision:preview.record.revision});const evidence=await invoke('coordination','runGraphChecks',{workflowId});assert.equal(evidence.status,'SUCCESS');assert.equal(evidence.fresh,true);
   checks.push('Real '+provider.id+' received current saved graph and returned a valid revision-bound edit.','Reviewed live-model edit applied through Studio and passed actual native execution.');
   attempts.push({provider:provider.id,status:'SUCCESS',nativeSessionIdPresent:state.snapshot.sessions.some(session=>session.agentId===agentId&&!!session.nativeSessionId),providerRunId:sent.run.id,proposalId:preview.record.id,checkRunId:evidence.runId,response:assistant.text});break;
  }catch(error){attempts.push({provider:provider.id,status:'INVALID_PROPOSAL',reason:error.message,response:assistant.text});}
 }
 const success=attempts.some(attempt=>attempt.status==='SUCCESS');
 const report={status:success?'SUCCESS':'BLOCKED',recordedAt:new Date().toISOString(),sourceDigest:source.digest,testScriptSha256:hash(fs.readFileSync(__filename)),checks,attempts,providerDetection:caps.providers.map(({id,installed})=>({id,installed})),limits:['One bounded disposable graph test; this is not a comparative answer-quality benchmark or a promise that every subscription/provider is usable.','No user authentication files, unrelated project data or private conversations were read. Provider defaults preserved; no changes to provider account/settings.']};
 fs.writeFileSync(path.join(root,'docs/verification/coordination-live-results.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,attempts:attempts.map(({provider,status,reason})=>({provider,status,reason}))}));console.log('LVX_COORDINATION_LIVE_RECORDED');return report;
 }finally{await client?.app.close();}
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});module.exports={run};
