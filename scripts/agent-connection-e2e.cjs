'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron}=require('playwright'),{root,sourceManifest,hash}=require('./source-manifest.cjs');
async function run(mode='source'){
 const source=sourceManifest(),scriptSha256=hash(fs.readFileSync(__filename)),packaged=mode==='packaged',packageProof=packaged?require('./package-manifest.cjs').verifyPackage():null;
 const executable=require('../services/agents/native.cjs').resolveExecutable('codex');assert.ok(executable?.command,'This installation must have the official Codex CLI available for the repair check.');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-agent-repair-e2e-')),workspace=path.join(temporary,'project');fs.mkdirSync(workspace);let app,page;const checks=[],errors=[];
 const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};
 const action=name=>page.locator('[data-ab-action="'+name+'"]'),modal=()=>page.locator('dialog.agent-connection-dialog'),control=name=>modal().locator('[data-ac-action="'+name+'"]');
 const invoke=(action,payload={})=>page.evaluate(({action,payload})=>electronAPI.studioOps.invoke('agents',action,payload),{action,payload});
 try{
  const env={...process.env,LVX_TEST_USER_DATA:path.join(temporary,'profile'),LVX_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({...(packaged?{executablePath:path.join(root,'release/win-unpacked/LVX Test Studio.exe')}:{args:[root]}),cwd:os.tmpdir(),env});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await page.waitForFunction(()=>window.LVXStudioInitialized===true);
  await app.evaluate(({BrowserWindow,dialog},workspace)=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1500,1000);w.webContents.setBackgroundThrottling(false);w.showInactive();dialog.showOpenDialog=async()=>({canceled:false,filePaths:[workspace]});},workspace);
  await page.evaluate(async()=>{await electronAPI.studioOps.chooseWorkspace();await electronAPI.studioOps.invoke('security','trust',{trusted:true});await LVXApp.useStorage(LVXWorkspaceBridge.createBackend());await LVXStudio.open('agentBoard');});
  await action('add').waitFor();
  // Reproduce a CLI missing from this disposable process's environment only.
  await app.evaluate(()=>{global.__agentEnvironment={};for(const key of ['PATH','Path','path','APPDATA','LOCALAPPDATA','USERPROFILE','HOME']){global.__agentEnvironment[key]=process.env[key];delete process.env[key];}});
  await action('add').click();await page.locator('[name="agent-name"]').fill('Codex repair verification');await action('save').click();await require('./board-save-helper.cjs').completeBoardSave(page);
  const board=(await invoke('listBoards')).records[0],agent=board.value.nodes[0];await page.locator('[data-agent-id="'+agent.id+'"] [data-ab-action="node-chat"]').click();const chat=page.locator('[data-chat-agent="'+agent.id+'"]');
  await chat.locator('textarea').fill('LVX connection repair fixture — no provider should receive this failed message.');await chat.locator('button[type="submit"]').click();await chat.getByText(/Official codex CLI is unavailable/).waitFor();
  check('The exact missing native CLI error is reproduced through the actual chat send control',true);
  await chat.locator('textarea').fill('Unsent text must survive connection repair');const original=(await invoke('snapshot',{boardId:board.id,limit:500})).messages;
  await chat.locator('[data-ab-action="repair-connection"]').click();await modal().locator('[data-ac="result"]').getByText('Connection needs attention',{exact:true}).waitFor();
  check('The error has a working production repair control identifying the correct agent',(await modal().locator('[data-ac="agent"]').textContent()).includes(agent.name)&&await control('choose').isVisible());
  check('Missing CLI diagnosis disables sign-in until a tool exists',await control('login').isDisabled());
  await control('recheck').click();await page.waitForFunction(()=>document.querySelector('dialog.agent-connection-dialog')?.dataset.connectionState==='missing');
  check('Recheck does not resend messages or rewrite failed evidence',JSON.stringify((await invoke('snapshot',{boardId:board.id,limit:500})).messages)===JSON.stringify(original));
  await app.evaluate(({shell})=>{global.__openedProviderSources=[];shell.openExternal=async url=>{global.__openedProviderSources.push(url);};});await control('source').click();
  check('Installation action opens the fixed official provider page',await app.evaluate(()=>global.__openedProviderSources.length===1&&global.__openedProviderSources[0]==='https://developers.openai.com/codex/cli/'));
  await app.evaluate(({dialog},executable)=>{for(const [key,value]of Object.entries(global.__agentEnvironment))value===undefined?delete process.env[key]:process.env[key]=value;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[executable]});},executable.command);
  await control('choose').click();await modal().getByText('Connection ready',{exact:true}).waitFor({timeout:20000});
  check('Choosing the real installed Codex executable repairs detection and verifies native sign-in',await modal().locator('[data-ac="result"]').textContent().then(text=>text.includes('signed in')&&text.includes(executable.command)));
  check('Repair never automatically resends the failed user turn',JSON.stringify((await invoke('snapshot',{boardId:board.id,limit:500})).messages)===JSON.stringify(original));
  const settings=JSON.parse(fs.readFileSync(path.join(temporary,'profile','studio','agents','provider-tools.json'),'utf8'));check('Machine-specific executable choice persists in the disposable app profile',settings.codex===fs.realpathSync(executable.command));
  await page.keyboard.press('Escape');await modal().waitFor({state:'detached'});check('Closing repair restores chat focus and unsent text',await chat.locator('textarea').inputValue()==='Unsent text must survive connection repair');
  // Inspect sign-in launch without opening a terminal or changing credentials.
  await app.evaluate(({ipcMain})=>{const original=ipcMain._invokeHandlers.get('studio:invoke');global.__forceSignIn=true;ipcMain._invokeHandlers.set('studio:invoke',async(event,domain,action,payload)=>{if(domain==='agents'&&action==='connection'&&global.__forceSignIn)return{provider:'codex',installed:true,ready:false,state:'sign-in-required',modelPromptSent:false,summary:'Controlled sign-in-required UI case.'};return original(event,domain,action,payload);});const cp=process.mainModule.require('node:child_process'),spawn=cp.spawn;global.__loginLaunches=[];cp.spawn=(command,args,options)=>{if(command.toLowerCase().endsWith('powershell.exe')){global.__loginLaunches.push({command,args,options});const child=new(process.mainModule.require('node:events').EventEmitter)();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;}return spawn(command,args,options);};});
  await page.locator('[data-agent-id="'+agent.id+'"] [data-ab-action="repair-connection"]').click();await page.waitForFunction(()=>document.querySelector('dialog.agent-connection-dialog')?.dataset.connectionState==='sign-in-required');await control('login').click();await modal().locator('[data-ac="notice"]').getByText(/official sign-in terminal is open/i).waitFor();
  check('Sign-in uses a visible native terminal with a fixed command and structured arguments',await app.evaluate(()=>{const r=global.__loginLaunches[0];return r&&r.options.windowsHide===false&&r.options.env.LVX_AGENT_LOGIN_EXE&&JSON.parse(r.options.env.LVX_AGENT_LOGIN_ARGS).at(-1)==='login'&&!r.args.join(' ').includes('--dangerously');}));
  await app.evaluate(()=>{global.__forceSignIn=false;});await control('recheck').click();await modal().getByText('Connection ready',{exact:true}).waitFor();await control('close').click();
  check('Connection recovery keeps the same board, native conversation generation and failed evidence',JSON.stringify((await invoke('snapshot',{boardId:board.id,limit:500})).messages)===JSON.stringify(original));
  const archive=await page.evaluate(()=>electronAPI.studioOps.invoke('workspace','backup'));check('Project exports do not contain machine-specific provider executable settings',!archive.payload.records.some(r=>JSON.stringify(r).includes(executable.command)));
  const shot='docs/screenshots/agent-connection-'+mode+'.png';await chat.locator('[data-ab-action="repair-connection"]').click();await modal().getByText('Connection ready',{exact:true}).waitFor();await page.screenshot({path:path.join(root,shot)});await control('close').click();
  check('No uncaught renderer exceptions',errors.length===0);assert.equal(sourceManifest().digest,source.digest);assert.equal(hash(fs.readFileSync(__filename)),scriptSha256);
  fs.writeFileSync(path.join(root,'docs/verification/agent-connection-'+mode+'.json'),JSON.stringify({status:'SUCCESS',sourceDigest:source.digest,scriptSha256,packageProof,checks,errors,screenshots:[{file:shot,sha256:hash(fs.readFileSync(path.join(root,shot)))}],limits:['Real Electron, native services, disposable process environment and app profile. Official installed CLI version/login status are checked without a model prompt. The sign-in-required case and terminal launch are intercepted QA controls; no user credential changes. Live send/resume is recorded separately.']},null,2)+'\n');
 }finally{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}assert.equal(path.dirname(temporary),os.tmpdir());fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:150});}
 if(packaged)await require('./agent-board-nexus-e2e.cjs').run({packaged:true});
 console.log('LVX_AGENT_CONNECTION_'+mode.toUpperCase()+'_VERIFIED');
}
module.exports={run};if(require.main===module)run(process.argv[2]||'source').catch(error=>{console.error(error);process.exitCode=1;});
