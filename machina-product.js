/* Retained product affordances shared by the suite editor and visual workbench. */
(() => {
  const visible = element => !!element && !element.hidden && !element.classList.contains('hidden') && element.getClientRects().length > 0;
  const svg = name => window.LVXIcons.svg(name);
  function applyTheme(value) {
    const dark = value === 'dark';
    document.body.classList.toggle('theme-dark',dark);
    document.body.dataset.theme = dark ? 'dark' : 'light';
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {button.innerHTML=svg(dark?'sun':'moon')+(dark?'Light appearance':'Dark appearance');button.setAttribute('aria-pressed',String(dark));});
    try {localStorage.setItem('lvx_theme_preference',dark?'dark':'light');} catch {window.showMessage?.('Appearance could not be saved. Your tests are unchanged.','info');}
  }
  function decorate(root=document) {
    const header=root.querySelector?.('.studio-header') || root.querySelector?.('.lvx-header');
    if (!header || header.querySelector('[data-theme-toggle]')) return;
    const button=document.createElement('button');button.type='button';button.dataset.themeToggle='';button.className='aero-button px-3 py-2 rounded-lg';button.addEventListener('click',()=>applyTheme(document.body.dataset.theme==='dark'?'light':'dark'));header.append(button);
    // The shell can decorate its header before product init reads preferences.
    // Resolve the saved choice before applyTheme writes it back to storage.
    let theme=document.body.dataset.theme;try{theme ||= localStorage.getItem('lvx_theme_preference');}catch{}
    applyTheme(theme || 'light');
  }
  function graph() {if(window.LVXStudio?.graphEditor)return window.LVXStudio.graphEditor;return visible(document.getElementById('visual-editor-root')) ? window.visualEditor : null;}
  function typing(target) {return !!target?.closest?.('input,textarea,select,[contenteditable="true"],.monaco-editor');}
  async function searchStudio() {
    await window.LVXStudio.render('runs');
    const content=document.getElementById('studio-content');
    let input=content.querySelector('[name="run-search"]');
    if(!input){const label=document.createElement('label');label.className='studio-field';label.textContent='Find checks and runs';input=document.createElement('input');input.type='search';input.name='run-search';label.append(input);content.querySelector('.studio-page-title')?.after(label);input.addEventListener('input',()=>{const text=input.value.toLowerCase();content.querySelectorAll('.studio-record-list>li').forEach(item=>{item.hidden=!item.textContent.toLowerCase().includes(text);});});}
    input.focus();input.select();
  }
  async function shortcuts(event) {
    const key=String(event.key||'').toLowerCase(),modifier=event.ctrlKey||event.metaKey;
    const studio=document.body.classList.contains('studio-open') && window.LVXStudio;
    const editor=graph();
    const modal=Array.from(document.querySelectorAll('.mg-dialog,dialog[open]')).filter(visible).at(-1);
    if(modal&&modifier&&['s','enter','n','f'].includes(key)){
      if(key==='f')return;
      event.preventDefault();event.stopImmediatePropagation();
      if(key==='s'){const save=Array.from(modal.querySelectorAll('button')).find(button=>!button.disabled&&/^save(?:\s|$)/i.test(button.textContent.trim()));if(save)save.click();else window.showMessage?.('Finish or close the open dialog before saving the workflow.','info');}
      return;
    }
    if(typing(event.target)&&modifier&&['n','f'].includes(key))return;
    if(modifier && key==='s'){
      if(editor){event.preventDefault();event.stopImmediatePropagation();editor.onSave(editor.getGraph()).catch(error=>window.showMessage(error.message,'error'));return;}
      if(studio){event.preventDefault();const action=studio.state.page==='build'?'save-check':studio.state.page==='workflow'?'save-workflow':null;if(action)await studio.dispatch(action);return;}
      if(visible(document.getElementById('suite-modal'))){event.preventDefault();document.getElementById('suite-form')?.requestSubmit();}return;
    }
    if(modifier && key==='enter'){
      if(editor){event.preventDefault();event.stopImmediatePropagation();editor.onRun(editor.getGraph());return;}
      if(studio && studio.state.page==='build'){event.preventDefault();await studio.dispatch('run-check');return;}
      if(visible(document.getElementById('suite-modal'))){event.preventDefault();const suite=window.LVXApp?.getSelectedSuite();if(suite)await window.runTestSuite(suite.id);else window.showMessage?.('Save this suite before running it.','info');}return;
    }
    if(modifier && key==='n'){event.preventDefault();if(studio)await studio.dispatch('new-check');else window.openAddSuiteModal?.();return;}
    if(modifier && key==='f'){event.preventDefault();if(studio)await searchStudio();else {const input=document.getElementById('suite-search');input?.focus();input?.select();}return;}
    if(typing(event.target))return;
    if(editor && modifier && key==='z' && !event.shiftKey){event.preventDefault();event.stopImmediatePropagation();editor.undo();return;}
    if(editor && modifier && (key==='y'||key==='z'&&event.shiftKey)){event.preventDefault();event.stopImmediatePropagation();editor.redo();return;}
    if(editor && key==='delete'){event.preventDefault();event.stopImmediatePropagation();editor.deleteSelectedNode();}
  }
  const robotTemplate = '*** Settings ***\nLibrary    BrowserLibrary\n\n*** Test Cases ***\nCheck Page Heading\n    Element Should Exist    css=h1\n\nCheck A Form\n    Input Text    id=nameInput    Example user\n    Click Element    id=submitButton\n    Element Should Contain    id=result    Success\n';
  function getSuiteMocks() {
    const raw=document.getElementById('mock_builder_json')?.value;
    if(!raw)return {};
    const state=JSON.parse(raw);
    if(!state||typeof state!=='object'||Array.isArray(state))throw Error('The test data plan is invalid. Reopen Test data and correct it.');
    return state;
  }
  function setSuiteMocks(state={}) {
    const field=document.getElementById('mock_builder_json');if(field)field.value=JSON.stringify(state);
    const summary=document.getElementById('suite-mock-summary');
    if(summary){const count=(state.mocks||[]).length,setup=(state.setupSteps||[]).length,cleanup=(state.teardownSteps||state.cleanupSteps||[]).length;summary.textContent=Object.keys(state).length?`${count} mock variables, ${setup} setup actions, ${cleanup} cleanup actions. Open Test data to inspect file mappings.`:'No test data plan attached.';}
  }
  function openSuiteMocks() {
    return window.openMockBuilder({state:getSuiteMocks(),onSave:setSuiteMocks});
  }
  function loadWebsiteTemplate(){
    const code=document.getElementById('suite_code');
    const editor=typeof currentMonacoEditor!=='undefined'?currentMonacoEditor:window.currentMonacoEditor;
    if((editor?.getValue?.()||code?.value||'').trim()&&!window.confirm('Replace the current code with the website starter?'))return false;
    if(!editor&&!code){window.showMessage('Open a suite editor before loading the starter.','error');return false;}
    if(code)code.value=robotTemplate;editor?.setValue?.(robotTemplate);
    window.showMessage('Robot starter loaded. Select Robot Framework or Website mode and configure the page and selectors before running.','info');return true;
  }
  function initMascotPreview(){
    const trigger=document.querySelector('.lvx-mascot-trigger'),preview=document.querySelector('#lvx-mascot-preview');
    if(!trigger||!preview)return;
    let timer,overTrigger=false,overPreview=false,dismissed=false;
    const isOpen=()=>preview.matches(':popover-open');
    function close(){clearTimeout(timer);if(isOpen())preview.hidePopover();trigger.setAttribute('aria-expanded','false');}
    function position(){
      if(!isOpen())return;
      const rect=trigger.getBoundingClientRect(),gap=8,margin=12;
      if(rect.bottom<0||rect.top>innerHeight||rect.right<0||rect.left>innerWidth){close();return;}
      const width=preview.offsetWidth,height=preview.offsetHeight;
      const below=rect.bottom+gap;
      preview.style.left=Math.max(margin,Math.min(rect.left,innerWidth-width-margin))+'px';
      preview.style.top=Math.max(margin,Math.min(below+height<=innerHeight-margin?below:rect.top-height-gap,innerHeight-height-margin))+'px';
    }
    function open(){clearTimeout(timer);if(dismissed)return;if(!isOpen())preview.showPopover();position();trigger.setAttribute('aria-expanded','true');}
    function leave(){clearTimeout(timer);timer=setTimeout(()=>{if(!overTrigger&&!overPreview&&document.activeElement!==trigger)close();},180);}
    trigger.addEventListener('pointerenter',()=>{overTrigger=true;dismissed=false;open();});
    trigger.addEventListener('pointerleave',()=>{overTrigger=false;leave();});
    preview.addEventListener('pointerenter',()=>{overPreview=true;clearTimeout(timer);});
    preview.addEventListener('pointerleave',()=>{overPreview=false;leave();});
    trigger.addEventListener('focus',()=>{dismissed=false;open();});
    trigger.addEventListener('blur',leave);
    trigger.addEventListener('click',()=>{dismissed=false;open();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&isOpen()){dismissed=true;close();event.preventDefault();event.stopImmediatePropagation();}},true);
    window.addEventListener('resize',position);
    window.addEventListener('scroll',position,true);
  }
  function init(){let theme='light';try{theme=localStorage.getItem('lvx_theme_preference')||'light';}catch{}applyTheme(theme);decorate();initMascotPreview();window.addEventListener('keydown',event=>{void shortcuts(event).catch(error=>window.showMessage?.(error.message,'error'));},true);}
  window.LVXProduct={applyTheme,decorate,shortcuts,loadWebsiteTemplate,getSuiteMocks,setSuiteMocks,openSuiteMocks};window.applyTheme=applyTheme;window.toggleTheme=()=>applyTheme(document.body.dataset.theme==='dark'?'light':'dark');window.loadWebsiteTemplate=loadWebsiteTemplate;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
