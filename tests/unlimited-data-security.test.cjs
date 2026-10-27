'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),datasets=require('../services/workspace/datasets.cjs'),mock=require('../mock-runtime.js'),{scanSource}=require('../services/security/source-scanner.cjs'),{inventory}=require('../services/security/inventory.cjs'),{createService}=require('../services/security/index.js');
function browser(files){const values=new Map(),nodes=new Map();const document={readyState:'loading',addEventListener(){},getElementById(id){if(!nodes.has(id))nodes.set(id,{classList:{},innerHTML:''});return nodes.get(id);},querySelectorAll(){return[];}};const ctx={console:{log(){},warn(){},error(){}},document,localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v))},TextDecoder,TextEncoder,setTimeout,clearTimeout,Date,Math,Blob,URL,AbortController};ctx.window=ctx;vm.createContext(ctx);for(const file of files)vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});return {ctx,values,nodes};}
function temporary(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lvx-unlimited-data-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
const encrypted={isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'test-encrypted',encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};

test('FIXTURE-DATA: all CSV/JSON/Excel rows, columns and bytes survive former limits; unsafe headers remain refused',async()=>{
 const headers=Array.from({length:501},(_,i)=>'c'+i),row=Object.fromEntries(headers.map(h=>[h,'0']));
 assert.equal(mock.normalizeFileData({headers,rows:[row]}).headers.length,501);
 const many=mock.parseDataFile('id\n'+Array.from({length:10001},(_,i)=>i).join('\n'),'many.csv');assert.equal(many.rows.length,10001);assert.equal(many.rows.at(-1).id,'10000');
 const large='x'.repeat(10*1024*1024+1);assert.equal(mock.parseDataFile(JSON.stringify([{value:large}]),'large.json').rows[0].value.length,large.length);
 assert.equal((await mock.readDataFile({name:'large.json',size:large.length,text:async()=>JSON.stringify([{value:large}])})).rows[0].value.length,large.length);
 let opts;const xlsx={read(_b,o){opts=o;return {SheetNames:['data'],Sheets:{data:{'!ref':'A1:SG10002'}}};},utils:{sheet_to_json(){return [headers,...Array.from({length:10001},()=>headers.map(()=>0))];}}};
 const excel=mock.parseDataFile(Buffer.from([80,75,3,4]),'wide.xlsx',{xlsx});assert.equal(opts.sheetRows,undefined);assert.equal(excel.rows.length,10001);assert.equal(excel.headers.length,501);
 assert.throws(()=>mock.parseDataFile('id\n"bad','bad.csv'),/quote/i);assert.throws(()=>mock.normalizeFileData({headers:['__proto__'],rows:[{}]}),/headers/i);assert.throws(()=>mock.parseDataFile(Buffer.from([255]),'bad.csv'),/encoded|encoding/i);
});
test('DATA-EDITOR/OLDER-DATA-GENERATOR: streamed CSV crosses row/column/field limits without corrupting quoted UTF-8',async()=>{
 const {ctx,nodes}=browser(['data-manager.js']),manager=ctx.dataManager;
 const source='id\n'+Array.from({length:100001},(_,i)=>i).join('\n');const parsed=await manager.parseCSVFile(new Blob([source]));assert.equal(parsed.data.length,100001);assert.equal(parsed.data.at(-1).id,'100000');
 const headers=Array.from({length:501},(_,i)=>'c'+i),wide=await manager.parseCSVFile(new Blob([headers.join(',')+'\n'+headers.map(()=>0).join(',')]));assert.equal(wide.headers.length,501);
 const text='A'.repeat(1024*1024+1)+'\n'+String.fromCharCode(197),value=await manager.parseCSVFile(new Blob(['name\n"'+text+'"']));assert.equal(value.data[0].name,text);
 await assert.rejects(manager.parseCSVFile(new Blob([source]),{maxRows:2}),/too large/);await assert.rejects(manager.parseCSVFile(new Blob(['a\n"bad'])),/quote/i);assert.equal(manager.generateFakerData('{{number:0:0}}',1001).length,1001);assert.throws(()=>manager.generateFakerData('{{email}}',NaN),/positive/);
 const id=manager.saveDataSet({name:'all rows',headers:['id'],data:parsed.data});ctx.selectDataSetForView(id,500);assert.match(nodes.get('data-set-details').innerHTML,/100000/);assert.match(nodes.get('data-set-details').innerHTML,/Page 501 of 501/);assert.match(nodes.get('data-set-details').innerHTML,/all 100001 rows are available/);
});
test('DATA-GENERATOR: generation/masking exceed 100k rows and 32MiB estimate, preserve source and yield to cancellation',async()=>{
 const schema=[{name:'long-column-name-'.repeat(30),type:'integer',min:0,max:0}];const generated=await datasets.generateDataset({schema,count:100001,seed:'repeat'});assert.equal(generated.rows.length,100001);assert.equal(generated.rows.at(-1)[schema[0].name],0);
 const masked=await datasets.maskDataset({rows:generated.rows,columns:[schema[0].name]});assert.equal(masked.rows.length,100001);assert.equal(generated.rows[0][schema[0].name],0);assert.equal(masked.rows[0][schema[0].name],masked.rows.at(-1)[schema[0].name]);
 const long=await datasets.generateDataset({schema:[{name:'text',type:'string',min:100001,max:100001}],count:1});assert.equal(long.rows[0].text.length,100001);
 const wide=await datasets.generateDataset({schema:Array.from({length:501},(_,i)=>({name:'x'+i,type:'integer'})),count:1});assert.equal(Object.keys(wide.rows[0]).length,501);
 const abort=new AbortController(),pending=datasets.generateDataset({schema,count:1000000,signal:abort.signal});setImmediate(()=>abort.abort());await assert.rejects(pending,/abort/i);
 await assert.rejects(datasets.generateDataset({schema,count:Infinity}),/positive/);await assert.rejects(datasets.generateDataset({schema:[{name:'n',type:'integer',min:.1,max:.2}],count:1}),/whole-number/);await assert.rejects(datasets.maskDataset({rows:[null],columns:['n']}),/objects/);
});
test('DATA-VALIDATION-REPORT: complete errors/samples by default, unbounded explicit budgets and streamed CSV validity',async t=>{
 const schema=[{name:'n',type:'integer',required:true}],rows=Array.from({length:10001},()=>({n:'invalid'}));
 const all=await datasets.validateDataset({schema,rows});assert.equal(all.errors.length,10001);assert.equal(all.sample.length,10001);assert.equal(all.errorsTruncated,false);
 const explicit=await datasets.validateDataset({schema,rows,maxErrors:10001,sampleSize:10001});assert.equal(explicit.errors.length,10001);assert.equal(explicit.sample.length,10001);
 const small=await datasets.validateDataset({schema,rows,maxErrors:1,sampleSize:1});assert.equal(small.errorCount,10001);assert.equal(small.errorsTruncated,true);assert.equal(small.sample.length,1);
 const dir=temporary(t),headers=Array.from({length:501},(_,i)=>'x'+i),large='a'.repeat(1024*1024+1);fs.writeFileSync(path.join(dir,'large.csv'),headers.join(',')+'\n'+[large,...headers.slice(1).map(()=>0)].join(','));
 const streamed=await datasets.validateDataset({filePath:'large.csv',schema:[{name:'x0',type:'string'}]},dir);assert.equal(streamed.sample[0].x0.length,large.length);
 const records=[];for await(const row of datasets.csvRecords([Buffer.from('name,value\n"A\nB","x""y"')]))records.push(row);assert.deepEqual(records,[['name','value'],['A\nB','x"y']]);
 await assert.rejects(async()=>{for await(const row of datasets.csvRecords(['a,b\nx,y'],{maxColumns:1}))void row;},{code:'CSV_LIMIT'});await assert.rejects(datasets.validateDataset({schema,rows,maxErrors:-1}),/nonnegative/);
 const outside=path.join(path.dirname(dir),'outside-'+path.basename(dir)+'.csv');fs.writeFileSync(outside,'n\n1');t.after(()=>fs.unlinkSync(outside));await assert.rejects(datasets.validateDataset({schema,filePath:outside},dir),{code:'PATH_SCOPE'});
});
test('REPORTING-HISTORY/OTHER-HISTORY: every execution, security finding and notification remains available',()=>{
 const {ctx}=browser(['reporting-dashboard.js','security-testing.js','integrations.js']);
 const history=ctx.testHistoryManager;for(let i=0;i<1001;i++)history.recordExecution('suite','suite',{status:'PASSED'});assert.equal(history.getHistory().length,1001);assert.equal(history.getSuiteHistory('suite').length,1001);
 const security=ctx.securityManager;for(let i=0;i<101;i++)security._saveToHistory({id:i,summary:{},vulnerabilities:[{severity:'HIGH'}]});assert.equal(security.getHistory().length,101);assert.equal(security.getStatistics().totalScans,101);
 const integrations=ctx.integrationManager||ctx.integrationsManager;assert.ok(integrations);for(let i=0;i<101;i++)integrations.recordNotification({id:i,name:'i',type:'webhook'},{suiteName:'s',status:'PASSED'},true);assert.equal(integrations.getNotificationHistory().length,101);assert.equal(integrations.getNotificationHistory()[0].integrationId,100);assert.equal(integrations.getNotificationHistory().at(-1).integrationId,0);
});
test('SECURITY-SOURCES: service and scanner accept 501 files and >2MiB sources without false coverage',async t=>{
 const dir=temporary(t),service=createService({dataDir:dir,workspaceRoot:dir,safeStorage:encrypted});t.after(()=>service.close());
 const large='//'+ ' '.repeat(2*1024*1024+1)+'\neval("1")',files=Array.from({length:501},(_,i)=>({path:'f'+i+'.js',content:i===500?large:'const n=1;'}));const result=await service.handle('scan',{kind:'source',files});assert.equal(result.coverage.scanned,501);assert.equal(result.coverage.complete,true);assert.equal(result.findings[0].path,'f500.js');assert.equal(result.findings[0].line,2);
 fs.writeFileSync(path.join(dir,'large.js'),large);assert.equal((await service.handle('scan',{kind:'source',files:[{path:'large.js'}]})).coverage.complete,true);
 const invalid=scanSource([{path:'file.unknown',content:'x'},{path:'file.js',content:null}]);assert.equal(invalid.coverage.complete,false);assert.equal(invalid.errors.length,2);
 const controller=new AbortController(),pending=service.handle('scan',{kind:'source',files,signal:controller.signal});controller.abort();await assert.rejects(pending,/abort/i);
 await assert.rejects(service.handle('scan',{kind:'source',files:[{path:'../escape.js'}]}),/workspace|scope|ENOENT/i);
});
test('SECURITY-INVENTORY/SECRET-STATE: >32MiB inventory and >16MiB encrypted state survive restart; invalid/trust protections remain',async t=>{
 const dir=temporary(t),source=' '.repeat(32*1024*1024+1)+'{"dependencies":{"pkg":{"version":"1.0.0"}}}';assert.equal(inventory(source,'package-lock').packages.length,1);assert.throws(()=>inventory('bad','package-lock'),/JSON/i);
 const service=createService({dataDir:dir,workspaceRoot:dir,safeStorage:encrypted});fs.writeFileSync(path.join(dir,'package-lock.json'),source);assert.equal((await service.handle('inventory',{path:'package-lock.json'})).packages.length,1);
 const value='private-'.repeat(2200000),stored=await service.handle('storeSecret',{label:'L'.repeat(121),value});assert.equal(service.resolveSecret(stored.reference),value);assert.equal(JSON.stringify(await service.handle('diagnostics')).includes('private-'),false);service.close();
 const reopened=createService({dataDir:dir,workspaceRoot:dir,safeStorage:encrypted});t.after(()=>reopened.close());assert.equal(reopened.resolveSecret(stored.reference),value);assert.equal((await reopened.handle('diagnostics')).limits.sourceFiles,0);
 await assert.rejects(reopened.handle('storeSecret',{label:'x',value:''}),/nonempty/);const unavailable=createService({dataDir:path.join(dir,'locked'),workspaceRoot:dir,safeStorage:{isEncryptionAvailable:()=>false}});await assert.rejects(unavailable.handle('storeSecret',{label:'x',value:'secret'}),/unavailable/i);unavailable.close();
});
test('SECURITY-ADAPTER: >4MiB configs and >8MiB findings, complete stderr/stdin; native cancellation and authorization remain',async t=>{
 const dir=temporary(t),file=path.join(dir,'Dockerfile');fs.writeFileSync(file,'FROM fixture:latest\nUSER user\n'+'#'.repeat(4*1024*1024+1)+'\n'+Array.from({length:40000},(_,i)=>'ENV SECRET_'+i+'=test').join('\n'));
 const service=createService({dataDir:dir,workspaceRoot:dir,safeStorage:encrypted});t.after(()=>service.close());await service.handle('trust',{trusted:true});await service.handle('installAdapter',{id:'local-config-v1'});
 const request={kind:'infrastructure',adapterId:'local-config-v1',mode:'dockerfile',target:'Dockerfile',authorizedTargets:['Dockerfile']};const result=await service.handle('scan',request);assert.equal(result.findings.length,40001);assert.equal(result.coverage.complete,true);assert.ok(JSON.stringify(result).length>8*1024*1024);
 await assert.rejects(service.handle('scan',{...request,authorizedTargets:[]}),/authorization/);const abort=new AbortController(),pending=service.handle('scan',{...request,signal:abort.signal});abort.abort();await assert.rejects(pending,/cancel/i);
 const cli=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'services/security/adapters/local-config-v1.cjs')],{windowsHide:true});let output='';child.stdout.on('data',b=>output+=b);child.on('error',reject);child.on('close',code=>resolve({code,result:JSON.parse(output)}));child.stdin.end(JSON.stringify({mode:'dockerfile',target:file,padding:' '.repeat(5*1024*1024+1)}));});assert.equal(cli.code,0);assert.equal(cli.result.findings.length,40001);
});
test('FIXTURE-WAITS: waits beyond 5 minutes and timer range remain pending until cancellation',async()=>{
 const suite={mock_builder:{setupSteps:[{action:'wait',delayMs:300001}],teardownSteps:[]}};assert.equal(mock.buildSuiteExecutionPlan(suite).beforeDelayMs,300001);
 const controller=new AbortController(),pending=mock.delay(2147483648,controller.signal);let done=false;pending.catch(()=>done=true);await new Promise(r=>setTimeout(r,10));assert.equal(done,false);controller.abort();await assert.rejects(pending,/cancel/i);await assert.rejects(mock.delay(-1),/nonnegative/);assert.throws(()=>mock.buildSuiteExecutionPlan({mock_builder:{setupSteps:[{action:'wait',delayMs:Infinity}]}}),/safe-integer|milliseconds/);
});
test('SECURITY-ADAPTER: a native scan can finish after the old 20-second deadline; >1MiB stderr does not stop it',async t=>{
 const crypto=require('node:crypto'),dir=temporary(t),service=createService({dataDir:dir,workspaceRoot:dir,safeStorage:encrypted});t.after(()=>service.close());await service.handle('trust',{trusted:true});await service.handle('installAdapter',{id:'local-config-v1'});
 // Fixture implementation uses the same reviewed version/hash contract as an installed adapter.
 const adapterDir=path.join(dir,'security','adapters','local-config-v1'),source="process.stderr.write('x'.repeat(1024*1024+1));setTimeout(()=>process.stdout.write(JSON.stringify({schemaVersion:1,findings:[],errors:[],coverage:{complete:true}})),20025);";
 fs.writeFileSync(path.join(adapterDir,'adapter.cjs'),source);fs.writeFileSync(path.join(adapterDir,'manifest.json'),JSON.stringify({schemaVersion:1,id:'local-config-v1',version:'1.0.0',sha256:crypto.createHash('sha256').update(source).digest('hex')}));
 const before=Date.now(),result=await service.handle('scan',{kind:'infrastructure',adapterId:'local-config-v1',mode:'docker-container',target:'fixture',authorizedTargets:['fixture']});assert.ok(Date.now()-before>20000);assert.equal(result.coverage.complete,true);assert.equal(result.status,'SUCCESS');
 await assert.rejects(service.handle('scan',{kind:'infrastructure',adapterId:'local-config-v1',mode:'docker-container',target:'fixture',authorizedTargets:['fixture'],timeoutMs:5}),/timed out/);
});
test('SECURITY-ADAPTER: Docker response bytes/time and endpoint response time have no hidden adapter ceilings',async()=>{
 const source=fs.readFileSync(path.join(root,'services/security/adapters/local-config-v1.cjs'),'utf8');let options;
 const custom=(command,args,opts,cb)=>{options=opts;cb(null,{stdout:JSON.stringify([{padding:'x'.repeat(4*1024*1024+1),Config:{User:'nonroot'},HostConfig:{}}])});};
 // util.promisify normally adds execFile's custom wrapper. The fixture preserves its result shape.
 custom[require('node:util').promisify.custom]=async(command,args,opts)=>{options=opts;return {stdout:JSON.stringify([{padding:'x'.repeat(4*1024*1024+1),Config:{User:'nonroot'},HostConfig:{}}])};};
 const context={module:{exports:{}},require:name=>name==='node:child_process'?{execFile:custom}:require(name),fetch:async(url,opts)=>{assert.equal(opts.signal,undefined);return {ok:true,status:200,headers:{get:()=> 'present'}};},URL,Buffer,process};vm.createContext(context);vm.runInContext(source,context);
 const docker=await context.module.exports.scan({mode:'docker-container',target:'fixture'});assert.equal(options.timeout,0);assert.equal(options.maxBuffer,Infinity);assert.equal(docker.coverage.complete,true);
 assert.equal((await context.module.exports.scan({mode:'endpoint',target:'https://example.test'})).coverage.complete,true);
});
