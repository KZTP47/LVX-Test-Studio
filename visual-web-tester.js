// Robot uses two or more spaces (or a tab) between cells. Escape literals so
// user text cannot accidentally create extra cells, variables or physical rows.
function vwtRobotCell(value) {
    const text = String(value ?? '');
    return text === '' ? '${EMPTY}' : text.replace(/\\/g, '\\\\').replace(/\$/g, '\\$').replace(/#/g, '\\#')
        .replace(/ /g, '\\x20').replace(/\t/g, '\\t').replace(/\r/g, '\\r');
}
function vwtRobotRow(keyword, ...args) {
    const prelude = [];
    const cells = args.map((value, index) => {
        const lines = String(value ?? '').split('\n');
        if (lines.length === 1) return vwtRobotCell(value);
        const variable = '${lvx_arg_' + index + '}';
        prelude.push(`    ${variable}=    Catenate    SEPARATOR=\\n`);
        lines.forEach(line => prelude.push(`    ...    ${vwtRobotCell(line)}`));
        return variable;
    });
    return [...prelude, `    ${keyword}${cells.length ? '    ' + cells.join('    ') : ''}`].join('\n');
}


// ============================================
// VISUAL WEB TESTER (VWT)
// A self-contained module for the new
// no-code web testing environment.
// ============================================

// --- VWT State ---
let vwt_files = { html: null, css: [], js: [] };
let vwt_target = null;
let vwt_targetBusy = false;
let vwt_sourceMode = 'files';
let vwt_targetEdited = false;
let vwt_targetGeneration = 0;
let vwt_operationTicket = 0;
let vwt_stoppingProject = false;
const vwt_sourceRuntime = new Map(); // Live status is never serialized into a saved target.
let vwt_saveInProgress = false;
let vwt_steps = [];
let vwt_selectedStepIndex = null;
let vwt_dragStartIndex = null;
let vwt_editingSuiteId = null;
let vwt_elementPicker = null; // Picker instance
let vwt_debugMode = false; // Debug mode state
const vwt_remoteSessions = new WeakMap();
const vwt_previewGenerations = new WeakMap();
const vwt_previewSources = new WeakMap();
async function vwt_previewInvoke(action,payload){
  const result=await window.electronAPI.previewOps.invoke(action,payload);
  if(result?.__lvxError){const error=new Error(result.__lvxError.message);error.code=result.__lvxError.code;error.details=result.__lvxError.details;throw error;}
  return result;
}
function vwt_staticHTML(html,websiteTarget=false) {
  // Same-origin DOM access is required by the picker, but uploaded scripts never execute here.
  const assets=websiteTarget?' http: https:':'';
  return '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;'+assets+'; img-src data: blob:'+assets+'; font-src data:'+assets+'; frame-src &#39;none&#39;; object-src &#39;none&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">' + String(html || '');
}
window.LVXPreviewStaticHTML = vwt_staticHTML;
function vwt_setStaticPreview(iframe, html,websiteTarget=false) {
  iframe.setAttribute?.('sandbox', 'allow-same-origin');
  iframe.setAttribute?.('referrerpolicy', 'no-referrer');
  iframe.title='Static visual snapshot. Uploaded scripts and test steps run in an isolated desktop process.';
  if(iframe.id==='vwt-iframe'&&iframe.parentElement&&!document.getElementById('vwt-isolation-notice')){
    const notice=document.createElement('div');notice.id='vwt-isolation-notice';notice.className='text-xs aero-text-muted p-2';notice.setAttribute('role','status');
    const text=document.createElement('span');text.textContent='Safe visual snapshot · Select elements here. Run test steps to interact with the website. ';notice.appendChild(text);
    if(typeof window.electronAPI?.previewOps?.invoke==='function'){
      const button=document.createElement('button');button.type='button';button.className='aero-button px-2 py-1 rounded';button.textContent='Open interactive preview';
      button.onclick=async()=>{try{const id=vwt_remoteSessions.get(iframe);if(!id)throw Error('Reload Preview first.');await vwt_previewInvoke('show',{id});}catch(error){window.showMessage?.(error.message,'error');}};notice.appendChild(button);
    }
    iframe.parentElement.insertBefore(notice,iframe);
  }
  iframe.src = 'about:blank';
  iframe.srcdoc = vwt_staticHTML(html,websiteTarget);
}
async function vwt_closeRemote(iframe) {
  const id=vwt_remoteSessions.get(iframe);vwt_remoteSessions.delete(iframe);
  if(id)try{await vwt_previewInvoke('close',{id});}catch(error){console.warn('Isolated preview already closed:',error.message);}
}
async function vwt_openRemote(iframe, source) {
  vwt_previewSources.set(iframe,source);
  if(typeof window.electronAPI?.previewOps?.invoke!=='function'){const error=new Error('Interactive visual tests require the LVX desktop application. This embedded preview is static and does not execute uploaded scripts.');error.code='PREVIEW_UNAVAILABLE';throw error;}
  const generation=(vwt_previewGenerations.get(iframe)||0)+1;vwt_previewGenerations.set(iframe,generation);
  await vwt_closeRemote(iframe);
  const result=await vwt_previewInvoke('open',typeof source==='string'?{html:source}:{target:source});
  if(vwt_previewGenerations.get(iframe)!==generation){await vwt_previewInvoke('close',{id:result.id});throw new Error('Preview replaced by a newer upload');}
  vwt_remoteSessions.set(iframe,result.id);vwt_setStaticPreview(iframe,result.html,result.websiteTarget||typeof source!=='string');return result;
}
async function vwt_executeRemoteStep(step,iframe,log) {
  const id=vwt_remoteSessions.get(iframe);if(!id)throw new Error('Reload the isolated interactive preview before running a step');
  try {
    const result=await vwt_previewInvoke('step',{id,name:step.name,params:step.params||{}});
    for(const message of result.logs||[])log(message);vwt_setStaticPreview(iframe,result.html,result.websiteTarget||typeof vwt_previewSources.get(iframe)!=='string');return result;
  }catch(error){if(error.details?.evidence?.diffImageData)window.showScreenshotComparison?.(error.details.evidence,step.params?.name);throw error;}
}

// --- VWT Config ---
const vwt_availableSteps = [
  {
    name: 'Click Element',
    description: 'Clicks an element.',
    icon: window.LVXIcons?.svg('pointer') || '',
    params: [{ key: 'selector', label: 'CSS Selector', type: 'text', placeholder: 'e.g., #submit-button' }],
    execute: (params, iframeWin, log) => {
      const el = iframeWin.document.querySelector(params.selector);
      if (!el) throw new Error(`Element not found: ${params.selector}`);
      el.click();
      log(` Clicked element: ${params.selector}`);
    },
    robot: (p) => ` Click Element ${p.selector}`
  },
  {
    name: 'Input Text',
    description: 'Types text into a field.',
    icon: window.LVXIcons?.svg('edit') || '',
    params: [
      { key: 'selector', label: 'CSS Selector', type: 'text', placeholder: 'e.g., input[name="username"]' },
      { key: 'text', label: 'Text to Input', type: 'textarea', placeholder: 'e.g., john_doe' }
    ],
    execute: (params, iframeWin, log) => {
      const el = iframeWin.document.querySelector(params.selector);
      if (!el) throw new Error(`Element not found: ${params.selector}`);
      // Safety check for value property
      if ('value' in el) {
        el.value = params.text;
        el.dispatchEvent(new iframeWin.Event('input', { bubbles: true }));
        log(` Input text into ${params.selector}: ${params.text.length > 50 ? params.text.substring(0, 50) + '...' : params.text}`);
      } else {
        log(` Warning: Element ${params.selector} does not support value property.`);
      }
    },
    robot: (p) => {
      const indentedText = p.text.replace(/^/gm, ' ');
      return ` Input Text ${p.selector} """\n${indentedText}\n """`;
    }
  },
  {
    name: 'Element Should Contain',
    description: 'Verifies element text.',
    icon: window.LVXIcons?.svg('eye') || '',
    params: [
      { key: 'selector', label: 'CSS Selector', type: 'text', placeholder: 'e.g., h1' },
      { key: 'text', label: 'Expected Text', type: 'text', placeholder: 'e.g., Welcome' }
    ],
    execute: (params, iframeWin, log) => {
      const el = iframeWin.document.querySelector(params.selector);
      if (!el) throw new Error(`Element not found: ${params.selector}`);
      if (!el.textContent.includes(params.text)) {
        throw new Error(`Assertion Failed: Element ${params.selector} does not contain "${params.text}". Actual: "${el.textContent}"`);
      }
      log(` Element ${params.selector} contains "${params.text}"`);
    },
    robot: (p) => ` Element Should Contain ${p.selector} ${p.text}`
  },
  {
    name: 'Wait For Element',
    description: 'Waits for an element.',
    icon: window.LVXIcons?.svg('clock') || '',
    params: [
      { key: 'selector', label: 'CSS Selector', type: 'text', placeholder: 'e.g., #results' },
      { key: 'timeout', label: 'Timeout (ms)', type: 'number', placeholder: '5000' }
    ],
    execute: async (params, iframeWin, log) => {
      const timeout = parseInt(params.timeout, 10) || 5000;
      const startTime = Date.now();
      while (Date.now() - startTime < timeout) {
        if (iframeWin.document.querySelector(params.selector)) {
          log(` Waited for and found element: ${params.selector}`);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`Wait timed out after ${timeout}ms for element: ${params.selector}`);
    },
    robot: (p) => ` Wait For Element ${p.selector} timeout=${(parseInt(p.timeout, 10) || 5000) / 1000}s`
  },
  {
    name: 'Save Screenshot Baseline',
    description: 'Saves current state as baseline for comparison.',
    icon: window.LVXIcons?.svg('image') || '',
    params: [
      { key: 'name', label: 'Screenshot Name', type: 'text', placeholder: 'e.g., homepage-initial' }
    ],
    execute: async (params, iframeWin, log) => {
      await window.advancedAssertions.saveBaseline(iframeWin, params.name);
      log(` Saved screenshot baseline: ${params.name}`);
    },
    robot: (p) => `    # Screenshot baseline saved: ${p.name}`
  },
  {
    name: 'Compare Screenshot',
    description: 'Compares current state with baseline.',
    icon: window.LVXIcons?.svg('search') || '',
    params: [
      { key: 'name', label: 'Baseline Name', type: 'text', placeholder: 'e.g., homepage-initial' },
      { key: 'threshold', label: 'Diff Threshold %', type: 'number', placeholder: '5' }
    ],
    execute: async (params, iframeWin, log) => {
      const rawThreshold = params.threshold == null || String(params.threshold).trim() === '' ? 5 : Number(params.threshold);
      if (!Number.isFinite(rawThreshold) || rawThreshold < 0 || rawThreshold > 100) throw new Error('Screenshot threshold must be between 0 and 100 percent');
      const threshold = rawThreshold / 100;
      const result = await window.advancedAssertions.compareWithBaseline(iframeWin, params.name, threshold);

      if (result.passed) {
        log(` Screenshot matches baseline: ${params.name} (diff: ${result.diffPercentage.toFixed(2)}%)`);
      } else {
        log(` Screenshot differs from baseline: ${params.name} (diff: ${result.diffPercentage.toFixed(2)}%)`);

        // Show comparison modal
        window.showScreenshotComparison(result, params.name);

        throw new Error(`Visual regression detected: ${result.diffPercentage.toFixed(2)}% difference`);
      }
    },
    robot: (p) => `    # Screenshot comparison: ${p.name}`
  },
  {
    name: 'Check Performance',
    description: 'Measures and validates page performance.',
    icon: window.LVXIcons?.svg('bolt') || '',
    params: [
      { key: 'maxLoadTime', label: 'Max Load Time (ms)', type: 'number', placeholder: '3000' }
    ],
    execute: async (params, iframeWin, log) => {
      const perf = await window.advancedAssertions.measurePerformance(iframeWin);
      const maxTime = parseInt(params.maxLoadTime) || 3000;

      log(` Performance Metrics:`);
      log(`  - DOM Content Loaded: ${perf.domContentLoaded}ms`);
      log(`  - Load Complete: ${perf.loadComplete}ms`);
      log(`  - DOM Interactive: ${perf.domInteractive}ms`);
      log(`  - Resources Loaded: ${perf.resourceCount}`);

      if (perf.loadComplete > maxTime) {
        throw new Error(`Page load time (${perf.loadComplete}ms) exceeds max allowed (${maxTime}ms)`);
      }

      log(` Performance check passed (load time: ${perf.loadComplete}ms)`);
    },
    robot: (p) => `    # Performance check: max ${p.maxLoadTime}ms`
  },
  {
    name: 'Check Accessibility',
    description: 'Runs basic accessibility checks.',
    icon: window.LVXIcons?.svg('accessibility') || '',
    params: [],
    execute: async (params, iframeWin, log) => {
      const result = await window.advancedAssertions.checkAccessibility(iframeWin);

      log(` Accessibility Check Results:`);
      log(`  - Errors: ${result.errorCount}`);
      log(`  - Warnings: ${result.warningCount}`);

      if (result.issues.length > 0) {
        log(`\nIssues Found:`);
        result.issues.forEach(issue => {
          const icon = issue.type === 'error' ? 'Error:' : 'Warning:';
          log(`  ${icon} ${issue.rule} - ${issue.element} (${issue.wcag})`);
        });
      }

      if (!result.passed) {
        throw new Error(`Accessibility errors found: ${result.errorCount} error(s)`);
      }

      log(` Accessibility check passed`);
    },
    robot: (p) => `    # Accessibility check`
  }
];

// --- VWT Modal Management (Creator) ---

vwt_availableSteps.forEach(config => {
  config.robot = p => {
    switch (config.name) {
      case 'Click Element': return vwtRobotRow('Click Element', p.selector);
      case 'Input Text': return vwtRobotRow('Input Text', p.selector, p.text);
      case 'Element Should Contain': return vwtRobotRow('Element Should Contain', p.selector, p.text);
      case 'Wait For Element': return vwtRobotRow('Wait For Element', p.selector, String((Number(p.timeout) || 5000) / 1000));
      default: return vwtRobotRow('Fail', `${config.name} requires the Visual Web Tester runtime; run this saved visual suite in LVX Test Studio.`);
    }
  };
});

function openVisualWebTester() {
  vwt_targetGeneration++;
  vwt_clearCreatorPreview();
  vwt_editingSuiteId = null;
  vwt_target = null;vwt_sourceMode='files';vwt_targetBusy=false;vwt_targetEdited=false;vwt_stoppingProject=false;
  vwt_files = { html: null, css: [], js: [] };
  vwt_steps = [];
  vwt_selectedStepIndex = null;
  vwt_updateFilesPreview();
  document.getElementById('vwt-iframe').src = 'about:blank';
  document.getElementById('vwt-iframe').srcdoc = '';
  document.getElementById('vwt-logs').value = '';
  for(const id of ['vwt-html-file','vwt-css-files','vwt-js-files','vwt-project-files','vwt-update-file']){const el=document.getElementById(id);if(el)el.value='';}
  vwt_setSourceMode('files');
  const address=document.getElementById('vwt-website-url');if(address)address.value='';
  vwt_targetNotice('Choose Files or folder, Website URL, or Git repository to begin.');vwt_updateWebsiteActions();
  vwt_initializeToolbox();
  vwt_renderCanvas();
  vwt_renderPropertiesPanel();
  document.getElementById('visual-web-tester-modal').classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function openVisualWebTesterForEdit(suite) {
  if (!suite) return;
  vwt_targetGeneration++;vwt_targetBusy=false;vwt_stoppingProject=false;
  vwt_clearCreatorPreview();vwt_targetNotice('Loading this test’s website…');
  vwt_editingSuiteId = suite.id;
  vwt_files.html = suite.website_html_content || null;
  vwt_files.css = suite.website_css_contents || [];
  vwt_files.js = suite.website_js_contents || [];
  vwt_target=suite.website_target?JSON.parse(JSON.stringify(suite.website_target)):suite.website_url?{version:1,kind:'url',url:suite.website_url}:null;
  vwt_targetEdited=false;
  vwt_setSourceMode(vwt_target?.source?.type==='repository'?'repository':vwt_target?.kind==='url'&&!vwt_target?.source?'url':'files');
  if(document.getElementById('vwt-repository-url'))document.getElementById('vwt-repository-url').value=vwt_target?.source?.repository||'';
  if(document.getElementById('vwt-repository-ref'))document.getElementById('vwt-repository-ref').value=vwt_target?.source?.ref||'';
  if(document.getElementById('vwt-website-url'))document.getElementById('vwt-website-url').value=vwt_target?.kind==='url'&&!vwt_target.source?vwt_target.url||'':'';
  vwt_selectedStepIndex = null;
  try {
    vwt_steps = suite.vwt_steps_json ? JSON.parse(suite.vwt_steps_json) : [];
  } catch (e) {
    console.error("Failed to parse vwt_steps_json:", e);
    vwt_steps = [];
  }
  vwt_initializeToolbox();
  vwt_updateFilesPreview();
  vwt_renderCanvas();
  vwt_renderPropertiesPanel();
  const generation=vwt_targetGeneration;
  vwt_renderIframe().catch(error=>{if(generation===vwt_targetGeneration){vwt_targetNotice(error.message,true);window.showMessage?.(error.message,'error');}});
  const logArea = document.getElementById('vwt-logs');
  if (logArea) logArea.value = `Loaded suite "${suite.name}" for editing.\n`;
  document.getElementById('visual-web-tester-modal').classList.remove('hidden');
  document.body.classList.add('modal-open');
}
function vwt_clearCreatorPreview(){
  for(const id of ['vwt-suite-save-dialog','vwt-file-path-dialog'])document.getElementById(id)?.close?.();
  const iframe=document.getElementById('vwt-iframe');if(!iframe)return;
  vwt_previewGenerations.set(iframe,(vwt_previewGenerations.get(iframe)||0)+1);vwt_closeRemote(iframe);vwt_previewSources.delete(iframe);
  iframe.src='about:blank';iframe.srcdoc='';vwt_elementPicker?.deactivate();
}

function closeVisualWebTester() {
  vwt_targetGeneration++;
  document.getElementById('visual-web-tester-modal').classList.add('hidden');
  document.body.classList.remove('modal-open');
  const iframe = document.getElementById('vwt-iframe');
  vwt_previewGenerations.set(iframe,(vwt_previewGenerations.get(iframe)||0)+1);
  vwt_closeRemote(iframe);
  iframe.src = 'about:blank';
  iframe.srcdoc = '';
  if (vwt_elementPicker) {
    vwt_elementPicker.deactivate();
  }
}

// --- VWT File and Iframe Logic (Creator) ---

function vwt_updateFilesPreview() {
  const preview = document.getElementById('vwt-files-preview');
  if (!preview) return;
  if(vwt_target||document.getElementById('vwt-source-kind')){vwt_renderTargetControls();return;}
  let finalPreview = '';
  if (vwt_files.html) finalPreview += ` HTML loaded<br>`;
  if (vwt_files.css && vwt_files.css.length > 0) finalPreview += ` ${vwt_files.css.length} CSS file(s) loaded<br>`;
  if (vwt_files.js && vwt_files.js.length > 0) finalPreview += ` ${vwt_files.js.length} JS file(s) loaded<br>`;
  preview.innerHTML = finalPreview === '' ? 'Upload files to begin...' : '<strong>Loaded Files:</strong><br>' + finalPreview;
}

async function vwt_handleFileUpload(input, type) {
  if(document.getElementById('vwt-source-kind'))return vwt_addFiles(input);
  const files = input.files;
  if (!files || files.length === 0) return;
  if (type === 'html') {
    vwt_files.html = await vwt_readFileAsText(files[0]);
  } else {
    vwt_files[type] = [];
    for (let file of files) {
      const content = await vwt_readFileAsText(file);
      vwt_files[type].push({ name: file.name, content });
    }
  }
  vwt_updateFilesPreview();
  if (vwt_files.html) {
    try{await vwt_renderIframe();}catch(error){window.showMessage?.(error.message,'error');}
  }
}

function vwt_readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsText(file);
  });
}

