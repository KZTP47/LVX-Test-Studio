'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function ensurePinned(file,entry,fetcher=fetch){
 if(!/^https:\/\//.test(entry.url)||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('Invalid pinned vendor descriptor');
 if(fs.existsSync(file)){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Vendor cache must be a regular file');if(stat.size<=5*1024*1024&&digest(fs.readFileSync(file))===entry.sha256)return {cached:true,sha256:entry.sha256};}
 const response=await fetcher(entry.url,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Vendor download failed: '+response.status);
 const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>5*1024*1024)throw Error('Vendor download exceeds 5 MiB');chunks.push(chunk);}const bytes=Buffer.concat(chunks);
 if(digest(bytes)!==entry.sha256)throw Error('Vendor integrity mismatch; existing cache retained');
 fs.mkdirSync(path.dirname(file),{recursive:true});const staged=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(staged,bytes);fs.renameSync(staged,file);}finally{if(fs.existsSync(staged))fs.unlinkSync(staged);}return {cached:false,sha256:entry.sha256};
}
module.exports={ensurePinned,digest};
