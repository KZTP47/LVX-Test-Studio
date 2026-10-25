'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');

// Machine-local choices, deliberately outside workspace archives. A saved path
// is not permission to give an imported board access to a different directory.
function createProjectFolders(dataDir){
 const file=dataDir?path.join(dataDir,'approved-project-folders.json'):null;
 let memory={};
 function read(){if(!file||!fs.existsSync(file))return memory;try{const value=JSON.parse(fs.readFileSync(file,'utf8'));return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}}
 function write(value){memory=value;if(file){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600});fs.renameSync(temp,file);}}
 function canonical(candidate){if(typeof candidate!=='string'||!path.isAbsolute(candidate))throw Error('Choose a project folder using Add project folder.');const resolved=fs.realpathSync(candidate),stat=fs.statSync(resolved);if(!stat.isDirectory())throw Error('Choose a folder, not a file.');return {path:resolved,dev:stat.dev,ino:stat.ino};}
 function approve(workspaceRoot,candidate){const folder=canonical(candidate),workspace=fs.realpathSync(workspaceRoot),all=read();all[workspace]||={};all[workspace][folder.path]={dev:folder.dev,ino:folder.ino};write(all);return {path:folder.path,allowed:true,exists:true,summary:'Agents can work in this folder with their selected native permissions.'};}
 function status(workspaceRoot,candidate){
  if(typeof candidate!=='string'||!path.isAbsolute(candidate))return {allowed:false,exists:false,summary:'Choose a project folder using Add project folder.'};
  const grant=read()[workspaceRoot]?.[candidate];
  if(candidate!==workspaceRoot&&!grant)return {allowed:false,exists:null,summary:'Choose this folder again to allow agents to work there.'};
  try{const actual=canonical(candidate);if(actual.path!==candidate||(grant&&(actual.dev!==grant.dev||actual.ino!==grant.ino)))return {allowed:false,exists:true,summary:'This folder has changed. Choose it again before starting agent work.'};return {allowed:true,exists:true,summary:'Folder ready.'};}
  catch{return {allowed:false,exists:false,summary:'This folder could not be found. Choose its current location.'};}
 }
 function assertAllowed(workspaceRoot,candidate){const result=status(workspaceRoot,candidate);if(!result.allowed)throw Object.assign(Error(result.summary),{code:'PROJECT_FOLDER_REQUIRED'});return candidate;}
 return {approve,status,assertAllowed};
}
module.exports={createProjectFolders};
