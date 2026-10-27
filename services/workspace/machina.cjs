'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {WorkspaceError,sha256}=require('./store.cjs');
const {exportArchive,verifyArchive,scrub}=require('./archive.cjs');
const importer=require('../../legacy-importer.js'),runtime=require('../../mock-runtime.js');
const DEFAULT_POLICY=Object.freeze({mode:'unlimited',sessionRetention:{enabled:false,keepForever:true,maxExports:0},logRetention:{enabled:false,maxFiles:0,maxAgeDays:0,maxTotalSizeMB:0}});
const fail=(code,message)=>{throw new WorkspaceError(code,message);};
function normalizePolicy(policy={}) {
  if(!['custom','unlimited'].includes(policy.mode||'unlimited'))fail('VALIDATION','Retention mode must be custom or unlimited.');
  const integer=(value,fallback)=>{const n=value??fallback;if(!Number.isSafeInteger(n)||n<0)fail('VALIDATION','Retention budgets must be nonnegative integers; zero disables a budget.');return n;};
  const s=policy.sessionRetention||{},l=policy.logRetention||{};
  for(const b of [s.enabled,s.keepForever,l.enabled])if(b!==undefined&&typeof b!=='boolean')fail('VALIDATION','Retention switches must be booleans.');
  return {mode:policy.mode||'unlimited',sessionRetention:{enabled:s.enabled??(policy.mode==='custom'),keepForever:s.keepForever??(policy.mode!=='custom'),maxExports:integer(s.maxExports,0)},logRetention:{enabled:l.enabled??(policy.mode==='custom'),maxFiles:integer(l.maxFiles,0),maxAgeDays:integer(l.maxAgeDays,0),maxTotalSizeMB:integer(l.maxTotalSizeMB,0)}};
}
function noLinks(filename,root) {
  const absolute=path.resolve(filename),base=path.resolve(root),relative=path.relative(base,absolute);
  if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))fail('PATH_SCOPE','Path must remain inside the selected workspace.');
  // Check ancestors too: a junction above dataDir must not redirect private writes.
  let cursor=path.parse(absolute).root;const parts=path.relative(cursor,absolute).split(path.sep).filter(Boolean);
  for(const part of parts){cursor=path.join(cursor,part);if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink())fail('PATH_SCOPE','Symbolic links are not allowed.');}return absolute;
}
function atomicWrite(filename,value,root) {
  noLinks(filename,root);fs.mkdirSync(path.dirname(filename),{recursive:true});noLinks(filename,root);
  const temp=`${filename}.${crypto.randomUUID()}.tmp`;let fd;
  try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,value);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;noLinks(filename,root);fs.renameSync(temp,filename);}finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
