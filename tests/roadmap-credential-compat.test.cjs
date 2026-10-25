'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const {protectedRequest}=require('../services/protected-request.cjs');
function harness(files,{rejectStore=false,execution=null,security=null,workspace=null}={}){
    const data=new Map(),nodes=new Map(),messages=[],vault=new Map(),requests=[],events=new Map();
    const element=()=>({value:'',checked:false,disabled:false,innerHTML:'',textContent:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}},addEventListener(){},querySelectorAll(){return[];},querySelector(){return element();},appendChild(){},removeChild(){},remove(){},click(){}});
    const document={readyState:'loading',addEventListener(){},querySelectorAll(){return[];},querySelector(){return null;},getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},createElement:element,body:element()};
    const redact=value=>{let text=typeof value==='string'?value:JSON.stringify(value);for(const secret of vault.values())text=text.split(secret).join('[REDACTED]');return typeof value==='string'?text:JSON.parse(text);};
    const context={document,crypto:crypto.webcrypto,console:{log(){},warn(){},error(){}},setTimeout,clearTimeout,setInterval,clearInterval,performance,Blob,URL,Headers,Response,AbortController,DOMException,Date,Math,Promise,structuredClone,escapeHtml:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;'),confirm:()=>true,alert(){},navigator:{clipboard:{writeText:async()=>{}}},showMessage:(text,type)=>messages.push({text,type}),localStorage:{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key),key:index=>[...data.keys()][index],get length(){return data.size;}},addEventListener:(name,fn)=>{if(!events.has(name))events.set(name,[]);events.get(name).push(fn);},dispatchEvent:event=>{for(const fn of events.get(event.type)||[])fn(event);},fetch:async()=>{throw new Error('Protected credentials must never use renderer fetch.');}};
    context.window=context;
    context.electronAPI={studioOps:{invoke:async(domain,action,payload)=>{
        if(domain==='host'&&action==='checkImported')return {allowed:true};
        if(domain==='security'&&action==='storeSecret'){if(rejectStore)throw new Error('OS store unavailable');if(security)return security.redact(await security.handle(action,structuredClone(payload)));await sleep(2);const reference='secret:'+crypto.randomUUID();vault.set(reference,payload.value);return{reference};}
        if(domain==='host'&&action==='request'){requests.push(structuredClone(payload));return protectedRequest(payload,{resolveSecret:ref=>{if(!vault.has(ref))throw new Error('Unknown credential');return vault.get(ref);},redact});}
        if(domain==='execution'&&execution)return execution.handle(action,payload);
        if(domain==='workspace'&&workspace)return workspace.handle(action,structuredClone(payload));
        throw new Error(`Unexpected ${domain}/${action}`);
    }}};
    vm.createContext(context);for(const file of ['protected-config.js',...files])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
    return{context,data,nodes,messages,vault,requests,run:code=>vm.runInContext(code,context)};
}
test('COMPAT config writes retain metadata while replacing credentials and webhook URLs with OS references',async()=>{
    const h=harness(['integrations.js','cicd-integration.js','collaboration.js','environment-manager.js','graph-engine.js','pipeline-manager.js','unit-testing.js']);
    await h.context.integrationsManager.saveIntegration({id:'notice',name:'Local only',type:'webhook',webhookUrl:'http://127.0.0.1:1/private-webhook',apiToken:'notification-private-token'});
    await h.context.cicdConfiguration.saveBackendConfig({backendUrl:'http://127.0.0.1:1',apiKey:'private-ci-credential',description:'Retain description'});
    await h.context.collaborationManager.saveBackendConfig({backendUrl:'http://127.0.0.1:1',apiKey:'private-sharing-credential'});
    await h.context.environmentManager.saveEnvironment({id:'secrets',name:'Environment',variables:{PASSWORD:'private-env-password',CUSTOM:{value:'explicit-env-private-value',secret:true},TIMEOUT:0}});
    h.run('pipelines=[{id:"p",name:"Preserve graph",nodes:[{id:"ai",data:{apiKey:"pipeline-private-key",auth:"pipeline-private-auth"}}],edges:[]}];');await h.context.savePipelines();
    await h.context.saveUnitTest({id:'unit',name:'Unit',test_framework:'custom',test_code:'assert(true);',parameters:{apiKey:'unit-private-key'}});
    const persisted=JSON.stringify([...h.data.values()]);for(const raw of ['private-webhook','notification-private-token','private-ci-credential','private-sharing-credential','private-env-password','explicit-env-private-value','pipeline-private-key','pipeline-private-auth','unit-private-key'])assert.equal(persisted.includes(raw),false,raw);
    assert.ok(persisted.includes('secret:'));assert.equal(JSON.parse(h.data.get('cicd_backend_config')).description,'Retain description');assert.equal(JSON.parse(h.data.get('lvx_pipelines'))[0].nodes[0].id,'ai');
    const env=h.context.environmentManager.getEnvironment('secrets');assert.equal(env.variables.TIMEOUT,0);assert.throws(()=>h.context.environmentManager.replaceEnvironmentVariables('${env.CUSTOM}','secrets'),/credential parameter/);const bindings=h.context.environmentManager.getExecutionParameters('secrets');assert.match(bindings.parameters.CUSTOM.secretRef,/^secret:/);assert.equal(bindings.parameterSchema.CUSTOM.secret,true);assert.equal(bindings.parameters.TIMEOUT,0);
});
test('COMPAT rejected OS storage prevents plaintext persistence and success UI before secure commit',async()=>{
    const h=harness(['cicd-integration.js','collaboration.js','collaboration-ui.js'],{rejectStore:true});
    await assert.rejects(Promise.resolve(h.context.cicdConfiguration.saveBackendConfig({backendUrl:'http://127.0.0.1:1',apiKey:'must-never-persist'})),/OS store/);assert.equal(h.data.has('cicd_backend_config'),false);
    h.nodes.set('sharing-backend-url',{value:'http://127.0.0.1:1'});h.nodes.set('sharing-api-key',{value:'sharing-secret-not-persisted'});
    await h.context.saveSharingBackendConfig({preventDefault(){}});assert.equal(h.data.has('sharing_backend_config'),false);assert.equal(h.messages.some(m=>m.type==='success'),false);assert.ok(h.messages.some(m=>m.type==='error'));
});
test('COMPAT concurrent protected pipeline/unit writes do not lose edits; migrations reload cached records',async()=>{
    const h=harness(['graph-engine.js','pipeline-manager.js','unit-testing.js']);
    h.run('pipelines=[{id:"p1",apiKey:"first-pipeline-secret"}];');const first=h.context.savePipelines();h.run('pipelines.push({id:"p2",password:"second-pipeline-secret"});');const second=h.context.savePipelines();await Promise.all([first,second]);assert.equal(JSON.parse(h.data.get('lvx_pipelines')).length,2);
    await Promise.all([h.context.saveUnitTest({id:'one',name:'One',apiKey:'unit-credential-one'}),h.context.saveUnitTest({id:'two',name:'Two',password:'unit-credential-two'})]);assert.equal(JSON.parse(h.data.get('lvx_unit_tests')).length,2);
    h.data.set('lvx_unit_tests',JSON.stringify([{id:'migrated',name:'Migrated',apiKey:'old-plaintext-value'}]));await h.context.LVXCredentials.migrate(['lvx_unit_tests']);h.context.dispatchEvent({type:'lvx-credentials-migrated'});assert.match(h.context.getUnitTest('migrated').apiKey,/^secret:/);
});
test('COMPAT actual local HTTP gets resolved headers/webhook URL while renderer requests contain only references and preserve failures',async()=>{
    const received=[];const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;received.push({url:req.url,key:req.headers['x-api-key'],body});res.setHeader('Content-Type','application/json');if(req.url==='/fail'){res.writeHead(503);res.end(JSON.stringify({error:'provider offline'}));}else res.end(JSON.stringify({name:'Local fixture',echo:req.headers['x-api-key']||null}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const url='http://127.0.0.1:'+server.address().port,h=harness(['integrations.js','cicd-integration.js','collaboration.js']);
    try{await h.context.cicdConfiguration.saveBackendConfig({backendUrl:url,apiKey:'real-local-ci-secret'});const health=await h.context.cicdConfiguration.testConnection();assert.equal(health.success,true);assert.equal(received[0].key,'real-local-ci-secret');assert.equal(health.backendInfo.echo,'[REDACTED]');
        await h.context.integrationsManager.saveIntegration({id:'webhook',name:'Local fixture',type:'webhook',webhookUrl:url+'/notify',enabled:true,notifyOnAll:true});await h.context.integrationsManager._sendToIntegration(h.context.integrationsManager.getIntegration('webhook'),{suiteName:'Fixture',status:'PASS'});assert.equal(received.at(-1).url,'/notify');
        await assert.rejects(h.context.integrationsManager._sendToIntegration({id:'fail',type:'webhook',name:'Local failure',webhookUrl:url+'/fail'},{suiteName:'Fixture',status:'FAILURE'}),/503|failed/i);
        assert.ok(h.requests.length>=3);assert.equal(JSON.stringify(h.requests).includes('real-local-ci-secret'),false);assert.equal(h.requests.some(r=>r.url===url+'/notify'),false);
    }finally{await new Promise(r=>server.close(r));}
});
test('COMPAT collaboration snapshots protect nested credentials in canonical SQLite and export redacts nested secrets and refs',async t=>{
    const folder=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-canonical-collaboration-')),workspace=require('../services/workspace/index.cjs').createService({dataDir:path.join(folder,'state'),workspaceRoot:folder});t.after(async()=>{await workspace.close();fs.rmSync(folder,{recursive:true,force:true});});
    const h=harness(['indexeddb-version-storage.js','collaboration.js'],{workspace});const suite={id:'s',name:'Nested',parameters:{CUSTOM:'typed-export-private'},parameter_schema:{CUSTOM:{secret:true},TOKEN:{type:'string',secret:true}},apiKey:'top-private',config:{password:'nested-private'},steps:[{action:'input',selector:'#password',value:'typed-private'}]};
    await Promise.all([h.context.collaborationManager.createVersionSnapshot(suite,'First'),h.context.collaborationManager.createVersionSnapshot(suite,'Second')]);const versions=await h.context.collaborationManager.getVersionHistory('s');assert.deepEqual(Array.from(versions,v=>v.version),[1,2]);const stored=(await workspace.handle('list',{collection:'versions'})).records;assert.equal(stored.length,2);assert.equal(h.data.has('versions_s'),false,'Desktop snapshots must not recreate a split localStorage source');for(const raw of ['nested-private','top-private','typed-private','typed-export-private'])assert.equal(JSON.stringify(stored).includes(raw),false,raw);
    const exported=await h.context.collaborationManager.exportForTeam({...suite,nested:{token:'nested-token',reference:'secret:'+crypto.randomUUID()}});const text=await exported.blob.text();for(const raw of ['top-private','nested-private','nested-token','typed-private','typed-export-private','secret:'])assert.equal(text.includes(raw),false,raw);assert.equal(JSON.parse(text).suite.parameter_schema.TOKEN.secret,true);
});
test('COMPAT real native Python unit discovery distinguishes pass failure zero and cleanup; synchronous loops cancel outside renderer',async()=>{
    const {createService}=require('../services/execution/index.cjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-native-unit-compat-')),oldPath=process.env.PYTHONPATH;
    process.env.PYTHONPATH=[path.join(root,'.external/python-packages'),oldPath].filter(Boolean).join(path.delimiter);
    const nativeRef='secret:'+crypto.randomUUID(),service=createService({dataDir:path.join(dir,'.state'),workspaceRoot:dir,resolveSecret:ref=>{assert.equal(ref,nativeRef);return 'native-private-value';}}),h=harness(['unit-testing.js'],{execution:service});
    try{for(const framework of ['unittest','pytest']){const good=framework==='unittest'?'class Actual(unittest.TestCase):\n    def test_value(self):\n        self.assertEqual(shared,4)':'def test_value():\n    assert shared == 4';const result=await h.context.executePythonUnitTest({test_framework:framework,setup_code:'shared=4',test_code:good,teardown_code:'print("cleanup complete")'});assert.equal(result.status,'PASS',result.error);assert.equal(result.assertions_passed,1);assert.match(result.output,/cleanup complete/);assert.equal((await service.handle('getRun',{id:result.run_id})).status,'SUCCESS');
            const bad=good.replace('shared,4','shared,5').replace('shared == 4','shared == 5');const failure=await h.context.executePythonUnitTest({test_framework:framework,setup_code:'shared=4',test_code:bad,teardown_code:'print("failure cleanup")'});assert.equal(failure.status,'FAIL');assert.ok(failure.assertions_failed>0);assert.match(failure.output,/failure cleanup/);assert.equal((await service.handle('getRun',{id:failure.run_id})).status,'FAILURE');const zero=await h.context.executePythonUnitTest({test_framework:framework,test_code:'value=1'});assert.equal(zero.status,'FAIL');assert.match(zero.error,/no.*tests|no passing/i);assert.equal(zero.totalTests,0);assert.equal(zero.assertions_failed,0);assert.ok(zero.errors>0);assert.equal((await service.handle('getRun',{id:zero.run_id})).status,'ERROR');}
        const params=await h.context.executePythonUnitTest({test_framework:'unittest',parameters:{CUSTOM:{secretRef:nativeRef}},parameter_schema:{TOKEN:{secret:true}},inputs:{expected:7},input_files:[{filename:'fixture.txt',content:'native fixture'}],test_code:'class Bindings(unittest.TestCase):\n    def test_bindings(self):\n        self.assertEqual(parameters["CUSTOM"], "native-private-value")\n        self.assertEqual(inputs["expected"],7)\n        with open("fixture.txt") as source: self.assertEqual(source.read(),"native fixture")'});assert.equal(params.status,'PASS',params.error);assert.equal(params.totalTests,1);assert.equal(fs.existsSync(path.join(dir,'fixture.txt')),false);
        const setupFailure=await h.context.executePythonUnitTest({test_framework:'unittest',setup_code:'raise RuntimeError("setup broken")',test_code:'value=1',teardown_code:'print("setup failure cleanup")'});assert.equal(setupFailure.status,'FAIL');assert.match(setupFailure.output,/setup failure cleanup/);assert.equal(setupFailure.assertions_failed,0);assert.equal(setupFailure.errors,1);assert.equal((await service.handle('getRun',{id:setupFailure.run_id})).status,'ERROR');
        let heartbeat=false;setTimeout(()=>{heartbeat=true;},0);const looping=h.context.executePythonUnitTest({test_framework:'unittest',test_code:'class Loop(unittest.TestCase):\n    def test_loop(self):\n        while True: pass',timeout_ms:10000});const until=Date.now()+5000;while(!h.context.LVXActiveUnitRun&&Date.now()<until)await sleep(20);assert.equal(heartbeat,true);assert.ok(h.context.LVXActiveUnitRun);const at=Date.now();await service.handle('cancel',{id:h.context.LVXActiveUnitRun});const cancelled=await looping;assert.ok(Date.now()-at<2000);assert.equal(cancelled.status,'CANCELLED');
    }finally{await service.close();if(oldPath===undefined)delete process.env.PYTHONPATH;else process.env.PYTHONPATH=oldPath;fs.rmSync(dir,{recursive:true,force:true});}
});


test('COMPAT actual security-service response preserves opaque refs and schema through host-style redaction',async t=>{
    const {createService}=require('../services/security');
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-compat-credential-host-'));
    t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    const key=crypto.randomBytes(32);
    const safeStorage={isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'test-encryption-boundary',
        encryptString(value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]);},
        decryptString(value){const decipher=crypto.createDecipheriv('aes-256-gcm',key,value.subarray(0,12));decipher.setAuthTag(value.subarray(12,28));return Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString('utf8');}};
    const security=createService({dataDir:dir,workspaceRoot:root,safeStorage});
    const h=harness(['cicd-integration.js','unit-testing.js'],{security});
    await h.context.cicdConfiguration.saveBackendConfig({backendUrl:'http://127.0.0.1:1',apiKey:'host-private-value'});
    const ref=JSON.parse(h.data.get('cicd_backend_config')).apiKey;
    assert.match(ref,/^secret:[a-f0-9-]{36}$/);assert.equal(security.resolveSecret(ref),'host-private-value');
    const returned=security.redact({apiKey:ref,schema:{TOKEN:{secret:true}},message:'host-private-value'});
    assert.equal(returned.apiKey,ref);assert.equal(returned.schema.TOKEN.secret,true);assert.equal(returned.message,'[REDACTED]');
    await h.context.saveUnitTest({id:'typed',name:'Typed credential',test_framework:'custom',test_code:'assert(true);',parameters:{CUSTOM:'typed-parameter-private'},parameter_schema:{CUSTOM:{secret:true}}});
    const stored=JSON.parse(h.data.get('lvx_unit_tests'))[0];assert.match(stored.parameters.CUSTOM.secretRef,/^secret:[a-f0-9-]{36}$/);assert.equal(stored.parameter_schema.CUSTOM.secret,true);
    assert.equal(JSON.stringify([...h.data.values()]).includes('typed-parameter-private'),false);
});

