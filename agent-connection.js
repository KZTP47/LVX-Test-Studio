let activeDialog;
export async function openAgentConnection({invoke,choosePath,onEvent,provider,nodeName='',workspaceRoot}){
 if(activeDialog){activeDialog.focus();return {action:'done'};}
 const launcher=document.activeElement,dialog=document.createElement('dialog');dialog.className='agent-connection-dialog';dialog.setAttribute('aria-labelledby','agent-connection-title');
 const button=(action,label)=>`<button type="button" data-ac-action="${action}">${label}</button>`;
 dialog.innerHTML=`<header><h2 id="agent-connection-title">Repair connection</h2>${button('close','Close')}</header><p data-ac="agent"></p><p>Connection checks use the official installed tool. They do not send a model prompt or retry messages.</p><section data-ac="result" role="status" aria-live="polite">Checking connection…</section><div class="ac-actions">${button('recheck','Recheck connection')}${button('choose','Choose installed CLI')}${button('login','Sign in')}${button('source','Installation instructions')}${button('settings','Agent settings')}</div><p data-ac="notice" role="status"></p><p>After repair, close this window and send your message again. Earlier attempts stay in your chat history.</p>`;
 dialog.querySelector('[data-ac="agent"]').textContent=(nodeName||'Selected agent')+' · '+({codex:'Codex',claude:'Claude Code',gemini:'Gemini',api:'Configured API'}[provider]||provider);
 document.body.append(dialog);activeDialog=dialog;let disposed=false,busy=false,finish,unsubscribe,lastResult;const done=new Promise(resolve=>{finish=resolve;});
 const q=name=>dialog.querySelector('[data-ac="'+name+'"]'),control=name=>dialog.querySelector('[data-ac-action="'+name+'"]');
 const close=(action='done')=>{if(disposed)return;disposed=true;unsubscribe?.();dialog.close();dialog.remove();activeDialog=null;if(launcher?.isConnected)launcher.focus({preventScroll:true});finish({action});};
 unsubscribe=onEvent?.(event=>{if(event.domain==='host'&&event.type==='workspace'&&event.workspaceRoot!==workspaceRoot)close();});
 function controls(){for(const name of ['recheck','choose','login','source','settings'])control(name).disabled=busy;for(const name of ['choose','login','source'])control(name).hidden=provider==='api';control('login').hidden=provider==='api'||lastResult?.ready===true;control('login').disabled=busy||lastResult?.installed===false;}
 function show(result){lastResult=result;q('result').replaceChildren();const heading=document.createElement('strong');heading.textContent=result.ready===true?'Connection ready':result.state==='login-unchecked'?'CLI found':result.state==='configuration'?'Review API settings':'Connection needs attention';const message=document.createElement('p');message.textContent=result.summary;q('result').append(heading,message);for(const value of [result.version,result.executable,result.detail,result.warning].filter(Boolean)){const p=document.createElement('p');p.className='ac-path';p.textContent=value;q('result').append(p);}dialog.dataset.connectionState=result.state;}
 async function check(){q('result').textContent='Checking connection…';const result=await invoke('connection',{provider});if(!disposed)show(result);}
 async function task(fn){if(disposed||busy)return;busy=true;controls();q('notice').textContent='';try{await fn();}catch(error){if(!disposed){q('notice').textContent=error.message||String(error);dialog.dataset.connectionState='error';}}finally{busy=false;if(!disposed)controls();}}
 dialog.addEventListener('click',event=>{const action=event.target.closest('[data-ac-action]')?.dataset.acAction;if(!action)return;if(action==='close')return close();if(action==='settings')return close('settings');void task(async()=>{
  if(action==='recheck')return check();
  if(action==='choose'){const file=await choosePath();if(disposed||file.cancelled)return;await invoke('configureProvider',{provider,path:file.path});if(!disposed)await check();return;}
  if(action==='login'){await invoke('openLogin',{provider});if(!disposed)q('notice').textContent='The official sign-in terminal is open. Finish signing in there, then select Recheck connection.';return;}
  if(action==='source'){await invoke('openProviderSource',{provider});if(!disposed)q('notice').textContent='The publisher installation page is open. Install its official CLI, then select Recheck connection.';}
 });});
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.showModal();controls();void task(check);return done;
}
