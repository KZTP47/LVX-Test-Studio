'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),http=require('node:http'),vm=require('node:vm');
const {createService,assertScopedPath,validatePayload,validateSender,createPreviewPolicy,inventory}=require('../services/security');
const {spawn}=require('node:child_process');
function fixture(t,extra={}){const root=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-security-')),workspace=path.join(root,'project');fs.mkdirSync(workspace);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const key=crypto.randomBytes(32);const safeStorage={isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'test-os-keyring',encryptString(value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]);},decryptString(value){const decipher=crypto.createDecipheriv('aes-256-gcm',key,value.subarray(0,12));decipher.setAuthTag(value.subarray(12,28));return Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString('utf8');}};const options={dataDir:path.join(root,'private'),workspaceRoot:workspace,safeStorage,...extra};return {root,workspace,options,service:createService(options)};}
async function trusted(f){await f.service.handle('trust',{trusted:true});return f;}

test('FW-13 encrypts credentials and exports only opaque metadata; restart redacts values in arbitrary evidence',async t=>{
  const f=fixture(t),value='private-fixture-'+crypto.randomUUID();const record=await f.service.handle('storeSecret',{label:'Local fixture',value});
  assert.match(record.reference,/^secret:/);assert.equal(f.service.resolveSecret(record.reference),value);
  const persisted=fs.readFileSync(path.join(f.root,'private/security/credentials.json'),'utf8');assert.ok(!persisted.includes(value));assert.ok(persisted.includes('ciphertext'));
  const output=JSON.stringify(await f.service.handle('listSecrets'));assert.ok(!output.includes(value));assert.ok(!output.includes('ciphertext'));
  const reopened=createService(f.options);assert.equal(reopened.redact({log:'prefix '+value,apiKey:'arbitrary',url:'https://user:pass@example.org'}).log,'prefix [REDACTED]');
  assert.equal(reopened.redact({apiKey:'arbitrary'}).apiKey,'[REDACTED]');assert.ok(!JSON.stringify(await reopened.handle('diagnostics')).includes(value));
  await reopened.handle('deleteSecret',{reference:record.reference});assert.throws(()=>reopened.resolveSecret(record.reference),/unavailable/);
});
test('FW-13 refuses unavailable OS encryption and Linux basic_text; plain credential payload never persisted',async t=>{
  for(const safeStorage of [{isEncryptionAvailable:()=>false},{isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'basic_text'}]){const f=fixture(t,{safeStorage});await assert.rejects(f.service.handle('storeSecret',{label:'Never stored',value:'not-to-persist'}),/unavailable|refused/);assert.equal(fs.existsSync(path.join(f.root,'private/security/credentials.json')),false);}
});
test('FW-13 backup redaction strips known secrets, credential keys, nested values and authenticated URLs',async t=>{
  const f=fixture(t),value='backup-private-'+crypto.randomUUID();await f.service.handle('storeSecret',{label:'Backup fixture',value});
  const exported=f.service.redact({records:[{configuration:{password:value,api_key:'not-in-vault'},output:'The token is '+value}],url:'https://user:password@example.org/path',ciphertext:'sensitive-encrypted-data'});
  const serialized=JSON.stringify(exported);assert.ok(!serialized.includes(value));assert.ok(!serialized.includes('not-in-vault'));assert.ok(!serialized.includes('user:password'));assert.ok(!serialized.includes('sensitive-encrypted-data'));
});
test('FW-14 canonical workspace boundary rejects traversal, symlink escape and untrusted imported workflows',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.workspace,'inside.txt'),'fixture');assert.equal(assertScopedPath(f.workspace,'inside.txt'),path.join(f.workspace,'inside.txt'));
  assert.throws(()=>assertScopedPath(f.workspace,'../private'),/outside/);const outside=path.join(f.root,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(f.workspace,'escape'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>assertScopedPath(f.workspace,'escape/new.txt',{mustExist:false}),/escapes/);assert.throws(()=>f.service.assertTrusted(),/Trust/);
  await trusted(f);assert.equal(f.service.assertTrusted(),true);assert.throws(()=>f.service.assertTrusted({imported:true}),/imported/);
  assert.throws(()=>f.service.assertTrusted({imported:true,importedWorkflowId:'constructor'}),/imported/);await assert.rejects(f.service.handle('trust',{trusted:true,importedWorkflowId:'__proto__'}),/Invalid/);
  await f.service.handle('trust',{trusted:true,importedWorkflowId:'workflow-content-hash'});assert.equal(f.service.assertTrusted({imported:true,importedWorkflowId:'workflow-content-hash'}),true);
  await f.service.handle('trust',{trusted:false});assert.throws(()=>f.service.assertTrusted({importedWorkflowId:'workflow-content-hash'}),/Trust/);
});
test('FW-14 sender and plain payload validation deny frames, external origins and prototype keys',()=>{
  const mainFrame={url:'file:///C:/app/index.html'},sender={id:7,mainFrame};assert.equal(validateSender({sender,senderFrame:mainFrame},{webContentsId:7,allowedUrl:mainFrame.url}),true);
  assert.throws(()=>validateSender({sender,senderFrame:{url:mainFrame.url}},{webContentsId:7,allowedUrl:mainFrame.url}),/sender/);
  assert.throws(()=>validateSender({sender,senderFrame:mainFrame},{webContentsId:7,allowedUrl:'https://example.org'}),/origin/);
  assert.throws(()=>validatePayload(JSON.parse('{"__proto__":{"polluted":true}}')),/Unsafe/);assert.throws(()=>validatePayload({x:Infinity}),/numeric/);assert.throws(()=>validatePayload({value:()=>{}}),/plain data/);
});
test('FW-15 separately installed infrastructure adapter executes actual positive/negative local Docker/Kubernetes fixtures',async t=>{
  const f=await trusted(fixture(t));fs.writeFileSync(path.join(f.workspace,'Dockerfile'),'FROM node:latest\nUSER root\n');fs.writeFileSync(path.join(f.workspace,'safe.Dockerfile'),'FROM node@sha256:'+'a'.repeat(64)+'\nUSER 1001\n');
  const payload={kind:'infrastructure',adapterId:'local-config-v1',mode:'dockerfile',target:'Dockerfile',authorizedTargets:['Dockerfile']};
  await assert.rejects(f.service.handle('scan',payload),/Install/);await f.service.handle('installAdapter',{id:'local-config-v1'});
  await assert.rejects(f.service.handle('scan',{...payload,authorizedTargets:[]}),/authorization/);
  const vulnerable=await f.service.handle('scan',payload);assert.equal(vulnerable.status,'FAILURE');assert.ok(vulnerable.findings.some(item=>item.ruleId==='DOCKER-NONROOT'));assert.equal(vulnerable.coverage.complete,true);
  const safe=await f.service.handle('scan',{...payload,target:'safe.Dockerfile',authorizedTargets:['safe.Dockerfile']});assert.equal(safe.status,'SUCCESS');assert.equal(safe.findings.length,0);
  fs.writeFileSync(path.join(f.workspace,'deployment.yaml'),'apiVersion: v1\nkind: Pod\nspec:\n  containers:\n    - name: web\n      securityContext:\n        privileged: true\n');
  const k8s=await f.service.handle('scan',{...payload,mode:'kubernetes',target:'deployment.yaml',authorizedTargets:['deployment.yaml']});assert.ok(k8s.findings.some(item=>item.ruleId==='K8S-PRIVILEGED'));
  fs.writeFileSync(path.join(f.workspace,'invalid'),'not a Dockerfile');assert.equal((await f.service.handle('scan',{...payload,target:'invalid',authorizedTargets:['invalid']})).status,'ERROR');
  const entry=path.join(f.root,'private/security/adapters/local-config-v1/adapter.cjs');fs.appendFileSync(entry,'\n//tamper');await assert.rejects(f.service.handle('scan',payload),/integrity/);
});
test('FW-15 endpoint adapter uses real HTTP headers and refuses redirects without following them',async t=>{
  const f=await trusted(fixture(t));await f.service.handle('installAdapter',{id:'local-config-v1'});let hits=0;
  const server=http.createServer((req,res)=>{hits++;if(req.url==='/redirect'){res.writeHead(302,{Location:'/other'});res.end();return;}if(req.url==='/safe'){res.setHeader('Content-Security-Policy',"default-src 'none'");res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');}res.end();});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin=`http://127.0.0.1:${server.address().port}`,scan=url=>f.service.handle('scan',{kind:'infrastructure',adapterId:'local-config-v1',mode:'endpoint',target:url,authorizedTargets:[url]});
  assert.equal((await scan(origin+'/safe')).status,'SUCCESS');assert.equal((await scan(origin+'/unsafe')).findings.length,3);const before=hits;assert.equal((await scan(origin+'/redirect')).status,'ERROR');assert.equal(hits,before+1);
});
test('FW-16 resolves direct/transitive exact packages from seven lock/SBOM formats and deduplicates locators',()=>{
  const cases=[
    ['package-lock',JSON.stringify({lockfileVersion:3,packages:{'':{name:'root'},'node_modules/a':{version:'1.2.3'},'node_modules/x/node_modules/a':{version:'1.2.3'},'node_modules/b':{version:'2.0.0'}}}),2],
    ['pnpm',"lockfileVersion: '9.0'\npackages:\n  a@1.2.3:\n    resolution: {}\n  '@scope/b@2.0.0':\n    resolution: {}\nsnapshots:\n  a@1.2.3: {}\n",2],
    ['yarn','a@^1.0.0:\n  version "1.2.3"\n\n"@scope/b@npm:^2.0.0":\n  version: 2.0.0\n',2],
    ['requirements','a==1.2.3\nb==2.0.0 ; python_version >= "3.10"\n',2],
    ['poetry','[[package]]\nname = "a"\nversion = "1.2.3"\n[[package]]\nname="b"\nversion="2.0.0"\n',2],
    ['uv','version=1\n[[package]]\nname="a"\nversion="1.2.3"\n',1],
    ['cyclonedx',JSON.stringify({bomFormat:'CycloneDX',components:[{type:'library',name:'a',version:'1.2.3',purl:'pkg:npm/a@1.2.3'},{type:'library',name:'b',purl:'pkg:pypi/b@2.0.0'}]}),2]
  ];for(const [format,content,count]of cases){const result=inventory(content,format);assert.equal(result.coverage.complete,true,format+': '+JSON.stringify(result.unresolved));assert.equal(result.packages.length,count,format);}
  assert.equal(inventory('a>=1.0','requirements').status,'ERROR');assert.equal(inventory('{"packages":{}}','package-lock').status,'ERROR');assert.equal(inventory('{"packages":{"node_modules/a":{"version":"^1.2.3"}}}','package-lock').status,'ERROR');
});
test('FW-16 dependency query coverage preserves known findings when another package lookup fails',async t=>{
  const queried=[];const f=fixture(t,{fetch:async(url,options)=>{const request=JSON.parse(options.body);queried.push(request);if(request.package.name==='b')return {ok:false,status:503};return {ok:true,json:async()=>({vulns:[{id:'OSV-fixture',summary:'Fixture issue',database_specific:{severity:'HIGH'}}]})};}});
  const result=await f.service.handle('scan',{kind:'dependencies',format:'package-lock',content:JSON.stringify({packages:{'node_modules/a':{version:'1.0.0'},'node_modules/b':{version:'2.0.0'}}})});
  assert.equal(result.status,'ERROR');assert.equal(result.findings.length,1);assert.equal(result.findings[0].severity,'HIGH');assert.equal(result.coverage.complete,false);assert.equal(result.coverage.lookups.length,2);assert.equal(result.coverage.queried,1);assert.equal(queried.length,2);
});
test('FW-16 malformed advisory data never counts a failed lookup successful; CVSS arrays and unknown scores remain faithful',async t=>{
  const f=fixture(t,{fetch:async()=>({ok:true,json:async()=>({vulns:[{id:'valid'},{summary:'missing id'}]})})});const payload={kind:'dependencies',format:'requirements',content:'example==1.2.3'};
  const malformed=await f.service.handle('scan',payload);assert.equal(malformed.status,'ERROR');assert.equal(malformed.coverage.lookups.length,1);assert.equal(malformed.coverage.queried,0);
  const g=fixture(t,{fetch:async()=>({ok:true,json:async()=>({vulns:[{id:'critical',severity:[{score:'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'}]},{id:'unknown',severity:[{score:'CVSS:4.0/UNRECOGNIZED'}]},{id:'fallback',severity:[],database_specific:{severity:'MODERATE'}}]})})});
  assert.deepEqual((await g.service.handle('scan',payload)).findings.map(v=>v.severity),['CRITICAL','UNKNOWN','MEDIUM']);
  assert.equal(inventory('a==1.x','requirements').status,'ERROR');assert.equal(inventory('{"packages":{"node_modules/a":{"version":"1.x"}}}','package-lock').status,'ERROR');
});
test('FW-17 source rules expose precise locations/fingerprints, unsupported language stays incomplete and suppression requires review/expiry',async t=>{
  const f=await trusted(fixture(t));const payload={kind:'source',files:[{path:'a.js',content:'const x = 1;\neval(input);\n'}]};const first=await f.service.handle('scan',payload);assert.equal(first.status,'FAILURE');assert.equal(first.findings[0].line,2);assert.equal(first.findings[0].column,1);assert.match(first.findings[0].fingerprint,/^[a-f0-9]{64}$/);assert.match(first.coverage.limitations[0],/not syntax-aware/);
  const fingerprint=first.findings[0].fingerprint;await assert.rejects(f.service.handle('saveSuppression',{fingerprint,reason:'x',reviewer:'x',expiresAt:new Date(Date.now()+10000).toISOString()}),/review/);
  await assert.rejects(f.service.handle('saveSuppression',{fingerprint,reason:'Reviewed fixture exception',reviewer:'Owner',expiresAt:'2020-01-01'}),/expiry/);
  await f.service.handle('saveSuppression',{fingerprint,reason:'Reviewed fixture exception',reviewer:'Owner',expiresAt:new Date(Date.now()+60000).toISOString()});const second=await f.service.handle('scan',payload);assert.equal(second.status,'SUCCESS');assert.equal(second.findings.length,1);assert.equal(second.findings[0].suppressed,true);assert.equal(second.summary.suppressed,1);
  const unknown=await f.service.handle('scan',{kind:'source',files:[{path:'a.rs',content:'fn main() {}'}]});assert.equal(unknown.status,'ERROR');assert.equal(unknown.coverage.complete,false);
  const other=path.join(f.root,'other');fs.mkdirSync(other);f.service.setWorkspace(other);await f.service.handle('trust',{trusted:true});assert.equal((await f.service.handle('scan',payload)).findings[0].suppressed,undefined);
});
test('FW-17 scanning embedded secret never emits original token fragments',async t=>{
  const f=fixture(t),secret='TOPSECRET-'+crypto.randomUUID();const result=await f.service.handle('scan',{kind:'source',files:[{path:'fixture.py',content:`password = '${secret}'`}]});assert.equal(result.findings.length,1);assert.ok(!JSON.stringify(result).includes(secret));assert.equal(result.findings[0].ruleId,'SECRET-LITERAL');
});
test('FW-18 preview policy denies desktop bridge configuration, file origins, popups, permissions and default network',()=>{
  const policy=createPreviewPolicy();assert.equal(policy.webPreferences.sandbox,true);assert.equal(policy.webPreferences.nodeIntegration,false);assert.equal(policy.webPreferences.contextIsolation,true);assert.equal(policy.webPreferences.preload,undefined);assert.equal(policy.allowsUrl('file:///C:/Windows/win.ini'),false);assert.equal(policy.allowsUrl('https://example.org'),false);assert.equal(policy.allowWindowOpen().action,'deny');assert.equal(policy.allowPermission(),false);assert.equal(policy.allowsNavigation('https://example.org'),false);assert.match(policy.contentSecurityPolicy,/connect-src 'none'/);assert.match(policy.contentSecurityPolicy,/form-action 'none'/);
  const scoped=createPreviewPolicy({allowNetworkOrigins:['https://example.org']});assert.equal(scoped.allowsUrl('https://example.org/path'),true);assert.equal(scoped.allowsUrl('https://example.org.attacker.test/path'),false);assert.throws(()=>createPreviewPolicy({allowNetworkOrigins:['https://example.org/path']}),/exact/);
});
test('FW-13/FW-18 real Electron isolated preview has no desktop bridge and cannot fetch network or files; real safeStorage respects OS availability',async t=>{
  const f=fixture(t),modulePath=path.resolve(__dirname,'../services/security');let hits=0;const server=http.createServer((_req,res)=>{hits++;res.end('must not be fetched');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const target=`http://127.0.0.1:${server.address().port}/blocked`,script=path.join(f.root,'electron-probe.cjs'),output=path.join(f.root,'probe.json');
  // Resolve Electron from this repository; the disposable script has no dependency lookup from the workspace.
  fs.writeFileSync(script,`'use strict';
const {app,BrowserWindow,safeStorage}=require('electron');const fs=require('node:fs');const security=require(${JSON.stringify(modulePath)});
app.setPath('userData',${JSON.stringify(path.join(f.root,'electron-profile'))});app.disableHardwareAcceleration();
app.whenReady().then(async()=>{let win;try{const policy=security.createPreviewPolicy();win=new BrowserWindow({show:false,webPreferences:policy.webPreferences});security.configurePreviewContents(win.webContents,policy);await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(security.preparePreviewHtml('<h1>Untrusted preview</h1>',policy)));
const result=await win.webContents.executeJavaScript('(async()=>({bridge:typeof window.electronAPI,require:typeof require,process:typeof process,network:await fetch('+${JSON.stringify(JSON.stringify(target))}+').then(()=>true,()=>false),file:await fetch("file:///C:/Windows/win.ini").then(()=>true,()=>false),popup:window.open("https://example.invalid")===null}))()');
const service=security.createService({dataDir:${JSON.stringify(path.join(f.root,'electron-private'))},safeStorage});const state=await service.handle('status');result.osEncryption=state.credentials.available;if(result.osEncryption){const item=await service.handle('storeSecret',{label:'OS probe',value:'operating-system-protected-fixture'});result.roundtrip=service.resolveSecret(item.reference)==='operating-system-protected-fixture';result.noPlaintext=!fs.readFileSync(${JSON.stringify(path.join(f.root,'electron-private/security/credentials.json'))},'utf8').includes('operating-system-protected-fixture');}else{try{await service.handle('storeSecret',{label:'OS probe',value:'never store plaintext'});result.failClosed=false;}catch{result.failClosed=true;}}
fs.writeFileSync(${JSON.stringify(output)},JSON.stringify(result));win.destroy();app.exit(0);}catch(error){fs.writeFileSync(${JSON.stringify(output)},JSON.stringify({error:error.message}));if(win)win.destroy();app.exit(1);}});`);
  const executable=require('electron'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const exit=await new Promise((resolve,reject)=>{const child=spawn(executable,[script],{cwd:f.root,env,windowsHide:true,stdio:'ignore'}),timer=setTimeout(()=>{child.kill();reject(new Error('Electron preview probe timed out'));},25000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);resolve(code);});});
  assert.equal(exit,0,fs.existsSync(output)?fs.readFileSync(output,'utf8'):'Electron did not write evidence');const result=JSON.parse(fs.readFileSync(output,'utf8'));assert.equal(result.bridge,'undefined');assert.equal(result.require,'undefined');assert.equal(result.process,'undefined');assert.equal(result.network,false);assert.equal(result.file,false);assert.equal(result.popup,true);assert.equal(hits,0);if(result.osEncryption){assert.equal(result.roundtrip,true);assert.equal(result.noPlaintext,true);}else assert.equal(result.failClosed,true);
});
test('FW-15 browser bridge sends explicit authorization and keeps real findings as evidence',async()=>{
  let sent;const storage=new Map(),context={console:{log(){},warn(){},error(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},URL,AbortController,setTimeout,clearTimeout};context.window=context;context.electronAPI={studioOps:{async invoke(domain,action,payload){sent={domain,action,payload};return {coverage:{complete:true},findings:[{severity:'HIGH'}],errors:[]};}}};vm.createContext(context);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../security-testing.js'),'utf8'),context);const result=await context.securityManager.runInfrastructureScan('Dockerfile','dockerfile',{authorizedTargets:['Dockerfile']});assert.equal(sent.payload.authorizedTargets[0],'Dockerfile');assert.equal(result.summary.high,1);assert.equal(result.status,'SUCCESS');assert.equal((await context.securityManager.runInfrastructureScan('image:latest','docker_image')).status,'ERROR');
});
