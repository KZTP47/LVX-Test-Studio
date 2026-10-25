'use strict';
const statuses=new Set(['SUCCESS','FAILURE','ERROR','CANCELLED','RUNNING','PENDING']);
const engines=new Set(['workflow','javascript','playwright','python','robot','java','csharp','jest','junit','nunit','pytest']);
const nodeTypes=new Set(require('./machina-catalog.cjs').nodes.map(node=>node.id));
for(const type of nodeTypes)engines.add(type);
const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
// Preserve typed control fields, never a similarly named field inside user evidence.
function redactRun(run,redact){
 const safe=redact(run);
 if(!run||typeof run!=='object')return safe;
 if(uuid(run.id))safe.id=run.id;
 if(uuid(run.runId))safe.runId=run.runId;
 if(uuid(run.originalRunId))safe.originalRunId=run.originalRunId;
 if(statuses.has(run.status))safe.status=run.status;
 if(engines.has(run.engine))safe.engine=run.engine;
 if(typeof run.workspaceRoot==='string')safe.workspaceRoot=run.workspaceRoot;
 if(run.engine==='workflow'&&run.results&&typeof run.results==='object')safe.results=Object.fromEntries(Object.entries(run.results).map(([id,node])=>[id,redactRun(node,redact)]));
 for(const key of ['pendingReviews','reviewDecisions','interruptedReviews'])if(Array.isArray(run[key]))safe[key]=run[key].map(item=>redactReview(item,redact));
 return safe;
}
function redactReview(review,redact){
 const safe=redact(review);
 if(!review||typeof review!=='object')return safe;
 for(const key of ['id','decisionId'])if(uuid(review[key]))safe[key]=review[key];
 if(typeof review.nodeId==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(review.nodeId))safe.nodeId=review.nodeId;
 if(['code-review','ai-unit-test','push-deploy','deployment'].includes(review.kind))safe.kind=review.kind;
 if(['pending','approved','rejected','resolved','interrupted'].includes(review.state))safe.state=review.state;
 if(['approve','reject'].includes(review.decision))safe.decision=review.decision;
 for(const key of ['proposalHash','finalCodeHash'])if(typeof review[key]==='string'&&/^[a-f0-9]{64}$/.test(review[key]))safe[key]=review[key];
 for(const key of ['automated','deployRequested'])if(typeof review[key]==='boolean')safe[key]=review[key];
 return safe;
}
function redactProjectRecord(collection,value,redact){
 if(collection==='runs')return redactRun(value,redact);
 const safe=redact(value);
 if(!['checks','suites','workflows','pipelines','execution-config','datasets','versions'].includes(collection))return safe;
 const types=new Set(['string','number','integer','boolean','object','array','any','date','email']);
 function restore(source,target,path=[]){
  if(!source||!target||typeof source!=='object'||typeof target!=='object')return;
  if(path.some(key=>['artifacts','rows','output','stdout','stderr','logs'].includes(key))||path.includes('data')&&!path.includes('nodes'))return;
  if(engines.has(source.engine))target.engine=source.engine;
  if(path.at(-2)==='nodes'&&nodeTypes.has(source.type))target.type=source.type;
  if(typeof source.language==='string'&&[...engines,'website','security','unit'].includes(source.language))target.language=source.language;
  if(uuid(source.id))target.id=source.id;
  if(types.has(source.type)&&path.some(key=>['parameterSchema','parameter_schema','schema','columns'].includes(key)))target.type=source.type;
  for(const [key,child]of Object.entries(source))if(child&&typeof child==='object')restore(child,target[key],[...path,key]);
 }
 restore(value,safe);return safe;
}
module.exports={redactRun,redactProjectRecord,redactReview};
