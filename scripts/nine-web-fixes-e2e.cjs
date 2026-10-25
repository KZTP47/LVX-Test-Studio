'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {_electron}=require('playwright');
const root=path.resolve(__dirname,'..'),evidence=path.join(root,'.unlazy/nine-user-fixes-20261025/web');
async function run(){
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-nine-web-')),appRoot=path.join(temporary,'app'),workspace=path.join(temporary,'workspace');fs.mkdirSync(appRoot);fs.mkdirSync(workspace);fs.mkdirSync(evidence,{recursive:true});
 // Build a private snapshot so parallel source work never modifies the shared UI bundle.
 const tracked=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
 for(const name of tracked){const from=path.join(root,name),to=path.join(appRoot,name);if(!fs.existsSync(from))continue;fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);}
 const dependencies=path.dirname(path.dirname(require.resolve('electron/package.json')));fs.symlinkSync(dependencies,path.join(appRoot,'node_modules'),'junction');
 require('./build-ui.cjs').buildUI({root:appRoot});
 let requests=0,assertionHits=0;
 const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.url==='/api/value'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({answer:'Real remote data'}));}
  if(req.url==='/assertion-hit'){assertionHits++;return res.end('ok');}
  if(req.url==='/login'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><title>Staging sign-in fixture</title><h1 id="auth">Guest</h1><button id="login">Sign in to fixture</button><script>document.querySelector("#auth").textContent=localStorage.getItem("login")||"Guest";document.querySelector("#login").onclick=()=>{localStorage.setItem("login","Signed in");document.querySelector("#auth").textContent="Signed in";}</script>');}
  if(req.url==='/app'){requests++;res.setHeader('Content-Type','text/html');return res.end('<!doctype html><title>Staging website fixture</title><h1 id="heading">Loading network data</h1><button id="action">Change page</button><p id="result">Idle</p><script>fetch("/api/value").then(r=>r.json()).then(x=>document.querySelector("#heading").textContent=x.answer);document.querySelector("#action").onclick=()=>{document.querySelector("#result").textContent="Actual website clicked";fetch("/assertion-hit")};</script>');}
  res.writeHead(404,{'Content-Type':'text/html'}).end('<h1>Fixture route not found</h1>');
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 const checks=[],errors=[];let app,page;
 function check(label,result){assert.ok(result,label);checks.push(label);console.log('PASS '+label);}
 try{
  const env={...process.env,LVX_TEST_USER_DATA:path.join(temporary,'profile'),LVX_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({...(process.env.LVX_NINE_EXECUTABLE?{executablePath:process.env.LVX_NINE_EXECUTABLE}:{args:[appRoot]}),cwd:temporary,env});page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await page.waitForFunction(()=>window.LVXStudioInitialized===true);
  await app.evaluate(({BrowserWindow,dialog},workspace)=>{const window=BrowserWindow.getAllWindows()[0];window.setContentSize(1600,1000);window.webContents.setBackgroundThrottling(false);window.showInactive();dialog.showOpenDialog=async()=>({canceled:false,filePaths:[workspace]});},workspace);
  await page.evaluate(async()=>{await electronAPI.studioOps.chooseWorkspace();await electronAPI.studioOps.invoke('security','trust',{trusted:true});await LVXApp.useStorage(LVXWorkspaceBridge.createBackend());openVisualWebTester();});
  check('Website URL is a visible choice without opening the dropdown',await page.getByRole('button',{name:'Website URL',exact:true}).isVisible());
  await page.getByRole('button',{name:'Website URL',exact:true}).click();check('URL panel explains staging, live and local addresses',await page.locator('#vwt-website-url').isVisible()&&await page.locator('#vwt-website-url-help').textContent().then(x=>x.includes('localhost:3000')));
  await page.locator('#vwt-website-url').fill(url+'/app');await page.getByRole('button',{name:'Use website',exact:true}).click();
  await page.waitForFunction(()=>!vwt_targetBusy&&document.querySelector('#vwt-source-status').textContent.includes('Website loaded:'));
  await page.frameLocator('#vwt-iframe').locator('#heading').getByText('Real remote data',{exact:true}).waitFor();
  check('Use website loads its true origin and executes scripts and fetch automatically',requests>0&&await page.locator('#vwt-source-status').textContent().then(x=>x.includes(url+'/app')));
  check('Snapshot keeps website scripts out of the app UI',await page.frameLocator('#vwt-iframe').locator('script').count()===0);
  const steps=[{name:'Wait For Element',params:{selector:'#heading',timeout:5000}},{name:'Element Should Contain',params:{selector:'#heading',text:'Real remote data'}},{name:'Click Element',params:{selector:'#action'}},{name:'Element Should Contain',params:{selector:'#result',text:'Actual website clicked'}}];
  await page.evaluate(steps=>{vwt_steps=steps;vwt_renderCanvas();},steps);await page.getByRole('button',{name:'Run Live Test',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#vwt-logs').value.includes('Test Run Finished Successfully'));
  check('Run Live Test clicks and checks the actual server page',assertionHits>0&&await page.frameLocator('#vwt-iframe').locator('#result').textContent()==='Actual website clicked');
  await page.getByRole('button',{name:'Save as Test Suite',exact:true}).click();await page.locator('#vwt-suite-name').fill('Staging URL saved by a real user');await page.locator('#vwt-suite-save-confirm').click();await page.waitForFunction(()=>LVXApp.getSuites().some(s=>s.name==='Staging URL saved by a real user'));
  const saved=await page.evaluate(()=>LVXApp.getSuites().find(s=>s.name==='Staging URL saved by a real user'));
  check('Save stores the URL and visual steps without source files',saved.website_target.url===url+'/app'&&JSON.parse(saved.vwt_steps_json).length===4&&!saved.website_target.files);
  await page.evaluate(saved=>openVisualWebTesterForEdit(saved),saved);await page.waitForFunction(()=>!vwt_targetBusy&&document.querySelector('#vwt-source-status').textContent.includes('Website loaded:'));
  check('Reopening restores Website URL mode and its address',await page.locator('#vwt-website-url').inputValue()===url+'/app'&&await page.getByRole('button',{name:'Website URL',exact:true}).getAttribute('aria-pressed')==='true');
  await page.evaluate(async suite=>{const storage=await LVXApp.getStorage();await storage.updateSuite(suite.id,{last_run_status:'ERROR'});vwt_openLiveRunner(suite);},saved);
  await page.waitForFunction(()=>[...activeTestRunners.values()].some(runner=>!runner.isExecuting&&runner.resultSaved));
  const persisted=await page.evaluate(async id=>(await(await LVXApp.getStorage()).getAllSuites()).find(suite=>suite.id===id),saved.id);
  check('Live runner replaces an old ERROR on the saved suite card with its actual SUCCESS, timestamp and log',persisted.last_run_status==='SUCCESS'&&Number.isFinite(Date.parse(persisted.last_run_time))&&persisted.last_run_log.includes('Test Run Finished Successfully'));
  await page.evaluate(()=>{for(const id of [...activeTestRunners.keys()])vwt_closeLiveRunner(id);});
  const result=await page.evaluate(suite=>vwt_executeSuite(suite),saved);check('The saved suite runs end to end again',result.status==='SUCCESS');
  const legacy={...saved,website_url:url+'/app'};delete legacy.website_target;
  check('Imported legacy website_url suites use the same working real URL',(await page.evaluate(suite=>vwt_executeSuite(suite),legacy)).status==='SUCCESS');
  const negative={...saved,vwt_steps_json:JSON.stringify([{name:'Element Should Contain',params:{selector:'#heading',text:'Never present'}}])};check('A wrong website expectation fails instead of reporting success',(await page.evaluate(suite=>vwt_executeSuite(suite),negative)).status==='FAILURE');
  await page.locator('#vwt-website-url').fill(url+'/login');await page.getByRole('button',{name:'Use website',exact:true}).click();await page.waitForFunction(()=>!vwt_targetBusy&&document.querySelector('#vwt-source-status').textContent.includes('Website loaded:'));
  await page.getByRole('button',{name:'Open website / sign in',exact:true}).click();
  const login=await app.waitForEvent('window',{predicate:window=>window!==page,timeout:5000}).catch(()=>app.windows().find(window=>window!==page&&window.url().includes('/login')));
  assert.ok(login,'Interactive website window is available');await login.getByRole('button',{name:'Sign in to fixture',exact:true}).click();
  await page.getByRole('button',{name:'Update preview after sign in',exact:true}).click();await page.frameLocator('#vwt-iframe').locator('#auth').getByText('Signed in',{exact:true}).waitFor();check('User sign-in in the real website updates the visible picker without resetting the session',true);
  await page.getByRole('button',{name:'Use website',exact:true}).click();await page.waitForFunction(()=>!vwt_targetBusy&&document.querySelector('#vwt-source-status').textContent.includes('Website loaded:'));await page.frameLocator('#vwt-iframe').locator('#auth').getByText('Signed in',{exact:true}).waitFor();check('Login survives reload inside its isolated workspace session',true);
  await page.locator('#vwt-website-url').fill('file:///C:/private.txt');await page.getByRole('button',{name:'Use website',exact:true}).click();check('Invalid schemes give a specific error without replacing the current target',await page.locator('#vwt-source-status').getAttribute('data-error')==='true'&&await page.evaluate(()=>vwt_target.url.endsWith('/login')));
  await page.locator('#vwt-website-url').fill('http://127.0.0.1:1/unavailable');await page.getByRole('button',{name:'Use website',exact:true}).click();await page.waitForFunction(()=>!vwt_targetBusy&&document.querySelector('#vwt-source-status').dataset.error==='true');check('Unreachable staging/local websites show recovery and clear the previous page',await page.locator('#vwt-source-status').textContent().then(x=>x.includes('Could not load')&&x.includes('local server'))&&await page.evaluate(()=>document.querySelector('#vwt-iframe').srcdoc===''));
  await page.locator('#vwt-website-url').fill(url+'/app');await page.getByRole('button',{name:'Use website',exact:true}).click();await page.waitForFunction(()=>!vwt_targetBusy&&document.querySelector('#vwt-source-status').textContent.includes('Website loaded:'));
  const capture=async name=>{const pixels=await app.evaluate(async({BrowserWindow})=>{const window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html'));return(await window.webContents.capturePage()).toPNG().toString('base64');});fs.writeFileSync(path.join(evidence,name),Buffer.from(pixels,'base64'));};
  await capture('website-url-desktop.png');
  await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html'));window.setContentSize(1600,1050);window.webContents.setZoomFactor(2);});await page.getByRole('button',{name:'Website URL',exact:true}).scrollIntoViewIfNeeded();
  check('Source buttons and URL field remain usable at 200% zoom',await page.locator('.vwt-source-choices').evaluate(el=>el.scrollWidth<=el.clientWidth+2)&&await page.locator('#vwt-website-url').isVisible());await capture('website-url-zoom.png');
  check('No uncaught application renderer errors',errors.length===0);
  fs.writeFileSync(path.join(evidence,'e2e.json'),JSON.stringify({status:'SUCCESS',checks,errors,scope:'Isolated Electron snapshot; real HTTP fixture, real network/scripts, UI save/reopen, runtime assertions, form sign-in; no external accounts or third-party staging modifications.'},null,2)+'\n');
 }finally{
  if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  // Only the just-created temporary snapshot is eligible for removal.
  assert.equal(path.dirname(temporary),os.tmpdir());assert.ok(path.basename(temporary).startsWith('lvx-nine-web-'));fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:150});
 }
 console.log('LVX_NINE_WEB_E2E_VERIFIED');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
