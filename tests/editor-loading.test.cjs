'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
 const source=fs.readFileSync(path.join(__dirname,'../studio-workbench.js'),'utf8'),start=source.indexOf('let editorTools=null;'),end=source.indexOf('function captureDraft()',start);assert.ok(start>0&&end>start);
 const pending=[],target={innerHTML:''};let form='',writes=0;
 const context={active:true,renderVersion:1,state:{page:'build',workspace:{workspaceRoot:'first'},draft:{name:'',engine:'javascript',steps:[],parameterRows:[]}},content:{querySelector:()=>target,get innerHTML(){return form;},set innerHTML(value){form=value;writes++;}},Date,Promise,esc:String,bridge:()=>({}),invoke:async(domain,action,payload)=>{if(action==='list')return{records:[]};assert.equal(action,'capabilities');return new Promise((resolve,reject)=>pending.push({resolve,reject,payload}));},title:(_a,b)=>b,input:label=>label,select:label=>label,button:(_action,label)=>label,area:label=>label,empty:(_a,b)=>b,stepTypes:{compare:'Compare'}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);return{context,pending,target,form:()=>form,writes:()=>writes};
}
const caps=id=>({engines:[{id:'javascript',available:true}],identity:id});
test('Actual editor render completes with the runtime reply unresolved and repeated edits reuse one request',async()=>{
 const f=fixture();await f.context.renderBuild(1);assert.match(f.form(),/Save check/);assert.equal(f.pending.length,1);assert.equal(f.context.state.capabilities,undefined);await f.context.renderBuild(1);assert.equal(f.pending.length,1);
 f.pending[0].resolve(caps('first'));await f.context.refreshEditorTools();assert.equal(f.context.state.capabilities.identity,'first');
});
test('Background completion updates only the tool notice, preserving the editable form',async()=>{
 const f=fixture();await f.context.renderBuild(1);const writes=f.writes();f.context.state.draft.name='Unsaved draft';f.pending[0].resolve(caps('ready'));await f.context.refreshEditorTools();assert.equal(f.writes(),writes);assert.equal(f.context.state.draft.name,'Unsaved draft');assert.match(f.target.innerHTML,/is ready/);
});
test('Detection failures stay recoverable without hiding the editor or silently repeating the failed scan',async()=>{
 const f=fixture();await f.context.renderBuild(1);f.pending[0].reject(Error('Probe failed'));await f.context.refreshEditorTools();assert.match(f.target.innerHTML,/could not finish/);assert.match(f.target.innerHTML,/Refresh tool check/);assert.match(f.form(),/Save check/);await f.context.renderBuild(1);assert.equal(f.pending.length,1);
 const retry=f.context.refreshEditorTools(true);assert.equal(f.pending.length,2);f.pending[1].resolve(caps('retried'));await retry;assert.equal(f.context.state.capabilities.identity,'retried');
});
test('Leaving the editor prevents late errors from changing the visible page',async()=>{
 const f=fixture();await f.context.renderBuild(1);f.context.state.page='data';f.target.innerHTML='Data page';f.pending[0].reject(Error('Late error'));await f.context.refreshEditorTools();assert.equal(f.target.innerHTML,'Data page');
});
test('An old workspace result cannot overwrite the new workspace readiness',async()=>{
 const f=fixture();await f.context.renderBuild(1);f.context.state.workspace.workspaceRoot='second';f.context.resetEditorTools();const next=f.context.refreshEditorTools();f.pending[1].resolve(caps('second'));await next;f.pending[0].resolve(caps('first'));await Promise.resolve();await Promise.resolve();assert.equal(f.context.state.capabilities.identity,'second');assert.equal(f.pending[0].payload.workspaceRoot,'first');assert.equal(f.pending[1].payload.workspaceRoot,'second');
});
test('A completed explicit tool setup supersedes an older pending detection result',async()=>{
 const f=fixture();await f.context.renderBuild(1);f.context.acceptEditorTools(caps('installed'));f.pending[0].resolve(caps('old'));await Promise.resolve();await Promise.resolve();assert.equal(f.context.state.capabilities.identity,'installed');await f.context.refreshEditorTools();assert.equal(f.pending.length,1);
});
