/* Interactive review sessions operate on persisted native proposals and explicit decisions. */
(() => {
 'use strict';
 const sessions=new Map(),clone=value=>JSON.parse(JSON.stringify(value)),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const icon=name=>window.LVXIcons?.svg(name)||'';
 function diffLines(original,modified){
  const left=String(original).split('\n'),right=String(modified).split('\n');let prefix=0,suffix=0;
  while(prefix<left.length&&prefix<right.length&&left[prefix]===right[prefix])prefix++;
  while(suffix<left.length-prefix&&suffix<right.length-prefix&&left[left.length-1-suffix]===right[right.length-1-suffix])suffix++;
  const rows=[];for(let i=0;i<prefix;i++)rows.push({kind:'same',text:left[i]});
  for(let i=prefix;i<left.length-suffix;i++)rows.push({kind:'removed',text:left[i]});
  for(let i=prefix;i<right.length-suffix;i++)rows.push({kind:'added',text:right[i]});
  for(let i=left.length-suffix;i<left.length;i++)rows.push({kind:'same',text:left[i]});return rows;
 }
 function open(request,options={}){
  if(!request?.decisionId||!request.id)throw Error('A persisted run and review decision are required.');
  if(sessions.has(request.decisionId))return sessions.get(request.decisionId);
  const proposal=request.proposal||{},config=options.nodeConfig||{};
  const state={currentCode:String(proposal.sourceCode??config.sourceCode??''),suggestion:String(proposal.finalCode??proposal.generatedCode??''),language:proposal.language||config.language||'html',history:clone(config.history||[]),currentIndex:-1,busy:false,finished:false};
  state.history.push({prompt:proposal.instructions||config.instructions||'',originalCode:state.currentCode,suggestedCode:state.suggestion,timestamp:new Date().toISOString(),status:'pending',decisionId:request.decisionId});state.currentIndex=state.history.length-1;
  const element=document.createElement('section');element.className='mg-review';element.dataset.decisionId=request.decisionId;element.setAttribute('role','dialog');element.setAttribute('aria-modal','true');element.setAttribute('aria-label','Code review and approval');
  element.innerHTML=`<header><h2>${esc(config.name||'Review generated code')}</h2><span>${esc(state.language)}</span><button data-cr="minimize">${icon('minus')} Minimize</button><button data-cr="close">${icon('close')} Close</button></header><div class="mg-review-body"><p>Inspect the source and proposed changes. Accepting a suggestion updates your working copy. Approve finishes this native review decision.</p><div class="mg-review-columns"><label>Current source<textarea data-cr="source" spellcheck="false"></textarea></label><label>Proposed code<textarea data-cr="suggestion" spellcheck="false"></textarea></label></div><details open><summary>Changes from current source</summary><pre data-cr="diff"></pre></details><details><summary>Sandbox preview</summary><p>Preview is isolated from the app and blocks external requests.</p><iframe data-cr="preview" title="Isolated code preview" sandbox="allow-scripts"></iframe><pre data-cr="text-preview"></pre></details><label>Instructions for the next suggestion<textarea data-cr="prompt" rows="3"></textarea></label><div class="mg-history" data-cr="history"></div><div><button data-cr="generate">${icon('robot')} Generate suggestion</button><button data-cr="accept">${icon('check')} Accept suggestion</button><button data-cr="retry">${icon('refresh')} Retry</button><button data-cr="iterate">${icon('edit')} Iterate</button><button data-cr="discard">${icon('trash')} Discard suggestion</button></div><details><summary>Session history and native proposal</summary><pre data-cr="evidence"></pre></details><p data-cr="status" role="status"></p></div><footer><button data-cr="approve" class="mg-primary">${icon('check')} Approve code and continue</button><button data-cr="deploy">${icon('upload')} Approve code and deployment</button><button data-cr="reject">${icon('close')} Reject and stop this step</button></footer>`;
  document.body.appendChild(element);const field=name=>element.querySelector(`[data-cr="${name}"]`);
  const session={request:clone(request),state,element,options};sessions.set(request.decisionId,session);
  const invoke=(action,payload)=>options.invoke?options.invoke(action,payload):window.LVXMachinaGraph.invoke(action,payload);
  field('source').value=state.currentCode;field('suggestion').value=state.suggestion;field('prompt').value=config.instructions||proposal.instructions||'';
  function status(text,error=false){field('status').textContent=text;field('status').style.color=error?'#b42318':'';}
  function preview(code){const frame=field('preview'),plain=field('text-preview');if(!['html','css','javascript'].includes(state.language)){frame.hidden=true;plain.hidden=false;plain.textContent=code;return;}frame.hidden=false;plain.hidden=true;const csp=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;let body=code;if(state.language==='css')body='<style>'+code+'</style><p>CSS preview</p>';if(state.language==='javascript')body='<pre id="output"></pre><script>'+code.replace(/<\/script/gi,'<\\/script')+'<\/script>';frame.srcdoc=csp+body;}
  function paint(){
   const source=field('source').value,suggestion=field('suggestion').value;
   field('diff').innerHTML=diffLines(source,suggestion).map(line=>`<div class="mg-diff-${line.kind}">${line.kind==='added'?'+':line.kind==='removed'?'-':' '} ${esc(line.text)}</div>`).join('');
   field('history').innerHTML='';state.history.forEach((entry,index)=>{const button=document.createElement('button');button.textContent=`${index+1} · ${entry.status||entry.decision||'saved'}`;button.title=entry.prompt||entry.decidedAt||'Saved review';button.setAttribute('aria-current',String(index===state.currentIndex));button.onclick=()=>{state.currentIndex=index;field('suggestion').value=entry.suggestedCode??entry.finalCode??'';paint();};field('history').appendChild(button);});
   field('evidence').textContent=JSON.stringify({request,history:state.history},null,2);preview(suggestion);
  }
  function busy(value){state.busy=value;element.querySelectorAll('button').forEach(button=>{if(!['minimize','close'].includes(button.dataset.cr))button.disabled=value||state.finished;});}
  async function generate(prompt,source){
   if(!prompt.trim()){status('Describe the changes to generate.',true);return;}
   busy(true);status('Generating a new suggestion through the native service…');
   try{
    const node={id:request.nodeId,type:request.kind==='ai-unit-test'?'ai-unit-test':'code-review',data:{...config,sourceStrategy:source.trim()?'inline':'prompt-only',sourceCode:source,instructions:prompt,language:state.language}};
    if(!window.LVXCredentials?.protect)throw Error('Credential protection is unavailable. Open Setup & diagnostics before generating code.');
    const safe=await window.LVXCredentials.protect(node,'Code review generation');
    const result=await invoke('generatePreview',{node:safe});const code=result.code||result.generatedCode;if(typeof code!=='string'||!code.trim())throw Error('No usable suggestion was generated.');
    state.history.push({prompt,originalCode:source,suggestedCode:code,timestamp:result.generatedAt||new Date().toISOString(),status:'pending'});state.currentIndex=state.history.length-1;state.suggestion=code;field('suggestion').value=code;paint();status('Suggestion ready. Review the changes before approving.');
   }catch(error){status(error.message,true);}finally{busy(false);}
  }
  function accept(){const entry=state.history[state.currentIndex];if(entry)entry.status='accepted';state.currentCode=field('suggestion').value;field('source').value=state.currentCode;paint();status('Suggestion accepted into the working copy. The run is still waiting for your final approval.');}
  async function decide(decision,deployRequested=false){
   if(state.finished||state.busy)return;
   const finalCode=field('source').value;
   if(decision==='approve'&&!finalCode.trim()){status('Accept the suggestion or enter source code before approving.',true);return;}
   if(deployRequested&&!window.confirm('Approve this code and explicitly authorize the connected deployment step?'))return;
   busy(true);status('Persisting your review decision…');
   try{
    const response=await invoke('reviewDecision',{id:request.id,decisionId:request.decisionId,decision,finalCode:decision==='approve'?finalCode:undefined,deployRequested,history:state.history});
    if(response?.decisionId!==request.decisionId||response.decision!==decision||!response.decidedAt)throw Error('The native service did not confirm a persisted review decision.');
    state.finished=true;options.onComplete?.({...response,finalCode,history:clone(state.history)});element.remove();window.LVXMachinaGraph?.clearDock('review:'+request.decisionId);sessions.delete(request.decisionId);
   }catch(error){status(error.message,true);}finally{if(!state.finished)busy(false);}
  }
  field('source').oninput=paint;field('suggestion').oninput=paint;
  field('generate').onclick=()=>generate(field('prompt').value,field('source').value);
  field('accept').onclick=accept;
  field('retry').onclick=()=>{const entry=state.history[state.currentIndex];if(entry){entry.status='rejected';paint();return generate(entry.prompt,entry.originalCode);}};
  field('iterate').onclick=()=>{const entry=state.history[state.currentIndex];if(entry)entry.status='iterated';accept();return generate(field('prompt').value,field('source').value);};
  field('discard').onclick=()=>{const entry=state.history[state.currentIndex];if(entry)entry.status='rejected';field('suggestion').value=field('source').value;paint();status('Suggestion discarded.');};
  field('approve').onclick=()=>decide('approve');field('deploy').onclick=()=>decide('approve',true);field('reject').onclick=()=>decide('reject');
  field('minimize').onclick=()=>{element.classList.add('hidden');window.LVXMachinaGraph?.dockItem('review:'+request.decisionId,config.name||'Code review · waiting',()=>element.classList.remove('hidden'));};
  field('close').onclick=()=>{if(!state.finished){field('minimize').click();return;}element.remove();sessions.delete(request.decisionId);window.LVXMachinaGraph?.clearDock('review:'+request.decisionId);};
  session.settle=statusValue=>{state.finished=true;busy(true);status(`Run ${statusValue}. This review is closed for further decisions.`);field('source').readOnly=true;field('suggestion').readOnly=true;};
  session.decide=decide;session.paint=paint;session.generate=generate;paint();field('source').focus();return session;
 }
 window.LVXCodeReview={open,sessions,diffLines,settleRun:(id,status)=>{for(const session of sessions.values())if(session.request.id===id)session.settle(status);}};
 window.minimizeCodeReviewSession=id=>sessions.get(id)?.element.querySelector('[data-cr="minimize"]').click();
 window.restoreCodeReviewSession=id=>{sessions.get(id)?.element.classList.remove('hidden');window.LVXMachinaGraph?.clearDock('review:'+id);};
 window.closeCodeReviewSession=id=>sessions.get(id)?.decide('reject');
 window.openCodeReviewModal=(config,context,onComplete)=>open(context?.reviewRequest||context,{nodeConfig:config,onComplete});
})();
