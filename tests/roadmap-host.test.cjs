'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),http=require('node:http');
const {_electron}=require('playwright');
const root=path.resolve(__dirname,'..'),sha=value=>crypto.createHash('sha256').update(value).digest('hex'),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sources=['main.js','preload.js','protected-config.js','services/studio-host.cjs','services/protected-request.cjs','services/protocol-redaction.cjs','script.js','studio-storage.js','services/workspace/index.cjs','services/workspace/archive.cjs','services/workspace/store.cjs','services/execution/index.cjs','services/preview/index.cjs','services/security/index.js','assets/app-modules.js'];
const sourceManifest=()=>Object.fromEntries(sources.map(file=>[file,sha(fs.readFileSync(path.join(root,file)))])),before=sourceManifest(),evidence=[];
async function desktop(t){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-host-independent-')),a=path.join(folder,'workspace-a'),b=path.join(folder,'workspace-b');fs.mkdirSync(a);fs.mkdirSync(b);
 let app;t.after(async()=>{if(app){await app.evaluate(({app})=>app.quit()).catch(()=>{});await app.close().catch(()=>{});}assert.equal(path.dirname(folder),os.tmpdir());fs.rmSync(folder,{recursive:true,force:true,maxRetries:8,retryDelay:100});});
 app=await _electron.launch({args:[root],cwd:os.tmpdir(),env:{...process.env,LVX_TEST_USER_DATA:path.join(folder,'profile'),LVX_TEST_HIDDEN:'1'}});
 const page=await app.firstWindow();page.setDefaultTimeout(15000);await page.waitForFunction(()=>window.LVXStudioInitialized===true&&window.LVXCredentials);
 const invoke=(domain,action,payload={})=>page.evaluate(({domain,action,payload})=>electronAPI.studioOps.invoke(domain,action,payload),{domain,action,payload});
 async function select(workspace){await app.evaluate(({dialog},value)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[value]});},workspace);return page.evaluate(()=>electronAPI.studioOps.chooseWorkspace());}
 await select(a);await invoke('security','trust',{trusted:true});
 async function terminal(id){for(let count=0;count<300;count++){const run=await invoke('execution','getRun',{id});if(!['RUNNING','PENDING'].includes(run.status))return run;await pause(30);}throw Error('Native run did not terminate');}
 return{folder,a,b,app,page,invoke,select,terminal};
}
function scenario(name,body){test(name,async t=>{const start=Date.now();try{await body(t);evidence.push({name,status:'PASS',durationMs:Date.now()-start});}catch(error){evidence.push({name,status:'FAIL',durationMs:Date.now()-start,error:error.message});throw error;}});}
function archiveWith(base,records){const result=structuredClone(base);result.payload.records=records;result.payload.artifacts=[];result.manifest.records=records.length;result.manifest.artifacts=0;result.manifest.payloadChecksum=sha(JSON.stringify(result.payload));return result;}
const workflow=(code,extra={})=>({schemaVersion:1,nodes:[{id:'check',type:'script',data:{name:'Host proof',engine:'javascript',code,...extra}}],edges:[]});

scenario('HOST actual IPC rejects a foreign window and malformed payloads before capability dispatch',async t=>{
 const h=await desktop(t);await assert.rejects(h.invoke('workspace','transact',{records:[],unsupported:undefined}),/plain|undefined|serializ|data/i);
 const pending=h.app.waitForEvent('window');await h.app.evaluate(({BrowserWindow},preload)=>{const rogue=new BrowserWindow({show:false,webPreferences:{preload,contextIsolation:true,nodeIntegration:false}});rogue.loadURL('data:text/html,<h1>Foreign host boundary probe</h1>');},path.join(root,'preload.js'));
 const rogue=await pending;await rogue.waitForURL(/^data:text\/html/);await rogue.waitForLoadState('load');await rogue.waitForFunction(()=>document.querySelector('h1')?.textContent==='Foreign host boundary probe'&&!!window.electronAPI);
 await assert.rejects(rogue.evaluate(()=>electronAPI.studioOps.invoke('host','status')),/main LVX|limited|application/i);await rogue.close();
 const status=await h.invoke('host','status');assert.equal(status.workspaceRoot,h.a);
});

