'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createService}=require('../services/github-studio/remote.cjs');
const {createDemoTransport,DEFAULT_FILES}=require('../services/github-studio/demo-remote.cjs');
const files=()=>[...DEFAULT_FILES,...Array.from({length:600},(_,i)=>({path:`tests/large-${i}.test.ts`,content:`import { it, expect } from 'vitest';\nit('case ${i}', () => { expect(${i}).toBe(${i}); });\n`}))];
function fixture(){const transport=createDemoTransport({files:files()});let root='project';const service=createService({getWorkspaceRoot:()=>root,request:transport});return {transport,service,state:transport.state,invoke:(a,p={})=>service.handle(a,{workspaceRoot:root,repository:transport.state.repository,...p}),switch:()=>{root='different';service.setWorkspace();}};}
test('workflow-only snapshot and lazy test catalog support more than 250 source files without bulk blob downloads',async()=>{
 const f=fixture();const full=await f.invoke('snapshot');assert.equal(full.files.length,606);assert.equal(full.complete,true);
 const repo=await f.invoke('snapshot',{scope:'workflows'});assert.equal(repo.files.length,3);assert.equal(repo.sourceScope,'workflows');assert.equal(repo.sourceInventoryComplete,false);
 f.state.calls.length=0;
 const [index,shared]=await Promise.all([f.invoke('sourceIndex',{commit:repo.commit}),f.invoke('sourceIndex',{commit:repo.commit})]);
 assert.deepEqual(index,shared);assert.equal(index.entries.filter(e=>e.kind==='test').length,602);assert.equal(f.state.calls.length,2);assert.equal(f.state.calls.some(c=>c.path.includes('/git/blobs/')),false);
 const first=await f.invoke('sourceFile',{commit:repo.commit,path:'tests/large-599.test.ts',sha:'a'.repeat(40)});assert.equal(first.file.content,files().at(-1).content);assert.equal(first.file.originalContent,first.file.content);assert.equal(f.state.calls.length,3);
 await f.invoke('sourceFile',{commit:repo.commit,path:'tests/large-598.test.ts'});assert.equal(f.state.calls.length,4);assert.equal(f.state.calls.some(c=>c.method!=='GET'),false);
 const selected=await f.invoke('snapshot',{ref:repo.commit,paths:[repo.files[0].path,'tests/large-599.test.ts']});assert.equal(selected.files.length,2);assert.equal(selected.sourceScope,'selected');
 await f.service.close();
});
test('lazy source fetch rejects traversal, unsupported paths, forged blobs and incomplete inventories',async()=>{
 const f=fixture(),commit=f.state.initialCommit;
 await assert.rejects(f.invoke('sourceFile',{commit,path:'../outside.test.ts'}),{code:'INVALID_PATH'});assert.equal(f.state.calls.length,0);
 await assert.rejects(f.invoke('sourceFile',{commit,path:'README.md'}),{code:'NOT_FOUND'});
 const entry=(await f.invoke('sourceIndex',{commit})).entries.find(e=>e.path==='tests/large-0.test.ts');
 f.state.blobs.get(entry.sha).content=Buffer.from('forged').toString('base64');f.state.blobs.get(entry.sha).size=6;
 await assert.rejects(f.invoke('sourceFile',{commit,path:entry.path}),{code:'SOURCE_MISMATCH'});
 f.switch();await assert.rejects(f.service.handle('sourceIndex',{workspaceRoot:'project',repository:f.state.repository,commit}),{code:'WORKSPACE_CHANGED'});
 await f.service.close();
 const transport=createDemoTransport(),request=async(url,options)=>url.includes('/git/trees/')?new Response(JSON.stringify({tree:[],truncated:true}),{status:200}):transport(url,options);request.simulated=true;
 const service=createService({getWorkspaceRoot:()=> 'project',request});
 await assert.rejects(service.handle('sourceIndex',{workspaceRoot:'project',repository:transport.state.repository,commit:transport.state.initialCommit}),{code:'INCOMPLETE_TREE'});await service.close();
});
test('failed lazy catalogs can retry and a workspace switch invalidates in-flight and cached reads',async()=>{
 const transport=createDemoTransport();let reject=true,root='project';const request=async(url,options)=>{if(reject&&url.includes('/git/trees/'))throw Error('Offline');return transport(url,options);};request.simulated=true;
 const service=createService({getWorkspaceRoot:()=>root,request}),payload={workspaceRoot:root,repository:transport.state.repository,commit:transport.state.initialCommit};
 await assert.rejects(service.handle('sourceIndex',payload),{code:'NETWORK_ERROR'});reject=false;assert.ok((await service.handle('sourceIndex',payload)).entries.length);
 root='different';service.setWorkspace();await assert.rejects(service.handle('sourceIndex',payload),{code:'WORKSPACE_CHANGED'});await service.close();
});
