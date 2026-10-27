'use strict';
const reference = value => typeof value === 'string' && /^secret:[a-f0-9-]{36}$/i.test(value);
const secretField = /(?:api[_-]?(?:key|token)|password|passwd|token|secret|auth(?:orization|Header|Token)?|access[_-]?token|refresh[_-]?token|client[_-]?secret|webhook(?:Url|_url)?|private[_-]?key)$/i;
async function protectConfiguration(value, {storeSecret, decryptLegacy, label = 'Imported configuration'} = {}) {
  if (typeof storeSecret !== 'function') throw Error('Encrypted credential storage is unavailable.');
  async function store(text, location) {return (await storeSecret({label:label + location,value:text})).reference;}
  async function restoreLegacy(item,location=''){
    if(Array.isArray(item))return Promise.all(item.map((v,i)=>restoreLegacy(v,location+'['+i+']')));
    if(!item||typeof item!=='object')return item;
    if(item.__lvxEncrypted){
      if(item.__lvxEncrypted!==true||item.version!==1||typeof item.value!=='string'||!item.value)throw Error('Unsupported legacy encrypted credential at '+location+'. Re-enter this credential in the original configuration.');
      if(typeof decryptLegacy!=='function')throw Error('Legacy encrypted credential at '+location+' needs the desktop app and original OS account. Re-enter it if the original account is unavailable.');
      let text;try{text=await decryptLegacy(item.value);}catch{throw Error('Cannot decrypt the legacy credential at '+location+' with this OS account. Re-enter it; the import was not committed.');}
      if(typeof text!=='string'||!text)throw Error('Legacy credential at '+location+' is empty. Re-enter it before importing.');
      return location.includes('.firebaseConfig.')&&/\.apiKey$/i.test(location)?text:store(text,location);
    }
    const result={};for(const [key,v]of Object.entries(item))result[key]=await restoreLegacy(v,location+'.'+key);return result;
  }
  async function visit(item, location = '', parent = null, key = '') {
    if (Array.isArray(item)) return Promise.all(item.map((v,i)=>visit(v,location+'['+i+']',item,String(i))));
    if (item && typeof item === 'object') {
      let source = item;
      if (item.parameters && typeof item.parameters === 'object' && !Array.isArray(item.parameters)) {
        const schemaKey = item.parameter_schema ? 'parameter_schema' : 'parameterSchema';
        const schema = {...(item[schemaKey] || {})}, parameters = {...item.parameters};
        for (const [name,v] of Object.entries(parameters)) if (schema[name]?.secret === true || secretField.test(name) || reference(v) || reference(v?.secretRef)) {
          if (v && typeof v === 'object' && reference(v.secretRef)) parameters[name] = v;
          else if (typeof v === 'string') parameters[name] = {secretRef:reference(v) ? v : await store(v,location+'.parameters.'+name)};
          else throw Error('Secret parameter ' + name + ' must be text or a credential reference.');
          schema[name] = {...schema[name],type:'string',secret:true};
        }
        source = {...item,parameters,[schemaKey]:schema};
      }
      const result = {};
      for (const [k,v] of Object.entries(source)) result[k] = await visit(v,location+'.'+k,source,k);
      return result;
    }
    if (typeof item !== 'string' || !item || reference(item)) return item;
    if (/^[A-Za-z][\w-]*\s+secret:[a-f0-9-]{36}$/i.test(item)) return item;
    if (/^(?:headers|headersJson|headerJson|body|requestBody)$/i.test(key) && /^[\s]*[\[{]/.test(item)) {
      let parsed; try {parsed=JSON.parse(item);} catch {return item;}
      return JSON.stringify(await visit(parsed,location,parent,key));
    }
    const passwordStep = parent && /password|passwd|api[_-]?key|access[_-]?token/i.test(String(parent.selector || parent.name || parent.field || '')) && ['value','expected','text'].includes(key) && /fill|input|type/i.test(String(parent.action || parent.type || ''));
    const headerValue = key === 'value' && parent && secretField.test(parent.key || parent.name || '');
    if (!location.includes('.firebaseConfig.') && (secretField.test(key) || headerValue || (key === 'value' && (parent?.secret === true || parent?.isSecret === true)) || passwordStep || /^https?:\/\/[^/]*:[^/]*@/i.test(item))) return store(item,location);
    return item;
  }
  return visit(await restoreLegacy(value));
}
module.exports = {protectConfiguration,secretField,reference};
