'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const HERE=__dirname,workspace=path.join(HERE,'workspace'),config=JSON.parse(fs.readFileSync(path.join(HERE,'lab-config.json')));
const studioRoot=path.resolve(HERE,config.studioRoot),port=config.port,marker=config.marker;
const {createNativeTransport}=require(path.join(studioRoot,'services/agents/native.cjs'));
const native=createNativeTransport({timeoutMs:110000});
let flaky=0,tail=Promise.resolve(),requests=0;const active=new Set();const eventFile=path.join(HERE,'evidence/service-events.json');const events=fs.existsSync(eventFile)?JSON.parse(fs.readFileSync(eventFile)):[];
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
function log(event){events.push({at:new Date().toISOString(),...event});fs.mkdirSync(path.join(HERE,'evidence'),{recursive:true});fs.writeFileSync(path.join(HERE,'evidence/service-events.json'),JSON.stringify(events,null,2));}
async function serve(req,res){
 const url=new URL(req.url,'http://127.0.0.1:'+port),origin=req.headers.origin;
 if(origin&&origin!=='http://127.0.0.1:'+port){res.writeHead(403);res.end('This lab accepts its own local origin only.');return;}
 const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','X-LVX-Lab':marker});res.end(JSON.stringify(value));};
 if(req.method==='GET'&&url.pathname==='/health')return json(200,{status:'ready',lab:marker,workspace:fs.realpathSync(workspace),provider:'real installed Codex CLI',requests});
 if(req.method==='GET'&&url.pathname==='/api/catalog')return json(200,{version:1,currency:'SEK',items:[{sku:'sensor',name:'Sensor kit',price:249,stock:12},{sku:'relay',name:'Relay module',price:99,stock:30}],region:'SE',traceId:'lab-catalog'});
 if(req.method==='GET'&&url.pathname==='/api/flaky'){flaky++;return json(flaky<=2?503:200,{attempt:flaky,recovered:flaky>2});}
 if(req.method==='POST'&&url.pathname==='/admin/reset'){flaky=0;return json(200,{reset:true});}
 if(req.method==='POST'&&url.pathname==='/admin/stop'){for(const controller of active)controller.abort();await tail;json(200,{stopped:true});setTimeout(()=>server.close(()=>process.exit(0)),100);return;}
 if(req.method==='POST'&&url.pathname==='/deploy'){
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
  if(!body.reviewDecisionId)throw Error('A persisted LVX review decision is required.');
  const source=path.join(workspace,'generated/reviewed.html');if(!fs.existsSync(source))throw Error('No reviewed HTML was saved.');
  const html=fs.readFileSync(source),target=path.join(workspace,'generated/deployed/index.html');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,html);
  const receipt={deployed:true,localOnly:true,sha256:digest(html),reviewDecisionId:body.reviewDecisionId,url:'http://127.0.0.1:'+port+'/deployed'};log({kind:'actual-local-deployment',...receipt});return json(200,receipt);
 }
 if(req.method==='POST'&&url.pathname==='/v1/chat/completions'){
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2*1024*1024)throw Error('Lab request too large');}
  const body=JSON.parse(raw);if(!Array.isArray(body.messages))throw Error('No conversation supplied.');
  if(++requests>40)throw Error('The lab gateway has reached its40-request session budget. Restart it explicitly.');
  const text=body.messages.map(message=>`[${message.role}]\n${message.content}`).join('\n\n');
  const controller=new AbortController();active.add(controller);res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  const pending=tail.then(()=>native.execute({node:{id:'gateway',provider:'codex',permission:'read-only',model:'',effort:'',instructions:''},session:{},text:'This is a user-requested local LVX showcase. Work only on the supplied task and example project. Do not edit files, install software, use unrelated folders or access authentication files. Return the requested output directly.\n\n'+text,workspaceRoot:workspace,signal:controller.signal}));
  tail=pending.catch(()=>{});let result;try{result=await pending;}finally{active.delete(controller);}log({kind:'real-codex-gateway',status:result.status,response:result.text,error:result.error||null});
  if(result.status!=='completed')return json(502,{error:{message:result.error||result.status}});
  return json(200,{id:crypto.randomUUID(),choices:[{finish_reason:'stop',message:{role:'assistant',content:result.text}}]});
 }
 if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/site'||url.pathname==='/deployed')){
  const file=url.pathname==='/deployed'?path.join(workspace,'generated/deployed/index.html'):path.join(workspace,'site/index.html');if(!fs.existsSync(file))return json(404,{error:'Run the reviewed deployment workflow first.'});res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(fs.readFileSync(file));
 }
 return json(404,{error:'Unknown lab route'});
}
const server=http.createServer((req,res)=>serve(req,res).catch(error=>{log({kind:'service-error',message:error.message});if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}));
server.listen(port,'127.0.0.1',()=>{log({kind:'started',port,workspace});console.log('LVX_SHOWCASE_SERVICE_READY '+port);});
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
