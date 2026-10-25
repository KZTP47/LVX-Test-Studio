'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../visual-web-tester.js'),'utf8');
function harness(){
 const nodes=new Map(),calls=[];
 class Element{
  constructor(){this.children=[];this.style={};this.dataset={};this.value='';this.classList={add(){},remove(){}};}
  appendChild(x){this.children.push(x);x.parentElement=this;return x;}replaceChildren(){this.children=[];}get options(){return this.children;}
  setAttribute(k,v){this[k]=v;}remove(){}insertBefore(x){this.children.unshift(x);x.parentElement=this;}addEventListener(){}querySelectorAll(){return [];}
 }
 for(const id of ['vwt-website-url','vwt-source-status','vwt-iframe','vwt-files-preview','vwt-entry','vwt-website-signin','vwt-website-refresh','vwt-source-kind','vwt-logs']){const el=new Element();el.id=id;nodes.set(id,el);}
 const choices=['files','url','repository'].map(mode=>{const el=new Element();el.dataset.vwtSource=mode;return el;});
 const document={getElementById:id=>nodes.get(id)||null,querySelectorAll:()=>choices,addEventListener(){},createElement:()=>new Element(),body:new Element()};
 const window={LVXIcons:{svg:()=>''},electronAPI:{previewOps:{invoke:async(action,payload)=>{calls.push({action,payload});if(action==='open')return {id:'fixture',url:payload.target.url,html:'<h1 id="result">Real remote page</h1>',websiteTarget:true};if(action==='snapshot')return {id:'fixture',url:'https://staging.example.invalid/account',html:'<h1>Signed in</h1>'};return {};}}}};
 const context=vm.createContext({URL,console,WeakMap,Map,Set,Date,Promise,document,window,confirm:()=>true,setTimeout,clearTimeout});vm.runInContext(code,context);
 return {run:text=>vm.runInContext(text,context),nodes,calls,window,choices};
}
test('URL source is visible without opening a dropdown and source buttons reflect selected mode',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');assert.match(html,/data-vwt-source="url"[^>]*>Website URL/);assert.match(html,/Staging, live or local website address/);
 const h=harness();h.run("vwt_setSourceMode('url')");assert.equal(h.choices[1]['aria-pressed'],'true');assert.equal(h.choices[0]['aria-pressed'],'false');
});
test('Use website actually opens the target immediately, and reports final real URL',async()=>{
 const h=harness();h.nodes.get('vwt-website-url').value='http://localhost:3000/app';await h.run('vwt_loadWebsite()');
 assert.equal(h.calls.filter(x=>x.action==='open').length,1);assert.equal(h.calls[0].payload.target.url,'http://localhost:3000/app');assert.match(h.nodes.get('vwt-iframe').srcdoc,/Real remote page/);assert.match(h.nodes.get('vwt-source-status').textContent,/Website loaded: http:\/\/localhost:3000\/app/);assert.equal(h.nodes.get('vwt-website-signin').disabled,false);
});
test('failed website load clears the prior snapshot and provides recovery without claiming success',async()=>{
 const h=harness();h.nodes.get('vwt-iframe').srcdoc='Old misleading page';h.nodes.get('vwt-website-url').value='https://staging.example.invalid/';h.window.electronAPI.previewOps.invoke=async()=>{throw Error('ERR_NAME_NOT_RESOLVED');};await h.run('vwt_loadWebsite()');
 assert.equal(h.nodes.get('vwt-iframe').srcdoc,'');assert.match(h.nodes.get('vwt-source-status').textContent,/Could not load.*ERR_NAME_NOT_RESOLVED.*VPN/);assert.equal(h.nodes.get('vwt-source-status').dataset.error,'true');assert.equal(h.nodes.get('vwt-website-signin').disabled,true);
});
test('website credentials/non-web schemes are rejected before any browser call and preserve the selected target',async()=>{
 const h=harness();h.run("vwt_target={version:1,kind:'url',url:'https://example.invalid/keep'}");for(const value of ['file:///private','javascript:alert(1)','https://private:password@example.invalid/','not a URL']){h.nodes.get('vwt-website-url').value=value;await h.run('vwt_loadWebsite()');assert.equal(h.calls.length,0);assert.equal(h.run('vwt_target.url'),'https://example.invalid/keep');assert.equal(h.nodes.get('vwt-source-status').dataset.error,'true');}
});
test('sign-in opens the real existing session and updates its snapshot without reopening or losing login state',async()=>{
 const h=harness();h.nodes.get('vwt-website-url').value='https://staging.example.invalid/';await h.run('vwt_loadWebsite()');await h.run('vwt_showWebsite()');await h.run('vwt_refreshWebsiteSnapshot()');assert.deepEqual(h.calls.map(x=>x.action),['open','show','snapshot']);assert.equal(h.calls[1].payload.id,h.calls[2].payload.id);assert.match(h.nodes.get('vwt-iframe').srcdoc,/Signed in/);assert.match(h.nodes.get('vwt-source-status').textContent,/account/);
});
test('legacy URL-based exported suites keep their real source and newer target takes precedence',()=>{
 const h=harness();const value=h.run("vwt_suiteSource({website_url:'https://staging.example.invalid/path',website_html_content:'old snapshot'})");assert.equal(value.kind,'url');assert.equal(value.url,'https://staging.example.invalid/path');assert.equal(h.run("vwt_suiteSource({website_url:'https://old.invalid/',website_target:{version:1,kind:'url',url:'https://new.invalid/'}}).url"),'https://new.invalid/');
});
test('empty file selection gives an instruction, never a loaded-preview claim',async()=>{
 const h=harness();await h.run('vwt_renderIframe()');assert.match(h.nodes.get('vwt-source-status').textContent,/No website selected yet/);assert.equal(h.calls.length,0);assert.equal(h.nodes.get('vwt-source-status').dataset.error,'true');
});
test('an in-flight URL load prevents target replacement and clears busy state after completion',async()=>{
 const h=harness();let finish;h.window.electronAPI.previewOps.invoke=async(action,payload)=>{h.calls.push({action,payload});if(action==='open')return new Promise(resolve=>{finish=resolve;});return {};};h.nodes.get('vwt-website-url').value='https://one.invalid/';const pending=h.run('vwt_loadWebsite()');for(let i=0;i<12;i++)await Promise.resolve();assert.equal(h.run('vwt_targetBusy'),true);h.nodes.get('vwt-website-url').value='https://two.invalid/';await h.run('vwt_loadWebsite()');assert.equal(h.run('vwt_target.url'),'https://one.invalid/');finish({id:'fixture',html:'<h1>one</h1>',url:'https://one.invalid/',websiteTarget:true});await pending;assert.equal(h.run('vwt_targetBusy'),false);
});

