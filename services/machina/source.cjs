'use strict';
const fs=require('node:fs'),path=require('node:path');
const {scoped,abort}=require('./util.cjs'),{nonnegative}=require('../capacity.cjs');
async function sourceFiles(root,config={},signal){
 const base=scoped(root,config.path||config.cwd||config.projectPath||'.');if(!fs.statSync(base).isDirectory())throw Error('Choose a source directory.');
 const maxFiles=nonnegative(config.maxFiles??config.maxSourceFiles??0,'Source file budget'),maxChars=nonnegative(config.maxSourceChars??0,'Source character budget');
 let extensions=config.extensions||config.sourceExtensions||['js','cjs','mjs','ts','tsx','jsx','py','robot','java','cs','html','css','json'];if(typeof extensions==='string')extensions=extensions.split(/[,\s]+/);
 const exts=new Set(extensions.map(x=>'.'+String(x).replace(/^\./,'').toLowerCase())),found=[],pending=[base];let chars=0,omitted=0,visited=0;
 while(pending.length){abort(signal);const directory=pending.pop(),entries=(await fs.promises.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name)),subdirectories=[];
  for(const entry of entries){abort(signal);if(entry.isSymbolicLink()||['node_modules','.git','.lvx','release','dist','coverage','.venv','venv','__pycache__'].includes(entry.name))continue;
   if(++visited%256===0)await new Promise(resolve=>setImmediate(resolve));
   const filename=scoped(root,path.join(directory,entry.name));if(entry.isDirectory()){subdirectories.push(filename);continue;}if(!entry.isFile()||!exts.has(path.extname(entry.name).toLowerCase()))continue;
   if(maxFiles&&found.length>=maxFiles){omitted++;continue;}const content=await fs.promises.readFile(filename,{encoding:'utf8',signal});abort(signal);if(maxChars&&chars+content.length>maxChars){omitted++;continue;}chars+=content.length;found.push({path:filename,relativePath:path.relative(base,filename).replace(/\\/g,'/'),content});
  }for(let i=subdirectories.length-1;i>=0;i--)pending.push(subdirectories[i]);
 }
 Object.defineProperty(found,'coverage',{value:{complete:!omitted,omitted,limitReached:!!omitted,characters:chars},enumerable:false});return found;
}
async function resolveSource(root,config,inputs={},signal){
 const base=scoped(root,inputs.repoPath||config.cwd||config.projectPath||'.'),strategy=(config.sourceStrategy==='saved-selection'&&!(config.sourceFiles||config.selectedSourceFiles)?.length&&(config.prompt||config.instructions)?'inline':null)||({'repo-auto':'auto','auto-scan':'auto','saved-selection':'files','prompt-only':'inline'})[config.sourceStrategy]||config.sourceStrategy||((config.sourceFiles||config.selectedSourceFiles)?.length?'files':config.sourceCode?'inline':'auto');if(!['auto','files','inline'].includes(strategy))throw Error('Choose auto, files or inline source strategy.');
 let files;if(strategy==='inline'){const content=config.sourceCode||inputs.sourceCode||inputs.finalCode||'';if(!content.trim()&&!(config.prompt||config.instructions))throw Error('Inline source and instructions are empty.');files=[{path:'inline',relativePath:'inline',content}];}
 else if(strategy==='files'){const selected=config.sourceFiles||config.selectedSourceFiles;if(!Array.isArray(selected)||!selected.length)throw Error('Select source files.');files=[];for(const value of selected){abort(signal);const name=typeof value==='string'?value:value.path||value.relativePath,filename=scoped(root,path.resolve(base,name));if(!fs.statSync(filename).isFile())throw Error('Source file is unavailable.');files.push({path:filename,relativePath:path.relative(base,filename).replace(/\\/g,'/'),content:await fs.promises.readFile(filename,{encoding:'utf8',signal})});}}
 else files=await sourceFiles(root,{...config,path:base},signal);
 if(!files.length)throw Error('No usable source files were found.');const limit=nonnegative(config.maxSourceChars??0,'Source character budget');if(limit&&files.reduce((n,f)=>n+f.content.length,0)>limit)throw Error('Selected source exceeds the user-configured character budget.');
 return {source:files.map(f=>'--- '+f.relativePath+' ---\n'+f.content).join('\n\n'),sourceFiles:files.map(f=>f.relativePath),sourceStrategy:strategy};
}
module.exports={sourceFiles,resolveSource};
