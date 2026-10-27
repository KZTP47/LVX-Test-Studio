'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {browserMode}=require('../services/execution/browser-mode.cjs');
test('browser choice defaults safely and accepts only the two visible UI options',()=>{
 assert.equal(browserMode(),'headless');assert.equal(browserMode('headed'),'headed');assert.equal(browserMode('headless'),'headless');
 for(const value of [null,true,false,0,'false','invalid',{},[]])assert.throws(()=>browserMode(value),/Headed.*Headless/);
});

test('graph browser preference survives reopen, stays scoped, and preserves explicit graph settings',async()=>{
 const api=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'../graph-browser-mode.js'))).toString('base64'));
 const items=new Map(),storage={getItem:key=>items.get(key)||null,setItem:(key,value)=>items.set(key,value)};
 const workspace='C:\\Projects\\One',graph={id:'test-graph',browserMode:'headless'};
 assert.equal(api.graphBrowserMode(storage,workspace),'headless');
 api.rememberGraphBrowserMode(storage,workspace,graph.id,'headed');
 assert.equal(api.graphBrowserMode(storage,'c:/projects/one/',graph),'headed');
 assert.equal(api.graphBrowserMode(storage,workspace,{id:'new-graph'}),'headed');
 assert.equal(api.graphBrowserMode(storage,workspace,{id:'explicit',browserMode:'headless'}),'headless');
 assert.equal(api.graphBrowserMode(storage,'C:\\Projects\\Two',graph),'headless');
 api.rememberGraphBrowserMode(storage,workspace,'other','headless');
 assert.equal(api.graphBrowserMode(storage,workspace,graph),'headed');
 assert.equal(api.graphBrowserMode(storage,workspace,{id:'other'}),'headless');
 assert.throws(()=>api.rememberGraphBrowserMode(storage,workspace,graph.id,'invalid'),/Headed.*Headless/);
 for(const key of items.keys())items.set(key,'corrupt');
 assert.equal(api.graphBrowserMode(storage,workspace,graph),'headless');
 assert.equal(api.graphBrowserMode(storage,workspace,{browserMode:'headed'}),'headed');
 const blocked={getItem(){throw Error('Storage unavailable');},setItem(){throw Error('Storage unavailable');}};
 assert.equal(api.graphBrowserMode(blocked,workspace,{browserMode:'headed'}),'headed');
 assert.equal(api.graphBrowserMode(blocked,workspace),'headless');
 assert.throws(()=>api.rememberGraphBrowserMode(blocked,workspace,graph.id,'headed'),/Storage unavailable/);
});
test('Nexus straight routing clips both ends to actual unequal card bounds in every direction',async()=>{
 const api=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'../agent-board.js'))).toString('base64'));
 const source={position:{x:100,y:120},width:230,height:210};
 for(const position of [{x:700,y:120},{x:-300,y:120},{x:100,y:650},{x:100,y:-300},{x:700,y:650},{x:-300,y:-300}]){
  const target={position,width:280,height:150},line=api.connectionPath(source,target);assert.match(line.d,/^M [-\d.e ]+ L [-\d.e ]+$/);assert.doesNotMatch(line.d,/[CQ]|NaN|Infinity/);
  for(const [x,y,card]of [[line.x1,line.y1,source],[line.x2,line.y2,target]]){assert.ok(x>=card.position.x-0.01&&x<=card.position.x+card.width+0.01&&y>=card.position.y-0.01&&y<=card.position.y+card.height+0.01);assert.ok(Math.min(Math.abs(x-card.position.x),Math.abs(x-card.position.x-card.width),Math.abs(y-card.position.y),Math.abs(y-card.position.y-card.height))<0.01);}
 }
});
test('run status is transient editor state and graph replacement invalidates its ownership',()=>{
 const vm=require('node:vm'),window={};const context=vm.createContext({window,console});vm.runInContext(fs.readFileSync(path.join(__dirname,'../visual-editor.js'),'utf8'),context);const editor=new window.VisualEditor('fixture');editor.render=()=>{};editor._keepGraphInWorkingArea=()=>{};editor._resetHistory=()=>{};editor.runResults={fixture:{status:'SUCCESS'}};editor._executionOwner={};editor.loadGraph({nodes:[],edges:[]});assert.equal(editor._executionOwner,null);assert.deepEqual(Object.keys(editor.runResults),[]);assert.ok(!JSON.stringify(editor.getGraph()).includes('runResults'));
});
