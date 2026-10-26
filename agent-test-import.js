/** Review and organize agent exports without executing their source. */
export async function mountAgentTestImport({root,controller,invoke,workspaceRoot,tell,messageId,state,onClose=()=>{}}){
  const document=root.ownerDocument,dialog=document.createElement('dialog');
  dialog.className='ab-save-dialog ab-import-dialog ati-dialog';
  dialog.innerHTML=`<h2>Bring agent tests into LVX</h2>
    <p>Choose the agent's exported <strong>.lvx.json</strong> file. Already saved tests can be reused. Nothing runs during import.</p>
    <label>Exported test files<input type="file" accept=".json" multiple data-import-files></label>
    <details><summary>Find an export in a folder</summary><label>Project folder<input type="file" webkitdirectory multiple data-import-folder></label><div data-import-candidates></div></details>
    <fieldset class="ati-options"><legend>How should these tests appear?</legend>
      <label><input type="radio" name="ati-mode" value="graph" checked> One graph — one green Start button runs all tests</label>
      <label><input type="radio" name="ati-mode" value="library"> Individual tests in the test library</label>
      <label data-graph-name>Graph name<input type="text" maxlength="160" value="Imported agent tests" data-import-name></label>
      <p data-graph-help>Tests stay together inside the graph, instead of filling the test list or node palette. You can inspect each test in the graph.</p>
      <label>If a different version is already saved<select data-import-policy><option value="keep">Keep my saved version</option><option value="replace">Replace it with the reviewed version</option><option value="copy">Keep both — import a copy</option></select></label>
    </fieldset>
    <p data-import-notice role="status" aria-live="polite"></p><div data-import-preview></div>
    <label class="ati-review"><input type="checkbox" data-import-reviewed> I have reviewed these tests and want to import or organize them.</label>
    <footer><button type="button" data-import-close>Cancel</button><button type="button" data-import-commit disabled>Import as one graph</button></footer>`;
  root.append(dialog);
  const q=selector=>dialog.querySelector(selector),notice=q('[data-import-notice]'),preview=q('[data-import-preview]'),commit=q('[data-import-commit]'),reviewed=q('[data-import-reviewed]');
  let previews=[],busy=false,closed=false;
  const mode=()=>q('[name=ati-mode]:checked').value;
  const update=()=>{dialog.setAttribute('aria-busy',String(busy));for(const input of dialog.querySelectorAll('input,select,[data-import-close]'))input.disabled=busy;commit.disabled=busy||!reviewed.checked||!previews.length||(mode()==='graph'&&!q('[data-import-name]').value.trim());commit.textContent=busy?'Please wait…':mode()==='graph'?'Import as one graph':'Import individual tests';q('[data-graph-name]').hidden=q('[data-graph-help]').hidden=mode()!=='graph';};
  const close=()=>{if(busy||closed)return;closed=true;dialog.close();dialog.remove();onClose();};
  q('[data-import-close]').onclick=close;dialog.addEventListener('cancel',event=>{if(event.target!==dialog)return;event.preventDefault();close();});
  const checkResult=result=>{if(result?.__lvxError)throw Error(result.__lvxError.message);return result;};
  async function load(files){if(busy)return;previews=[];preview.replaceChildren();reviewed.checked=false;busy=true;update();notice.textContent='Reading test exports…';
    try{if(!files.length||files.length>25)throw Error('Choose 1–25 exported JSON files.');await controller.ensureSaved();
      for(const file of files){if(file.size>32*1024*1024)throw Error('Choose JSON exports smaller than 32 MB.');const result=checkResult(await invoke('previewGeneratedTests',{workspaceRoot,boardId:state.record.id,filename:file.name,text:await file.text()}));previews.push(result);
        const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=file.name+' · '+(result.logicalTestCount??((result.counts.suites||0)+(result.counts.checks||0)))+' tests · '+(result.identicalCount||0)+' saved records reused'+(result.differentCount?' · '+result.differentCount+' different versions':'');details.append(summary);details.addEventListener('toggle',()=>{if(details.open&&!details.querySelector('pre')){const source=document.createElement('pre');source.textContent=JSON.stringify(result.records,null,2);details.append(source);}});preview.append(details);
      }
      if(q('[data-import-name]').value==='Imported agent tests'){const first=previews[0],workflow=first.records.find(r=>r.collection==='workflows');q('[data-import-name]').value=(workflow?.value.name||first.filename.replace(/\.(lvx\.)?json$/i,'')).slice(0,160);}
      const reused=previews.reduce((sum,p)=>sum+(p.identicalCount||0),0),different=previews.reduce((sum,p)=>sum+(p.differentCount||0),0);
      notice.textContent=(reused?'Already saved tests will be reused; this is not an error. ':'')+(different?'Choose how to handle the '+different+' different saved versions above. ':'')+'Review the test source below, then tick the checkbox and import.';
    }catch(error){previews=[];notice.textContent=error.message;}finally{busy=false;update();}
  }
  q('[data-import-files]').onchange=event=>void load([...event.target.files]);
  q('[data-import-folder]').onchange=event=>{if(busy)return;const files=[...event.target.files].filter(file=>/\.json$/i.test(file.name)&&!/(?:^|\/)(?:node_modules|\.git|\.unlazy|output)(?:\/|$)/.test(file.webkitRelativePath));const preferred=files.filter(file=>/\.lvx\.json$|lvx.*\.json$|showcase.*\.json$/i.test(file.name)),candidates=q('[data-import-candidates]');candidates.replaceChildren();const choices=(preferred.length?preferred:files).slice(0,50);notice.textContent=choices.length?'Choose one export below. Selecting a folder does not import every file in it.':'No exported JSON found. Ask the agent to export its tests as an .lvx.json file.';for(const file of choices){const button=document.createElement('button');button.type='button';button.textContent=file.webkitRelativePath||file.name;button.onclick=()=>void load([file]);candidates.append(button);}};
  reviewed.onchange=update;q('[data-import-name]').oninput=update;for(const radio of dialog.querySelectorAll('[name=ati-mode]'))radio.onchange=update;
  commit.onclick=async()=>{if(commit.disabled||busy)return;busy=true;update();notice.textContent='Saving your reviewed tests…';try{const result=checkResult(await invoke('importGeneratedTests',{workspaceRoot,boardId:state.record.id,tokens:previews.map(p=>p.token),reviewed:true,mode:mode(),bundleName:q('[data-import-name]').value.trim(),duplicatePolicy:q('[data-import-policy]').value}));const summary=result.logicalTestCount+' tests '+(result.bundleId?'organized in one graph':'saved in the test library')+'. Nothing has run yet.';tell(summary);busy=false;dialog.replaceChildren();const title=document.createElement('h2'),text=document.createElement('p'),footer=document.createElement('footer'),done=document.createElement('button');title.textContent='Your tests are ready';text.textContent=summary;done.type='button';done.textContent='Done';done.onclick=close;footer.append(done);if(result.bundleId){const open=document.createElement('button');open.type='button';open.dataset.importOpenGraph=result.bundleId;open.textContent='Open graph';open.onclick=()=>{close();globalThis.LVXStudio?.openGraph(result.bundleId);};footer.append(open);}dialog.append(title,text,footer);
    }catch(error){notice.textContent=error.message;busy=false;update();}
  };
  dialog.showModal();const message=state.messages?.find(message=>message.id===messageId);if(message)await load([{name:'Agent reply',size:new TextEncoder().encode(message.text).length,text:async()=>message.text}]);return close;
}
