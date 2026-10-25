'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('playwright');
const {root,sourceManifest,hash}=require('./source-manifest.cjs');
// axe leaves some layered gradients for manual review. Measure the retained
// glossy actions at every CSS stop as well, rather than trusting a midpoint.
function gradientScan(context){
 const parse=s=>(s.match(/[\d.]+/g)||[]).map(Number),mix=(fg,bg)=>fg.slice(0,3).map((c,i)=>c*(fg[3]??1)+bg[i]*(1-(fg[3]??1))),lum=v=>{const c=v.slice(0,3).map(c=>(c/=255)<=.04045?c/12.92:((c+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
 const ratio=(a,b)=>{const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 const results=[];
 const leaves=[],owner=context?document.querySelector(context):document.body,walker=document.createTreeWalker(owner,NodeFilter.SHOW_TEXT);let text;
 while(text=walker.nextNode())if(text.textContent.trim()&&!text.parentElement.closest('svg,script,style,.monaco-editor,[hidden],.hidden,button:disabled')&&text.parentElement.getClientRects().length&&getComputedStyle(text.parentElement).visibility!=='hidden')leaves.push({el:text.parentElement,text:text.textContent});
 for(const el of owner.querySelectorAll('input[placeholder],textarea[placeholder]'))if(!el.value&&el.getClientRects().length&&!el.disabled&&!el.closest('.monaco-editor'))leaves.push({el,text:'Placeholder: '+el.placeholder,placeholder:true});
 for(const {el,text,placeholder} of leaves){
  let node=el,layer=null;
  while(node){const c=getComputedStyle(node);if(c.backgroundImage.includes('gradient')){layer=node;break;}if((parse(c.backgroundColor)[3]??1)>0)break;node=node.parentElement;}
  if(!layer&&!placeholder)continue;
  const chain=[];for(node=layer||el;node;node=node.parentElement)chain.unshift(node);
  let backgrounds=[[255,255,255]];
  for(const node of chain){const c=getComputedStyle(node);backgrounds=backgrounds.map(b=>mix(parse(c.backgroundColor),b));const stops=c.backgroundImage.match(/rgba?\([^)]+\)/g);if(stops)backgrounds=backgrounds.flatMap(b=>stops.map(s=>mix(parse(s),b)));}
  const fg=parse(getComputedStyle(el,placeholder?'::placeholder':null).color),minimumRatio=Math.min(...backgrounds.map(b=>ratio(mix(fg,b),b)));
  results.push({target:el.id?'#'+el.id:el.className,text:text.trim().slice(0,90),minimumRatio});
 }
 return results;
}
async function run({packaged=false,baseline=false}={}){
 const source=sourceManifest(),testScriptSha256=hash(fs.readFileSync(__filename)),packageProof=packaged?require('./package-manifest.cjs').verifyPackage():null;
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-a11y-')),workspace=path.join(temp,'project');fs.mkdirSync(workspace);let app,page,mainWindow;const scans=[],checks=[],screenshots=[],errors=[];
 const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS',name);};
 const scan=async(name,context)=>{
  await page.waitForTimeout(150);
  if(!await page.evaluate(()=>!!window.axe))await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
  const result=await page.evaluate(async({context})=>{const r=await axe.run(context||document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']},resultTypes:['violations','incomplete']});return {violations:r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.map(n=>({target:n.target,html:n.html,summary:n.failureSummary}))})),incomplete:r.incomplete.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))};},{context});
  const gradients=await page.evaluate(gradientScan,context);const gradientFailures=gradients.filter(r=>r.minimumRatio<4.5);
  scans.push({name,...result,gradients,gradientFailures});console.log('SCAN',name,result.violations.map(v=>v.id+':'+v.nodes.length).join(', ')||'clear',gradientFailures.length?'gradient failures '+JSON.stringify(gradientFailures):'');
 };
 const shot=async name=>{const capture=await mainWindow.evaluate(async w=>({png:(await w.webContents.capturePage()).toPNG().toString('base64'),url:w.webContents.getURL(),windowId:w.id}));assert.equal(capture.url,page.url(),'Capture must belong to the Studio page, not a website preview');const bytes=Buffer.from(capture.png,'base64'),file='docs/screenshots/accessibility-'+name+(packaged?'-packaged':'')+'.png';fs.writeFileSync(path.join(root,file),bytes);screenshots.push({file,sha256:hash(bytes),url:capture.url,windowId:capture.windowId});};
 try{
  const env={...process.env,LVX_TEST_USER_DATA:path.join(temp,'profile'),LVX_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({...(packaged?{executablePath:path.join(root,'release/win-unpacked/LVX Test Studio.exe')}:{args:[root]}),cwd:os.tmpdir(),env});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  mainWindow=await app.browserWindow(page);await mainWindow.evaluate(w=>{w.setContentSize(1600,1000);w.webContents.setBackgroundThrottling(false);w.showInactive();});
  await page.waitForFunction(()=>window.LVXStudioInitialized===true);
  await app.evaluate(({dialog},workspace)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[workspace]});},workspace);
  await page.evaluate(async()=>{await electronAPI.studioOps.chooseWorkspace();await electronAPI.studioOps.invoke('security','trust',{trusted:true});await LVXApp.useStorage(LVXWorkspaceBridge.createBackend());LVXStudio.close();});
  await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
  const negative=await page.evaluate(async()=>{const f=document.createElement('section');f.id='a11y-negative-control';f.style.cssText='position:fixed;inset:10px auto auto 10px;background:white;color:#ddd;z-index:99999;padding:20px';f.innerHTML='<p>Unreadable control</p><input><button style="background:linear-gradient(white,#eee);color:#ddd">Unreadable gradient</button>';document.body.append(f);const r=await axe.run(f,{runOnly:['color-contrast','label']});f.remove();return r.violations.map(v=>v.id);});
  check('Audit detects deliberately unreadable text and unnamed input',negative.includes('color-contrast')&&negative.includes('label'));
  await page.evaluate(()=>{const f=document.createElement('div');f.id='gradient-negative';f.innerHTML='<button style="background:linear-gradient(white,#eee);color:#ddd">Unreadable gradient</button>';document.body.append(f);});
  const gradientNegative=await page.evaluate(gradientScan,'#gradient-negative');await page.evaluate(()=>document.getElementById('gradient-negative').remove());check('Custom contrast oracle detects a deliberately unreadable gradient',gradientNegative.some(r=>r.minimumRatio<4.5));
  page.on('dialog',dialog=>dialog.accept());
  for(const dark of [false,true]){
   if(await page.evaluate(()=>document.body.classList.contains('theme-dark'))!==dark)await page.locator('[data-theme-toggle]').click();const theme=dark?'dark':'light';
   await page.evaluate(()=>LVXStudio.close());await scan(theme+'/home');
   for(const route of ['start','build','runs','workflow','graph','data','machinaData','security','workspace','storage','team','readiness','agentBoard','agentProjects']){
    await page.evaluate(route=>LVXStudio.open(route),route);await page.locator('#studio-content').waitFor();await scan(theme+'/'+route);
    if(route==='start')await shot(theme+'-setup');
   }
   await page.evaluate(()=>LVXStudio.open('graph'));
   for(const type of ['security-scan','security-gate','git-repo','unit-test-runner','ai-unit-test','ai-log-summary','log-collector','start-runner','wait-delay','api-performance','api-contract','code-review','website-ux-auto-tester','push-deploy']){
    await page.evaluate(async type=>{const e=LVXStudio.graphEditor;let n=e.nodes.find(n=>n.type===type);if(!n){document.querySelector('.ve-palette-item[data-type="'+type+'"]').click();n=e.nodes.at(-1);}await e[e._getNodeConfigHandlerName(n)](n.id);},type);
    await page.locator('.mg-dialog').waitFor();await scan(theme+'/node/'+type,'.mg-dialog');
    await page.locator('.mg-dialog').getByRole('button',{name:/^Cancel$/i}).click();await page.locator('.mg-dialog').waitFor({state:'detached'});
    if(type==='git-repo'||type==='log-collector'){
     const launcher=page.locator('.ve-node[data-node-type="'+type+'"] .ve-node-config-btn');await launcher.focus();await page.keyboard.press('Enter');await page.locator('.mg-dialog').waitFor();
     const field=page.locator('.mg-dialog input:not([type=checkbox])').first();await field.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');check(theme+' '+type+' white field retains a strong keyboard focus ring',await field.evaluate(el=>getComputedStyle(el).outlineStyle!=='none'&&parseFloat(getComputedStyle(el).outlineWidth)>=3));
     await page.locator('.mg-dialog').evaluate(el=>[...el.querySelectorAll('button,input,select,textarea,summary')].filter(e=>!e.disabled&&e.getClientRects().length).at(-1).focus());await page.keyboard.press('Tab');check(theme+' '+type+' Tab stays within the node modal',await page.evaluate(()=>document.querySelector('.mg-dialog').contains(document.activeElement)));
     await page.keyboard.press('Escape');await page.locator('.mg-dialog').waitFor({state:'detached'});check(theme+' '+type+' Escape restores the graph launcher',await launcher.evaluate(el=>document.activeElement===el));
    }
   }
   const output=page.locator('.ve-node[data-node-type="security-scan"] .ve-output-port'),input=page.locator('.ve-node[data-node-type="security-gate"] .ve-input-port');await output.focus();await page.keyboard.press('Enter');await input.focus();await page.keyboard.press('Enter');check(theme+' graph connection can be created entirely by keyboard',await page.evaluate(()=>LVXStudio.graphEditor.edges.length===1));await scan(theme+'/graph-connected');
   await page.locator('g[role="button"][aria-label^="Delete connection"]').focus();await page.keyboard.press('Enter');check(theme+' graph connection can be removed entirely by keyboard',await page.evaluate(()=>LVXStudio.graphEditor.edges.length===0));
   await page.evaluate(()=>LVXStudio.open('agentBoard'));
   await page.locator('[data-ab-action="add"]').click();await page.locator('.ab-node').waitFor();
   await page.locator('.ab-node').first().focus();await page.keyboard.press('Enter');await page.locator('.ab-chat-window').waitFor();
   check(theme+' agent chat opens from the keyboard without nested button semantics',await page.locator('.ab-node').first().getAttribute('role')==='group');
   await scan(theme+'/agent-populated');await shot(theme+'-agents');
   await page.locator('[data-ab-action="save"]').click();await page.locator('.ab-save-dialog').waitFor();await scan(theme+'/board-save','.ab-save-dialog');await page.locator('.ab-save-dialog [data-save-cancel]').click();
   await page.locator('[data-ab-action="discard"]').click();
   if(await page.locator('[data-ab="confirm"]:not([hidden])').count())await page.locator('[data-ab="confirm"] button').first().click();
   await page.evaluate(()=>LVXStudio.close());
   await page.evaluate(()=>openAddSuiteModal());await page.waitForFunction(()=>!!currentMonacoEditor);await scan(theme+'/suite-editor','#suite-modal');
   await page.evaluate(()=>switchEditorTab('data'));await scan(theme+'/suite-editor/data','#suite-modal');
   await page.evaluate(()=>closeEditorModal());
   for(const [open,close,id]of [['openEnvironmentManager','closeEnvironmentManager','environment-manager-modal'],['openSettingsModal','closeSettingsModal','settings-modal'],['openExecutionSettingsModal','closeExecutionSettingsModal','execution-settings-modal'],['openIntegrationsModal','closeIntegrationsModal','integrations-modal'],['openCICDModal','closeCICDModal','cicd-modal'],['openSecurityModal','closeSecurityModal','security-modal'],['openCollaborationModal','closeCollaborationModal','collaboration-modal'],['openUnitTestingModal','closeUnitTestingModal','unit-testing-modal'],['openVisualWebTester','closeVisualWebTester','visual-web-tester-modal']]){
    await page.evaluate(open=>window[open](),open);await page.locator('#'+id).waitFor();await scan(theme+'/'+id,'#'+id);
    const tabs=await page.locator('#'+id+' button[onclick^="switch"]').evaluateAll(bs=>bs.map(b=>b.getAttribute('onclick')));
    for(const tab of tabs){await page.evaluate(tab=>Function(tab)(),tab);await scan(theme+'/'+id+'/'+tab,'#'+id);}
    if(id==='visual-web-tester-modal'){
     await page.locator('#vwt-project-files').setInputFiles({name:'index.html',mimeType:'text/html',buffer:Buffer.from('<button id="proof-button" onclick="document.querySelector(\'#proof-result\').textContent=\'Passed\'">Run fixture</button><p id="proof-result">Ready</p>')});await page.getByRole('button',{name:'Reload Preview',exact:true}).click();await page.frameLocator('#vwt-iframe').locator('#proof-button').waitFor();
     for(const step of ['Click Element','Element Should Contain']){await page.getByRole('button',{name:'Add '+step,exact:true}).focus();await page.keyboard.press('Enter');}
     check(theme+' visual test steps can be added without dragging',await page.evaluate(()=>vwt_steps.length===2));
     for(const [index,selector,text]of [[0,'#proof-button'],[1,'#proof-result','Passed']]){await page.locator('[data-vwt-edit="'+index+'"]').focus();await page.keyboard.press('Enter');await page.locator('#param-selector').fill(selector);if(text)await page.locator('#param-text').fill(text);}
     await page.locator('#vwt-debug-mode').check();await page.locator('[data-vwt-breakpoint="0"]').focus();await page.keyboard.press('Space');
     await page.getByRole('button',{name:'Move step 2 up',exact:true}).focus();await page.keyboard.press('Enter');check(theme+' moving steps keeps the breakpoint attached to its step',await page.evaluate(()=>vwt_steps[1].name==='Click Element'&&testDebugger.isAtBreakpoint(1)));
     await page.getByRole('button',{name:'Move step 1 down',exact:true}).focus();await page.keyboard.press('Enter');await scan(theme+'/visual-test-populated','#visual-web-tester-modal');await shot(theme+'-web-tester');
     // The actual dynamic picker is removed from the DOM when closed. It must
     // restore the parent dialog rather than leaving its stale trap active.
     await page.locator('[data-vwt-edit="0"]').focus();await page.keyboard.press('Enter');
     await page.evaluate(()=>{const picker=new ElementPicker('vwt-iframe');picker._showSelectorChoiceModal(document.querySelector('#vwt-iframe').contentDocument.querySelector('#proof-button'),[{selector:'#proof-button',specificity:'Unique ID',description:'The fixture button'}],()=>{},()=>{});});
     await scan(theme+'/selector-choices','#selector-choice-modal');await page.keyboard.press('Escape');await page.locator('#selector-choice-modal').waitFor({state:'detached'});await page.keyboard.press('Tab');check(theme+' removed selector modal does not trap subsequent Tab',await page.evaluate(()=>document.getElementById('visual-web-tester-modal').contains(document.activeElement)));
     await page.getByRole('button',{name:'Save as Test Suite',exact:true}).focus();await page.keyboard.press('Enter');await page.locator('#vwt-suite-save-dialog').waitFor();await scan(theme+'/visual-test-save','#vwt-suite-save-dialog');
     await page.keyboard.press('Tab');check(theme+' native save dialog Tab reaches Description',await page.evaluate(()=>document.activeElement.id==='vwt-suite-description'));await page.keyboard.press('Shift+Tab');check(theme+' native save dialog Shift+Tab returns to Test name',await page.evaluate(()=>document.activeElement.id==='vwt-suite-name'));await page.keyboard.press('Escape');await page.locator('#vwt-suite-save-dialog').waitFor({state:'detached'});check(theme+' cancelling native save preserves its parent test',await page.locator('#visual-web-tester-modal').isVisible()&&await page.evaluate(()=>vwt_steps.length===2));
     await page.getByRole('button',{name:'Path index.html',exact:true}).focus();await page.keyboard.press('Enter');await page.locator('#vwt-file-path-dialog').waitFor();await page.keyboard.press('Tab');check(theme+' native path dialog allows keyboard movement',await page.evaluate(()=>document.activeElement.id==='vwt-file-path-cancel'));await page.keyboard.press('Shift+Tab');check(theme+' native path dialog Shift+Tab returns to path',await page.evaluate(()=>document.activeElement.id==='vwt-file-path'));await page.keyboard.press('Escape');await page.locator('#vwt-file-path-dialog').waitFor({state:'detached'});
     await page.locator('#vwt-debug-mode').uncheck();await page.getByRole('button',{name:'Run Live Test',exact:true}).focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('#vwt-logs').value.includes('Test Run Finished Successfully'));check(theme+' test built with keyboard controls executes its real assertions',await page.frameLocator('#vwt-iframe').locator('#proof-result').textContent()==='Passed');
    }
    await page.evaluate(close=>window[close](),close);
   }
   await page.evaluate(()=>LVXStudio.open('readiness'));await page.locator('[data-action="setup-tool"]').first().click();await page.locator('.runtime-setup-dialog').waitFor();await scan(theme+'/runtime-setup','.runtime-setup-dialog');await page.locator('.runtime-setup-dialog [data-setup="close"]').click();
   await page.evaluate(()=>LVXStudio.close());await page.locator('button[onclick="openSettingsModal()"]').click();
   await page.waitForFunction(()=>document.querySelector('#settings-modal').contains(document.activeElement));
   await page.locator('#settings-modal').evaluate(el=>{const focus=[...el.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(e=>e.getClientRects().length);focus.at(-1).focus();});
   await page.keyboard.press('Tab');check(theme+' dialog Tab wraps and retains focus',await page.locator('#settings-modal').evaluate(el=>{const first=[...el.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].find(e=>e.getClientRects().length);return document.activeElement===first;}));
   await page.keyboard.press('Escape');check(theme+' Escape closes dialog and restores launcher focus',await page.evaluate(()=>document.getElementById('settings-modal').classList.contains('hidden')&&document.activeElement.matches('button[onclick="openSettingsModal()"]')));
   await page.evaluate(()=>LVXStudio.open('start'));
   await mainWindow.evaluate(w=>{w.setContentSize(1366,900);w.webContents.setZoomFactor(2);});
   await page.locator('[data-action="choose-folder"]').focus();await page.keyboard.press('Tab');
   check(theme+' keyboard focus has a visible ring at 200% zoom',await page.evaluate(()=>{const c=getComputedStyle(document.activeElement);return c.outlineStyle!=='none'&&parseFloat(c.outlineWidth)>=2;}));
   check(theme+' setup numbers do not overlap headings at 200% zoom',await page.locator('.studio-journey>li').evaluateAll(items=>items.every(li=>{const c=getComputedStyle(li,'::before'),r=li.querySelector('strong').getBoundingClientRect(),box=li.getBoundingClientRect();return r.left>=box.left+parseFloat(c.left)+parseFloat(c.width)+8&&r.right<=innerWidth+1;})));
   for(const action of ['choose-folder','trust','new-check']){const b=page.locator('[data-action="'+action+'"]');await b.scrollIntoViewIfNeeded();const r=await b.boundingBox();check(theme+' '+action+' remains reachable at 200% zoom',r&&r.x>=0&&r.y>=0&&r.x+r.width<=683+1&&r.y+r.height<=450+1);}
   await page.locator('.studio-journey').evaluate(el=>el.scrollIntoView({block:'start'}));await shot(theme+'-zoom');
   await mainWindow.evaluate(w=>{w.webContents.setZoomFactor(1);w.setContentSize(1600,1000);});
  }
  await page.emulateMedia({reducedMotion:'reduce'});check('Reduced motion stops spinner rotation while retaining its visible progress shape',await page.evaluate(()=>{const e=document.createElement('span');e.className='spinner';document.body.append(e);const c=getComputedStyle(e),ok=c.animationName==='none'&&parseFloat(c.borderTopWidth)>0;e.remove();return ok;}));
  await page.emulateMedia({forcedColors:'active'});await page.locator('[data-action="choose-folder"]').focus();await page.keyboard.press('Tab');check('Windows contrast-color emulation retains visible keyboard focus',await page.evaluate(()=>matchMedia('(forced-colors:active)').matches&&parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=3));await page.emulateMedia({forcedColors:'none',reducedMotion:'no-preference'});
  await page.reload();await page.waitForFunction(()=>window.LVXStudioInitialized===true);check('Dark appearance persists across app reload with a matching toggle state',await page.evaluate(()=>document.body.classList.contains('theme-dark')&&document.querySelector('[data-theme-toggle]').getAttribute('aria-pressed')==='true'));
  const violations=scans.flatMap(s=>s.violations.map(v=>({screen:s.name,...v})));
  const gradientFailures=scans.flatMap(s=>s.gradientFailures.map(v=>({screen:s.name,...v})));
  if(!baseline)check('No WCAG A/AA violations across audited native light/dark screens',violations.length===0);
  if(!baseline)check('Glossy action labels meet 4.5:1 at every gradient stop',gradientFailures.length===0);
  check('No uncaught renderer errors',errors.length===0);
  assert.equal(sourceManifest().digest,source.digest,'Application source changed during audit');assert.equal(hash(fs.readFileSync(__filename)),testScriptSha256,'Audit helper changed during execution');
  const report={date:new Date().toISOString(),status:violations.length||gradientFailures.length?'FINDINGS':'SUCCESS',sourceDigest:source.digest,testScriptSha256,packageProof,packaged,scans,checks,screenshots,errors,violations,gradientFailures};
  fs.writeFileSync(path.join(root,'docs/verification',baseline?'accessibility-baseline.json':packaged?'accessibility-packaged.json':'accessibility-source.json'),JSON.stringify(report,null,2));
  if(!baseline)console.log('LVX_ACCESSIBILITY_VERIFIED');return report;
 }finally{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}assert.equal(path.dirname(temp),os.tmpdir());assert.ok(path.basename(temp).startsWith('lvx-a11y-'));fs.rmSync(temp,{recursive:true,force:true,maxRetries:8,retryDelay:200});}
}
if(require.main===module)run({packaged:process.argv.includes('--packaged'),baseline:process.argv.includes('--baseline')}).catch(e=>{console.error(e);process.exitCode=1;});module.exports={run};
