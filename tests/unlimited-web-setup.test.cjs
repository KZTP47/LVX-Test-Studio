'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm'),{EventEmitter}=require('node:events'),{Readable}=require('node:stream');
const targets=require('../services/web-targets/index.cjs'),catalog=require('../services/setup/catalog.cjs'),io=require('../services/setup/io.cjs'),{createService:createSetup}=require('../services/setup/index.cjs'),{createService:createPreview}=require('../services/preview/index.cjs');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex'),official='https://nodejs.org/dist/fixture';
const bundled=path.dirname(require.resolve('playwright-core/package.json')),{PNG}=require(path.join(bundled,'lib/utilsBundle.js'));
function directory(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-unlimited-web-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50}));return root;}
function put(root,name,data){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data);return file;}
function makeTargets(t){const root=directory(t),workspace=path.join(root,'workspace'),site=path.join(root,'site');fs.mkdirSync(workspace);fs.mkdirSync(site);let current=workspace;const service=targets.createTargets({dataDir:path.join(root,'native'),getWorkspaceRoot:()=>current});t.after(()=>service.close());return{root,workspace,site,service,change:value=>current=value};}
function png(width,height,random=false){const data=random?crypto.randomBytes(width*height*4):Buffer.alloc(width*height*4,255);return PNG.sync.write({width,height,data});}
function baseline(bytes,name){return{id:digest(name),sha256:digest(bytes),bytes:bytes.length,image:bytes.toString('base64')};}
// This decoder checks real PNG chunks/pixels without requiring the test process
// to run as Electron. Packaged integration independently exercises nativeImage.
const nativeImage={createFromBuffer(bytes){try{const image=PNG.sync.read(bytes);return{isEmpty:()=>false,getSize:()=>({width:image.width,height:image.height})};}catch{return{isEmpty:()=>true};}}};
class PreviewWindow extends EventEmitter{
 constructor(){super();this.destroyed=false;this.webContents=new EventEmitter();Object.assign(this.webContents,{setWindowOpenHandler(){},getURL:()=>this.url,executeJavaScriptInIsolatedWorld:async(_world,[{code}])=>({ok:true,value:code.includes('"operation":"exists"')?true:'<html><h1>Fixture</h1></html>'}),session:{setPermissionRequestHandler(){},setPermissionCheckHandler(){},on(){},webRequest:{onBeforeRequest(){},onHeadersReceived(){}}}});}
 isDestroyed(){return this.destroyed;}async loadURL(url){this.url=url;}destroy(){if(this.destroyed)return;this.destroyed=true;this.emit('closed');}
}
test('WEBSITE-PORTABLE: more than 5,000 files and 12 MiB remain complete, portable, and served over HTTP',async t=>{
 const f=makeTargets(t),large='x'.repeat(13*1024*1024),files=[{path:'index.html',content:'<h1>Large portable website</h1>',encoding:'utf8'},{path:'large.txt',content:large,encoding:'utf8'},...Array.from({length:5001},(_,i)=>({path:'assets/'+i+'.js',content:'window.fixture='+i,encoding:'utf8'}))];
 const target={version:1,kind:'files',entry:'index.html',files};assert.equal(targets.validateFiles(target).files.size,5003);const resolved=await f.service.resolve(target);t.after(resolved.dispose);
 const body=Buffer.from(await(await fetch(new URL('large.txt',resolved.url))).arrayBuffer());assert.equal(body.length,Buffer.byteLength(large));assert.equal(digest(body),digest(large));assert.equal(await(await fetch(new URL('assets/5000.js',resolved.url))).text(),'window.fixture=5000');
 for(const attack of ['../private','/absolute','bad\\path','a//b'])assert.throws(()=>targets.validateFiles({...target,files:[{path:attack,content:'unsafe',encoding:'utf8'}]}),/relative|traversal/);
 assert.throws(()=>targets.validateFiles({...target,files:[...files,files[0]]}),/Duplicate/);assert.throws(()=>targets.validateFiles({...target,files:[{path:'index.html',encoding:'base64',content:'AA=A'}]}),/base64/);
});
test('WEBSITE-DISCOVERY: discovery crosses 100,000 inventory entries and embeds large assets instead of a machine-only fallback',async t=>{
 const f=makeTargets(t);put(f.site,'index.html','<h1>Root</h1>');put(f.site,'many/final.html','<h1>Last discovered page</h1>');put(f.site,'large.txt','x'.repeat(13*1024*1024));
 const opendir=fs.promises.opendir;fs.promises.opendir=async function(name,...args){if(String(name)===path.join(f.site,'many'))return{async *[Symbol.asyncIterator](){for(let i=0;i<100001;i++)yield{name:'ignored-'+i+'.unrelated',isSymbolicLink:()=>false,isDirectory:()=>false,isFile:()=>true};yield{name:'final.html',isSymbolicLink:()=>false,isDirectory:()=>false,isFile:()=>true};}};return opendir.call(this,name,...args);};
 try{const result=await f.service.selectFolder({path:f.site});assert.equal(result.target.kind,'files');assert.equal(result.target.project.nativeFiles,false);assert.equal(result.target.files.length,3);assert.ok(result.target.project.entryChoices.includes('many/final.html'));assert.equal(result.target.files.find(x=>x.path==='large.txt').content.length,13*1024*1024);}finally{fs.promises.opendir=opendir;}
});
test('WEBSITE-DISCOVERY: valid large package metadata works; asynchronous discovery remains cancellable and excludes secrets',async t=>{
 const f=makeTargets(t);put(f.site,'index.html','<h1>Root</h1>');put(f.site,'package.json',JSON.stringify({description:'x'.repeat(1024*1024+1),scripts:{}}));put(f.site,'package-lock.json','x'.repeat(13*1024*1024));put(f.site,'.env','secret');
 const result=await f.service.selectFolder({path:f.site});assert.equal(result.target.files.length,1);assert.match(result.target.project.packageFingerprint,/^[a-f0-9]{64}$/);
 const other=path.join(f.root,'other');fs.mkdirSync(other);const readFile=fs.promises.open;let release,entered;const ready=new Promise(r=>entered=r);fs.promises.open=async function(...args){entered();await new Promise(r=>release=r);return readFile.apply(this,args);};
 try{const pending=f.service.handle('refresh',{sourceId:result.sourceId}),rejected=assert.rejects(pending,/workspace changed|workspace|closed/i);await ready;f.change(other);release();await rejected;}finally{fs.promises.open=readFile;}
 assert.equal(result.target.files[0].content,'<h1>Root</h1>');
});
test('WEBSITE-SERVER: a real project becomes ready after the former 25-second deadline; complete output survives',async t=>{
 const f=makeTargets(t);put(f.site,'package.json',JSON.stringify({scripts:{dev:'node server.cjs'}}));put(f.site,'server.cjs',`console.log('START-MARKER'+'x'.repeat(70000));setTimeout(()=>require('node:http').createServer((q,r)=>setTimeout(()=>r.end('late and valid'),700)).listen(Number(process.env.PORT),'127.0.0.1'),25500);`);
 const selected=await f.service.selectFolder({path:f.site}),options={sourceId:selected.sourceId,script:'dev',expectedCommand:selected.target.project.scripts.dev,expectedFingerprint:selected.target.project.packageFingerprint},started=Date.now();
 const running=await f.service.handle('start',options);assert.ok(Date.now()-started>25000);assert.ok(running.logs.includes('START-MARKER'));assert.ok(running.logs.length>65536);assert.equal(await(await fetch(running.runningUrl)).text(),'late and valid');await f.service.handle('stop',{sourceId:selected.sourceId});await assert.rejects(fetch(running.runningUrl));
 await assert.rejects(f.service.handle('start',{...options,startupTimeoutMs:-1}),/nonnegative/);
});
test('SETUP-METADATA: metadata exceeds 4 MiB and redirect chains exceed six hops while loops and untrusted hosts fail',async()=>{
 const value={description:'x'.repeat(5*1024*1024)},body=JSON.stringify(value);assert.deepEqual(await catalog.metadata(official,{fetchImpl:async()=>new Response(body)}),value);
 let requests=0;const response=await catalog.officialFetch(official+'/0',{fetchImpl:async url=>{requests++;const n=Number(url.split('/').at(-1));return n<9?new Response(null,{status:302,headers:{location:String(n+1)}}):new Response('complete');}});assert.equal(requests,10);assert.equal(await response.text(),'complete');
 await assert.rejects(catalog.officialFetch(official,{fetchImpl:async()=>new Response(null,{status:302,headers:{location:official}})}),/loop/);
 await assert.rejects(catalog.officialFetch(official,{fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://evil.example/payload'}})}),/outside/);
});
test('SETUP-DOWNLOAD: declared files above 750 MiB enter streaming, cancellation stops writes, and optional budgets are explicit',async t=>{
 const root=directory(t),controller=new AbortController(),declared=751*1024*1024;let progressed=false;
 const response=new Response(new ReadableStream({start(c){c.enqueue(Buffer.from('first chunk'));},cancel(){}}),{headers:{'content-length':String(declared)}});
 await assert.rejects(io.download({url:official,algorithm:'sha256',digest:'0'.repeat(64)},path.join(root,'cancelled'),{fetchImpl:async()=>response,signal:controller.signal,progress(){progressed=true;controller.abort();}}),e=>e.name==='AbortError');assert.equal(progressed,true);
 const bytes=Buffer.from('verified bytes');await io.download({url:official,algorithm:'sha256',digest:digest(bytes)},path.join(root,'valid'),{fetchImpl:async()=>new Response(bytes)});assert.deepEqual(fs.readFileSync(path.join(root,'valid')),bytes);
 await assert.rejects(io.download({url:official,algorithm:'sha256',digest:digest(bytes)},path.join(root,'budget'),{maxBytes:1,fetchImpl:async()=>new Response(bytes)}),/selected byte budget/);
 await assert.rejects(io.download({url:official,algorithm:'sha256',digest:'0'.repeat(64)},path.join(root,'forged'),{fetchImpl:async()=>new Response(bytes)}),/checksum/);
});
test('SETUP-DOWNLOAD: extraction crosses 200,000 entries and 2 GiB advertised metadata without buffering file streams',async t=>{
 const root=directory(t);let count=0;
 // Exercise the extraction policy independently from yauzl's existing ZIP parser
 // tests: virtual directory entries avoid creating 200,000 on-disk directories.
 class Archive extends EventEmitter{readEntry(){queueMicrotask(()=>{if(count++<200001)this.emit('entry',{fileName:'same-directory/',externalFileAttributes:0,uncompressedSize:0});else if(count===200003)this.emit('end');else this.emit('entry',{fileName:'large-advertised-file.bin',externalFileAttributes:0,uncompressedSize:2*1024**3+1});});}openReadStream(_entry,callback){callback(null,Readable.from(['streamed evidence']));}close(){}}
 const ioFile=path.join(__dirname,'../services/setup/io.cjs'),localRequire=require('node:module').createRequire(ioFile),directories=new Set(),virtualFs=Object.create(fs);virtualFs.mkdirSync=(dir,options)=>{if(!directories.has(dir)){fs.mkdirSync(dir,options);directories.add(dir);}};
 const injectedRequire=name=>name==='node:fs'?virtualFs:name===path.join(bundled,'lib/zipBundle.js')?{yauzl:{open:(_file,_options,callback)=>callback(null,new Archive())}}:localRequire(name);injectedRequire.resolve=localRequire.resolve;const module={exports:{}};vm.compileFunction(fs.readFileSync(ioFile,'utf8'),['require','module','exports'])(injectedRequire,module,module.exports);
 await module.exports.extract('virtual.zip',root);assert.equal(count,200003);assert.equal(fs.readFileSync(path.join(root,'large-advertised-file.bin'),'utf8'),'streamed evidence');
 const {yazl}=require(path.join(bundled,'lib/zipBundle.js')),zip=new yazl.ZipFile();zip.addBuffer(Buffer.from('data'),'safe.txt');zip.end();const parts=[];for await(const chunk of zip.outputStream)parts.push(chunk);const archive=put(root,'real.zip',Buffer.concat(parts));
 await assert.rejects(io.extract(archive,path.join(root,'budget'),{maxBytes:1}),/selected extraction budget/);const unsafe=Buffer.concat(parts);for(let at=0;(at=unsafe.indexOf('safe.txt',at))!==-1;at+=8)unsafe.write('../x.txt',at);put(root,'unsafe.zip',unsafe);await assert.rejects(io.extract(path.join(root,'unsafe.zip'),path.join(root,'bad')));assert.equal(fs.existsSync(path.join(root,'x.txt')),false);
});
test('SETUP-DOWNLOAD SETUP-HISTORY: commands preserve all output, support no deadline and long explicit deadlines, and cancel',async t=>{
 const root=directory(t),output=await io.command(process.execPath,['-e',`process.stdout.write('START'+'x'.repeat(20000));setTimeout(()=>process.stdout.write('END'),20);`],{cwd:root,timeout:2**31+1});assert.equal(output.length,20008);assert.ok(output.startsWith('START'));assert.ok(output.endsWith('END'));
 await assert.rejects(io.command(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:root,timeout:20}),/selected deadline/);
 const controller=new AbortController(),pending=io.command(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:root,signal:controller.signal});setTimeout(()=>controller.abort(),50);await assert.rejects(pending,e=>e.name==='AbortError');
});
test('SETUP-HISTORY: more than 30 jobs/previews and 16,000-character logs survive; a preview does not expire by elapsed time',async t=>{
 const root=directory(t),setup=path.join(root,'setup');fs.mkdirSync(setup);const saved=Array.from({length:31},()=>({id:crypto.randomUUID(),itemId:'junit',status:'SUCCESS',log:'ORIGINAL'+'x'.repeat(20000)}));fs.writeFileSync(path.join(setup,'jobs.json'),JSON.stringify(saved));
 const execution={async handle(action){if(action==='runtimeConfiguration')return{};if(action==='configureRuntimes')return{};return{engines:[{id:'junit',available:true}],runtimes:{}};}};
 const service=createSetup({dataDir:setup,execution,getWorkspaceRoot:()=>root,assertTrusted:()=>{},platform:'win32',arch:'x64',resolveArtifacts:async()=>({artifacts:[]}),command:async(_file,_args,{log})=>{log('BEGIN'+'x'.repeat(30000)+'END');return '';}});t.after(()=>service.close());
 // playwright performs real command orchestration through the injected runner,
 // without downloading software or touching the user's configured runtimes.
 const clock=Date.now;let first;try{Date.now=()=>0;first=await service.handle('preview',{itemId:'playwright'});}finally{Date.now=clock;}
 for(let i=0;i<35;i++)await service.handle('preview',{itemId:'playwright'});const job=await service.handle('start',{planId:first.id,consent:true});
 let finished;do{finished=await service.handle('get',{id:job.id});if(['SUCCESS','NEEDS_ATTENTION','ERROR'].includes(finished.status))break;await new Promise(r=>setTimeout(r,10));}while(true);
 assert.notEqual(finished.status,'ERROR');assert.ok(finished.log.includes('BEGIN'));assert.ok(finished.log.length>60000);const jobs=await service.handle('jobs');assert.equal(jobs.length,32);assert.equal(jobs[0].id,saved[0].id);assert.equal(jobs[0].log,saved[0].log);await assert.rejects(service.handle('start',{planId:first.id,consent:true}),/expired/);
});
test('BASELINES: images/count/bytes/dimensions/pixels above old boundaries validate and round-trip; corrupt imports preserve old data',async t=>{
 const root=directory(t),service=createPreview({BrowserWindow:PreviewWindow,dataDir:root,getWorkspaceRoot:()=>root,nativeImage});t.after(()=>service.close());
 const tiny=png(1,1),wide=png(8193,1),manyPixels=png(4097,4097),large=png(1537,2048,true);assert.ok(large.length>12*1024*1024);
 const archive={schemaVersion:1,type:'lvx-native-baselines',workspaceBinding:digest(root),items:[...Array.from({length:201},(_,i)=>baseline(tiny,'tiny-'+i)),baseline(wide,'wide'),...Array.from({length:4},(_,i)=>baseline(manyPixels,'pixels-'+i)),baseline(large,'large')]};
 const valid=await service.handle('validateBaselines',{archive});assert.equal(valid.items,207);assert.ok(valid.bytes>12*1024*1024);assert.ok(valid.decodedPixels>64000000);assert.equal((await service.handle('importBaselines',{archive})).imported,207);const exported=await service.handle('exportBaselines');assert.equal(exported.items.length,207);assert.ok(exported.items.some(x=>x.bytes>8*1024*1024));
 const before=exported.items.map(x=>[x.id,x.sha256]).sort();await assert.rejects(service.handle('importBaselines',{archive:{...archive,items:[{...archive.items[0],sha256:'0'.repeat(64)}]}}),/checksum/);assert.deepEqual((await service.handle('exportBaselines')).items.map(x=>[x.id,x.sha256]).sort(),before);
 await assert.rejects(service.handle('validateBaselines',{archive:{...archive,items:[archive.items[0],archive.items[0]]}}),/Duplicate/);
});
test('WAIT-STEP: waits exceed one minute, 0 has no deadline, twelve sessions coexist, and closing cancels a pending wait',async t=>{
 const root=directory(t),service=createPreview({BrowserWindow:PreviewWindow,dataDir:root,getWorkspaceRoot:()=>root});t.after(()=>service.close());
 const opened=await Promise.all(Array.from({length:12},()=>service.handle('open',{target:{version:1,kind:'url',url:'https://fixture.example.test'}})));assert.equal(service.size,12);
 for(const timeout of [60001,2**31+1,0])assert.match((await service.handle('step',{id:opened[0].id,name:'Wait For Element',params:{selector:'h1',timeout}})).logs[0],/Waited/);
 await assert.rejects(service.handle('step',{id:opened[0].id,name:'Wait For Element',params:{selector:'h1',timeout:-1}}),/nonnegative/);
 let window;
 // A separate window fixture represents a selector that never arrives.
 class Missing extends PreviewWindow{constructor(){super();window=this;this.webContents.executeJavaScriptInIsolatedWorld=async(_world,[{code}])=>({ok:true,value:code.includes('"operation":"exists"')?false:'<html></html>'});}}
 const missing=createPreview({BrowserWindow:Missing,dataDir:path.join(root,'missing'),getWorkspaceRoot:()=>root});t.after(()=>missing.close());const session=await missing.handle('open',{target:{version:1,kind:'url',url:'https://fixture.example.test'}}),waiting=missing.handle('step',{id:session.id,name:'Wait For Element',params:{selector:'.never',timeout:0}}),rejected=assert.rejects(waiting,/closed/);setTimeout(()=>window.destroy(),20);await rejected;assert.equal(missing.size,0);
});
test('LEGACY-NETWORK-CHECKS: CI and collaboration connection checks pass an unlimited timeout to protected requests',async()=>{
 for(const [file,instance,method]of[['cicd-integration.js','cicdConfiguration','testConnection'],['collaboration.js','collaborationManager','testBackendConnection']]){
  const storage=new Map(),requests=[],scheduled=[];const context={window:{addEventListener(){},location:{hash:''},LVXCredentials:{request:async(url,options)=>{requests.push({url,options});return{ok:true,json:async()=>({healthy:true})};}}},document:{addEventListener(){}},localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},URL,console:{log(){},error(){}},setTimeout:(fn,ms)=>{scheduled.push(ms);return 0;},clearTimeout(){},AbortController};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);const manager=context.window[instance];storage.set(manager.STORAGE_KEY||manager.BACKEND_CONFIG_KEY,JSON.stringify({backendUrl:'https://backend.example.test',apiKey:'fixture-key',enabled:true}));assert.equal((await manager[method]()).success,true);assert.equal(requests[0].options.timeout,0);assert.deepEqual(scheduled,[]);
 }
});
