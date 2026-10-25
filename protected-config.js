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
      const stored=reference(v)?{reference:v}:await invoke('security','storeSecret',{label:(label+path+'.parameters.'+name).slice(0,120),value:v});parameters[name]={secretRef:stored.reference};schema[name]={...schema[name],type:'string',secret:true};changed=true;
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
   if(!publicFirebase&&(secretField.test(key)||(key==='value'&&secretField.test(parent?.key||parent?.name||''))||(key==='value'&&(parent?.secret===true||parent?.isSecret===true))||passwordStep||/^https?:\/\/[^/]*:[^/]*@/i.test(item))){const stored=await invoke('security','storeSecret',{label:(label+path).slice(0,120),value:item});return stored.reference;}
   return item;
  }
  return visit(value);
 }
 async function request(url,options={}){
  const headers=Object.fromEntries(new Headers(options.headers||{}).entries());
  const body=options.body==null?undefined:String(options.body);
  const hasReference=REFERENCE_TEST(String(url))||REFERENCE_TEST(JSON.stringify(headers))||REFERENCE_TEST(body||'');
  if(!hasReference)return fetch(url,options);
  if(options.signal?.aborted)throw new DOMException('The request was cancelled.','AbortError');
  const requestId=crypto.randomUUID();
  const payload={requestId,url:String(url),method:options.method||'GET',headers,timeoutMs:Number(options.timeout||30000),...(body!==undefined?{body}:{})};
  const pending=invoke('host','request',payload);let abort;
  try{const result=options.signal?await Promise.race([pending,new Promise((_,reject)=>{abort=()=>{void invoke('host','cancelRequest',{requestId}).catch(()=>{});reject(new DOMException('The request was cancelled.','AbortError'));};options.signal.addEventListener('abort',abort,{once:true});if(options.signal.aborted)abort();})]):await pending;return new Response([204,205,304].includes(result.status)?null:result.body,{status:result.status,statusText:result.statusText,headers:result.headers});}
  finally{if(abort)options.signal.removeEventListener('abort',abort);}
 }
 function REFERENCE_TEST(value){return /secret:[a-f0-9-]{36}/.test(value);}
 async function migrate(keys=['execution_config','storage_config','cicd_backend_config','notification_integrations','lvx_pipelines','lvx_unit_tests','sharing_backend_config','test_environments']){
  if(!window.electronAPI?.studioOps)return {migrated:0,desktop:false};
  if(localStorage.length!==undefined)for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(/^(?:versions_|suite_versions_)/.test(key)&&!keys.includes(key))keys.push(key);}
  let migrated=0;const errors=[];
  for(const key of keys){const original=localStorage.getItem(key);if(!original)continue;try{const protectedValue=JSON.stringify(await protect(JSON.parse(original),key));if(protectedValue!==original){localStorage.setItem(key,protectedValue);migrated++;}}catch(error){errors.push({key,message:error.message});}}
  if(errors.length){const error=new Error('Some saved credentials could not be protected. Open Setup & diagnostics before using saved connections.');error.details=errors;throw error;}
  return {migrated,desktop:true};
 }
 window.LVXCredentials=Object.freeze({protect,request,migrate,isReference:reference});
})();