scenario('HOST real OS vault returns opaque refs, retains TOKEN schema and protocol status despite known-secret collisions',async t=>{
 const h=await desktop(t),status=await h.invoke('security','status');assert.equal(status.credentials.available,true,'A real OS credential backend is required for this desktop proof');
 const secret='quoted-"value\\path\nsecond-line',stored=await h.invoke('security','storeSecret',{label:'Disposable quoted value',value:secret});assert.match(stored.reference,/^secret:[a-f0-9-]{36}$/);
 const protectedValue=await h.page.evaluate(async value=>LVXCredentials.protect(value,'Desktop typed parameter'),{parameters:{TOKEN:secret},parameterSchema:{TOKEN:{secret:true}}});assert.equal(protectedValue.parameterSchema.TOKEN.secret,true);assert.match(protectedValue.parameters.TOKEN.secretRef,/^secret:[a-f0-9-]{36}$/);assert.equal(JSON.stringify(protectedValue).includes(secret),false);
 await h.invoke('security','storeSecret',{label:'Status collision',value:'SUCCESS'});await h.invoke('security','storeSecret',{label:'Engine collision',value:'javascript'});
 const run=await h.invoke('execution','start',{engine:'javascript',code:'console.log(parameters.TOKEN); artifacts.value=parameters.TOKEN; assert(parameters.TOKEN.length>1);',parameters:{TOKEN:{secretRef:stored.reference}},parameterSchema:{TOKEN:{secret:true}}});const done=await h.terminal(run.id);
 assert.equal(done.id,run.id);assert.equal(done.status,'SUCCESS');assert.equal(done.engine,'javascript');assert.equal(done.total,1);assert.equal(JSON.stringify(done).includes(secret),false);assert.match(done.stdout,/REDACTED/);
 const backup=await h.invoke('workspace','backup',{}),archived=backup.payload.records.find(record=>record.collection==='runs'&&record.id===run.id);assert.equal(archived.value.status,'SUCCESS');assert.equal(archived.value.engine,'javascript');assert.equal((await h.invoke('workspace','previewImport',{archive:backup})).valid,true);const row=await h.invoke('workspace','read',{collection:'runs',id:run.id});assert.equal(row.value.status,'SUCCESS');assert.equal(row.value.engine,'javascript');
 const files=[];function walk(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const p=path.join(folder,entry.name);if(entry.isDirectory())walk(p);else if(!entry.name.endsWith('.log'))files.push(p);}}walk(path.join(h.folder,'profile','studio'));for(const file of files)assert.equal(fs.readFileSync(file).includes(Buffer.from(secret)),false,'Plaintext credential on disk: '+path.basename(file));
});

