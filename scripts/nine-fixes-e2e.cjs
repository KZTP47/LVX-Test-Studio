'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {_electron}=require('playwright'),{build}=require('./nine-showcase.cjs'),{sourceManifest,hash}=require('./source-manifest.cjs');
const root=path.resolve(__dirname,'..'),evidence=path.join(root,'output/nine-fixes');
async function run(mode='source'){
 const packaged=mode==='packaged',executable=packaged?(process.env.LVX_NINE_EXECUTABLE||path.join(root,'release/win-unpacked/LVX Test Studio.exe')):null,source=sourceManifest();
 if(packaged)require('./nine-package-verify.cjs').verify();
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-nine-integrated-')),workspace=path.join(temporary,'project');fs.mkdirSync(workspace);fs.mkdirSync(evidence,{recursive:true});const archive=build(),file=path.join(temporary,'ready.lvx.json');
 archive.payload.records.push({collection:'suites',id:'generated-browser-body',value:{name:'Generated async browser body',language:'playwright',code:"await page.goto('data:text/html,<title>Practice</title><h1>Loaded</h1>'); assert((await page.title())==='Practice'); artifacts.passed=true;"}});archive.manifest.records=archive.payload.records.length;archive.manifest.payloadChecksum=hash(JSON.stringify(archive.payload));fs.writeFileSync(file,JSON.stringify(archive));
 const checks=[],errors=[];let app,page;
 const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};
 try{
  const env={...process.env,LVX_TEST_USER_DATA:path.join(temporary,'profile'),LVX_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({...(packaged?{executablePath:executable}:{args:[root]}),cwd:temporary,env});page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));await page.waitForFunction(()=>window.LVXStudioInitialized===true);
  await app.evaluate(({BrowserWindow,dialog},folder)=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1600,1000);w.webContents.setBackgroundThrottling(false);w.showInactive();dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},workspace);
  await page.evaluate(async()=>{await electronAPI.studioOps.chooseWorkspace();await electronAPI.studioOps.invoke('security','trust',{trusted:true});await LVXApp.useStorage(LVXWorkspaceBridge.createBackend());});
  const op=(domain,action,payload={})=>page.evaluate(({domain,action,payload,workspace})=>electronAPI.studioOps.invoke(domain,action,{...payload,workspaceRoot:workspace}),{domain,action,payload,workspace});
  await op('workspace','transact',{records:[{collection:'checks',id:'existing-work',value:{name:'Keep my existing work',engine:'javascript',steps:[]},expectedRevision:null}]});
  await page.locator('#import-file-input').setInputFiles(file);await page.locator('[data-action="commit-import"]').waitFor();check('Preview happens before any project write',(await op('workspace','list',{collection:'suites'})).records.length===0);await page.locator('[data-action="commit-import"]').click();await page.waitForFunction(()=>document.querySelector('#studio-notice')?.textContent.includes('Project imported'));
  await page.locator('#studio-close').click();await page.waitForFunction(()=>document.querySelectorAll('.lvx-saved-workflow').length===3);
  check('All three imported graphs appear in the original sidebar',await page.locator('.lvx-saved-workflow').count()===3);check('Import preserves pre-existing work',!!await op('workspace','read',{collection:'checks',id:'existing-work'}));
  check('Create controls explain visual steps versus code suites',await page.locator('#lvx-test-choice-guide').innerText().then(t=>t.includes('without writing code')&&t.includes('test script')));check('Code suite editor supports JavaScript',await page.locator('#suite_language option[value="javascript"]').count()===1);
  await page.locator('[data-workflow-id="ready-typed-branches"]').getByRole('button',{name:'Open graph',exact:true}).click();await page.locator('.ve-node').first().waitFor();check('Sidebar opens the selected graph on the actual canvas',await page.locator('.ve-node').count()===4);await page.screenshot({path:path.join(evidence,'graph-'+mode+'.png')});
  await page.locator('#graph-library-close').click();
  const runCount=(await op('execution','runs')).length;
  await page.evaluate(()=>{window.__ninePendingRun=runTestSuite('ready-acceptance');});await page.locator('.lvx-import-review').waitFor();await page.locator('.lvx-import-review').getByRole('button',{name:'Cancel',exact:true}).click();const cancelled=await page.evaluate(()=>window.__ninePendingRun);check('Cancelling imported-code review starts no test',cancelled.status==='CANCELLED'&&(await op('execution','runs')).length===runCount);
  await page.evaluate(()=>{window.__ninePendingRun=runTestSuite('ready-acceptance');});await page.locator('.lvx-import-review').getByRole('button',{name:'Trust and continue',exact:true}).click();const completed=await page.evaluate(()=>window.__ninePendingRun);check('JavaScript suite Run now reaches a real successful native run',completed.status==='SUCCESS');
  await page.evaluate(()=>document.getElementById('run-modal').classList.add('hidden'));
  await page.evaluate(()=>{window.__ninePendingRun=runTestSuite('ready-browser');});await page.locator('.lvx-import-review').getByRole('button',{name:'Trust and continue',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#vwt-runner-logs')?.value.includes('Test Run Finished Successfully'));check('Imported website runs all visual steps against the real isolated page',await page.locator('#vwt-runner-logs').inputValue().then(value=>value.includes('497.20')||value.includes('Step 5/5')));await page.screenshot({path:path.join(evidence,'browser-'+mode+'.png')});
  await page.waitForFunction(()=>LVXApp.getSuites().find(s=>s.id==='ready-browser')?.last_run_status==='SUCCESS');
  check('Visual Runner saves its actual result back to the suite card',(await op('workspace','read',{collection:'suites',id:'ready-browser'})).value.last_run_status==='SUCCESS');
  await page.evaluate(()=>vwt_closeLiveRunner(true));
  await page.evaluate(async()=>{await LVXApp.refreshSuites();window.__ninePendingRun=runTestSuite('generated-browser-body');});
  await page.locator('.lvx-import-review').waitFor();await page.locator('.lvx-import-review').getByRole('button',{name:'Trust and continue',exact:true}).click();
  const generated=await page.evaluate(()=>window.__ninePendingRun);check('Generated async Playwright body runs from the suite list',generated.status==='SUCCESS');
  check('No renderer errors in integrated flows',errors.length===0);
 }catch(error){if(page){console.error('Integrated UI diagnosis',await page.evaluate(()=>({pipelineError:window.LVXPipelineLibraryError,count:document.querySelectorAll('.lvx-saved-workflow').length,notice:document.querySelector('#studio-notice')?.textContent,sidebar:document.querySelector('#pipelines-list')?.textContent})));await page.screenshot({path:path.join(evidence,'failure-'+mode+'.png')}).catch(()=>{});}throw error;}finally{await app?.close();}
 if(!process.env.LVX_NINE_FOUNDATION_ONLY){
  for(const [script,token]of [['nine-agent-fixes-e2e.cjs','LVX_NINE_AI_E2E_VERIFIED'],['nine-web-fixes-e2e.cjs','LVX_NINE_WEB_E2E_VERIFIED'],['nine-review-fixes-e2e.cjs','LVX_NINE_REVIEW_E2E_VERIFIED']]){
   const result=cp.spawnSync(process.execPath,[path.join(__dirname,script)],{cwd:root,env:{...process.env,...(executable?{LVX_NINE_EXECUTABLE:executable}:{})},encoding:'utf8',maxBuffer:8*1024*1024,timeout:240000,windowsHide:true});
   fs.writeFileSync(path.join(evidence,script+'.'+mode+'.log'),(result.stdout||'')+(result.stderr||''));assert.equal(result.status,0,script+' failed: '+result.stdout+result.stderr);assert.ok(result.stdout.includes(token));checks.push(script+' passed against '+mode);console.log('PASS '+script+' '+mode);
  }
 }
 assert.equal(sourceManifest().digest,source.digest,'Source changed during integrated verification');
 fs.writeFileSync(path.join(evidence,'integrated-'+mode+'.json'),JSON.stringify({status:'SUCCESS',mode,sourceDigest:source.digest,checks,errors,...(executable?{executableSha256:hash(fs.readFileSync(executable)),asarSha256:hash(fs.readFileSync(path.join(path.dirname(executable),'resources/app.asar')))}:{})},null,2)+'\n');
 console.log('LVX_NINE_'+mode.toUpperCase()+'_E2E_VERIFIED');return checks;
}
module.exports={run};if(require.main===module)run(process.argv[2]).catch(error=>{console.error(error);process.exitCode=1;});
