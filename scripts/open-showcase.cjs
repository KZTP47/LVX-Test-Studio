'use strict';
// The launcher imports only this explicitly selected lab, into a separate profile.
const fs=require('node:fs'),path=require('node:path'),{spawn,execFileSync}=require('node:child_process'),{_electron}=require('playwright');
async function open(directory,{verifyOnly=false,profileName='.studio-profile'}={}){
 const bundle=fs.realpathSync(directory),config=JSON.parse(fs.readFileSync(path.join(bundle,'lab-config.json'))),root=path.resolve(bundle,config.studioRoot),workspace=fs.realpathSync(path.join(bundle,config.workspace));
 if(config.marker!=='lvx-showcase-20261025')throw Error('Unrecognized showcase folder.');
 if(path.dirname(workspace)!==bundle)throw Error('The lab workspace must be immediately inside the showcase.');
 const executable=path.join(root,'release/win-unpacked/LVX Test Studio.exe'),profile=path.join(process.env.LOCALAPPDATA,'LVXShowcases',require('node:crypto').createHash('sha256').update(bundle+profileName).digest('hex').slice(0,20)),initialized=path.join(profile,'showcase-imported.json');
 if(!fs.existsSync(executable))throw Error('Keep the showcase inside this repository’s exports folder, beside the supplied build.');
 if(!fs.existsSync(path.join(workspace,'.git')))execFileSync('git',['init','--quiet',workspace],{windowsHide:true});
 const native=JSON.parse(fs.readFileSync(path.join(require('../services/execution/prepare-native-fixtures.cjs').root,'manifest.json')));
 const jestModules=path.join(workspace,'frameworks/jest/node_modules');if(!fs.existsSync(jestModules))fs.symlinkSync(path.join(native.jest,'node_modules'),jestModules,'junction');
 const env={...process.env,LVX_TEST_USER_DATA:profile,LVX_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:executable,cwd:root,env});let result,succeeded=false;
 try{
  const page=await app.firstWindow();await page.waitForFunction(()=>window.LVXStudioInitialized===true);
  await app.evaluate(({BrowserWindow,dialog},workspace)=>{BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);dialog.showOpenDialog=async()=>({canceled:false,filePaths:[workspace]});},workspace);
  await page.evaluate(async()=>{await electronAPI.studioOps.chooseWorkspace();await electronAPI.studioOps.invoke('security','trust',{trusted:true});});
  const invoke=(domain,action,payload={})=>page.evaluate(({domain,action,payload,workspace})=>electronAPI.studioOps.invoke(domain,action,{...payload,workspaceRoot:workspace}),{domain,action,payload,workspace});
  const archive=JSON.parse(fs.readFileSync(path.join(bundle,'LVX-Advanced-Showcase.lvx.json'))),fresh=!fs.existsSync(initialized);
  if(fresh){
   const invalid=structuredClone(archive);invalid.payload.records[0].value.showcaseCorruption=true;
   if((await invoke('workspace','previewImport',{archive:invalid})).valid)throw Error('Corrupted archive unexpectedly accepted.');
   const preview=await invoke('workspace','previewImport',{archive});if(!preview.valid)throw Error(preview.errors.join('\n'));
   result=await invoke('workspace','import',{archive,mode:'merge',expectedWorkspaceRevision:preview.revision});
   for(const item of await invoke('host','pendingImports'))await invoke('host','trustImport',{hash:item.hash});
   // Imported conversations remain readable. Future messages get fresh native
   // sessions so they cannot inherit a foreign workspace/provider session binding.
   for(const record of archive.payload.records.filter(r=>r.collection==='agent-boards')){
    const snap=await invoke('agents','snapshot',{boardId:record.id});
    for(const agent of record.value.nodes){const session=snap.sessions.find(s=>s.agentId===agent.id);await invoke('agents','newSession',{boardId:record.id,agentId:agent.id,expectedGeneration:session?.generation||1});}
   }
   fs.writeFileSync(initialized,JSON.stringify({at:new Date().toISOString(),workspace,archiveChecksum:archive.manifest.payloadChecksum,...result},null,2));
  }
  await invoke('execution','configureRuntimes',{paths:{junitJar:native.junitJar}});
  const records=(await invoke('workspace','list')).records;
  if(fresh&&records.length<archive.manifest.records)throw Error('Import lost project records.');
  let messageCount=null;
  if(fresh){
  if(await page.locator('#studio-workbench').getAttribute('hidden')!==null)await page.locator('#openStudioWorkbench').click();await page.locator('[data-page="graph"]').click();
  const graph=archive.payload.records.find(r=>r.collection==='workflows'&&r.value.name.startsWith('01'));
  await page.locator('#machina-workflow-select').selectOption(graph.id);await page.locator('#machina-workflow-open').click();await page.locator('.ve-node').first().waitFor();
  for(let index=0;index<4;index++)await page.locator('#ve-zoom-out-btn').click();
  await page.locator('[data-page="agentBoard"]').click();const board=archive.payload.records.find(r=>r.collection==='agent-boards');
  await page.locator('[name="saved-board"]').selectOption(board.id);await page.locator('[data-ab-action="load"]').click();await page.locator('[data-agent-id]').first().waitFor();await page.locator('[data-ab-action="fit"]').click();
  const snap=await invoke('agents','snapshot',{boardId:board.id});
  messageCount=snap.messages.length;
  if(!snap.messages.some(m=>m.role==='assistant'&&m.text.length>80))throw Error('Real conversation was lost during import.');
  await page.locator('[data-page="agentProjects"]').click();const mission=archive.payload.records.find(r=>r.collection==='agent-missions');
  if(mission){await page.locator('[name="saved-mission"]').selectOption(mission.id);await page.locator('[data-ap-action="open-mission"]').click();}
  }
  const proof={status:'SUCCESS',import:result||'existing profile retained',records:records.length,messages:messageCount,archiveChecksum:archive.manifest.payloadChecksum,corruptArchiveRejected:fresh?true:null,normalProfileUntouched:true};
  fs.mkdirSync(path.join(bundle,'evidence'),{recursive:true});fs.writeFileSync(path.join(bundle,'evidence',verifyOnly?(fresh?'fresh-import-results.json':'repeat-launch-results.json'):'launcher-results.json'),JSON.stringify(proof,null,2));
  succeeded=true;return proof;
 }finally{
  await app.close();
  if(!verifyOnly&&succeeded){const visibleEnv={...env};delete visibleEnv.LVX_TEST_HIDDEN;const child=spawn(executable,[],{cwd:root,env:visibleEnv,detached:true,stdio:'ignore',windowsHide:false});child.unref();}
 }
}
module.exports={open};if(require.main===module)open(process.argv[2],{verifyOnly:process.argv.includes('--verify-only')}).then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(error);process.exitCode=1;});