scenario('HOST protected request resolves URL suffix, Bearer/header and quoted JSON only in main; Abort closes actual server stream',async t=>{
 const h=await desktop(t),seen=[];let aborted=false;
 const server=http.createServer(async(req,res)=>{if(req.url==='/base/slow'){res.writeHead(200,{'Content-Type':'text/plain'});res.write('waiting');res.on('close',()=>{aborted=true;});return;}let body='';for await(const chunk of req)body+=chunk;seen.push({url:req.url,authorization:req.headers.authorization,key:req.headers['x-api-key'],body:JSON.parse(body||'{}')});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({echo:JSON.parse(body||'{}')}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const base='http://127.0.0.1:'+server.address().port+'/base',value='transport-"quote\\path\nline',ref=(await h.invoke('security','storeSecret',{label:'Transport',value})).reference,urlRef=(await h.invoke('security','storeSecret',{label:'URL',value:base})).reference,headerValue='transport-header-token',headerRef=(await h.invoke('security','storeSecret',{label:'Header',value:headerValue})).reference;
 const result=await h.page.evaluate(async({ref,urlRef,headerRef})=>{const response=await LVXCredentials.request(urlRef+'/echo',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+headerRef,'X-API-Key':headerRef},body:JSON.stringify({nested:{value:ref}})});return{status:response.status,body:await response.json()};},{ref,urlRef,headerRef});
 assert.equal(result.status,200);assert.equal(seen[0].url,'/base/echo');assert.equal(seen[0].authorization,'Bearer '+headerValue);assert.equal(seen[0].key,headerValue);assert.equal(seen[0].body.nested.value,value);assert.equal(result.body.echo.nested.value,'[REDACTED]');
 const cancellation=await h.page.evaluate(async urlRef=>{const controller=new AbortController(),at=performance.now();setTimeout(()=>controller.abort(),120);try{await LVXCredentials.request(urlRef+'/slow',{signal:controller.signal});return{cancelled:false};}catch(error){return{cancelled:error.name==='AbortError',elapsed:performance.now()-at};}},urlRef);assert.equal(cancellation.cancelled,true);assert.ok(cancellation.elapsed<2000);for(let i=0;i<80&&!aborted;i++)await pause(25);assert.equal(aborted,true,'Main-process network stream must actually close');
});

scenario('HOST imported fixture setup and cleanup cannot run through direct start or workflow without content review',async t=>{
 const h=await desktop(t),fixture={id:'imported-fixture',version:1,name:'Imported fixture',engine:'javascript',setup:'fixture.imported=7;',cleanup:'console.log("fixture cleanup proof");'},w=workflow('assert(fixture.imported===7);',{fixtureId:fixture.id});
 const content={format:'lvx-workflow',schemaVersion:1,workflow:w,fixtures:[fixture]},bundle={...content,checksum:sha(JSON.stringify(content))};await h.invoke('execution','importWorkflow',{bundle,commit:true});
 const pending=await h.invoke('host','pendingImports');assert.ok(pending.length>=3);await assert.rejects(h.invoke('execution','start',{engine:'javascript',code:'assert(true);',fixtureId:fixture.id}),/imported|review|trust/i);await assert.rejects(h.invoke('execution','runWorkflow',{workflow:w}),/imported|review|trust/i);
 for(const item of pending)await h.invoke('host','trustImport',{hash:item.hash});const run=await h.invoke('execution','runWorkflow',{workflow:w});const done=await h.terminal(run.id);assert.equal(done.status,'SUCCESS');assert.match(done.results.check.stdout,/fixture cleanup proof/);
});

scenario('HOST imported legacy unit setup_code and teardown_code cannot bypass review through generated native wrapper',async t=>{
 const h=await desktop(t),definition={id:'legacy-import',name:'Imported legacy unit',test_framework:'custom',test_code:'assert(true);',setup_code:'console.log("unreviewed setup marker");',teardown_code:'console.log("unreviewed cleanup marker");'};
 const base=await h.invoke('workspace','backup',{}),archive=archiveWith(base,[{collection:'unit-tests',id:definition.id,value:definition}]),preview=await h.invoke('workspace','previewImport',{archive});assert.equal(preview.valid,true);await h.invoke('workspace','import',{archive,expectedWorkspaceRevision:preview.revision,mode:'merge'});
 // Trust only the assertion body. Setup/cleanup require their own retained-source review.
 const bodyHash=sha(definition.test_code),pending=await h.invoke('host','pendingImports');assert.ok(pending.some(item=>item.hash===bodyHash));await h.invoke('host','trustImport',{hash:bodyHash});
 await assert.rejects(h.invoke('host','checkImported',{definition}),/imported|review|trust/i);
 const result=await h.page.evaluate(definition=>executeJavaScriptUnitTest(definition),definition);assert.equal(result.status,'FAIL');assert.match(result.error,/imported|review|trust/i);assert.equal(result.run_id,undefined);
});

scenario('HOST invalid native PNG and runtime configuration archives are rejected before SQLite revision changes',async t=>{
 const h=await desktop(t),base=await h.invoke('workspace','backup',{}),initial=await h.invoke('workspace','status');
 const png=Buffer.alloc(33);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(13,8);png.write('IHDR',12);png.writeUInt32BE(1,16);png.writeUInt32BE(1,20);
 const baselines={schemaVersion:1,type:'lvx-native-baselines',workspaceBinding:sha(h.a),items:[{id:sha('invalid-png'),sha256:sha(png),bytes:png.length,image:png.toString('base64')}]};
 const configuration={format:'lvx-execution-configuration',schemaVersion:1,fixtures:[{id:'invalid',version:1,name:'Invalid engine',engine:'unsupported',setup:'',cleanup:''}],schedules:[]};
 for(const record of [{collection:'baselines',id:'native-preview',value:baselines},{collection:'execution-config',id:'native',value:configuration}]){
  const archive=archiveWith(base,[record,{collection:'checks',id:'must-not-commit',value:{name:'Negative archive sentinel'}}]);
  await assert.rejects(h.invoke('workspace','previewImport',{archive}),/PNG|baseline|configuration|engine/i);
  for(const action of ['import','recover'])await assert.rejects(h.invoke('workspace',action,{archive,mode:'merge',expectedWorkspaceRevision:initial.revision}),/PNG|baseline|configuration|engine/i);
  assert.equal((await h.invoke('workspace','status')).revision,initial.revision);assert.equal(await h.invoke('workspace','read',{collection:'checks',id:'must-not-commit'}),null);
 }
 const validPng=Buffer.from(await h.app.evaluate(({nativeImage})=>nativeImage.createFromBitmap(Buffer.from([0,0,255,255]),{width:1,height:1}).toPNG().toString('base64')),'base64');
 const validBaseline={schemaVersion:1,type:'lvx-native-baselines',workspaceBinding:sha(h.a),items:[{id:sha('valid-png'),sha256:sha(validPng),bytes:validPng.length,image:validPng.toString('base64')}]},validArchive=archiveWith(base,[{collection:'baselines',id:'native-preview',value:validBaseline}]);
 const positive=await h.invoke('workspace','previewImport',{archive:validArchive});assert.equal(positive.valid,true);await h.invoke('workspace','import',{archive:validArchive,mode:'merge',expectedWorkspaceRevision:positive.revision});
 const exported=await h.invoke('workspace','backup',{}),saved=exported.payload.records.find(record=>record.collection==='baselines'&&record.id==='native-preview');assert.equal(saved.value.items[0].sha256,sha(validPng));

});

scenario('HOST complete configuration backup restores immutable fixture versions and disables schedules in a second workspace',async t=>{
 const h=await desktop(t),first=await h.invoke('execution','saveFixture',{name:'First version',engine:'javascript',setup:'fixture.answer=4;',cleanup:'console.log("archive cleanup");'}),second=await h.invoke('execution','saveFixture',{id:first.id,name:'Second version',engine:'javascript',setup:'fixture.answer=5;',cleanup:'console.log("archive cleanup v2");'});
 const w=workflow('assert(fixture.answer===4);',{fixtureId:first.id,fixtureVersion:1});await h.invoke('execution','saveSchedule',{name:'Far future explicit schedule',workflow:w,enabled:true,intervalMs:60000,missedRun:'skip',nextRun:new Date(Date.now()+3600000).toISOString()});
 const archive=await h.invoke('workspace','backup',{}),configuration=archive.payload.records.find(record=>record.collection==='execution-config'&&record.id==='native');assert.ok(configuration);assert.equal(configuration.value.fixtures.length,2);assert.equal(configuration.value.schedules[0].enabled,true);
 await h.select(h.b);await h.invoke('security','trust',{trusted:true});const preview=await h.invoke('workspace','previewImport',{archive});assert.equal(preview.valid,true);await h.invoke('workspace','import',{archive,expectedWorkspaceRevision:preview.revision,mode:'merge'});
 const restored=await h.invoke('execution','exportConfiguration');assert.deepEqual(restored.fixtures.map(f=>[f.id,f.version]),[[first.id,1],[second.id,2]]);assert.equal(restored.schedules.length,1);assert.equal(restored.schedules[0].enabled,false);
 await assert.rejects(h.invoke('execution','runWorkflow',{workflow:w}),/imported|review|trust/i);for(const item of await h.invoke('host','pendingImports'))await h.invoke('host','trustImport',{hash:item.hash});const started=await h.invoke('execution','runWorkflow',{workflow:w});assert.equal((await h.terminal(started.id)).status,'SUCCESS');
});

scenario('HOST native configuration import retains unreviewed executable content fingerprints',async t=>{
 const h=await desktop(t),configuration={format:'lvx-execution-configuration',schemaVersion:1,fixtures:[{id:'direct-imported',version:1,name:'Direct imported config',engine:'javascript',setup:'fixture.directImport=23;',cleanup:'console.log("direct cleanup marker");'}],schedules:[]};
 await h.invoke('execution','importConfiguration',{configuration});
 await assert.rejects(h.invoke('execution','start',{engine:'javascript',code:'assert(true);',fixtureId:'direct-imported'}),/imported|review|trust/i);
});

scenario('HOST imported legacy commands and generated files require explicit content review in actual main IPC',async t=>{
 const h=await desktop(t),command='"'+process.execPath+'" -e "require(\'node:fs\').writeFileSync(\'reviewed-command.txt\',\'reviewed\')"',testCode='console.log("reviewed generated fixture");',generatedCode='console.log("separate AI-generated fixture");',file=path.join(h.a,'imported-test.js'),generatedFile=path.join(h.a,'generated-test.js');
 const base=await h.invoke('workspace','backup',{}),archive=archiveWith(base,[{collection:'pipelines',id:'imported-native',value:{nodes:[{id:'unit',type:'unit-test-runner',data:{command,testCode,generatedCode,testFilename:'imported-test.js'}}],edges:[]}}]);
 const preview=await h.invoke('workspace','previewImport',{archive});assert.equal(preview.valid,true);await h.invoke('workspace','import',{archive,mode:'merge',expectedWorkspaceRevision:preview.revision});
 await assert.rejects(h.page.evaluate(({cwd,command})=>electronAPI.sysOps.runCommand(cwd,command),{cwd:h.a,command}),/imported|review|trust/i);assert.equal(fs.existsSync(path.join(h.a,'reviewed-command.txt')),false);
 for(const [target,code]of [[file,testCode],[generatedFile,generatedCode]]){await assert.rejects(h.page.evaluate(({file,testCode})=>electronAPI.fileOps.writeFile(file,testCode),{file:target,testCode:code}),/imported|review|trust/i);assert.equal(fs.existsSync(target),false);}
 const pending=await h.invoke('host','pendingImports');for(const value of [command,testCode,generatedCode]){assert.ok(pending.some(item=>item.hash===sha(value)));await h.invoke('host','trustImport',{hash:sha(value)});}
 assert.equal((await h.page.evaluate(({file,testCode})=>electronAPI.fileOps.writeFile(file,testCode),{file,testCode})).success,true);
 const result=await h.page.evaluate(({cwd,command})=>electronAPI.sysOps.runCommand(cwd,command),{cwd:h.a,command});assert.equal(result.exitCode,0);assert.equal(fs.readFileSync(path.join(h.a,'reviewed-command.txt'),'utf8'),'reviewed');
});

scenario('HOST recovery retains unreviewed executable source fingerprints',async t=>{
 const h=await desktop(t);
 const base=await h.invoke('workspace','backup',{}),recovered={id:'recovered',name:'Recovered source',engine:'javascript',code:'assert(17===17);'},archive=archiveWith(base,[{collection:'checks',id:'recovered',value:recovered}]);
 await h.invoke('workspace','recover',{archive});
 await assert.rejects(h.invoke('execution','start',{engine:'javascript',code:recovered.code}),/imported|review|trust/i);
});

scenario('HOST terminal workflow mirrors SQLite child artifacts and stale workspace bindings cannot cross-read or cross-write',async t=>{
 const h=await desktop(t),w=workflow('console.log("durable host output"); artifacts.answer={value:42}; assert(true);'),started=await h.invoke('execution','runWorkflow',{workflow:w}),done=await h.terminal(started.id);assert.equal(done.status,'SUCCESS');const child=done.results.check.runId;
 const archive=await h.invoke('workspace','backup',{});assert.ok(archive.payload.records.some(record=>record.collection==='runs'&&record.id===started.id&&record.value.status==='SUCCESS'));assert.ok(archive.payload.records.some(record=>record.collection==='runs'&&record.id===child));const artifacts=await h.invoke('workspace','artifacts',{runId:child});assert.ok(artifacts.artifacts.some(artifact=>artifact.name==='output.log'));assert.ok(artifacts.artifacts.some(artifact=>artifact.name==='results.json'));const result=artifacts.artifacts.find(artifact=>artifact.name==='results.json'),contents=await h.invoke('workspace','readArtifact',{id:result.id});assert.equal(JSON.parse(Buffer.from(contents.dataBase64,'base64')).answer.value,42);
 await h.invoke('workspace','transact',{workspaceRoot:h.a,records:[{collection:'checks',id:'only-a',value:{name:'A'},expectedRevision:null}]});
 const blocking=await h.invoke('execution','start',{engine:'javascript',code:'while(true){}',timeoutMs:20000});await assert.rejects(h.select(h.b),/active|stop|run/i);assert.equal((await h.invoke('host','status')).workspaceRoot,h.a);await h.invoke('execution','cancel',{id:blocking.id});await h.terminal(blocking.id);await h.select(h.b);await h.invoke('security','trust',{trusted:true});
 assert.equal(await h.invoke('workspace','read',{collection:'checks',id:'only-a',workspaceRoot:h.b}),null);
 await assert.rejects(h.invoke('workspace','read',{collection:'checks',id:'only-a',workspaceRoot:h.a}),/workspace.*changed|reload/i);await assert.rejects(h.invoke('workspace','transact',{workspaceRoot:h.a,records:[{collection:'checks',id:'stale',value:{name:'Wrong workspace'},expectedRevision:null}]}),/workspace.*changed|reload/i);await assert.rejects(h.invoke('execution','getRun',{id:started.id}),/workspace|belong|found/i);
 assert.equal(await h.invoke('workspace','read',{collection:'checks',id:'stale',workspaceRoot:h.b}),null);await h.select(h.a);assert.equal((await h.invoke('workspace','read',{collection:'checks',id:'only-a',workspaceRoot:h.a})).value.name,'A');
});

scenario('HOST desktop storage guard and subsequent read stay bound when workspace switches between actual IPC replies',async t=>{
 const h=await desktop(t);await h.invoke('workspace','transact',{workspaceRoot:h.a,records:[{collection:'suites',id:'a-only',value:{name:'Private A suite'},expectedRevision:null}]});
 await h.select(h.b);await h.invoke('workspace','transact',{workspaceRoot:h.b,records:[{collection:'suites',id:'b-only',value:{name:'Private B suite'},expectedRevision:null}]});await h.select(h.a);
 await h.page.evaluate(async()=>{window.hostRace={delay:false,captured:false};const nativeInvoke=electronAPI.studioOps.invoke;window.hostRace.backend=LVXWorkspaceBridge.createBackend({onEvent:()=>()=>{},invoke:async(domain,action,payload)=>{const result=await nativeInvoke(domain,action,payload);if(action==='status'&&hostRace.delay){hostRace.delay=false;hostRace.captured=true;await new Promise(resolve=>hostRace.release=resolve);}return result;}});await hostRace.backend.initialize();hostRace.delay=true;hostRace.pending=hostRace.backend.getAllSuites().then(value=>({value}),error=>({error:error.message}));});
 await h.page.waitForFunction(()=>hostRace.captured);await h.select(h.b);await h.page.evaluate(()=>hostRace.release());const result=await h.page.evaluate(()=>hostRace.pending);assert.match(result.error||'',/workspace.*changed|reload|reopen/i);assert.equal(result.value,undefined,'A-bound editor must never receive B suites');
});

test.after(()=>{
 const after=sourceManifest(),drift=sources.filter(file=>before[file]!==after[file]);
 const report={schemaVersion:1,scope:'parent-desktop-host-regression',verifiedAt:new Date().toISOString(),selection:process.argv.slice(2),status:evidence.length===12&&evidence.every(item=>item.status==='PASS')&&!drift.length?'SELF_VERIFIED_AWAITING_PARENT':'FINDINGS_OR_SOURCE_DRIFT',sourceManifestBefore:before,sourceManifestAfter:after,testSourceSha256:sha(fs.readFileSync(__filename)),dependencyDrift:drift,review:{sourceEditsByReviewer:true,parentFollowup:true,passes:['Mapped host/preload/trust/redaction/archive/storage boundaries before writing real IPC controls.','Added actual OS credential, quoted request, import lifecycle, native decoder, configuration and terminal evidence positive/negative oracles.','Reproduced and reported legacy setup/cleanup trust bypass, direct configuration/recovery bypass, schedule portability failure, run metadata corruption and deterministic stale read race; parent corrected source.','Re-ran all12 on frozen dependencies after parent integration fixes; valid native PNG positive control, graceful desktop cleanup and immutable source checks included.'],resolvedFindings:['Legacy setup_code/teardown_code and JS fragments now participate in content review.','Direct native configuration import and recovery register untrusted executable sources before commit.','Portable config restores fixture versions and disables schedules without workspace identity conflicts.','Canonical run control metadata survives workspace/archive redaction.','Storage reads remain bound after workspace switch between IPC status and read replies.']},scenarios:evidence,counts:{tests:evidence.length,pass:evidence.filter(item=>item.status==='PASS').length,fail:evidence.filter(item=>item.status==='FAIL').length},boundary:'Actual full application Electron IPC, disposable OS-encrypted profile and workspace; loopback HTTP only. No injected safeStorage, real credentials, paid providers or real notifications.'};fs.writeFileSync(path.join(root,'docs/verification/roadmap-host.json'),JSON.stringify(report,null,2)+'\n');assert.deepEqual(drift,[],'Reviewed source changed during independent host verification');
});
