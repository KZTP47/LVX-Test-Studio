#!/usr/bin/env node
'use strict';
// CLI deliberately uses the same engine as Electron, with an explicit workspace
// and token. Loopback HTTP mode has no unauthenticated execution endpoint.
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const crypto=require('node:crypto');const http=require('node:http');
const {createService,TERMINAL}=require('./index.cjs');
function arg(name){const i=process.argv.indexOf(`--${name}`);return i<0?null:process.argv[i+1];}
function authorized(expected,actual){if(typeof expected!=='string'||expected.length<24||typeof actual!=='string')return false;const a=Buffer.from(expected),b=Buffer.from(actual);return a.length===b.length&&crypto.timingSafeEqual(a,b);}
async function main(){
    const command=process.argv[2],token=process.env.LVX_CI_TOKEN, supplied=process.env.LVX_CI_AUTH_TOKEN||arg('token');
    if(!authorized(token,supplied))throw new Error('Authentication failed. Set LVX_CI_TOKEN and LVX_CI_AUTH_TOKEN to the same token (at least 24 characters).');
    const root=arg('workspace');if(!root||!fs.existsSync(root))throw new Error('An existing --workspace is required.');
    const dataDir=arg('data-dir')||path.join(os.homedir(),'.lvx','ci',crypto.createHash('sha256').update(path.resolve(root)).digest('hex').slice(0,16));
    const service=createService({dataDir,workspaceRoot:root,runtimePaths:process.env.LVX_RUNTIME_PATHS?JSON.parse(process.env.LVX_RUNTIME_PATHS):{}});
    const poll=async id=>{for(;;){const r=await service.handle('getRun',{id});if(TERMINAL.has(r.status))return r;await new Promise(resolve=>setTimeout(resolve,30));}};
    if(command==='run'){
        try{const file=arg('workflow');if(!file)throw new Error('--workflow JSON file is required.');const workflow=JSON.parse(fs.readFileSync(file,'utf8'));const start=await service.handle('runWorkflow',{workflow});const result=await poll(start.id);process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=result.status==='SUCCESS'&&result.total>0&&result.passed===result.total&&!result.failed&&!result.errors&&!result.pending?0:1;}finally{await service.close();}
    }else if(command==='serve'){
        const port=Number(arg('port')||0);if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid port.');
        const server=http.createServer(async(req,res)=>{
            res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
            if(!authorized(token,(req.headers.authorization||'').replace(/^Bearer /,''))){res.writeHead(401);res.end(JSON.stringify({error:'Authentication required.'}));return;}
            try{
                const url=new URL(req.url,'http://127.0.0.1');let result;
                if(req.method==='GET'&&/^\/runs\/[\w-]+$/.test(url.pathname))result=await service.handle('getRun',{id:url.pathname.split('/')[2]});
                else if(req.method==='POST'&&url.pathname==='/runs'){
                    let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>2*1024*1024)throw new Error('Request exceeds 2 MiB.');}result=await service.handle('runWorkflow',{workflow:JSON.parse(body)});res.statusCode=202;
                }else if(req.method==='POST'&&/^\/runs\/[\w-]+\/cancel$/.test(url.pathname))result=await service.handle('cancel',{id:url.pathname.split('/')[2]});
                else{res.writeHead(404);res.end(JSON.stringify({error:'Unknown endpoint.'}));return;}
                res.end(JSON.stringify(result));
            }catch(error){res.statusCode=400;res.end(JSON.stringify({error:error.message}));}
        });
        server.requestTimeout=15000;server.headersTimeout=10000;await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));process.stdout.write(JSON.stringify({url:`http://127.0.0.1:${server.address().port}`,authenticated:true})+'\n');
        const stop=async()=>{server.close();await service.close();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
    }else{await service.close();throw new Error('Use run or serve.');}
}
if(require.main===module)main().catch(error=>{process.stderr.write(JSON.stringify({status:'ERROR',total:0,passed:0,failed:0,errors:1,error:error.message})+'\n');process.exitCode=1;});
module.exports={authorized,main};
