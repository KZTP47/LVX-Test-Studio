'use strict';
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const net=require('node:net');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {stopProcessTree}=require('../process-control.cjs');
const MAX_BYTES=12*1024*1024,MAX_FILES=5000;
const EXT=new Set('html htm css js mjs cjs json svg png jpg jpeg gif webp avif ico bmp woff woff2 ttf otf eot mp3 mp4 webm ogg wav txt xml wasm map webmanifest pdf csv'.split(' '));
const BINARY=new Set('png jpg jpeg gif webp avif ico bmp woff woff2 ttf otf eot mp3 mp4 webm ogg wav wasm pdf'.split(' '));
const EXCLUDED=new Set(['node_modules','.git','.svn','.hg','.next','.nuxt','.cache','coverage','test-results','playwright-report','.venv','venv','__pycache__']);
const MIME={html:'text/html',htm:'text/html',css:'text/css',js:'text/javascript',mjs:'text/javascript',json:'application/json',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',ico:'image/x-icon',woff:'font/woff',woff2:'font/woff2',wasm:'application/wasm',webmanifest:'application/manifest+json',txt:'text/plain',xml:'application/xml',mp4:'video/mp4',webm:'video/webm',pdf:'application/pdf'};
function ext(name){return path.posix.extname(name).slice(1).toLowerCase();}
function inside(root,file){const relative=path.relative(root,file);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));}
function safePath(value){
 if(typeof value!=='string'||!value||value.length>2048||value.includes('\\')||value.includes('\0')||value.startsWith('/')||/^[A-Za-z]:/.test(value)||value.split('/').some(x=>!x||x==='.'||x==='..'||x.includes(':')))throw Error('Website file paths must be relative and cannot contain traversal.');
 return value;
}
function secret(name){return name.startsWith('.')||/^(?:id_rsa|id_ed25519|credentials|secrets?)(?:[._-]|$)/i.test(name)||/\.(?:pem|key|pfx|p12|sqlite|db)$/i.test(name);}
function webUrl(value){let url;try{url=new URL(value);}catch{throw Error('Enter a complete http:// or https:// website URL.');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Only HTTP(S) website URLs without embedded passwords are supported.');return url.href;}
function validateFiles(target){
 if(!target||target.version!==1||!Array.isArray(target.files)||!target.files.length)throw Error('Choose website files or reload the project folder first.');
 if(target.files.length>MAX_FILES||Buffer.byteLength(JSON.stringify(target))>MAX_BYTES)throw Error('Website bundle is too large (maximum 12 MiB and 5,000 files). Choose its folder or use a running website URL.');
 const files=new Map();
 for(const item of target.files){const name=safePath(item.path);if(files.has(name))throw Error('Duplicate website file path: '+name);if(typeof item.content!=='string'||!['utf8','base64'].includes(item.encoding))throw Error('Invalid website file encoding: '+name);if(item.encoding==='base64'&&(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.content)))throw Error('Invalid base64 website file: '+name);files.set(name,Buffer.from(item.content,item.encoding));}
 const entry=safePath(target.entry||'index.html');if(!files.has(entry)||!['html','htm'].includes(ext(entry)))throw Error('Choose an HTML entry file that is included in this website.');return {files,entry};
}
function readPackage(root){try{const file=path.join(root,'package.json'),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('package.json must be a regular file, not a folder or symbolic link.');if(stat.size>1024*1024)throw Error('package.json is too large (maximum 1 MiB).');const raw=fs.readFileSync(file,'utf8');if(Buffer.byteLength(raw)>1024*1024)throw Error('package.json is too large (maximum 1 MiB).');const value=JSON.parse(raw),hash=crypto.createHash('sha256').update(raw),packageHash=crypto.createHash('sha256').update(raw).digest('hex');for(const name of ['package-lock.json','npm-shrinkwrap.json']){const lock=path.join(root,name);try{const stat=fs.lstatSync(lock);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES)throw Error(name+' is not a regular supported lock file.');hash.update('\0'+name+'\0').update(fs.readFileSync(lock));}catch(error){if(error.code!=='ENOENT')throw error;}}return {scripts:Object.fromEntries(Object.entries(value.scripts||{}).filter(([name,command])=>/^[\w:.-]{1,80}$/.test(name)&&typeof command==='string')),packageManager:typeof value.packageManager==='string'?value.packageManager.split('@')[0]:'npm',packageHash,fingerprint:hash.digest('hex')};}catch(error){if(error.code==='ENOENT')return null;throw Error('Cannot read project package.json: '+error.message);}}
function entryNeedsCompilation(files,entry){
 const assets=new Map(files.filter(file=>file.encoding==='utf8').map(file=>[file.path,file.content])),seen=new Set();
 function scriptReference(reference,from){let url;try{url=new URL(reference,'https://lvx.invalid/'+from);}catch{return false;}if(url.origin!=='https://lvx.invalid')return false;let name;try{name=decodeURIComponent(url.pathname.slice(1));}catch{return false;}if(/\.(?:ts|mts|tsx|jsx|vue|svelte)$/.test(name)&&!name.endsWith('.d.ts'))return true;if(!['js','mjs'].includes(ext(name))||seen.has(name)||!assets.has(name))return false;seen.add(name);return importsNeedCompilation(assets.get(name),name);}
 function importsNeedCompilation(text,from){for(const match of text.matchAll(/(?:\b(?:import|export)\s+(?:[^;"'\n]*?\s+from\s*)?|\bimport\s*\()\s*(['"])([^'"]+)\1/g))if(scriptReference(match[2],from))return true;return false;}
 const html=assets.get(entry);if(!html)return false;
 for(const match of html.replace(/<!--[\s\S]*?-->/g,'').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){const src=match[1].match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/i);if(src&&scriptReference(src[1]??src[2]??src[3],entry))return true;if(importsNeedCompilation(match[2],entry))return true;}
 return false;
}
function scan(root,source,label){
 const pkg=readPackage(root),warnings=['Hidden files, credentials, dependency folders, caches and test reports are excluded. Only website assets are included.'];
 let siteRoot=root,entry=null,compiled=false;
 for(const folder of ['dist','build','out','www']){const file=path.join(root,folder,'index.html');try{if(fs.lstatSync(path.join(root,folder)).isSymbolicLink()||!fs.lstatSync(file).isFile())continue;siteRoot=path.join(root,folder);entry='index.html';compiled=true;break;}catch{}}
 if(!entry&&fs.existsSync(path.join(root,'index.html')))entry='index.html';
 if(!entry&&fs.existsSync(path.join(root,'public','index.html'))&&!pkg){const publicRoot=path.join(root,'public');if(fs.lstatSync(publicRoot).isSymbolicLink()||!inside(root,fs.realpathSync(publicRoot)))throw Error('The public website folder is a symbolic link. Choose its real folder directly.');siteRoot=publicRoot;entry='index.html';}
 const files=[],entries=[],ignored=[];let large=false,framework=false,visited=0,serializedBytes=2;
 function walk(dir,prefix=''){
  if(fs.lstatSync(dir).isSymbolicLink()||!inside(siteRoot,fs.realpathSync(dir)))throw Error('A website folder changed or became a symbolic link. Choose its real folder again.');
  for(const item of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
   const name=prefix+item.name,absolute=path.join(dir,item.name);if(++visited>100000)throw Error('Project discovery exceeded 100,000 entries. Choose a built website folder or use its running URL.');
   if(item.isSymbolicLink()){ignored.push(name);continue;}
   if(item.isDirectory()){if(!EXCLUDED.has(item.name)&&!secret(item.name))walk(absolute,name+'/');continue;}
   if(!item.isFile()||secret(item.name))continue;
   if(!prefix&&/^(?:vite|next|nuxt|astro|svelte|webpack)\.config\.(?:js|ts|mjs|mts|cjs|cts)$/.test(item.name))framework=true;
   if(!EXT.has(ext(name))||item.name==='package-lock.json'||item.name==='yarn.lock'||item.name==='pnpm-lock.yaml'||item.name==='package.json')continue;
   if(['html','htm'].includes(ext(name))&&entries.length<MAX_FILES)entries.push(name);
   const stat=fs.lstatSync(absolute);if(!stat.isFile()||stat.isSymbolicLink()||!inside(siteRoot,fs.realpathSync(absolute)))continue;
   if(stat.size>MAX_BYTES){large=true;continue;}
   if(large)continue;
   const content=fs.readFileSync(absolute),asset={path:name,content:content.toString(BINARY.has(ext(name))?'base64':'utf8'),encoding:BINARY.has(ext(name))?'base64':'utf8'};files.push(asset);serializedBytes+=Buffer.byteLength(JSON.stringify(asset))+1;
   if(files.length>MAX_FILES||serializedBytes>MAX_BYTES-8192){large=true;files.length=0;}
  }
 }
 walk(siteRoot);if(ignored.length)warnings.push(ignored.length+' symbolic links were excluded. Select the real website folder when those assets are needed.');
 if(!entry)entry=entries.sort((a,b)=>a.split('/').length-b.split('/').length||a.localeCompare(b))[0];
 const frameworkCommand=Object.values(pkg?.scripts||{}).some(command=>/\b(?:vite|next|react-scripts|astro|nuxt|svelte-kit|parcel)\b|\bng\s+serve\b|\bwebpack\s+serve\b/.test(command));
 const requiresServer=!compiled&&!!pkg&&(!entry||framework||frameworkCommand||entryNeedsCompilation(files,entry)||fs.existsSync(path.join(root,'angular.json')));
 const project={scripts:pkg?.scripts||{},packageManager:pkg?.packageManager||'npm',...(pkg?{packageFingerprint:pkg.fingerprint}:{}),requiresServer,entryChoices:entries,compiled,nativeFiles:large&&!requiresServer};
 if(requiresServer){warnings.push('This is a source application. Choose a package script and explicitly start its development server; source JSX, TypeScript and templates cannot run as static HTML.');return {target:{version:1,kind:'url',label,source,project,warnings},siteRoot};}
 if(!entry)throw Error('No HTML website or supported package.json application was found. Choose the website output folder or enter its running URL.');
 if(large){warnings.push('The website exceeds the portable 12 MiB / 5,000-file limit. It will be served from this approved folder on this computer. Files are not silently truncated or embedded in exports.');return {target:{version:1,kind:'url',label,source,entry,project,warnings},siteRoot};}
 const target={version:1,kind:'files',label,entry,files,source,project,warnings};validateFiles(target);return {target,siteRoot};
}
function run(file,args,{cwd,onOutput,onChild,timeout=120000,env}={}){return new Promise((resolve,reject)=>{const child=spawn(file,args,{cwd,env:env||process.env,windowsHide:true,detached:process.platform!=='win32',shell:false,stdio:['ignore','pipe','pipe']});onChild?.(child);let output='',settled=false;const timer=setTimeout(()=>{stopProcessTree(child).catch(()=>{});finish(Error('Command timed out. '+output.slice(-3000)));},timeout);function finish(error){if(settled)return;settled=true;clearTimeout(timer);onChild?.(null);error?reject(error):resolve(output);}for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{const text=chunk.toString();output=(output+text).slice(-65536);onOutput?.(text);});child.once('error',error=>finish(Error('Could not start '+file+': '+error.message)));child.once('exit',code=>finish(code===0?null:Error(file+' exited with code '+code+'. '+output.slice(-3000))));});}
function npmInvocation(){
 if(process.platform!=='win32')return {file:'npm',prefix:[]};
 const candidates=[];for(const dir of (process.env.PATH||'').split(path.delimiter)){if(dir)candidates.push(path.join(dir,'node_modules','npm','bin','npm-cli.js'));}candidates.push(path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js'));
 const cli=candidates.find(file=>fs.existsSync(file));if(!cli)throw Error('Node.js with npm is required to start this project. Install Node.js, restart LVX, then try again.');const node=path.resolve(path.dirname(cli),'../../..','node.exe');if(!fs.existsSync(node))throw Error('Node.js could not be found beside npm. Install Node.js, restart LVX, then try again.');return {file:node,prefix:[cli]};
}
async function availablePort(){const server=net.createServer();await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function responds(url){try{const response=await fetch(url,{signal:AbortSignal.timeout(500),redirect:'manual'});await response.body?.cancel();return response.status<500;}catch{return false;}}
function createTargets({dataDir,getWorkspaceRoot,assertTrusted=()=>{}}){
 const sources=new Map(),servers=new Set(),operations=new Set();let closed=false;
 function workspace(){if(closed)throw Error('Website project service is closed.');const root=fs.realpathSync(getWorkspaceRoot());assertTrusted(root);return root;}
 async function current(){const root=workspace();for(const source of sources.values())if(source.workspace!==root){await stop(source);sources.delete(source.id);}return root;}
 function assertCurrent(root){if(workspace()!==root)throw Error('The workspace changed. Load the project again in the selected workspace.');}
 function command(file,args,options={},source){let previous;return run(file,args,{...options,onChild:child=>{if(previous)operations.delete(previous);previous=child;if(child)operations.add(child);if(source)source.operation=child;}});}
 function assertProjectRoot(source){const real=fs.realpathSync(source.path),stat=fs.statSync(real);if(real!==source.path||stat.dev!==source.dev||stat.ino!==source.ino)throw Error('The project folder changed. Choose it again before using it.');}
 function grant(id,root){const source=sources.get(id);if(!source||source.workspace!==root)throw Error('This saved project needs permission again. Choose its folder or load its repository on this computer.');assertProjectRoot(source);return source;}
 function descriptor(source){return {type:source.type,id:source.id,...(source.repository?{repository:source.repository,ref:source.ref}:{} )};}
 function status(source){return {sourceId:source.id,running:!!source.child&&source.child.exitCode===null&&!source.child.signalCode,runningUrl:source.runningUrl||null,logs:source.logs||'',error:source.error||null};}
 function discover(source){const scanned=scan(source.path,descriptor(source),path.basename(source.path));source.target=scanned.target;source.siteRoot=scanned.siteRoot;const stat=fs.statSync(source.siteRoot);source.siteDev=stat.dev;source.siteIno=stat.ino;assertSiteRoot(source);return {target:source.target,...status(source)};}
 function assertSiteRoot(source){
  assertProjectRoot(source);
  if(!inside(source.path,source.siteRoot))throw Error('The website output folder is outside the approved project. Choose its real folder again.');
  let cursor=source.path;for(const part of path.relative(source.path,source.siteRoot).split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);if(fs.lstatSync(cursor).isSymbolicLink())throw Error('The website output folder changed. Choose its real folder again.');}
  const real=fs.realpathSync(source.siteRoot),stat=fs.statSync(real);if(real!==source.siteRoot||!stat.isDirectory()||stat.dev!==source.siteDev||stat.ino!==source.siteIno)throw Error('The website output folder changed. Choose it again.');
 }
 async function selectFolder({path:folder}){const root=await current();if(typeof folder!=='string'||!path.isAbsolute(folder))throw Error('Choose an existing project folder.');const absolute=fs.realpathSync(folder),stat=fs.statSync(absolute);if(!stat.isDirectory())throw Error('Choose a folder, not a file.');const source={id:crypto.randomUUID(),workspace:root,path:absolute,dev:stat.dev,ino:stat.ino,type:'folder',logs:''};const result=discover(source);sources.set(source.id,source);return result;}
 async function stop(source){source.generation=(source.generation||0)+1;const children=[source.child,source.operation].filter(Boolean);source.child=null;source.runningUrl=null;await Promise.all(children.map(stopProcessTree));return status(source);}
 async function repository(payload,root){
  const url=String(payload.url||'').trim(),ref=String(payload.ref||'').trim();if(!/^(?:https?:\/\/[^\s]+|ssh:\/\/[^\s]+|git@[\w.-]+:[^\s]+)$/.test(url)||/[\0\r\n]/.test(url))throw Error('Enter an HTTP(S) or SSH Git repository URL. Native Git manages private repository sign-in.');if(/^(?:https?|ssh):/.test(url)){const parsed=new URL(url);if(parsed.password||(/^https?:/.test(url)&&parsed.username))throw Error('Use native Git sign-in instead of credentials in repository URLs.');}
  if(ref&&(!/^[A-Za-z0-9][A-Za-z0-9._/\-]{0,199}$/.test(ref)||ref.includes('..')||ref.endsWith('/')))throw Error('Enter a valid branch or tag name.');
  const id=crypto.randomUUID(),directory=path.join(path.resolve(dataDir),'web-projects',id);fs.mkdirSync(path.dirname(directory),{recursive:true});
  const clone=shallow=>command('git',['-c','core.hooksPath='+path.join(path.resolve(dataDir),'disabled-git-hooks'),'clone',...(shallow?['--depth','1']:[]),...(ref?['--branch',ref]:[]),'--',url,directory],{cwd:root,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
  try{try{await clone(true);}catch(error){if(!/dumb http transport does not support shallow/i.test(error.message))throw error;assertCurrent(root);if(inside(path.join(path.resolve(dataDir),'web-projects'),directory)&&fs.existsSync(directory))fs.rmSync(directory,{recursive:true,force:true});await clone(false);}assertCurrent(root);const stat=fs.statSync(directory);const source={id,workspace:root,path:fs.realpathSync(directory),dev:stat.dev,ino:stat.ino,type:'repository',repository:url,ref,logs:''};const result=discover(source);sources.set(id,source);return result;}catch(error){if(inside(path.join(path.resolve(dataDir),'web-projects'),directory)&&fs.existsSync(directory))fs.rmSync(directory,{recursive:true,force:true});throw Error('Repository could not be loaded: '+error.message);}
 }
 async function start(source,payload){
  if(source.child&&source.child.exitCode===null&&!source.child.signalCode)return {target:source.target,...status(source)};
  let pkg=readPackage(source.path);const script=String(payload.script||'');if(!pkg||!Object.hasOwn(pkg.scripts,script))throw Error('Choose an existing package.json script, such as dev or start.');if(payload.expectedCommand!==pkg.scripts[script]||payload.expectedFingerprint!==pkg.fingerprint)throw Error('The project commands or dependency lock changed. Refresh the project, review its command, then press Start again.');if(pkg.packageManager!=='npm')throw Error('This project requests '+pkg.packageManager+'. Start it with that tool outside LVX, then enter its website URL.');
  const npm=npmInvocation();source.logs='';source.error=null;const log=value=>{source.logs=(source.logs+value).slice(-65536);};
  const generation=source.generation||0;
  if(payload.install===true){const packageHash=pkg.packageHash;await command(npm.file,[...npm.prefix,'install','--no-audit','--no-fund'],{cwd:source.path,timeout:180000,onOutput:log},source);pkg=readPackage(source.path);if(!pkg||pkg.packageHash!==packageHash)throw Error('Installation changed package.json. Refresh the project and review its commands before starting.');source.target.project.packageFingerprint=pkg.fingerprint;}
  assertCurrent(source.workspace);if(generation!==(source.generation||0))throw Error('Project startup was stopped.');
  const port=await availablePort(),defaultUrl='http://127.0.0.1:'+port+'/';
  assertCurrent(source.workspace);if(generation!==(source.generation||0))throw Error('Project startup was stopped.');
  const commandText=pkg.scripts[script],args=/\bnext\b/.test(commandText)?['--port',String(port),'--hostname','127.0.0.1']:/\b(?:vite|astro|webpack|nuxt|ng\s+serve)\b/.test(commandText)?['--port',String(port),'--host','127.0.0.1']:[];
  const child=spawn(npm.file,[...npm.prefix,'run',script,...(args.length?['--',...args]:[])],{cwd:source.path,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',BROWSER:'none',CI:'1'},windowsHide:true,detached:process.platform!=='win32',shell:false,stdio:['ignore','pipe','pipe']});source.child=child;
  child.once('error',error=>{source.error='Project server could not start: '+error.message;log('\n'+source.error);});child.once('exit',code=>{if(source.child===child){source.child=null;source.runningUrl=null;if(code!==0)source.error='Project server exited with code '+code+'.';}});
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>log(chunk.toString()));
  const deadline=Date.now()+25000;
  while(Date.now()<deadline){if(closed||getWorkspaceRoot()!==source.workspace||generation!==(source.generation||0)||source.error||child.exitCode!==null||child.signalCode)break;const matches=[...source.logs.replace(/\x1b\[[0-9;]*m/g,'').matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+(?:\/[^\s]*)?/g)].map(x=>x[0]);for(const url of [defaultUrl,...matches])if(await responds(url)){assertCurrent(source.workspace);if(generation!==(source.generation||0))throw Error('Project startup was stopped.');source.runningUrl=url;return {target:source.target,...status(source)};}await new Promise(resolve=>setTimeout(resolve,150));}
  await stop(source);source.error=source.error||'The server did not become ready within 25 seconds. Check its logs. Some frameworks need another command; start them externally and enter their URL.';throw Error(source.error+'\n'+source.logs.slice(-4000));
 }
 async function handle(action,payload={}){
  const root=await current();if(action==='repository')return repository(payload,root);
  if(action==='stopAll'){const active=[...sources.values()].filter(source=>source.workspace===root&&(source.child||source.operation||source.busy));await Promise.all(active.map(stop));return {stopped:active.length};}
  if(!['refresh','start','stop','status'].includes(action))throw Error('Unknown website project action.');const source=grant(payload.sourceId,root);
  if(action==='status')return {target:source.target,...status(source)};if(action==='stop')return {target:source.target,...await stop(source)};
  if(source.busy)throw Error('This project is already starting or refreshing. Wait for it to finish or press Stop.');source.busy=true;
  try{if(action==='start')return await start(source,payload);if(source.child)await stop(source);
   if(source.type==='repository'){const fetchGit=shallow=>command('git',['-c','core.hooksPath='+path.join(path.resolve(dataDir),'disabled-git-hooks'),'fetch',...(shallow?['--depth','1']:[]),'origin',source.ref||'HEAD'],{cwd:source.path,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}},source);try{await fetchGit(true);}catch(error){if(!/dumb http transport does not support shallow/i.test(error.message))throw error;assertCurrent(root);await fetchGit(false);}assertCurrent(root);await command('git',['-c','core.hooksPath='+path.join(path.resolve(dataDir),'disabled-git-hooks'),'reset','--hard','FETCH_HEAD'],{cwd:source.path},source);}
   assertCurrent(root);return discover(source);
  }finally{source.busy=false;}
 }
 async function serve({files,entry,diskRoot,authorize}){
  // Each preview receives a separate ephemeral loopback origin. Serving at its
  // root preserves /assets URLs as well as relative imports and second pages.
  const prefix='/';
  const server=http.createServer((request,response)=>{try{
   if(request.headers.host!=='127.0.0.1:'+server.address().port){response.writeHead(403).end();return;}
   authorize?.();
   if(!['GET','HEAD'].includes(request.method)){response.writeHead(405).end();return;}
   const raw=request.url.split('?')[0];if(!raw.startsWith(prefix)){response.writeHead(404).end();return;}
   let name=decodeURIComponent(raw.slice(prefix.length));if(!name)name=entry;else if(name.endsWith('/'))name+='index.html';safePath(name);
   let content,diskFile;if(files)content=files.get(name);else {let cursor=diskRoot;for(const part of name.split('/')){if(secret(part)||EXCLUDED.has(part)||['package.json','package-lock.json'].includes(part))throw Error('Excluded');cursor=path.join(cursor,part);if(fs.lstatSync(cursor).isSymbolicLink())throw Error('Symbolic link');}if(!inside(diskRoot,fs.realpathSync(cursor))||!EXT.has(ext(name))||!fs.statSync(cursor).isFile())throw Error('Unavailable');diskFile=cursor;}
   if(!content&&!diskFile){response.writeHead(404).end('Website asset not found.');return;}
   response.writeHead(200,{'Content-Type':(MIME[ext(name)]||'application/octet-stream')+(BINARY.has(ext(name))?'':'; charset=utf-8'),'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});if(request.method==='HEAD')response.end();else if(diskFile){const stream=fs.createReadStream(diskFile);stream.on('error',()=>response.destroy());response.on('close',()=>stream.destroy());stream.pipe(response);}else response.end(content);
  }catch{response.writeHead(404).end('Website asset not found.');}});
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));if(closed){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));throw Error('Website project service is closed.');}servers.add(server);let disposed=false;return {url:'http://127.0.0.1:'+server.address().port+prefix+entry.split('/').map(encodeURIComponent).join('/'),dispose:async()=>{if(disposed)return;disposed=true;servers.delete(server);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
 }
 async function resolve(target){const root=await current();assertCurrent(root);if(!target||target.version!==1)throw Error('Unsupported website target.');if(target.kind==='files'){const bundle=validateFiles(target);return serve(bundle);}if(target.kind!=='url')throw Error('Choose website files, a project or a website URL.');if(target.source){const source=grant(target.source.id,root);if(source.target.project.nativeFiles){assertSiteRoot(source);return serve({entry:source.target.entry,diskRoot:source.siteRoot,authorize:()=>{assertCurrent(root);assertSiteRoot(source);}});}if(!source.runningUrl)throw Error('This project needs a running server. Choose a script and press Start project first.');return {url:webUrl(source.runningUrl)};}return {url:webUrl(target.url)};}
 async function close(){if(closed)return;closed=true;await Promise.allSettled([...sources.values()].map(stop));await Promise.allSettled([...operations].map(stopProcessTree));sources.clear();await Promise.all([...servers].map(server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})));servers.clear();}
 return {selectFolder,handle,resolve,close};
}
module.exports={createTargets,validateFiles,safePath,MAX_BYTES,MAX_FILES};
