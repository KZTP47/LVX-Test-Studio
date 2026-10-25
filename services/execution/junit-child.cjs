'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
function sources(root){const out=[];for(const entry of fs.readdirSync(root,{withFileTypes:true})){if(entry.isSymbolicLink()||['.git','node_modules','target','build','.state'].includes(entry.name))continue;const file=path.join(root,entry.name);if(entry.isDirectory())out.push(...sources(file));else if(entry.isFile()&&entry.name.endsWith('.java'))out.push(file);}return out;}
function command(binary,args){return new Promise((resolve,reject)=>{const child=spawn(binary,args,{cwd:config.project,windowsHide:true,stdio:['ignore','inherit','inherit']});child.once('error',reject);child.once('close',code=>resolve(code));});}
(async()=>{const files=sources(config.project),classes=path.join(config.temp,'classes');fs.mkdirSync(classes,{recursive:true});let classPath=config.classPath;
    if(files.length&&config.compile!==false){const argsFile=path.join(config.temp,'javac.args');const args=['-cp',`${config.jar}${path.delimiter}${classPath}`,'-d',classes,...files].map(s=>'"'+s.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"');fs.writeFileSync(argsFile,args.join('\n'));const code=await command(config.javac,['@'+argsFile]);if(code!==0){process.exitCode=code||1;return;}classPath=classes+path.delimiter+classPath;}
    process.exitCode=await command(config.java,['-jar',config.jar,'execute','--class-path',classPath,'--scan-class-path',`--reports-dir=${config.report}`,'--disable-banner']);
})().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
