'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{pathToFileURL}=require('node:url');
const capacity=require('../services/capacity.cjs'),source=require('../services/machina/source.cjs'),{runProcess}=require('../services/machina/process.cjs'),{zip,crc32}=require('../services/machina/zip.cjs'),Graph=require('../graph-engine.js');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function folder(t,prefix='lvx-uncapped-runtime-'){const root=fs.mkdtempSync(path.join(os.tmpdir(),prefix));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('zero budgets have no timer and long deadlines do not overflow; cancellation and invalid input remain effective',async()=>{
 const parent=new AbortController(),budget=capacity.deadline(0,parent.signal);await pause(15);assert.equal(budget.signal.aborted,false);parent.abort();assert.equal(budget.signal.aborted,true);budget.dispose();
 let fired=false;const clear=capacity.longTimeout(()=>fired=true,2**31+100);await pause(15);assert.equal(fired,false);clear();
 const controller=new AbortController(),waiting=capacity.wait(2**31+100,controller.signal);controller.abort();await assert.rejects(waiting,{name:'AbortError'});
 for(const invalid of [-1,Infinity,NaN,true,{},''])assert.throws(()=>capacity.nonnegative(invalid));
});
test('source collection and explicit selection include all files and large source text, with cancellable cooperative reads',async t=>{
 const root=folder(t);for(let i=0;i<601;i++)fs.writeFileSync(path.join(root,`case-${i}.js`),'export const x=1;');const large='// '+ 'x'.repeat(2*1024*1024+1);fs.writeFileSync(path.join(root,'large.js'),large);
 let heartbeat=false;setImmediate(()=>heartbeat=true);const all=await source.sourceFiles(root);assert.equal(heartbeat,true);assert.equal(all.length,602);assert.equal(all.coverage.complete,true);assert.equal(all.find(f=>f.relativePath==='large.js').content,large);
 const selected=await source.resolveSource(root,{sourceStrategy:'files',sourceFiles:all.map(f=>f.relativePath)});assert.equal(selected.sourceFiles.length,602);assert.ok(selected.source.includes(large));
 const budget=await source.sourceFiles(root,{maxFiles:501,maxSourceChars:0});assert.equal(budget.length,501);assert.equal(budget.coverage.complete,false);
 const controller=new AbortController();const read=source.sourceFiles(root,{},controller.signal);controller.abort();await assert.rejects(read,{name:'AbortError'});
 await assert.rejects(source.resolveSource(root,{sourceStrategy:'files',sourceFiles:['../outside.js']}),/outside|does not exist/);
});
test('source inventory scans past twenty thousand real filesystem entries',async t=>{
 const root=folder(t);for(let i=0;i<20001;i++)fs.writeFileSync(path.join(root,`asset-${i}.txt`),'');fs.writeFileSync(path.join(root,'z.js'),'const complete=true;');const files=await source.sourceFiles(root);assert.equal(files.length,1);assert.equal(files[0].relativePath,'z.js');assert.equal(files.coverage.complete,true);
});
test('process output preserves the beginning and ending beyond the old two-MiB tail with no default deadline',async()=>{
 const text='BEGIN'+ 'z'.repeat(2*1024*1024+23)+'END',result=await runProcess(process.execPath,['-e',`process.stdout.write('BEGIN'+'z'.repeat(${2*1024*1024+23})+'END')`],{timeoutMs:86400001});assert.equal(result.stdout,text);assert.equal(result.exitCode,0);
 const controller=new AbortController(),pending=runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:controller.signal,timeoutMs:0});await pause(30);controller.abort();await assert.rejects(pending,{name:'AbortError'});
});
test('ZIP logs exceed former count and total-byte ceilings and switch to ZIP64 at format boundaries',()=>{
 const many=zip(Array.from({length:65536},(_,i)=>({filename:`log-${i}.txt`,content:''})));assert.equal(many.readUInt32LE(many.length-98),0x06064b50);assert.equal(many.readBigUInt64LE(many.length-98+24),65536n);assert.equal(many.readUInt32LE(many.length-22),0x06054b50);
 const content=Buffer.alloc(64*1024*1024+1,1),archive=zip([{filename:'large.log',content}]);assert.equal(archive.readUInt32LE(18),content.length);assert.equal(archive.readUInt32LE(14),crc32(content));assert.equal(archive.length,content.length+116);
 assert.throws(()=>zip([{filename:'../escape',content:''}]),/relative/);assert.throws(()=>zip([{filename:'same',content:''},{filename:'same',content:''}]),/unique/);
});
test('workflow validation and execution accept concurrency and retry policies beyond the former caps',async()=>{
 const graph={schemaVersion:1,concurrency:33,nodes:[{id:'long-'+ 'x'.repeat(128),type:'script',data:{engine:'javascript',code:'assert(true);'},retry:{maxAttempts:22,backoffMs:0}}],edges:[]};assert.equal(Graph.validate(graph,{strict:true}).valid,true);let attempts=0;
 const result=await new Graph().execute(graph,async()=>({status:++attempts===22?'SUCCESS':'FAILURE',total:1,passed:attempts===22?1:0,failed:attempts===22?0:1}));assert.equal(attempts,22);assert.equal(result.status,'SUCCESS');assert.equal(Graph.validate({...graph,concurrency:Infinity}).valid,false);
 const controller=new AbortController(),long=Graph.waitDelay(2**31+10,controller.signal);controller.abort();await long;
});
test('visual compilation accepts more than one thousand steps and deep/repeated valid checks',async()=>{
 const {compileSteps}=await import(pathToFileURL(path.resolve(__dirname,'../studio-model.js')).href);let nested=[{type:'compare',actual:'a',expected:'a'}];for(let i=0;i<40;i++)nested=[{type:'repeat',count:1,children:nested}];const code=compileSteps([...Array.from({length:1001},()=>({type:'compare',actual:'a',expected:'a'})),...nested,{type:'repeat',count:10001,children:[{type:'compare',actual:'a',expected:'a'}]}]);assert.match(code,/Completed 1044 visual steps/);assert.ok(code.includes('<10001'));assert.throws(()=>compileSteps([{type:'repeat',count:Infinity,children:[]}]),/positive|integer/);
});
test('website audit plans accept all routes, actions, viewports and interaction counts without local maxima',t=>{
 const root=folder(t),plan=require('../services/machina/browser-plan.cjs').plan(root,{sourceMode:'live-url',websiteUrl:'https://example.test',routePaths:Array.from({length:51},(_,i)=>'/'+i),customScenarios:Array.from({length:101},()=>({actions:Array.from({length:101},()=>({type:'wait',ms:60001}))})),viewports:Array.from({length:9},()=>({width:4000,height:2200})),maxAutoInteractions:101,waitAfterActionMs:10001},{});assert.equal(plan.routePaths.length,51);assert.equal(plan.customScenarios.length,101);assert.equal(plan.viewports.length,9);assert.equal(plan.maxAutoInteractions,101);
 assert.throws(()=>require('../services/machina/browser-plan.cjs').plan(root,{sourceMode:'live-url',websiteUrl:'file:///escape'},{}),/HTTP/);
});
test('HTTP accepts large bodies, more assertions/connections/samples and optional unlimited load duration',async()=>{
 const http=require('../services/machina/http.cjs'),large='x'.repeat(8*1024*1024+1);let received;
 const result=await http.performanceTest({url:'https://example.test',method:'POST',body:large,timeoutMs:120001,assertions:Array.from({length:501},()=>({type:'status',value:200}))},{resolve:async x=>x,fetch:async(u,options)=>{received=options.body;return new Response(large,{status:200});}});assert.equal(received,large);assert.equal(result.total,501);assert.equal(result.artifacts.responseBody,large);
 const load=await http.performanceTest({url:'https://example.test',duration:0,connections:65,maxRequests:101},{resolve:async x=>x,fetch:async()=>new Response('ok')});assert.equal(load.artifacts.loadTest.completedRequests,101);assert.equal(load.artifacts.loadTest.samples.length,101);
 assert.throws(()=>http.operator('x','matches','['));
});
test('deep schemas and long expressions validate while reference cycles and stuck workers remain cancellable',async()=>{
 const {schemaValidate,operator}=require('../services/machina/http.cjs');let schema={type:'number'},value=7;for(let i=0;i<100;i++){schema={type:'object',properties:{value:schema}};value={value};}assert.equal(schemaValidate(value,schema).violations.length,0);assert.equal(operator('a'.repeat(513),'matches','a'.repeat(513)),true);
 assert.throws(()=>schemaValidate(1,{$defs:{loop:{$ref:'#/$defs/loop'}},$ref:'#/$defs/loop'}),/cycle/);
 const controller=new AbortController(),work=require('../services/machina/validation.cjs').validate({kind:'operator',actual:'a'.repeat(30000)+'!',operator:'matches',expected:'(a+)+$'},controller.signal);await pause(60);controller.abort();await assert.rejects(work,{name:'AbortError'});
});
test('native protocol accepts a result frame beyond thirty-two MiB without losing typed evidence',()=>{
 const {createProtocol}=require('../services/execution/python-protocol.cjs');let result,error;const protocol=createProtocol({onOutput:()=>{},onResult:value=>result=value,onError:value=>error=value}),text='x'.repeat(32*1024*1024+1);protocol.push(Buffer.from(JSON.stringify({type:'result',result:{status:'SUCCESS',artifact:text}})+'\n'));protocol.end();assert.equal(error,undefined);assert.equal(result.artifact,text);
});
test('screenshot comparison handles valid images above the old sixteen-million-pixel threshold',()=>{
 const {PNG}=require(path.join(path.dirname(require.resolve('playwright-core/package.json')),'lib/utilsBundle.js')),png=new PNG({width:4001,height:4000});png.data.fill(255);const bytes=PNG.sync.write(png),result=require('../services/machina/visual-assertions.cjs').compareScreenshots(bytes,bytes);assert.equal(result.passed,true);assert.equal(result.diffPercentage,0);
});
test('native execution preserves full logs and validates large execution configurations and long schedules',async t=>{
 const root=folder(t),service=require('../services/execution/index.cjs').createService({workspaceRoot:root,dataDir:path.join(root,'.runtime')});t.after(()=>service.close());const started=await service.handle('start',{engine:'javascript',code:`process.stdout.write('BEGIN'+'a'.repeat(${1024*1024+9})+'END');assert(true);`,timeoutMs:86400001});let run;for(let i=0;i<1000;i++){run=await service.handle('getRun',{id:started.id});if(run.status!=='RUNNING')break;await pause(10);}assert.equal(run.status,'SUCCESS',run.error);assert.ok(run.stdout.startsWith('BEGIN'));assert.ok(run.stdout.endsWith('END'));assert.ok(run.stdout.length>1024*1024);
 const configuration={format:'lvx-execution-configuration',schemaVersion:1,fixtures:Array.from({length:1001},(_,i)=>({id:'fixture-'+i,version:1,name:'Fixture '+i,engine:'javascript',setup:'',cleanup:''})),schedules:[]};assert.equal((await service.handle('validateConfiguration',{configuration})).valid,true);
 const workflow={schemaVersion:1,nodes:[{id:'one',type:'script',data:{engine:'javascript',code:'assert(true);'}}],edges:[]};const schedule=await service.handle('saveSchedule',{workflow,name:'Long schedule',intervalMs:31536000001,enabled:false,missedRun:'skip'});assert.equal(schedule.intervalMs,31536000001);await assert.rejects(service.handle('saveSchedule',{workflow,intervalMs:Infinity,enabled:false,missedRun:'skip'}),/positive/);
});
