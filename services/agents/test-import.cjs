'use strict';
// Data-only import planning. Every write carries the revision reviewed by the
// user; importing never admits or executes generated source.
const crypto=require('node:crypto'),path=require('node:path'),{pathToFileURL}=require('node:url');
const GraphEngine=require('../../graph-engine.js');
const clone=value=>JSON.parse(JSON.stringify(value));
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const transient=new Set(['bundleId','bundleName','hiddenFromLibrary','lastRun','lastResult','lastRunStatus','lastRunTime','lastRunLog','lastRunAt','last_run','last_result','last_run_status','last_run_time','last_run_log','last_run_duration','last_run_id','last_run_result','status','dateModified','modifiedAt','updatedAt','dateCreated','createdAt','created','modified']);
function definition(value){return Object.fromEntries(Object.entries(value).filter(([key])=>!transient.has(key)));}
const same=(a,b)=>digest(definition(a))===digest(definition(b));
const ref=record=>record.collection+'/'+record.id;
function error(code,message){const e=Error(message);e.code=code;throw e;}
function mergeRecords(previews){const records=new Map();for(const preview of previews)for(const record of preview.records){const key=ref(record),prior=records.get(key);if(prior&&!same(prior.value,record.value))error('CONFLICT','The selected files contain different versions of '+key+'. Choose one export at a time.');if(!prior)records.set(key,clone(record));}return [...records.values()];}
let modelPromise;
const model=()=>modelPromise||=import(pathToFileURL(path.resolve(__dirname,'../../studio-model.js')).href);
async function asSuite(record){if(record.collection==='suites')return clone(record.value);const check=record.value,m=await model(),params=m.parseParameterRows(check.parameterRows||[]);return {...clone(check),id:record.id,language:check.engine,code:check.source||'',steps:check.customSource?[]:check.steps,parameters:params.parameters,parameterSchema:params.schema,timeoutMs:(check.timeout??0)*1000,...(!check.customSource&&['javascript','playwright'].includes(check.engine)?m.prepareVisualExecution(check.steps,{engine:check.engine,parameters:params.parameters,parameterSchema:params.schema}):{})};}
function executionSignature(s){const parameters=Array.isArray(s.parameters)?Object.fromEntries(s.parameters.map(p=>[p.key||p.name,p.value])):s.parameters||{};return digest({engine:s.engine||s.language,code:s.test_code??s.testCode??s.code??'',parameters,parameterSchema:s.parameterSchema||s.parameter_schema||{},inputFiles:s.inputFiles||s.input_files||[],contextVariables:s.contextVariables||s.context_variables||s.inputs||{},setup:s.setup??s.setup_code??'',cleanup:s.cleanup??s.teardown_code??'',validation:s.validation_code||s.validationCode||'',expected:s.test_output??s.expected_output??s.expectedOutput??null,dataset:s.dataSetId||s.datasetId||null,mocks:s.mock_builder||s.mockBuilder||null,fixtureId:s.fixtureId||null,fixtureVersion:s.fixtureVersion||null,projectPath:s.projectPath||null,timeoutMs:s.timeoutMs??0,website:[s.website_method,s.website_url,s.website_html_content,s.website_css_contents,s.website_js_contents,s.vwt_steps_json].map(v=>v??null),debug:s.debug||null});}
async function logicalTests(records){const tests=[];for(const record of records.filter(r=>r.collection==='suites'))tests.push({record,suite:await asSuite(record),members:[record]});for(const record of records.filter(r=>r.collection==='checks')){const suite=await asSuite(record);const pair=tests.find(t=>t.record.collection==='suites'&&t.record.id===record.id&&executionSignature(t.suite)===executionSignature(suite));if(pair)pair.members.push(record);else tests.push({record,suite,members:[record]});}return tests;}
async function previewTestImport(preview,{read}){const existing={};for(const record of preview.records){const saved=await read(record.collection,record.id);existing[ref(record)]=saved?{revision:saved.revision,fingerprint:digest(saved.value),identical:same(saved.value,record.value),name:saved.value.name}:null;}const tests=await logicalTests(preview.records);return {...preview,existing,logicalTestCount:tests.length,existingCount:Object.values(existing).filter(Boolean).length,identicalCount:Object.values(existing).filter(v=>v?.identical).length,differentCount:Object.values(existing).filter(v=>v&&!v.identical).length,conflicts:Object.keys(existing).filter(key=>existing[key])};}
function remap(value,idMap){if(Array.isArray(value))return value.map(v=>remap(v,idMap));if(!value||typeof value!=='object')return value;const result={};for(const [key,item]of Object.entries(value)){if(key==='dependencies'&&Array.isArray(item))result[key]=item.map(dep=>({...dep,id:idMap.get(dep.collection+'/'+dep.id)||dep.id}));else if(key==='suiteId'&&typeof item==='string')result[key]=idMap.get('suites/'+item)||item;else if(key==='checkId'&&typeof item==='string')result[key]=idMap.get('checks/'+item)||item;else if(['dataSetId','datasetId'].includes(key)&&typeof item==='string')result[key]=idMap.get('datasets/'+item)||item;else result[key]=remap(item,idMap);}return result;}
async function planTestImport(previews,{read,mode='library',bundleName='Imported agent tests',duplicatePolicy,duplicatePolicies={}}={}){
  if(!['library','graph'].includes(mode))error('VALIDATION','Choose individual tests or one graph.');
  if(mode==='graph'&&(typeof bundleName!=='string'||!bundleName.trim()))error('VALIDATION','Give the graph a name.');
  if(duplicatePolicy&&!['reuse-identical','keep','replace','copy'].includes(duplicatePolicy))error('VALIDATION','Choose keep, replace or copy for saved tests.');
  if(!duplicatePolicies||typeof duplicatePolicies!=='object'||Array.isArray(duplicatePolicies))error('VALIDATION','Saved-test choices must identify a test and a keep, replace or copy option.');
  if(mode==='library'&&!duplicatePolicy){const seen=new Set();for(const preview of previews)for(const record of preview.records){if(seen.has(ref(record)))error('CONFLICT','The selected exports contain duplicate records. Nothing was imported.');seen.add(ref(record));}}
  const records=mergeRecords(previews),resolved=[],changes=[],idMap=new Map(),copyIds=new Map(),summary={added:0,reused:0,kept:0,replaced:0,copied:0},identities=records.filter(r=>r.collection!=='workflows').map(ref).sort();
  const bundleId='agent-bundle-'+digest(identities).slice(0,20);
  for(const record of records){const key=ref(record),saved=await read(record.collection,record.id),snapshots=previews.filter(p=>p.records.some(r=>ref(r)===key)).map(p=>p.existing?.[key]);
    // Older clients without duplicate options retain their no-overwrite contract.
    if(saved&&!duplicatePolicy&&mode==='library')error('CONFLICT','A saved record already uses '+key+'. Nothing was overwritten.');
    if(snapshots.some(s=>s!==undefined&&(s===null?!!saved:!saved||s.revision!==saved.revision||s.fingerprint!==digest(saved.value))))error('STALE_PREVIEW','Saved tests changed while you were reviewing them. Choose the file again; nothing was changed.');
    const policy=duplicatePolicies[key]||duplicatePolicy||(mode==='graph'?'reuse-identical':null);
    if(policy&&!['reuse-identical','keep','replace','copy'].includes(policy))error('VALIDATION','Choose keep, replace or copy for '+key+'.');
    let value=clone(record.value),id=record.id,prior=saved;
    // Existing workflow views are retained as hidden aliases of the bundle.
    // A new exported workflow is unnecessary when creating the one graph.
    if(mode==='graph'&&record.collection==='workflows'){if(saved&&record.id!==bundleId)resolved.push({...record,value:clone(saved.value),prior:saved});continue;}
    if(saved){if(same(saved.value,value)){summary.reused++;value=clone(saved.value);}else if(policy==='keep'){summary.kept++;value=clone(saved.value);}else if(policy==='replace'){summary.replaced++;}else if(policy==='copy'){summary.copied++;id=copyIds.get(record.id)||record.id.slice(0,90)+'-copy-'+crypto.randomUUID().slice(0,8);copyIds.set(record.id,id);idMap.set(key,id);if('id'in value)value.id=id;prior=null;}else error('CHOICE_REQUIRED','A different version of '+record.value.name+' is already saved. Choose keep, replace or import a copy.');}else summary.added++;
    resolved.push({...record,id,value,prior});
  }
  for(const record of resolved){record.value=remap(record.value,idMap);if(mode==='graph'&&['suites','checks','workflows'].includes(record.collection))record.value={...record.value,bundleId,bundleName:bundleName.trim(),hiddenFromLibrary:true};else if(mode==='library'&&['suites','checks'].includes(record.collection)&&record.value.hiddenFromLibrary)record.value={...record.value,hiddenFromLibrary:false};if(!record.prior||digest(record.value)!==digest(record.prior.value))changes.push({collection:record.collection,id:record.id,value:record.value,expectedRevision:record.prior?.revision??null});}
  let graph=null;
  const tests=await logicalTests(resolved);
  if(mode==='graph'){
    const graphRecords=resolved.filter(r=>r.collection!=='workflows'),start={id:'start',type:'start-runner',position:{x:60,y:100},data:{name:'Run all '+tests.length+' tests',retryTargets:[]}};
    graph={id:bundleId,name:bundleName.trim(),schemaVersion:1,type:'graph',isTestBundle:true,bundleId,bundleTestCount:tests.length,concurrency:4,description:'Run the green start node to run every test in this bundle. Open any test node to inspect its saved source.',dependencies:graphRecords.map(r=>({collection:r.collection,id:r.id})),nodes:[start,...tests.map((test,index)=>({id:'test-'+index,type:'test-suite',onFailure:'continue',position:{x:420+(index%4)*350,y:60+Math.floor(index/4)*180},data:{name:test.suite.name,...(test.record.collection==='suites'?{suiteId:test.record.id}:{checkId:test.record.id,suite:test.suite})}}))],edges:tests.map((_,index)=>({id:'start-test-'+index,source:'start',target:'test-'+index}))};
    const validation=GraphEngine.validate(graph,{strict:true});if(!validation.valid)error('VALIDATION',validation.errors.join(' '));
    const old=await read('workflows',bundleId);
    if(old&&!old.value.isTestBundle)error('CONFLICT','A different saved graph uses this bundle identifier. Nothing was overwritten.');
    if(!old||digest(old.value)!==digest(graph))changes.push({collection:'workflows',id:bundleId,value:graph,expectedRevision:old?.revision??null});
  }
  return {changes,records:resolved.filter(r=>mode!=='graph'||r.collection!=='workflows').map(r=>({collection:r.collection,id:r.id,name:r.value.name})),summary,logicalTestCount:tests.length,bundleId:graph?.id,workflow:graph,executionStarted:false};
}
async function importTestPlan(plan,{transact}){const result=plan.changes.length?await transact(plan.changes):{};return {...plan,changes:undefined,...result,imported:plan.records.reduce((counts,r)=>(counts[r.collection]=(counts[r.collection]||0)+1,counts),{}),executionStarted:false};}
module.exports={previewTestImport,planTestImport,importTestPlan,logicalTests,definition,same};