function createMachinaWorkspace({workspaceRoot,dataDir,store,redact=value=>value,protectImport,emit=()=>{},now=()=>Date.now()}={}) {
  const pending=new Map();let root,privateRoot;
  function requireReady(){if(!workspaceRoot||!store)fail('WORKSPACE_REQUIRED','Choose a workspace folder first.');if(!root){if(!path.isAbsolute(workspaceRoot)||!fs.statSync(workspaceRoot).isDirectory())fail('PATH_SCOPE','Workspace root must be an existing absolute directory.');root=fs.realpathSync(workspaceRoot);if(!dataDir||!path.isAbsolute(dataDir))fail('VALIDATION','A private absolute data directory is required.');privateRoot=path.join(dataDir,'machina',sha256(process.platform==='win32'?root.toLowerCase():root).slice(0,24));}noLinks(privateRoot,dataDir);return root;}
  const area=name=>{requireReady();const dir=noLinks(path.join(privateRoot,name),dataDir);fs.mkdirSync(dir,{recursive:true});return dir;};
  function files(name){const dir=area(name);return fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isFile()&&/\.json$/.test(e.name)).map(e=>{const full=noLinks(path.join(dir,e.name),dataDir),s=fs.statSync(full);return {id:e.name.slice(0,-5),fileName:e.name,sizeBytes:s.size,modifiedAt:s.mtime.toISOString(),time:s.mtimeMs,path:full};}).sort((a,b)=>b.time-a.time||b.id.localeCompare(a.id));}
  function policyRecord(){return store.read('machina-settings','retention');}
  function policy(){return normalizePolicy(policyRecord()?.value||DEFAULT_POLICY);}
  function cleanupPreview(){const p=policy(),sessions=files('sessions'),logs=files('logs');let sessionDeletes=[],logDeletes=[];
    if(p.mode!=='unlimited'){if(p.sessionRetention.enabled&&!p.sessionRetention.keepForever&&p.sessionRetention.maxExports>0)sessionDeletes=sessions.slice(p.sessionRetention.maxExports);if(p.logRetention.enabled){let kept=0,bytes=0;for(const file of logs){const expired=p.logRetention.maxAgeDays>0&&(now()-file.time)/86400000>p.logRetention.maxAgeDays,countExceeded=p.logRetention.maxFiles>0&&kept>=p.logRetention.maxFiles,bytesExceeded=p.logRetention.maxTotalSizeMB>0&&(bytes+file.sizeBytes)/1024/1024>p.logRetention.maxTotalSizeMB;if(expired||countExceeded||bytesExceeded)logDeletes.push(file);else{kept++;bytes+=file.sizeBytes;}}}}
    return {policy:p,sessions:sessions.map(({path,time,...f})=>f),logs:logs.map(({path,time,...f})=>f),deleteSessions:sessionDeletes.map(f=>f.id),deleteLogs:logDeletes.map(f=>f.id),bytesToDelete:[...sessionDeletes,...logDeletes].reduce((n,f)=>n+f.sizeBytes,0)};
  }
  function cleanup(){const preview=cleanupPreview();for(const [folder,ids] of [['sessions',preview.deleteSessions],['logs',preview.deleteLogs]])for(const id of ids){const target=noLinks(path.join(area(folder),`${id}.json`),dataDir);if(fs.existsSync(target))fs.unlinkSync(target);}return {...preview,deletedCount:preview.deleteSessions.length+preview.deleteLogs.length};}
  function savedPath(id){if(typeof id!=='string'||!/^[a-zA-Z0-9_-]+$/.test(id))fail('VALIDATION','Choose a valid saved session.');return noLinks(path.join(area('sessions'),`${id}.json`),dataDir);}
  function scopedInput(input){if(typeof input!=='string'||!input)fail('VALIDATION','Choose a file or folder inside the workspace.');return noLinks(path.resolve(root,input),root);}
  function readFile(filename){const stats=fs.statSync(filename);if(!stats.isFile())fail('VALIDATION','Choose a regular file.');return fs.readFileSync(filename,'utf8');}
  function makePreview(payload){const sources=[];
    if(payload.path){const input=scopedInput(payload.path);if(fs.statSync(input).isDirectory()){for(const file of importer.collectLegacyImportFiles(input))sources.push({content:readFile(file.path),sourceName:file.relativePath});}else sources.push({content:readFile(input),sourceName:path.basename(input)});}
    else if(payload.content!==undefined){sources.push({content:payload.content,sourceName:payload.sourceName||'Imported JSON'});}else fail('VALIDATION','Choose legacy JSON or a workspace folder.');
    if(!sources.length)fail('VALIDATION','No JSON files were found.');
    const snapshot=store.list(),records=[],reports=[],errors=[];
    for(const source of sources){try{if((typeof source.content==='string'?JSON.parse(source.content):source.content)?.format==='lvx-workspace')throw Error('Use the verified project archive importer for Studio archives.');const extracted=importer.extractImportPayload(source.content,source);const normalized=importer.normalizeImport(extracted,{existingRecords:[...snapshot.records,...records]});for(const record of normalized.records)records.push(record);reports.push({sourceName:source.sourceName,counts:normalized.counts,maps:normalized.maps,warnings:normalized.warnings});}catch(e){errors.push({sourceName:source.sourceName,message:e.message});}}
    if(errors.length) return {valid:false,errors,reports,revision:snapshot.revision};
    importer.reconcileFolderReferences(records,reports);const token=crypto.randomUUID();pending.set(token,{records,reports,revision:snapshot.revision});return {valid:true,token,reports,recordCount:records.length,revision:snapshot.revision,trustRequired:true,secretsExcluded:true};
  }
  return {
    async handle(action,payload={}) {
      requireReady();if(!payload||typeof payload!=='object'||Array.isArray(payload))fail('VALIDATION','Action payload must be an object.');
      switch(action){
        case 'listMockPlans':return store.list('mock-plans');
        case 'readMockPlan':{const record=store.read('mock-plans',payload.id);if(!record)fail('NOT_FOUND','Saved fixture plan was removed.');return record;}
        case 'saveMockPlan':{if(typeof payload.name!=='string'||!payload.name.trim())fail('VALIDATION','Give the fixture plan a name.');const state=runtime.normalizeState(payload.state);runtime.buildSuiteExecutionPlan({mock_builder:state});const id=payload.id||crypto.randomUUID();let records=[{collection:'mock-plans',id,expectedRevision:payload.expectedRevision??null,value:{name:payload.name.trim(),state,requiresTrustReview:true}}];if(protectImport)records=await protectImport(records);store.transact(records);return {record:store.read('mock-plans',id)};}
        case 'previewLegacyImport':return makePreview(payload);
        case 'importLegacy':{const preview=pending.get(payload.token);if(!preview)fail('PREVIEW_REQUIRED','Preview the legacy import again.');if(payload.expectedWorkspaceRevision!==preview.revision)fail('CONFLICT','Import revision does not match its preview.');let records=JSON.parse(JSON.stringify(preview.records));if(protectImport)records=await protectImport(records);records=records.map(r=>({...r,value:redact(scrub(r.value),{collection:r.collection,id:r.id,kind:'record'})}));const importedRecords=records.length,counts={};for(const record of records)counts[record.collection]=(counts[record.collection]||0)+1;records.push({collection:'migrations',id:crypto.randomUUID(),expectedRevision:null,value:{kind:'legacy-machina',committedAt:new Date(now()).toISOString(),counts,sources:(preview.reports||[]).map(r=>r.sourceName)}});const result=store.transact(records,{expectedWorkspaceRevision:preview.revision});pending.delete(payload.token);emit({domain:'workspace',type:'changed',...result});return {...result,importedRecords,trustRequired:true};}
        case 'getRetention':return {policy:policy(),revision:policyRecord()?.revision??null};
        case 'setRetention':{const normalized=normalizePolicy(payload.policy);const result=store.transact([{collection:'machina-settings',id:'retention',value:normalized,expectedRevision:payload.expectedRevision??null}]);emit({domain:'workspace',type:'changed',...result});return {policy:normalized,revision:policyRecord().revision,cleanup:cleanup()};}
        case 'previewRetention':return cleanupPreview();
        case 'applyRetention':return cleanup();
        case 'listSessions':cleanup();return {sessions:files('sessions').map(({path,time,...f})=>f),policy:policy()};
        case 'saveSession':{const archive=exportArchive(store,payload,redact),serialized=JSON.stringify(archive,null,2);const id=`session-${now()}-${crypto.randomUUID()}`;const filename=savedPath(id);atomicWrite(filename,serialized,dataDir);return {id,fileName:path.basename(filename),sizeBytes:fs.statSync(filename).size,cleanup:cleanup(),format:archive.format};}
        case 'readSession':{const archive=JSON.parse(readFile(savedPath(payload.id)));const validation=verifyArchive(archive,undefined,redact);if(!validation.valid)fail('ARCHIVE_INVALID','Saved session failed checksum or credential validation.');return {archive,validation};}
        case 'deleteSession':{const file=savedPath(payload.id);if(fs.existsSync(file))fs.unlinkSync(file);return {deleted:true,id:payload.id};}
        case 'appendLog':{const content=JSON.stringify(redact(scrub(payload.value??payload.content??'')));const id=`log-${now()}-${crypto.randomUUID()}`;atomicWrite(path.join(area('logs'),`${id}.json`),content,dataDir);return {id,cleanup:cleanup()};}
        case 'readMockFile':{const file=scopedInput(payload.path),stats=fs.statSync(file);if(!stats.isFile())fail('VALIDATION','Choose a regular file.');return runtime.parseDataFile(fs.readFileSync(file),path.basename(file),{xlsx:require('../../assets/vendor/xlsx.full.min.js')});}
        case 'previewMockPlan':return runtime.buildSuiteExecutionPlan(payload.suite,payload.inputs||{});
        default:fail('UNKNOWN_ACTION',`Unknown Machina workspace action: ${String(action)}`);
      }
    },
    close(){pending.clear();}
  };
}
module.exports={createMachinaWorkspace,normalizePolicy,DEFAULT_POLICY,noLinks,atomicWrite};
