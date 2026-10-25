'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
function validateRuntimeDirectory(ownerRoot,target){
 const owner=fs.realpathSync(ownerRoot),directory=fs.realpathSync(target),relative=path.relative(owner,directory);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||fs.lstatSync(target).isSymbolicLink())throw Error('Runtime ACL target must be a real directory inside its owner');
 const development=relative.split(path.sep).join('/')==='node_modules/electron/dist',fixture=/^lvx-installer-[a-zA-Z0-9]+$/.test(path.basename(owner))&&relative==='application';
 if(!development&&!fixture)throw Error('Runtime ACL changes are limited to public Electron binaries or an owned installer fixture');
 const inspect=folder=>{for(const item of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,item.name),stat=fs.lstatSync(file);if(stat.isSymbolicLink()||stat.isFile()&&stat.nlink>1)throw Error('Runtime ACL target contains linked files');if(item.isDirectory())inspect(file);}};inspect(directory);return directory;
}
function prepareRuntimeAccess(ownerRoot,target){
 if(process.platform!=='win32')return {required:false};const directory=validateRuntimeDirectory(ownerRoot,target);
 // Read/execute only, on downloaded public binaries. Profiles, credentials,
 // selected workspaces and existing user applications are never ACL targets.
 cp.execFileSync(path.join(process.env.SystemRoot||'C:\\Windows','System32','icacls.exe'),[directory,'/grant','*S-1-15-2-1:(OI)(CI)(RX)','/T','/Q','/L'],{windowsHide:true,encoding:'utf8',timeout:60000});return {required:true,sid:'S-1-15-2-1',rights:'RX'};
}
module.exports={prepareRuntimeAccess,validateRuntimeDirectory};