test('COMPAT browser preview refuses plaintext credential storage and failed environment delete keeps active pointer',async()=>{
    const h=harness(['cicd-integration.js']);delete h.context.electronAPI;
    await assert.rejects(Promise.resolve(h.context.cicdConfiguration.saveBackendConfig({backendUrl:'http://127.0.0.1:1',apiKey:'browser-private-value'})),/desktop|secure|credential/i);
    assert.equal(h.data.has('cicd_backend_config'),false);
    const env=harness(['environment-manager.js'],{rejectStore:true});
    env.data.set('test_environments',JSON.stringify([{id:'first',variables:{}},{id:'second',variables:{PASSWORD:'old-private'}}]));env.data.set('active_environment','first');
    await assert.rejects(env.context.environmentManager.deleteEnvironment('first'),/OS store/);
    assert.equal(env.data.get('active_environment'),'first');assert.equal(JSON.parse(env.data.get('test_environments')).length,2);
});


test('COMPAT pending credential saves cannot resurrect cleared connections and repeated toggles serialize',async()=>{
 const h=harness(['cicd-integration.js','collaboration.js','integrations.js']);
 for(const manager of [h.context.cicdConfiguration,h.context.collaborationManager]){
  const save=manager.saveBackendConfig({backendUrl:'http://127.0.0.1:1',apiKey:'queued-private'}),clear=manager.clearBackendConfig();
  await Promise.all([save,clear]);assert.equal(manager.getBackendConfig(),null);
 }
 await h.context.integrationsManager.saveIntegration({id:'toggle',type:'webhook',webhookUrl:'http://127.0.0.1:1',enabled:true});
 await Promise.all([h.context.integrationsManager.toggleIntegration('toggle'),h.context.integrationsManager.toggleIntegration('toggle')]);assert.equal(h.context.integrationsManager.getIntegration('toggle').enabled,true);
});
