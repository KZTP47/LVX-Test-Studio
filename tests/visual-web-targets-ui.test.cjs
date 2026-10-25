'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../visual-web-tester.js'),'utf8');
function harness(){
  const nodes=new Map(),calls=[],saved=[],messages=[];
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.value='';this.style={};this.classList={add(){},remove(){},toggle(){}};this.attributes={};this.hidden=false;this.srcdoc='';}
    set id(value){this._id=value;nodes.set(value,this);}get id(){return this._id;}
    addEventListener(name,handler){this['on'+name]=handler;}focus(){}showModal(){this.open=true;}close(){const wasOpen=this.open;this.open=false;if(wasOpen)this.onclose?.();}
    appendChild(el){this.children.push(el);el.parentElement=this;return el;}replaceChildren(){this.children=[];}
    get options(){return this.children;}setAttribute(k,v){this.attributes[k]=v;}remove(){this.removed=true;}insertBefore(el){this.children.unshift(el);el.parentElement=this;}
    querySelectorAll(){return [];}querySelector(){return null;}click(){this.clicked=true;}
  }
  const ids=['vwt-source-kind','vwt-source-files','vwt-source-repository','vwt-source-url','vwt-source-status','vwt-files-preview','vwt-entry','vwt-project-server','vwt-server-script','vwt-refresh-source','vwt-stop-project','vwt-source-warnings','vwt-install-dependencies','vwt-repository-url','vwt-repository-ref','vwt-website-url','vwt-update-file','vwt-canvas','vwt-properties','vwt-toolbox','vwt-iframe','vwt-logs','visual-web-tester-modal'];
  ids.forEach(id=>nodes.set(id,new Element()));nodes.get('vwt-iframe').id='vwt-iframe';
  const document={addEventListener(){},getElementById:id=>nodes.get(id)||null,createElement:tag=>new Element(tag),body:new Element('body')};
  class FileReader{readAsText(file){this.onload({target:{result:file.content}});}readAsDataURL(file){this.onload({target:{result:`data:application/octet-stream;base64,${Buffer.from(file.content).toString('base64')}`}});}}
  let confirmations=true;
  const context=vm.createContext({console,URL,WeakMap,Map,Set,FileReader,Date,Promise,structuredClone,setTimeout:fn=>{fn();return 1;},clearTimeout(){},setInterval,clearInterval,document,showMessage:(...args)=>messages.push(args),prompt:()=> 'My website test',confirm:()=>confirmations,window:{LVXIcons:{svg:()=>''},showMessage:(...args)=>messages.push(args),electronAPI:{previewOps:{invoke:async(action,payload)=>{calls.push({action,payload});if(action==='open')return {id:'preview-'+calls.length,html:'<p>Loaded</p>',websiteTarget:!!payload.target};if(action==='step')return {html:'<p>Checked</p>',logs:['step passed']};return {}; }},studioOps:{choosePath:async()=>({cancelled:true})}},LVXApp:{getSuites:()=>[],getStorage:async()=>({saveSuite:async data=>{saved.push(data);return 'saved';}}),refreshSuites:async()=>{}}}});
  vm.runInContext(source,context);return {context,nodes,calls,saved,messages,run:code=>vm.runInContext(code,context),confirm:value=>{confirmations=value;}};
}
async function saveUi(h,name='My website test'){
  const pending=h.run('vwt_saveSuite()');for(let i=0;i<15;i++)await Promise.resolve();
  const dialog=h.nodes.get('vwt-suite-save-dialog');assert.ok(dialog?.open,'Actual save dialog must open');h.nodes.get('vwt-suite-name').value=name;h.nodes.get('vwt-suite-description').value='A real user description';dialog.children[0].onsubmit({preventDefault(){}});await pending;
}
test('files accumulate, replace by path, preserve nested modules and binary assets without implicit preview',async()=>{
  const h=harness();await h.run(`vwt_addFiles({files:[{name:'index.html',content:'<script type="module" src="scripts/main.mjs"></script>'},{name:'main.mjs',webkitRelativePath:'scripts/main.mjs',content:'import "./other.mjs"'},{name:'other.mjs',webkitRelativePath:'scripts/other.mjs',content:'export default 4'},{name:'photo.png',webkitRelativePath:'images/photo.png',content:'pixels'}],value:''})`);
  assert.equal(h.run('vwt_target.files.length'),4);assert.equal(h.run('vwt_target.entry'),'index.html');assert.equal(h.run('vwt_target.files[3].encoding'),'base64');assert.equal(h.calls.length,0);
  await h.run(`vwt_addFiles({files:[{name:'main.mjs',webkitRelativePath:'scripts/main.mjs',content:'updated'},{name:'second.html',content:'Second page'}],value:''})`);
  assert.equal(h.run('vwt_target.files.length'),5);assert.equal(h.run('vwt_target.files.find(file=>file.path==="scripts/main.mjs").content'),'updated');
  h.run(`vwt_setEntry('second.html');vwt_removeFile('index.html')`);assert.equal(h.run('vwt_target.entry'),'second.html');assert.equal(h.run('vwt_target.files.length'),4);
  await h.run('vwt_renderIframe()');assert.equal(h.calls[0].action,'open');assert.equal(h.calls[0].payload.target.entry,'second.html');assert.equal(h.calls[0].payload.target.files.length,4);
});
test('relative-path validation rejects traversal and keeps the existing file selection intact',async()=>{
  const h=harness();await h.run(`vwt_addFiles({files:[{name:'index.html',content:'safe'}],value:''})`);
  await h.run(`vwt_addFiles({files:[{name:'private.txt',webkitRelativePath:'../private.txt',content:'not admitted'}],value:''})`);
  assert.equal(h.run('vwt_target.files.length'),1);assert.match(h.nodes.get('vwt-source-status').textContent,/relative file path/);assert.equal(h.nodes.get('vwt-source-status').dataset.error,'true');
  h.run(`vwt_updateFile('index.html')`);assert.equal(h.nodes.get('vwt-update-file').clicked,true);h.nodes.get('vwt-update-file').files=[{name:'replacement.html',content:'new content'}];await h.nodes.get('vwt-update-file').onchange();assert.equal(h.run('vwt_target.files[0].path'),'index.html');assert.equal(h.run('vwt_target.files[0].content'),'new content');
});
test('folder cancellation preserves the source; repository/ref and refresh use guarded target operations',async()=>{
  const h=harness();await h.run(`vwt_addFiles({files:[{name:'index.html',content:'keep'}],value:''})`);await h.run('vwt_chooseProjectFolder()');assert.equal(h.run('vwt_target.files[0].content'),'keep');
  h.nodes.get('vwt-repository-url').value='https://example.com/team/site.git';h.nodes.get('vwt-repository-ref').value='staging';await h.run('vwt_loadRepository()');assert.equal(h.calls[0].action,'target:repository');assert.equal(h.calls[0].payload.ref,'staging');
  h.run(`vwt_target.source={id:'private-source'};`);await h.run('vwt_refreshSource()');assert.equal(h.calls[1].payload.sourceId,'private-source');
});
test('framework start requires explicit confirmation of the exact command and dependency installation',async()=>{
  const h=harness();h.run(`vwt_target={version:1,kind:'url',source:{id:'project'},project:{requiresServer:true,packageFingerprint:'reviewed-package',scripts:{dev:'vite --host 127.0.0.1'}}};vwt_renderTargetControls()`);h.nodes.get('vwt-server-script').value='dev';h.nodes.get('vwt-install-dependencies').checked=true;
  assert.equal(h.run('vwt_targetReady()'),false);await assert.rejects(h.run('vwt_renderIframe()'),/Start the project server/);
  assert.equal(h.calls[0].action,'target:status');h.calls.length=0;
  let prompt='';h.context.confirm=message=>{prompt=message;return false;};await h.run('vwt_startProject()');assert.equal(h.calls.length,0);assert.match(prompt,/vite --host 127\.0\.0\.1/);assert.match(prompt,/Download and install/);
  h.context.confirm=()=>true;await h.run('vwt_startProject()');assert.equal(h.calls[0].action,'target:start');assert.equal(h.calls[0].payload.install,true);assert.equal(h.calls[0].payload.script,'dev');
  assert.equal(h.calls[0].payload.expectedCommand,'vite --host 127.0.0.1');
  assert.equal(h.calls[0].payload.expectedFingerprint,'reviewed-package');
  h.run(`vwt_target.project={nativeFiles:true}`);assert.equal(h.run('vwt_targetReady()'),true);
});
test('website URL validation rejects credentials and non-web schemes without destroying a loaded website',async()=>{
  const h=harness();h.nodes.get('vwt-website-url').value='https://staging.example.com/orders';await h.run('vwt_loadWebsite()');assert.equal(h.run('vwt_target.url'),'https://staging.example.com/orders');
  for(const url of ['file:///private','javascript:alert(1)','https://user:secret@example.com']){h.nodes.get('vwt-website-url').value=url;await h.run('vwt_loadWebsite()');assert.equal(h.run('vwt_target.url'),'https://staging.example.com/orders');assert.equal(h.nodes.get('vwt-source-status').dataset.error,'true');}
});
test('saved visual suites preserve portable targets and execution prefers those over stale legacy fields',async()=>{
  const h=harness();await h.run(`vwt_addFiles({files:[{name:'index.html',content:'<p>Real</p>'},{name:'a.js',content:'first'},{name:'b.js',content:'second'}],value:''})`);h.run(`vwt_steps=[{name:'Element Should Contain',params:{selector:'p',text:'Real'}}]`);await saveUi(h);
  assert.equal(h.saved.length,1);assert.equal(h.saved[0].website_target.files.length,3);assert.equal(h.saved[0].website_method,'upload');
  h.context.suite={...h.saved[0],website_html_content:'stale legacy'};const result=await h.run('vwt_executeSuite(suite)');assert.equal(result.status,'SUCCESS');assert.equal(h.calls.find(c=>c.action==='open').payload.target.files.length,3);
  h.calls.length=0;h.context.suite={name:'Old suite',website_html_content:'<p>Old</p>',website_css_contents:[{name:'x.css',content:'p{color:red}'}],website_js_contents:[],vwt_steps_json:'[{"name":"Element Should Contain","params":{"selector":"p","text":"Old"}}]'};assert.equal((await h.run('vwt_executeSuite(suite)')).status,'SUCCESS');assert.match(h.calls[0].payload.html,/<p>Old<\/p>/);assert.match(h.calls[0].payload.html,/color:red/);assert.equal(h.calls[0].payload.target,undefined);
});
test('target snapshots allow passive web assets while every snapshot blocks scripts and native access',()=>{
  const h=harness(),legacy=h.run(`vwt_staticHTML('<p>Legacy</p>')`),target=h.run(`vwt_staticHTML('<p>Website</p>',true)`);
  assert.match(target,/script-src &#39;none&#39;/);assert.match(target,/frame-src &#39;none&#39;/);assert.match(target,/form-action &#39;none&#39;/);assert.match(target,/img-src data: blob: http: https:/);assert.doesNotMatch(legacy,/http: https:/);
});
test('switching source panels does not discard a loaded target and user file paths render as text',async()=>{
  const h=harness();await h.run(`vwt_addFiles({files:[{name:'index.html',content:'ok'},{name:'<img onerror=bad>.js',content:'ok'}],value:''})`);h.run(`vwt_setSourceMode('url')`);assert.equal(h.nodes.get('vwt-source-url').hidden,false);assert.equal(h.nodes.get('vwt-source-files').hidden,true);assert.equal(h.run('vwt_target.files.length'),2);
  const row=h.nodes.get('vwt-files-preview').children[2];assert.equal(row.children[0].textContent,'<img onerror=bad>.js');assert.equal(row.children[0].children.length,0);
});
test('changing sources and refresh protect local file edits while confirmed URL-to-files replacement works',async()=>{
  const h=harness();await h.run(`vwt_addFiles({files:[{name:'index.html',content:'edited'}],value:''})`);h.confirm(false);
  h.nodes.get('vwt-website-url').value='https://example.com';await h.run('vwt_loadWebsite()');assert.equal(h.run('vwt_target.kind'),'files');
  h.nodes.get('vwt-repository-url').value='https://example.com/site.git';await h.run('vwt_loadRepository()');assert.equal(h.calls.length,0);
  h.run(`vwt_target.source={id:'source'}`);await h.run('vwt_refreshSource()');assert.equal(h.calls.length,0);
  h.confirm(true);await h.run('vwt_loadWebsite()');assert.equal(h.run('vwt_target.kind'),'url');
  h.confirm(false);await h.run(`vwt_addFiles({files:[{name:'new.html',content:'new'}],value:''})`);assert.equal(h.run('vwt_target.kind'),'url');
  h.confirm(true);await h.run(`vwt_addFiles({files:[{name:'new.html',content:'new'}],value:''})`);assert.equal(h.run('vwt_target.kind'),'files');assert.equal(h.run('vwt_target.entry'),'new.html');
});
test('real-shaped project Start makes its source ready without persisting the temporary running URL',async()=>{
  const h=harness();h.run(`vwt_target={version:1,kind:'url',source:{id:'project'},project:{requiresServer:true,packageFingerprint:'reviewed-package',scripts:{dev:'vite'}}};vwt_renderTargetControls();vwt_steps=[{name:'Element Should Contain',params:{selector:'p',text:'Loaded'}}]`);h.nodes.get('vwt-server-script').value='dev';
  const original=h.context.window.electronAPI.previewOps.invoke;h.context.window.electronAPI.previewOps.invoke=async(action,payload)=>action==='target:start'?{target:JSON.parse(h.run('JSON.stringify(vwt_target)')),running:true,runningUrl:'http://127.0.0.1:45678'}:original(action,payload);
  await h.run('vwt_startProject()');assert.equal(h.run('vwt_targetReady()'),true);assert.equal(h.run('vwt_target.url'),undefined);
  await h.run('vwt_renderIframe()');assert.equal(h.calls.at(-1).action,'open');assert.equal(h.calls.at(-1).payload.target.source.id,'project');assert.equal(h.calls.at(-1).payload.target.url,undefined);
  await saveUi(h);assert.equal(h.saved.length,1);assert.equal(h.saved[0].website_target.source.id,'project');assert.equal(h.saved[0].website_target.url,undefined);assert.equal(h.saved[0].website_target.runningUrl,undefined);
});
test('Stop remains available during startup, reaches the backend and fences late Start readiness',async()=>{
  const h=harness();h.run(`vwt_target={version:1,kind:'url',source:{id:'project'},project:{requiresServer:true,packageFingerprint:'reviewed-package',scripts:{dev:'vite'}}};vwt_renderTargetControls()`);h.nodes.get('vwt-server-script').value='dev';
  let finishStart;h.context.window.electronAPI.previewOps.invoke=async(action,payload)=>{h.calls.push({action,payload});if(action==='target:start')return new Promise(resolve=>{finishStart=resolve;});return {target:JSON.parse(h.run('JSON.stringify(vwt_target)')),running:false};};
  const start=h.run('vwt_startProject()');assert.equal(h.run('vwt_targetBusy'),true);assert.equal(h.nodes.get('vwt-stop-project').disabled,false);
  await h.run('vwt_stopProject()');assert.equal(h.calls[1].action,'target:stop');assert.equal(h.run('vwt_targetReady()'),false);assert.equal(h.run('vwt_targetBusy'),false);
  finishStart({target:JSON.parse(h.run('JSON.stringify(vwt_target)')),running:true,runningUrl:'http://127.0.0.1:45678'});await start;
  assert.equal(h.run('vwt_targetReady()'),false);assert.match(h.nodes.get('vwt-source-status').textContent,/stopped/);
});
test('framework commands without a reviewed package fingerprint cannot start and receive refresh instructions',async()=>{
  const h=harness();h.run(`vwt_target={version:1,kind:'url',source:{id:'old-source'},project:{requiresServer:true,scripts:{dev:'vite'}}};vwt_renderTargetControls()`);h.nodes.get('vwt-server-script').value='dev';await h.run('vwt_startProject()');assert.equal(h.calls.length,0);assert.match(h.nodes.get('vwt-source-status').textContent,/Read folder \/ repository again/);
});
test('pending source operations fence URL switches and file mutations; reopening can query server status',async()=>{
  const h=harness();await h.run(`vwt_addFiles({files:[{name:'index.html',content:'keep'},{name:'other.html',content:'other'}],value:''})`);
  let finish;h.context.pending=new Promise(resolve=>{finish=resolve;});const pending=h.run('vwt_targetOperation(()=>pending)');h.nodes.get('vwt-website-url').value='https://example.com';await h.run('vwt_loadWebsite()');h.run(`vwt_removeFile('index.html');vwt_setEntry('other.html');vwt_renameFile('index.html')`);assert.equal(h.run('vwt_target.kind'),'files');assert.equal(h.run('vwt_target.files.length'),2);assert.equal(h.run('vwt_target.entry'),'index.html');finish({cancelled:true});await pending;
  h.run(`vwt_target={version:1,kind:'url',source:{id:'already-running'},project:{requiresServer:true,scripts:{dev:'vite'}}}`);const original=h.context.window.electronAPI.previewOps.invoke;h.context.window.electronAPI.previewOps.invoke=async(action,payload)=>{if(action==='target:status'){h.calls.push({action,payload});return {target:JSON.parse(h.run('JSON.stringify(vwt_target)')),running:true,runningUrl:'http://127.0.0.1:1234'};}return original(action,payload);};
  assert.equal(h.run('vwt_targetReady()'),false);await h.run('vwt_renderIframe()');assert.equal(h.run('vwt_targetReady()'),true);assert.deepEqual(h.calls.slice(-2).map(call=>call.action),['target:status','open']);assert.equal(h.run('vwt_target.url'),undefined);
});
test('opening an unready suite clears the previous snapshot and closes its interactive session immediately',async()=>{
  const h=harness();await h.run(`vwt_addFiles({files:[{name:'index.html',content:'Website A'}],value:''})`);await h.run('vwt_renderIframe()');assert.match(h.nodes.get('vwt-iframe').srcdoc,/Loaded/);
  const original=h.context.window.electronAPI.previewOps.invoke;h.context.window.electronAPI.previewOps.invoke=async(action,payload)=>action==='target:status'?{running:false}:original(action,payload);
  h.context.nextSuite={id:'b',name:'B unready',website_target:{version:1,kind:'url',source:{id:'unready'},project:{requiresServer:true,scripts:{dev:'vite'}}}};
  h.run('openVisualWebTesterForEdit(nextSuite)');assert.equal(h.nodes.get('vwt-iframe').srcdoc,'');assert.equal(h.run('vwt_remoteSessions.get(document.getElementById("vwt-iframe"))'),undefined);assert.ok(h.calls.some(call=>call.action==='close'));
  for(let i=0;i<12;i++)await Promise.resolve();assert.equal(h.nodes.get('vwt-iframe').srcdoc,'');assert.match(h.nodes.get('vwt-source-status').textContent,/Start the project server/);
});
test('a delayed previous preview cannot reappear after editing a blocked target',async()=>{
  const h=harness();await h.run(`vwt_addFiles({files:[{name:'index.html',content:'Website A'}],value:''})`);let finishOpen;
  h.context.window.electronAPI.previewOps.invoke=async(action,payload)=>{h.calls.push({action,payload});if(action==='open')return new Promise(resolve=>{finishOpen=resolve;});return {running:false};};
  const pending=h.run('vwt_renderIframe()');for(let i=0;i<8;i++)await Promise.resolve();assert.ok(finishOpen);
  h.context.nextSuite={id:'blocked',name:'Blocked',website_target:{version:1,kind:'url',source:{id:'missing'},project:{requiresServer:true,scripts:{dev:'vite'}}}};h.run('openVisualWebTesterForEdit(nextSuite)');finishOpen({id:'old-late-session',html:'<p>Wrong old website</p>',websiteTarget:true});await assert.rejects(pending,/Preview replaced/);
  assert.equal(h.nodes.get('vwt-iframe').srcdoc,'');assert.ok(h.calls.some(call=>call.action==='close'&&call.payload.id==='old-late-session'));
});
test('actual save dialog validates names, supports cancellation and prevents duplicate saves',async()=>{
  const h=harness();h.context.prompt=()=>{throw Error('Electron prompt is unsupported');};await h.run(`vwt_addFiles({files:[{name:'index.html',content:'ok'}],value:''})`);h.run(`vwt_steps=[{name:'Element Should Contain',params:{selector:'p',text:'ok'}}]`);
  const pending=h.run('vwt_saveSuite()');for(let i=0;i<12;i++)await Promise.resolve();await h.run('vwt_saveSuite()');const dialog=h.nodes.get('vwt-suite-save-dialog');assert.equal(dialog.open,true);h.nodes.get('vwt-suite-name').value='   ';dialog.children[0].onsubmit({preventDefault(){}});assert.equal(h.saved.length,0);assert.equal(dialog.open,true);h.nodes.get('vwt-suite-save-cancel').onclick();await pending;assert.equal(h.saved.length,0);
  await saveUi(h,'A clear test name');assert.equal(h.saved.length,1);assert.equal(h.saved[0].name,'A clear test name');assert.equal(h.saved[0].description,'A real user description');
});
test('file path changes use the accessible dialog and retain nested paths without Electron prompt',async()=>{
  const h=harness();h.context.prompt=()=>{throw Error('No native prompt');};await h.run(`vwt_addFiles({files:[{name:'index.html',content:'ok'},{name:'main.js',content:'script'}],value:''})`);const pending=h.run(`vwt_renameFile('main.js')`);h.nodes.get('vwt-file-path').value='scripts/main.js';h.nodes.get('vwt-file-path-dialog').children[0].onsubmit({preventDefault(){}});await pending;assert.equal(h.run('vwt_target.files[1].path'),'scripts/main.js');
});
test('Stop all is reachable without a selected source and cancels pending startup readiness',async()=>{
  const h=harness();h.confirm(false);await h.run('vwt_stopAllProjects()');assert.equal(h.calls.length,0);h.confirm(true);const original=h.context.window.electronAPI.previewOps.invoke;h.context.window.electronAPI.previewOps.invoke=async(action,payload)=>action==='target:stopAll'?(h.calls.push({action,payload}),{stopped:2}):original(action,payload);h.run(`vwt_sourceRuntime.set('old',{running:true})`);await h.run('vwt_stopAllProjects()');assert.equal(h.calls[0].action,'target:stopAll');assert.equal(h.run('vwt_sourceRuntime.size'),0);assert.match(h.nodes.get('vwt-source-status').textContent,/Stopped 2/);
  h.run(`vwt_target={version:1,kind:'url',source:{id:'starting'},project:{requiresServer:true,packageFingerprint:'reviewed',scripts:{dev:'vite'}}};vwt_renderTargetControls()`);h.nodes.get('vwt-server-script').value='dev';let finish;h.context.window.electronAPI.previewOps.invoke=async action=>action==='target:start'?new Promise(resolve=>{finish=resolve;}):{stopped:1};const start=h.run('vwt_startProject()');await h.run('vwt_stopAllProjects()');finish({target:JSON.parse(h.run('JSON.stringify(vwt_target)')),running:true,runningUrl:'http://127.0.0.1:1234'});await start;assert.equal(h.run('vwt_targetReady()'),false);assert.match(h.nodes.get('vwt-source-status').textContent,/Stopped 1/);
});
