'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Y = require('yaml');
const { inspectWorkflow, editWorkflow, expandMatrix, parseReusableReference } = require('../services/github-studio/workflow.cjs');
const source = '\ufeff# header\r\nname:  "CI" # keep\r\non:\r\n  push:\r\n    branches: [main] # filter\r\njobs:\r\n  build:\r\n    runs-on: ubuntu-latest  # linux\r\n    steps:\r\n      - name: Build # step\r\n        run: npm run build\r\n  test:\r\n    needs: build\r\n    runs-on: ubuntu-latest\r\n    steps:\r\n      - run: npm test\r\n';
const value = s => Y.parse(s);
const edit = (s, op) => editWorkflow(s, op).source;
const throws = (fn, code) => assert.throws(fn, e => e.code === code);
test('inspect returns useful jobs, edges, triggers and truthful invalid draft diagnostics', () => {
  const info = inspectWorkflow(source); assert.equal(info.valid, true); assert.equal(info.editable, true); assert.equal(info.jobs.length, 2); assert.deepEqual(info.edges, [{source:'build',target:'test'}]); assert.deepEqual(info.triggers,['push']);
  assert.equal(inspectWorkflow('jobs: [broken').editable, false);
  assert.equal(inspectWorkflow('jobs: {}\n').valid, false);
  assert.equal(inspectWorkflow('jobs: {}\n---\njobs: {}').editable, false);
  for (const invalid of ['on: []\njobs: {}','on: true\njobs: {}','on: push\njobs: {a: {runs-on: [], steps: [{run: 42}]}}','on: push\njobs: {a: {uses: "${{ inputs.workflow }}"}}']) assert.equal(inspectWorkflow(invalid).valid,false);
});
test('scalar edits and no-ops preserve every untouched byte including comments BOM CRLF and flow formatting', () => {
  assert.equal(edit(source,{type:'updateJob',id:'build',patch:{'runs-on':'ubuntu-latest'}}),source);
  assert.equal(edit(source,[]),source);
  assert.equal(edit(source,{type:'updateJob',id:'build',patch:{'runs-on':'windows-latest'}}), source.replace('ubuntu-latest','windows-latest'));
  const noFinal = 'jobs: {a: {runs-on: ubuntu-latest, steps: [{run: echo ok}]}}';
  assert.equal(edit(noFinal,{type:'updateJob',id:'a',patch:{'runs-on':'windows-latest'}}),noFinal.replace('ubuntu-latest','windows-latest'));
  throws(()=>editWorkflow(source,{type:'setWorkflow',patch:{name:'New'}},{expectedHash:'stale'}),'STALE_SOURCE');
});
test('job CRUD, scalar-array-object runners, dependency validation and detach deletion', () => {
  let s=edit(source,{type:'addJob',id:'lint',value:{'runs-on':{group:'linux',labels:['self-hosted','x64']},steps:[{run:'npm run lint'}]}});
  assert.deepEqual(value(s).jobs.lint['runs-on'],{group:'linux',labels:['self-hosted','x64']}); assert.ok(s.includes('# filter'));
  s=edit(s,{type:'setNeeds',id:'lint',needs:['build']}); assert.deepEqual(value(s).jobs.lint.needs,['build']);
  throws(()=>edit(s,{type:'setNeeds',id:'build',needs:['lint']}),'DEPENDENCY_CYCLE');
  throws(()=>edit(s,{type:'setNeeds',id:'lint',needs:['missing']}),'MISSING_JOB');
  throws(()=>edit(s,{type:'deleteJob',id:'build'}),'JOB_REFERENCED');
  s=edit(s,{type:'deleteJob',id:'build',detach:true}); assert.equal(value(s).jobs.build,undefined); assert.equal(value(s).jobs.test.needs,undefined); assert.equal(value(s).jobs.lint.needs,undefined);
  throws(()=>edit(s,{type:'addJob',id:'lint',value:{}}),'DUPLICATE_JOB');
  throws(()=>edit(s,{type:'addJob',id:'bad id',value:{}}),'JOB_ID');
});
test('step insert edit delete preserves unrelated fields and allows invalid intermediate empty steps', () => {
  let s=edit(source,{type:'addStep',jobId:'build',index:0,value:{uses:'actions/checkout@v4',with:{'fetch-depth':0}}});
  assert.equal(value(s).jobs.build.steps.length,2); assert.ok(s.includes('name: Build # step'));
  s=edit(s,{type:'updateStep',jobId:'build',index:1,patch:{name:'Compile',env:{MODE:'ci'},run:'echo one\necho two\n'}});
  assert.equal(value(s).jobs.build.steps[1].run,'echo one\necho two\n'); assert.ok(s.includes('# step'));
  s=edit(s,{type:'updateStep',jobId:'build',index:0,patch:{run:'echo checkout'}}); assert.equal(value(s).jobs.build.steps[0].uses,undefined); assert.deepEqual(value(s).jobs.build.steps[0].with,{'fetch-depth':0});
  s=edit(s,{type:'deleteStep',jobId:'build',index:1}); assert.equal(value(s).jobs.build.steps.length,1);
  s=edit(s,{type:'deleteStep',jobId:'build',index:0}); assert.deepEqual(value(s).jobs.build.steps,[]); assert.ok(inspectWorkflow(s).diagnostics.some(d=>d.code==='STEPS_EMPTY'));
  s=edit(s,{type:'addStep',jobId:'build',value:{run:'npm test'}}); assert.equal(value(s).jobs.build.steps[0].run,'npm test');
  throws(()=>edit(s,{type:'deleteStep',jobId:'build',index:-1}),'INVALID_STEP');
});
test('nested trigger updates preserve existing filters comments and literal expressions', () => {
  const s=edit(source,{type:'setWorkflow',patch:{on:{push:{branches:['main']},workflow_dispatch:{inputs:{target:{description:'${{ literal }} # text',type:'string',required:true}}}}}});
  assert.ok(s.includes('branches: [main] # filter')); assert.equal(value(s).on.workflow_dispatch.inputs.target.description,'${{ literal }} # text');
  const removed=edit(s,{type:'setWorkflow',patch:{},remove:['name']}); assert.equal(value(removed).name,undefined); assert.ok(removed.includes('# header'));
});
test('aliases reject ambiguous visual mutations while unrelated anchors remain intact', () => {
  const s='env: &env\n  MODE: ci\njobs:\n  a:\n    runs-on: ubuntu-latest\n    env: *env\n    steps: [{run: npm test}]\n';
  assert.equal(edit(s,{type:'updateJob',id:'a',patch:{'runs-on':'windows-latest'}}),s.replace('ubuntu-latest','windows-latest'));
  throws(()=>edit(s,{type:'updateJob',id:'a',patch:{env:{MODE:'prod'}}}),'AMBIGUOUS_ALIAS');
  const a='jobs:\n  a: &job\n    runs-on: ubuntu-latest\n    steps: [{run: npm test}]\n  b: *job\n';
  throws(()=>edit(a,{type:'deleteJob',id:'a'}),'AMBIGUOUS_ALIAS'); throws(()=>edit(a,{type:'updateJob',id:'b',patch:{name:'Other'}}),'AMBIGUOUS_ALIAS');
  throws(()=>edit(a,{type:'updateJob',id:'a',patch:{'runs-on':'windows-latest'}}),'AMBIGUOUS_ALIAS');
});
test('multiline scalar edits preserve header comments, folded values, CRLF and flow context',()=>{
  for(const style of ['|','>-']) {
    const s='jobs:\r\n  a:\r\n    runs-on: ubuntu-latest\r\n    steps:\r\n      - run: '+style+' # keep script comment\r\n          echo one\r\n          echo two\r\n';
    const out=edit(s,{type:'updateStep',jobId:'a',index:0,patch:{run:'echo three\necho four\n'}});
    assert.ok(out.includes('# keep script comment')); assert.equal(value(out).jobs.a.steps[0].run,'echo three\necho four\n'); assert.equal(out.replace(/\r\n/g,'').includes('\n'),false);
  }
  const flow='jobs: {a: {runs-on: ubuntu-latest, steps: [{run: echo one}]}}';
  const out=edit(flow,{type:'updateStep',jobId:'a',index:0,patch:{run:'echo one\necho two\n'}}); assert.equal(value(out).jobs.a.steps[0].run,'echo one\necho two\n');
  for(const text of ['true','false','null','42','[one','*ref','',': colon','# hash']) assert.equal(value(edit(flow,{type:'updateStep',jobId:'a',index:0,patch:{run:text}})).jobs.a.steps[0].run,text);
});
test('deleting compact step fields and first-middle-last children retains nearby comments',()=>{
  const s='jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - name: First\n        # next field comment\n        run: one\n      # second step comment\n      - run: two\n        name: Second\n      - run: three\n';
  const removed=edit(s,{type:'updateStep',jobId:'a',index:0,patch:{},remove:['name']}); assert.equal(value(removed).jobs.a.steps[0].run,'one'); assert.ok(removed.includes('# next field comment')); assert.ok(removed.includes('# second step comment'));
  for(const index of [0,1,2]) {const out=edit(s,{type:'deleteStep',jobId:'a',index}); assert.equal(value(out).jobs.a.steps.length,2); assert.equal(value(out).jobs.a.steps.some(x=>x.run===['one','two','three'][index]),false);}
  assert.deepEqual(value(edit('jobs: {}',{type:'setWorkflow',patch:{},remove:['jobs']})),{});
  const bom='\ufeffname: CI\r\non: push\r\njobs: {}'; assert.equal(edit(bom,{type:'setWorkflow',patch:{},remove:['name']}),'\ufeffon: push\r\njobs: {}');
});
test('new invalid dependencies remain rejected when an imported draft already has missing jobs',()=>{
  const s='jobs:\n  a:\n    runs-on: ubuntu-latest\n    needs: missing\n    steps: [{run: ok}]\n';
  throws(()=>edit(s,{type:'addJob',id:'b',value:{'runs-on':'ubuntu-latest',needs:'another',steps:[{run:'ok'}]}}),'MISSING_JOB');
  assert.equal(edit(s,{type:'updateJob',id:'a',patch:{name:'Rename label'}}).includes('Rename label'),true);
  assert.equal(inspectWorkflow('jobs:\n'+Array.from({length:501},(_,i)=>'  a'+i+': {}\n').join('')).jobs.length,501);
});
test('flow mapping and sequence edits retain surrounding source and deletion stays valid', () => {
  let s='name: X # keep\njobs: {a: {runs-on: ubuntu-latest, steps: [{run: one}, {run: two}, {run: three}]}, b: {runs-on: ubuntu-latest, steps: [{run: ok}]}}\n';
  s=edit(s,{type:'updateJob',id:'a',patch:{name:'A'}}); assert.equal(value(s).jobs.a.name,'A');
  s=edit(s,{type:'deleteStep',jobId:'a',index:1}); assert.deepEqual(value(s).jobs.a.steps.map(x=>x.run),['one','three']);
  s=edit(s,{type:'deleteStep',jobId:'a',index:1}); assert.deepEqual(value(s).jobs.a.steps.map(x=>x.run),['one']);
  s=edit(s,{type:'addStep',jobId:'a',index:0,value:{run:'zero'}}); assert.deepEqual(value(s).jobs.a.steps.map(x=>x.run),['zero','one']);
  s=edit(s,{type:'deleteJob',id:'a'}); assert.ok(s.startsWith('name: X # keep')); assert.deepEqual(Object.keys(value(s).jobs),['b']);
  const comments='jobs: {a: {runs-on: ubuntu-latest, # retain next-field comment\n steps: [{run: one}, # retain next-step comment\n {run: two}]}}\n';
  const c=edit(comments,{type:'updateJob',id:'a',patch:{},remove:['runs-on']}); assert.ok(c.includes('# retain next-field comment')); assert.equal(value(c).jobs.a.steps.length,2);
  const c2=edit(comments,{type:'deleteStep',jobId:'a',index:0}); assert.ok(c2.includes('# retain next-step comment')); assert.deepEqual(value(c2).jobs.a.steps,[{run:'two'}]);
});
test('empty mappings, only child deletion, missing steps and grouped operations',()=>{
  let s=edit('jobs: {}',{type:'addJob',id:'a',value:{'runs-on':'ubuntu-latest',steps:[]}}); assert.equal(value(s).jobs.a['runs-on'],'ubuntu-latest');
  s=edit(s,[{type:'addStep',jobId:'a',value:{run:'yes'}},{type:'updateJob',id:'a',patch:{name:'A'}}]); assert.equal(value(s).jobs.a.steps[0].run,'yes');
  s=edit(s,{type:'deleteJob',id:'a'}); assert.deepEqual(value(s),{jobs:{}});
  const absent='jobs:\n  a:\n    runs-on: ubuntu-latest\n'; assert.equal(value(edit(absent,{type:'addStep',jobId:'a',value:{run:'ok'}})).jobs.a.steps[0].run,'ok');
});
test('step insertion works across first-middle-last position, flow/block style, LF/CRLF and absent final newline',()=>{
  for(const crlf of [false,true]) for(const flow of [false,true]) for(const final of [false,true]) for(const index of [0,1,2]) {
    const doc=new Y.Document({on:'push',jobs:{a:{'runs-on':['self-hosted','linux'],steps:[{name:'One',run:'one'},{name:'Two',run:'two'}]},b:{'runs-on':'linux',steps:[{run:'b'}]}}});
    if(flow) doc.contents.flow=true;
    let s=doc.toString({lineWidth:0}); if(!final)s=s.replace(/\n$/,''); if(crlf)s=s.replace(/\n/g,'\r\n');
    const out=edit(s,{type:'addStep',jobId:'a',index,value:{run:'new\nsecond\n'}}), actual=value(out);
    assert.equal(actual.jobs.a.steps.length,3); assert.equal(actual.jobs.a.steps[index].run,'new\nsecond\n'); assert.deepEqual(actual.jobs.b,value(s).jobs.b);
  }
});
test('matrix follows GitHub include ordering, exclude matching and standalone additions',()=>{
  const r=expandMatrix({fruit:['apple','pear'],animal:['cat','dog'],include:[{color:'green'},{color:'pink',animal:'cat'},{fruit:'apple',shape:'circle'},{fruit:'banana'},{fruit:'banana',animal:'cat'}]});
  assert.deepEqual(r.combinations,[{fruit:'apple',animal:'cat',color:'pink',shape:'circle'},{fruit:'apple',animal:'dog',color:'green',shape:'circle'},{fruit:'pear',animal:'cat',color:'pink'},{fruit:'pear',animal:'dog',color:'green'},{fruit:'banana'},{fruit:'banana',animal:'cat'}]); assert.equal(r.total,6);
  assert.deepEqual(expandMatrix({os:['linux','win'],node:[20,22],exclude:[{os:'win'}]}).combinations,[{os:'linux',node:20},{os:'linux',node:22}]);
  assert.deepEqual(expandMatrix({include:[{x:1},{x:2}]}).combinations,[{x:1},{x:2}]); assert.equal(expandMatrix({x:[]}).total,0);
});
test('matrix is paginated, deeply compares objects, labels dynamic source and resists prototype keys',()=>{
  assert.equal(expandMatrix({x:'${{ fromJSON(inputs.versions) }}'}).dynamic,true);
  assert.equal(expandMatrix({x:[1,2,3]},{limit:2}).truncated,true);
  assert.deepEqual(expandMatrix({x:[{a:1},{a:2}],exclude:[{x:{a:1}}]}).combinations,[{x:{a:2}}]);
  const huge=expandMatrix(Object.fromEntries(Array.from({length:8},(_,i)=>['a'+i,Array.from({length:1000},(_,j)=>j)]))); assert.equal(huge.truncated,true); assert.equal(huge.combinations.length,100); assert.equal(huge.total,'1000000000000000000000000');
  const dangerous=JSON.parse('{"__proto__":["safe"]}'); assert.equal(ownValue(expandMatrix(dangerous).combinations[0],'__proto__'),'safe'); assert.equal({}.safe,undefined);
  assert.ok(expandMatrix({x:1}).diagnostics.length); assert.deepEqual(expandMatrix({x:[1]},{limit:0}).combinations,[{x:1}]);
});
function ownValue(o,k){return Object.prototype.hasOwnProperty.call(o,k)?o[k]:undefined;}
test('reusable references bind local source and reject dynamic, traversal and credential targets',()=>{
  const options={repository:'org/repo',commit:'a'.repeat(40)};
  assert.deepEqual(parseReusableReference('./.github/workflows/ci.yml',options),{repository:'org/repo',path:'.github/workflows/ci.yml',ref:'a'.repeat(40),local:true,dynamic:false});
  assert.equal(parseReusableReference('$/.github/workflows/reuse.yaml',options).local,true);
  assert.equal(parseReusableReference('org/shared/.github/workflows/ci.yml@feature/test').ref,'feature/test');
  for(const invalid of ['https://evil/repo/.github/workflows/ci.yml@main','org/repo/.github/workflows/../ci.yml@main','./.github/workflows/ci.yml@main','org/repo/.github/workflows/ci.yml@${{ inputs.ref }}']) throws(()=>parseReusableReference(invalid,options),'INVALID_REUSABLE');
});

test('job form converts inline scalar dependencies and runners to collections without invalid same-line block indicators', () => {
  const {demoFiles}=require('../services/github-studio/index.cjs');
  const source=demoFiles()[0].content;
  const result=require('../services/github-studio/workflow.cjs').editWorkflow(source,{type:'updateJob',id:'test',patch:{name:'Changed',needs:['install'],'runs-on':['self-hosted','linux'],if:'always()'}});
  const doc=require('yaml').parseDocument(result.source);
  assert.deepEqual(doc.errors,[]);assert.deepEqual(doc.toJS().jobs.test.needs,['install']);assert.deepEqual(doc.toJS().jobs.test['runs-on'],['self-hosted','linux']);assert.match(result.source,/# Repository checks/);
});
