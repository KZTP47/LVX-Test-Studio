'use strict';
// Isolated native SQLite/UI fixture. No real project, credential or provider calls.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('playwright'),{root,sourceManifest,hash}=require('./source-manifest.cjs');
async function main(){
 const packaged=process.argv.includes('--packaged'),baseline=process.argv.includes('--baseline');
 if(packaged&&!baseline)require('./package-manifest.cjs').verifyPackage();
 const source=sourceManifest().digest,temporary=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-profile-')),workspace=path.join(temporary,'project'),output=path.join(root,'output/agent-profile');fs.mkdirSync(workspace);fs.mkdirSync(output,{recursive:true});
 const checks=[],errors=[];let app,page;
 const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};
 const invoke=(domain,action,payload={})=>page.evaluate(({domain,action,payload})=>electronAPI.studioOps.invoke(domain,action,payload),{domain,action,payload:{...payload,workspaceRoot:workspace}});
 const record=async()=>{const result=await invoke('agents','getBoard',{boardId:'picture-fixture'});assert.ok(!result.__lvxError,JSON.stringify(result.__lvxError));return result.record;};
 const picture=async id=>(await record()).value.nodes.find(n=>n.id===id).appearance?.avatar||'';
 const idle=()=>page.waitForFunction(()=>!document.querySelector('[data-gc="refresh"]')?.disabled);
 const render=async name=>{await page.evaluate(name=>LVXStudio.render(name),name);};
 const shot=async name=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const bytes=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));fs.writeFileSync(path.join(output,name+(packaged?'-packaged':'')+'.png'),Buffer.from(bytes,'base64'));};
 const launch=async()=>{
  const env={...process.env,LVX_TEST_USER_DATA:path.join(temporary,'profile'),LVX_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({...(packaged?{executablePath:path.join(root,'release/win-unpacked/LVX Test Studio.exe')}:{args:[root]}),cwd:root,env});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1500,1050);w.webContents.setBackgroundThrottling(false);});await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>window.LVXStudioInitialized===true);
  await app.evaluate(({dialog},folder)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]}),workspace);
  await page.evaluate(async()=>{await electronAPI.studioOps.chooseWorkspace();await electronAPI.studioOps.invoke('security','trust',{trusted:true});await LVXApp.useStorage(LVXWorkspaceBridge.createBackend());await LVXStudio.open();});
  // Version probes use Node in this isolated profile, avoiding dependence on
  // installed provider CLIs or their update/login services. No turn is sent.
  for(const provider of ['codex','claude','gemini'])await invoke('agents','configureProvider',{provider,path:process.execPath});
 };
 const close=async()=>{if(app){await app.close();app=null;}};
 const openGraphChat=async()=>{await render('githubActions');await page.locator('.gc-root').waitFor();await idle();if(!await page.locator('.gw-lane').count()){await page.locator('[data-action="examples"]').click();await page.locator('.gw-lane').nth(2).waitFor();}if(!await page.locator('[data-gc-agent="a"]').count()){await page.locator('[name="gc-agent"]').selectOption('a');await page.locator('[data-gc="place"]').click();await idle();}await page.locator('[data-gc-agent="a"] [data-gc="settings"]').evaluate(el=>el.click());await page.locator('[data-gc-chat="a"] [name="picture"]').waitFor();};
 try{
  await launch();const board={schemaVersion:1,id:'picture-fixture',name:'Picture persistence fixture',goal:'Original goal',mode:'manual',maxTurns:1,concurrency:1,nodes:['a','b'].map((id,index)=>({id,name:'Agent '+id,provider:'api',model:'fixture',apiConfig:{provider:'custom',customEndpoint:'http://127.0.0.1:1/chat',model:'fixture'},permission:'native',instructions:'Original instructions',position:{x:40+index*300,y:40},appearance:{color:'#187f4d',icon:'robot',avatar:'',zoom:1,hue:0}})),edges:[]};
  await invoke('agents','saveBoard',{board,expectedRevision:null});await openGraphChat();
  const png=await require('sharp')({create:{width:192,height:128,channels:4,background:'#ce378c'}}).png().toBuffer(),jpeg=await require('sharp')(png).jpeg().toBuffer(),webp=await require('sharp')(png).webp().toBuffer();
  const pngURI='data:image/png;base64,'+png.toString('base64'),webpURI='data:image/webp;base64,'+webp.toString('base64');
  let chat=page.locator('[data-gc-chat="a"]');
  await chat.locator('[name="picture"]').setInputFiles({name:'chosen.png',mimeType:'image/png',buffer:png});await idle();
  if(baseline){check('Baseline: choosing a picture does not save it',await picture('a')==='');await page.locator('[data-gc="refresh"]').click();await idle();check('Baseline: refresh still shows the fallback icon',await page.locator('[data-gc-agent="a"] .gc-profile img').count()===0);console.log('LVX_AGENT_PROFILE_BASELINE_REPRODUCED');return;}
  check('Choosing a picture saves exact embedded bytes without Save settings',await picture('a')===pngURI);
  check('Saved picture has a visible preview and clear saved feedback',await chat.locator('.gc-picture-preview img').evaluate(img=>img.complete&&img.naturalWidth===192)&&await chat.locator('.gc-picture-status').innerText().then(t=>t.includes('Picture saved')));
  await page.evaluate(()=>window.__pictureBeforeRefresh=document.querySelector('[data-gc-agent="a"] .gc-profile img'));
  for(let i=0;i<3;i++){await page.locator('[data-gc="refresh"]').click();await idle();}
  check('Repeated agent refresh keeps the saved picture visible',await picture('a')===pngURI&&await page.locator('[data-gc-agent="a"] .gc-profile img').evaluate(img=>img.complete&&img.naturalWidth===192));
  check('Refresh reuses the loaded picture instead of replacing and decoding it again',await page.evaluate(()=>window.__pictureBeforeRefresh===document.querySelector('[data-gc-agent="a"] .gc-profile img')));
  await chat.locator('[name="name"]').fill('Renamed picture agent');await chat.locator('[data-gc="save-profile"]').click();await idle();
  check('Saving unrelated settings preserves the picture and the other agent',await picture('a')===pngURI&&await picture('b')===''&&(await record()).value.nodes[0].name==='Renamed picture agent');await shot('graph-picture-saved');
  await page.evaluate(()=>{document.body.classList.add('theme-dark');document.body.dataset.theme='dark';});await shot('picture-dark');await page.evaluate(()=>{document.body.classList.remove('theme-dark');document.body.dataset.theme='light';});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(700,1000));check('Picture preview and saved feedback fit a narrow chat',await chat.locator('.gc-picture-feedback').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await shot('picture-narrow');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1500,1050));
  await render('runs');await openGraphChat();check('Leaving and reopening a view keeps the picture',await page.locator('[data-gc-agent="a"] .gc-profile img').getAttribute('src')===pngURI);
  await render('agentBoard');await page.locator('.agent-board').waitFor();await page.locator('[name="saved-board"]').selectOption('picture-fixture');await page.locator('[data-ab-action="load"]').click();await page.locator('[data-agent-id="a"]').waitFor();await page.locator('[data-agent-id="a"] [data-ab-action="node-settings"]').click();
  const editor=page.locator('.agent-board');await editor.getByText('Model, instructions and permissions',{exact:true}).click();await editor.locator('[name="agent-instructions"]').fill('Unsaved executable instructions');
  await editor.locator('[name="agent-picture"]').setInputFiles({name:'replacement.webp',mimeType:'image/webp',buffer:webp});await page.waitForFunction(()=>document.querySelector('[data-ab="picture-status"]')?.textContent.includes('Picture saved'));
  check('Board editor saves a replacement without committing unrelated instructions',await picture('a')===webpURI&&(await record()).value.nodes[0].instructions==='Original instructions'&&await editor.locator('[name="agent-instructions"]').inputValue()==='Unsaved executable instructions');
  await editor.locator('[data-ab-action="discard"]').click();await editor.locator('[data-ab-action="confirm"]').click();await page.waitForFunction(()=>document.querySelector('[name="agent-instructions"]')?.value==='Original instructions');
  check('Discarding unrelated draft edits keeps the already saved picture',await picture('a')===webpURI);await shot('board-picture-saved');
  await openGraphChat();chat=page.locator('[data-gc-chat="a"]');
  await chat.locator('[name="picture"]').setInputFiles({name:'invalid.png',mimeType:'image/png',buffer:Buffer.from('Not an image')});await page.waitForFunction(()=>document.querySelector('.gc-picture-status')?.textContent.includes('Picture not saved'));
  check('Invalid image keeps the previous picture with a readable error',await picture('a')===webpURI&&await chat.locator('.gc-picture-status').innerText().then(t=>t.includes('Choose another image')));await shot('picture-error');
  await chat.locator('[data-gc="clear-picture"]').click();await idle();check('Explicit removal saves the default icon immediately',await picture('a')===''&&await page.locator('[data-gc-agent="a"] .gc-profile img').count()===0);
  await chat.locator('[name="picture"]').setInputFiles({name:'final.jpg',mimeType:'image/jpeg',buffer:jpeg});await idle();const jpegURI='data:image/jpeg;base64,'+jpeg.toString('base64');check('A new JPEG replaces the removed picture',await picture('a')===jpegURI);
  await close();await launch();await openGraphChat();
  check('Full app restart preserves exact picture bytes and rendered sprite',await picture('a')===jpegURI&&await page.locator('[data-gc-agent="a"] .gc-profile img').evaluate(img=>img.complete&&img.naturalWidth===192));
  check('Restarted settings show the saved preview without reselecting a file',await page.locator('.gc-picture-preview img').getAttribute('src')===jpegURI&&await page.locator('[data-gc-chat="a"] [name="picture"]').inputValue()==='');await shot('picture-after-restart');
  check('Picture changes never dispatch an agent message',(await invoke('workspace','list',{collection:'agent-messages'})).records.length===0);check('No renderer exceptions',errors.length===0);
  assert.equal(sourceManifest().digest,source,'Source changed during picture verification');console.log('LVX_AGENT_PROFILE_E2E_OK '+checks.length+' checks '+(packaged?'packaged':'source'));
 } catch(error){if(page)await shot('failure').catch(()=>{});throw error;}
 finally{await close();fs.writeFileSync(path.join(output,'last-'+(baseline?'baseline':packaged?'packaged':'source')+'.log'),checks.map(c=>'PASS '+c).join('\n')+'\n'+errors.join('\n'));}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
