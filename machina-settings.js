/* Explicit review/application of imported device settings. Nothing connects on import. */
(() => {
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const labels={notification_integrations:'Notification destinations',execution_config:'Execution settings',storage_config:'Classic storage connection settings',sharing_backend_config:'Sharing connection settings',cicd_backend_config:'CI connection settings',lvx_storage_preferences:'Storage retention policies',storagePreferences:'Storage retention policies'};
 function mount(container,{invoke}={}){
  let disposed=false,records=[],environments=[],dialog,refreshVersion=0;
  const status=(message,error=false)=>{if(disposed)return;const el=container.querySelector('[data-import-settings-status]');el.textContent=message;el.setAttribute('role',error?'alert':'status');};
  const ready=refresh();
  async function refresh(){
   const version=++refreshVersion;const [configs,envs]=await Promise.all([invoke('list',{collection:'legacy-config'}),invoke('list',{collection:'environments'})]);if(disposed||version!==refreshVersion)return;records=configs.records||configs;environments=(envs.records||envs).filter(r=>r.value.importedFrom&&!r.value.deviceAppliedAt);
   container.innerHTML='<section class="studio-section"><h3>Imported settings</h3><p>Review settings before applying them to this device. Importing never connects to a remote service. Previous connection settings are saved as a protected recovery record.</p><p data-import-settings-status role="status"></p><ul class="studio-record-list">'+records.map(r=>'<li><span><strong>'+esc(labels[r.value.key]||r.value.key)+'</strong><small>'+esc(r.value.appliedAt?'Applied '+r.value.appliedAt:'Awaiting review')+'</small></span><button type="button" data-review-settings="'+esc(r.id)+'">Review settings</button></li>').join('')+'</ul>'+(environments.length?'<p>'+environments.length+' imported environment(s) can be added without replacing existing environments.</p><button type="button" data-import-environments>Add imported environments</button>':'')+(records.length||environments.length?'':'<p>No imported device settings.</p>')+'</section>';
  }
  async function apply(record){
   const {key}=record.value;if(!Object.hasOwn(labels,key))throw Error('This configuration kind is preserved as a draft. Configure it through the matching settings editor.');
   const value=await window.LVXCredentials.protect(record.value.value,'Imported '+key);
   if(!value||typeof value!=='object')throw Error('The imported settings need a configuration object.');
   if(key==='execution_config'&&value.mode&&value.mode!=='real')throw Error('Choose real execution in the execution settings editor. A simulation cannot be restored as a passing native run.');
   if(key==='notification_integrations'&&!Array.isArray(value))throw Error('Notification settings must be a list of destinations.');
   if(key==='storage_config'&&!['localStorage','firebase','customApi'].includes(value.type))throw Error('Choose a supported classic storage type in Settings. The current SQLite workspace remains active.');
   const stamp=new Date().toISOString(),backupId=crypto.randomUUID();
   if(['lvx_storage_preferences','storagePreferences'].includes(key)){
    const oldCategory=await invoke('retention:getPreferences'),oldManaged=await invoke('machina:getRetention');
    await invoke('transact',{records:[{collection:'device-config-backups',id:backupId,expectedRevision:null,value:{key,createdAt:stamp,category:oldCategory.preferences,managed:oldManaged.policy}}]});
    const saved=await invoke('retention:setPreferences',{preferences:value,expectedRevision:oldCategory.revision});
    try{await invoke('machina:setRetention',{policy:{mode:value.mode==='unlimited'?'unlimited':'custom',sessionRetention:value.sessionRetention,logRetention:value.logRetention},expectedRevision:oldManaged.revision});}
    catch(error){await invoke('retention:setPreferences',{preferences:oldCategory.preferences,expectedRevision:saved.revision});throw error;}
   }else{
    const previous=localStorage.getItem(key);let backup;try{backup=previous===null?null:JSON.parse(previous);}catch{throw Error('The current device settings are malformed. Repair them before replacing them.');}
    await invoke('transact',{records:[{collection:'device-config-backups',id:backupId,expectedRevision:null,value:{key,createdAt:stamp,value:await window.LVXCredentials.protect(backup,'Previous '+key)}}]});
    localStorage.setItem(key,JSON.stringify(value));
    try{await mark(record,stamp,backupId);}catch(error){if(previous===null)localStorage.removeItem(key);else localStorage.setItem(key,previous);throw error;}
    if(key==='execution_config')window.loadExecutionConfig();
    return key==='storage_config'?'Classic connection preferences saved. The current SQLite workspace stays active; use Settings to connect explicitly.':'Settings applied. Open their editor to inspect them; no remote connection was attempted.';
   }
   await mark(record,stamp,backupId);return 'Storage policies applied. Use Storage & cleanup to preview any removals.';
  }
  function mark(record,stamp,backupId){return invoke('transact',{records:[{collection:'legacy-config',id:record.id,expectedRevision:record.revision,value:{...record.value,applyRequired:false,appliedAt:stamp,deviceBackupId:backupId}}]});}
  function review(record){
   dialog?.remove();dialog=document.createElement('dialog');dialog.className='studio-machina-dialog';dialog.setAttribute('aria-label','Review imported settings');
   dialog.innerHTML='<h2>'+esc(labels[record.value.key]||record.value.key)+'</h2><p>Review these protected values. Applying replaces this device’s matching preferences. Your selected project remains active.</p><details open><summary>Imported configuration</summary><pre>'+esc(JSON.stringify(record.value.value,null,2))+'</pre></details><p data-setting-result role="status"></p><div class="studio-actions"><button type="button" data-confirm-settings>Apply reviewed settings</button><button type="button" data-close-settings>Cancel</button></div>';document.body.append(dialog);dialog.showModal();
   dialog.querySelector('[data-close-settings]').onclick=()=>{dialog.close();dialog.remove();};
   dialog.querySelector('[data-confirm-settings]').onclick=async event=>{event.target.disabled=true;const own=dialog;try{const message=await apply(record);if(disposed)return;own.close();own.remove();await refresh();status(message);}catch(error){if(own.isConnected){own.querySelector('[data-setting-result]').textContent=error.message;own.querySelector('[data-setting-result]').setAttribute('role','alert');event.target.disabled=false;}}};
  }
  async function click(event){const reviewButton=event.target.closest('[data-review-settings]');if(reviewButton){const record=records.find(r=>r.id===reviewButton.dataset.reviewSettings);if(record)review(record);return;}
   const button=event.target.closest('[data-import-environments]');if(!button)return;button.disabled=true;
   try{for(const record of environments){const value=await window.LVXCredentials.protect(record.value,'Imported environment'),existing=window.environmentManager.getAllEnvironments(),workspace=window.LVXStudio?.state.workspace?.workspaceRoot||'',prior=existing.find(e=>e.legacyImportRecordId===record.id&&e.legacyImportWorkspace===workspace);const id=prior?.id||(existing.some(e=>e.id===record.id)?crypto.randomUUID():record.id);if(!prior)await window.environmentManager.saveEnvironment({...value,id,legacyImportRecordId:record.id,legacyImportWorkspace:workspace});try{await invoke('transact',{records:[{collection:'environments',id:record.id,expectedRevision:record.revision,value:{...record.value,deviceAppliedAt:new Date().toISOString(),deviceEnvironmentId:id}}]});}catch(error){if(!prior)await window.environmentManager.deleteEnvironment(id);throw error;}}await refresh();status('Imported environments added. Existing environments were preserved.');}catch(error){status(error.message,true);}finally{if(button.isConnected)button.disabled=false;}
  }
  const unsubscribe=window.electronAPI?.studioOps?.onEvent(event=>{if(event.domain==='workspace'&&event.type==='changed'&&(event.changes||[]).some(change=>['legacy-config','environments'].includes(change.collection)))void refresh().catch(error=>status(error.message,true));});
  container.addEventListener('click',click);return {ready,unmount(){disposed=true;unsubscribe?.();dialog?.close();dialog?.remove();container.removeEventListener('click',click);container.innerHTML='';}};
 }
 window.LVXImportedSettings={mount};
})();
