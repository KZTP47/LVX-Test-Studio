'use strict';
// Sequential, reproducible local proof stages; never invokes a live AI model.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const {root,hash,sourceManifest}=require('./source-manifest.cjs');
const npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const stages={
 source:[['dependency audit',['scripts/dependency-check.cjs']],['vendor integrity',['scripts/check-vendor.cjs']],['full regression',[npm,'test']],['source desktop',['scripts/e2e.cjs']],['source roadmap',['scripts/roadmap-e2e.cjs']],['source Machina',['scripts/machina-e2e.cjs']],['source restored colours',['scripts/agent-style-e2e.cjs']],['source agent collaboration',['scripts/agent-studio-e2e.cjs']]],
 package:[['Windows installer build',[npm,'run','dist']],['seal candidate',['scripts/seal-candidate.cjs']],['packaged desktop',['scripts/verify-desktop.cjs']],['packaged roadmap',['scripts/roadmap-e2e.cjs','--packaged']],['packaged Machina',['scripts/machina-e2e.cjs','--packaged']],['packaged restored colours',['scripts/agent-style-e2e.cjs','--packaged']],['packaged agent collaboration',['scripts/agent-studio-e2e.cjs','--packaged']],['installer lifecycle',['scripts/installer-smoke.cjs']],['installer checksums',['scripts/release-checksums.cjs']],['native Windows icon',['scripts/capture-windows-icon.cjs']],['existing delivery contracts',['scripts/verify-delivery.cjs','all']]],
 clean:[['isolated setup and all source suites',['scripts/clean-room.cjs']]]
};
async function run(stage){
 assert.ok(stages[stage],'Choose source, package or clean');require('./build-ui.cjs').buildUI({check:true});
 const source=sourceManifest(),report={stage,status:'RUNNING',sourceDigest:source.digest,scriptSha256:hash(fs.readFileSync(__filename)),commands:[],startedAt:new Date().toISOString()};
 try{for(const [name,args]of stages[stage]){console.log('CANDIDATE',stage,name);const exitCode=await new Promise((resolve,reject)=>{const child=cp.spawn(process.execPath,args,{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});const timer=setTimeout(()=>{child.kill();reject(Error('Timed out: '+name));},1200000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);resolve(code);});});report.commands.push({name,args,exitCode});assert.equal(exitCode,0,'Candidate stage failed: '+name);assert.equal(sourceManifest().digest,source.digest,'Source changed during candidate proof');}report.status='SUCCESS';console.log('AGENT_CANDIDATE_'+stage.toUpperCase()+'_VERIFIED');}
 catch(error){report.status='ERROR';report.error=error.message;throw error;}
 finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(root,'docs/verification/agent-candidate-'+stage+'.json'),JSON.stringify(report,null,2)+'\n');}
}
if(require.main===module)run(process.argv[2]).catch(error=>{console.error(error);process.exitCode=1;});module.exports={run};