function runStorageHarness(){
 const h=harness(),suite={id:'saved-test',name:'Saved URL test',language:'website',website_method:'upload',website_url:'https://staging.example.invalid/',vwt_steps_json:JSON.stringify([{name:'Element Should Contain',params:{selector:'h1',text:'Real remote page'}}]),last_run_status:'ERROR'},writes=[],warnings=[];
 let record={id:suite.id,value:structuredClone(suite),revision:4};
 const backend={workspaceRoot:'fixture-workspace',guard:async()=>{},queue:operation=>operation(),suite:record=>structuredClone(record.value),transport:{call:async()=>record?structuredClone(record):null},commitUpdate:async(id,updates,original)=>{assert.equal(original.revision,record.revision,'immutable original revision must be used');writes.push(structuredClone(updates));record={...record,revision:record.revision+1,value:{...record.value,...updates}};}};
 let current=backend;h.window.LVXApp={getStorage:async()=>current,refreshSuites:async()=>{}};h.window.showMessage=(...args)=>warnings.push(args);
 h.run(`activeTestRunners.set('fixture-run',{suite:${JSON.stringify(suite)},steps:${suite.vwt_steps_json},log:[],iframe:document.createElement('iframe'),status:'IDLE',isExecuting:false})`);
 return {...h,suite,backend,writes,warnings,setCurrent:value=>{current=value;},setRecord:value=>{record=value;},record:()=>record,runner:()=>h.run("activeTestRunners.get('fixture-run')"),execute:()=>h.run("vwt_runLiveTestFromRunner('fixture-run')")};
}
test('live runner persists SUCCESS, assertion FAILURE and execution ERROR with real log and timestamp',async()=>{
 for(const [status,code] of [['SUCCESS',null],['FAILURE','ASSERTION_FAILED'],['ERROR','WEBSITE_CLOSED']]){
  const h=runStorageHarness(),original=h.window.electronAPI.previewOps.invoke;h.window.electronAPI.previewOps.invoke=async(action,payload)=>action==='step'&&code?{__lvxError:{code,message:'fixture '+code}}:original(action,payload);
  await h.execute();assert.equal(h.runner().status,status);assert.equal(h.writes.length,1);assert.equal(h.writes[0].last_run_status,status);assert.ok(Number.isFinite(Date.parse(h.writes[0].last_run_time)));assert.match(h.writes[0].last_run_log,status==='SUCCESS'?/Finished Successfully/:/fixture/);assert.equal(h.runner().resultSaved,true);assert.equal(h.warnings.length,0);
 }
});
test('a live run never saves into a different storage backend selected during execution',async()=>{
 const h=runStorageHarness(),original=h.window.electronAPI.previewOps.invoke;h.window.electronAPI.previewOps.invoke=async(action,payload)=>{if(action==='step')h.setCurrent({...h.backend});return original(action,payload);};await h.execute();assert.equal(h.runner().status,'SUCCESS');assert.equal(h.writes.length,0);assert.equal(h.runner().resultSaved,false);assert.match(h.runner().log.join('\n'),/Result not saved.*storage changed/);assert.equal(h.warnings.length,1);
});
test('changed or deleted saved suites remain untouched when their in-flight run completes',async()=>{
 for(const deleted of [false,true]){
  const h=runStorageHarness(),original=h.window.electronAPI.previewOps.invoke;h.window.electronAPI.previewOps.invoke=async(action,payload)=>{if(action==='step')h.setRecord(deleted?null:{...h.record(),revision:5,value:{...h.record().value,name:'New saved name'}});return original(action,payload);};await h.execute();assert.equal(h.runner().status,'SUCCESS');assert.equal(h.writes.length,0);assert.match(h.runner().log.join('\n'),deleted?/Result not saved.*deleted/:/Result not saved.*changed/);
 }
});
test('results from an outdated opened runner cannot update the already changed saved suite',async()=>{
 const h=runStorageHarness();h.setRecord({...h.record(),value:{...h.record().value,name:'Changed before the run'}});await h.execute();assert.equal(h.writes.length,0);assert.match(h.runner().log.join('\n'),/changed since the runner was opened/);
});
test('save failure is visible while retaining the actual execution outcome and unsaved log',async()=>{
 const h=runStorageHarness();h.backend.commitUpdate=async()=>{throw Error('Disk is full');};await h.execute();assert.equal(h.runner().status,'SUCCESS');assert.equal(h.runner().resultSaved,false);assert.equal(h.runner().isExecuting,false);assert.match(h.runner().log.join('\n'),/Result not saved. Disk is full/);assert.match(h.warnings[0][0],/Disk is full/);
});
test('a CAS conflict after the final read is surfaced instead of overwriting another update',async()=>{
 const h=runStorageHarness();h.backend.commitUpdate=async()=>{throw Error('Revision conflict');};await h.execute();assert.equal(h.runner().status,'SUCCESS');assert.equal(h.runner().resultSaved,false);assert.match(h.runner().log.join('\n'),/Result not saved. Revision conflict/);
});

test('changing the captured backend workspace binding also prevents any result write',async()=>{
 const h=runStorageHarness(),original=h.window.electronAPI.previewOps.invoke;h.window.electronAPI.previewOps.invoke=async(action,payload)=>{if(action==='step')h.backend.workspaceRoot='another-fixture-workspace';return original(action,payload);};await h.execute();assert.equal(h.writes.length,0);assert.match(h.runner().log.join('\n'),/Result not saved.*storage changed/);
});
test('a list-refresh error clearly distinguishes a committed result from an unsaved result',async()=>{
 const h=runStorageHarness();h.window.LVXApp.refreshSuites=async()=>{throw Error('View refresh unavailable');};await h.execute();assert.equal(h.writes.length,1);assert.equal(h.runner().resultSaved,true);assert.equal(h.runner().status,'SUCCESS');assert.match(h.warnings[0][0],/Result saved; list refresh failed/);
});
