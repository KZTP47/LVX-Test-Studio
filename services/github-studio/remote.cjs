'use strict';
const crypto=require('node:crypto');
const LIMITS=Object.freeze({fileBytes:0,totalBytes:0,pages:0,jobs:0}); // No application capacity ceilings.
const SHA=/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const SECRET=/^secret:[a-f0-9-]{36}$/;
const clone=value=>structuredClone(value);
const hash=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
function* parentPaths(path){for(let at=path.lastIndexOf('/');at>0;at=path.lastIndexOf('/',at-1))yield path.slice(0,at);}
function fail(code,message,extra={}){return Object.assign(new Error(message),{code,...extra});}
function validatePath(value){
 if(typeof value!=='string'||!value||/[\\\x00-\x1f\x7f:"]/.test(value)||value.startsWith('/')||value.split('/').some(p=>!p||p==='.'||p==='..'||p.toLowerCase()==='.git'||/[. ]$/.test(p)))throw fail('INVALID_PATH','Use a relative repository path without traversal or control characters.');
 return value;
}
function validateBranch(value){
 if(typeof value==='string')value=value.replace(/^refs\/heads\//,'');
 if(typeof value!=='string'||!value||value==='@'||value.startsWith('-')||/[\x00-\x20\x7f~^:?*\[\\]/.test(value)||value.includes('..')||value.includes('@{')||value.split('/').some(p=>!p||p.startsWith('.')||p.endsWith('.')||p.endsWith('.lock')))throw fail('INVALID_BRANCH','Choose a valid Git branch name.');
 return value;
}
function repository(value){if(typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(value)||['.','..'].includes(value.split('/')[1]))throw fail('INVALID_REPOSITORY','Choose a GitHub owner/repository.');return value;}
function decode(blob){
 if(blob?.encoding!=='base64'||typeof blob.content!=='string')throw fail('UNSUPPORTED_SOURCE','GitHub returned unsupported or oversized file content.');
 const encoded=blob.content.replace(/\s/g,'');if(encoded.length%4!==0||! /^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw fail('INVALID_RESPONSE','GitHub returned invalid source encoding.');const bytes=Buffer.from(encoded,'base64');if(blob.size!==undefined&&blob.size!==bytes.length)throw fail('SOURCE_MISMATCH','Source byte count does not match its blob.');if(SHA.test(blob.sha||'')){const calculated=crypto.createHash(blob.sha.length===64?'sha256':'sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');if(calculated!==blob.sha)throw fail('SOURCE_MISMATCH','Source bytes do not match the immutable Git blob.');}
 const value=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);if(value.includes('\0'))throw fail('BINARY_SOURCE','Binary files cannot be edited.');return value;
}
function classify(path){if(/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path))return 'workflow';if(/(?:^|\/)(?:tests?|__tests__|specs?|e2e)\/.*\.(?:[cm]?[jt]sx?|py|cs|robot)$/i.test(path)||/(?:\.(?:spec|test)|(?:^|\/)test_[^/]*)\.(?:[cm]?[jt]sx?|py)$/i.test(path)||/Tests?\.cs$|\.robot$/i.test(path))return 'test';if(/(?:^|\/)(?:package\.json|(?:playwright|vitest|jest|cypress)\.config\.[cm]?[jt]s|pytest\.ini|pyproject\.toml|requirements\.txt|tsconfig\.json)$/i.test(path))return 'context';return null;}
function createService(options={}){
 const request=options.request||options.fetch||globalThis.fetch,simulated=options.simulated===true||request?.simulated===true;
 const clock=options.clock||(()=>new Date()),uuid=options.randomUUID||(()=>crypto.randomUUID());
 const getRoot=options.getWorkspaceRoot||(()=>options.workspaceRoot),redact=options.redact||((v)=>v);
 const previews=new Map(),operations=new Map(),locks=new Set(),controllers=new Set(),cache=new Map(),cooldowns=new Map(),sourceCatalogs=new Map(),sourceBlobs=new Map();let epoch=0,closed=false;
 function rateFailure(reference,until,headers={},path=''){
  const authenticated=!!reference,primary=headers['x-ratelimit-remaining']==='0';
  return fail('RATE_LIMIT',`GitHub ${primary?'API quota exhausted':'request throttling'} (${authenticated?'authenticated sign-in':'anonymous requests; no GitHub token supplied'}). Retry after ${new Date(until).toISOString()}. ${authenticated?'Wait for the reset; repeated scans share this sign-in’s quota.':'Add a GitHub token in GitHub Actions to use an authenticated quota, or wait for the reset.'} Imported source and saved tests remain available.`,{retryAt:String(Math.ceil(until/1000)),authenticated,rateLimit:{remaining:headers['x-ratelimit-remaining']??null,limit:headers['x-ratelimit-limit']??null,resource:headers['x-ratelimit-resource']??null,requestId:headers['x-github-request-id']??null,path}});
 }
 function binding(p){const root=getRoot();if(closed||!root||p.workspaceRoot!==root)throw fail('WORKSPACE_CHANGED','Workspace changed. Reopen the repository in its original project.');return {root,epoch};}
 function check(b){if(closed||getRoot()!==b.root||epoch!==b.epoch)throw fail('WORKSPACE_CHANGED','Workspace changed during this operation. Reopen the original project to recover its result.');}
 function credential(reference,write=false){if(simulated){if(reference)throw fail('DEMO_CREDENTIAL','Offline demo does not accept credentials.');return undefined;}if(reference&&!SECRET.test(reference))throw fail('INVALID_CREDENTIAL','Use a protected desktop GitHub sign-in.');if(write&&!reference)throw fail('SIGN_IN_REQUIRED','Sign in with a GitHub token before publishing.');if(!reference)return undefined;if(typeof options.resolveSecret!=='function')throw fail('SIGN_IN_REQUIRED','Protected sign-in is unavailable.');const token=options.resolveSecret(reference);if(typeof token!=='string'||!token)throw fail('SIGN_IN_REQUIRED','Re-enter your GitHub sign-in.');return token;}
 async function api(b,reference,path,{method='GET',body,etag,write=false}={}){
  check(b);const token=credential(reference,write);const rateKey=reference||'public',cooldown=cooldowns.get(rateKey);if(cooldown&&cooldown.until>clock().getTime())throw rateFailure(reference,cooldown.until,cooldown.headers,path);const controller=new AbortController();controllers.add(controller);
  const url=path==='/graphql'?'https://api.github.com/graphql':'https://api.github.com'+path;
  if(!path.startsWith('/')||path.startsWith('//')||/[\x00-\x1f]/.test(path))throw fail('INVALID_ENDPOINT','Invalid GitHub endpoint.');
  try{
   const response=await request(url,{method,redirect:'error',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...(etag?{'If-None-Match':etag}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:controller.signal});
   const headers={};for(const name of ['etag','link','retry-after','x-ratelimit-remaining','x-ratelimit-limit','x-ratelimit-resource','x-ratelimit-reset','x-poll-interval','x-github-request-id']){const val=response.headers?.get?.(name);if(val)headers[name]=val;}
   if(response.status===304)return {status:304,headers,data:null};
   let bytes=0,chunks=[];if(response.body){for await(const chunk of response.body){bytes+=chunk.length;chunks.push(Buffer.from(chunk));}}else if(typeof response.text==='function'){const text=await response.text();chunks=[Buffer.from(text)];}
   let data;try{data=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):null;}catch{throw fail('INVALID_RESPONSE','GitHub returned an unreadable response.');}
   if(!response.ok){const status=response.status,code=status===401?'SIGN_IN_REQUIRED':status===429||(status===403&&(headers['x-ratelimit-remaining']==='0'||headers['retry-after']))?'RATE_LIMIT':status===404?'NOT_FOUND':status===409?'CONFLICT':status===422?'VALIDATION_FAILED':status===403?'FORBIDDEN':status===405?'MERGE_BLOCKED':'GITHUB_ERROR';const messages={SIGN_IN_REQUIRED:'GitHub rejected the sign-in. Re-enter your token.',RATE_LIMIT:'GitHub rate limit reached. Wait before trying again.',NOT_FOUND:'Repository, source or ref is missing or inaccessible.',CONFLICT:'GitHub changed since this preview. Review the latest source.',VALIDATION_FAILED:'GitHub rejected this operation. Check the branch, permissions and repository rules.',FORBIDDEN:'GitHub denied this operation. Check token permissions and branch protections.',MERGE_BLOCKED:'GitHub cannot merge this pull request yet. Required checks, reviews or branch rules may block it.',GITHUB_ERROR:'GitHub request failed. Your local edits have been preserved.'};if(code==='RATE_LIMIT'){const now=clock().getTime(),retry=Number(headers['retry-after']),reset=Number(headers['x-ratelimit-reset'])*1000;const dateRetry=Date.parse(headers['retry-after']||'');const until=Math.max(now+1000,Number.isFinite(retry)&&retry>0?now+retry*1000:Number.isFinite(dateRetry)&&dateRetry>now?dateRetry:Number.isFinite(reset)&&reset>now?reset:now+60000);cooldowns.set(rateKey,{until,headers});throw Object.assign(rateFailure(reference,until,headers,path),{httpStatus:status});}throw fail(code,messages[code],{httpStatus:status,retryAt:headers['retry-after']||headers['x-ratelimit-reset']||null,unknown:method!=='GET'&&status>=500});}
   // A completed remote write is journalled before checking a changed UI binding.
   if(method==='GET')check(b);
   return {status:response.status,data,headers};
  }catch(error){if(error.code){if(method!=='GET'&&['INVALID_RESPONSE','RESPONSE_LIMIT'].includes(error.code))error.unknown=true;throw error;}throw fail('NETWORK_ERROR','GitHub could not confirm the request. Reconcile publishing before retrying.',{unknown:method!=='GET'});}finally{controllers.delete(controller);}
 }
 const repoBase=name=>'/repos/'+repository(name);
 async function getTree(b,ref,name,sha){
  const endpoint=repoBase(name)+'/git/trees/';
  function entries(data,expected,shallow=false){
   if(!data||!Array.isArray(data.tree)||(data.sha!==undefined&&data.sha!==expected))throw fail('INCOMPLETE_TREE','GitHub did not return the complete requested repository tree. No partial snapshot was imported.');
   const paths=new Set();
   for(const entry of data.tree){
    const path=entry?.path;
    if(typeof path!=='string'||!path||path.startsWith('/')||path.split('/').some(part=>!part||part==='.'||part==='..')||(shallow&&path.includes('/'))||paths.has(path)||!SHA.test(entry.sha||'')||!['blob','tree','commit'].includes(entry.type))throw fail('INCOMPLETE_TREE','GitHub returned an invalid repository tree. No partial snapshot was imported.');
    paths.add(path);
   }
   return data.tree;
  }
  // Most repositories fit in one request. GitHub can truncate recursive trees;
  // walk immutable directory trees instead of imposing our own entry ceiling.
  try{const reply=await api(b,ref,endpoint+sha+'?recursive=1');const tree=entries(reply.data,sha);if(!reply.data.truncated)return tree;}
  catch(error){if(error.code!=='RESPONSE_LIMIT')throw error;}
  const result=[],pending=[{sha,prefix:'',ancestors:new Set()}];
  for(let offset=0;offset<pending.length;){
   check(b);
   const batch=pending.slice(offset,offset+4);offset+=batch.length;
   const replies=await Promise.all(batch.map(async directory=>{
    if(directory.ancestors.has(directory.sha))throw fail('INCOMPLETE_TREE','GitHub returned a cyclic repository tree.');
    const reply=await api(b,ref,endpoint+directory.sha),tree=entries(reply.data,directory.sha,true);
    if(reply.data.truncated)throw fail('INCOMPLETE_TREE','GitHub could not list a complete directory. No partial snapshot was imported.');
    return {directory,tree};
   }));
   for(const {directory,tree} of replies){
    const ancestors=new Set(directory.ancestors);ancestors.add(directory.sha);
    for(const entry of tree){const path=directory.prefix+entry.path;result.push({...entry,path});if(entry.type==='tree')pending.push({sha:entry.sha,prefix:path+'/',ancestors});}
   }
  }
  return result;
 }
 async function readFile(b,ref,name,entry){validatePath(entry.path);if(!['100644','100755'].includes(entry.mode)||entry.type!=='blob')throw fail('UNSUPPORTED_FILE','Symlinks and submodules cannot be edited.');if(!SHA.test(entry.sha||''))throw fail('SOURCE_MISMATCH','GitHub did not identify the source blob.');const blob=(await api(b,ref,repoBase(name)+'/git/blobs/'+entry.sha)).data;if(blob?.sha!==entry.sha)throw fail('SOURCE_MISMATCH','GitHub returned a different source blob.');const content=decode(blob);return {path:entry.path,content,originalContent:content,sha:entry.sha,mode:entry.mode,kind:classify(entry.path)||'context',isDeleted:false};}
 async function getFile(b,ref,name,entry){
  check(b);credential(ref);
  validatePath(entry.path);if(!['100644','100755'].includes(entry.mode)||entry.type!=='blob')throw fail('UNSUPPORTED_FILE','Symlinks and submodules cannot be edited.');if(!SHA.test(entry.sha||''))throw fail('SOURCE_MISMATCH','GitHub did not identify the source blob.');
  const key=JSON.stringify([b.root,b.epoch,name,entry.sha,ref||'']);
  if(!sourceBlobs.has(key)){
   const pending=readFile(b,ref,name,entry);sourceBlobs.set(key,pending);
   pending.catch(()=>{if(sourceBlobs.get(key)===pending)sourceBlobs.delete(key);});
  }
  const file=await sourceBlobs.get(key);check(b);
  return {...clone(file),path:entry.path,kind:classify(entry.path)||'context',mode:entry.mode};
 }
 async function sourceCatalog(p){
  const b=binding(p),name=repository(p.repository||p.fullName),commit=p.commit,reference=p.credentialReference;credential(reference);
  if(!SHA.test(commit||''))throw fail('INVALID_COMMIT','Choose an immutable repository snapshot before browsing source.');
  const key=JSON.stringify([b.root,b.epoch,name,commit,reference||'',p.scope||'']);
  if(!sourceCatalogs.has(key)){
   const pending=(async()=>{const identity=(await api(b,reference,repoBase(name)+'/git/commits/'+commit)).data;
    if(identity?.sha!==commit||!SHA.test(identity?.tree?.sha||''))throw fail('SOURCE_MISMATCH','GitHub returned a different source commit.');
    const tree=await getTree(b,reference,name,identity.tree.sha),entries=[],skipped=[];
    for(const entry of tree){const kind=classify(entry.path)||(p.scope==='api'&&require('../api-atlas/discovery.cjs').candidatePath(entry.path)?'api-source':null);if(!kind)continue;validatePath(entry.path);
     if(entry.type!=='blob'||!['100644','100755'].includes(entry.mode)){skipped.push({path:entry.path,reason:'Unsupported file mode'});continue;}
     if(!SHA.test(entry.sha||''))throw fail('SOURCE_MISMATCH','GitHub did not identify a source blob.');
     entries.push({path:entry.path,sha:entry.sha,mode:entry.mode,size:entry.size,type:'blob',kind});
    }
    return {repository:name,commit,baseTree:identity.tree.sha,entries,skipped,simulated};
   })();sourceCatalogs.set(key,pending);
   pending.catch(()=>{if(sourceCatalogs.get(key)===pending)sourceCatalogs.delete(key);});
   if(sourceCatalogs.size>8)sourceCatalogs.delete(sourceCatalogs.keys().next().value);
  }
  const result=await sourceCatalogs.get(key);check(b);return clone(result);
 }
 async function sourceFile(p){const b=binding(p),path=validatePath(p.path),index=await sourceCatalog(p),entry=index.entries.find(e=>e.path===path);
  if(!entry)throw fail('NOT_FOUND','This supported source file is not present in the selected immutable snapshot.');
  const file=await readFile(b,p.credentialReference,index.repository,entry);check(b);return {file,commit:index.commit,baseTree:index.baseTree,simulated};
 }
 async function apiSources(p){const b=binding(p),index=await sourceCatalog({...p,scope:'api'}),files=[],skipped=[...index.skipped];
  for(let at=0;at<index.entries.length;at+=4){
   const entries=index.entries.slice(at,at+4),batch=await Promise.allSettled(entries.map(entry=>getFile(b,p.credentialReference,index.repository,entry)));
   let interrupted=null;
   for(let i=0;i<batch.length;i++){
    const result=batch[i];if(result.status==='fulfilled'){files.push(result.value);continue;}
    const error=result.reason;
    if(error.code==='WORKSPACE_CHANGED')throw error;
    if(error.code==='BINARY_SOURCE'||error instanceof TypeError){skipped.push({path:entries[i].path,reason:'Source is not UTF-8 text'});continue;}
    interrupted ||= error;
   }
   if(interrupted){skipped.push({path:'',reason:interrupted.message});check(b);return {files,skipped,commit:index.commit,complete:false,scanned:files.length,total:index.entries.length,error:{code:interrupted.code,message:interrupted.message}};}
  }
  check(b);return {files,skipped,commit:index.commit,complete:skipped.length===0,scanned:files.length,total:index.entries.length};
 }
 async function snapshot(p){const b=binding(p),name=repository(p.repository||p.fullName),ref=p.credentialReference;credential(ref);const meta=(await api(b,ref,repoBase(name))).data;if(!meta||!meta.id)throw fail('INVALID_RESPONSE','GitHub did not identify this repository.');const requested=p.ref||meta.default_branch;if(typeof requested!=='string'||!requested||/[\x00-\x1f]/.test(requested))throw fail('EMPTY_REPOSITORY','Choose a repository ref containing commits.');const commit=(await api(b,ref,repoBase(name)+'/commits/'+encodeURIComponent(requested))).data;if(!SHA.test(commit?.sha||'')||!SHA.test(commit?.commit?.tree?.sha||''))throw fail('INVALID_RESPONSE','GitHub did not return an immutable source commit.');
  if(p.paths!==undefined&&!Array.isArray(p.paths))throw fail('INVALID_PATH','Choose an array of repository source paths.');
  const paths=p.paths&&new Set(p.paths.map(validatePath)),partial=p.scope==='workflows'||!!paths;
  const tree=await getTree(b,ref,name,commit.commit.tree.sha),entries=tree.filter(e=>classify(e.path)&&(paths?paths.has(e.path):p.scope==='workflows'?classify(e.path)==='workflow':true));
  const files=[],skipped=[];let total=0;
  for(let start=0;start<entries.length;start+=4){const batch=await Promise.all(entries.slice(start,start+4).map(async entry=>{
   if(entry.type!=='blob'||!['100644','100755'].includes(entry.mode))return {skipped:{path:entry.path,reason:'Unsupported mode or file size'}};
   try{return {file:await getFile(b,ref,name,entry)};}catch(e){if(e.code==='BINARY_SOURCE'||e instanceof TypeError)return {skipped:{path:entry.path,reason:'Source is not UTF-8 text'}};throw e;}
  }));for(const item of batch){if(item.skipped){skipped.push(item.skipped);continue;}total+=Buffer.byteLength(item.file.content);files.push(item.file);}}
  return {fullName:meta.full_name||name,repositoryId:meta.id,ref:requested,commit:commit.sha,baseTree:commit.commit.tree.sha,files,skipped,simulated,importedAt:clock().toISOString(),complete:!partial&&skipped.length===0,sourceInventoryComplete:!partial,sourceScope:partial?(paths?'selected':'workflows'):'complete',sourceIndex:null};
 }
 async function preview(p){const b=binding(p),name=repository(p.repository||p.fullName),baseCommit=p.baseCommit||p.commit;if(!SHA.test(baseCommit||''))throw fail('INVALID_COMMIT','Import an immutable repository snapshot before staging.');const reference=p.credentialReference;credential(reference);
  const aliases={'direct-commit':'direct','branch-pr':'pr','branch-pr-merge':'merge','branch+pr':'pr','branch+pr+merge':'merge'};const mode=aliases[p.mode]||p.mode||'pr';if(!['direct','pr','merge'].includes(mode))throw fail('INVALID_MODE','Choose direct commit, pull request or pull request and merge.');const targetBranch=validateBranch(p.targetBranch||p.ref||'main'),newBranch=mode==='direct'?null:validateBranch(p.newBranch||'lvx/studio-'+uuid().slice(0,12));if(newBranch===targetBranch)throw fail('INVALID_BRANCH','The review branch must differ from the destination branch.');
  if(typeof p.message!=='string'||!p.message.trim())throw fail('INVALID_MESSAGE','Enter a nonempty commit message.');if(p.title!==undefined&&(typeof p.title!=='string'||!p.title.trim()))throw fail('INVALID_TITLE','Enter a nonempty pull request title.');if(p.body!==undefined&&(typeof p.body!=='string'))throw fail('INVALID_BODY','Pull request description is too long.');const mergeMethod=p.mergeMethod||'squash';if(!['merge','squash','rebase'].includes(mergeMethod))throw fail('INVALID_MERGE_METHOD','Choose a supported merge method.');
  const commit=(await api(b,reference,repoBase(name)+'/git/commits/'+baseCommit)).data;if(commit?.sha!==baseCommit||!SHA.test(commit?.tree?.sha||''))throw fail('SOURCE_MISMATCH','The original commit could not be verified.');if(p.baseTree&&p.baseTree!==commit.tree.sha)throw fail('SOURCE_MISMATCH','The original tree changed. Reimport the repository.');const tree=await getTree(b,reference,name,commit.tree.sha),byPath=new Map(tree.map(e=>[e.path,e]));
  if(!Array.isArray(p.files))throw fail('INVALID_STAGE','Choose supported source files to stage.');const stage=p.stagedPaths===undefined?p.files.filter(f=>f.staged).map(f=>f.path):p.stagedPaths;if(!Array.isArray(stage)||new Set(stage).size!==stage.length)throw fail('INVALID_STAGE','Stage paths must be unique.');const files=new Map();for(const file of p.files){validatePath(file.path);if(files.has(file.path))throw fail('INVALID_STAGE','Source paths must be unique.');files.set(file.path,file);}
  const directories=new Set();for(const path of byPath.keys())for(const parent of parentPaths(path))directories.add(parent);
  const changes=[],ordered=[...stage].sort();let total=0;
  for(let offset=0;offset<ordered.length;offset+=4){
   const batch=await Promise.all(ordered.slice(offset,offset+4).map(async path=>{
    validatePath(path);const draft=files.get(path);if(!draft)throw fail('INVALID_STAGE','A staged file is missing from the source snapshot.');if(!classify(path))throw fail('UNSUPPORTED_FILE','Only workflow, test and supported configuration files can be published.');
    const entry=byPath.get(path);let original=null,originalSha=null,modeValue='100644';
    if(entry){const verified=await readFile(b,reference,name,entry);original=verified.content;originalSha=verified.sha;modeValue=verified.mode;if(draft.originalContent!==original||draft.sha!==originalSha)throw fail('SOURCE_MISMATCH','Original source for '+path+' does not match its immutable GitHub blob.');}
    else if(draft.originalContent!==null||draft.sha)throw fail('SOURCE_MISMATCH','Added file '+path+' already has an original source identity.');
    const next=draft.isDeleted?null:draft.content;if(next!==null&&(typeof next!=='string'||next.includes('\0')))throw fail('SOURCE_LIMIT','A staged source file must be text without NUL bytes.');if(draft.mode&&draft.mode!==modeValue)throw fail('MODE_CHANGED','Changing executable or symlink modes is unsupported.');if(original===next)return null;
    if(directories.has(path)||[...parentPaths(path)].some(parent=>byPath.has(parent)&&byPath.get(parent).type!=='tree'))throw fail('PATH_COLLISION','A staged file conflicts with an existing repository path.');
    return {path,originalContent:original,content:next,sha:originalSha,mode:modeValue,status:original===null?'added':next===null?'deleted':'modified'};
   }));
   for(const change of batch){if(!change)continue;total+=Buffer.byteLength(change.originalContent||'')+Buffer.byteLength(change.content||'');changes.push(change);}
  }
  if(!changes.length)throw fail('EMPTY_STAGE','Stage at least one changed file.');
  const changedPaths=new Set(),foldedPaths=new Set();for(const change of changes){const folded=change.path.toLowerCase();if(foldedPaths.has(folded))throw fail('PATH_COLLISION','Staged paths collide.');foldedPaths.add(folded);changedPaths.add(change.path);}
  for(const change of changes)for(const parent of parentPaths(change.path))if(changedPaths.has(parent))throw fail('PATH_COLLISION','Staged paths collide.');
  // GraphQL cannot explicitly set file modes. Do not risk changing executable sources.
  if(mode==='direct'&&changes.some(c=>c.mode!=='100644'))throw fail('UNSUPPORTED_MODE','Use a pull request to preserve executable file modes.');
  const originalRef=(await api(b,reference,repoBase(name)+'/git/ref/heads/'+encodeURIComponent(targetBranch))).data;if(originalRef?.object?.sha!==baseCommit)throw fail('STALE_BASE','Destination branch changed. Refresh and review your edits before publishing.');
  const {sourcePatch}=require('./diff.cjs');const diff=changes.map(c=>{const patch=sourcePatch(c.originalContent===null?'/dev/null':'a/'+c.path,c.content===null?'/dev/null':'b/'+c.path,c.originalContent||'',c.content||'');return patch;}).join('\n');
  const plan={repository:name,baseCommit,baseTree:commit.tree.sha,targetBranch,newBranch,mode,message:p.message.trim(),title:p.title?.trim()||p.message.trim().split('\n')[0],body:p.body||'',mergeMethod,changes,simulated};const digest=hash(plan),previewId=uuid();previews.set(previewId,{...clone(plan),digest,workspaceRoot:b.root,epoch:b.epoch});
  return {previewId,digest,diff,changes:clone(changes),repository:name,baseCommit,targetBranch,newBranch,mode,message:plan.message,title:plan.title,body:plan.body,mergeMethod,simulated};
 }
 async function save(op){operations.set(op.operationId,clone(op));if(options.journal?.write)await options.journal.write(op.operationId,clone(op));else if(options.workspace){const old=await options.workspace.handle('read',{workspaceRoot:op.workspaceRoot,collection:'github-publish-operations',id:op.operationId});await options.workspace.handle('transact',{workspaceRoot:op.workspaceRoot,records:[{collection:'github-publish-operations',id:op.operationId,value:clone(op),expectedRevision:old?.revision??null}]});}}
 async function loadOp(id,b){let op=operations.get(id);if(!op&&options.journal?.read)op=await options.journal.read(id);if(!op&&options.workspace)op=(await options.workspace.handle('read',{workspaceRoot:b.root,collection:'github-publish-operations',id}))?.value;if(!op||op.workspaceRoot!==b.root)throw fail('OPERATION_NOT_FOUND','This publishing operation does not belong to the selected project.');return clone(op);}
 function publicOp(op){const {plan,workspaceRoot,...safe}=clone(op);return {...safe,repository:plan.repository,mode:plan.mode,baseCommit:plan.baseCommit,simulated};}
 async function mutate(op,b,reference,path,method,body,phase){op.phase=phase;op.state='pending';await save(op);check(b);return (await api(b,reference,path,{method,body,write:true})).data;}
 async function resume(op,b,reference){const plan=op.plan,base=repoBase(plan.repository);if(locks.has(plan.repository.toLowerCase()))throw fail('PUBLISH_BUSY','Another publish is in progress for this repository.');locks.add(plan.repository.toLowerCase());
  try{
   if(op.state==='complete')return publicOp(op);credential(reference,true);await options.assertTrusted?.();check(b);
   if(plan.mode==='direct'){
    // On recovery, first prove an operation-marked commit already reached the branch.
    const current=(await api(b,reference,base+'/git/ref/heads/'+encodeURIComponent(plan.targetBranch))).data?.object?.sha;
    if(current!==plan.baseCommit){const queue=[current],visited=new Set();for(let cursor=0;cursor<queue.length;cursor++){const sha=queue[cursor];if(sha===plan.baseCommit||visited.has(sha))continue;visited.add(sha);const observed=(await api(b,reference,base+'/git/commits/'+sha)).data;if(observed?.message?.includes('\nLVX-Operation: '+op.operationId)&&observed.parents?.length===1&&observed.parents[0].sha===plan.baseCommit){const resultTree=await getTree(b,reference,plan.repository,observed.tree.sha);await verifyResult(op,b,reference,resultTree);op.commitSha=sha;op.branch=plan.targetBranch;op.state='complete';op.phase='complete';op.error=null;await save(op);return publicOp(op);}for(const parent of observed?.parents||[])if(SHA.test(parent.sha||''))queue.push(parent.sha);}throw fail('STALE_BASE','Destination branch changed. No new commit was sent.');}
    const body={query:'mutation LVXCommit($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid url} ref{name}}}',variables:{input:{branch:{repositoryNameWithOwner:plan.repository,refName:plan.targetBranch},expectedHeadOid:plan.baseCommit,message:{headline:plan.message.split('\n')[0],body:plan.message.split('\n').slice(1).join('\n')+'\nLVX-Operation: '+op.operationId},fileChanges:{additions:plan.changes.filter(c=>c.content!==null).map(c=>({path:c.path,contents:Buffer.from(c.content).toString('base64')})),deletions:plan.changes.filter(c=>c.content===null).map(c=>({path:c.path}))},clientMutationId:op.operationId}}};
    const reply=await mutate(op,b,reference,'/graphql','POST',body,'commit-requested');if(reply?.errors?.length)throw fail('COMMIT_REJECTED','GitHub rejected the commit. Refresh the branch and check write permissions.');const sha=reply?.data?.createCommitOnBranch?.commit?.oid;if(!SHA.test(sha||''))throw fail('UNKNOWN_OUTCOME','GitHub did not confirm the published commit.',{unknown:true});op.commitSha=sha;op.branch=plan.targetBranch;op.phase='complete';op.state='complete';await save(op);return publicOp(op);
   }
   if(!op.commitSha){const current=(await api(b,reference,base+'/git/ref/heads/'+encodeURIComponent(plan.targetBranch))).data?.object?.sha;if(current!==plan.baseCommit)throw fail('STALE_BASE','Destination branch changed. Refresh and review before publishing.');const tree=[];for(const change of plan.changes){let sha=null;if(change.content!==null){const blob=await mutate(op,b,reference,base+'/git/blobs','POST',{content:Buffer.from(change.content).toString('base64'),encoding:'base64'},'objects');sha=blob?.sha;if(!SHA.test(sha||''))throw fail('INVALID_RESPONSE','GitHub did not return a created blob.');}tree.push({path:change.path,mode:change.mode,type:'blob',sha});}const created=await mutate(op,b,reference,base+'/git/trees','POST',{base_tree:plan.baseTree,tree},'objects');if(!SHA.test(created?.sha||''))throw fail('INVALID_RESPONSE','GitHub did not return the created tree.');op.treeSha=created.sha;await save(op);const commit=await mutate(op,b,reference,base+'/git/commits','POST',{message:plan.message+'\n\nLVX-Operation: '+op.operationId,tree:op.treeSha,parents:[plan.baseCommit]},'commit-requested');if(!SHA.test(commit?.sha||''))throw fail('INVALID_RESPONSE','GitHub did not return the created commit.');op.commitSha=commit.sha;await save(op);}
   if(!op.branch){let current=null;try{current=(await api(b,reference,base+'/git/ref/heads/'+encodeURIComponent(plan.newBranch))).data?.object?.sha;}catch(e){if(e.httpStatus!==404)throw e;}if(current&&current!==op.commitSha)throw fail('BRANCH_EXISTS','This review branch already exists with different content. Choose another branch.');if(!current)await mutate(op,b,reference,base+'/git/refs','POST',{ref:'refs/heads/'+plan.newBranch,sha:op.commitSha},'branch-requested');op.branch=plan.newBranch;op.phase='branch-updated';await save(op);}
   if(!op.prNumber){const head=plan.repository.split('/')[0]+':'+op.branch;const existing=await paged(b,reference,base+'/pulls?state=all&head='+encodeURIComponent(head)+'&base='+encodeURIComponent(plan.targetBranch)+'&per_page=100');if(!Array.isArray(existing))throw fail('INVALID_RESPONSE','GitHub returned an unreadable pull request list.');const matches=existing.filter(pr=>pr.head?.sha===op.commitSha&&pr.head?.ref===op.branch&&pr.base?.ref===plan.targetBranch);if(matches.length>1)throw fail('AMBIGUOUS_PR','Multiple matching pull requests need review on GitHub.');let pr=matches[0];if(!pr)pr=await mutate(op,b,reference,base+'/pulls','POST',{title:plan.title,body:plan.body+'\n\n<!-- LVX operation '+op.operationId+' -->',head:op.branch,base:plan.targetBranch},'pr-requested');if(!Number.isSafeInteger(pr?.number)||!pr.html_url)throw fail('UNKNOWN_OUTCOME','GitHub did not confirm the created pull request.',{unknown:true});op.prNumber=pr.number;op.prUrl=safeUrl(pr.html_url);op.phase='pr-created';await save(op);}
   if(plan.mode==='merge'){
    const pr=(await api(b,reference,base+'/pulls/'+op.prNumber)).data;if(pr?.head?.sha!==op.commitSha||pr?.head?.ref!==op.branch||pr?.head?.repo?.full_name?.toLowerCase()!==plan.repository.toLowerCase()||pr?.base?.ref!==plan.targetBranch||pr?.base?.repo?.full_name?.toLowerCase()!==plan.repository.toLowerCase())throw fail('STALE_PR','Pull request identity or head changed. Open it on GitHub to review.');if(pr.merged){if(!SHA.test(pr.merge_commit_sha||''))throw fail('UNKNOWN_OUTCOME','GitHub did not identify the merged commit.',{unknown:true});op.merged=true;op.mergeCommitSha=pr.merge_commit_sha;}else{if(pr.state!=='open'||pr.draft)throw fail('MERGE_BLOCKED','This pull request is closed or still a draft.');if(pr.mergeable===null)throw fail('MERGE_PENDING','GitHub is still checking whether the pull request can merge.');const merged=await mutate(op,b,reference,base+'/pulls/'+op.prNumber+'/merge','PUT',{sha:op.commitSha,merge_method:plan.mergeMethod},'merge-requested');if(merged?.merged!==true||!SHA.test(merged?.sha||''))throw fail('MERGE_BLOCKED','Pull request is open but GitHub has not merged it.');op.merged=true;op.mergeCommitSha=merged.sha;}
   }
   op.phase='complete';op.state='complete';op.error=null;await save(op);return publicOp(op);
  }catch(error){op.state=error.unknown||['NETWORK_ERROR','UNKNOWN_OUTCOME','WORKSPACE_CHANGED'].includes(error.code)?'unknown':op.commitSha||op.prNumber?'partial':'failed';op.error={code:error.code||'PUBLISH_ERROR',message:String(redact(error.message||'Publishing failed.')),httpStatus:error.httpStatus||null,retryAt:error.retryAt||null};await save(op);return publicOp(op);}finally{locks.delete(plan.repository.toLowerCase());}
 }
 async function verifyResult(op,b,reference,tree){const map=new Map(tree.map(e=>[e.path,e])),original=await getTree(b,reference,op.plan.repository,op.plan.baseTree),changed=new Set(op.plan.changes.map(c=>c.path));for(const e of original){if(e.type==='tree'||changed.has(e.path))continue;const next=map.get(e.path);if(!next||next.sha!==e.sha||next.mode!==e.mode)throw fail('SOURCE_MISMATCH','Recovered commit changed unreviewed repository content.');}const expectedPaths=new Set(original.filter(e=>e.type!=='tree').map(e=>e.path));for(const c of op.plan.changes){if(c.content===null)expectedPaths.delete(c.path);else expectedPaths.add(c.path);}if(tree.filter(e=>e.type!=='tree').some(e=>!expectedPaths.has(e.path)))throw fail('SOURCE_MISMATCH','Recovered commit contains unreviewed additions.');for(const c of op.plan.changes){const e=map.get(c.path);if(c.content===null){if(e)throw fail('SOURCE_MISMATCH','Recovered commit differs from the reviewed deletion.');}else if(!e||e.mode!==c.mode||decode((await api(b,reference,repoBase(op.plan.repository)+'/git/blobs/'+e.sha)).data)!==c.content)throw fail('SOURCE_MISMATCH','Recovered commit differs from the reviewed content.');}}
 function safeUrl(value){try{const u=new URL(value);if(u.protocol==='https:'&&u.hostname==='github.com'&&!u.username&&!u.password&&!u.port)return u.href;}catch{}return null;}
 async function publish(p){const b=binding(p);if(!/^[a-f0-9-]{36}$/i.test(p.operationId||''))throw fail('INVALID_OPERATION','Publishing needs a unique operation ID.');let known;try{known=await loadOp(p.operationId,b);}catch(e){if(e.code!=='OPERATION_NOT_FOUND')throw e;}if(known){if(known.previewId!==p.previewId||known.workspaceRoot!==b.root)throw fail('OPERATION_CONFLICT','This operation ID belongs to another preview.');return publicOp(known);}const plan=previews.get(p.previewId);if(!plan||plan.workspaceRoot!==b.root||plan.epoch!==b.epoch)throw fail('PREVIEW_EXPIRED','Review the staged diff again before publishing.');const op={operationId:p.operationId,previewId:p.previewId,workspaceRoot:b.root,plan:clone(plan),state:'pending',phase:'prepared',merged:false,createdAt:clock().toISOString()};await save(op);return resume(op,b,p.credentialReference);}
 async function paged(b,reference,path,key,first){
  const rows=[],visited=new Set();let next=path;
  while(next){
   if(visited.has(next))throw fail('UNSAFE_PAGINATION','GitHub returned a pagination cycle.');visited.add(next);
   const reply=first||await api(b,reference,next);first=null;
   const list=key?reply.data?.[key]:reply.data;if(!Array.isArray(list))throw fail('INVALID_RESPONSE','GitHub returned an unreadable list.');
   for(const row of list)rows.push(row);
   const match=/<([^>]+)>;\s*rel="next"/.exec(reply.headers.link||'');next=null;
   if(match){const url=new URL(match[1]);if(url.origin!=='https://api.github.com'||url.username||url.password||url.pathname!==path.split('?')[0])throw fail('UNSAFE_PAGINATION','GitHub pagination target is outside the selected endpoint.');next=url.pathname+url.search;}
  }
  return rows;
 }
 async function listRuns(p){const b=binding(p),name=repository(p.repository||p.fullName),commit=p.expectedCommit||p.commit;if(!SHA.test(commit||''))throw fail('INVALID_COMMIT','Choose an immutable snapshot for run status.');const workflow=validatePath(p.workflowPath);if(!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(workflow))throw fail('INVALID_PATH','Choose a workflow file.');const path=repoBase(name)+'/actions/workflows/'+encodeURIComponent(workflow.split('/').at(-1))+'/runs?head_sha='+commit+'&per_page=100',key=b.root+'|'+path+'|'+(p.credentialReference||''),cached=cache.get(key);const reply=await api(b,p.credentialReference,path,{etag:cached?.etag});if(reply.status===304){if(!cached)throw fail('INVALID_RESPONSE','GitHub returned unchanged status without a previous response.');if(!cached.first.headers.link)return clone(cached.value);reply.data=cached.first.data;reply.headers={...cached.first.headers,...reply.headers};}if(!Array.isArray(reply.data?.workflow_runs))throw fail('INVALID_RESPONSE','GitHub returned an unreadable workflow run list.');const value={runs:(await paged(b,p.credentialReference,path,'workflow_runs',reply)).filter(r=>r.head_sha===commit&&String(r.path||'').split('@')[0]===workflow).map(r=>({id:r.id,name:r.name,status:r.status,conclusion:r.conclusion,headSha:r.head_sha,attempt:r.run_attempt||1,url:safeUrl(r.html_url),updatedAt:r.updated_at})),observedAt:clock().toISOString(),pollAfter:Math.min(3600,Math.max(15,Number(reply.headers['x-poll-interval'])||30)),simulated};cache.set(key,{etag:reply.headers.etag,value,first:{data:reply.data,headers:reply.headers}});return value;}
 async function runJobs(p){const b=binding(p),name=repository(p.repository||p.fullName);if(!Number.isSafeInteger(p.runId)||p.runId<1||!Number.isSafeInteger(p.attempt)||p.attempt<1)throw fail('INVALID_RUN','Select a workflow run and attempt.');if(!SHA.test(p.expectedCommit||p.commit||''))throw fail('INVALID_COMMIT','Choose the snapshot commit before inspecting jobs.');const run=(await api(b,p.credentialReference,repoBase(name)+'/actions/runs/'+p.runId)).data;if(run?.head_sha!==(p.expectedCommit||p.commit))throw fail('STALE_RUN','This run belongs to a different source commit.');const jobs=await paged(b,p.credentialReference,repoBase(name)+'/actions/runs/'+p.runId+'/attempts/'+p.attempt+'/jobs?per_page=100','jobs');return {jobs:jobs.map(j=>({id:j.id,name:j.name,status:j.status,conclusion:j.conclusion,url:safeUrl(j.html_url),steps:(j.steps||[]).map(s=>({name:s.name,number:s.number,status:s.status,conclusion:s.conclusion}))})),simulated};}
 async function reusable(p){const b=binding(p),name=repository(p.repository||p.fullName),commit=p.commit||p.baseCommit;if(!SHA.test(commit||''))throw fail('INVALID_COMMIT','Choose an immutable caller commit.');let uses=p.uses;if(!uses){const path=validatePath(p.workflowPath),caller=(await api(b,p.credentialReference,repoBase(name)+'/contents/'+path.split('/').map(encodeURIComponent).join('/')+'?ref='+commit)).data;const {parseDocument}=require('yaml');const doc=parseDocument(decode(caller),{uniqueKeys:true});if(doc.errors.length)throw fail('INVALID_WORKFLOW','Caller workflow could not be parsed.');uses=doc.toJS({maxAliasCount:-1})?.jobs?.[p.jobId]?.uses;}
  if(typeof uses!=='string'||uses.includes('${{'))throw fail('INVALID_REUSABLE','Select a static reusable workflow reference.');let target=name,path,ref=commit;if(/^(?:\.\/|\$\/)\.github\/workflows\/[^/@\\]+\.ya?ml$/.test(uses))path=uses.slice(2);else{const m=/^([\w-]+\/[\w.-]+)\/(\.github\/workflows\/[^/@\\]+\.ya?ml)@([^\x00-\x20]+)$/.exec(uses);if(!m)throw fail('INVALID_REUSABLE','This is not a supported reusable workflow reference.');target=repository(m[1]);path=m[2];const rawRef=m[3];if(SHA.test(rawRef))ref=rawRef;else{let tag;try{tag=(await api(b,p.credentialReference,repoBase(target)+'/git/ref/tags/'+encodeURIComponent(rawRef))).data?.object;}catch(e){if(e.httpStatus!==404)throw e;}if(tag){const tags=new Set();while(tag?.type==='tag'){if(!SHA.test(tag.sha||'')||tags.has(tag.sha))throw fail('INVALID_REUSABLE','Reusable tag contains a cycle or invalid reference.');tags.add(tag.sha);tag=(await api(b,p.credentialReference,repoBase(target)+'/git/tags/'+tag.sha)).data?.object;}if(tag.type!=='commit')throw fail('INVALID_REUSABLE','Reusable tag could not be resolved.');ref=tag.sha;}else ref=(await api(b,p.credentialReference,repoBase(target)+'/commits/'+encodeURIComponent(rawRef))).data?.sha;}}
  if(!SHA.test(ref||''))throw fail('INVALID_REUSABLE','Reusable workflow commit could not be resolved.');validatePath(path);const c=(await api(b,p.credentialReference,repoBase(target)+'/git/commits/'+ref)).data;const inventory=await getTree(b,p.credentialReference,target,c?.tree?.sha),entry=inventory.find(e=>e.path===path);if(!entry)throw fail('NOT_FOUND','Reusable workflow source was not found at the selected commit.');const file=await getFile(b,p.credentialReference,target,entry);return {repository:target,path,commit:ref,content:file.content,source:file.content,simulated};
 }
 return {async handle(action,p={}){if(action==='apiSources')return apiSources(p);if(action==='sourceIndex')return sourceCatalog(p);if(action==='sourceFile')return sourceFile(p);if(action==='snapshot'||action==='importTests')return snapshot(p);if(action==='previewStage')return preview(p);if(action==='publish')return publish(p);if(action==='operation')return publicOp(await loadOp(p.operationId,binding(p)));if(action==='reconcile'){const b=binding(p);return resume(await loadOp(p.operationId,b),b,p.credentialReference);}if(action==='listRuns')return listRuns(p);if(action==='runJobs')return runJobs(p);if(action==='inspectReusable')return reusable(p);throw fail('UNKNOWN_ACTION','Unknown GitHub studio action.');},setWorkspace(){epoch++;previews.clear();cache.clear();sourceCatalogs.clear();sourceBlobs.clear();for(const c of controllers)c.abort();},async drain(){while(locks.size)await new Promise(r=>setTimeout(r,25));},async close(){closed=true;epoch++;for(const c of controllers)c.abort();previews.clear();cache.clear();sourceCatalogs.clear();sourceBlobs.clear();},simulated};
}
module.exports={createService,validatePath,validateBranch,LIMITS,classify};
