'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process');const {pipeline}=require('node:stream/promises'),{Readable,Transform}=require('node:stream');
const {officialFetch}=require('./catalog.cjs');
const {nonnegative,longTimeout}=require('../capacity.cjs');
const {stopProcessTree}=require('../process-control.cjs');
const cancelled=signal=>{if(signal?.aborted)throw Object.assign(Error('Setup cancelled.'),{name:'AbortError'});};
async function download(artifact,file,{fetchImpl,signal,progress=()=>{},maxBytes=0}={}){
 const budget=nonnegative(maxBytes,'Download byte budget');cancelled(signal);
 const response=await officialFetch(artifact.url,{fetchImpl,signal});
 const declared=response.headers.get('content-length'),size=declared==null?(artifact.size??null):Number(declared);let bytes=0;
 if(size!==null&&(!Number.isSafeInteger(size)||size<0)){await response.body?.cancel();throw Error('The download has an invalid declared size.');}
 if(budget&&size>budget){await response.body?.cancel();throw Error('The download exceeds the selected byte budget.');}
 const digest=crypto.createHash(artifact.algorithm),meter=new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;if(!Number.isSafeInteger(bytes))return callback(Error('The download exceeds this runtime numeric capacity.'));if(budget&&bytes>budget)return callback(Error('The download exceeds the selected byte budget.'));digest.update(chunk);progress({bytes,totalBytes:size});callback(null,chunk);}});
 await pipeline(Readable.fromWeb(response.body),meter,fs.createWriteStream(file,{flags:'wx'}),{signal});cancelled(signal);
 if(size!==null&&bytes!==size)throw Error('The download was incomplete. Please retry.');if(digest.digest('hex')!==artifact.digest)throw Error('The download checksum does not match its publisher. Nothing was installed.');return bytes;
}
async function extract(archive,destination,{signal,maxEntries=0,maxBytes=0}={}){
 const entryBudget=nonnegative(maxEntries,'Archive entry budget'),byteBudget=nonnegative(maxBytes,'Extracted byte budget');cancelled(signal);
 const {yauzl}=require(path.join(path.dirname(require.resolve('playwright-core/package.json')),'lib/zipBundle.js'));let count=0,total=0;
 const zip=await new Promise((resolve,reject)=>yauzl.open(archive,{lazyEntries:true},(e,z)=>e?reject(e):resolve(z)));
 try{await new Promise((resolve,reject)=>{let ended=false;const fail=error=>{if(ended)return;ended=true;signal?.removeEventListener('abort',abort);zip.close();reject(error);},abort=()=>fail(Object.assign(Error('Setup cancelled.'),{name:'AbortError'}));signal?.addEventListener('abort',abort,{once:true});zip.on('error',fail);zip.on('end',()=>{signal?.removeEventListener('abort',abort);if(!ended){ended=true;resolve();}});zip.on('entry',entry=>{void(async()=>{cancelled(signal);count++;total+=entry.uncompressedSize;if(!Number.isSafeInteger(count)||!Number.isSafeInteger(total))throw Error('Archive exceeds this runtime numeric capacity.');if(entryBudget&&count>entryBudget||byteBudget&&total>byteBudget)throw Error('Archive exceeds the selected extraction budget.');const name=entry.fileName.replaceAll('\\','/');if(name.includes('\0')||name.includes(':')||name.split('/').includes('..')||name.startsWith('/')||((entry.externalFileAttributes>>>16)&0xf000)===0xa000)throw Error('Archive contains an unsafe path or symbolic link.');const file=path.resolve(destination,name);if(!file.startsWith(path.resolve(destination)+path.sep))throw Error('Archive path is outside the install folder.');if(name.endsWith('/'))fs.mkdirSync(file,{recursive:true});else{fs.mkdirSync(path.dirname(file),{recursive:true});const stream=await new Promise((r,j)=>zip.openReadStream(entry,(e,s)=>e?j(e):r(s)));await pipeline(stream,fs.createWriteStream(file,{flags:'wx'}),{signal});}zip.readEntry();})().catch(fail);});zip.readEntry();});}finally{zip.close();}
}
function command(executable,args,{cwd,env={},signal,log=()=>{},timeout=0}={}){
 const timeoutMs=nonnegative(timeout,'Setup command timeout');cancelled(signal);
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{cwd,env:{...process.env,...env},windowsHide:true,shell:false,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});let output='',timedOut=false,stopError;
  const kill=()=>{void stopProcessTree(child).catch(error=>{stopError=error;child.kill();});};
  const clear=timeoutMs?longTimeout(()=>{timedOut=true;kill();},timeoutMs):()=>{};signal?.addEventListener('abort',kill,{once:true});if(signal?.aborted)kill();
  const finish=()=>{clear();signal?.removeEventListener('abort',kill);};
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{const text=chunk.toString('utf8');output+=text;log(text);});
  child.once('error',error=>{finish();reject(error);});
  child.once('close',code=>{finish();if(signal?.aborted)reject(Object.assign(Error('Setup cancelled.'),{name:'AbortError'}));else if(timedOut)reject(Error('Setup command reached its selected deadline. Review the log and try again.'));else if(stopError)reject(stopError);else if(code!==0)reject(Error('Setup command failed (exit '+code+'). '+output));else resolve(output);});
 });
}
module.exports={download,extract,command,cancelled};
