'use strict';
// Reproduce an uncommitted delivery in an isolated checkout-shaped directory.
// This is local Windows evidence; it never claims that a hosted CI job ran.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const {sourceManifest}=require('./source-manifest.cjs');
async function run(){
 const source=sourceManifest(),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-clean-')),checkout=path.join(temporary,'checkout');
 const report={date:new Date().toISOString(),platform:process.platform,node:process.version,sourceDigest:source.digest,scope:'Local clean-directory install; hosted CI has not been executed.',commands:[]};
 fs.mkdirSync(checkout);
 // Match the actual Git publication set, rather than accidentally importing
 // ignored reports, profiles or exports from the developer's working copy.
 for(const file of require('./verify-repository-contents.cjs').check()){
  const destination=path.join(checkout,file);fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.copyFileSync(path.join(root,file),destination);
 }
 const invoke=(label,args)=>{console.log('CLEAN ROOM:',label);const result=cp.spawnSync(process.execPath,args,{cwd:checkout,env:{...process.env,LVX_CLEAN_ROOM:'1'},stdio:'inherit',windowsHide:true,timeout:900000});report.commands.push({command:label,exitCode:result.status,error:result.error?.message});if(result.status!==0||result.error)throw Error('Clean-room command failed: '+label);};
 try{
  const npm=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
  invoke('npm ci',[npm,'ci']);
  invoke('npm run setup',[npm,'run','setup']);
  const python=process.env.LVX_PYTHON||'python';
  console.log('CLEAN ROOM: isolated test extras');
  const extras=cp.spawnSync(python,['-m','pip','install','--disable-pip-version-check','--target','.external/python-test-packages','-r','tests/requirements.txt'],{cwd:checkout,stdio:'inherit',windowsHide:true,timeout:300000});report.commands.push({command:'isolated Python test extras',exitCode:extras.status});if(extras.status!==0)throw Error('Test extras could not be prepared.');
  invoke('native framework fixture preparation',['services/execution/prepare-native-fixtures.cjs']);
  invoke('npm test',[npm,'test']);
  invoke('npm run test:e2e',[npm,'run','test:e2e']);
  invoke('npm run test:roadmap',[npm,'run','test:roadmap']);
  invoke('npm run test:machina',[npm,'run','test:machina']);
  invoke('native agent style E2E',['scripts/agent-style-e2e.cjs']);
  invoke('native agent collaboration E2E',['scripts/agent-studio-e2e.cjs']);
  report.status='SUCCESS';
  report.resultFiles=Object.fromEntries(['regression-results.json','e2e-results.json','roadmap-e2e-results.json','machina-e2e-results.json','agent-style-results.json','agent-studio-e2e-results.json'].map(file=>[file,JSON.parse(fs.readFileSync(path.join(checkout,'docs/verification',file),'utf8'))]));
  console.log('LVX_CLEAN_ROOM_VERIFIED');
 }catch(error){report.status='ERROR';report.error=error.message;report.recoveryDirectory=temporary;throw error;}
 finally{
  fs.writeFileSync(path.join(root,'docs/verification/clean-room-results.json'),JSON.stringify(report,null,2));
  if(report.status==='SUCCESS'){const resolved=fs.realpathSync(temporary);if(path.dirname(resolved)!==fs.realpathSync(os.tmpdir())||!path.basename(resolved).startsWith('lvx-clean-'))throw Error('Unsafe clean-room cleanup target');fs.rmSync(resolved,{recursive:true,force:true,maxRetries:8,retryDelay:250});}
 }
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});module.exports={run};
