'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const boundaries=require('./boundaries.cjs');
const {inventory}=require('./inventory.cjs');
const {scanSource,fingerprint,RULES}=require('./source-scanner.cjs');
const {severityOf}=require('./severity.cjs');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function atomicWrite(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+crypto.randomUUID()+'.tmp';let fd;try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(value,null,2));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,file);}finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);}}
function readState(file,fallback){if(!fs.existsSync(file))return fallback;try{if(fs.statSync(file).size>16*1024*1024)throw new Error('Too large');return JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error('Security state is corrupt; restore its backup before continuing');}}
function createService({dataDir,workspaceRoot=null,safeStorage,emit=()=>{},fetch:fetchImpl=globalThis.fetch}={}){
  if(!dataDir)throw new Error('A private security data directory is required');
  dataDir=path.resolve(dataDir,'security');fs.mkdirSync(dataDir,{recursive:true});
  const vaultFile=path.join(dataDir,'credentials.json'),trustFile=path.join(dataDir,'trust.json'),suppressionFile=path.join(dataDir,'suppressions.json'),adapterDir=path.join(dataDir,'adapters');
  let vault=readState(vaultFile,{schemaVersion:1,secrets:[]}),trust=readState(trustFile,{schemaVersion:1,workspaces:{}}),suppressions=readState(suppressionFile,{schemaVersion:1,items:[]});
  if(vault?.schemaVersion!==1||!Array.isArray(vault.secrets)||vault.secrets.some(item=>typeof item.reference!=='string'||!item.reference.startsWith('secret:')||typeof item.ciphertext!=='string')||trust?.schemaVersion!==1||!trust.workspaces||typeof trust.workspaces!=='object'||Array.isArray(trust.workspaces)||suppressions?.schemaVersion!==1||!Array.isArray(suppressions.items))throw new Error('Security state schema is invalid; recover the private security data before continuing');
  const knownSecrets=new Set();
  const canonical=()=>workspaceRoot?fs.realpathSync(workspaceRoot):null;
  const workspaceKey=()=>canonical()?hash(canonical()):null;
  const credentialState=()=>{
    try { const available=safeStorage?.isEncryptionAvailable?.()===true; const backend=safeStorage?.getSelectedStorageBackend?.()||process.platform;return {available:available&&backend!=='basic_text',backend,reason:!available?'Operating-system encryption is unavailable':backend==='basic_text'?'Unprotected basic_text storage is refused':null}; }
    catch { return {available:false,backend:'unavailable',reason:'Operating-system encryption is unavailable'}; }
  };
  const requireEncryption=()=>{const state=credentialState();if(!state.available)throw new Error(state.reason);};
  const resolveSecret=reference=>{requireEncryption();const item=vault.secrets.find(item=>item.reference===reference);if(!item)throw new Error('Secret reference is unavailable');const value=safeStorage.decryptString(Buffer.from(item.ciphertext,'base64'));knownSecrets.add(value);return value;};
  // Never serialize ciphertext or original secrets through diagnostics, archives or logs.
  const redact=value=>{
    const walk=(item,key='',parentKey='')=>{
      const credentialStatus=key==='credentials'&&item&&typeof item==='object'&&typeof item.available==='boolean'&&Object.keys(item).every(name=>['available','backend','reason'].includes(name));
      const opaque=typeof item==='string'&&/^secret:[a-f0-9-]{36}$/.test(item)||item&&typeof item==='object'&&Object.keys(item).length===1&&typeof item.secretRef==='string'&&/^secret:[a-f0-9-]{36}$/.test(item.secretRef);
      const secretSchema=key==='secret'&&typeof item==='boolean';
      const schemaField=['parameterSchema','parameter_schema','schema'].includes(parentKey);
      if(!credentialStatus&&!opaque&&!secretSchema&&!schemaField&&/^(?:api[_-]?key|password|passwd|token|secret|authorization|ciphertext|credentials)$/i.test(key))return '[REDACTED]';
      if(Array.isArray(item))return item.map(value=>walk(value));
      if(item&&typeof item==='object')return Object.fromEntries(Object.entries(item).map(([k,v])=>[k,walk(v,k,key)]));
      if(typeof item!=='string')return item;
      let text=item;for(const secret of knownSecrets)if(secret)text=text.split(secret).join('[REDACTED]');
      const refs=[];text=text.replace(/secret:[a-f0-9-]{36}/g,ref=>{refs.push(ref);return 'LVXOPAQUEREF'+(refs.length-1)+'END';});
      return text.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1[REDACTED]@').replace(/((?:password|api[_-]?key|token|secret)\s*[:=]\s*)(?:["'][^"']*["']|[^\s,;}]+)/gi,'$1[REDACTED]').replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk_(?:live|test)_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/g,'[REDACTED]').replace(/LVXOPAQUEREF(\d+)END/g,(_,i)=>refs[Number(i)]||'[REDACTED]');
    };return walk(value);
  };
  // Rehydrate only in memory so old credentials are redacted after an application restart.
  if(credentialState().available)for(const item of vault.secrets){try{resolveSecret(item.reference);}catch{/* Locked/corrupt entries remain unavailable, never silently replaced. */}}
  const assertTrusted=(payload={})=>{
    const key=workspaceKey();if(!key||trust.workspaces[key]?.trusted!==true)throw new Error('Trust the selected workspace before running executable operations');
    if(payload.imported===true||payload.importedWorkflowId){const id=payload.importedWorkflowId||payload.workflowTrustId;const imports=trust.workspaces[key].imports;if(!id||!imports||!Object.hasOwn(imports,id)||!imports[id])throw new Error('Review and explicitly trust this imported executable workflow');}
    if(payload.workspaceRoot && fs.realpathSync(payload.workspaceRoot)!==canonical())throw new Error('Operation workspace differs from the selected workspace');
    return true;
  };
  const adapterManifest=()=>{const file=path.join(adapterDir,'local-config-v1','manifest.json');if(!fs.existsSync(file))return null;const manifest=readState(file,null);const entry=path.join(adapterDir,'local-config-v1','adapter.cjs');if(manifest?.id!=='local-config-v1'||manifest.version!=='1.0.0'||hash(fs.readFileSync(entry))!==manifest.sha256)throw new Error('Installed adapter integrity check failed; reinstall it');return {...manifest,entry};};
  const adapters=()=>{let installed=null,error=null;try{installed=adapterManifest();}catch(e){error=e.message;}return [{id:'local-config-v1',version:'1.0.0',installed:!!installed,error,modes:['dockerfile','kubernetes','docker-container','endpoint'],description:'Explicit local Docker/Kubernetes configuration rules, Docker inspect and authorized HTTP response headers'}];};
  const runAdapter=async payload=>{
    assertTrusted(payload);if(payload.adapterId!=='local-config-v1')throw new Error('Select an installed infrastructure adapter');
    const manifest=adapterManifest();if(!manifest)throw new Error('Install the local-config-v1 adapter first');
    const mode=payload.mode||'dockerfile';let target=payload.target;
    if(typeof target!=='string'||!target)throw new Error('An explicit infrastructure target is required');
    // Authorization values are exact targets selected in this request. No wildcard, automatic discovery or redirect expansion.
    if(!Array.isArray(payload.authorizedTargets)||!payload.authorizedTargets.includes(target))throw new Error('Explicit target authorization is required');
    if(['dockerfile','kubernetes'].includes(mode))target=boundaries.assertScopedPath(canonical(),target);
    else if(mode==='endpoint'){const url=new URL(target);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Use a credential-free HTTP(S) target');}
    else if(mode!=='docker-container')throw new Error('Unsupported infrastructure adapter mode');
    payload.signal?.throwIfAborted();
    const result=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[manifest.entry],{windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},cwd:canonical()});let stdout='',stderr='',settled=false,terminating=false;
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);payload.signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(value);};
      const terminate=error=>{if(terminating||settled)return;terminating=true;require('../process-control.cjs').stopProcessTree(child).then(()=>finish(error),finish);};
      const abort=()=>terminate(new Error('Infrastructure adapter cancelled'));
      const timer=setTimeout(()=>terminate(new Error('Infrastructure adapter timed out')),20000);
      payload.signal?.addEventListener('abort',abort,{once:true});if(payload.signal?.aborted)abort();
      child.stdout.on('data',data=>{stdout+=data;if(stdout.length>8*1024*1024){terminate(new Error('Infrastructure adapter output exceeded the limit'));}});
      child.stderr.on('data',data=>{stderr+=data;if(stderr.length>1024*1024){terminate(new Error('Infrastructure adapter error output exceeded the limit'));}});
      child.on('error',error=>finish(new Error(redact(error.message))));child.on('close',()=>{if(terminating)return;try{const value=JSON.parse(stdout);if(!Array.isArray(value.findings)||!Array.isArray(value.errors)||typeof value.coverage?.complete!=='boolean')throw new Error('Adapter result schema is invalid');finish(null,value);}catch{finish(new Error('Infrastructure adapter returned invalid structured evidence'));}});
      child.stdin.on('error',error=>finish(new Error('Infrastructure adapter input failed')));child.stdin.end(JSON.stringify({mode,target}));
    });
    for(const finding of result.findings){finding.path=payload.target;finding.fingerprint=fingerprint(finding);}return result;
  };
  const applySuppressions=result=>{
    const now=Date.now(),key=workspaceKey();
    result.findings=(result.findings||[]).map(finding=>{const match=suppressions.items.find(item=>item.workspaceKey===key&&item.fingerprint===finding.fingerprint&&Date.parse(item.expiresAt)>now);return match?{...finding,suppression:{id:match.id,reason:match.reason,reviewer:match.reviewer,expiresAt:match.expiresAt},suppressed:true}:finding;});
    result.summary={total:result.findings.length,active:result.findings.filter(v=>!v.suppressed).length,suppressed:result.findings.filter(v=>v.suppressed).length};
    if(result.coverage?.complete)result.status=result.summary.active?'FAILURE':'SUCCESS';else result.status='ERROR';
    return redact(result);
  };
  const readInventory=payload=>{let format=payload.format,content=payload.content;if(payload.path){const file=boundaries.assertScopedPath(canonical(),payload.path);if(fs.statSync(file).size>32*1024*1024)throw new Error('Inventory file exceeds 32 MiB');content=fs.readFileSync(file,'utf8');if(!format){const name=path.basename(file).toLowerCase();format=name==='package-lock.json'?'package-lock':name==='pnpm-lock.yaml'?'pnpm':name==='yarn.lock'?'yarn':name==='poetry.lock'?'poetry':name==='uv.lock'?'uv':name.endsWith('.json')?'cyclonedx':'requirements';}}return inventory(content,format);};
  async function dependencyScan(payload){
    const resolved=readInventory(payload),findings=[],lookups=[],errors=resolved.unresolved.map(item=>`${item.name}: ${item.reason}`);
    // Every resolved package gets explicit success/error evidence. Failures never erase successful findings.
    for(const pkg of resolved.packages){
      payload.signal?.throwIfAborted();
      try{
        const response=await fetchImpl('https://api.osv.dev/v1/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({package:{name:pkg.name,ecosystem:pkg.ecosystem},version:pkg.version}),signal:payload.signal?AbortSignal.any([payload.signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
        if(!response.ok)throw new Error(`OSV HTTP ${response.status}`);const body=await response.json();if(!body||typeof body!=='object'||Array.isArray(body)||(body.vulns!==undefined&&!Array.isArray(body.vulns)))throw new Error('Invalid OSV response');
        if((body.vulns||[]).some(vuln=>!vuln||typeof vuln.id!=='string'||(vuln.references!==undefined&&!Array.isArray(vuln.references))))throw new Error('OSV finding schema is invalid');
        const packageFindings=[];
        for(const vuln of body.vulns||[]){const finding={ruleId:vuln.id,severity:severityOf(vuln),message:String(vuln.summary||vuln.id),package:pkg,path:payload.path||payload.format,line:1,scanner:'osv-v1',references:(vuln.references||[]).filter(ref=>/^https:\/\//.test(ref?.url||'')).map(ref=>ref.url)};finding.fingerprint=hash(`${vuln.id}\0${pkg.id}`);if(!packageFindings.some(item=>item.fingerprint===finding.fingerprint))packageFindings.push(finding);}
        findings.push(...packageFindings);lookups.push({package:pkg.id,status:'SUCCESS',vulnerabilities:packageFindings.length});
      }catch(error){payload.signal?.throwIfAborted();lookups.push({package:pkg.id,status:'ERROR',error:redact(error.message)});errors.push(`${pkg.id}: ${redact(error.message)}`);}
    }
    return {schemaVersion:1,findings,errors,inventory:resolved,coverage:{complete:!errors.length&&resolved.coverage.complete,total:resolved.coverage.total,queried:lookups.filter(item=>item.status==='SUCCESS').length,lookups,sourceSha256:resolved.sourceSha256,limitations:['OSV findings cover known reported vulnerabilities at query time, not all possible risks.']}};
  }
  async function handle(action,payload={}){
    const {signal,...serializable}=payload;
    boundaries.validatePayload(serializable);
    if(signal!==undefined && !(signal instanceof AbortSignal))throw Error('Invalid native cancellation signal');
    if(action==='status')return {schemaVersion:1,workspace:canonical(),trusted:!!(workspaceKey()&&trust.workspaces[workspaceKey()]?.trusted),credentials:credentialState(),adapters:adapters(),sourceRules:RULES};
    if(action==='trust'){
      const key=workspaceKey();if(!key)throw new Error('Choose a workspace first');if(typeof payload.trusted!=='boolean')throw new Error('Explicit trust choice required');
      const record=structuredClone(trust.workspaces[key]||{trusted:false,imports:{}});
      if(payload.importedWorkflowId){if(typeof payload.importedWorkflowId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(payload.importedWorkflowId)||['__proto__','constructor','prototype'].includes(payload.importedWorkflowId))throw new Error('Invalid imported workflow identifier');if(payload.trusted)record.imports[payload.importedWorkflowId]={trustedAt:new Date().toISOString()};else delete record.imports[payload.importedWorkflowId];}
      else {record.trusted=payload.trusted;if(!record.trusted)record.imports={};}const next={...trust,workspaces:{...trust.workspaces,[key]:record}};atomicWrite(trustFile,next);trust=next;return {trusted:record.trusted,importedWorkflowId:payload.importedWorkflowId||null};
    }
    if(action==='storeSecret'){
      requireEncryption();if(typeof payload.value!=='string'||!payload.value||payload.value.length>64*1024)throw new Error('Secret must contain 1–65536 characters');
      if(typeof payload.label!=='string'||!payload.label.trim()||payload.label.length>120)throw new Error('Use a label of 1–120 characters');
      if(payload.value.length>=8&&payload.label.includes(payload.value))throw new Error('Use a descriptive label that does not contain the credential value');
      const reference='secret:'+crypto.randomUUID(),createdAt=new Date().toISOString();
      const next={...vault,secrets:[...vault.secrets,{reference,label:payload.label.trim(),ciphertext:safeStorage.encryptString(payload.value).toString('base64'),createdAt}]};atomicWrite(vaultFile,next);vault=next;knownSecrets.add(payload.value);return {reference,label:payload.label.trim(),createdAt};
    }
    if(action==='listSecrets')return vault.secrets.map(({reference,label,createdAt})=>({reference,label,createdAt}));
    if(action==='deleteSecret'){const index=vault.secrets.findIndex(item=>item.reference===payload.reference);if(index<0)throw new Error('Secret reference is unavailable');const next={...vault,secrets:vault.secrets.filter((item,i)=>i!==index)};atomicWrite(vaultFile,next);vault=next;return {deleted:true};}
    if(action==='inventory')return readInventory(payload);
    if(action==='adapters')return adapters();
    if(action==='installAdapter'){
      assertTrusted(payload);if(payload.id!=='local-config-v1')throw new Error('Unknown adapter; only the reviewed bundled adapter local-config-v1 is supported');
      const source=fs.readFileSync(path.join(__dirname,'adapters/local-config-v1.cjs')),destination=path.join(adapterDir,payload.id);fs.mkdirSync(destination,{recursive:true});fs.writeFileSync(path.join(destination,'adapter.cjs'),source,{mode:0o600});atomicWrite(path.join(destination,'manifest.json'),{schemaVersion:1,id:payload.id,version:'1.0.0',sha256:hash(source)});return adapters()[0];
    }
    if(action==='scan'){
      let result;
      if(payload.kind==='source'){
        const files=payload.files||[{path:payload.path}];if(!Array.isArray(files)||files.length>500)throw new Error('Select 1–500 files per scan');
        result=scanSource(files.map(file=>{if(file.content!==undefined)return file;const name=boundaries.assertScopedPath(canonical(),file.path);if(fs.statSync(name).size>2*1024*1024)return {...file,content:null};return {...file,content:fs.readFileSync(name,'utf8')};}));
      }else if(payload.kind==='dependencies')result=await dependencyScan(payload);
      else if(payload.kind==='infrastructure')result=await runAdapter(payload);
      else throw new Error('Choose source, dependencies or infrastructure scanning');
      result.id=crypto.randomUUID();result.timestamp=new Date().toISOString();result=applySuppressions(result);emit({domain:'security',type:'scan',id:result.id,status:result.status,summary:result.summary});return result;
    }
    if(action==='suppressions')return suppressions.items.filter(item=>item.workspaceKey===workspaceKey()).map(({workspaceKey,...item})=>({...item,expired:Date.parse(item.expiresAt)<=Date.now()}));
    if(action==='saveSuppression'){
      assertTrusted(payload);if(!/^[a-f0-9]{64}$/.test(payload.fingerprint||''))throw new Error('A finding fingerprint is required');
      if(typeof payload.reason!=='string'||payload.reason.trim().length<8||payload.reason.length>2000||typeof payload.reviewer!=='string'||payload.reviewer.trim().length<3||payload.reviewer.length>120)throw new Error('A review reason (8+ characters) and reviewer (3+ characters) are required');
      const expires=Date.parse(payload.expiresAt);if(!Number.isFinite(expires)||expires<=Date.now()||expires>Date.now()+180*86400000)throw new Error('Suppression expiry must be in the next 180 days');
      const item={id:crypto.randomUUID(),workspaceKey:workspaceKey(),fingerprint:payload.fingerprint,reason:payload.reason.trim(),reviewer:payload.reviewer.trim(),expiresAt:new Date(expires).toISOString(),reviewedAt:new Date().toISOString()};const next={...suppressions,items:[...suppressions.items.filter(old=>old.workspaceKey!==item.workspaceKey||old.fingerprint!==item.fingerprint),item]};atomicWrite(suppressionFile,next);suppressions=next;return redact(item);
    }
    if(action==='diagnostics')return redact({schemaVersion:1,workspaceSelected:!!canonical(),trust:!!(workspaceKey()&&trust.workspaces[workspaceKey()]?.trusted),credentials:credentialState(),secretCount:vault.secrets.length,adapters:adapters(),supportedRules:RULES,previewPolicy:boundaries.createPreviewPolicy().contentSecurityPolicy,limits:{sourceFiles:500,sourceFileBytes:2*1024*1024,inventoryBytes:32*1024*1024}});
    throw new Error('Unknown security action');
  }
  return {handle,resolveSecret,redact,assertTrusted,setWorkspace(root){workspaceRoot=root?fs.realpathSync(root):null;},close(){knownSecrets.clear();}};
}
module.exports={createService,...boundaries,inventory};
