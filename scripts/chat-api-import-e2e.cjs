'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {_electron}=require('playwright');
const root=path.resolve(__dirname,'..'),packaged=process.argv.includes('--packaged');
async function main(){
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-chat-api-import-')),workspace=path.join(temporary,'project'),output=path.join(root,'output/chat-api-import');fs.mkdirSync(workspace);fs.mkdirSync(output,{recursive:true});
 const requests=[],checks=[],errors=[];let app,page;
 const server=http.createServer(async(req,res)=>{const chunks=[];for await(const part of req)chunks.push(part);requests.push(JSON.parse(Buffer.concat(chunks)));res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'[LOCAL PROVIDER FIXTURE]\n\nMessage received with the repository board context.'}}]}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};
 const invoke=(domain,action,payload={})=>page.evaluate(({domain,action,payload})=>electronAPI.studioOps.invoke(domain,action,payload),{domain,action,payload:{...payload,workspaceRoot:workspace}});
 const shot=async name=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const pixels=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));fs.writeFileSync(path.join(output,name+(packaged?'-packaged':'-source')+'.png'),Buffer.from(pixels,'base64'));};
 try{
  if(packaged)require('./package-manifest.cjs').verifyPackage();
  const env={...process.env,LVX_TEST_USER_DATA:path.join(temporary,'profile'),LVX_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({...packaged?{executablePath:path.join(process.env.LVX_PACKAGE_DIR||path.join(root,'release/win-unpacked'),'LVX Test Studio.exe')}:{args:[root]},cwd:root,env});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setContentSize(1600,1100);win.webContents.setBackgroundThrottling(false);});await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>window.LVXStudioInitialized===true);
  await app.evaluate(({dialog},folder)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]}),workspace);
  await page.evaluate(async()=>{await electronAPI.studioOps.chooseWorkspace();await electronAPI.studioOps.invoke('security','trust',{trusted:true});await LVXApp.useStorage(LVXWorkspaceBridge.createBackend());});
  const board={schemaVersion:1,id:'legacy-picture-council',name:'Legacy picture council fixture',goal:'',mode:'manual',maxTurns:3,concurrency:1,nodes:['reviewer','unrelated'].map((id,index)=>({id,name:id,provider:'api',model:'fixture',apiConfig:{provider:'custom',customEndpoint:'http://127.0.0.1:'+server.address().port+'/chat',model:'fixture'},permission:'native',instructions:'',position:{x:50+index*260,y:50},appearance:{color:'#007b83',icon:'robot',avatar:'',zoom:1,hue:0}})),edges:[]};
  const saved=await invoke('agents','saveBoard',{board,expectedRevision:null});assert.ok(saved.record);
  const legacy=structuredClone(saved.record.value),bad='data:image/png;base64,SGVsbG8=';legacy.nodes[1].appearance.avatar=bad;
  await invoke('workspace','transact',{records:[{collection:'agent-boards',id:legacy.id,value:legacy,expectedRevision:saved.record.revision}]});
  await page.evaluate(()=>LVXStudio.open('githubActions'));await page.locator('[data-action="examples"]').click();await page.locator('.gw-lane').nth(2).waitFor();
  await page.locator('[name="gc-board"]').selectOption(legacy.id);await page.locator('[name="gc-agent"]').selectOption('reviewer');await page.locator('[data-gc="place"]').click();await page.locator('.gw-lane').first().scrollIntoViewIfNeeded();await page.locator('[data-gc-agent="reviewer"] [data-gc="settings"]').click();
  const chat=page.locator('[data-gc-chat="reviewer"]');await chat.locator('[name="color"]').fill('#226644');await chat.locator('[data-gc="save-profile"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-gc-chat="reviewer"] .gc-chat-notice')?.textContent.includes('invalid image data'));
  check('Reproduced the reported error with an unrelated legacy image during an explicit cosmetic save',await chat.locator('.gc-chat-notice').innerText().then(text=>text.includes('invalid image data')));
  const message='What can you tell me about these repos on this dashboard?';await chat.locator('[data-chat] [name="message"]').fill(message);await chat.locator('[data-chat] button[type="submit"]').click();await chat.locator('.lvx-chat-markdown').waitFor();
  check('Send succeeds after the cosmetic error and reaches the provider exactly once',requests.length===1);
  check('Exact pending user text and all board repositories reach the transport',requests[0].messages.at(-1).content.includes(message)&&['example/web-client','example/checkout-api','example/shared-tools'].every(name=>requests[0].messages.at(-1).content.includes(name)));
  check('Successful delivery clears the composer and displays the assistant reply',await chat.locator('[data-chat] [name="message"]').inputValue()===''&&(await chat.locator('.lvx-chat-markdown').innerText()).includes('Message received'));
  const canonical=(await invoke('agents','getBoard',{boardId:legacy.id})).record.value;
  check('Sending neither overwrites the canonical profile nor discards the cosmetic draft',canonical.nodes[0].appearance.color==='#007b83'&&canonical.nodes[1].appearance.avatar===bad&&await chat.locator('[name="color"]').inputValue()==='#226644');
  await chat.locator('[data-gc="maximize"]').click();await shot('send-after-picture-error');
  const history=await invoke('agents','snapshot',{boardId:legacy.id});check('Both the user message and completed reply are durable history',history.messages.some(row=>row.role==='user'&&row.text.includes(message))&&history.messages.some(row=>row.role==='assistant'&&row.state==='completed'));
  check('No renderer exceptions',errors.length===0);
  console.log('CHAT_API_IMPORT_E2E_PASSED '+checks.length+' checks '+(packaged?'packaged':'source'));
 }catch(error){if(page)await shot('failure').catch(()=>{});throw error;}
 finally{if(app)await app.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(output,'last-'+(packaged?'packaged':'source')+'.log'),checks.map(name=>'PASS '+name).join('\n')+'\n'+errors.join('\n'));}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
