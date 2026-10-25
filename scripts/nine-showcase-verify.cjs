'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {build,graphs}=require('./nine-showcase.cjs'),{createService}=require('../services/execution/index.cjs');
async function run(){const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-ready-')),workspace=path.join(temporary,'project');fs.mkdirSync(workspace);const service=createService({dataDir:path.join(temporary,'execution'),workspaceRoot:workspace});const outcomes=[];
 try{const archive=build();assert.equal(archive.payload.records.filter(r=>r.collection==='workflows').length,3);
 for(const graph of graphs()){
  const validation=await service.handle('validateWorkflow',{workflow:graph});assert.ok(validation.valid,JSON.stringify(validation.errors));
  let current=await service.handle('runWorkflow',{workflow:graph});const deadline=Date.now()+120000;
  while(['RUNNING','PENDING'].includes(current.status)){assert.ok(Date.now()<deadline,'Graph run timed out');await new Promise(resolve=>setTimeout(resolve,80));current=await service.handle('getRun',{id:current.id});}
  assert.equal(current.status,'SUCCESS',graph.name+' '+JSON.stringify(current.results));assert.ok(current.total>0);outcomes.push({graph:graph.id,status:current.status,assertions:current.total});console.log('PASS '+graph.name);
 }
 fs.mkdirSync(path.join(__dirname,'../output'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../output/nine-showcase.json'),JSON.stringify({status:'SUCCESS',outcomes},null,2)+'\n');console.log('LVX_NINE_SHOWCASE_VERIFIED');return outcomes;
 }finally{await service.close();}}
module.exports={run};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
