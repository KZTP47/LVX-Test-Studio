'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function harness({storage=true,importError}={}){
 const source=fs.readFileSync(path.join(__dirname,'../script.js'),'utf8'),start=source.indexOf('async function importFromJSON(event)'),end=source.indexOf('\nfunction showMessage(',start),messages=[],calls=[],values=new Map();
 assert.ok(start>=0&&end>start);const context={console:{error(){}},currentStorage:storage?{async saveSuite(suite){calls.push(['suite',suite]);}}:null,views:[{id:'original'}],localStorage:{setItem:(k,v)=>values.set(k,v)},saveViewsToStorage:()=>calls.push(['views']),renderViews(){},loadPipelines(){},showMessage:(...args)=>messages.push(args)};
 context.window={LVXStudio:{clearImport:()=>calls.push(['clear']),importFile:async(file,content)=>{if(importError)throw Error(importError);calls.push(['project',file.name,content]);}},LVXApp:{refreshSuites:async()=>calls.push(['refresh'])}};vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 return{context,messages,calls,values,async upload(text){const input={files:[new File([text],'selected.json',{type:'application/json'})],value:'selected.json',disabled:false};await context.importFromJSON({target:input});assert.equal(input.disabled,false);assert.equal(input.value,'');return input;}};
}
test('Home routes full project archives before requiring legacy suite storage',async()=>{const f=harness({storage:false});await f.upload(JSON.stringify({format:'lvx-workspace',schemaVersion:2}));assert.equal(f.calls.filter(c=>c[0]==='project').length,1);assert.equal(f.calls.filter(c=>c[0]==='suite').length,0);assert.equal(f.messages.length,0);});
test('Unsupported files cannot partly replace saved views or pipelines',async()=>{const f=harness();await f.upload(JSON.stringify({views:[{id:'wrong'}],pipelines:[{id:'wrong'}]}));assert.equal(f.calls.some(c=>c[0]==='views'||c[0]==='suite'),false);assert.equal(f.values.size,0);assert.match(f.messages.at(-1)[0],/Unsupported JSON file/);});
test('Native project routing errors remain actionable and permit file retry',async()=>{const f=harness({importError:'Choose a healthy workspace'});await f.upload('{"format":"lvx-workspace"}');assert.match(f.messages.at(-1)[0],/Choose a healthy workspace/);assert.equal(f.messages.at(-1)[1],'error');});
test('Legacy UTF-8 BOM suite files still save and refresh the original home',async()=>{const f=harness();await f.upload('\uFEFF'+JSON.stringify({test_suites:[{name:'Saved suite',language:'javascript'}]}));assert.equal(f.calls.filter(c=>c[0]==='suite').length,1);assert.equal(f.calls.filter(c=>c[0]==='refresh').length,1);assert.deepEqual(f.messages.at(-1),['Imported 1 test suite(s)','success']);});
test('Malformed JSON and invalid legacy suite shapes do not mutate saved data',async()=>{for(const text of ['{bad','{"test_suites":[null],"views":[{"id":"wrong"}]}']){const f=harness();await f.upload(text);assert.equal(f.calls.some(c=>c[0]==='suite'||c[0]==='views'),false);assert.equal(f.messages.at(-1)[1],'error');}});

function projectHarness(){
 const source=fs.readFileSync(path.join(__dirname,'../studio-workbench.js'),'utf8');
 const clear=source.slice(source.indexOf('function clearProjectImport()'),source.indexOf('function paintProjectImport()'));
 const helpers=source.slice(source.indexOf('async function previewProjectImport('),source.indexOf('async function renderWorkspaceBase('));
 let release;const opened=new Promise(resolve=>{release=resolve;}),calls=[];
 const context={state:{workspace:{workspaceRoot:'selected-folder'}},bridge:()=>({}),open:()=>opened,invoke:async()=>{calls.push('invoke');return{trusted:true,valid:true};},paintProjectImport:()=>calls.push('paint'),announce:()=>calls.push('announce')};
 vm.createContext(context);vm.runInContext('let projectImportGeneration=0;'+clear+helpers,context);
 return{context,calls,release};
}
test('Clearing an import during delayed workspace opening cannot revive its archive',async()=>{
 const f=projectHarness(),pending=f.context.importProjectFile({name:'first.lvx.json',size:2},{format:'lvx-workspace'});
 f.context.clearProjectImport();f.release();await pending;
 assert.equal(f.context.state.importArchive,null);assert.equal(f.context.state.importFileName,null);assert.equal(f.context.state.pendingProjectFile,null);assert.deepEqual(f.calls,[]);
});
test('A stale preview call cannot overwrite a newer selected archive or render it',async()=>{
 const f=projectHarness();f.context.clearProjectImport();const newer={id:'newer'};f.context.state.importArchive=newer;f.context.state.importFileName='newer.lvx.json';
 await f.context.previewProjectImport({id:'older'},'older.lvx.json',0);
 assert.equal(f.context.state.importArchive,newer);assert.equal(f.context.state.importFileName,'newer.lvx.json');assert.deepEqual(f.calls,[]);
});
