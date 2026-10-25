'use strict';
const cp=require('node:child_process'),path=require('node:path');
function githubRepository(remote){
 const value=String(remote).trim();let match=/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(value);
 if(!match){let url;try{url=new URL(value);}catch{throw Error('Configure a GitHub origin remote before running remote verification.');}if(url.hostname!=='github.com'||!['https:','ssh:'].includes(url.protocol)||url.password||url.search||url.hash||(url.username&&url.username!=='git'))throw Error('Remote verification requires a GitHub origin without embedded credentials.');match=/^\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.pathname);}
 if(!match)throw Error('Configure an owner/repository GitHub origin.');return match[1]+'/'+match[2];
}
function currentRepository(root=path.resolve(__dirname,'..')){return githubRepository(cp.execFileSync('git',['remote','get-url','origin'],{cwd:root,encoding:'utf8',windowsHide:true}));}
module.exports={githubRepository,currentRepository};
