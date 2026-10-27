'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createService}=require('../services/github-studio/remote.cjs');
const {createDemoTransport}=require('../services/github-studio/demo-remote.cjs');
const {run}=require('../services/api-atlas/runner.cjs');
const {discover}=require('../services/api-atlas/discovery.cjs');
test('API source acquisition reads immutable blobs without expanding source publishing permissions',async()=>{
  const transport=createDemoTransport({repository:'fixture/apis',files:[{path:'openapi.yaml',content:'openapi: 3.0.3\ninfo: {title: Provider, version: "1"}\npaths: {}\n'},{path:'src/server.ts',content:"app.get('/health', handler)"},{path:'.github/workflows/ci.yml',content:'name: CI\non: push\njobs: {}\n'},{path:'node_modules/pkg/source.js',content:'dependency'},{path:'images/picture.png',content:'binary'}]});
  const remote=createService({workspaceRoot:'fixture-root',fetch:transport});
  try{
    const snapshot=await remote.handle('snapshot',{workspaceRoot:'fixture-root',repository:'fixture/apis',scope:'workflows'});
    const sources=await remote.handle('apiSources',{workspaceRoot:'fixture-root',repository:'fixture/apis',commit:snapshot.commit});
    assert.ok(sources.files.some(file=>file.path==='src/server.ts'));assert.ok(sources.files.some(file=>file.path==='openapi.yaml'));
    assert.ok(!sources.files.some(file=>file.path.startsWith('node_modules/')||file.path.endsWith('.png')));
    assert.equal(require('../services/github-studio/remote.cjs').classify('src/server.ts'),null);
    assert.ok(transport.state.calls.every(call=>!call.method||call.method==='GET'));
    await assert.rejects(remote.handle('apiSources',{workspaceRoot:'other-root',repository:'fixture/apis',commit:snapshot.commit}),/Workspace changed/);
    await assert.rejects(remote.handle('apiSources',{workspaceRoot:'fixture-root',repository:'fixture/apis',commit:'moving-branch'}),/immutable/);
  }finally{await remote.close();}
});
test('Exact protected response assertions resolve in the runner before comparing and redact after comparison',async()=>{
  const reference='secret:11111111-1111-4111-8111-111111111111';
  const result=await run({kind:'contract',method:'GET',url:'http://fixture.test/token',expectedStatus:200,timeoutMs:1000,expectedBody:{token:reference},expectedHeaders:{authorization:'Bearer '+reference}}, {resolveSecret:()=> 'actual-private-value',redact:value=>JSON.parse(JSON.stringify(value).split('actual-private-value').join('[REDACTED]')),fetch:async()=>new Response(JSON.stringify({token:'actual-private-value'}),{headers:{'content-type':'application/json',authorization:'Bearer actual-private-value'}})});
  assert.equal(result.status,'PASSED');assert.ok(result.checks.every(check=>check.passed));assert.ok(!JSON.stringify(result).includes('actual-private-value'));
});
test('Malformed imports, mounted routes and dynamic HTTP calls remain truthful source evidence',async()=>{
  const output=await discover([{id:'consumer',fullName:'fixture/consumer',commit:'c'.repeat(40),skipped:[{path:'src/link.ts',reason:'Unsupported file mode'}],files:[{path:'broken.postman_collection.json',content:JSON.stringify({info:{schema:'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'},variable:{bad:true},item:[]})},{path:'src/main.ts',content:"// fetch('https://ignored.test')\nfetch('https://actual.test', options);",originalContent:''},{path:'swagger.json',content:JSON.stringify({swagger:'2.0',info:{title:'Provider',version:'1'},paths:{'/health':{trace:{responses:{200:{description:'ok'}}}}}})}]}]);
  assert.ok(output.diagnostics.some(d=>d.path==='broken.postman_collection.json'));
  assert.ok(output.diagnostics.some(d=>d.path==='src/link.ts'));
  assert.ok(output.diagnostics.some(d=>/TRACE/i.test(d.message)));
  assert.equal(output.connections.length,1);assert.equal(output.connections[0].target,null);assert.ok(output.connections[0].evidence.draft);
});
test('Native workflow API nodes use the same assertion engine and propagate positive and negative counts',async()=>{
  const {createMachinaRuntime}=require('../services/machina/runtime.cjs');
  const runtime=createMachinaRuntime({getRoot:()=>process.cwd(),resolve:async value=>value,redact:value=>value,hooks:{fetch:async()=>new Response('{"healthy":true}',{headers:{'content-type':'application/json'}})}});
  const definition={id:'api-test',endpointId:'endpoint',kind:'contract',method:'GET',url:'http://fixture.test/health',expectedStatus:200,timeoutMs:1000,schema:{type:'object',required:['healthy'],properties:{healthy:{type:'boolean'}}}};
  const context={signal:new AbortController().signal};
  const positive=await runtime.execute({type:'api-contract',data:{apiAtlasDefinition:definition}},{},context);assert.equal(positive.status,'SUCCESS');assert.equal(positive.artifacts.apiAtlasTestId,'api-test');
  const negative=await runtime.execute({type:'api-contract',data:{apiAtlasDefinition:{...definition,schema:{type:'object',required:['missing']}}}},{},context);assert.equal(negative.status,'FAILURE');assert.ok(negative.failed>0);
});
test('Archive schema scrubbing preserves sensitive-looking property names and type assertions',()=>{
  const {scrub}=require('../services/workspace/archive.cjs'),{redactProjectRecord}=require('../services/protocol-redaction.cjs');
  const schema={type:'object',required:['token','password'],properties:{token:{type:'string'},password:{type:'number'}}};
  const native={version:1,tests:[{schema}],atlas:{endpoints:[{schema}]}};
  const redactor=value=>{const walk=(item,key='')=>{if(/^(token|password)$/.test(key))return '[REDACTED]';if(Array.isArray(item))return item.map(x=>walk(x));if(item&&typeof item==='object')return Object.fromEntries(Object.entries(item).map(([k,v])=>[k,walk(v,k)]));return item;};return walk(value);};
  const archived=redactProjectRecord('api-atlas',scrub(native),redactor);
  assert.deepEqual(archived.tests[0].schema,schema);assert.deepEqual(archived.atlas.endpoints[0].schema,schema);
  const workflow={nodes:[{type:'api-contract',data:{apiAtlasDefinition:{schema}}}]};
  assert.deepEqual(redactProjectRecord('workflows',scrub(workflow),redactor).nodes[0].data.apiAtlasDefinition.schema,schema);
  assert.equal(Object.hasOwn(scrub({token:'actual-secret'}),'token'),false);
});
