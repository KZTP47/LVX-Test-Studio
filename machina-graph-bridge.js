/* Native execution boundary and progressive visual authoring for the Machina graph. */
(() => {
 'use strict';
 const clone=value=>JSON.parse(JSON.stringify(value)),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const icon=name=>window.LVXIcons?.svg(name)||'';
 const terminal=new Set(['SUCCESS','FAILURE','ERROR','CANCELLED']);
 const sessions=new Map();let context={},unsubscribe=null;
 const nodeIcons={'security-scan':'shield','security-gate':'shield','git-repo':'branch','unit-test-runner':'test','ai-unit-test':'robot','ai-log-summary':'file','log-collector':'archive','start-runner':'play','wait-delay':'clock','api-performance':'activity','api-contract':'code','code-review':'eye','website-ux-auto-tester':'globe','push-deploy':'upload'};
 function installStyles(){
  if(document.getElementById('machina-graph-styles'))return;
  const style=document.createElement('style');style.id='machina-graph-styles';style.textContent=`
  .visual-editor-container,.mg-dialog,.mg-run,.mg-review{--mg-surface:#fff;--mg-text:#17263b;--mg-muted:#526277;--mg-line:#ccd6e2;--mg-soft:#f3f6fa;color:var(--mg-text);font:14px/1.5 var(--font-body,Segoe UI,sans-serif)}
  :is(.theme-dark,[data-theme="dark"]) :is(.visual-editor-container,.mg-dialog,.mg-run,.mg-review){--mg-surface:#172334;--mg-text:#f0f4fa;--mg-muted:#bdcbdc;--mg-line:#405167;--mg-soft:#223246}
  :is(.theme-dark,[data-theme="dark"]) .mg-review .mg-diff-added{background:#153b2a;color:#cef4d7}:is(.theme-dark,[data-theme="dark"]) .mg-review .mg-diff-removed{background:#48242b;color:#ffd9de}
  .visual-editor-container{position:relative;isolation:isolate;min-height:640px;height:min(78vh,1000px);overflow:hidden;background:var(--mg-soft);border:1px solid var(--mg-line);border-radius:12px}
  .visual-editor-container .ve-canvas{position:absolute;inset:0;overflow:hidden;background-image:radial-gradient(#b8c7d8 1px,transparent 1px);background-size:22px 22px}
  .ve-viewport{position:absolute;left:0;top:0;transform-origin:0 0}.ve-svg-layer,.ve-node-layer{position:absolute;inset:0;overflow:visible}.ve-node-layer{pointer-events:none}
  .visual-editor-container .ve-toolbar{position:absolute;inset:12px auto 12px 12px;width:240px;display:block;overflow:auto;padding:14px;background:var(--mg-surface);border:1px solid var(--mg-line);border-radius:10px;z-index:30;box-shadow:0 5px 20px #152d4010}
  .ve-toolbar-section .ve-suite-list{max-height:none!important;overflow:visible}.ve-toolbar-header{color:var(--mg-text)!important;font-weight:700;margin:12px 0 6px}.ve-suite-list{flex:initial;max-height:190px;overflow:auto;min-height:28px}.ve-toolbar-btn-group{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
  .visual-editor-container .ve-palette-item,.visual-editor-container .ve-suite-item{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;margin:4px 0;border:1px solid var(--mg-line);border-radius:6px;background:var(--ve-task-gradient,var(--mg-soft))!important;color:var(--ve-task-ink,var(--mg-text))!important;text-align:left;cursor:grab}
  .ve-node{position:absolute;width:300px;min-height:80px;background:var(--mg-surface)!important;color:var(--mg-text);border:1px solid var(--mg-line);border-radius:9px;box-shadow:0 4px 12px #18324a18;user-select:none}
  .ve-node.ve-node-selected{outline:3px solid #2873c2;outline-offset:3px}.ve-node-header{display:flex;align-items:center;gap:5px;padding:10px 12px;background:var(--ve-task-gradient,linear-gradient(180deg,#e3f2fd,#bbdefb))!important;color:var(--ve-task-ink,#003366);border-bottom:1px solid var(--mg-line);border-radius:8px 8px 0 0}
  .ve-node-header strong{color:inherit!important;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ve-node-header button{padding:3px!important;position:static!important;opacity:1!important;background:transparent!important;border:0!important;color:inherit!important;flex-shrink:0}.ve-node-description{padding:8px 14px;color:var(--mg-muted);font-size:12px}
  .ve-ports{position:absolute;left:-7px;right:-7px;top:33px;height:14px;align-items:center;display:flex;justify-content:space-between;pointer-events:none}.ve-port{position:static!important;top:auto!important;transform:none!important;margin:0!important;width:14px!important;height:14px!important;border:2px solid var(--mg-surface)!important;border-radius:50%;background:#276cb6!important;padding:0!important;pointer-events:auto}
  .ve-zoom-controls{position:absolute;right:12px;bottom:12px;max-width:calc(100% - 280px);display:flex;flex-direction:column;flex-wrap:nowrap;align-items:stretch;gap:5px;max-height:calc(100% - 24px);overflow:auto;z-index:35}.ve-top-action-bar{left:270px!important;right:12px;top:12px!important;background:rgba(255,255,255,.9)!important;box-shadow:0 4px 16px #0000001a!important;border:1px solid #fff!important;flex-wrap:wrap}.visual-editor-container .ve-zoom-controls button{width:auto;height:auto;white-space:nowrap;flex:none}.ve-zoom-level{min-width:45px;text-align:center}
  .visual-editor-container button,.mg-dialog button,.mg-run button,.mg-review button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:5px 10px;border:1px solid var(--mg-line);border-radius:6px;cursor:pointer;font:inherit}.visual-editor-container button:hover,.mg-dialog button:hover,.mg-run button:hover,.mg-review button:hover{filter:brightness(.97)}
  .visual-editor-container button:focus-visible,.mg-dialog :focus-visible,.mg-run :focus-visible,.mg-review :focus-visible{outline:3px solid #2176c7;outline-offset:2px}.mg-dialog button:disabled,.mg-run button:disabled,.mg-review button:disabled{opacity:.5;cursor:default}
  /* Original Machina configuration surfaces remain independent of canvas appearance. */
  .mg-dialog{--mg-text:#f8fafc;--mg-muted:#c2d3e0;--mg-line:rgba(255,255,255,.35);--mg-surface:#0f172a;--mg-soft:rgba(255,255,255,.08);position:fixed!important;inset:0!important;display:flex;align-items:center;justify-content:center;padding:24px;background:#0008!important;z-index:50000!important;backdrop-filter:blur(4px);color:var(--mg-text);color-scheme:dark}
  .mg-dialog[data-node-type="start-runner"]{--mg-text:#052e16;--mg-muted:#14532d;--mg-line:#44734c;--mg-surface:#eef9de;--mg-soft:#ffffffb8;color-scheme:light}
  .mg-dialog>.aero-modal{width:100%;max-height:90vh;min-height:0;overflow:auto;flex-shrink:1;color:var(--mg-text);border-radius:12px;padding:24px;box-shadow:0 8px 32px #0066cc40,0 0 0 1px #ffffffe6 inset}
  .mg-dialog h3{display:flex;align-items:center;gap:8px;flex-shrink:0;font-size:20px;line-height:1.4;margin:0 0 16px;color:var(--mg-text)}
  .mg-dialog h3.text-2xl{font-size:24px}
  .mg-dialog :is(h4,label){color:var(--mg-text)}.mg-dialog label{font-weight:400}.mg-dialog :is(p.text-xs,span.text-slate-600,.text-gray-400,.text-gray-500,.text-slate-600,.mg-hint){color:var(--mg-muted)}
  .mg-dialog :is(.aero-text-primary,.aero-text-secondary,.text-slate-800,.text-slate-900){color:var(--mg-text)!important}.mg-dialog :is(.aero-text-muted,.text-gray-400){color:var(--mg-muted)!important}
  .mg-dialog input:not([type=checkbox]):not([type=radio]),.mg-dialog textarea,.mg-dialog select{width:100%;min-width:0;box-sizing:border-box;background:rgba(255,255,255,.1);color:var(--mg-text);border:1px solid rgba(255,255,255,.3);border-radius:8px;padding:8px;font:inherit}
  .mg-dialog input::placeholder,.mg-dialog textarea::placeholder{color:#b5c9d4;opacity:1}.mg-dialog select option{color:#0f172a!important;background:white!important}
  .mg-dialog :is(input[type=checkbox],input[type=radio]){width:auto;accent-color:#06b6d4}.mg-dialog textarea{font-family:Consolas,monospace;min-height:90px}
  .mg-dialog .grid{display:grid;gap:16px;grid-template-columns:repeat(2,minmax(0,1fr))}.mg-dialog .grid-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}.mg-dialog .grid-cols-1{grid-template-columns:1fr}.mg-dialog .col-span-2{grid-column:span 2}.mg-dialog .grid>*{min-width:0}
  .mg-dialog .mg-execution-details{border:1px solid var(--mg-line);border-radius:8px;padding:12px;margin:16px 0;background:var(--mg-soft);flex-shrink:0}.mg-dialog summary{cursor:pointer;font-weight:650}.mg-dialog details[open]>div{margin-top:12px}
  .mg-dialog .mg-error{color:#ffe0e0;white-space:pre-wrap;background:#631f2c;padding:8px;border-radius:6px}.mg-dialog .mg-error:empty{display:none}.mg-dialog .mg-hint{font-size:12px}
  .mg-dialog :is(button,input,textarea,select):focus-visible{outline:3px solid #7dd3fc;outline-offset:2px}.mg-dialog button{min-height:32px;flex-shrink:0}.mg-dialog .flex.justify-end{flex-shrink:0;flex-wrap:wrap;gap:8px}
  .mg-dialog .font-mono{font-family:Consolas,monospace}.mg-dialog button.py-2{padding:8px 16px}
  .mg-dialog .aero-button-success{background:linear-gradient(180deg,#81c784 0%,#66bb6a 50%,#4caf50 100%);border-color:#43a047;color:#062e12}.mg-dialog .aero-button-success:hover{background:linear-gradient(180deg,#90d494,#75c979 50%,#5cbf60)}
  .mg-dialog :is(#cfg-ai-save,#cfg-ai-generate){color:#042f2e!important}.mg-dialog #cfg-ai-log-save{color:#2f1300!important}
  .mg-dialog[data-node-type="ai-log-summary"]>.aero-modal>.overflow-y-auto{background:#180830b8;padding:12px;border-radius:8px}
  .mg-dialog[data-node-type="start-runner"] :is(input:not([type=checkbox]),textarea,select){background:#ffffffd1!important;color:#111827!important;border-color:#14532d66!important}.mg-dialog[data-node-type="start-runner"] :is(h3,h4,label,.mg-hint,p){color:#052e16}.mg-dialog[data-node-type="start-runner"] input::placeholder{color:#435c46}
  .mg-dialog[data-node-type="start-runner"]>.aero-modal>.overflow-y-auto{background:#f1fbd9e6;padding:12px;border-radius:8px}.mg-dialog[data-node-type="start-runner"]>.aero-modal>:is(h3,p){color:#f0fff4!important}
  .mg-run .mg-primary,.mg-review .mg-primary{background:#1e62aa;color:#fff;border-color:#1e62aa}.mg-run .mg-primary:hover,.mg-review .mg-primary:hover{background:#174e88}.mg-dialog fieldset{border:1px solid var(--mg-line);padding:12px;border-radius:8px;margin:10px 0}
  .mg-run,.mg-review{position:fixed;inset:6vh 5vw;z-index:50010;display:flex;flex-direction:column;background:var(--mg-surface);border:1px solid var(--mg-line);border-radius:12px;box-shadow:0 14px 70px #142c4a40;padding:20px;overflow:hidden}.mg-run header,.mg-review header{display:flex;gap:10px;align-items:center;border-bottom:1px solid var(--mg-line);padding-bottom:14px}.mg-run header h2,.mg-review header h2{margin:0;flex:1;font-size:20px}.mg-run .mg-run-body{overflow:auto;flex:1}.mg-run pre,.mg-review pre{background:var(--mg-soft);color:var(--mg-text);padding:14px;border:1px solid var(--mg-line);border-radius:8px;white-space:pre-wrap;word-break:break-word}.mg-run table{width:100%;border-collapse:collapse;margin:14px 0}.mg-run th,.mg-run td{text-align:left;padding:8px;border-bottom:1px solid var(--mg-line)}
  .mg-dock{position:fixed;bottom:12px;left:50%;transform:translateX(-50%);display:flex;gap:8px;max-width:95vw;overflow:auto;z-index:50040}.mg-dock button{box-shadow:0 3px 12px #182d4020;background:var(--mg-surface,#fff);color:var(--mg-text,#17263b);padding:8px 14px;border:1px solid var(--mg-line,#ccd6e2);border-radius:8px;white-space:nowrap}
  .mg-review{z-index:50020}.mg-review .mg-review-body{overflow:auto;flex:1;padding:14px 0}.mg-review .mg-review-columns{display:grid;grid-template-columns:1fr 1fr;gap:16px}.mg-review textarea{resize:vertical;min-height:230px}.mg-review iframe{width:100%;height:240px;border:1px solid var(--mg-line);background:#fff}.mg-review .mg-diff-added{background:#e5f4e9;color:#174a25}.mg-review .mg-diff-removed{background:#fbe8e8;color:#7b2020}.mg-review .mg-history{display:flex;gap:6px;overflow:auto;margin:12px 0}.mg-review footer{display:flex;flex-wrap:wrap;gap:8px;border-top:1px solid var(--mg-line);padding-top:14px}.mg-run.hidden,.mg-review.hidden{display:none!important}
  @media(max-width:850px){.visual-editor-container{min-height:720px}.visual-editor-container .ve-toolbar{width:200px}.ve-top-action-bar{left:225px!important}.mg-dialog{padding:12px}.mg-dialog>.aero-modal{padding:16px!important}.mg-dialog .grid,.mg-review .mg-review-columns{grid-template-columns:1fr}.mg-dialog .col-span-2{grid-column:auto}.mg-run,.mg-review{inset:2vh 2vw}.ve-zoom-controls{left:auto;right:8px;max-width:calc(100% - 225px)}}
  `;document.head.appendChild(style);
 }
 function setContext(options={},bindEditor=true){context={...context,...options};if(bindEditor&&Object.keys(options).length&&context.editor)context.editor._machinaContext={...context};if(!unsubscribe&&window.electronAPI?.studioOps?.onEvent)unsubscribe=window.electronAPI.studioOps.onEvent(handleEvent);}
 async function invoke(action,payload={},binding=context){
  const full=binding.invoke||window.electronAPI?.studioOps?.invoke;
  if(!full)throw Error('Open the Windows desktop app and choose a trusted workspace for graph execution.');
  const bound=binding.workspaceRoot?{...payload,workspaceRoot:binding.workspaceRoot}:payload;
  const result=await full('execution',action,clone(bound));
  if(result?.__lvxError)throw Object.assign(Error(result.__lvxError.message),result.__lvxError);
  return result;
 }
 async function protect(value,label){if(!window.LVXCredentials?.protect)throw Error('Credential protection is unavailable. Open Setup & diagnostics before saving or running.');return window.LVXCredentials.protect(clone(value),label);}
 function dockItem(key,label,restore){let dock=document.getElementById('mg-session-dock');if(!dock){dock=document.createElement('div');dock.id='mg-session-dock';dock.className='mg-dock';document.body.appendChild(dock);}let button=Array.from(dock.children).find(item=>item.dataset.key===key);if(!button){button=document.createElement('button');button.dataset.key=key;dock.appendChild(button);}button.textContent=label;button.onclick=()=>{restore();button.remove();};return button;}
 function clearDock(key){document.querySelectorAll('#mg-session-dock button').forEach(button=>{if(button.dataset.key===key)button.remove();});}
 function download(name,content,type='text/plain'){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function showOutput(node,result){
  const modal=document.createElement('section');modal.className='mg-run';modal.style.zIndex='50030';modal.setAttribute('role','dialog');modal.setAttribute('aria-label','Node output');
  const artifacts=result.artifacts||{},summary=artifacts.aiSummary||artifacts.aiLogSummary,code=artifacts.generatedCode||artifacts.finalCode,primary=summary||code||result.stdout||result.message||result.error||'';
  modal.innerHTML=`<header><h2>${esc(node.data?.name||node.id)} · ${esc(result.status)}</h2><button data-output-minimize>${icon('minus')} Minimize</button><button data-output-download>${icon('download')} Export output</button><button data-output-close>${icon('close')} Close</button></header><div class="mg-run-body">${summary?'<p>AI summaries can misread incomplete logs. Verify conclusions against the execution evidence.</p>':''}<pre>${esc(primary)}</pre><details><summary>Complete node evidence and artifacts</summary><pre>${esc(JSON.stringify(result,null,2))}</pre></details></div>`;
  document.body.appendChild(modal);const key='output:'+node.id+':'+Date.now();modal.querySelector('[data-output-close]').onclick=()=>{modal.remove();clearDock(key);};modal.querySelector('[data-output-minimize]').onclick=()=>{modal.classList.add('hidden');dockItem(key,node.data?.name||node.id,()=>modal.classList.remove('hidden'));};modal.querySelector('[data-output-download]').onclick=()=>download(node.id.replace(/[^a-zA-Z0-9_-]/g,'_')+(summary?'.md':code?'.txt':'.json'),primary||JSON.stringify(result,null,2));
 }
 function syncAuthoringResults(session){
  const editor=session.editor;if(!editor?.container?.isConnected)return;let changed=false;
  for(const [id,result]of Object.entries(session.run.results||{})){
   if(!terminal.has(result.status)||!result.artifacts)continue;const signature=JSON.stringify(result);if(session.applied.get(id)===signature)continue;session.applied.set(id,signature);
   const node=editor.nodes.find(node=>node.id===id),initial=session.workflow.nodes.find(node=>node.id===id);if(!node||!initial)continue;const data=node.data,artifacts=result.artifacts;
   if(artifacts.repoPath&&node.type==='git-repo'){data.clonedPath=artifacts.repoPath;data.lastClonedPath=artifacts.repoPath;changed=true;}
   if(node.type==='ai-unit-test'&&typeof artifacts.generatedCode==='string'&&data.generatedCode===initial.data.generatedCode){data.generatedCode=artifacts.generatedCode;for(const key of ['lastGeneratedAt','lastResolvedTestMode'])if(artifacts[key]!=null)data[key]=artifacts[key];data.lastSourceFilesUsed=artifacts.sourceFilesUsed||[];data.lastTestSummary=artifacts.testSummary;changed=true;}
   if(node.type==='ai-log-summary'&&typeof artifacts.aiLogSummary==='string'){data.lastSummary=artifacts.aiLogSummary;data.lastSummaryAt=artifacts.lastSummaryAt||session.run.finishedAt||new Date().toISOString();if(artifacts.savedPath)data.lastSummaryPath=artifacts.savedPath;changed=true;}
   if(node.type==='code-review'&&typeof artifacts.finalCode==='string'){data.lastGeneratedCode=artifacts.finalCode;const history=(artifacts.history||[]).flatMap(decision=>decision.history?.length?decision.history:[decision]);data.history=[...(initial.data.history||[]),...clone(history)];changed=true;}
   if(node.type==='website-ux-auto-tester'&&artifacts.websiteAudit){data.lastUXReport=JSON.stringify(artifacts.websiteAudit,null,2);data.lastUXReportAt=session.run.finishedAt||new Date().toISOString();changed=true;}
  }
  if(changed&&context.editor===editor)context.onChange?.(editor.getGraph());
 }
 function displayRun(session){
  const {element,run,workflow}=session;if(!element)return;
  element.querySelector('[data-run-status]').textContent=run.status;
  element.querySelector('[data-run-stop]').disabled=terminal.has(run.status);
  const results=run.results||{};element.querySelector('tbody').innerHTML=(workflow.nodes||[]).map(node=>{const result=results[node.id]||{};return `<tr><td>${esc(node.data?.name||node.id)}</td><td>${esc(result.status||'PENDING')}</td><td>${esc(result.message||result.error||'')}${node.data?.missingSuiteReference?` <span>Saved test ${esc(node.data.suiteId)} could not be found.</span>${session.editor?` <button data-relink-suite="${esc(node.id)}">${icon('folder')} Choose saved test</button>`:''}`:''}${terminal.has(result.status)?` <button data-node-output="${esc(node.id)}">${icon('file')} View output</button>`:''}</td><td>${esc(Array.isArray(result.attempts)?result.attempts.length:result.attempt??'')}</td></tr>`;}).join('');
  for(const button of element.querySelectorAll('[data-relink-suite]'))button.onclick=()=>relinkSuite(session.editor,button.dataset.relinkSuite);
  for(const button of element.querySelectorAll('[data-node-output]'))button.onclick=()=>showOutput(workflow.nodes.find(node=>node.id===button.dataset.nodeOutput),results[button.dataset.nodeOutput]);
  const log=[run.stdout,run.stderr,run.error,...Object.entries(results).flatMap(([id,r])=>[r.stdout&&`${id}: ${r.stdout}`,r.stderr&&`${id}: ${r.stderr}`,r.output,r.error])].filter(Boolean).join('\n');
  element.querySelector('[data-run-log]').textContent=log||'Waiting for execution evidence.';
  element.querySelector('[data-run-evidence]').textContent=JSON.stringify(run,null,2);
  syncAuthoringResults(session);
  if(terminal.has(run.status)){window.LVXCodeReview?.settleRun(run.id,run.status);for(const waiter of session.waiters.splice(0))waiter.resolve(clone(run));}else for(const pending of run.pendingReviews||[])showReview({...pending,id:run.id});
 }
 function mountRun(run,workflow,editor,binding=context){
  installStyles();const element=document.createElement('section');element.className='mg-run';element.setAttribute('role','dialog');element.setAttribute('aria-label','Pipeline execution');
  element.innerHTML=`<header><h2>${esc(workflow.name||'Workflow run')}</h2><strong data-run-status>${esc(run.status)}</strong><button data-run-minimize title="Minimize run">${icon('minus')} Minimize</button><button data-run-export>${icon('download')} Export log</button><button data-run-stop>${icon('stop')} Stop</button><button data-run-close>${icon('close')} Close</button></header><div class="mg-run-body"><table><thead><tr><th>Node</th><th>Status</th><th>Evidence</th><th>Attempts</th></tr></thead><tbody></tbody></table><h3>Execution log</h3><pre data-run-log></pre><details><summary>Full persisted evidence</summary><pre data-run-evidence></pre></details></div><p data-run-error role="alert"></p>`;
  document.body.appendChild(element);const session={run,workflow:clone(workflow),element,waiters:[],editor,applied:new Map(),binding};sessions.set(run.id,session);
  const minimize=()=>{element.classList.add('hidden');dockItem('run:'+run.id,`${workflow.name||'Workflow'} · ${session.run.status}`,()=>element.classList.remove('hidden'));};
  element.querySelector('[data-run-minimize]').onclick=minimize;
  element.querySelector('[data-run-export]').onclick=()=>download('workflow-'+run.id+'.json',JSON.stringify(session.run,null,2),'application/json');
  element.querySelector('[data-run-close]').onclick=()=>{if(!terminal.has(session.run.status))minimize();else{element.remove();sessions.delete(run.id);clearDock('run:'+run.id);}};
  element.querySelector('[data-run-stop]').onclick=async()=>{const target=element.querySelector('[data-run-error]');try{await invoke('cancel',{id:run.id},binding);session.run=await invoke('getRun',{id:run.id},binding);displayRun(session);}catch(error){target.textContent=error.message;}};
  displayRun(session);return session;
 }
 function handleEvent(event){if(event.domain!=='execution')return;if(event.type==='review-request')showReview(event);const session=sessions.get(event.id);if(session&&event.type==='run'){session.run=event;displayRun(session);}}
 function showReview(request){
  if(!request.decisionId||!window.LVXCodeReview)return;
  const session=sessions.get(request.id),node=session?.workflow.nodes.find(n=>n.id===request.nodeId);
  window.LVXCodeReview.open(request,{nodeConfig:node?.data||{},invoke,onComplete:result=>{if(node&&result.decision==='approve'){node.data.lastGeneratedCode=result.finalCode;node.data.history=[...(node.data.history||[]),result];}context.onReview?.(request,result);}});
 }
 async function restorePendingReviews(){const requests=await invoke('pendingReviews');if(!Array.isArray(requests))throw Error('Pending review evidence is unavailable.');for(const request of requests)showReview(request);return requests.length;}
 function relinkSuite(editor,nodeId){
  const node=editor?.nodes.find(n=>n.id===nodeId);if(!node)return;
  const available=[...(editor.availableSuites||[]),...(window.LVXApp?.getSuites?.()||[])],suites=[...new Map(available.filter(s=>s?.id).map(s=>[s.id,s])).values()];
  const modal=document.createElement('div');modal.className='mg-dialog';modal.style.setProperty('z-index','50060','important');modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Choose saved test');
  modal.innerHTML=`<section class="aero-modal" style="max-width:620px;background:#09303d"><h3>Choose a saved test for this node</h3><p>The graph refers to ${esc(node.data.suiteId)}, which is no longer in the test library. Choose its replacement. Existing test code will not be changed.</p><label>Saved test<select data-relink-choice><option value="">Choose a saved test</option>${suites.map(s=>`<option value="${esc(s.id)}">${esc(s.name||s.id)}</option>`).join('')}</select></label>${suites.length?'':'<p>No saved tests are available. Add or import a test, then return here.</p>'}<p data-relink-error role="alert"></p><footer class="flex justify-end"><button data-relink-cancel>Cancel</button><button data-relink-apply>Use this test</button></footer></section>`;
  document.body.append(modal);modal.querySelector('[data-relink-cancel]').onclick=()=>modal.remove();modal.querySelector('[data-relink-apply]').onclick=()=>{const suite=suites.find(s=>s.id===modal.querySelector('[data-relink-choice]').value);if(!suite){modal.querySelector('[data-relink-error]').textContent='Choose a test from the list.';return;}node.data={...node.data,suiteId:suite.id,name:suite.name||node.data.name};delete node.data.suite;delete node.data.missingSuiteReference;editor.render();editor._commitHistoryState?.();editor._machinaContext?.onChange?.(editor.getGraph());modal.remove();editor._showEditorMessage('Test connection updated. Save the graph to keep it, then run Start again.','success');};modal.querySelector('select').focus();
 }
 async function runWorkflow(workflow,options={},authoringEditor=null){
  setContext();const validation=window.GraphEngine?.validate(workflow);
  if(validation&&!validation.valid)throw Error(validation.errors.join(' '));
  const binding=authoringEditor?._machinaContext||context;
  const snapshot=clone(window.GraphEngine?.executionPlan?window.GraphEngine.executionPlan(validation?.workflow||workflow,options).workflow:validation?.workflow||workflow);
  const suites=authoringEditor?.availableSuites||binding.suites||window.LVXApp?.getSuites?.()||window.testSuites||[];
  let retained=[];try{retained=JSON.parse(localStorage.getItem('pipeline_test_suites')||'[]');if(!Array.isArray(retained))retained=[];}catch{}
  for(const node of snapshot.nodes||[])if(node.data?.suiteId){
   const id=node.data.suiteId,suite=node.data.suite||await binding.resolveSuite?.(id)||suites.find(s=>s.id===id)||(window.LVXApp?.getSuites?.()||[]).find(s=>s.id===id)||retained.find(s=>s.id===id);
   if(suite){node.data={...node.data,suite:clone(suite)};delete node.data.missingSuiteReference;}
   else{node.data={...node.data,missingSuiteReference:true};if(node.onFailure==null&&node.data.onFailure==null)node.onFailure='continue';}
  }
  const protectedWorkflow=await protect(snapshot,'Visual workflow');
  if(window.LVXReviewImported&&!await window.LVXReviewImported(protectedWorkflow))return {status:'CANCELLED',cancelled:true};
  const {waitForCompletion=false,...executionOptions}=options;
  const run=await invoke('runWorkflow',{workflow:protectedWorkflow,...executionOptions},binding);
  const editor=authoringEditor||binding.editor;const session=mountRun(run,protectedWorkflow,editor&&snapshot.nodes.every(node=>editor.nodes.some(candidate=>candidate.id===node.id))?editor:null,binding);binding.onRun?.(run,protectedWorkflow);
  if(!terminal.has(run.status))void poll(session);
  return waitForCompletion?waitForRun(run.id):run;
 }
 function waitForRun(id){const session=sessions.get(id);if(!session)return invoke('getRun',{id}).then(run=>{if(!terminal.has(run.status))throw Error('Open this run in the graph monitor before waiting for completion.');return run;});if(terminal.has(session.run.status))return Promise.resolve(clone(session.run));return new Promise((resolve,reject)=>session.waiters.push({resolve,reject}));}
 async function poll(session){
  while(sessions.has(session.run.id)&&!terminal.has(session.run.status)){
   await new Promise(resolve=>setTimeout(resolve,300));
   try{session.run=await invoke('getRun',{id:session.run.id},session.binding);displayRun(session);session.binding.onRun?.(session.run,session.workflow);}catch(error){session.element.querySelector('[data-run-error]').textContent=error.message;for(const waiter of session.waiters.splice(0))waiter.reject(error);break;}
  }
 }
 async function generatePreview(node,options={}){const safe=await protect(node,'AI generation');const result=await invoke('generatePreview',{node:safe,...options});if(!result?.code)throw Error('AI generation returned no code.');return {...result,success:true,generatedText:result.code};}
 function validateConfig(node,modal){
  const errors=[];for(const field of modal.querySelectorAll('input[type=number]')){const value=Number(field.value);if(!Number.isFinite(value)||field.min!==''&&value<Number(field.min)||field.max!==''&&value>Number(field.max))errors.push(`${field.getAttribute('aria-label')||field.id}: enter a value within the displayed limits.`);}
  const get=id=>modal.querySelector('#'+id)?.value;
  for(const select of modal.querySelectorAll('select'))if(select.selectedOptions[0]?.dataset.unsupported)errors.push(`${select.getAttribute('aria-label')||select.id}: choose a supported option before saving.`);
  for(const id of ['cfg-perf-url','cfg-contract-url','cfg-ux-live-url'])if(get(id)){try{if(!['http:','https:'].includes(new URL(get(id)).protocol))throw Error();}catch{errors.push('Enter a complete HTTP or HTTPS URL.');}}
  if(node.type==='security-scan'&&get('cfg-scan-mode')==='code'&&!['cfg-sast','cfg-secrets','cfg-xss'].some(id=>modal.querySelector('#'+id)?.checked))errors.push('Select at least one source scan category.');
  if(get('cfg-contract-schema')){try{JSON.parse(get('cfg-contract-schema'));}catch{errors.push('The response schema must be valid JSON.');}}
  if(get('cfg-branch-policy')==='create'&&!get('cfg-branch-base')?.trim())errors.push('Enter the base branch for creating a missing branch.');
  if(get('cfg-runner-download-logs')==='yes'&&!get('cfg-runner-log-path')?.trim())errors.push('Choose a log destination when Download logs is enabled.');
  return errors;
 }
 function enhanceModal(editor,node,modal){
  if(!modal||modal.dataset.enhanced)return;modal.dataset.enhanced='true';modal.dataset.nodeType=node.type;modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label',`${node.data?.name||node.type} configuration`);
  const inner=modal.querySelector('.aero-modal');if(!inner)return;
  const heading=inner.querySelector('h3');if(heading&&!heading.querySelector('svg'))heading.insertAdjacentHTML('afterbegin',icon(nodeIcons[node.type]||'settings'));
  const error=document.createElement('p');error.className='mg-error';error.setAttribute('role','alert');inner.appendChild(error);
  let extras='';const d=node.data||{},storedRetry=node.retry??d.retry??{},storedFailure=node.onFailure??d.onFailure??'stop',storedResources=node.resources??d.resources??[];
  const input=(label,name,value,type='text',extra='')=>`<label>${esc(label)}<input data-extra="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  if(['unit-test-runner','ai-unit-test'].includes(node.type))extras+=`<label>Native test engine<select data-extra="engine"><option value="">Configured command</option>${['javascript','python','robot','playwright','jest','pytest','junit','nunit','java','csharp'].map(engine=>`<option ${d.engine===engine?'selected':''}>${engine}</option>`).join('')}</select></label>${input('Working directory / project','cwd',d.cwd||d.projectPath||'')}`;
  if(node.type==='ai-unit-test')extras+=`<label>Optional inline source code<textarea data-extra="sourceCode">${esc(d.sourceCode||'')}</textarea></label>`;
  if(['unit-test-runner','ai-unit-test','code-review','log-collector','ai-log-summary'].includes(node.type))extras+=`<label><input type="checkbox" data-extra="overwrite" ${d.overwrite?'checked':''}> Replace an existing generated file when approved</label>`;
  if(node.type==='push-deploy')extras+=`<label><input type="checkbox" data-extra="enabled" ${d.enabled===true?'checked':''}> Enable this deployment step</label><p class="mg-hint">Deployment also requires explicit deployment approval in the connected review session.</p>`;
  const details=document.createElement('details');details.className='mg-execution-details';details.innerHTML=`<summary>Execution and failure handling</summary><div class="grid">${extras}${input('Total attempts (including first run)','retryAttempts',typeof storedRetry==='object'?storedRetry.maxAttempts??1:storedRetry??1,'number','min="1" max="21"')}${input('Retry delay (ms)','retryDelay',storedRetry?.backoffMs??0,'number','min="0" max="60000"')}<label>When this node fails<select data-extra="onFailure"><option value="stop" ${storedFailure!=='continue'?'selected':''}>Stop dependent execution</option><option value="continue" ${storedFailure==='continue'?'selected':''}>Continue independent work</option></select></label>${input('Exclusive resource names (comma separated)','resources',Array.isArray(storedResources)?storedResources.join(', '):String(storedResources))}</div>`;
  const footer=inner.querySelector(':scope > .flex.justify-end');
  const formBody=inner.querySelector(':scope > .overflow-y-auto');
  if(formBody)formBody.appendChild(details);else inner.insertBefore(details,footer||error);
  if(footer)inner.insertBefore(error,footer);
  for(const [key,value]of [['engine',d.engine],['onFailure',storedFailure]]){const select=details.querySelector('[data-extra="'+key+'"]');if(select&&value&&!Array.from(select.options).some(option=>option.value===String(value))){const option=document.createElement('option');option.value=String(value);option.textContent='Unsupported saved option: '+String(value);option.dataset.unsupported='true';select.appendChild(option);select.value=String(value);}}
  const collection=modal.querySelector('#cfg-collect-mode');if(collection)for(const [value,label]of [['all','All upstream logs'],['ai-only','AI outputs only'],['errors-only','Failed node logs only']]){const option=document.createElement('option');option.value=value;option.textContent=label;collection.appendChild(option);}
  const modeFields={'cfg-scan-mode':'config.scanType','cfg-language':'config.language','cfg-branch-policy':'branchMissingPolicy','cfg-ai-automation-mode':'automationMode','cfg-ai-source-strategy':'sourceStrategy','cfg-ai-test-mode':'testMode','cfg-ai-provider':'provider','cfg-ai-fallback':'generationFallback','cfg-ai-log-provider':'provider','cfg-ai-log-scope':'summaryScope','cfg-collect-mode':'collectionMode','cfg-runner-stop-node':'stopNodeId','cfg-perf-method':'method','cfg-contract-method':'method','cfg-review-provider':'provider','cfg-review-mode':'mode','cfg-review-execution':'executionMode','cfg-review-lang':'language','cfg-ux-source-mode':'sourceMode','cfg-deploy-target':'target','cfg-deploy-trigger':'trigger','cfg-deploy-branch-policy':'branchMissingPolicy'};
  for(const [id,path]of Object.entries(modeFields)){const select=modal.querySelector('#'+id);let value=path.split('.').reduce((value,key)=>value?.[key],d);if(!select||value==null||value==='')continue;if(id==='cfg-ai-source-strategy')value=({auto:'auto-scan',files:'saved-selection',inline:'prompt-only'})[value]||value;if(!Array.from(select.options).some(option=>option.value===String(value))){const option=document.createElement('option');option.value=String(value);option.textContent='Unsupported saved option: '+String(value);option.dataset.unsupported='true';select.appendChild(option);}select.value=String(value);}
  // Every label targets its control, including the original Machina forms.
  for(const field of modal.querySelectorAll('input,textarea,select')){if(!field.id)field.id='mg-field-'+Math.random().toString(36).slice(2);const adjacent=field.previousElementSibling,groupLabel=field.parentElement?.previousElementSibling;const label=field.closest('label')||field.labels?.[0]||(adjacent?.matches('label')?adjacent:null)||(groupLabel?.matches('label')?groupLabel:null);if(label)label.htmlFor=field.id;}
  const save=Array.from(modal.querySelectorAll('button')).find(button=>/^(Save|Save Configuration)$/i.test(button.textContent.trim()));
  if(save){const original=save.onclick;save.onclick=async event=>{
   const errors=validateConfig(node,modal);if(errors.length){error.textContent=errors.join('\n');return;}
   const before=clone(node);
   try{
    const extras=Object.fromEntries(Array.from(details.querySelectorAll('[data-extra]')).map(field=>[field.dataset.extra,field.type==='checkbox'?field.checked:field.type==='number'?Number(field.value):field.value]));
    if(!Number.isInteger(extras.retryAttempts)||extras.retryAttempts<1||extras.retryAttempts>21)throw Error('Total attempts must be a whole number from 1 to 21 (the first run plus up to 20 retries).');
    const priorRetry=node.retry??node.data.retry;const retry=priorRetry&&typeof priorRetry==='object'?{...priorRetry}:{};if(node.retry!==undefined||extras.retryAttempts!==1||extras.retryDelay!==0)node.retry={...retry,maxAttempts:extras.retryAttempts,backoffMs:extras.retryDelay};node.onFailure=extras.onFailure;node.resources=extras.resources.split(',').map(s=>s.trim()).filter(Boolean);
    for(const key of ['cwd','engine','overwrite','enabled','sourceCode'])if(Object.hasOwn(extras,key))node.data[key]=extras[key];
    await original?.call(save,event);
    context.onChange?.(editor.getGraph());
   }catch(e){Object.keys(node).forEach(key=>delete node[key]);Object.assign(node,before);error.textContent=e.message;}
  };}
  modal.querySelector('input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled)')?.focus();
 }
 function installEditor(){
  const proto=window.VisualEditor?.prototype;if(!proto||proto._machinaEnhanced)return;proto._machinaEnhanced=true;
  for(const name of ['showSecurityNodeConfig','showGitNodeConfig','showUnitTestConfig','showAIUnitTestConfig','showStartRunnerConfig','showAILogSummaryConfig','showLogCollectorConfig','showAPIPerformanceConfig','showAPIContractConfig','showCodeReviewConfig','showWebsiteUXAutoTesterConfig','showPushDeployConfig','showWaitDelayConfig']){
   const original=proto[name];proto[name]=async function(id){installStyles();document.querySelectorAll('.mg-dialog[data-node-type]').forEach(dialog=>dialog.remove());const node=this.nodes.find(n=>n.id===id);if(!node)return;await original.call(this,id);enhanceModal(this,node,Array.from(document.querySelectorAll('.mg-dialog')).at(-1));};
  }
  const suiteConfig=proto.showSuiteNodeConfig;proto.showSuiteNodeConfig=function(id){const node=this.nodes.find(n=>n.id===id),binding=this._machinaContext||context;if(node?.data?.suiteId&&!node.data.suite&&!(this.availableSuites||[]).some(s=>s.id===node.data.suiteId)&&!(window.LVXApp?.getSuites?.()||[]).some(s=>s.id===node.data.suiteId))return relinkSuite(this,id);if(binding.onEditSuite&&node?.data?.suiteId)return binding.onEditSuite(node.data.suiteId);return suiteConfig.call(this,id);};
  const toolbar=proto._renderToolbar;proto._renderToolbar=function(){toolbar.call(this);const controls=this.container.querySelector('#ve-viewport-controls');const make=(name,label,action)=>{const button=document.createElement('button');button.type='button';button.title=label;button.innerHTML=icon(name)+' '+label;button.onclick=action;controls?.appendChild(button);};make('undo','Undo',()=>this.undo());make('redo','Redo',()=>this.redo());make('check','Validate',()=>{const result=window.GraphEngine.validate(this.getGraph());this._showEditorMessage(result.valid?'Graph structure is valid. Runtime checks run before each action.':result.errors.join(' '),result.valid?'success':'error');});
   for(const [id,callback]of [['ve-save-btn','onSave'],['ve-saveas-btn','onSaveAs'],['ve-run-btn','onRun']]){const button=this.container.querySelector('#'+id);if(button)button.onclick=async event=>{event.preventDefault();try{await this[callback]?.(this.getGraph());}catch(error){this._showEditorMessage(error.message,'error');}};}
   for(const item of this.container.querySelectorAll('.ve-palette-item')){item.tabIndex=0;item.setAttribute('role','button');item.title='Add '+item.textContent.trim();const add=()=>{const position=this._calculateNewNodePosition(),rect=this.canvas.getBoundingClientRect();this._handleDrop({preventDefault(){},clientX:rect.left+this.panning.x+(position.x+this.graphOrigin.x)*this.scale,clientY:rect.top+this.panning.y+(position.y+this.graphOrigin.y)*this.scale,dataTransfer:{getData:()=>JSON.stringify({type:item.dataset.type})}});const node=this.nodes.at(-1);if(node){const point=this._graphToViewportPoint(node.position);this.panning.x=Math.min(0,this.canvas.clientWidth-340-point.x*this.scale);this.panning.y=Math.min(0,this.canvas.clientHeight-150-point.y*this.scale);this._applyViewportTransform();}};item.onclick=add;item.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();add();}};}
  };
 }
 function mount(container,options={}){
  installStyles();installEditor();setContext({suites:[],resolveSuite:null,workspaceRoot:null,invoke:null,onEditSuite:null,onChange:null,onRun:null,...options},false);if(typeof container==='string')container=document.getElementById(container);if(!container)throw Error('Graph container is required.');
  if(!container.id)container.id='machina-graph-'+Math.random().toString(36).slice(2);container.classList.remove('hidden');
  const editor=new window.VisualEditor(container.id);editor.init();editor.setAvailableSuites(options.suites||[]);editor.loadGraph(options.workflow||{schemaVersion:1,nodes:[],edges:[]});
  context.editor=editor;editor._machinaContext={...context};
  editor.onSave=async workflow=>{const intent=options.captureSaveContext?.();const safe=await protect(workflow,'Visual workflow');return options.onSave?.(safe,intent);};editor.onSaveAs=async workflow=>{const intent=options.captureSaveContext?.();return options.onSaveAs?.(await protect(workflow,'Visual workflow copy'),intent);};editor.onRun=workflow=>runWorkflow(workflow,{},editor).catch(error=>editor._showEditorMessage(error.message,'error'));editor.onCreateVisualTest=()=>options.onCreateVisualTest?.();editor.onAddTestSuite=()=>options.onAddTestSuite?.();
  container.querySelector('#ve-close-btn').onclick=()=>options.onClose?options.onClose(editor.getGraph()):container.classList.add('hidden');
  const listener=event=>{if(!container.isConnected||container.classList.contains('hidden')||event.target.closest('input,textarea,select,[contenteditable=true]'))return;if(event.ctrlKey||event.metaKey){if(event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?editor.redo():editor.undo();}if(event.key.toLowerCase()==='y'){event.preventDefault();editor.redo();}if(event.key.toLowerCase()==='s'){event.preventDefault();Promise.resolve(editor.onSave(editor.getGraph())).catch(error=>editor._showEditorMessage(error.message,'error'));}}else if(event.key==='Delete'){event.preventDefault();editor.deleteSelectedNode();}};document.addEventListener('keydown',listener);
  if(window.electronAPI?.studioOps)void restorePendingReviews().catch(error=>editor._showEditorMessage(error.message,'error'));
  editor.destroy=()=>{document.removeEventListener('keydown',listener);document.querySelectorAll('.mg-dialog[data-node-type]').forEach(dialog=>dialog.remove());container.innerHTML='';};return editor;
 }
 window.LVXMachinaGraph={closeRunMonitors:()=>{for(const session of [...sessions.values()])session.element.querySelector('[data-run-close]').click();},mount,setContext,invoke,runWorkflow,waitForRun,generatePreview,handleEvent,showReview,restorePendingReviews,sessions,dockItem,clearDock,nodeIcons,capabilities:()=>invoke('capabilities')};
 installEditor();
})();
