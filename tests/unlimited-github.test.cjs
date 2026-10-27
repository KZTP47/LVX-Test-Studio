'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const model=require('../github-workflow-model.js'),workflow=require('../services/github-studio/workflow.cjs'),sources=require('../services/github-studio/test-source.cjs');
const {createService}=require('../services/github-studio/remote.cjs'),{createDemoTransport,DEFAULT_FILES}=require('../services/github-studio/demo-remote.cjs');
const {sourcePatch}=require('../services/github-studio/diff.cjs'),{applyPatch}=require('diff');
const sha='a'.repeat(40),root='C:\\unlimited-github-test',valid='on: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n';
function fixture(extra={}){const transport=createDemoTransport(extra),journal=new Map(),service=createService({workspaceRoot:root,request:transport,journal:{read:async id=>journal.get(id),write:async(id,value)=>journal.set(id,structuredClone(value))}});return {service,transport,journal,call:(action,p={})=>service.handle(action,{workspaceRoot:root,repository:transport.state.repository,...p})};}

test('GH-LANES GH-WORKFLOWS GH-BOARD-BYTES: board preserves more than 24 lanes, 100 workflows and 8 MiB',()=>{
 const repositories=Array.from({length:25},(_,i)=>({id:'repo-'+i,fullName:'owner/repo-'+i,ref:'main',commit:sha,selected:'.github/workflows/0.yml',workflows:Array.from({length:101},(_,j)=>({path:'.github/workflows/'+j+'.yml',source:valid}))}));
 repositories[0].workflows[0].source='#'+ 'x'.repeat(9*1024*1024)+'\n'+valid;
 const board={version:1,repositories};assert.ok(Buffer.byteLength(JSON.stringify(board))>8*1024*1024);assert.equal(model.validateBoard(board),board);
 assert.throws(()=>model.validateBoard({version:1,repositories:[repositories[0],repositories[0]]}),/identities/);
});
test('GH-JOBS GH-SOURCE-BYTES: 501 jobs and large workflow settings remain inspectable and editable',()=>{
 const source='#'+'x'.repeat(600*1024)+'\non: push\njobs:\n'+Array.from({length:501},(_,i)=>'  check'+i+': {runs-on: ubuntu-latest, steps: [{run: echo ok}]}\n').join('');
 assert.equal(workflow.inspectWorkflow(source).jobs.length,501);
 assert.equal(model.workflowGraph(source,require('yaml').parseDocument).nodes.length,501);
 const edited=workflow.editWorkflow(source,{type:'setWorkflow',patch:{name:'x'.repeat(600*1024)}});assert.equal(edited.valid,true);assert.equal(edited.name.length,600*1024);
});
test('GH-SNAPSHOT-BYTES GH-REQUEST GH-PUBLISH-TEXT: large immutable blob, snapshot and staged edits retain exact bytes',async()=>{
 const content='//'+ 'x'.repeat(9*1024*1024)+'\n',f=fixture({files:[...DEFAULT_FILES,{path:'tests/large.test.ts',content}]}),repo=await f.call('snapshot');
 const file=repo.files.find(f=>f.path==='tests/large.test.ts');assert.equal(file.content,content);
 file.content+='test("large",()=>{});\n';const p=await f.call('previewStage',{baseCommit:repo.commit,files:repo.files,stagedPaths:[file.path],mode:'pr',message:'m'.repeat(4001),title:'t'.repeat(251),body:'b'.repeat(20001)});
 assert.equal(p.changes.length,1);assert.equal(applyPatch(content,p.diff),file.content);assert.equal(f.transport.state.calls.filter(c=>c.method!=='GET').length,0);
 await f.service.close();
});
test('GH-TEST-DECLARATIONS: more than 10000 declarations are discoverable in JavaScript and Robot',async()=>{
 const source="import {test} from 'vitest';\n"+Array.from({length:10001},(_,i)=>'test("case'+i+'",()=>{});').join('\n');
 assert.equal((await sources.discover({path:'a.test.ts',source})).cases.length,10001);
 const robot='*** Test Cases ***\n'+Array.from({length:10001},(_,i)=>'Case '+i+'\n    Log    '+i+'\n').join('');
 assert.equal((await sources.discover({path:'cases.robot',source:robot})).cases.length,10001);
});
test('GH-MATRIX: all variants are navigable, exact astronomical totals need no allocation, includes/excludes retain semantics',()=>{
 const matrix={x:Array.from({length:300},(_,i)=>i),include:[{kind:'extra'}]},first=workflow.expandMatrix(matrix,{limit:257});assert.equal(first.combinations.length,257);assert.equal(first.total,300);
 const tail=workflow.expandMatrix(matrix,{offset:first.nextOffset,limit:100});assert.equal(tail.combinations.length,43);assert.equal(tail.nextOffset,null);assert.equal(tail.combinations.at(-1).x,299);
 const huge=Object.fromEntries(Array.from({length:40},(_,i)=>['a'+i,[0,1]]));huge.exclude=[{a0:0}];huge.include=[{a0:2,extra:'standalone'},{note:'applied'}];
 const h=workflow.expandMatrix(huge,{offset:String(2n**39n-1n),limit:3});assert.equal(h.total,Number(2n**39n)+1);assert.equal(h.combinations.length,2);assert.equal(h.combinations[0].a0,1);assert.equal(h.combinations[0].note,'applied');assert.deepEqual(h.combinations[1],{a0:2,extra:'standalone'});
 const enormous=workflow.expandMatrix(Object.fromEntries(Array.from({length:80},(_,i)=>['b'+i,[0,1]])),{offset:String(2n**80n-1n),limit:1});assert.equal(enormous.total,String(2n**80n));assert.equal(Object.values(enormous.combinations[0]).every(v=>v===1),true);
 const deep=Object.fromEntries(Array.from({length:10001},(_,i)=>['d'+i,[1]]));deep.exclude=[{d10000:0}];assert.equal(Object.keys(workflow.expandMatrix(deep,{limit:1}).combinations[0]).length,10001);
 assert.equal(workflow.expandMatrix({x:[1,2,3]},{limit:0}).combinations.length,3);assert.throws(()=>workflow.expandMatrix(matrix,{limit:-1}),{code:'MATRIX_LIMIT'});
});
test('GH-MATRIX: paged decision-tree output matches an independent exhaustive oracle with overlapping rules',()=>{
 const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),keys=['x','y','z'];let seed=478;
 const rand=n=>{seed=(seed*1664525+1013904223)>>>0;return seed%n;};
 for(let trial=0;trial<120;trial++){
  const matrix={x:[0,1,2],y:[0,1],z:[0,1,2]},rule=()=>Object.fromEntries(keys.filter(()=>rand(2)).map(k=>[k,rand(4)]));matrix.exclude=Array.from({length:rand(5)},rule);matrix.include=Array.from({length:rand(5)},()=>({...rule(),extra:rand(3)}));
  let originals=[{}];for(const k of keys)originals=originals.flatMap(row=>matrix[k].map(value=>({...row,[k]:value})));originals=originals.filter(row=>!matrix.exclude.some(rule=>Object.entries(rule).every(([k,v])=>Object.hasOwn(row,k)&&equal(row[k],v))));
  const augmented=originals.map(row=>({...row})),additional=[];for(const addition of matrix.include){let used=false;originals.forEach((row,i)=>{if(Object.entries(addition).every(([k,v])=>!Object.hasOwn(row,k)||equal(row[k],v))){Object.assign(augmented[i],addition);used=true;}});if(!used)additional.push(addition);}
  const expected=[...augmented,...additional],actual=[];let offset=0;do{const page=workflow.expandMatrix(matrix,{limit:3,offset});assert.equal(page.total,expected.length);actual.push(...page.combinations);offset=page.nextOffset;}while(offset!==null);assert.deepEqual(actual,expected);
 }
});
test('GH-SOURCE-BYTES: service facade permits large source, test titles and tag collections while retaining stale-source checks',async()=>{
 const service=require('../services/github-studio/index.cjs').createService({getWorkspaceRoot:()=>root});
 const source='#'+'x'.repeat(600*1024)+'\n'+valid;
 assert.equal((await service.handle('workflowInspect',{workspaceRoot:root,source})).valid,true);
 const path='tests/long.test.ts',testSource="import {test} from '@playwright/test';test('old',()=>{});",d=await sources.discover({path,source:testSource});
 const renamed=await sources.mutate({path,source:testSource,caseId:d.cases[0].id,operation:{type:'rename',title:'x'.repeat(2001)}});assert.equal(renamed.discovery.cases[0].title.length,2001);
 const tags=Array.from({length:101},(_,i)=>'tag'+i),tagged=await sources.mutate({path,source:renamed.source,caseId:renamed.discovery.cases[0].id,operation:{type:'tags',tags}});assert.equal(tagged.discovery.cases[0].ownTags.length,101);
 await assert.rejects(service.handle('workflowEdit',{workspaceRoot:root,source,expectedHash:'stale',operation:{type:'setWorkflow',patch:{name:'wrong'}}}),/Source changed/);await service.close();
});
test('GH-LINK-INFERENCE: long package script chains resolve and genuine cycles terminate',async()=>{
 const scripts=Object.fromEntries(Array.from({length:2000},(_,i)=>['step'+i,i===1999?'npx vitest run tests/a.test.ts':'npm run step'+(i+1)]));
 const input={workflows:[{path:'.github/workflows/ci.yml',source:'on: push\njobs:\n  test:\n    steps:\n      - run: npm run step0\n'}],files:[{path:'tests/a.test.ts',source:"import {test} from 'vitest'; test('a',()=>{});"}],packageSources:[{path:'package.json',source:JSON.stringify({scripts})}]};
 assert.equal((await sources.inferLinks(input)).links.length,1);scripts.step1999='npm run step0';input.packageSources[0].source=JSON.stringify({scripts});assert.match((await sources.inferLinks(input)).unresolvedSteps[0].reason,/cycle/);
});
test('GH-DIFF: large disjoint edits and exact newline variants remain applicable without edit-distance cutoff',()=>{
 const before=Array.from({length:25001},(_,i)=>'old-'+i+'\n').join(''),after=Array.from({length:25001},(_,i)=>'new-'+i+'\n').join('');assert.equal(applyPatch(before,sourcePatch('a/x','b/x',before,after)),after);
 for(const [a,b]of [['','hello'],['hello',''],['a\r\nb\r\n','a\r\nc'],['same\nfirst\nx\nlast\n','same\nnext\nx\nlast\n']])assert.equal(applyPatch(a,sourcePatch('a/x','b/x',a,b)),b);
});
test('GH-RUN-HISTORY: all 12 pages of runs and jobs load; pagination cycles and wrong endpoint fail closed',async()=>{
 let mode='valid',calls=0;const endpoint='/repos/owner/repo/actions/workflows/ci.yml/runs';
 const request=async(url,init)=>{assert.equal(init.method,'GET');const u=new URL(url),page=Number(u.searchParams.get('page')||1);calls++;if(u.pathname==='/repos/owner/repo/actions/runs/1')return Response.json({head_sha:sha});
  const key=u.pathname===endpoint?'workflow_runs':'jobs',next=mode==='cycle'?1:page+1,path=mode==='wrong'?'/repos/owner/repo/pulls':u.pathname;
  return Response.json({[key]:Array.from({length:100},(_,i)=>({id:(page-1)*100+i+1,path:'.github/workflows/ci.yml',head_sha:sha,name:'job'}))},{headers:page<12?{link:'<https://api.github.com'+path+'?page='+next+'>; rel="next"'}:{}});};
 const service=createService({workspaceRoot:root,request}),p={workspaceRoot:root,repository:'owner/repo',expectedCommit:sha,workflowPath:'.github/workflows/ci.yml'};
 assert.equal((await service.handle('listRuns',p)).runs.length,1200);assert.equal(calls,12);assert.equal((await service.handle('runJobs',{...p,runId:1,attempt:1})).jobs.length,1200);
 mode='cycle';await assert.rejects(service.handle('listRuns',p),{code:'UNSAFE_PAGINATION'});mode='wrong';await assert.rejects(service.handle('listRuns',p),{code:'UNSAFE_PAGINATION'});await service.close();
});
test('GH-RECOVERY: direct publication recovers through more than 32 later commits without another write',async()=>{
 const f=fixture(),repo=await f.call('snapshot');repo.files.find(f=>f.path==='tests/cart.test.ts').content+='\n// changed';const preview=await f.call('previewStage',{baseCommit:repo.commit,files:repo.files,stagedPaths:['tests/cart.test.ts'],mode:'direct',message:'Change'}),operationId=crypto.randomUUID();
 let lost=false;f.transport.state.after=call=>{if(call.path==='/graphql'&&!lost){lost=true;throw Error('lost');}};assert.equal((await f.call('publish',{previewId:preview.previewId,operationId})).state,'unknown');
 const applied=f.transport.state.refs.get('heads/main');for(let i=0;i<65;i++){const old=f.transport.state.commits.get(f.transport.state.refs.get('heads/main')),sha=f.transport.helpers.commit(old.tree.sha,[old.sha],'Later '+i);f.transport.state.refs.set('heads/main',sha);}
 const recovered=await f.call('reconcile',{operationId});assert.equal(recovered.state,'complete');assert.equal(recovered.commitSha,applied);assert.equal(f.transport.state.calls.filter(c=>c.path==='/graphql').length,1);await f.service.close();
});
test('GH-REQUEST: request cancellation still aborts on workspace close without an artificial request deadline',async()=>{
 let ready;const started=new Promise(r=>{ready=r;});const service=createService({workspaceRoot:root,request:(_url,{signal})=>new Promise((_resolve,reject)=>{ready();signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})});
 const pending=service.handle('snapshot',{workspaceRoot:root,repository:'owner/repo'});await started;await service.close();await assert.rejects(pending);
});
test('GH-REUSABLE-DEPTH: more than five annotated tag hops resolve; cycles remain rejected',async()=>{
 const f=fixture();let mode='long';const base=f.transport,request=async(url,init)=>{const p=new URL(url).pathname;if(p.endsWith('/git/ref/tags/long'))return Response.json({object:{type:'tag',sha:'1'.repeat(40)}});if(p.includes('/git/tags/')){const n=Number.parseInt(p.split('/').at(-1)[0],16);return Response.json({object:mode==='cycle'?{type:'tag',sha:'1'.repeat(40)}:n<8?{type:'tag',sha:(n+1).toString(16).repeat(40)}:{type:'commit',sha:base.state.initialCommit}});}return base(url,init);};request.simulated=true;
 const service=createService({workspaceRoot:root,request}),p={workspaceRoot:root,repository:base.state.repository,commit:base.state.initialCommit,uses:base.state.repository+'/.github/workflows/ci.yml@long'};
 assert.match((await service.handle('inspectReusable',p)).source,/jobs:/);mode='cycle';await assert.rejects(service.handle('inspectReusable',p),{code:'INVALID_REUSABLE'});await service.close();await f.service.close();
});
