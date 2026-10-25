'use strict';
// Real Electron IPC/SQLite and HTTP transport. Local fixture, no live AI account.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {_electron}=require('playwright');
async function run({packagedPath=process.env.LVX_NINE_EXECUTABLE}={}) {
  const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-nine-ai-ui-')),workspace=path.join(temp,'workspace');fs.mkdirSync(workspace);
  const reports=path.join(root,'.unlazy/nine-user-fixes-20261025/ai');fs.mkdirSync(reports,{recursive:true});
  const bundle={format:'lvx-tests',records:[{collection:'suites',id:'generated-fixture-test',value:{name:'Agent generated arithmetic check',language:'javascript',code:'assert(2 + 2 === 4, "Arithmetic result"); console.log("GENERATED_TEST_RAN");'}}]};
  const answer='[LOCAL QA FIXTURE] Review this exported test:\n```json\n'+JSON.stringify(bundle,null,2)+'\n```';
  const requests=[],checks=[],errors=[];
  const server=http.createServer(async(req,res)=>{const parts=[];for await(const data of req)parts.push(data);const body=JSON.parse(Buffer.concat(parts));requests.push(body);await new Promise(r=>setTimeout(r,1800));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:requests.length===1?answer:'[LOCAL QA FIXTURE] I received the exported test from the other agent.'}}]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let app,page;
  const check=(name,condition)=>{assert.ok(condition,name);checks.push(name);console.log('PASS '+name);};
  const until=async(fn,label)=>{for(let i=0;i<250;i++){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,60));}throw Error('Timed out: '+label);};
  try {
    const env={...process.env,LVX_TEST_USER_DATA:path.join(temp,'profile'),LVX_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
    app=await _electron.launch({...(packagedPath?{executablePath:packagedPath}:{args:[root]}),cwd:os.tmpdir(),env});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
    await app.evaluate(({BrowserWindow,dialog},workspace)=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1500,1000);w.webContents.setBackgroundThrottling(false);w.showInactive();dialog.showOpenDialog=async()=>({canceled:false,filePaths:[workspace]});},workspace);
    await page.waitForFunction(()=>window.LVXStudioInitialized===true);
    await page.evaluate(async()=>{await electronAPI.studioOps.chooseWorkspace();await electronAPI.studioOps.invoke('security','trust',{trusted:true});await LVXApp.useStorage(LVXWorkspaceBridge.createBackend());});
    const invoke=(domain,action,payload={})=>page.evaluate(({domain,action,payload})=>electronAPI.studioOps.invoke(domain,action,payload),{domain,action,payload});
    const endpoint='http://127.0.0.1:'+server.address().port+'/chat';
    const node=(id,x)=>({id,name:'Fixture '+id,provider:'api',permission:'native',model:'fixture',apiConfig:{provider:'custom',model:'fixture',customEndpoint:endpoint},position:{x,y:30}});
    const board={schemaVersion:1,id:'nine-ai-board',name:'Nine fixes fixture',goal:'Collaborate',acceptanceCriteria:'Actual peer receipt',mode:'linked',maxTurns:2,concurrency:1,nodes:[node('a',35),node('b',500)],edges:[{id:'ab',source:'a',target:'b',enabled:true}],view:{zoom:1,panX:0,panY:0}};
    const saved=await invoke('agents','saveBoard',{board,expectedRevision:null});assert.ok(saved.record);
    await page.evaluate(()=>LVXStudio.open('agentBoard'));await page.locator('[name=saved-board]').selectOption(board.id);await page.locator('[data-ab-action=load]').click();
    for(const id of ['a','b'])await page.locator(`[data-agent-id=${id}] [data-ab-action=node-chat]`).click();
    const a=page.locator('[data-chat-agent=a]'),b=page.locator('[data-chat-agent=b]');
    await a.locator('textarea').fill('Draft A');await b.locator('textarea').fill('Draft B');const original=await a.boundingBox();
    await a.locator('[data-ab-action=chat-maximize]').click();
    check('Maximize covers the entire application content view, including board toolbars',await a.evaluate(el=>{const r=el.getBoundingClientRect();return r.left===0&&r.top===0&&Math.abs(r.width-innerWidth)<2&&Math.abs(r.height-innerHeight)<2;}));
    await a.locator('textarea').fill('Edited A');await page.keyboard.press('Escape');
    check('Escape restores original chat geometry, normal board location and independent drafts',await a.locator('textarea').inputValue()==='Edited A'&&await b.locator('textarea').inputValue()==='Draft B'&&(await a.boundingBox()).width===original.width&&await page.locator('.agent-board').evaluate(el=>el.parentElement!==document.body));
    await page.locator('[name=chat-routing]').selectOption('linked');await a.locator('textarea').fill('Generate and review an importable test together');await a.locator('button[type=submit]').click();
    await a.locator('.ab-window-activity').waitFor({state:'visible'});
    check('While the real API connection waits, chat shows activity and an elapsed timer',await a.locator('.ab-window-activity').textContent().then(t=>/Waiting for the API|working|Starting|Queued/.test(t)&&t.includes('elapsed')));
    await page.screenshot({path:path.join(reports,'waiting.png')});
    await until(async()=>{const s=await invoke('agents','snapshot',{boardId:board.id,limit:500});return s.runs.at(-1)?.status==='completed'?s:null;},'two actual agent turns');
    await until(()=>b.locator('.ab-window-messages').textContent().then(t=>t.includes('I received the exported test')),'second chat response');
    check('Collaborative Send makes two real local-provider requests and preserves original input',requests.length===2&&requests[0].messages.at(-1).content==='Generate and review an importable test together'&&requests[1].messages.at(-1).content.includes('[Peer message from a to b]'));
    const peerDetails=page.locator('.ab-collaboration > details');await peerDetails.evaluate(el=>el.open=true);
    check('Visible directed peer transcript identifies sender, recipient and actual forwarded body',await page.locator('[data-ab=peer-feed]').textContent().then(t=>t.includes('Fixture a → Fixture b')&&t.includes('Agent generated arithmetic check')));
    check('Both agent chats show the same delivered peer body',await a.locator('.ab-window-messages').textContent().then(t=>t.includes('Fixture a → Fixture b'))&&await b.locator('.ab-window-messages').textContent().then(t=>t.includes('Fixture a → Fixture b')));
    await a.locator('[data-ab-action=import-tests]').click();const dialog=page.locator('.ab-import-dialog');await dialog.waitFor();await dialog.locator('[name=ati-mode][value=library]').check();await dialog.locator('[data-import-preview] summary').first().waitFor();await dialog.locator('[data-import-preview] details').first().evaluate(el=>el.open=true);
    await until(()=>dialog.locator('[data-import-preview]').textContent().then(t=>t.includes('generated-fixture-test')),'review parsed reply');
    check('Agent reply can be reviewed as actual LVX source before anything is saved',await dialog.locator('[data-import-preview]').textContent().then(t=>t.includes('GENERATED_TEST_RAN'))&&(await invoke('workspace','list',{collection:'suites'})).records.length===0);
    check('Import requires an explicit source-review checkbox',await dialog.locator('[data-import-commit]').isDisabled());
    await dialog.locator('[data-import-reviewed]').check();await dialog.locator('[data-import-commit]').click();await dialog.getByRole('heading',{name:'Your tests are ready'}).waitFor();await dialog.getByRole('button',{name:'Done',exact:true}).click();await dialog.waitFor({state:'detached'});
    const record=await invoke('workspace','read',{collection:'suites',id:'generated-fixture-test'});check('Reviewed import persists a genuine suite in SQLite',record?.value.name==='Agent generated arithmetic check');
    check('Import does not run executable content',(await invoke('execution','runs')).length===0);
    await a.locator('[data-ab-action=import-tests]').click();const folderDialog=page.locator('.ab-import-dialog');
    const exported=path.join(temp,'exports');fs.mkdirSync(exported);fs.writeFileSync(path.join(exported,'package.json'),'{"name":"not-an-export"}');
    const nextBundle=JSON.parse(JSON.stringify(bundle));nextBundle.records[0].id='folder-chosen-test';
    fs.writeFileSync(path.join(exported,'chosen.lvx.json'),JSON.stringify(nextBundle));fs.writeFileSync(path.join(exported,'other.lvx.json'),JSON.stringify(bundle));
    await folderDialog.locator('[data-import-folder]').evaluate(el=>el.closest('details').open=true);await folderDialog.locator('[data-import-folder]').setInputFiles(exported);
    check('Folder import lists exported test files individually and excludes package metadata',await folderDialog.locator('[data-import-candidates]>button').count()===2&&!await folderDialog.locator('[data-import-preview]').textContent().then(t=>t.includes('package.json')));
    await folderDialog.locator('[data-import-candidates]>button').filter({hasText:'chosen.lvx.json'}).click();
    await folderDialog.locator('[data-import-preview] summary').first().waitFor();await folderDialog.locator('[data-import-preview] details').first().evaluate(el=>el.open=true);await until(()=>folderDialog.locator('[data-import-preview]').textContent().then(t=>t.includes('folder-chosen-test')),'chosen folder export preview');
    await folderDialog.locator('[data-import-close]').click();check('Cancelling folder import leaves all saved tests unchanged',(await invoke('workspace','list',{collection:'suites'})).records.length===1);

    const started=await invoke('execution','start',{name:record.value.name,engine:'javascript',code:record.value.code});assert.ok(started.id,JSON.stringify(started));
    const completed=await until(async()=>{const r=await invoke('execution','getRun',{id:started.id});return !['RUNNING','PENDING'].includes(r.status)?r:null;},'imported test execution');
    check('The imported test runs successfully through the real native test engine',completed.status==='SUCCESS');
    await page.screenshot({path:path.join(reports,'peer-and-import.png')});
    check('Renderer has no uncaught exceptions',errors.length===0);
    const report={status:'SUCCESS',date:new Date().toISOString(),checks,errors,requests:requests.length,providerEvidence:'Electron main-process API transport and SQLite against a deterministic local HTTP fixture. Native incremental protocol has its own real-child-process unit control. No live AI-account validation.'};fs.writeFileSync(path.join(reports,'e2e.json'),JSON.stringify(report,null,2));console.log('LVX_NINE_AI_E2E_VERIFIED');return report;
  } catch(error){if(page){console.error(await page.locator('[data-ab=notice]').textContent().catch(()=>''),errors);await page.screenshot({path:path.join(reports,'failure.png')}).catch(()=>{});}throw error;}
  finally {if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}await new Promise(r=>server.close(r));assert.equal(path.dirname(temp),os.tmpdir());fs.rmSync(temp,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});module.exports={run};