// A target keeps the original file tree. Scripts, imports and assets resolve at
// their real paths in the isolated website process, never inside the app UI.
function vwt_setSourceMode(mode){
  vwt_sourceMode=['files','repository','url'].includes(mode)?mode:'files';
  const select=document.getElementById('vwt-source-kind');if(select)select.value=vwt_sourceMode;
  const modal=document.getElementById('visual-web-tester-modal');if(modal)modal.dataset.vwtSourceMode=vwt_sourceMode;
  for(const button of document.querySelectorAll?.('[data-vwt-source]')||[])button.setAttribute('aria-pressed',String(button.dataset.vwtSource===vwt_sourceMode));
  for(const name of ['files','repository','url']){const panel=document.getElementById('vwt-source-'+name);if(panel)panel.hidden=name!==vwt_sourceMode;}
}
function vwt_targetNotice(message,error=false){
  const el=document.getElementById('vwt-source-status');if(el){el.textContent=message;el.dataset.error=String(error);}
}
function vwt_formDialog({id,title,fields,submitLabel='Save'}){
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.id=id;dialog.className='vwt-form-dialog aero-modal';dialog.setAttribute('aria-labelledby',id+'-title');
    const form=document.createElement('form'),heading=document.createElement('h3');heading.id=id+'-title';heading.textContent=title;form.appendChild(heading);
    const inputs={};for(const field of fields){const label=document.createElement('label');label.htmlFor=field.id;label.textContent=field.label;const input=document.createElement(field.multiline?'textarea':'input');input.id=field.id;input.name=field.key;input.className='aero-input';if(!field.multiline)input.type='text';input.value=field.value||'';input.required=!!field.required;input.maxLength=field.multiline?2000:240;inputs[field.key]=input;form.appendChild(label);form.appendChild(input);}
    const actions=document.createElement('div');actions.className='vwt-dialog-actions';const cancel=document.createElement('button');cancel.id=id.replace('-dialog','-cancel');cancel.type='button';cancel.className='aero-button-gray';cancel.textContent='Cancel';const submit=document.createElement('button');submit.id=id.replace('-dialog','-confirm');submit.type='submit';submit.className='aero-button-primary';submit.textContent=submitLabel;actions.appendChild(cancel);actions.appendChild(submit);form.appendChild(actions);dialog.appendChild(form);document.body.appendChild(dialog);
    let settled=false;const finish=result=>{if(settled)return;settled=true;dialog.close();dialog.remove();resolve(result);};
    form.addEventListener('submit',event=>{event.preventDefault();for(const field of fields){const input=inputs[field.key];if(field.required&&!input.value.trim()){input.setCustomValidity?.('Enter a value.');input.reportValidity?.();input.focus();return;}input.setCustomValidity?.('');}finish(Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value.trim()])));});
    cancel.addEventListener('click',()=>finish(null));dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});dialog.addEventListener('close',()=>finish(null));dialog.showModal();Object.values(inputs)[0]?.focus();
  });
}
function vwt_allowSourceChange(){if(!vwt_targetBusy)return true;vwt_targetNotice('Wait for the current website operation, or use Stop project website to cancel startup.',true);return false;}
function vwt_path(value){
  const path=String(value||'').replace(/\\/g,'/');
  if(!path||path.startsWith('/')||/^[a-z]:/i.test(path)||path.split('/').some(part=>!part||part==='.'||part==='..')||/[\x00-\x1f]/.test(path))throw Error('Use a relative file path, such as scripts/main.js.');
  return path;
}
function vwt_pickEntry(files,previous){
  const html=files.filter(file=>/\.html?$/i.test(file.path));
  return html.find(file=>file.path===previous)?.path||html.find(file=>file.path.toLowerCase()==='index.html')?.path||html[0]?.path||'';
}
function vwt_legacyTarget(){
  if(!vwt_files.html)return null;
  // Legacy uploads were flattened and injected. Preserve that exact behavior.
  return {version:1,kind:'files',entry:'index.html',files:[{path:'index.html',content:vwt_buildWebsiteHTML(vwt_files),encoding:'utf8'}]};
}
function vwt_targetReady(target=vwt_target){
  if(!target)return !!vwt_files.html;
  if(target.source?.id&&target.project?.requiresServer)return vwt_sourceRuntime.get(target.source.id)?.running===true;
  return target.kind==='url'?(!!target.project?.nativeFiles&&!!target.source?.id||/^https?:\/\//i.test(target.url||'')):target.kind==='files'&&!!target.entry&&target.files?.some(file=>file.path===target.entry);
}
function vwt_recordSourceStatus(result,sourceId=result?.target?.source?.id||vwt_target?.source?.id){
  if(!sourceId||typeof result?.running!=='boolean')return;
  vwt_sourceRuntime.set(sourceId,{running:result.running,runningUrl:result.running?result.runningUrl||null:null});
}
async function vwt_checkRunningTarget(){
  if(vwt_target?.source?.id&&vwt_target.project?.requiresServer){
    const target=vwt_target,result=await vwt_previewInvoke('target:status',{sourceId:target.source.id});
    if(target===vwt_target)vwt_recordSourceStatus(result,target.source.id);
  }
  return vwt_targetReady();
}
function vwt_suiteSource(suite){
  if(suite.website_target)return JSON.parse(JSON.stringify(suite.website_target));
  if(suite.website_url)return {version:1,kind:'url',url:suite.website_url};
  return vwt_buildWebsiteHTML({html:suite.website_html_content,css:suite.website_css_contents||[],js:suite.website_js_contents||[]});
}
function vwt_currentSource(){return vwt_target||vwt_buildWebsiteHTML(vwt_files);}
function vwt_renderTargetControls(){
  const target=vwt_target,files=target?.files||[],preview=document.getElementById('vwt-files-preview');
  if(preview){
    preview.replaceChildren();
    const summary=document.createElement('p');summary.textContent=target?`${target.label||target.url||'Website files'}${target.kind==='files'?` · ${files.length} file${files.length===1?'':'s'}`:''}`:vwt_files.html?`Saved legacy website: HTML, ${vwt_files.css.length} CSS and ${vwt_files.js.length} JavaScript files. It still runs as saved. Add files to convert it to an editable file list.`:'No files yet. Add files or choose a folder.';preview.appendChild(summary);
    if(target?.kind==='files')for(const file of files){
      const row=document.createElement('div');row.className='vwt-file-row';row.dataset.filePath=file.path;
      const label=document.createElement('span');label.textContent=file.path;label.title=file.path;row.appendChild(label);
      for(const [action,text] of [['rename','Path'],['update','Update'],['remove','Remove']]){
        const button=document.createElement('button');button.type='button';button.className='aero-button-gray';button.textContent=text;button.setAttribute('aria-label',`${text} ${file.path}`);
        button.onclick=()=>action==='remove'?vwt_removeFile(file.path):action==='rename'?vwt_renameFile(file.path):vwt_updateFile(file.path);row.appendChild(button);
      }preview.appendChild(row);
    }
  }
  const entry=document.getElementById('vwt-entry');if(entry){entry.replaceChildren();for(const file of files.filter(file=>/\.html?$/i.test(file.path))){const option=document.createElement('option');option.value=file.path;option.textContent=file.path;entry.appendChild(option);}entry.value=target?.entry||'';entry.disabled=target?.kind!=='files'||!entry.options.length;}
  const details=document.getElementById('vwt-project-server');if(details)details.hidden=!target?.project?.requiresServer;
  const scripts=document.getElementById('vwt-server-script');if(scripts){const prior=scripts.value;scripts.replaceChildren();for(const [name,command]of Object.entries(target?.project?.scripts||{})){const option=document.createElement('option');option.value=name;option.textContent=`${name}: ${command}`;scripts.appendChild(option);}scripts.value=Object.hasOwn(target?.project?.scripts||{},prior)?prior:Object.hasOwn(target?.project?.scripts||{},'dev')?'dev':scripts.options[0]?.value||'';}
  const refresh=document.getElementById('vwt-refresh-source');if(refresh)refresh.disabled=!target?.source?.id||vwt_targetBusy;
  const stop=document.getElementById('vwt-stop-project');if(stop){stop.disabled=!target?.source?.id||vwt_stoppingProject;stop.textContent=vwt_targetBusy&&!vwt_stoppingProject?'Cancel startup / stop website':'Stop project website';}
  const warnings=document.getElementById('vwt-source-warnings');if(warnings)warnings.textContent=(target?.warnings||[]).join('\n');
  vwt_updateWebsiteActions();
}
async function vwt_readAsset(file,path){
  if(/\.(?:html?|css|[cm]?js|json|map|svg|txt|xml|webmanifest|md|csv|ts|tsx|jsx|vue|svelte)$/i.test(path)||String(file.type||'').startsWith('text/'))return {path,content:await vwt_readFileAsText(file),encoding:'utf8'};
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=e=>resolve({path,content:String(e.target.result).split(',')[1]||'',encoding:'base64'});reader.onerror=reject;reader.readAsDataURL(file);});
}
async function vwt_addFiles(input,replacePath){
  const selected=Array.from(input?.files||[]);if(!selected.length)return;
  if(vwt_targetBusy){vwt_targetNotice('Wait for the current website operation to finish before adding files.',true);return;}
  const generation=vwt_targetGeneration,ticket=++vwt_operationTicket;vwt_targetBusy=true;
  try{
    if(vwt_target?.kind==='url'&&!confirm('Replace the current website target with these local files? Your test steps will be kept.'))return;
    const base=(vwt_target?.kind==='files'?vwt_target:!vwt_target?vwt_legacyTarget():null)||{version:1,kind:'files',files:[]},files=new Map((base.files||[]).map(file=>[file.path,file]));
    for(const file of selected){const path=vwt_path(replacePath||file.webkitRelativePath||file.name);files.set(path,await vwt_readAsset(file,path));}
    if(generation!==vwt_targetGeneration||ticket!==vwt_operationTicket)return;
    const next=Array.from(files.values());vwt_target={...base,files:next,entry:vwt_pickEntry(next,base.entry)};vwt_targetEdited=true;
    vwt_updateFilesPreview();vwt_targetNotice('Files updated. Choose the start page, then Reload Preview.');
  }catch(error){if(generation===vwt_targetGeneration&&ticket===vwt_operationTicket)vwt_targetNotice(error.message,true);}finally{input.value='';if(generation===vwt_targetGeneration&&ticket===vwt_operationTicket)vwt_targetBusy=false;}
}
function vwt_removeFile(path){if(!vwt_target?.files||!vwt_allowSourceChange())return;vwt_target.files=vwt_target.files.filter(file=>file.path!==path);vwt_target.entry=vwt_pickEntry(vwt_target.files,vwt_target.entry);vwt_targetEdited=true;vwt_updateFilesPreview();vwt_targetNotice('File removed from this test. Reload Preview to apply. The original file is unchanged.');}
async function vwt_renameFile(path){if(!vwt_allowSourceChange())return;const target=vwt_target,generation=vwt_targetGeneration,result=await vwt_formDialog({id:'vwt-file-path-dialog',title:'Change file path',fields:[{id:'vwt-file-path',key:'path',label:'Path relative to the website root, such as scripts/main.js',value:path,required:true}],submitLabel:'Apply path'});if(!result||result.path===path||target!==vwt_target||generation!==vwt_targetGeneration||!vwt_allowSourceChange())return;try{const next=vwt_path(result.path);if(vwt_target.files.some(file=>file.path===next))throw Error('That path already exists. Use Update to replace its contents.');vwt_target.files.find(file=>file.path===path).path=next;if(vwt_target.entry===path)vwt_target.entry=next;vwt_targetEdited=true;vwt_updateFilesPreview();vwt_targetNotice('Path changed for this test. Update links in your source files if needed, then reload.');}catch(error){vwt_targetNotice(error.message,true);}}
function vwt_updateFile(path){if(!vwt_allowSourceChange())return;const input=document.getElementById('vwt-update-file');if(!input)return;input.onchange=()=>vwt_addFiles(input,path);input.click();}
function vwt_setEntry(entry){if(!vwt_allowSourceChange())return;if(vwt_target?.kind==='files'){vwt_target.entry=entry;vwt_targetEdited=true;vwt_targetNotice('Start page changed. Reload Preview to apply.');}}
async function vwt_targetOperation(operation,{interrupt=false,sourceId=vwt_target?.source?.id}={}){
  if(vwt_targetBusy&&!interrupt)return;
  const ticket=++vwt_operationTicket,generation=vwt_targetGeneration;
  vwt_targetBusy=true;vwt_stoppingProject=interrupt;
  if(interrupt&&sourceId)vwt_sourceRuntime.set(sourceId,{running:false,runningUrl:null});
  vwt_targetNotice(interrupt?'Stopping project website…':'Working…');vwt_renderTargetControls();
  const current=()=>generation===vwt_targetGeneration&&ticket===vwt_operationTicket;
  try{
    const result=await operation();if(!current())return;
    if(result?.__lvxError)throw Error(result.__lvxError.message);
    if(result?.cancelled){vwt_targetNotice('Selection cancelled. Your current website is unchanged.');return;}
    vwt_recordSourceStatus(result,result?.target?.source?.id||sourceId);
    if(result?.target){vwt_target=result.target;vwt_targetEdited=false;vwt_renderTargetControls();vwt_targetNotice(vwt_targetReady()?'Website ready. Reload Preview to load it.':'Project detected. Review the command below, then start its website server.');}
    const logs=document.getElementById('vwt-project-log');if(logs&&result?.logs)logs.textContent=Array.isArray(result.logs)?result.logs.join('\n'):String(result.logs);
    if(interrupt||result?.running===false&&!result?.target)vwt_targetNotice('Project website is stopped. Start it before reloading.');
    return result;
  }catch(error){if(current())vwt_targetNotice(error.message,true);}
  finally{if(current()){vwt_targetBusy=false;vwt_stoppingProject=false;vwt_renderTargetControls();}}
}
function vwt_confirmSourceReplacement(){return !vwt_targetEdited||confirm('Replace the current website source? File edits made only in this test will be replaced. Your test steps stay unchanged.');}
async function vwt_chooseProjectFolder(){if(!vwt_allowSourceChange()||!vwt_confirmSourceReplacement())return;return vwt_targetOperation(async()=>{if(!window.electronAPI?.studioOps?.choosePath)throw Error('Choose folder requires the LVX desktop application.');return window.electronAPI.studioOps.choosePath({kind:'web-project'});});}
async function vwt_loadRepository(){if(!vwt_allowSourceChange())return;const url=document.getElementById('vwt-repository-url')?.value.trim(),ref=document.getElementById('vwt-repository-ref')?.value.trim();if(!url){vwt_targetNotice('Enter a repository URL first.',true);return;}if(!vwt_confirmSourceReplacement())return;return vwt_targetOperation(()=>vwt_previewInvoke('target:repository',{url,ref}));}
async function vwt_loadWebsite(){
  if(!vwt_allowSourceChange())return;
  let url;try{url=new URL(document.getElementById('vwt-website-url')?.value.trim());if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error();}
  catch{vwt_targetNotice('Enter a full http:// or https:// website address without a password. For a local app, include its port, for example http://localhost:3000.',true);return;}
  if(!vwt_confirmSourceReplacement())return;
  vwt_clearCreatorPreview();vwt_target={version:1,kind:'url',url:url.href,label:url.hostname};vwt_targetEdited=false;vwt_updateFilesPreview();
  const generation=vwt_targetGeneration;
  try{await vwt_renderIframe();}catch(error){if(generation===vwt_targetGeneration)vwt_targetNotice('Could not load the website. '+error.message+' Check the address, internet/VPN connection, or start the local server, then choose Use website again.',true);}
}
function vwt_updateWebsiteActions(){
  const ready=!!vwt_remoteSessions.get(document.getElementById('vwt-iframe'))&&!vwt_targetBusy;
  for(const id of ['vwt-website-signin','vwt-website-refresh']){const button=document.getElementById(id);if(button)button.disabled=!ready;}
}
async function vwt_showWebsite(){
  try{const id=vwt_remoteSessions.get(document.getElementById('vwt-iframe'));if(!id)throw Error('Choose Use website first.');await vwt_previewInvoke('show',{id});vwt_targetNotice('Website opened. After signing in or navigating there, choose Update preview after sign in.');}
  catch(error){vwt_targetNotice(error.message,true);}
}
async function vwt_refreshWebsiteSnapshot(){
  const iframe=document.getElementById('vwt-iframe'),id=vwt_remoteSessions.get(iframe),generation=vwt_targetGeneration;
  if(!id){vwt_targetNotice('Choose Use website first.',true);return;}
  try{const result=await vwt_previewInvoke('snapshot',{id});if(generation!==vwt_targetGeneration||vwt_remoteSessions.get(iframe)!==id)return;vwt_setStaticPreview(iframe,result.html,true);vwt_targetNotice('Preview updated: '+(result.url||vwt_target?.url||'website')+'. Add test steps, then Run Live Test.');}
  catch(error){if(generation===vwt_targetGeneration)vwt_targetNotice('Could not update the preview. '+error.message+' Choose Use website to open it again.',true);}
}
async function vwt_refreshSource(){if(!vwt_target?.source?.id)return;if(vwt_targetEdited&&!confirm('Read the original folder or repository again? This replaces file edits made only in this test. Your test steps stay unchanged.'))return;return vwt_targetOperation(()=>vwt_previewInvoke('target:refresh',{sourceId:vwt_target.source.id}));}
async function vwt_startProject(){
  if(vwt_targetBusy)return;
  const sourceId=vwt_target?.source?.id,script=document.getElementById('vwt-server-script')?.value,install=!!document.getElementById('vwt-install-dependencies')?.checked;
  if(!sourceId||!script){vwt_targetNotice('Choose a project folder and a package script first.',true);return;}
  const expectedFingerprint=vwt_target.project?.packageFingerprint;
  if(!expectedFingerprint){vwt_targetNotice('Read folder / repository again to review its current package command before starting.',true);return;}
  const command=vwt_target.project?.scripts?.[script]||'';
  if(!confirm(`Start this project?\n\nPackage script ${script}:\n${command}\n\n${install?'Download and install project dependencies first. Installation may execute package setup scripts.\n\n':''}This runs project code with your Windows account permissions. Only continue if you trust this project.`))return;
  return vwt_targetOperation(()=>vwt_previewInvoke('target:start',{sourceId,script,install,expectedCommand:command,expectedFingerprint}));
}
async function vwt_stopProject(){const sourceId=vwt_target?.source?.id;if(!sourceId||vwt_stoppingProject)return;return vwt_targetOperation(()=>vwt_previewInvoke('target:stop',{sourceId}),{interrupt:true,sourceId});}
async function vwt_stopAllProjects(){
  if(vwt_stoppingProject||!confirm('Stop all LVX-managed project websites in this workspace? This also stops websites used by other project previews and test runs. Your files and saved tests are kept.'))return;
  const result=await vwt_targetOperation(()=>vwt_previewInvoke('target:stopAll',{}),{interrupt:true});
  if(result){vwt_sourceRuntime.clear();vwt_targetNotice(`Stopped ${result.stopped??0} project website(s). Start a project again before running its tests.`);}
}
async function vwt_projectStatus(){if(!vwt_target?.source?.id)return;return vwt_targetOperation(()=>vwt_previewInvoke('target:status',{sourceId:vwt_target.source.id}));}

