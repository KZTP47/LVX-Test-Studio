'use strict';
// Parse data only. Preview never evaluates source, imports modules or runs tests.
const crypto = require('node:crypto');
const vm = require('node:vm');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const GraphEngine = require('../../graph-engine.js');
const {ENGINES} = require('../execution/adapters.cjs');
const {verifyArchive, scrub} = require('../workspace/archive.cjs');
const ALLOWED = new Set(['suites','checks','workflows','datasets']);
const KEY=/^[a-zA-Z0-9][a-zA-Z0-9_.@:-]{0,127}$/;
const VISUAL_STEPS=new Set(['compare','assign','publish','http','repeat','condition','goto','fill','click','text']);
function validateCheckShape(check) {
  if(!ENGINES.includes(check.engine))throw Error('Unsupported check engine: '+check.engine);
  if(!Array.isArray(check.steps))throw Error('A saved test needs a steps array.');
  if(check.customSource!==undefined&&typeof check.customSource!=='boolean')throw Error('Custom source must be on or off.');
  if(check.parameterRows!==undefined&&!Array.isArray(check.parameterRows))throw Error('Test parameters must be a list.');
  let count=0;
  const walk=(steps,depth=0)=>{if(depth>12)throw Error('Steps are nested too deeply.');for(const step of steps){if(!step||!VISUAL_STEPS.has(step.type))throw Error('Unsupported visual step: '+step?.type);if(++count>1000)throw Error('A test can contain at most 1,000 steps.');if(step.children!==undefined){if(!Array.isArray(step.children))throw Error('Nested test steps must be a list.');walk(step.children,depth+1);}}};
  walk(check.steps);
  if(['jest','junit','nunit','pytest'].includes(check.engine)) {
    if(typeof check.projectPath!=='string'||!check.projectPath.trim())throw Error('A native project test needs a project folder.');
  } else if(check.customSource||!['javascript','playwright'].includes(check.engine)) {
    if(typeof check.source!=='string'||!check.source.trim())throw Error('A source test needs executable source.');
    if(['javascript','playwright'].includes(check.engine))try{new vm.Script('(async()=>{\n'+check.source+'\n})');}catch(error){throw Error('Test source is not valid LVX JavaScript: '+error.message);}
  } else if(!check.steps.length)throw Error('Add at least one visual test step.');
}
function parseGeneratedTests(text, filename='agent reply') {
  if(typeof text!=='string'||Buffer.byteLength(text)>32*1024*1024)throw Error('Choose a JSON export smaller than 32 MB.');
  let data;
  const blocks=[...text.matchAll(/```(?:json|lvx-tests|lvx-workspace)\s*\n([\s\S]*?)```/gi)].map(m=>m[1]);
  for(const candidate of [text,...blocks]) {try {const parsed=JSON.parse(candidate);if(parsed?.payload?.records||parsed?.records||parsed?.suites||parsed?.checks){data=parsed;break;}}catch{}}
  if(!data)throw Error('No LVX tests found. Choose the exported .lvx.json file, or ask the agent to return an lvx-tests JSON bundle with records. Ordinary prose and Playwright project files are not saved tests.');
  if(data.format==='lvx-workspace') {const result=verifyArchive(data);if(!result.valid)throw Error(result.errors.join(' '));}
  let records=data.payload?.records||data.records;
  if(!records)records=[...(data.suites||[]).map(value=>({collection:'suites',id:value.id||crypto.randomUUID(),value})),...(data.checks||[]).map(value=>({collection:'checks',id:value.id||crypto.randomUUID(),value}))];
  if(!Array.isArray(records)||records.length>1000)throw Error('Use a bundle with 1–1,000 test, data and workflow records.');
  const ignored=records.filter(r=>!ALLOWED.has(r?.collection)).length;
  records=records.filter(r=>ALLOWED.has(r?.collection)).map(r=>JSON.parse(JSON.stringify(r)));
  if(!records.some(r=>['checks','suites'].includes(r.collection)))throw Error('This file contains no saved tests. Export the tests from the agent project first.');
  const ids=new Set();
  for(const r of records) {
    if(!KEY.test(r.id||'')||!r.value||typeof r.value!=='object'||Array.isArray(r.value))throw Error('A test record is invalid.');
    const key=r.collection+'/'+r.id;if(ids.has(key))throw Error('The bundle contains duplicate test identifiers.');ids.add(key);
    if(!String(r.value.name||'').trim())throw Error('Every imported test, dataset and workflow needs a name.');
    if(JSON.stringify(scrub(r.value))!==JSON.stringify(r.value))throw Error('The file contains credential data. Export it without credentials before importing.');
    if(r.collection==='suites') {
      const engine=r.value.language||r.value.engine;
      if(!['javascript','playwright','python','robot','java','csharp','website'].includes(engine))throw Error('Unsupported suite engine: '+engine);
      const code=r.value.code||r.value.test_code;
      if(engine!=='website'&&(typeof code!=='string'||!code.trim()))throw Error('A native test suite needs executable source.');
      if(['javascript','playwright'].includes(engine)) {try{new vm.Script('(async()=>{\n'+code+'\n})');}catch(error){throw Error('Test source is not valid LVX JavaScript: '+error.message);}}
    }
    if(r.collection==='checks')validateCheckShape(r.value);
    if(r.collection==='workflows') {const validation=GraphEngine.validate(r.value,{strict:true});if(!validation.valid)throw Error('Workflow: '+validation.errors.join(' '));}
  }
  for(const r of records)for(const dep of r.value.dependencies||[])if(!ids.has(dep.collection+'/'+dep.id))throw Error('Missing dependency '+dep.collection+'/'+dep.id+'. Include it in the export.');
  return {filename,records,ignored,counts:records.reduce((m,r)=>(m[r.collection]=(m[r.collection]||0)+1,m),{}),fingerprint:crypto.createHash('sha256').update(JSON.stringify(records)).digest('hex')};
}
let modelPromise;
async function validateGeneratedTests(preview) {
  // Use the same compiler and parameter validator as the editor. Importing this
  // local pure module compiles data only; generated test source is never run.
  const model=await (modelPromise||=import(pathToFileURL(path.join(__dirname,'../../studio-model.js')).href));
  for(const record of preview.records.filter(r=>r.collection==='checks')) {
    const check=record.value,parsed=model.parseParameterRows(check.parameterRows||[]);
    if(!check.customSource&&['javascript','playwright'].includes(check.engine))model.prepareVisualExecution(check.steps,{engine:check.engine,parameters:parsed.parameters,parameterSchema:parsed.schema});
  }
  return preview;
}
module.exports={parseGeneratedTests,validateGeneratedTests};
