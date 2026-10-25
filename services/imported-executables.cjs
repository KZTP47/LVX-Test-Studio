'use strict';
const crypto=require('node:crypto'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const catalog=require('./machina-catalog.cjs');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
// Imported declarative tasks can have effects without containing source code.
// Bind their trust to both authored configuration and stable node identity.
async function executableHashes(value){
 const found=new Set();
 async function walk(v){
  if(!v||typeof v!=='object')return;
  if(Array.isArray(v)){for(const x of v)await walk(x);return;}
  if(catalog.getNode(v.type)){
   const type=catalog.normalizeType(v.type);
   found.add(hash('lvx-native-node:'+type+':'+JSON.stringify(v.data||v.config||{})));
   if(typeof v.id==='string'&&v.id)found.add(hash('lvx-native-node-id:'+type+':'+v.id));
  }
  if(v.schemaVersion===1&&typeof v.id==='string'&&Array.isArray(v.nodes)&&v.nodes.some(node=>['codex','claude','gemini','api'].includes(node?.provider))){
   found.add(hash('lvx-agent-board:'+JSON.stringify({id:v.id,goal:v.goal,instructions:v.instructions,nodes:v.nodes,edges:v.edges,mode:v.mode,maxTurns:v.maxTurns,concurrency:v.concurrency,acceptanceWorkflowId:v.acceptanceWorkflowId})));
   found.add(hash('lvx-agent-board-id:'+v.id));
  }
  if(require('../execution-validation.js').getSuiteValidationMode(v.language||v.engine,v.expected_output||v.expectedOutput)==='python-assertions')found.add(hash(v.expected_output||v.expectedOutput));
  if(v.website_target&&typeof v.website_target==='object')found.add(hash('lvx-website-target:'+JSON.stringify(v.website_target)));
  if(v.target?.version===1&&['files','url'].includes(v.target.kind))found.add(hash('lvx-website-target:'+JSON.stringify(v.target)));
  for(const [k,x]of Object.entries(v)){
   if(['code','validationCode','validation_code','test_code','testCode','generatedCode','command','cmd','source','setup','cleanup','setup_code','teardown_code','html','websiteHTML','website_html_content'].includes(k)&&typeof x==='string'&&x.trim())found.add(hash(x));
   else if(k==='website_js_contents'&&Array.isArray(x)){for(const item of x){const script=typeof item==='string'?item:item?.content;if(typeof script==='string'&&script.trim())found.add(hash(script));}}
   else if(x&&typeof x==='object')await walk(x);
  }
  if(Array.isArray(v.steps)&&['javascript','playwright'].includes(v.engine)&&v.steps.length){
   try{const model=await import(pathToFileURL(path.join(__dirname,'../studio-model.js')).href);found.add(hash(model.prepareVisualExecution(v.steps,{engine:v.engine}).code));}
   catch{/* Invalid authored drafts are rejected by the execution validator. */}
  }
 }
 await walk(value);return [...found];
}
module.exports={executableHashes};