function vwt_buildWebsiteHTML(files) {
  if (!files.html) return null;
  let html = files.html;
  if (files.css.length > 0) {
    const cssStyles = files.css.map(f => `<style>/* ${f.name} */\n${f.content}</style>`).join('\n');
    html = html.includes('</head>') ? html.replace('</head>', cssStyles + '\n</head>') : cssStyles + '\n' + html;
  }
  if (files.js.length > 0) {
    const jsScripts = files.js.map(f => `<script>/* ${f.name} */\n${f.content}</script>`).join('\n');
    html = html.includes('</body>') ? html.replace('</body>', jsScripts + '\n</body>') : html + '\n' + jsScripts;
  }

  // INJECT VWT STYLES FOR HIGHLIGHTING
  html = html.replace('</head>', `
    <style>
      .vwt-temp-highlight {
        outline: 3px solid #4CC2FF !important;
        outline-offset: 2px !important;
        background: rgba(76, 194, 255, 0.1) !important;
        transition: all 0.2s ease !important;
      }
    </style>
  </head>`);

  return html;
}

async function vwt_renderIframe() {
  if(vwt_targetBusy)throw Error('Wait for the current website operation to finish, or stop startup first.');
  const generation=vwt_targetGeneration,target=vwt_target;
  if(vwt_target){
    const ready=await vwt_checkRunningTarget();if(generation!==vwt_targetGeneration||target!==vwt_target)return;
    if(!ready)throw Error(vwt_target.project?.requiresServer?'Start the project server below before loading its preview.':'Add an HTML start page and select it before reloading.');
    const iframe=document.getElementById('vwt-iframe');
    const ticket=++vwt_operationTicket;vwt_targetBusy=true;vwt_updateWebsiteActions();vwt_targetNotice('Loading website in its isolated browser…');
    try{const result=await vwt_openRemote(iframe,target);if(generation===vwt_targetGeneration&&ticket===vwt_operationTicket)vwt_targetNotice((target.kind==='url'&&!target.source?'Website loaded: '+(result.url||target.url)+'. ':'Preview loaded. ')+'Add test steps, then Run Live Test.');return result;}
    finally{if(generation===vwt_targetGeneration&&ticket===vwt_operationTicket){vwt_targetBusy=false;vwt_updateWebsiteActions();}}
  }
  const htmlContent = vwt_buildWebsiteHTML(vwt_files);
  if (!htmlContent) {
    vwt_targetNotice('No website selected yet. Choose Files or folder, Website URL, or Git repository above.',true);
    vwt_log("No website selected. Choose a website source first.");
    return;
  }
  const iframe = document.getElementById('vwt-iframe');
  vwt_setStaticPreview(iframe,htmlContent);
  if(typeof window.electronAPI?.previewOps?.invoke==='function'){
    try{await vwt_openRemote(iframe,htmlContent);if(generation===vwt_targetGeneration)vwt_log('Interactive website runs in an isolated desktop process. Embedded view is a safe DOM snapshot.');}
    catch(error){if(generation!==vwt_targetGeneration)return;vwt_log('Interactive preview unavailable: '+error.message);throw error;}
  }else vwt_log('Static preview loaded. Open the desktop application to execute uploaded scripts and test steps.');
}

