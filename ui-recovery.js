/** Persistent recovery actions. Generated/user content is always plain text. */
export function recoveryDialog({title,description,actions,details=''}){
 return new Promise(resolve=>{
  const previous=document.activeElement,dialog=document.createElement('dialog');dialog.className='lvx-recovery-dialog';dialog.setAttribute('aria-label',title);
  const heading=document.createElement('h2');heading.textContent=title;const help=document.createElement('p');help.textContent=description;const status=document.createElement('p');status.setAttribute('role','alert');const footer=document.createElement('div');footer.className='studio-actions';dialog.append(heading,help);
  if(details){const extra=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('pre');summary.textContent='More details';text.textContent=details;extra.append(summary,text);dialog.append(extra);}
  const close=value=>{dialog.close();dialog.remove();if(previous?.isConnected)previous.focus({preventScroll:true});resolve(value);};
  for(const action of actions){const button=document.createElement('button');button.type='button';button.className='aero-button-'+(action.tone||'primary');button.textContent=action.label;button.dataset.recoveryAction=action.id;button.onclick=async()=>{const buttons=[...footer.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);status.textContent='';try{const result=await action.run?.();if(result!==false)close(action.id);}catch(error){status.textContent=error.message||String(error);}finally{buttons.forEach(b=>b.disabled=false);}};footer.append(button);}
  dialog.append(status,footer);dialog.addEventListener('cancel',event=>{event.preventDefault();if(!footer.querySelector('button:disabled'))close('stay');});document.body.append(dialog);dialog.showModal();footer.querySelector('[data-recovery-action="stay"]')?.focus();
 });
}

export async function recoverBoardNavigation(mount,destination){
 const info=mount.navigationState?.()||{boardDirty:!!mount.hasUnsavedChanges?.(),taskDirty:false,running:false};
 if(!info.boardDirty&&!info.taskDirty&&!info.running)return true;
 const pending=[info.boardDirty?'board changes':'',info.taskDirty?'work-plan changes':'',info.running?'running work':''].filter(Boolean).join(', ');
 const perform=choice=>async()=>{if(!mount.prepareLeave)throw Error('This board is still loading. Stay here and try again.');return await mount.prepareLeave(choice);};
 const result=await recoveryDialog({title:'Before you leave AI agents',description:'You have '+pending+'. Choose what to keep before opening '+destination+'. Your chats stay saved.',actions:[
  {id:'save',label:info.running?'Stop work, save and continue':'Save and continue',run:perform(info.running?'stop-save':'save'),tone:'success'},
  {id:'discard',label:info.running?'Stop work, discard drafts and continue':'Discard drafts and continue',run:perform(info.running?'stop-discard':'discard'),tone:'gray'},
  {id:'stay',label:'Stay here',run:()=>true,tone:'info'}
 ]});return result==='save'||result==='discard';
}

export function openCredentialRecovery(){
 const existing=document.querySelector('.lvx-credential-recovery');if(existing){existing.focus();return;}
 const previous=document.activeElement,dialog=document.createElement('dialog');dialog.className='lvx-recovery-dialog lvx-credential-recovery';dialog.setAttribute('aria-label','Repair saved connections');
 const heading=document.createElement('h2');heading.textContent='Repair saved connections';const help=document.createElement('p');help.textContent='These older saved sign-ins cannot be opened on this Windows account. Your other tests, folders and agents can still run. Re-enter only the affected sign-in, or forget it. Its original encrypted backup stays on this computer.';const list=document.createElement('div');dialog.append(heading,help,list);
 const paint=()=>{
  list.replaceChildren();const issues=window.LVXCredentials?.issues?.()||[];
  if(!issues.length){const done=document.createElement('p');done.textContent='All saved connections are ready.';list.append(done);return;}
  for(const issue of issues){const group=document.createElement('section'),label=document.createElement('h3');label.textContent=issue.label||'Saved connection';const field=document.createElement('label');field.textContent='Replacement credential';const input=document.createElement('input');input.type='password';input.autocomplete='off';field.append(input);const status=document.createElement('p');status.setAttribute('role','alert');const actions=document.createElement('div');actions.className='studio-actions';
   for(const [text,choice]of [['Save replacement','replace'],['Try original sign-in again','retry'],['Forget saved sign-in','forget']]){const button=document.createElement('button');button.type='button';button.textContent=text;button.className='aero-button-'+(choice==='replace'?'success':'gray');button.onclick=async()=>{const buttons=[...actions.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{await window.LVXCredentials.repair(issue.id,input.value,{retryOriginal:choice==='retry',forget:choice==='forget'});input.value='';paint();}catch(error){status.textContent=error.message;}finally{buttons.forEach(b=>b.disabled=false);}};actions.append(button);}group.append(label,field,status,actions);list.append(group);
  }
 };
 paint();const footer=document.createElement('div');footer.className='studio-actions';const close=document.createElement('button');close.type='button';close.className='aero-button-primary';close.textContent='Continue using LVX';const finish=()=>{dialog.close();dialog.remove();if(previous?.isConnected)previous.focus({preventScroll:true});};close.onclick=finish;dialog.oncancel=event=>{event.preventDefault();finish();};footer.append(close);dialog.append(footer);document.body.append(dialog);dialog.showModal();close.focus();
}
