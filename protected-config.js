/** Encryption references stay in the renderer; only the main process resolves them. */
(() => {
 const reference=value=>typeof value==='string'&&/^secret:[a-f0-9-]{36}$/.test(value);
 const secretField=/(?:api[_-]?(?:key|token)|password|passwd|token|secret|auth(?:orization|Header|Token)?|access[_-]?token|refresh[_-]?token|client[_-]?secret|jdoodleClientSecret|webhook(?:Url|_url)?|private[_-]?key)$/i;
 async function invoke(domain,action,payload){const api=window.electronAPI?.studioOps;if(!api)throw Error('Use the desktop app to store or use encrypted credentials.');const result=await(api.invokeRaw||api.invoke)(domain,action,payload);if(result?.__lvxError){const e=new Error(result.__lvxError.message);e.code=result.__lvxError.code;e.details=result.__lvxError.details;throw e;}return result;}
 async function protect(value,label='Configuration'){
  if(JSON.stringify(value).includes('\"__lvxEncrypted\"'))return invoke('host','protectConfiguration',{value,label});
  async function visit(item,path='',parent=null,key=''){
   if(Array.isArray(item))return Promise.all(item.map((v,i)=>visit(v,path+'['+i+']',item,String(i))));
   if(item&&typeof item==='object'){
    let source=item;
    if(item.parameters&&typeof item.parameters==='object'&&!Array.isArray(item.parameters)){
     const schemaKey=item.parameter_schema?'parameter_schema':'parameterSchema',schema={...(item[schemaKey]||{})},parameters={...item.parameters};let changed=false;
     for(const [name,v]of Object.entries(parameters))if(schema[name]?.secret===true||secretField.test(name)||reference(v)||reference(v?.secretRef)){
      if(v&&typeof v==='object'&&reference(v.secretRef)){schema[name]={...schema[name],type:'string',secret:true};changed=true;continue;}
      if(typeof v!=='string')throw Error('Secret parameter '+name+' must be a credential reference or text to encrypt.');
      const stored=reference(v)?{reference:v}:await invoke('security','storeSecret',{label:(label+path+'.parameters.'+name),value:v});parameters[name]={secretRef:stored.reference};schema[name]={...schema[name],type:'string',secret:true};changed=true;
     }
     if(changed)source={...item,parameters,[schemaKey]:schema};
    }
    const result={};for(const [k,v]of Object.entries(source))result[k]=await visit(v,path+'.'+k,source,k);return result;
   }
   if(typeof item!=='string'||!item||reference(item))return item;
   if(/^[A-Za-z][\w-]*\s+secret:[a-f0-9-]{36}$/i.test(item))return item;
   if(/^(?:headers|headersJson|headerJson|body|requestBody)$/i.test(key)&&/^[\s]*[\[{]/.test(item)){let parsed;try{parsed=JSON.parse(item);}catch{return item;}return JSON.stringify(await visit(parsed,path,parent,key));}
   const publicFirebase=path.includes('.firebaseConfig.');
   const passwordStep=parent&&/password|passwd|api[_-]?key|access[_-]?token/i.test(String(parent.selector||parent.name||parent.field||''))&&['value','expected','text'].includes(key)&&/fill|input|type/i.test(String(parent.action||parent.type||''));
   if(!publicFirebase&&(secretField.test(key)||(key==='value'&&secretField.test(parent?.key||parent?.name||''))||(key==='value'&&(parent?.secret===true||parent?.isSecret===true))||passwordStep||/^https?:\/\/[^/]*:[^/]*@/i.test(item))){const stored=await invoke('security','storeSecret',{label:(label+path),value:item});return stored.reference;}
   return item;
  }
  return visit(value);
 }
 async function request(url,options={}){
  const headers=Object.fromEntries(new Headers(options.headers||{}).entries());
  const body=options.body==null?undefined:String(options.body);
  const hasReference=REFERENCE_TEST(String(url))||REFERENCE_TEST(JSON.stringify(headers))||REFERENCE_TEST(body||'');
  if(!hasReference)return fetch(url,options);
  const unavailable=pendingIssues().find(issue=>[String(url),JSON.stringify(headers),body||''].some(value=>value.includes(issue.reference)));
  if(unavailable)throw Error('The saved sign-in for '+unavailable.label+' needs re-entry. Open Repair saved connection. Your other connections are available.');
  if(options.signal?.aborted)throw new DOMException('The request was cancelled.','AbortError');
  const requestId=crypto.randomUUID();
  const payload={requestId,url:String(url),method:options.method||'GET',headers,timeoutMs:Number(options.timeout??0),...(body!==undefined?{body}:{})};
  const pending=invoke('host','request',payload);let abort;
  try{const result=options.signal?await Promise.race([pending,new Promise((_,reject)=>{abort=()=>{void invoke('host','cancelRequest',{requestId}).catch(()=>{});reject(new DOMException('The request was cancelled.','AbortError'));};options.signal.addEventListener('abort',abort,{once:true});if(options.signal.aborted)abort();})]):await pending;return new Response([204,205,304].includes(result.status)?null:result.body,{status:result.status,statusText:result.statusText,headers:result.headers});}
  finally{if(abort)options.signal.removeEventListener('abort',abort);}
 }
 function REFERENCE_TEST(value){return /secret:[a-f0-9-]{36}/.test(value);}
 const recoveryKey='lvx_credential_recovery';
 function recoveryRecords(){try{return JSON.parse(localStorage.getItem(recoveryKey)||'[]');}catch{return [];}}
 function saveRecovery(records){localStorage.setItem(recoveryKey,JSON.stringify(records));}
 function atPath(value,path){for(const part of path)value=value?.[part];return value;}
 function setPath(value,path,next){let target=value;for(const part of path.slice(0,-1))target=target[part];target[path.at(-1)]=next;}
 function referencePaths(value,reference,path=[]){if(value===reference)return [path];if(!value||typeof value!=='object')return [];return Object.entries(value).flatMap(([key,child])=>referencePaths(child,reference,[...path,key]));}
 function pendingIssues(){return recoveryRecords().filter(record=>{if(record.resolvedAt)return false;try{return referencePaths(JSON.parse(localStorage.getItem(record.storageKey)),record.reference).length>0;}catch{return false;}}).map(({encrypted,...record})=>record);}
 function emit(name){window.dispatchEvent?.(typeof Event==='function'?new Event(name):{type:name});}
 function publishIssues(){window.LVXCredentialIssues=pendingIssues();emit('lvx-credential-issues');}
 async function recoverLegacy(value,key){
  const issues=recoveryRecords();
  async function walk(item,path=[],labels=[]){
   if(item&&typeof item==='object'&&item.__lvxEncrypted){
    try{return await protect(item,key+'.'+path.join('.'));}catch(error){
     if(!/legacy.*credential|credential.*legacy/i.test(error.message))throw error;
     const id=crypto.randomUUID(),reference='secret:'+id;
     issues.push({id,reference,storageKey:key,path,label:[...labels,path.at(-1)||'Saved sign-in'].filter(Boolean).join(' / '),encrypted:structuredClone(item),createdAt:new Date().toISOString()});
     return reference;
    }
   }
   if(Array.isArray(item)){const result=[];for(let i=0;i<item.length;i++)result.push(await walk(item[i],[...path,i],labels));return result;}
   if(item&&typeof item==='object'){const result={},nextLabels=item.name?[...labels,String(item.name)]:labels;for(const [field,child]of Object.entries(item))result[field]=await walk(child,[...path,field],nextLabels);return result;}
   return item;
  }
  const result=await walk(value);
  // Stage recovery metadata until protection and the settings revision check succeed.
  return {value:result,issues};
 }
 async function repair(id,replacement,{retryOriginal=false,forget=false}={}){
  const records=recoveryRecords(),record=records.find(item=>item.id===id&&!item.resolvedAt);if(!record)throw Error('This saved connection has already been repaired. Refresh the list.');
  const original=localStorage.getItem(record.storageKey);if(!original)throw Error('The saved connection no longer exists.');let value=JSON.parse(original);const locations=referencePaths(value,record.reference);
  if(!locations.length)throw Error('This connection changed. Refresh the list before repairing it.');
  let next='';
  if(retryOriginal)next=await protect(record.encrypted,record.label);
  else if(!forget){if(typeof replacement!=='string'||!replacement.trim())throw Error('Enter the replacement credential, or choose Forget saved sign-in.');next=(await invoke('security','storeSecret',{label:record.label,value:replacement})).reference;}
  if(localStorage.getItem(record.storageKey)!==original)throw Error('This connection changed while it was being repaired. Try again; the newer settings were preserved.');
  for(const location of locations){if(location.length)setPath(value,location,next);else value=next;}localStorage.setItem(record.storageKey,JSON.stringify(value));record.resolvedAt=new Date().toISOString();saveRecovery(records);publishIssues();emit('lvx-credentials-migrated');return {repaired:true,forgotten:forget,updatedReferences:locations.length};
 }
 async function migrate(keys=['execution_config','storage_config','cicd_backend_config','notification_integrations','lvx_pipelines','lvx_unit_tests','sharing_backend_config','test_environments']){
  if(!window.electronAPI?.studioOps)return {migrated:0,desktop:false};
  if(localStorage.length!==undefined)for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(/^(?:versions_|suite_versions_)/.test(key)&&!keys.includes(key))keys.push(key);}
  let migrated=0;const errors=[];
  for(const key of keys){const original=localStorage.getItem(key);if(!original)continue;try{let value=JSON.parse(original),safe,recovery;try{safe=await protect(value,key);}catch(error){if(!JSON.stringify(value).includes('"__lvxEncrypted"'))throw error;recovery=await recoverLegacy(value,key);safe=await protect(recovery.value,key);}const protectedValue=JSON.stringify(safe);if(localStorage.getItem(key)!==original)throw Error('Settings changed while saved sign-ins were being upgraded. Retry to preserve the newer settings.');if(protectedValue!==original){if(recovery)saveRecovery(recovery.issues);localStorage.setItem(key,protectedValue);migrated++;}}catch(error){errors.push({key,message:error.message});}}
  publishIssues();
  if(errors.length){const error=new Error('Some saved credentials could not be protected. Open Setup & diagnostics before using saved connections.');error.details=errors;throw error;}
  return {migrated,desktop:true,issues:pendingIssues()};
 }
 window.LVXCredentials=Object.freeze({protect,request,migrate,repair,issues:pendingIssues,isReference:reference});
})();