// --- VWT Builder UI Logic (Creator) ---
function vwt_initializeToolbox() {
  const toolbox = document.getElementById('vwt-toolbox');
  if (!toolbox) return;
  toolbox.innerHTML = '';
  vwt_availableSteps.forEach(step => {
    const stepEl = document.createElement('button');
    stepEl.type = 'button';
    stepEl.setAttribute('aria-label', 'Add ' + step.name);
    stepEl.title = 'Add this step, or drag it onto the test';
    stepEl.className = 'aero-button p-3 rounded cursor-grab no-code-step';
    stepEl.draggable = true;
    stepEl.innerHTML = `<span class="block font-semibold">${step.icon} ${step.name}</span><span class="block text-xs aero-text-muted">${step.description}</span>`;
    stepEl.addEventListener('dragstart', (e) => {
      vwt_dragStartIndex = null;
      e.dataTransfer.setData('text/plain', step.name);
    });
    stepEl.addEventListener('click', () => vwt_handleDrop({preventDefault(){},dataTransfer:{getData:()=>step.name}},null));
    toolbox.appendChild(stepEl);
  });
}
function vwt_renderCanvas() {
  const canvas = document.getElementById('vwt-canvas');
  if (!canvas) return;

  if (vwt_steps.length === 0) {
    canvas.innerHTML = '<div class="text-center aero-text-muted p-8">Choose a step on the left, or drag it here.</div>';
    return;
  }

  canvas.innerHTML = vwt_steps.map((step, index) => {
    const stepConfig = vwt_availableSteps.find(s => s.name === step.name);
    const isSelected = index === vwt_selectedStepIndex;
    const isBreakpoint = window.testDebugger && window.testDebugger.isAtBreakpoint(index);
    const isCurrentStep = window.testDebugger && window.testDebugger.getCurrentStepIndex() === index;

    return `
      <div class='flex gap-2 items-start mb-2'>
        <!-- Breakpoint/Line Number -->
        ${vwt_debugMode ? `
          <button type='button' data-vwt-breakpoint='${index}' aria-label='Breakpoint at step ${index + 1}' aria-pressed='${!!isBreakpoint}' class='flex-shrink-0 w-8 h-8 flex items-center justify-center cursor-pointer rounded ${isBreakpoint ? 'aero-button-danger' : 'aero-button'}'
            onclick='toggleStepBreakpoint(${index})'
            title='Toggle breakpoint'>
            ${isBreakpoint ? window.LVXIcons?.svg('circle','Breakpoint') || 'Breakpoint' : index + 1}
          </button>
        ` : ''}

        <!-- Step Card -->
        <div class='flex-1 no-code-step aero-button p-3 rounded-lg ${isSelected ? 'border-2 border-blue-500' : ''} ${isCurrentStep ? 'bg-yellow-100 border-2 border-yellow-500' : ''}'
          draggable='true'
          data-index='${index}'
          ondragstart='vwt_handleDragStart(event, ${index})'
          ondragover='vwt_handleDragOver(event, ${index})'
          ondrop='vwt_handleDrop(event, ${index})'
          onclick='vwt_selectStep(${index})'>
          <div class='flex items-center justify-between mb-1'>
            <button type='button' aria-label='Edit step ${index + 1}: ${vwt_escapeHtml(step.name)}' data-vwt-edit='${index}' class='flex items-center gap-2' onclick='event.stopPropagation();vwt_editStep(${index})'>
              <span class='text-2xl'>${stepConfig?.icon || '•'}</span>
              <span class='font-semibold text-sm'>${index + 1}. ${vwt_escapeHtml(step.name)}</span>
            </button>
            <div class='vwt-step-actions'>
            <button type='button' aria-label='Move step ${index + 1} up' ${index===0?'disabled':''} onclick='event.stopPropagation();vwt_moveStep(${index},${index-1})' class='aero-button px-2'>${window.LVXIcons?.svg('up')||''} Up</button>
            <button type='button' aria-label='Move step ${index + 1} down' ${index===vwt_steps.length-1?'disabled':''} onclick='event.stopPropagation();vwt_moveStep(${index},${index+1})' class='aero-button px-2'>${window.LVXIcons?.svg('down')||''} Down</button>
            <button onclick='event.stopPropagation(); vwt_deleteStep(${index}, event)'
              type='button' aria-label='Delete step ${index + 1}' class='aero-button-danger px-2 text-xs'>
              Delete
            </button></div>
          </div>
          <div class='text-xs aero-text-muted'>
            ${Object.entries(step.params||{}).filter(([k, v]) => v).map(([k, v]) =>
      `${vwt_escapeHtml(k)}: ${vwt_escapeHtml(String(v).length > 30 ? String(v).substring(0, 30) + '...' : String(v))}`
    ).join(', ')}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Re-attach drag listeners (since we used innerHTML)
  const steps = canvas.querySelectorAll('.no-code-step');
  steps.forEach(stepEl => {
    const index = parseInt(stepEl.dataset.index);
    stepEl.addEventListener('dragstart', (e) => { vwt_dragStartIndex = index; e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); });
    stepEl.addEventListener('dragover', (e) => { e.preventDefault(); stepEl.classList.add('drag-over-item'); });
    stepEl.addEventListener('dragleave', (e) => { e.preventDefault(); stepEl.classList.remove('drag-over-item'); });
    stepEl.addEventListener('drop', (e) => {
      e.stopPropagation(); e.preventDefault(); stepEl.classList.remove('drag-over-item');
      if (vwt_dragStartIndex === null) vwt_handleDrop(e, index);
      else {
        const dropIndex = index; if (vwt_dragStartIndex === dropIndex) return;
        vwt_moveStep(vwt_dragStartIndex,dropIndex);vwt_dragStartIndex = null;
      }
    });
  });
}
function vwt_setupCanvasDropZone() { const canvas = document.getElementById('vwt-canvas'); canvas.addEventListener('dragover', (e) => { e.preventDefault(); canvas.classList.add('drag-over'); }); canvas.addEventListener('dragleave', () => canvas.classList.remove('drag-over')); canvas.addEventListener('drop', (e) => vwt_handleDrop(e, null)); }
document.addEventListener('DOMContentLoaded', vwt_setupCanvasDropZone);
function vwt_handleDrop(e, dropIndex) {
  e.preventDefault(); document.getElementById('vwt-canvas').classList.remove('drag-over'); if (vwt_dragStartIndex !== null) return;
  const stepName = e.dataTransfer.getData('text/plain'); const stepConfig = vwt_availableSteps.find(s => s.name === stepName);
  if (stepConfig) {
    const newStep = { id: `step_${Date.now()}`, name: stepConfig.name, params: {} };
    stepConfig.params.forEach(p => { newStep.params[p.key] = p.placeholder || ''; });
    if (dropIndex === null || dropIndex > vwt_steps.length) vwt_steps.push(newStep); else vwt_steps.splice(dropIndex, 0, newStep);
    vwt_renderCanvas(); vwt_selectStep(dropIndex === null ? vwt_steps.length - 1 : dropIndex);
  }
}

// --- PROPERTY PANEL WITH ELEMENT PICKER ---

function vwt_renderPropertiesPanel() {
  const propertiesPanel = document.getElementById('vwt-properties');
  if (vwt_selectedStepIndex === null || !vwt_steps[vwt_selectedStepIndex]) { propertiesPanel.innerHTML = `<div class="text-center aero-text-muted p-8">Select a step to configure.</div>`; return; }
  const step = vwt_steps[vwt_selectedStepIndex]; const stepConfig = vwt_availableSteps.find(s => s.name === step.name);
  if(!stepConfig){propertiesPanel.textContent='This imported visual step is unsupported. Choose a supported step.';return;}
  let formHTML = `<h3 class="text-xl font-bold aero-text-primary mb-4">Properties: ${vwt_escapeHtml(step.name)}</h3>`;

  stepConfig.params.forEach(param => {
    const value = step.params[param.key] || '';
    formHTML += `<div class="mb-3"><label for="param-${param.key}" class="block text-sm font-medium aero-text-secondary mb-1">${param.label}</label>`;

    if (param.type === 'textarea') {
      formHTML += `<textarea id="param-${param.key}" placeholder="${param.placeholder || ''}" oninput="vwt_updateStepParam(vwt_selectedStepIndex, '${param.key}', this.value)" class="w-full aero-input p-2 rounded h-32">${vwt_escapeHtml(value)}</textarea>`;
    } else {
      // For Selector inputs, add Pick button and Validation logic
      if (param.key === 'selector') {
        formHTML += `
        <div class='flex gap-2'>
            <input type="${param.type}"
                id="param-${param.key}"
                placeholder="${param.placeholder || ''}"
                value="${vwt_escapeHtml(value)}"
                oninput="vwt_updateStepParam(vwt_selectedStepIndex, '${param.key}', this.value)"
                onmouseover="vwt_highlightMatchedElements(this.value)"
                onmouseout="vwt_clearHighlights()"
                class="flex-1 aero-input p-2 rounded">
            <button type='button'
                onclick='activateElementPicker("${param.key}")'
                class='aero-button-primary px-3 rounded text-sm flex-shrink-0 font-bold'
                title='Pick element visually from the preview'>
                ${window.LVXIcons?.svg("target") || ''} Pick
            </button>
        </div>
        <div id="validation-${param.key}" class="mt-1 h-5">
            ${vwt_getValidationHTML(value)}
        </div>
        `;
      } else {
        formHTML += `<input id="param-${param.key}" type="${param.type}" placeholder="${param.placeholder || ''}" value="${vwt_escapeHtml(value)}" oninput="vwt_updateStepParam(vwt_selectedStepIndex, '${param.key}', this.value)" class="w-full aero-input p-2 rounded">`;
      }
    }
    formHTML += `</div>`;
  });
  propertiesPanel.innerHTML = formHTML;
}

function vwt_selectStep(index) { vwt_selectedStepIndex = index; vwt_renderCanvas(); vwt_renderPropertiesPanel(); }
function vwt_editStep(index) { vwt_selectStep(index);document.querySelector('#vwt-properties input,#vwt-properties textarea,#vwt-properties select')?.focus(); }
function vwt_remapBreakpoints(before) {
  const debuggerInstance=window.testDebugger;if(!debuggerInstance?.breakpoints)return;
  const marked=new Set(before.filter((step,i)=>debuggerInstance.breakpoints.has(i)));
  debuggerInstance.breakpoints=new Set(vwt_steps.flatMap((step,i)=>marked.has(step)?[i]:[]));
  updateDebugBreakpointsList();
}
function vwt_moveStep(from,to) {
  if(!vwt_steps[from]||to<0||to>=vwt_steps.length)return;
  const before=[...vwt_steps],step=vwt_steps.splice(from,1)[0];vwt_steps.splice(to,0,step);vwt_remapBreakpoints(before);
  vwt_selectStep(to);document.querySelector('[data-vwt-edit="'+to+'"]')?.focus();
}
function vwt_deleteStep(index, event) {
  event.stopPropagation();const before=[...vwt_steps];vwt_steps.splice(index, 1);vwt_remapBreakpoints(before);
  if (vwt_selectedStepIndex === index) vwt_selectedStepIndex = null;
  else if (vwt_selectedStepIndex > index) vwt_selectedStepIndex--;
  vwt_renderCanvas(); vwt_renderPropertiesPanel();
  (document.querySelector('[data-vwt-edit="'+Math.min(index,vwt_steps.length-1)+'"]')||document.querySelector('#vwt-toolbox button'))?.focus();
}

function vwt_updateStepParam(index, key, value) {
  if (vwt_steps[index]) {
    vwt_steps[index].params[key] = value;

    // Real-time validation for selector updates
    if (key === 'selector') {
      const validationEl = document.getElementById(`validation-${key}`);
      if (validationEl) {
        validationEl.innerHTML = vwt_getValidationHTML(value);
      }
    }
  }
}

// --- VALIDATION & HIGHLIGHTING HELPERS ---

function vwt_getValidationHTML(selector) {
  if (!selector) return '';
  const validation = vwt_validateSelector(selector);
  if (validation.valid) {
    return `<span class='aero-badge-success text-xs'>${window.LVXIcons?.svg("check") || ''} ${validation.message}</span>`;
  } else {
    return `<span class='aero-badge-error text-xs'>${window.LVXIcons?.svg("close") || ''} ${validation.message}</span>`;
  }
}

function vwt_validateSelector(selector) {
  const iframe = document.getElementById('vwt-iframe');
  if (!iframe || !iframe.contentWindow) return { valid: false, message: 'Preview not loaded' };

  try {
    const iframeDoc = iframe.contentWindow.document;
    const elements = iframeDoc.querySelectorAll(selector);

    if (elements.length === 0) {
      return { valid: false, message: 'No elements found', count: 0 };
    }

    return {
      valid: true,
      message: elements.length === 1 ? 'Unique match' : `Matches ${elements.length} elements`,
      count: elements.length
    };
  } catch (e) {
    return { valid: false, message: 'Invalid syntax' };
  }
}

function vwt_highlightMatchedElements(selector) {
  const iframe = document.getElementById('vwt-iframe');
  if (!iframe || !iframe.contentWindow || !selector) return;

  try {
    const iframeDoc = iframe.contentWindow.document;
    const elements = iframeDoc.querySelectorAll(selector);
    elements.forEach(el => {
      el.classList.add('vwt-temp-highlight');
    });
  } catch (e) {
    // Invalid selector, ignore
  }
}

function vwt_clearHighlights() {
  const iframe = document.getElementById('vwt-iframe');
  if (!iframe || !iframe.contentWindow) return;

  const iframeDoc = iframe.contentWindow.document;
  iframeDoc.querySelectorAll('.vwt-temp-highlight').forEach(el => {
    el.classList.remove('vwt-temp-highlight');
  });
}

// --- ELEMENT PICKER INTEGRATION ---

function activateElementPicker(paramKey) {
  // Ensure iframe is loaded
  const iframe = document.getElementById('vwt-iframe');
  if (!iframe || !iframe.contentWindow || !iframe.contentWindow.document.body) {
    if (window.showMessage) window.showMessage('Please load a website preview first', 'warning');
    return;
  }

  // Initialize picker if needed
  if (!vwt_elementPicker) {
    if (typeof ElementPicker === 'undefined') {
      console.error("ElementPicker class not loaded!");
      return;
    }
    vwt_elementPicker = new ElementPicker('vwt-iframe');
  }

  if (window.showMessage) window.showMessage('Click any element in the preview to select it', 'info');

  // Activate picker
  vwt_elementPicker.activate((selector, element) => {
    // Update the parameter in data
    if (vwt_selectedStepIndex !== null) {
      vwt_updateStepParam(vwt_selectedStepIndex, paramKey, selector);
    }

    // Update input field UI
    const input = document.getElementById(`param-${paramKey}`);
    if (input) {
      input.value = selector;
      // Trigger visual update for validation
      vwt_highlightMatchedElements(selector);
      setTimeout(vwt_clearHighlights, 1500);
      // Update validation badge
      const validationEl = document.getElementById(`validation-${paramKey}`);
      if (validationEl) validationEl.innerHTML = vwt_getValidationHTML(selector);
    }

    // Show success message
    const tag = element.tagName.toLowerCase();
    if (window.showMessage) window.showMessage(`Selected <${tag}> using: ${selector}`, 'success');
  });
}
// Export for HTML access
window.activateElementPicker = activateElementPicker;


// --- VWT Test Execution & Saving (Creator) ---
function vwt_log(message) { const logArea = document.getElementById('vwt-logs'); logArea.value += `[${new Date().toLocaleTimeString()}] ${message}\n`; logArea.scrollTop = logArea.scrollHeight; }
async function vwt_runTest() {
  if (vwt_steps.length === 0) {
    if (window.showMessage) window.showMessage('No steps to run', 'warning');
    return;
  }

  const iframe = document.getElementById('vwt-iframe');
  if (!iframe.srcdoc && !vwt_targetReady()) {
    vwt_log("Error: No website loaded.");
    if (window.showMessage) window.showMessage('Please load a website first', 'error');
    return;
  }

  try{if (vwt_debugMode) await runTestInDebugMode();else await runTestNormally();}
  catch(error){vwt_log(error.message);vwt_targetNotice(error.message,true);window.showMessage?.(error.message,'error');}
}

function vwt_reloadPreview() {
  return vwt_renderIframe();
}

async function runTestNormally() {
  vwt_log("--- Starting Live Test Run ---");
  const iframe = document.getElementById('vwt-iframe');
  vwt_log("Reloading sandbox...");
  await vwt_reloadPreview();
  vwt_log("Starting test steps...");

  for (let i = 0; i < vwt_steps.length; i++) {
    const step = vwt_steps[i];
    const stepConfig = vwt_availableSteps.find(s => s.name === step.name);
    vwt_log(`[Step ${i + 1}] Running: ${step.name}`);
    try {
      vwt_selectStep(i);
      await new Promise(r => setTimeout(r, 300));
      if(!stepConfig)throw new Error('Unknown visual step: '+step.name);
      await vwt_executeRemoteStep(step, iframe, vwt_log);
    } catch (error) {
      await vwt_closeRemote(iframe);
      vwt_log(`--- ERROR at Step ${i + 1} ---\n${error.message}\n--- Test Aborted ---`);
      return;
    }
  }
  vwt_log("--- Test Run Finished Successfully ---");
}

async function runTestInDebugMode() {
  const logArea = document.getElementById('vwt-logs');
  logArea.value += 'DEBUG MODE ACTIVE\nClick Step to execute one step, or Resume to continue.\n';
  const debuggerInstance = window.testDebugger;
  debuggerInstance.startDebugSession(vwt_steps, updateDebugUI);
  const preview=document.getElementById('vwt-iframe');
  const cancelMonitor=setInterval(()=>{if(!debuggerInstance.isActive)vwt_closeRemote(preview);},50);
  updateDebugStatus('Loading');
  let status = 'Completed';
  try {
    await vwt_reloadPreview();
    if (!debuggerInstance.isActive) {status='Stopped';await vwt_closeRemote(preview);return;}
    await debuggerInstance.pause();
    while (debuggerInstance.isActive) {
      const step = await debuggerInstance.executeNextStep();
      if (!step) break;
      const index = debuggerInstance.getCurrentStepIndex();
      try {
        const definition = vwt_availableSteps.find(value => value.name === step.name);
        if (!definition?.execute) throw new Error(`Unknown visual step: ${step.name}`);
        logArea.value += `[${index + 1}/${vwt_steps.length}] Executing: ${step.name}\n`;
        await vwt_executeRemoteStep(step, document.getElementById('vwt-iframe'), message => {
          logArea.value += message + '\n'; logArea.scrollTop = logArea.scrollHeight;
        });
        if (step.params?.selector) debuggerInstance.setVariable(`step${index}_selector`, step.params.selector);
        updateDebugVariablesList();
        updateDebugUI(index, step, 'completed');
        if (debuggerInstance.isActive && debuggerInstance.mode === 'step' && index < vwt_steps.length - 1) await debuggerInstance.pause();
      } catch (error) {
        if(!debuggerInstance.isActive){status='Stopped';break;}
        status = 'Error';
        logArea.value += `Error: ${error.message}\n`;
        const info = debuggerInstance.captureError(error, index, step);
        window.displayDebugError?.(info);
        updateDebugUI(index, step, 'error');
        break;
      }
    }
    if (!debuggerInstance.isActive && status !== 'Error') status = 'Stopped';
  } catch (error) {
    status = 'Error';
    logArea.value += `Error: ${error.message}\n`;
  } finally {
    clearInterval(cancelMonitor);
    if(status==='Error'||status==='Stopped')await vwt_closeRemote(preview);
    debuggerInstance.stopDebugSession();
    updateDebugStatus(status);
    logArea.value += `Debug session ${status.toLowerCase()}\n`;
    for (const id of ['debug-step-btn','debug-pause-btn','debug-resume-btn']) document.getElementById(id).disabled = true;
  }
}

// --- Debug Helper Functions ---

function toggleDebugMode(enabled) {
  vwt_debugMode = enabled;

  // Show/hide debug UI
  document.getElementById('vwt-debug-controls').classList.toggle('hidden', !enabled);
  document.getElementById('vwt-debug-panel').classList.toggle('hidden', !enabled);

  // Update step rendering to show breakpoint toggles
  vwt_renderCanvas();

  if (enabled) {
    if (window.showMessage) window.showMessage('Debug mode enabled. Click line numbers to set breakpoints.', 'info');
  } else {
    if (window.testDebugger) {
      window.testDebugger.stopDebugSession();
      window.testDebugger.clearBreakpoints();
    }
  }
}

function toggleStepBreakpoint(stepIndex) {
  const restoreFocus=document.activeElement?.hasAttribute('data-vwt-breakpoint');
  const isSet = window.testDebugger.toggleBreakpoint(stepIndex);
  vwt_renderCanvas();
  updateDebugBreakpointsList();
  if(restoreFocus)document.querySelector('[data-vwt-breakpoint="'+stepIndex+'"]')?.focus();

  if (window.showMessage) {
    window.showMessage(
      isSet ? `Breakpoint set at step ${stepIndex + 1}` : `Breakpoint removed from step ${stepIndex + 1}`,
      'info'
    );
  }
}

// Export debug functions
window.toggleDebugMode = toggleDebugMode;
window.toggleStepBreakpoint = toggleStepBreakpoint;
function vwt_generateRobotCode() {
  let code = `*** Settings ***\nLibrary    BrowserLibrary\n\n*** Test Cases ***\nVisually Generated Web Test\n`;
  vwt_steps.forEach(step => { const stepConfig = vwt_availableSteps.find(s => s.name === step.name); if (stepConfig) code += stepConfig.robot(step.params) + '\n'; });
  return code;
}
async function vwt_saveSuite() {
  if(vwt_saveInProgress)return;vwt_saveInProgress=true;
  try {
    if(vwt_targetBusy)throw Error('Wait for the current website operation before saving.');
    if(vwt_steps.length===0||!await vwt_checkRunningTarget())throw Error('Cannot save: Add test steps and load a website with an HTML start page or a running website address.');
    const suites = window.LVXApp?.getSuites() || window.testSuites || [];
    const existingSuite = vwt_editingSuiteId ? suites.find(suite => suite.id === vwt_editingSuiteId) : null;
    if (vwt_editingSuiteId && !existingSuite) throw new Error('The suite being edited no longer exists');
    const generation=vwt_targetGeneration,details=await vwt_formDialog({id:'vwt-suite-save-dialog',title:existingSuite?'Update visual test':'Save visual test',fields:[{id:'vwt-suite-name',key:'name',label:'Test name',value:existingSuite?.name||'New Visual Web Test',required:true},{id:'vwt-suite-description',key:'description',label:'Description (optional)',value:existingSuite?.description||'',multiline:true}],submitLabel:existingSuite?'Update test':'Save test'});
    if(!details||generation!==vwt_targetGeneration)return;const suiteName=details.name,suiteDescription=details.description;
    const suiteViewId = existingSuite?.view_id ?? (typeof currentViewId !== 'undefined' ? currentViewId : null);
    const suiteData = { name: suiteName, description: suiteDescription, language: 'website', code: vwt_generateRobotCode(), vwt_steps_json: JSON.stringify(vwt_steps), website_method: 'upload', ...(vwt_target?{website_target:JSON.parse(JSON.stringify(vwt_target))}:{}), website_html_content: vwt_files.html, website_css_contents: vwt_files.css, website_js_contents: vwt_files.js, view_id: suiteViewId, parameters: [], input_files: [], log_config: { enabled: true, format: 'html', save_trigger: 'always' } };
    const storage = await window.LVXApp?.getStorage() || window.currentStorage;
    if (!storage) throw new Error('Test storage not available');
    const savedSuiteId = existingSuite ? (await storage.updateSuite(existingSuite.id, { ...existingSuite, ...suiteData }), existingSuite.id) : await storage.saveSuite(suiteData);
    await window.LVXApp?.refreshSuites();
    if (window._graphViewActiveForNewTest && window.visualEditor && savedSuiteId) {
      const refreshed = window.LVXApp?.getSuites() || window.testSuites || [];
      window.visualEditor.addTestNode(refreshed.find(suite => suite.id === savedSuiteId) || { id: savedSuiteId, name: suiteName });
      window.visualEditor.setAvailableSuites(refreshed);
    }
    window._graphViewActiveForNewTest = false;
    showMessage(existingSuite ? 'Test suite updated!' : 'Test suite saved!', 'success');
    closeVisualWebTester();
  } catch (error) { showMessage(`Error saving suite: ${error.message}`, 'error'); }
  finally{vwt_saveInProgress=false;}
}

// Awaitable visual-suite execution for pipelines and data-driven runs. Each call
// owns its page; advanced assertions receive that page rather than creator state.
async function vwt_executeSuite(suite) {
  const started = Date.now();
  const log = [];
  const iframe = document.createElement('iframe');
  iframe.title = `Visual test execution: ${suite.name || 'Untitled'}`;
  iframe.style.cssText = 'position:fixed;left:-100000px;top:0;width:1280px;height:900px;border:0';
  const result = { status: 'ERROR', log: '', artifacts: {} };
  try {
    const steps = typeof suite.vwt_steps_json === 'string' ? JSON.parse(suite.vwt_steps_json) : suite.vwt_steps_json;
    if (!Array.isArray(steps) || !steps.length) throw new Error('Visual suite has no executable steps');
    const source = vwt_suiteSource(suite);
    if (!source) throw new Error('Visual suite has no website source');
    if(typeof source==='string')vwt_setStaticPreview(iframe,source);document.body.appendChild(iframe);
    await vwt_openRemote(iframe,source);
    result.status = 'SUCCESS';
    for (const step of steps) {
      const config = vwt_availableSteps.find(value => value.name === step.name);
      if (!config?.execute) throw new Error(`Unknown visual step: ${step.name}`);
      log.push(`Running: ${step.name}`);
      await vwt_executeRemoteStep(step,iframe,message => log.push(message));
    }
  } catch (error) {
    result.status = error.code==='ASSERTION_FAILED'?'FAILURE':'ERROR';
    result.error = error.message;
    log.push(error.message);
  } finally {
    await vwt_closeRemote(iframe);
    iframe.remove();
    result.log = log.join('\n');
    result.duration = Date.now() - started;
  }
  return result;
}
window.vwt_executeSuite = vwt_executeSuite;

function vwt_escapeHtml(text) {return String(text??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}

// ============================================
// VWT LIVE RUNNER (REFACTORED FOR CONCURRENT EXECUTION)
// ============================================

// --- Runner State Management ---
let activeTestRunners = new Map();
let vwt_activeRunnerIdInModal = null;

/**
 * Main entry point to start a new test run or maximize an existing one.
 */
function vwt_openLiveRunner(suite) {
  if (!suite || suite.language !== 'website' || (suite.website_method !== 'upload' && !suite.vwt_steps_json)) {
    console.error("Invalid suite for Live Runner.");
    return;
  }

  for (const runner of activeTestRunners.values()) {
    if (runner.suite.id === suite.id) {
      vwt_maximizeLiveRunner(runner.id);
      return;
    }
  }

  const runnerId = `runner_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const logContainer = [];

  // MODIFIED: The iframe is now created and appended to the *visible* modal's container from the start.
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox','allow-same-origin');
  iframe.className = 'w-full h-full';
  iframe.style.border = 'none';
  iframe.style.display = 'none'; // It starts hidden.
  iframe.title = `Sandboxed runner for ${suite.name}`;

  const iframeContainer = document.getElementById('vwt-runner-iframe-container');
  iframeContainer.appendChild(iframe);

  const runner = {
    id: runnerId,
    suite: suite,
    steps: JSON.parse(suite.vwt_steps_json || '[]'),
    log: logContainer,
    iframe: iframe,
    status: 'RUNNING',
    isMinimized: true,
    isExecuting: false
  };

  activeTestRunners.set(runnerId, runner);

  vwt_addTestToMinimizeBar(runnerId);
  vwt_maximizeLiveRunner(runnerId);
  vwt_runLiveTestFromRunner(runnerId);
}

/**
 * Maximizes a specific runner's view in the main modal.
 */
function vwt_maximizeLiveRunner(runnerId) {
  const runner = activeTestRunners.get(runnerId);
  if (!runner) return;

  // MODIFIED: Instead of complex positioning, we just toggle visibility.
  // First, hide all other runner iframes.
  for (const otherRunner of activeTestRunners.values()) {
    if (otherRunner.id !== runnerId) {
      otherRunner.iframe.style.display = 'none';
    }
  }

  // Then, show the one we want.
  runner.iframe.style.display = 'block';

  vwt_activeRunnerIdInModal = runnerId;
  runner.isMinimized = false;

  const modal = document.getElementById('vwt-live-runner-modal');
  const title = document.getElementById('vwt-runner-modal-title');
  const logArea = document.getElementById('vwt-runner-logs');
  const rerunButton = document.getElementById('vwt-runner-rerun-btn');

  title.textContent = ` ${runner.suite.name}`;
  vwt_renderRunnerCanvas(runner.steps);
  logArea.value = runner.log.join('\n');
  logArea.scrollTop = logArea.scrollHeight;

  rerunButton.disabled = runner.isExecuting;
  rerunButton.innerHTML = runner.isExecuting ? `<div class="spinner mr-2"></div> Running...` : ' Re-run Test';

  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

/**
 * Minimizes the currently visible runner.
 */
function vwt_minimizeLiveRunner() {
  const runnerId = vwt_activeRunnerIdInModal;
  if (!runnerId) {
    vwt_closeLiveRunner(false);
    return;
  }

  const runner = activeTestRunners.get(runnerId);
  if (!runner) return;

  runner.isMinimized = true;

  // MODIFIED: No need to move the iframe. Just hide the modal.
  // The iframe stays in the modal container but becomes invisible with it.

  const modal = document.getElementById('vwt-live-runner-modal');
  modal.classList.add('hidden');
  document.body.classList.remove('modal-open');

  vwt_activeRunnerIdInModal = null;
}

/**
 * Closes a runner, either from the modal view or the minimize bar.
 */
function vwt_closeLiveRunner(fromModalOrRunnerId) {
  const runnerId = fromModalOrRunnerId === true ? vwt_activeRunnerIdInModal : fromModalOrRunnerId;
  if (!runnerId) {
    const modal = document.getElementById('vwt-live-runner-modal');
    if (modal) modal.classList.add('hidden');
    document.body.classList.remove('modal-open');
    return;
  }

  const runner = activeTestRunners.get(runnerId);
  if (!runner) return;

  vwt_previewGenerations.set(runner.iframe,(vwt_previewGenerations.get(runner.iframe)||0)+1);
  vwt_closeRemote(runner.iframe);runner.iframe.remove();
  activeTestRunners.delete(runnerId);
  vwt_removeTestFromMinimizeBar(runnerId);

  if (vwt_activeRunnerIdInModal === runnerId) {
    const modal = document.getElementById('vwt-live-runner-modal');
    modal.classList.add('hidden');
    document.body.classList.remove('modal-open');
    vwt_activeRunnerIdInModal = null;
  }
}

/**
 * The core test execution logic for a given runner.
 */
function vwt_runDefinition(value){
  const transient=new Set(['last_run_status','last_run_time','last_run_log','dateCreated','dateModified']);
  const stable=item=>Array.isArray(item)?item.map(stable):item&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().map(key=>[key,stable(item[key])])):item;
  return JSON.stringify(stable(Object.fromEntries(Object.entries(value||{}).filter(([key])=>!transient.has(key)))));
}
async function vwt_captureRunStorage(runner){
  const storage=await window.LVXApp?.getStorage()||window.currentStorage;
  if(!storage?.transport?.call||typeof storage.commitUpdate!=='function'||typeof storage.queue!=='function')throw Error('Revision-protected storage is unavailable. Reconnect the workspace to save run results.');
  await storage.guard();
  const workspaceRoot=storage.workspaceRoot,record=await storage.transport.call('read',{collection:'suites',id:runner.suite.id});
  if(!record)throw Error('This test was deleted. Its run result will stay in this window only.');
  const current=typeof storage.suite==='function'?storage.suite(record):record.value;
  if(vwt_runDefinition(current)!==vwt_runDefinition(runner.suite))throw Error('This test changed since the runner was opened. Reopen it before saving a new run result.');
  return {storage,workspaceRoot,record:JSON.parse(JSON.stringify(record))};
}
async function vwt_persistRunResult(runner,capture,log){
  const {storage,workspaceRoot,record}=capture;
  const updates={last_run_status:runner.status,last_run_time:new Date().toISOString(),last_run_log:log};
  const sameStorage=async()=>{if((await window.LVXApp?.getStorage()||window.currentStorage)!==storage||storage.workspaceRoot!==workspaceRoot)throw Error('Workspace storage changed during the run. The result was not written to another workspace.');};
  await storage.queue(async()=>{
    await sameStorage();await storage.guard();await sameStorage();
    const latest=await storage.transport.call('read',{collection:'suites',id:runner.suite.id});
    if(!latest)throw Error('This test was deleted during the run. Its saved list was not changed.');
    if(latest.revision!==record.revision)throw Error('This test changed during the run. Reopen it and run again; its newer saved version was preserved.');
    await sameStorage();await storage.commitUpdate(runner.suite.id,updates,record);
  });
  Object.assign(runner.suite,updates);runner.resultSaved=true;
  try{await window.LVXApp?.refreshSuites?.();}catch(error){throw Error('Run result was saved, but the test list could not refresh: '+error.message);}
}
async function vwt_runLiveTestFromRunner(runnerId) {
  if (!runnerId) runnerId = vwt_activeRunnerIdInModal;
  const runner = activeTestRunners.get(runnerId);
  if (!runner || runner.isExecuting) return;

  runner.isExecuting = true;
  runner.status = 'RUNNING';
  vwt_updateMinimizeBarItem(runnerId);

  const runnerLog = (message) => {
    const timestampedMessage = `[${new Date().toLocaleTimeString()}] ${message}`;
    runner.log.push(timestampedMessage);
    if (vwt_activeRunnerIdInModal === runnerId) {
      const logArea = document.getElementById('vwt-runner-logs');
      logArea.value += timestampedMessage + '\n';
      logArea.scrollTop = logArea.scrollHeight;
    }
  };

  if (vwt_activeRunnerIdInModal === runnerId) {
    const rerunButton = document.getElementById('vwt-runner-rerun-btn');
    rerunButton.disabled = true;
    rerunButton.innerHTML = `<div class="spinner mr-2"></div> Running...`;
    document.getElementById('vwt-runner-logs').value = '';
  }
  runner.log.length = 0;
  runner.resultSaved=false;runner.persistenceError=null;

  runnerLog("--- Starting Live Test Run ---");
  let storageCapture,storageCaptureError;
  try{storageCapture=await vwt_captureRunStorage(runner);}catch(error){storageCaptureError=error;}

  try {
    if(!Array.isArray(runner.steps)||!runner.steps.length)throw new Error('Visual suite has no executable steps');
    const htmlContent = vwt_suiteSource(runner.suite);

    if (!htmlContent) throw new Error("Could not build website HTML.");

    if(typeof htmlContent==='string')vwt_setStaticPreview(runner.iframe,htmlContent);
    await vwt_openRemote(runner.iframe,htmlContent);
    runnerLog('Website loaded into isolated sandbox.');

    runnerLog("Sandbox ready. Starting test steps...");

    for (let i = 0; i < runner.steps.length; i++) {
      const step = runner.steps[i];
      const stepConfig = vwt_availableSteps.find(s => s.name === step.name);
      runnerLog(`[Step ${i + 1}/${runner.steps.length}] Running: ${step.name}`);

      if (vwt_activeRunnerIdInModal === runnerId) {
        const canvas = document.getElementById('vwt-runner-canvas');
        canvas.querySelectorAll('.aero-card').forEach(el =>
          el.classList.toggle('border-blue-700', el.dataset.index == i)
        );
        await new Promise(r => setTimeout(r, 300));
      }

      try {
        if(!stepConfig)throw new Error('Unknown visual step: '+step.name);
        await vwt_executeRemoteStep(step,runner.iframe,runnerLog);
      } catch (stepError) {
        // Capture step failure but don't crash the runner logic
        throw stepError;
      }
    }

    runnerLog("--- Test Run Finished Successfully ---");
    runner.status = 'SUCCESS';

  } catch (error) {
    await vwt_closeRemote(runner.iframe);
    runnerLog(`--- ERROR ---`);
    runnerLog(error.message);
    runnerLog("--- Test Run Aborted ---");
    runner.status = error.code==='ASSERTION_FAILED'?'FAILURE':'ERROR';
  } finally {
    try{
      if(storageCaptureError)throw storageCaptureError;
      await vwt_persistRunResult(runner,storageCapture,runner.log.join('\n'));
      runnerLog('Run result saved to this test.');
    }catch(error){
      runner.persistenceError=error.message;
      const message=(runner.resultSaved?'Result saved; list refresh failed. ':'Result not saved. ')+error.message;
      runnerLog(message);window.showMessage?.(message,'error');
    }
    runner.isExecuting = false;
    vwt_updateMinimizeBarItem(runnerId);
    if (vwt_activeRunnerIdInModal === runnerId) {
      const rerunButton = document.getElementById('vwt-runner-rerun-btn');
      rerunButton.disabled = false;
      rerunButton.textContent = ' Re-run Test';
      const canvas = document.getElementById('vwt-runner-canvas');
      canvas.querySelectorAll('.aero-card').forEach(el => el.classList.remove('border-blue-700'));
    }
  }
}

// --- Runner UI Helpers ---

function vwt_renderRunnerCanvas(steps) {
  const canvas = document.getElementById('vwt-runner-canvas');
  canvas.innerHTML = steps.length === 0 ? `<div class="text-center aero-text-muted p-8">No steps defined.</div>` : '';
  steps.forEach((step, index) => {
    const stepConfig = vwt_availableSteps.find(s => s.name === step.name);
    if (!stepConfig) return;
    const stepEl = document.createElement('div');
    stepEl.className = `aero-card p-3 rounded border-l-4 border-blue-400 opacity-80`;
    stepEl.dataset.index = index;
    stepEl.innerHTML = `<div><span class="font-bold">${stepConfig?.icon||''} ${index + 1}. ${vwt_escapeHtml(step.name)}</span></div>
 <div class="text-xs aero-text-muted mt-1">
 ${Object.entries(step.params||{}).map(([key, value]) => `<strong>${vwt_escapeHtml(key)}:</strong> ${vwt_escapeHtml(String(value).substring(0, 30))}`).join(' | ')}
 </div>`;
    canvas.appendChild(stepEl);
  });
}

// ============================================
// MINIMIZE BAR FUNCTIONS (REFACTORED FOR MULTIPLE ITEMS)
// ============================================

function vwt_addTestToMinimizeBar(runnerId) {
  const runner = activeTestRunners.get(runnerId);
  if (!runner) return;

  const container = document.getElementById('minimize-bar-items-container');
  const bar = document.getElementById('minimize-bar');

  const item = document.createElement('div');
  item.className = 'minimized-test-item';
  item.id = `minimized-test-${runnerId}`;

  item.onclick = (e) => {
    if (e.target.closest('.close-btn')) return;
    vwt_maximizeLiveRunner(runnerId);
  };

  item.innerHTML = `
 <div class="spinner mr-2"></div>
 <span class="font-semibold">${vwt_escapeHtml(runner.suite.name)}</span>
 <button class="close-btn" title="Close Test" onclick="event.stopPropagation(); vwt_closeLiveRunner('${runnerId}')">
 &times;
 </button>
 `;

  container.appendChild(item);
  bar.classList.remove('hidden');
  document.body.style.paddingBottom = '4rem';
}

function vwt_removeTestFromMinimizeBar(runnerId) {
  const item = document.getElementById(`minimized-test-${runnerId}`);
  if (item) item.remove();

  const container = document.getElementById('minimize-bar-items-container');
  if (container.children.length === 0) {
    document.getElementById('minimize-bar').classList.add('hidden');
    document.body.style.paddingBottom = '0';
  }
}

function vwt_updateMinimizeBarItem(runnerId) {
  const runner = activeTestRunners.get(runnerId);
  if (!runner) return;

  const item = document.getElementById(`minimized-test-${runnerId}`);
  if (!item) return;

  item.classList.remove('status-success', 'status-failure');
  const spinner = item.querySelector('.spinner');

  if (runner.status === 'SUCCESS') {
    item.classList.add('status-success');
    if (spinner) spinner.style.display = 'none';
  } else if (runner.status === 'FAILURE'||runner.status === 'ERROR') {
    item.classList.add('status-failure');
    if (spinner) spinner.style.display = 'none';
  } else {
    if (spinner) spinner.style.display = 'inline-block';
  }
}

function vwt_initializeMinimizeBarScroll() {
  const wrapper = document.getElementById('minimize-bar-items-wrapper');
  const leftBtn = document.getElementById('minimize-bar-toggle-left');
  const rightBtn = document.getElementById('minimize-bar-toggle-right');
  if (!wrapper || !leftBtn || !rightBtn) return;
  const scrollAmount = 200;
  leftBtn.addEventListener('click', () => wrapper.scrollBy({ left: -scrollAmount, behavior: 'smooth' }));
  rightBtn.addEventListener('click', () => wrapper.scrollBy({ left: scrollAmount, behavior: 'smooth' }));
}
document.addEventListener('DOMContentLoaded', vwt_initializeMinimizeBarScroll);

// Make the entry point function globally accessible
window.vwt_openLiveRunner = vwt_openLiveRunner;
