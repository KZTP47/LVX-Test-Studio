'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createService}=require('../services/github-studio/remote.cjs');
const {createDemoTransport,DEFAULT_FILES}=require('../services/github-studio/demo-remote.cjs');
const extra=()=>Array.from({length:601},(_,i)=>({path:`tests/scale-${i}.test.ts`,content:`import { it, expect } from 'vitest';\nit('case ${i}', () => expect(${i}).toBe(${i}));\n`}));
const response=data=>new Response(JSON.stringify(data),{status:200});
function setup(transport,request=transport){request.simulated=true;let root='project';const service=createService({getWorkspaceRoot:()=>root,request});return {service,invoke:(action,p={})=>service.handle(action,{workspaceRoot:root,repository:transport.state.repository,...p}),switch:()=>{root='other';service.setWorkspace();}};}
function directories(transport){
 const state=transport.state,root=state.commits.get(state.initialCommit).tree.sha,flat=state.trees.get(root),children=new Map();
 function build(entries){const direct=[],groups=new Map();for(const entry of entries){const slash=entry.path.indexOf('/');if(slash<0)direct.push(entry);else{const name=entry.path.slice(0,slash);if(!groups.has(name))groups.set(name,[]);groups.get(name).push({...entry,path:entry.path.slice(slash+1)});}}
  for(const [path,rows] of groups)direct.push({path,sha:build(rows),mode:'040000',type:'tree'});
  const sha=transport.helpers.tree(direct);children.set(sha,direct);return sha;
 }
 children.set(root,children.get(build(flat)));return {root,children};
}
test('bulk import, selected refresh, staging and publication pass the former file-count boundary',async t=>{
 const transport=createDemoTransport({files:[...DEFAULT_FILES,...extra()]}),f=setup(transport);t.after(()=>f.service.close());
 let active=0,maximum=0;transport.state.before=async call=>{if(call.path.includes('/git/blobs/')){active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setImmediate(resolve));}};transport.state.after=async call=>{if(call.path.includes('/git/blobs/'))active--;};
 const snapshot=await f.invoke('snapshot');assert.equal(snapshot.files.length,607);assert.equal(snapshot.complete,true);assert.ok(maximum<=4&&maximum>1);
 const selected=await f.invoke('snapshot',{ref:snapshot.commit,paths:snapshot.files.map(f=>f.path)});assert.equal(selected.files.length,snapshot.files.length);assert.equal(selected.sourceScope,'selected');
 const files=selected.files.map(file=>file.kind==='test'?{...file,content:file.content+'// reviewed\n'}:file),stagedPaths=files.filter(f=>f.kind==='test').map(f=>f.path);
 active=0;maximum=0;const plan=await f.invoke('previewStage',{baseCommit:snapshot.commit,files,stagedPaths,message:'Scale test',mode:'pr',newBranch:'scale-review'});assert.equal(plan.changes.length,603);assert.ok(maximum<=4&&maximum>1);transport.state.before=null;transport.state.after=null;
 const publication=await f.invoke('publish',{previewId:plan.previewId,operationId:require('node:crypto').randomUUID()});assert.equal(publication.state,'complete');
 const refreshed=await f.invoke('snapshot',{ref:publication.branch,paths:files.map(f=>f.path)});assert.equal(refreshed.files.length,607);assert.equal(refreshed.files.find(f=>f.path==='tests/scale-600.test.ts').content,files.find(f=>f.path==='tests/scale-600.test.ts').content);
 const commit=transport.state.commits.get(publication.commitSha),tree=transport.state.trees.get(commit.tree.sha);assert.equal(tree.find(e=>e.path==='README.md').sha,transport.state.trees.get(snapshot.baseTree).find(e=>e.path==='README.md').sha);
});
test('indexed collision checks preserve directory, blob ancestor, staged prefix and case-fold protections',async t=>{
 const transport=createDemoTransport({files:[...DEFAULT_FILES,{path:'tests/parent.test.ts',content:'it("parent",()=>{});'},{path:'tests/container.test.ts/child.test.ts',content:'it("child",()=>{});'}]}),f=setup(transport);t.after(()=>f.service.close());
 const snapshot=await f.invoke('snapshot'),draft=path=>({path,content:'it("new",()=>{});',originalContent:null,sha:null,mode:'100644'});
 const preview=added=>f.invoke('previewStage',{baseCommit:snapshot.commit,files:[...snapshot.files,...added.map(draft)],stagedPaths:added,message:'Collision test'});
 for(const paths of [['tests/parent.test.ts/child.test.ts'],['tests/container.test.ts'],['tests/new.test.ts','tests/new.test.ts/child.test.ts'],['tests/Case.test.ts','tests/case.test.ts']])await assert.rejects(preview(paths),{code:'PATH_COLLISION'});
 const good=await preview(['tests/new.test.ts','tests/new.test.ts-extra.test.ts']);assert.equal(good.changes.length,2);assert.equal(transport.state.calls.some(c=>c.method!=='GET'),false);
});
test('complete inventories above thirty thousand entries remain accessible without reading unrelated blobs',async t=>{
 const transport=createDemoTransport(),initial=transport.state.commits.get(transport.state.initialCommit),rows=transport.state.trees.get(initial.tree.sha),sha=rows[0].sha;
 rows.push(...Array.from({length:31001},(_,i)=>({path:`assets/item-${i}.txt`,sha,mode:'100644',type:'blob',size:1})));
 const f=setup(transport);t.after(()=>f.service.close());const index=await f.invoke('sourceIndex',{commit:transport.state.initialCommit});assert.equal(index.entries.length,6);assert.equal(transport.state.calls.filter(c=>c.path.includes('/git/blobs/')).length,0);
});
test('truncated recursive trees recover through bounded immutable directory traversal including reused subtrees',async t=>{
 const transport=createDemoTransport({files:[...DEFAULT_FILES,...extra(),{path:'nested/a/copy.test.ts',content:'it("same",()=>{});'},{path:'nested/b/copy.test.ts',content:'it("same",()=>{});'}]}),{root,children}=directories(transport);let active=0,maximum=0,recursive=0;
 const request=async(url,options)=>{const u=new URL(url);if(!u.pathname.includes('/git/trees/'))return transport(url,options);if(u.searchParams.has('recursive')){recursive++;return response({sha:root,tree:[],truncated:true});}active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,1));active--;const sha=u.pathname.split('/').at(-1);return response({sha,tree:children.get(sha),truncated:false});};
 const f=setup(transport,request);t.after(()=>f.service.close());const index=await f.invoke('sourceIndex',{commit:transport.state.initialCommit});assert.equal(index.entries.length,609);assert.equal(recursive,1);assert.ok(maximum<=4&&maximum>1);assert.ok(index.entries.some(f=>f.path==='nested/a/copy.test.ts'));assert.ok(index.entries.some(f=>f.path==='nested/b/copy.test.ts'));
 const file=await f.invoke('sourceFile',{commit:transport.state.initialCommit,path:'tests/scale-600.test.ts'});assert.equal(file.file.content,extra().at(-1).content);
});
test('large valid recursive responses are read completely without the former response budget',async t=>{
 const transport=createDemoTransport(),{root,children}=directories(transport);let fallback=0;
 const request=async(url,options)=>{const u=new URL(url);if(!u.pathname.includes('/git/trees/'))return transport(url,options);if(u.search)return response({sha:root,tree:transport.state.trees.get(root),truncated:false,padding:'x'.repeat(8*1024*1024+1)});fallback++;const sha=u.pathname.split('/').at(-1);return response({sha,tree:children.get(sha),truncated:false});};
 const f=setup(transport,request);t.after(()=>f.service.close());const index=await f.invoke('sourceIndex',{commit:transport.state.initialCommit});assert.equal(index.entries.length,6);assert.equal(fallback,0);assert.equal(index.baseTree,root);
});
test('incomplete, malformed, cyclic and failed directory inventories never become cached partial snapshots',async t=>{
 for(const mode of ['truncated','duplicate','wrong-sha','cycle','traversal','offline'])await t.test(mode,async t=>{
  const transport=createDemoTransport(),{root,children}=directories(transport);let broken=true;
  const request=async(url,options)=>{const u=new URL(url);if(!u.pathname.includes('/git/trees/'))return transport(url,options);if(u.search)return response({sha:root,tree:[],truncated:true});const sha=u.pathname.split('/').at(-1);let tree=structuredClone(children.get(sha));if(broken&&sha===root){if(mode==='offline')throw Error('disconnected');if(mode==='duplicate')tree.push(tree[0]);if(mode==='cycle')tree=[{path:'loop',sha:root,mode:'040000',type:'tree'}];if(mode==='traversal')tree=[{...tree[0],path:'../escape'}];}return response({sha:broken&&mode==='wrong-sha'?'a'.repeat(40):sha,tree,truncated:broken&&mode==='truncated'});};
  const f=setup(transport,request);t.after(()=>f.service.close());await assert.rejects(f.invoke('sourceIndex',{commit:transport.state.initialCommit}),{code:mode==='offline'?'NETWORK_ERROR':'INCOMPLETE_TREE'});broken=false;assert.equal((await f.invoke('sourceIndex',{commit:transport.state.initialCommit})).entries.length,6);
 });
});
test('workspace changes abort directory traversal before any further batches can be imported',async t=>{
 const transport=createDemoTransport(),{root,children}=directories(transport);let release,started;const pending=new Promise(resolve=>started=resolve),pause=new Promise(resolve=>release=resolve);
 const request=async(url,options)=>{const u=new URL(url);if(!u.pathname.includes('/git/trees/'))return transport(url,options);if(u.search)return response({sha:root,tree:[],truncated:true});started();await pause;const sha=u.pathname.split('/').at(-1);return response({sha,tree:children.get(sha),truncated:false});};
 const f=setup(transport,request);t.after(()=>f.service.close());const loading=f.invoke('sourceIndex',{commit:transport.state.initialCommit});await pending;f.switch();release();await assert.rejects(loading,{code:'WORKSPACE_CHANGED'});
});
