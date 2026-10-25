'use strict';
/** Stable, explicitly granted extension contracts. Extensions cannot gain the Electron bridge. */
const API_VERSION=1;
const CAPABILITIES=Object.freeze(['test.adapter','artifact.read','dataset.validate','workflow.validate']);
function createExtensionHost(){const extensions=new Map();return Object.freeze({
  apiVersion:API_VERSION,capabilities:CAPABILITIES,
  register(manifest,implementation,granted=[]){
    if(manifest?.apiVersion!==API_VERSION||!/^[a-z][a-z0-9.-]{2,63}$/.test(manifest.id||'')||extensions.has(manifest.id))throw Error('Invalid or duplicate extension identity/API version.');
    if(!Array.isArray(manifest.capabilities)||manifest.capabilities.some(c=>!CAPABILITIES.includes(c)||!granted.includes(c)))throw Error('Extension capability has not been explicitly granted.');
    if(typeof implementation?.execute!=='function')throw Error('Extension execute method is required.');
    extensions.set(manifest.id,{manifest:structuredClone(manifest),implementation});return manifest.id;
  },
  list(){return [...extensions.values()].map(x=>structuredClone(x.manifest));},
  async invoke(id,capability,input,context={}){const e=extensions.get(id);if(!e||!e.manifest.capabilities.includes(capability))throw Error('Extension capability denied.');return e.implementation.execute(capability,structuredClone(input),Object.freeze({runId:context.runId,signal:context.signal}));},
  unregister(id){return extensions.delete(id);}
});}
module.exports={API_VERSION,CAPABILITIES,createExtensionHost};
