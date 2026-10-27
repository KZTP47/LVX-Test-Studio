'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

function createStudioHost({app, BrowserWindow, ipcMain, dialog, safeStorage, session, onWorkspaceChanging}) {
  let services, workspaceRoot = null, previewWindow,evidenceQueue=Promise.resolve();
  const persistedRuns=new Set();
  const pendingRequests=new Map();
  let workspaceMutation=Promise.resolve();
  const mutateWorkspace=fn=>{const operation=workspaceMutation.then(fn);workspaceMutation=operation.catch(()=>{});return operation;};
  const crypto=require('node:crypto');
  const importFile=()=>path.join(app.getPath('userData'),'studio','import-trust.json');
  function imports(){if(!fs.existsSync(importFile()))return {};return JSON.parse(fs.readFileSync(importFile(),'utf8'));}
  function saveImports(value){fs.mkdirSync(path.dirname(importFile()),{recursive:true});const temp=importFile()+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(value));fs.renameSync(temp,importFile());}
  const {executableHashes}=require('./imported-executables.cjs');
  async function recordImported(value){const all=imports(),key=workspaceRoot;all[key]||={};for(const hash of await executableHashes(value))all[key][hash]={trusted:false,importedAt:new Date().toISOString()};saveImports(all);}
  async function inspectImport(value){const known=imports()[workspaceRoot]||{};return (await executableHashes(value)).filter(hash=>known[hash]&&!known[hash].trusted).sort();}
  async function checkImported(value){const hashes=await inspectImport(value);if(hashes.length){const error=Error('Review and trust the imported executable content in Project & backup before running it.');error.code='IMPORT_REVIEW_REQUIRED';error.details={hashes};throw error;}}
  async function checkFixtureDependencies(payload){const ids=new Set([payload.fixtureId,...(payload.workflow?.nodes||[]).map(n=>n.data?.fixtureId)].filter(Boolean));if(!ids.size)return;for(const fixture of await init().execution.handle('fixtures',{}))if(ids.has(fixture.id))await checkImported(fixture);}
  const entry = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
  const windows = () => BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && !w.webContents.isDestroyed() && w.webContents.getURL().split('#')[0] === entry);
  function sender(event) {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url.split('#')[0] !== entry || !windows().some(w => w.webContents.id === event.sender.id)) throw new Error('Desktop access is limited to the main LVX application.');
  }
  function emit(event) {
    const safeEvent=event.domain==='execution'&&event.type==='run'?require('./protocol-redaction.cjs').redactRun(event,redact):event.domain==='execution'&&event.type==='review-request'?require('./protocol-redaction.cjs').redactReview(event,redact):redact(event);
    // Event discriminators come from our services, never from authored output.
    safeEvent.domain=event.domain;safeEvent.type=event.type;
    if(event.domain==='execution'&&event.type==='debug'&&['connected','connecting','paused','running','resumed','closed'].includes(event.state))safeEvent.state=event.state;
    for (const w of windows()) w.webContents.send('studio:event', safeEvent);
    if(event.domain==='execution'&&event.type==='run'&&['SUCCESS','FAILURE','ERROR','CANCELLED'].includes(event.status)&&event.id&&!persistedRuns.has(event.id)&&workspaceRoot&&event.workspaceRoot===workspaceRoot){
      persistedRuns.add(event.id);
      evidenceQueue=evidenceQueue.then(async()=>{
        const run=require('./protocol-redaction.cjs').redactRun(event,redact);delete run.domain;delete run.type;
        const existing=await services.workspace.handle('read',{collection:'runs',id:run.id});
        await services.workspace.handle('transact',{records:[{collection:'runs',id:run.id,value:run,expectedRevision:existing?.revision??null}]});
        const endpointRuns=[];
        const collectEndpointRuns=(item,key='node')=>{if(item?.artifacts?.apiAtlasTestId){const a=item.artifacts;endpointRuns.push({id:run.id+'-'+key,testId:a.apiAtlasTestId,endpointId:a.apiAtlasEndpointId,definitionVersion:a.apiAtlasDefinitionVersion,workflowRunId:run.id,name:a.apiAtlasName,...a.apiAtlasResult});}for(const [id,result]of Object.entries(item?.results||{}))collectEndpointRuns(result,id);};
        collectEndpointRuns(run);
        for(const result of endpointRuns){const previous=await services.workspace.handle('read',{collection:'api-atlas-runs',id:result.id});await services.workspace.handle('transact',{records:[{collection:'api-atlas-runs',id:result.id,value:result,expectedRevision:previous?.revision??null}]});}
        const baseline=run.artifacts?.baseline;
        if(typeof baseline==='string'){
          const relative=path.relative(workspaceRoot,baseline);
          if(/^\.lvx[\\/]baselines[\\/][a-f0-9]{64}\.png$/.test(relative)){
            const filename=require('./security/boundaries.cjs').assertScopedPath(workspaceRoot,relative),stat=fs.lstatSync(filename);
            if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('Managed suite baseline is not a regular private file.');
            const id=path.basename(filename,'.png'),existingImage=await services.workspace.handle('read',{collection:'screenshots',id});
            await services.workspace.handle('transact',{records:[{collection:'screenshots',id,expectedRevision:existingImage?.revision??null,value:{type:'lvx-managed-suite-baseline',nativeFile:relative,sha256:crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'),timestamp:new Date().toISOString(),runId:run.id}}]});
          }
        }
        const output=String(run.stdout||'')+String(run.stderr||'');
        await services.workspace.handle('machina:appendLog',{value:{runId:run.id,name:run.name,status:run.status,stdout:run.stdout||'',stderr:run.stderr||''}});
        if(output)await services.workspace.handle('putArtifact',{runId:run.id,name:'output.log',mimeType:'text/plain',dataBase64:Buffer.from(output).toString('base64')});
        if(run.artifacts&&Object.keys(run.artifacts).length)await services.workspace.handle('putArtifact',{runId:run.id,name:'results.json',mimeType:'application/json',dataBase64:Buffer.from(JSON.stringify(run.artifacts)).toString('base64')});
      }).catch(error=>{persistedRuns.delete(event.id);for(const w of windows())w.webContents.send('studio:event',{domain:'workspace',type:'evidence-error',runId:event.id,error:redact(error.message)});});
    }
  }
  function init() {
    if (services) return services;
    const dataDir = path.join(app.getPath('userData'), 'studio');
    fs.mkdirSync(dataDir, {recursive:true});
    const security = require('./security').createService({dataDir:path.join(dataDir,'security'), workspaceRoot, safeStorage, emit:event=>emit({domain:'security',...event})});
    const execution = require('./execution/index.cjs').createService({dataDir:path.join(dataDir,'execution'), workspaceRoot, resolveSecret:ref=>security.resolveSecret(ref), machina:{
      requestAI:args=>require('./ai-provider.cjs').requestAI(args,{resolveSecret:ref=>security.resolveSecret(ref),redact:value=>security.redact(value)}),
      securityScan:async payload=>{const binding=workspaceRoot,result=await security.handle('scan',payload);await persistSecurityScan(result,binding);return result;},
      notify:async payload=>{emit({domain:'execution',type:'security-notification',securityResults:payload.securityResults,nodeId:payload.node?.id});return {queued:true,delivery:'pending'};},
      resolveSuite:async id=>{const suite=(await init().workspace.handle('read',{collection:'suites',id}))?.value;if(suite)await checkImported(suite);return suite;},
      resolveWebTarget:target=>init().preview.resolveTarget(target),
      resolveDataset:async id=>(await init().workspace.handle('read',{collection:'datasets',id}))?.value
    }, emit:event=>emit({domain:'execution',...event})});
    const workspace = require('./workspace/index.cjs').createService({dataDir:path.join(dataDir,'workspace'), workspaceRoot, redact:(value,context)=>context?.collection?require('./protocol-redaction.cjs').redactProjectRecord(context.collection,value,v=>security.redact(v)):security.redact(value),
      onRetentionApplied:async(summary,binding)=>{summary.nativeEffects=await require('./retention-effects.cjs').applyRetentionEffects(summary,{workspaceRoot:binding,getWorkspaceRoot:()=>workspaceRoot,execution:init().execution,restoreBaselines});for(const warning of summary.nativeEffects.warnings)emit({domain:'workspace',type:'evidence-error',error:warning});return summary.nativeEffects;},
      protectImport:async records=>{const protectedRecords=await protectNative(records);await recordImported(protectedRecords);return protectedRecords;},
      emit:event=>emit({domain:'workspace',...event})});
    const preview = require('./preview/index.cjs').createService({BrowserWindow,dataDir:path.join(dataDir,'preview'),getWorkspaceRoot:()=>workspaceRoot,emit:event=>emit({domain:'preview',...event}),assertTrusted:()=>security.assertTrusted()});
    const agents=require('./agents/index.cjs').createService({dataDir:path.join(dataDir,'agents'),workspaceRoot,workspace,
      requestAI:args=>require('./ai-provider.cjs').requestAI(args,{resolveSecret:reference=>security.resolveSecret(reference),redact:value=>security.redact(value)}),
      redact:value=>security.redact(value),emit:event=>emit({domain:'agents',...event}),
      runAcceptance:async({workflowId,workspaceRoot:binding,signal})=>{
        if(!binding||binding!==workspaceRoot)throw Error('Workspace changed before acceptance checks.');
        const record=await workspace.handle('read',{collection:'workflows',id:workflowId,workspaceRoot:binding});
        if(!record)throw Error('The selected acceptance workflow no longer exists.');
        await checkImported(record.value);await checkFixtureDependencies({workflow:record.value});
        if(binding!==workspaceRoot||signal?.aborted)throw Error('Acceptance checks were cancelled before launch.');
        const started=await execution.handle('runWorkflow',{workflow:record.value,workspaceRoot:binding});
        const cancel=()=>{void execution.handle('cancel',{id:started.id}).catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
        try{for(;;){if(binding!==workspaceRoot)throw Error('Workspace changed during acceptance checks.');if(signal?.aborted)cancel();const result=await execution.handle('getRun',{id:started.id});if(['SUCCESS','FAILURE','ERROR','CANCELLED'].includes(result.status))return result;await new Promise(resolve=>setTimeout(resolve,100));}}
        finally{signal?.removeEventListener('abort',cancel);}
      }
    });
    let coordinationTransition=false;
    const graphCollaboration=require('./coordination/graph.cjs').createGraphService({workspace,getWorkspaceRoot:()=>coordinationTransition?null:workspaceRoot,agents,
      redact:value=>security.redact(value),emit:event=>emit({domain:'coordination',...event}),
      assertAllowed:async(value,binding)=>{if(binding!==workspaceRoot)throw Error('Workspace changed.');await security.assertTrusted();await checkImported(value);await checkFixtureDependencies({workflow:value});if(binding!==workspaceRoot)throw Error('Workspace changed.');},
      execute:async({signal,...payload})=>{
        if(signal?.aborted)throw Error('Graph checks stopped before launch.');
        const binding=workspaceRoot,started=await execution.handle('runWorkflow',payload);
        const cancel=()=>{void execution.handle('cancel',{id:started.id}).catch(()=>{});};
        signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
        try{for(;;){if(binding!==workspaceRoot)throw Error('Workspace changed during graph checks.');const run=await execution.handle('getRun',{id:started.id});if(['SUCCESS','FAILURE','ERROR','CANCELLED'].includes(run.status))return run;await new Promise(resolve=>setTimeout(resolve,75));}}
        finally{signal?.removeEventListener('abort',cancel);}
      }
    });
    const missions=require('./coordination/index.cjs').createService({workspace,workspaceRoot,emit:event=>emit({domain:'coordination',...event}),
      graphContext:({workflowId,nodeIds,workspaceRoot:binding})=>graphCollaboration.context({workflowId,nodeIds,workspaceRoot:binding}),
      runChecks:async({mission,task,workspaceRoot:binding})=>{const context=await graphCollaboration.context({workflowId:mission.workflowId,nodeIds:task.workflowNodeIds,workspaceRoot:binding});return graphCollaboration.runChecks({workflowId:mission.workflowId,nodeIds:task.workflowNodeIds.length?task.workflowNodeIds:context.workflow.nodes.map(node=>node.id),runId:task.operationId,workspaceRoot:binding});},
      sendTask:async({mission,task,packet,workspaceRoot:binding})=>{
        if(binding!==workspaceRoot)throw Error('Workspace changed before dispatch.');await security.assertTrusted();
        const board=await workspace.handle('read',{collection:'agent-boards',id:mission.boardId,workspaceRoot:binding});
        if(!board)throw Error('The assigned agent board no longer exists.');await checkImported(board.value);
        if(binding!==workspaceRoot)throw Error('Workspace changed before dispatch.');
        const sent=await agents.handle('send',{boardId:mission.boardId,agentId:task.agentId,text:packet,requestId:task.operationId,workspaceRoot:binding});
        const run=await workspace.handle('read',{collection:'agent-runs',id:sent.runId,workspaceRoot:binding});return {run:run?.value};
      },
      getTaskRun:async({mission,task,workspaceRoot:binding})=>{if(binding!==workspaceRoot)throw Error('Workspace changed.');const run=await workspace.handle('read',{collection:'agent-runs',id:task.runId,workspaceRoot:binding});if(run?.value.boardId!==mission.boardId)throw Error('Agent run does not belong to this project.');return run?.value;}
    });
    const graphActions=new Set(['graphContext','analyzeGraph','previewGraphProposal','applyGraphProposal','listGraphProposals','runGraphChecks','cancelGraphChecks']);
    const coordination={handle:(action,payload)=>{if(coordinationTransition)throw Error('Project coordination is switching workspace. Reopen the project after the switch.');return graphActions.has(action)?graphCollaboration.handle(action,payload):missions.handle(action,payload);},
      async setWorkspace(root){coordinationTransition=true;await graphCollaboration.drain();await missions.drain();await missions.setWorkspace(root);coordinationTransition=root===null;},async close(){coordinationTransition=true;await graphCollaboration.drain();await missions.close();}};
    const setup=require('./setup/index.cjs').createService({dataDir:path.join(dataDir,'setup'),execution,getWorkspaceRoot:()=>workspaceRoot,assertTrusted:()=>security.assertTrusted(),redact:value=>security.redact(value),fetchImpl:(...args)=>fetch(...args),emit});
    const githubStudio=require('./github-studio/index.cjs').createService({workspace,getWorkspaceRoot:()=>workspaceRoot,resolveSecret:ref=>security.resolveSecret(ref),redact:value=>security.redact(value)});
    const apiAssistant=require('./api-atlas/assistant.cjs').createAssistant({workspace,agents,getWorkspaceRoot:()=>workspaceRoot,protect:protectNative,redact});
    services = {security,execution,workspace,preview,agents,coordination,setup,githubStudio,apiAssistant};
    return services;
  }
  async function persistSecurityScan(result,binding=workspaceRoot){if(!binding)return;if(binding!==workspaceRoot)throw Error('Workspace changed during the security scan. Run the inspection again in the selected project.');const record={...result,timestamp:result.timestamp||new Date().toISOString()};await init().workspace.handle('transact',{workspaceRoot:binding,records:[{collection:'security-history',id:/^[a-f0-9-]{36}$/.test(result.id||'')?result.id:crypto.randomUUID(),value:record,expectedRevision:null}]});}
  async function protectNative(value,label='Imported configuration'){return require('./protect-configuration.cjs').protectConfiguration(value,{label,storeSecret:payload=>init().security.handle('storeSecret',payload),decryptLegacy:ciphertext=>{if(!safeStorage?.isEncryptionAvailable())throw Error('OS encryption unavailable');return safeStorage.decryptString(Buffer.from(ciphertext,'base64'));}});}
  function redact(value) {return services?.security.redact ? services.security.redact(value) : value;}
  async function selectWorkspace(event) {
    sender(event);
    const result=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{title:'Choose your LVX workspace',properties:['openDirectory','createDirectory']});
    if(result.canceled||!result.filePaths[0])return {cancelled:true,workspaceRoot};
    return mutateWorkspace(async()=>{
      const nextRoot=fs.realpathSync(result.filePaths[0]),current=init();
      await onWorkspaceChanging?.();
      for(const controller of pendingRequests.values())controller.abort();
      await evidenceQueue;
      await current.coordination.setWorkspace(null);
      await current.agents.setWorkspace(null);
      await current.preview.handle('closeAll',{});
      await current.githubStudio.setWorkspace(nextRoot);
      await current.execution.setWorkspace?.(nextRoot);
      await current.workspace.setWorkspace?.(nextRoot);
      await current.security.setWorkspace?.(nextRoot);
      workspaceRoot=nextRoot;
      await current.agents.setWorkspace(nextRoot);
      await current.coordination.setWorkspace(nextRoot);
      try{if((await current.security.handle('status')).trusted)await current.workspace.handle('retention:reconcileEffects');}catch(error){emit({domain:'workspace',type:'evidence-error',error:'Retained evidence reconciliation needs attention: '+redact(error.message)});}
      const preference=path.join(app.getPath('userData'),'studio','selected-workspace.json');
      fs.mkdirSync(path.dirname(preference),{recursive:true});const staged=preference+'.tmp';fs.writeFileSync(staged,JSON.stringify({workspaceRoot}));fs.renameSync(staged,preference);
      emit({domain:'host',type:'workspace',workspaceRoot});return {workspaceRoot};
    });
  }
  async function trusted(payload={}) {
    if (!workspaceRoot) throw new Error('Choose a workspace folder before running tests or accessing files.');
    await init().security.assertTrusted(payload);
  }
  function scoped(candidate, options={}) {
    if (!workspaceRoot) throw new Error('Choose a workspace folder first.');
    return require('./security').assertScopedPath(workspaceRoot, candidate, options);
  }
  async function mirrorBaselines(){
    const service=init();if(!workspaceRoot)return;
    const archive=await service.preview.handle('exportBaselines',{});
    const existing=await service.workspace.handle('read',{collection:'baselines',id:'native-preview'});
    if(!existing&&!archive.items.length)return;
    if(existing&&JSON.stringify(existing.value)===JSON.stringify(archive))return;
    await service.workspace.handle('transact',{records:[{collection:'baselines',id:'native-preview',value:archive,expectedRevision:existing?.revision??null}]});
  }
  async function restoreBaselines({replace=false}={}){const service=init();const record=await service.workspace.handle('read',{collection:'baselines',id:'native-preview'});if(record||replace)await service.preview.handle('importBaselines',{archive:record?.value||{schemaVersion:1,type:'lvx-native-baselines',workspaceBinding:require('node:crypto').createHash('sha256').update(workspaceRoot).digest('hex'),items:[]}});}
  async function mirrorConfiguration(){
    const service=init(),binding=workspaceRoot;if(!binding)return;
    const configuration=await service.execution.handle('exportConfiguration',{});
    const existing=await service.workspace.handle('read',{collection:'execution-config',id:'native'});
    if(workspaceRoot!==binding)throw Error('Workspace changed while saving execution configuration. Retry in the selected folder.');
    if(existing&&JSON.stringify(existing.value)===JSON.stringify(configuration))return;
    if(!existing&&!configuration.fixtures.length&&!configuration.schedules.length)return;
    await service.workspace.handle('transact',{records:[{collection:'execution-config',id:'native',value:configuration,expectedRevision:existing?.revision??null}]});
  }
  async function restoreConfiguration({replace=false}={}){const service=init(),record=await service.workspace.handle('read',{collection:'execution-config',id:'native'});if(record||replace)await service.execution.handle('importConfiguration',{configuration:record?.value||{format:'lvx-execution-configuration',schemaVersion:1,fixtures:[],schedules:[]},replace});}
  async function preview(event, payload) {
    sender(event);
    await trusted(payload);await checkImported(payload);
    if(payload.target){const opened=await init().preview.handle('open',payload);return init().preview.handle('show',{id:opened.id});}
    if (typeof payload.html !== 'string') throw new Error('Preview HTML must be text.');
    const {createPreviewPolicy,configurePreviewContents,preparePreviewHtml}=require('./security');
    const policy=createPreviewPolicy({allowNetworkOrigins:payload.allowNetworkOrigins || []});
    const isolated = session.fromPartition('preview-'+require('node:crypto').randomUUID());
    if(previewWindow&&!previewWindow.isDestroyed())previewWindow.close();
    previewWindow=new BrowserWindow({title:'Isolated website preview',width:1050,height:780,webPreferences:{...policy.webPreferences,session:isolated}});
    configurePreviewContents(previewWindow.webContents,policy);
    const html=preparePreviewHtml(payload.html,policy);
    await previewWindow.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
    return {opened:true,isolated:true};
  }
  function register() {
    ipcMain.handle('studio:choose-path',async(event,payload={})=>{
      sender(event);require('./security').validatePayload(payload);
      if(!['dataset','project','runtime','jar','directory','mock-data','agent-project','web-project'].includes(payload.kind))throw Error('Choose a supported file type.');
      const binding=workspaceRoot;if(['agent-project','web-project'].includes(payload.kind))await trusted({workspaceRoot:binding});
      const result=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{title:payload.kind==='web-project'?'Choose the website project folder':payload.kind==='agent-project'?'Choose a folder for AI agents to work in':['project','directory'].includes(payload.kind)?'Choose workspace folder':'Choose file',defaultPath:workspaceRoot||undefined,properties:[['project','directory','agent-project','web-project'].includes(payload.kind)?'openDirectory':'openFile'],...(payload.kind==='dataset'?{filters:[{name:'CSV test data',extensions:['csv']}]}:payload.kind==='jar'?{filters:[{name:'JUnit console JAR',extensions:['jar']}]}:{})});
      if(result.canceled||!result.filePaths[0])return {cancelled:true};
      const chosen=fs.realpathSync(result.filePaths[0]);
      if(payload.kind==='web-project'){if(binding!==workspaceRoot)throw Error('Workspace changed. Choose the website folder again.');return init().preview.handle('selectFolder',{path:chosen});}
      if(payload.kind==='agent-project'){if(binding!==workspaceRoot)throw Error('Workspace changed. Add the project folder again.');return init().agents.handle('approveProjectFolder',{path:chosen,workspaceRoot:binding});}
      if(['dataset','project','directory','mock-data'].includes(payload.kind)){scoped(chosen,{mustExist:true});return {path:path.relative(workspaceRoot,chosen)||'.'};}
      return {path:chosen};
    });
    ipcMain.handle('studio:preview-command',async(event,action,payload={})=>{
      try {sender(event);require('./security').validatePayload(payload);if(action==='selectFolder'||action==='target:selectFolder')throw Error('Use Choose folder to select website files.');if(!['close','closeAll'].includes(action)){await trusted(payload);await checkImported(payload);}if(action==='open')await restoreBaselines();const result=await init().preview.handle(action,payload);if(action==='step'&&payload.name==='Save Screenshot Baseline')await mirrorBaselines();return redact(result);}
      catch(error){return {__lvxError:{code:error.code||'PREVIEW_FAILED',message:redact(error.message),details:redact(error.details||null)}};}
    });
    ipcMain.handle('studio:choose-workspace',selectWorkspace);
    ipcMain.handle('studio:preview',preview);
    ipcMain.handle('studio:new-window',event=>{sender(event);const w=new BrowserWindow({width:1280,height:850,icon:path.join(__dirname,'../assets/icons/lvx-test-studio.png'),webPreferences:{preload:path.join(__dirname,'../preload.js'),contextIsolation:true,nodeIntegration:false}});w.loadFile(path.join(__dirname,'../index.html'));return {opened:true};});
    ipcMain.handle('studio:invoke',async(event,domain,action,payload={})=>{
      try {
      sender(event);
      const securityModule=require('./security');
      securityModule.validatePayload(payload);
      if(['workspace','execution','agents'].includes(domain)&&payload.workspaceRoot&&payload.workspaceRoot!==workspaceRoot)throw Error('The selected workspace changed. Reload the editor before reading or saving.');
      if (!['execution','workspace','security','host','agents','coordination','setup','githubStudio'].includes(domain)) throw new Error('Unknown studio capability.');
      if(payload.workspaceRoot!==undefined&&payload.workspaceRoot!==workspaceRoot)throw Error('Workspace changed. Reopen the record in its original project before continuing.');
      if(domain==='githubStudio'){
        if(!workspaceRoot||payload.workspaceRoot!==workspaceRoot)throw Error('Choose and reopen the selected project before using the repository studio.');
        if(['publish','reconcile'].includes(action))await trusted(payload);
        return await init().githubStudio.handle(action,payload);
      }
      if(domain==='host') {
        if(action==='status')return {workspaceRoot,version:app.getVersion(),platform:process.platform,electron:process.versions.electron,node:process.versions.node,signing:'Not configured'};
        if(action==='apiAtlasAiOptions')return await init().agents.authors(payload);
        if(action==='apiAtlasAiSaveProvider'){await trusted(payload);return await init().agents.saveAuthor(payload,protectNative);}
        if(action==='apiAtlasAiGenerate'){
          const binding=workspaceRoot;await trusted(payload);
          if(!binding||binding!==workspaceRoot||payload.workspaceRoot!==binding)throw Error('Workspace changed before AI generation.');
          if(!/^[a-f0-9-]{36}$/.test(payload.requestId||''))throw Error('A unique AI request ID is required.');
          const boardId=/^agent:([^:]+):/.exec(payload.authorId||'')?.[1];
          if(boardId){const board=await init().workspace.handle('read',{collection:'agent-boards',id:boardId,workspaceRoot:binding});if(board)await checkImported(board.value);}
          const apiProvider=/^api:(openai|anthropic|google|custom)$/.exec(payload.authorId||'')?.[1];
          if(apiProvider){const profile=await init().workspace.handle('read',{collection:'api-ai-providers',id:apiProvider,workspaceRoot:binding});if(profile)await checkImported(profile.value);}
          if(binding!==workspaceRoot)throw Error('Workspace changed before AI generation.');
          const key=event.sender.id+':'+payload.requestId;if(pendingRequests.has(key))throw Error('This AI request is already active.');
          const controller=new AbortController();pendingRequests.set(key,controller);
          try{return await init().apiAssistant.generate(payload,controller.signal);}finally{pendingRequests.delete(key);}
        }
        if(action==='apiAtlasAiReview'){await trusted(payload);return await init().apiAssistant.review(payload);}
        if(action==='apiAtlasRun'){
          const requestedBinding=workspaceRoot;
          await trusted(payload);
          if(requestedBinding!==workspaceRoot||payload.workspaceRoot!==workspaceRoot)throw Error('Workspace changed before the API run.');
          if(!/^[a-f0-9-]{36}$/.test(payload.requestId||''))throw Error('A unique request ID is required.');
          const binding=workspaceRoot,service=init(),key=event.sender.id+':'+payload.requestId;
          if(pendingRequests.has(key))throw Error('This test run is already active.');
          const record=await service.workspace.handle('read',{collection:'api-atlas',id:'workspace'});
          if(binding!==workspaceRoot)throw Error('Workspace changed before the API run.');
          if(!record||record.revision!==payload.expectedRevision)throw Error('API tests changed in another window. Reload the API map before running.');
          const test=record.value.tests.find(test=>test.id===payload.testId);
          if(!test)throw Error('Save this endpoint test before running it.');
          const controller=new AbortController();pendingRequests.set(key,controller);
          let result;
          try{result=await require('./api-atlas/runner.cjs').run(test,{resolveSecret:reference=>service.security.resolveSecret(reference),redact,signal:controller.signal});}
          catch(error){result={status:controller.signal.aborted?'CANCELLED':'ERROR',error:redact(error.message),checks:[],finishedAt:new Date().toISOString()};}
          finally{pendingRequests.delete(key);}
          if(binding!==workspaceRoot)throw Error('Workspace changed during the API run. Reopen the original project.');
          const run=redact({id:payload.requestId,testId:test.id,endpointId:test.endpointId,definitionVersion:test.updatedAt,name:test.name,definition:test,...result});
          await service.workspace.handle('transact',{records:[{collection:'api-atlas-runs',id:run.id,value:run,expectedRevision:null}]});
          return run;
        }
        if(action==='request'){await trusted(payload);if(!/^[a-f0-9-]{36}$/.test(payload.requestId||''))throw Error('A unique request ID is required.');const key=event.sender.id+':'+payload.requestId;if(pendingRequests.has(key))throw Error('Request ID is already active.');const controller=new AbortController();pendingRequests.set(key,controller);try{return await require('./protected-request.cjs').protectedRequest(payload,{resolveSecret:reference=>init().security.resolveSecret(reference),redact,signal:controller.signal});}finally{pendingRequests.delete(key);}}
        if(action==='cancelRequest'){const key=event.sender.id+':'+payload.requestId;const controller=pendingRequests.get(key);controller?.abort();return {cancelled:!!controller};}
        if(action==='diagnostics'){const data=redact({version:app.getVersion(),platform:process.platform,electron:process.versions.electron,node:process.versions.node,workspaceSelected:!!workspaceRoot,capabilities:await init().execution.handle('capabilities',{}),security:await init().security.handle('diagnostics',{})});let serialized=JSON.stringify(data);for(const value of [workspaceRoot,require('node:os').homedir()].filter(Boolean)){serialized=serialized.split(JSON.stringify(value).slice(1,-1)).join('[local path]');}return JSON.parse(serialized);}
        if(action==='protectConfiguration'){require('./security').validatePayload(payload);return protectNative(payload.value,payload.label);}
        if(action==='pendingImports')return Object.entries(imports()[workspaceRoot]||{}).filter(([,v])=>!v.trusted).map(([hash,v])=>({hash,...v}));
        if(action==='checkImported'){await checkImported(payload);return {allowed:true};}
        if(action==='inspectImport'){await trusted(payload);return {hashes:await inspectImport(payload.definition)};}
        if(action==='trustImportDefinition'){
          await trusted(payload);const binding=workspaceRoot,hashes=await inspectImport(payload.definition);
          if(!Array.isArray(payload.hashes)||JSON.stringify([...payload.hashes].sort())!==JSON.stringify(hashes))throw Error('The imported test changed after its review. Open the review again.');
          if(binding!==workspaceRoot)throw Error('Workspace changed during import review.');
          const all=imports();for(const hash of hashes)all[binding][hash].trusted=true;saveImports(all);return {trusted:true,hashes};
        }
        if(action==='trustImport'){await trusted();if(!/^[a-f0-9]{64}$/.test(payload.hash||''))throw Error('Select an imported executable item.');const all=imports();if(!all[workspaceRoot]?.[payload.hash])throw Error('Imported content was not found.');all[workspaceRoot][payload.hash].trusted=true;saveImports(all);return {trusted:true,hash:payload.hash};}
        throw new Error('Unknown host action.');
      }
      if(domain==='setup'&&action==='openSource'){await require('electron').shell.openExternal(require('./setup/catalog.cjs').item(payload.itemId).source);return {opened:true};}
      if(domain==='agents'){
        const binding=workspaceRoot;payload={...payload,workspaceRoot:binding};
        if(action==='approveProjectFolder')throw Error('Use Add project folder to choose and allow a folder.');
        if(['configureProvider','openLogin'].includes(action))await trusted(payload);
        if(action==='openProviderSource'){
          const sources={codex:'https://developers.openai.com/codex/cli/',claude:'https://code.claude.com/docs/en/setup',gemini:'https://geminicli.com/docs/get-started/installation/'};
          if(!sources[payload.provider])throw Error('Choose a supported provider.');
          await require('electron').shell.openExternal(sources[payload.provider]);return {opened:true};
        }
        if(action==='openLogin'){
          const command=await init().agents.handle('loginInvocation',payload);
          if(process.platform!=='win32')throw Error('Open the provider CLI in your terminal to sign in on this platform.');
          const system=path.resolve(process.env.SystemRoot||'');
          if(!/^[A-Za-z]:\\Windows$/i.test(system)||system.toLowerCase()!==path.resolve(process.env.WINDIR||'').toLowerCase())throw Error('The Windows sign-in terminal could not be located.');
          const terminal=path.join(system,'System32','WindowsPowerShell','v1.0','powershell.exe');
          const script='Write-Host "Sign in using the official AI tool. Then return to LVX and select Recheck connection."; [string[]]$lvxLoginArgs=@(ConvertFrom-Json $env:LVX_AGENT_LOGIN_ARGS); & $env:LVX_AGENT_LOGIN_EXE @lvxLoginArgs';
          const child=require('node:child_process').spawn(terminal,['-NoLogo','-NoProfile','-NoExit','-Command',script],{cwd:binding,windowsHide:false,detached:true,stdio:'ignore',env:{...process.env,...command.env,LVX_AGENT_LOGIN_EXE:command.command,LVX_AGENT_LOGIN_ARGS:JSON.stringify(command.args)}});
          await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();return {opened:true};
        }
        if(['send','runGoal','resume','runAcceptance'].includes(action)){
          await trusted(payload);
          const board=(await init().workspace.handle('read',{collection:'agent-boards',id:payload.boardId,workspaceRoot:binding}))?.value;
          if(board)await checkImported(board);
        }
        if(['saveBoard','validateBoard'].includes(action)&&payload.board)payload.board=await protectNative(payload.board,'Agent board configuration');
        if(binding!==workspaceRoot)throw Error('Workspace changed before this agent operation. Reopen the board.');
      }
      if(domain==='coordination'){
        await trusted(payload);
        if(payload.workspaceRoot!==workspaceRoot)throw Error('Reopen Agent projects in the selected workspace.');
      }
      if(domain==='execution' && ['start','runWorkflow','rerunFailed','saveSchedule','debug','configureRuntimes','importConfiguration','generatePreview','sourceFiles','reviewDecision','pendingReviews','pruneRuns'].includes(action)){await trusted(payload);if(action!=='importConfiguration'){await checkImported(payload);await checkFixtureDependencies(payload);}}
      if(domain==='workspace'&&['retention:acknowledgeEffects','retention:deferForeignEffects'].includes(action))throw Error('Cleanup receipts can only be completed by the native evidence coordinator.');
      if(domain==='workspace'&&(action.startsWith('machina:')||action.startsWith('retention:')))await trusted(payload);
      if(domain==='workspace'&&['backup','previewImport','import','recover'].includes(action))await evidenceQueue;
      if(domain==='workspace'&&action==='backup'){await mirrorBaselines();await mirrorConfiguration();}
      if(domain==='workspace'&&['previewImport','import','recover','validateRecovery'].includes(action)&&payload.archive){
        // Validate native binary payloads before the canonical SQLite transaction.
        const baseline=payload.archive.payload?.records?.find(r=>r.collection==='baselines'&&r.id==='native-preview');
        if(baseline)await init().preview.handle('validateBaselines',{archive:baseline.value});
        const config=payload.archive.payload?.records?.find(r=>r.collection==='execution-config'&&r.id==='native');
        if(config){const validation=await init().execution.handle('validateConfiguration',{configuration:config.value,replace:['recover','validateRecovery'].includes(action)||payload.mode==='replace'});if(!validation.valid)throw Error('Execution configuration in archive is invalid: '+validation.errors.join(' '));}
      }
      if(domain==='security' && ['scan','installAdapter'].includes(action))await trusted(payload);
      // Persist the trust denial before committing imported code. A failed import
      // may require review again, but cannot leave new executable content trusted.
      if(domain==='workspace'&&['import','recover'].includes(action)){
        // Resolve the persisted recovery archive before restoring it so imported
        // executable content can never appear between commit and trust denial.
        if(!payload.archive&&action==='recover')throw Error('Choose a verified recovery archive explicitly in Project & backup.');

      }
      if(domain==='execution'&&action==='importWorkflow'&&payload.commit)await recordImported(payload.bundle);
      if(domain==='execution'&&action==='importConfiguration')await recordImported(payload.configuration);
      if(payload.workspaceRoot!==undefined&&payload.workspaceRoot!==workspaceRoot)throw Error('Workspace changed before this operation. Reload the record.');
      const operationWorkspace=workspaceRoot;
      let result;
      if(domain==='workspace'&&['import','recover'].includes(action)){
        result=await mutateWorkspace(async()=>{
          if(operationWorkspace!==workspaceRoot)throw Error('Workspace changed before project restore. Reopen the archive in the intended folder.');
          await recordImported(payload.archive);
          const service=init();await service.coordination.setWorkspace(null);await service.agents.setWorkspace(null);
          let agentArchiveCommitted=false;
          try{
            const restored=await service.workspace.handle(action,{...payload,workspaceRoot:operationWorkspace});agentArchiveCommitted=true;
            const warnings=[];
            try{const replace=action==='recover'||payload.mode==='replace';await restoreConfiguration({replace});await restoreBaselines({replace});}
            catch(error){warnings.push('The SQLite project import committed, but runtime evidence needs recovery: '+redact(error.message));emit({domain:'workspace',type:'recovery-error',error:warnings[0]});}
            if(warnings.length)restored.warnings=warnings;
            return restored;
          }finally{await service.agents.setWorkspace(operationWorkspace);await service.coordination.setWorkspace(operationWorkspace);if(agentArchiveCommitted)emit({domain:'agents',type:'reset',workspaceRoot:operationWorkspace});}
        });
      }else result=await init()[domain].handle(action,payload);
      if(domain==='security'&&action==='scan')await persistSecurityScan(result,operationWorkspace);
      if(domain==='security'&&action==='trust'&&payload.trusted===true&&!payload.importedWorkflowId)await init().workspace.handle('retention:reconcileEffects');
      if(domain==='execution'&&(['saveFixture','saveSchedule','cancelSchedule'].includes(action)||action==='importWorkflow'&&payload.commit))await mirrorConfiguration();
      // A newly created team credential is deliberately shown once to its owner.
      if(domain==='workspace'&&['startTeam','createTeamIdentity'].includes(action))return result;
      if(domain==='workspace'&&action==='backup')return result; // checksums bind the service's already-redacted payload
      // These canonical values were never decrypted; native run evidence was
      // redacted before persistence. Rewriting identifiers here corrupts schemas.
      if(domain==='workspace'&&(['read','list','transact'].includes(action)||action.startsWith('machina:')||action.startsWith('retention:')))return result;
      if(domain==='execution'&&['start','getRun','runWorkflow','rerunFailed','cancel'].includes(action))return require('./protocol-redaction.cjs').redactRun(result,redact);
      if(domain==='execution'&&action==='runs')return result.map(run=>require('./protocol-redaction.cjs').redactRun(run,redact));
      if(domain==='execution'||domain==='agents'||domain==='coordination'||domain==='setup')return result;
      return redact(result);
      } catch(error) { return {__lvxError:{code:typeof error.code==='string'?error.code:'OPERATION_FAILED',message:redact(error.message),details:redact(error.details||null)}}; }
    });
  }
  async function close(){for(const controller of pendingRequests.values())controller.abort();pendingRequests.clear();if(services){await services.githubStudio.close();await services.setup.close();await services.coordination.close();await services.agents.close();await services.preview.handle('closeAll',{});await services.execution.close?.();await evidenceQueue;await services.workspace.close?.();await services.security.close?.();}}
  async function restoreWorkspace(){
    const file=path.join(app.getPath('userData'),'studio','selected-workspace.json');if(!fs.existsSync(file))return;
    try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(typeof saved.workspaceRoot!=='string'||!fs.statSync(saved.workspaceRoot).isDirectory())return;workspaceRoot=fs.realpathSync(saved.workspaceRoot);init();}catch{workspaceRoot=null;return;}
    try{if((await init().security.handle('status')).trusted)await init().workspace.handle('retention:reconcileEffects');}catch(error){emit({domain:'workspace',type:'evidence-error',error:'Pending evidence cleanup needs attention: '+redact(error.message)});}
  }
  return {register,sender,trusted,scoped,init,redact,close,restoreWorkspace,resolveSecret:reference=>init().security.resolveSecret(reference),checkImported,get workspaceRoot(){return workspaceRoot;}};
}
module.exports={createStudioHost};
