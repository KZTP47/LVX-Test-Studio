'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, fork, execFile } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const { StringDecoder } = require('node:string_decoder');
const GraphEngine = require('../../graph-engine.js');
const adapters = require('./adapters.cjs');
const { pythonEnvironment } = require('./python-environment.cjs');
const { createProtocol } = require('./python-protocol.cjs');
const { createRedactor } = require('./redaction.cjs');
const { pausedContext } = require('./debug-context.cjs');
const { createMachinaRuntime } = require('../machina/runtime.cjs');
const machinaFiles = require('../machina/util.cjs');
const TERMINAL = new Set(['SUCCESS','FAILURE','ERROR','CANCELLED']);
const clone = value => JSON.parse(JSON.stringify(value));
function atomic(file, value) { fs.mkdirSync(path.dirname(file), { recursive:true }); const tmp = `${file}.${crypto.randomUUID()}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value,null,2)); fs.renameSync(tmp,file); }
function killTree(child) { return new Promise(resolve => { if (!child?.pid) return resolve(); if (process.platform === 'win32') execFile('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true},()=>resolve()); else { try { process.kill(-child.pid,'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } resolve(); } }); }
function within(root, candidate) { const real = fs.realpathSync(candidate); const rel = path.relative(root,real); if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('Path is outside the selected workspace.'); return real; }
function validateParameters(schema = {}, parameters = {}) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema) || !parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new Error('Parameter schema and values must be objects.');
    const result = { ...parameters };
    for (const [name, rule] of Object.entries(schema)) {
        if (!rule || typeof rule !== 'object') throw new Error(`Invalid parameter schema for ${name}.`);
        if (!(name in result) && 'default' in rule) result[name] = rule.default;
        const value = result[name];
        if (rule.required && (value === undefined || value === null || value === '')) throw new Error(`Parameter ${name} is required.`);
        if (value === undefined) continue;
        if (rule.secret) { if (!value || typeof value !== 'object' || typeof value.secretRef !== 'string') throw new Error(`Parameter ${name} needs a credential reference.`); continue; }
        if (rule.type && !GraphEngine.matchesType(value,rule.type)) throw new Error(`Parameter ${name} must be ${rule.type}.`);
        if (typeof value === 'number' && (!Number.isFinite(value) || rule.minimum != null && value < rule.minimum || rule.maximum != null && value > rule.maximum)) throw new Error(`Parameter ${name} is outside its allowed range.`);
        if (rule.enum && !rule.enum.includes(value)) throw new Error(`Parameter ${name} must be one of the available choices.`);
    }
    return result;
}
function createService(options = {}) {
    if (!options.dataDir) throw new Error('Execution dataDir is required.');
    const dataDir = path.resolve(options.dataDir), runsDir = path.join(dataDir,'runs'); fs.mkdirSync(runsDir,{recursive:true});
    const active = new Map(), records = new Map(), debugClients = new Map(), timers = new Map(), knownSecrets = new Set(), capabilityCache = new Map(), outputBuffers = new Map(), completedDebugRuns=new Set(),capabilityWorkers=new Set(),reviews=new Map();
    let workspaceRoot = options.workspaceRoot ? fs.realpathSync(options.workspaceRoot) : null,workspaceGeneration=0,closed=false;
    const redaction = createRedactor(), redact = redaction.redact, outputDecoders = new Map();
    const uuid = value => typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    function safeReview(value){const safe=redact(value);for(const key of ['decisionId'])if(uuid(value?.[key]))safe[key]=value[key];if(typeof value?.nodeId==='string'&&value.nodeId.length<=128)safe.nodeId=value.nodeId;if(['code-review','ai-unit-test'].includes(value?.kind))safe.kind=value.kind;if(['approve','reject'].includes(value?.decision))safe.decision=value.decision;if(value?.state==='pending')safe.state='pending';for(const key of ['proposalHash','finalCodeHash'])if(/^[a-f0-9]{64}$/.test(value?.[key]||''))safe[key]=value[key];for(const key of ['automated','deployRequested'])if(typeof value?.[key]==='boolean')safe[key]=value[key];return safe;}
    function safeResult(value) {const safe=redact(value);if(value&&TERMINAL.has(value.status))safe.status=value.status;if(Array.isArray(value?.cases))safe.cases=value.cases.map(item=>{const result=redact(item);if(['PENDING',...TERMINAL].includes(item.status))result.status=item.status;return result;});return safe;}
    function safeRun(value) {
        const safe=redact(value);
        if(uuid(value?.id)&&[...adapters.ENGINES,'workflow'].includes(value.engine)&&['RUNNING','PENDING',...TERMINAL].includes(value.status)){
            safe.id=value.id;safe.engine=value.engine;safe.status=value.status;
            if(value.workspaceRoot===workspaceRoot)safe.workspaceRoot=value.workspaceRoot;
            for(const field of ['startedAt','finishedAt'])if(typeof value[field]==='string'&&Number.isFinite(Date.parse(value[field]))&&new Date(value[field]).toISOString()===value[field])safe[field]=value[field];
            for(const field of ['originalRunId','runId'])if(uuid(value[field]))safe[field]=value[field];
            for(const field of ['workflowHash','parametersHash'])if(typeof value[field]==='string'&&/^[a-f0-9]{64}$/.test(value[field]))safe[field]=value[field];
            if(value.fixture&&typeof value.fixture.id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,199}$/.test(value.fixture.id)&&Number.isSafeInteger(value.fixture.version)&&value.fixture.version>0)safe.fixture={id:value.fixture.id,version:value.fixture.version};
            if(Array.isArray(value.cases))safe.cases=safeResult(value).cases;
            if(value.engine==='workflow'&&value.results&&typeof value.results==='object')safe.results=Object.fromEntries(Object.entries(value.results).map(([key,result])=>{const sanitized=uuid(result?.id)?safeRun(result):redact(result);if(['RUNNING','PENDING',...TERMINAL].includes(result?.status))sanitized.status=result.status;return[key,sanitized];}));
            if(value.engine==='workflow'){safe.pendingReviews=(value.pendingReviews||[]).map(safeReview);safe.reviewDecisions=(value.reviewDecisions||[]).map(safeReview);}
        }
        return safe;
    }
    const emit = (type, data) => {const safe=type==='run'?safeRun(data):type==='review-request'?safeReview(data):redact(data);if(['output','debug','review-request'].includes(type)&&uuid(data?.id)&&(records.has(data.id)||active.has(data.id)))safe.id=data.id;options.emit?.({domain:'execution',type,...clone(safe)});};
    const write = run => { const safe = safeRun(run); records.set(run.id,safe); atomic(path.join(runsDir,`${run.id}.json`),safe); emit('run',safe); };
    for (const name of fs.readdirSync(runsDir)) if (/^[\w-]+\.json$/.test(name)) {
            try { const r = JSON.parse(fs.readFileSync(path.join(runsDir,name),'utf8')); if(!r.workspaceRoot&&workspaceRoot){const relative=path.relative(workspaceRoot,dataDir);if(relative!== '..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative))r.workspaceRoot=workspaceRoot;} if (!TERMINAL.has(r.status)) { r.status='ERROR'; r.errors=(r.errors||0)+1; r.error='Execution service stopped before this run completed.'; r.finishedAt=new Date().toISOString();if(r.pendingReviews?.length){r.interruptedReviews=r.pendingReviews.map(review=>({...review,state:'interrupted'}));r.pendingReviews=[];r.reviewState=null;} } records.set(r.id,r); atomic(path.join(runsDir,name),r); } catch (error) { emit('recovery-error',{file:name,message:error.message}); }
    }
    const stateFile = path.join(dataDir,'configuration.json');
    let config = { fixtures:[],schedules:[] };
    if (fs.existsSync(stateFile)) { try { config = JSON.parse(fs.readFileSync(stateFile,'utf8')); } catch { throw new Error('Execution configuration is damaged. Restore a workspace backup before continuing.'); } }
    options.runtimePaths={...(config.runtimePaths||{}),...(options.runtimePaths||{})};
    // Authored configuration contains unresolved references, never the runtime
    // parameter object. Reject credential literals; do not rewrite schema/IDs.
    const save = () => atomic(stateFile,config);
    const scopedFixtures = () => config.fixtures.filter(item => item.workspaceRoot === workspaceRoot);
    // Portable IDs are project-local. A timer must never share identity with
    // an equally named schedule imported into another workspace.
    const scheduleKey = schedule => JSON.stringify([schedule.workspaceRoot,schedule.id]);
    const currentSchedule = schedule => config.schedules.find(item=>item.id===schedule.id&&item.workspaceRoot===schedule.workspaceRoot)===schedule;
    const portableFixture = item => ({ id:item.id,version:item.version,name:item.name,engine:item.engine,setup:item.setup||'',cleanup:item.cleanup||'' });
    const portableSchedule = item => ({id:item.id,name:item.name,workflow:clone(item.workflow),intervalMs:item.intervalMs,missedRun:item.missedRun,enabled:item.enabled===true,nextRun:item.nextRun});
    function exportConfiguration() {
        requireWorkspace();
        const snapshot={format:'lvx-execution-configuration',schemaVersion:1,fixtures:scopedFixtures().map(portableFixture),schedules:config.schedules.filter(item=>item.workspaceRoot===workspaceRoot).map(portableSchedule)};
        if(configurationHasCredential(snapshot))throw new Error('Execution configuration contains a credential literal. Replace it with an opaque secret reference before exporting.');
        return clone(snapshot);
    }
    function configurationHasCredential(value){
        const evidence=[];
        for(const fixture of value.fixtures||[])evidence.push(fixture?.name,fixture?.setup,fixture?.cleanup);
        const dataValues=data=>Array.isArray(data)?data.map(dataValues):data&&typeof data==='object'?typeof data.secretRef==='string'?null:Object.values(data).map(dataValues):data;
        for(const schedule of value.schedules||[]){evidence.push(schedule?.name,schedule?.workflow?.description);for(const node of schedule?.workflow?.nodes||[]){const data=node.data||{};evidence.push(data.name,data.description,data.code,data.setup,data.cleanup,dataValues(data.parameters),dataValues(data.inputs),dataValues(data.inputFiles),dataValues(data.contextVariables));}}
        return JSON.stringify(redact(evidence))!==JSON.stringify(evidence);
    }
    function validateConfiguration(configuration, { replace = false } = {}) {
        requireWorkspace();
        const errors=[], fixtureIds=new Set(), scheduleIds=new Set();
        if(!configuration||configuration.format!=='lvx-execution-configuration'||configuration.schemaVersion!==1||!Array.isArray(configuration.fixtures)||!Array.isArray(configuration.schedules))return {valid:false,errors:['Unsupported execution configuration format/schema.'],fixtureCount:0,scheduleCount:0,schedulesWillBeDisabled:true};
        if(configuration.fixtures.length>1000||configuration.schedules.length>1000)errors.push('Execution configuration exceeds 1,000 fixtures or schedules.');
        const id=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,199}$/.test(value);
        for(const fixture of configuration.fixtures){
            if(!fixture||!id(fixture.id)||!Number.isSafeInteger(fixture.version)||fixture.version<1||typeof fixture.name!=='string'||!fixture.name.trim()||!['javascript','playwright','python'].includes(fixture.engine)||typeof fixture.setup!=='string'||typeof fixture.cleanup!=='string'){errors.push('A fixture has an invalid identity, version, engine or script.');continue;}
            if(Object.keys(fixture).some(key=>!['id','version','name','engine','setup','cleanup'].includes(key)))errors.push('Portable fixtures contain unsupported fields.');
            const identity=`${fixture.id}:${fixture.version}`;
            if(fixtureIds.has(identity))errors.push('Duplicate immutable fixture version.');fixtureIds.add(identity);
            const previous=scopedFixtures().find(item=>item.id===fixture.id&&item.version===fixture.version);
            if(!replace&&previous&&JSON.stringify(portableFixture(previous))!==JSON.stringify(portableFixture(fixture)))errors.push(`Fixture version conflict: ${fixture.id} v${fixture.version}.`);
        }
        for(const schedule of configuration.schedules){
            if(!schedule||!id(schedule.id)||typeof schedule.name!=='string'||!schedule.name.trim()||!Number.isInteger(schedule.intervalMs)||schedule.intervalMs<1000||schedule.intervalMs>31536000000||!['skip','run-once'].includes(schedule.missedRun)||!Number.isFinite(Date.parse(schedule.nextRun))||typeof schedule.enabled!=='boolean'){errors.push('A schedule has an invalid identity, interval, date or missed-run policy.');continue;}
            if(Object.keys(schedule).some(key=>!['id','name','workflow','intervalMs','missedRun','nextRun','enabled'].includes(key)))errors.push('Portable schedules contain unsupported fields.');
            if(scheduleIds.has(schedule.id))errors.push('Duplicate schedule identity.');scheduleIds.add(schedule.id);
            const validation=GraphEngine.validate(schedule.workflow,{strict:true});
            if(!validation.valid)errors.push(...validation.errors.map(error=>`Schedule ${schedule.id}: ${error}`));
            else for(const node of validation.workflow.nodes){
                try{if(node.data?.parameterSchema)validateParameters(node.data.parameterSchema,node.data.parameters||{});}catch(error){errors.push(`Schedule parameter validation: ${error.message}`);}
                const data=node.data||{};
                if(data.fixtureId&&!configuration.fixtures.concat(replace?[]:scopedFixtures()).some(item=>item.id===data.fixtureId&&(!data.fixtureVersion||item.version===data.fixtureVersion)))errors.push('Schedule references an unavailable fixture version.');
            }
        }
        if(configurationHasCredential(configuration))errors.push('Configuration contains a resolved credential value. Replace it with an opaque secret reference.');
        return {valid:!errors.length,errors:errors.slice(0,100),fixtureCount:configuration.fixtures.length,scheduleCount:configuration.schedules.length,schedulesWillBeDisabled:true};
    }
    function importConfiguration(configuration, { fixtureOnly = false, replace = false } = {}) {
        const validation=validateConfiguration(configuration,{replace});
        if(!validation.valid){const error=new Error(validation.errors.join(' '));error.code='CONFIGURATION_INVALID';error.details=validation;throw error;}
        const next=clone(config);
        if(!fixtureOnly)next.schedules=next.schedules.filter(item=>item.workspaceRoot!==workspaceRoot);
        if(replace)next.fixtures=next.fixtures.filter(item=>item.workspaceRoot!==workspaceRoot);
        for(const fixture of configuration.fixtures)if(!next.fixtures.some(item=>item.workspaceRoot===workspaceRoot&&item.id===fixture.id&&item.version===fixture.version))next.fixtures.push({...portableFixture(fixture),workspaceRoot});
        for(const schedule of configuration.schedules){const restored={...portableSchedule(schedule),workspaceRoot,enabled:false};const index=next.schedules.findIndex(item=>item.id===schedule.id&&item.workspaceRoot===workspaceRoot);if(index<0)next.schedules.push(restored);else next.schedules[index]=restored;}
        atomic(stateFile,next);
        if(!fixtureOnly)for(const schedule of config.schedules.filter(item=>item.workspaceRoot===workspaceRoot)){const key=scheduleKey(schedule);clearTimeout(timers.get(key));timers.delete(key);}
        config=next;
        for(const schedule of config.schedules)arm(schedule);
        return {status:'SUCCESS',fixtureCount:configuration.fixtures.length,scheduleCount:configuration.schedules.length,schedulesDisabled:true};
    }
    async function capability(cwd,refresh=false){
        let cached=capabilityCache.get(cwd||'');
        if(!cached||refresh||Date.now()-cached.at>30000){
            const promise=new Promise((resolve,reject)=>{
                const worker=new Worker(path.join(__dirname,'capabilities-worker.cjs'),{workerData:{workspaceRoot:cwd,runtimePaths:options.runtimePaths,nodeExecutable:options.nodeExecutable,browserResourcePath:process.resourcesPath}});
                capabilityWorkers.add(worker);
                const timer=setTimeout(()=>{void worker.terminate();reject(new Error('Runtime detection timed out. Check installed runtime executables.'));},45000);
                worker.once('message',message=>{clearTimeout(timer);void worker.terminate();message.error?reject(new Error(message.error)):resolve(message.value);});worker.once('error',error=>{clearTimeout(timer);reject(error);});worker.once('exit',code=>{capabilityWorkers.delete(worker);if(code!==0){clearTimeout(timer);reject(new Error('Runtime detection worker stopped.'));}});
            });cached={at:Date.now(),promise};capabilityCache.set(cwd||'',cached);promise.catch(()=>capabilityCache.delete(cwd||''));
        }
        return {...await cached.promise,nodeTypes:GraphEngine.nodeTypes(),machina:{schemaVersion:1,reviewDecisions:true,sourceSelection:true,generatePreview:true}};
    }
    function requireWorkspace() { if (!workspaceRoot) throw new Error('Choose and trust a workspace before running authored code.'); return workspaceRoot; }
    function project(candidate) { return within(requireWorkspace(),path.resolve(requireWorkspace(),candidate || '.')); }
    function get(id) { if (typeof id !== 'string' || !records.has(id)||!workspaceRoot||records.get(id).workspaceRoot!==workspaceRoot) throw new Error('Run not found in the selected workspace.'); return records.get(id); }
    async function resolvedParameters(schema, values) {
        const params = validateParameters(schema,values);
        for (const [key,rule] of Object.entries(schema || {})) if (rule.secret && params[key]) {
            if (!options.resolveSecret) throw new Error('Credential storage is unavailable.');
            const value = await options.resolveSecret(params[key].secretRef); if (typeof value !== 'string' || !value) throw new Error(`Credential for ${key} is unavailable.`); knownSecrets.add(value); redaction.add(value); params[key]=value;
        }
        return params;
    }
    async function resolveReferences(value) {
        if(Array.isArray(value))return Promise.all(value.map(resolveReferences));
        if(value&&typeof value==='object'){
            if(typeof value.secretRef==='string')return resolveReference(value.secretRef);
            return Object.fromEntries(await Promise.all(Object.entries(value).map(async([key,item])=>[key,await resolveReferences(item)])));
        }
        if(typeof value!=='string')return value;
        const references=[...value.matchAll(/secret:[a-f0-9-]{36}/g)];let resolved=value;
        for(const match of references)resolved=resolved.split(match[0]).join(await resolveReference(match[0]));
        return resolved;
    }
    async function resolveReference(reference){if(!options.resolveSecret)throw Error('Credential storage is unavailable.');const value=await options.resolveSecret(reference);if(typeof value!=='string'||!value)throw Error('Credential reference is unavailable.');knownSecrets.add(value);redaction.add(value);return value;}
    const machina=createMachinaRuntime({getRoot:requireWorkspace,start,wait,cancel,resolve:resolveReferences,redact,killTree,nodeExecutable:options.nodeExecutable||options.runtimePaths.node,hooks:options.machina||{}});
    function requestReview(run,node,kind,proposal,signal){
        if(signal.aborted)return Promise.reject(Object.assign(Error('Execution cancelled.'),{name:'AbortError'}));
        const decisionId=crypto.randomUUID(),entry={decisionId,nodeId:node.id,kind,proposal:redact(proposal),proposalHash:machinaFiles.hash(redact(proposal)),requestedAt:new Date().toISOString(),state:'pending'};
        run.pendingReviews||=[];run.pendingReviews.push(entry);run.reviewState='WAITING';write(run);
        return new Promise((resolve,reject)=>{const key=run.id+':'+decisionId,abort=()=>{reviews.delete(key);run.pendingReviews=run.pendingReviews.filter(r=>r.decisionId!==decisionId);run.reviewState=run.pendingReviews.length?'WAITING':null;write(run);reject(Object.assign(Error('Execution cancelled.'),{name:'AbortError'}));};reviews.set(key,{run,entry,resolve,reject,abort,signal});signal.addEventListener('abort',abort,{once:true});emit('review-request',{id:run.id,...entry});if(signal.aborted)abort();});
    }
    function reviewDecision(payload){
        const record=get(payload.id),key=payload.id+':'+payload.decisionId,pending=reviews.get(key);
        if(!pending||pending.run.id!==record.id||!pending.run.pendingReviews?.some(r=>r.decisionId===payload.decisionId))throw Error('Pending review decision was not found.');
        if(!['approve','reject'].includes(payload.decision))throw Error('Choose explicit approve or reject.');
        if(payload.finalCode!=null&&(typeof payload.finalCode!=='string'||Buffer.byteLength(payload.finalCode)>8*1024*1024))throw Error('Reviewed code must be text smaller than 8 MB.');
        if(payload.history!=null&&(!Array.isArray(payload.history)||payload.history.length>100||Buffer.byteLength(JSON.stringify(payload.history))>2*1024*1024))throw Error('Review history supports up to 100 entries and 2 MB.');
        const finalCode=payload.finalCode??pending.entry.proposal.finalCode;if(payload.decision==='approve'&&(!finalCode||!finalCode.trim()))throw Error('Approval requires nonempty reviewed code.');
        const evidence={decisionId:payload.decisionId,nodeId:pending.entry.nodeId,kind:pending.entry.kind,decision:payload.decision,decidedAt:new Date().toISOString(),proposalHash:pending.entry.proposalHash,finalCode:payload.decision==='approve'?redact(finalCode):null,finalCodeHash:payload.decision==='approve'?machinaFiles.hash(redact(finalCode)):null,deployRequested:payload.decision==='approve'&&payload.deployRequested===true,automated:false,history:redact((payload.history||[]).map(item=>({prompt:String(item.prompt||''),originalCode:String(item.originalCode||''),suggestedCode:String(item.suggestedCode||''),status:String(item.status||''),timestamp:String(item.timestamp||'')})))};
        pending.run.reviewDecisions||=[];pending.run.reviewDecisions.push(evidence);pending.run.pendingReviews=pending.run.pendingReviews.filter(r=>r.decisionId!==payload.decisionId);pending.run.reviewState=pending.run.pendingReviews.length?'WAITING':null;
        write(pending.run);reviews.delete(key);pending.signal.removeEventListener('abort',pending.abort);pending.resolve(clone(evidence));return clone(safeReview(evidence));
    }
    function output(run, stream, chunk, flush = false) {
        const key=`${run.id}:${stream}`;
        if(!outputDecoders.has(key))outputDecoders.set(key,new StringDecoder('utf8'));
        const decoder=outputDecoders.get(key);
        const decoded=(typeof chunk==='string'?chunk:decoder.write(chunk))+(flush?decoder.end():'');
        if(flush)outputDecoders.delete(key);
        let text=redact((outputBuffers.get(key)||'')+decoded), retained='';
        // A secret can span arbitrary stdout packets. Hold any suffix which is
        // still a possible secret prefix before sending renderer events.
        for(const secret of redaction.variants) for(let length=Math.min(secret.length-1,text.length);length>retained.length;length--) if(text.endsWith(secret.slice(0,length))) {retained=text.slice(-length);break;}
        if(retained)text=text.slice(0,-retained.length);
        if(flush){if(retained)text+='[REDACTED]';outputBuffers.delete(key);}else outputBuffers.set(key,retained);
        if(!text)return;
        run[stream] = ((run[stream] || '') + text).slice(-1024*1024);
        emit('output',{id:run.id,stream,text}); write(run);
    }
    function wait(id) { return new Promise(resolve => { const poll = () => { const r=get(id); if (TERMINAL.has(r.status)) resolve(clone(r)); else setTimeout(poll,20); }; poll(); }); }
    async function start(payload = {}) {
        if(payload.mock_builder||payload.mockBuilder){
            requireWorkspace();const plan=require('../../mock-runtime.js').buildSuiteExecutionPlan(payload,payload.inputs||{});
            if(plan.setupSteps.length||plan.teardownSteps.length||plan.hasFileIterations)return runWorkflow({workflow:{name:payload.name||'Check with data',nodes:[{id:'check',type:'test-suite',data:{suite:{...payload,engine:payload.engine||'javascript'}}}],edges:[]},parameters:payload.parameters||{}});
        }
        const generation=workspaceGeneration;
        const target=project(payload.projectPath),engine=payload.engine||'javascript';
        let cwd=target;
        if(fs.statSync(target).isFile()){if(engine!=='nunit'||! /\.(csproj|sln|slnx)$/i.test(target))throw new Error('Choose a project directory, or a .csproj/.sln file for NUnit.');cwd=path.dirname(target);payload={...payload,nativeProject:target};}
        if(payload.debug&&engine!=='javascript')throw new Error('Interactive debugging is currently available for JavaScript. Other engines support cancellation and native runner output.');
        if (!adapters.ENGINES.includes(engine)) throw new Error(`Unsupported engine ${engine}.`);
        if(['jest','junit','nunit','pytest'].includes(engine)&&Object.values(payload.parameterSchema||{}).some(rule=>rule?.secret))throw new Error('Secret parameters are unavailable for this native project adapter because its framework writes reports to disk. Use the memory-only JavaScript, Playwright, Python or Robot engine for vault-backed parameters.');
        for(const field of ['code','setup','cleanup','validationCode'])if(payload[field]!=null&&typeof payload[field]!=='string')throw new Error(`${field} must contain script text.`);
        if(payload.validationCode&&engine!=='python')throw Error('Output validation code currently requires the native Python engine.');
        for(const file of payload.inputFiles||[]){if(!file||typeof file.filename!=='string'||path.isAbsolute(file.filename)||file.filename.split(/[\\/]/).includes('..')||file.filename.includes('\0'))throw new Error('Input files need relative names inside the isolated suite directory.');}
        const capabilities=await capability(cwd);
        if(closed||generation!==workspaceGeneration)throw new Error('Workspace changed while preparing this run. Start again in the selected workspace.');
        const caps = capabilities.engines.find(e=>e.id===engine);
        if (!caps.available) throw new Error(`${engine} unavailable. ${caps.prerequisite}`);
        const parameters = await resolvedParameters(payload.parameterSchema,payload.parameters);
        const fixture = payload.fixtureId ? scopedFixtures().filter(f=>f.id===payload.fixtureId && (!payload.fixtureVersion || f.version===payload.fixtureVersion)).sort((a,b)=>b.version-a.version)[0] : null;
        if (payload.fixtureId && !fixture) throw new Error('Fixture version not found.');
        if (fixture && fixture.engine !== engine) throw new Error('Fixture engine must match the run engine.');
        if(!['javascript','playwright','python'].includes(engine)&&(fixture||payload.setup||payload.cleanup))throw new Error('This native adapter uses its project framework setup/teardown hooks. Shared script fixtures support JavaScript, Playwright and Python.');
        const timeout = Number(payload.timeoutMs ?? 120000);
        if (!Number.isInteger(timeout) || timeout < 10 || timeout > 86400000) throw new Error('Run timeout must be 10–86400000 milliseconds.');
        if(closed||generation!==workspaceGeneration)throw new Error('Workspace changed while preparing this run. Start again in the selected workspace.');
        const run = {id:crypto.randomUUID(),engine,status:'RUNNING',startedAt:new Date().toISOString(),stdout:'',stderr:'',total:0,passed:0,failed:0,errors:0,pending:0,artifacts:{},workspaceRoot,fixture:fixture?{id:fixture.id,version:fixture.version}:null};
        if(typeof payload.name==='string'&&payload.name.trim())run.name=Array.from(payload.name.trim()).slice(0,200).join('');
        write(run);
        // Never serialize code or resolved credentials into the run record.
        void execute(run,{...payload,parameters,setup:[fixture?.setup,payload.setup].filter(Boolean).join('\n'),cleanup:[payload.cleanup,fixture?.cleanup].filter(Boolean).join('\n')},cwd,timeout).catch(error => { if (!TERMINAL.has(run.status)) { run.status='ERROR';run.errors++;run.error=redact(error.message);run.finishedAt=new Date().toISOString();write(run); } });
        return clone(run);
    }
    async function execute(run,payload,cwd,timeout) {
        const tempRoot=options.tempRoot||os.tmpdir();fs.mkdirSync(tempRoot,{recursive:true});
        const temp = fs.mkdtempSync(path.join(tempRoot,'lvx-run-')), p=options.runtimePaths||{}, node=p.node||options.nodeExecutable||process.execPath;
        let child, timer, result = null, report = null, protocol = null, protocolError = null, timedOut = false, resolveCompletion;
        const completion=new Promise(resolve=>{resolveCompletion=resolve;});
        try {
            const environment=payload.environment||{};if(!environment||Array.isArray(environment)||typeof environment!=='object'||Object.entries(environment).some(([key,value])=>!/^\w+$/.test(key)||typeof value!=='string'||/[\0]/.test(value)))throw Error('Suite environment requires named text values.');
            let command,args,env={...process.env,...environment,ELECTRON_RUN_AS_NODE:'1',LVX_PARAMETERS:JSON.stringify(payload.parameters||{})};delete env.NODE_TEST_CONTEXT;
            if(p.browserRoot)env.PLAYWRIGHT_BROWSERS_PATH=p.browserRoot;if(p.dotnet)env.DOTNET_ROOT=path.dirname(p.dotnet);if(['python','pytest','robot'].includes(run.engine))env=pythonEnvironment({env});
            if (run.engine==='javascript'||run.engine==='playwright') {
                if(run.engine==='playwright') {payload.playwrightPath=require.resolve('playwright');if(!env.PLAYWRIGHT_BROWSERS_PATH){const bundled=process.resourcesPath&&path.join(process.resourcesPath,'playwright-browsers');const local=path.resolve(__dirname,'../../.external/playwright-browsers');if(bundled&&fs.existsSync(bundled))env.PLAYWRIGHT_BROWSERS_PATH=bundled;else if(fs.existsSync(local))env.PLAYWRIGHT_BROWSERS_PATH=local;}}
                child=fork(path.join(__dirname,'script-child.cjs'),[],{cwd,execPath:node,execArgv:payload.debug?['--inspect=127.0.0.1:0']:[],silent:true,detached:process.platform!=='win32',windowsHide:true,env});
                child.on('message',message=>{if(message.type==='debugSource')run.debugSource={lineOffset:message.lineOffset,lines:message.lines};if(message.type==='authoredReady'){run.debugReady=true;if(debugClients.get(run.id)?.enabled)emit('debug',{id:run.id,state:'connected'});}if(message.type==='result') {result=message.result;if(payload.debug)completedDebugRuns.add(run.id);debugClients.get(run.id)?.socket.close();}});
                child.send({...payload,id:run.id});
            } else if(run.engine==='robot') {
                delete env.LVX_PARAMETERS;
                child=fork(path.join(__dirname,'robot-child.cjs'),[],{cwd,execPath:node,execArgv:[],silent:true,detached:process.platform!=='win32',windowsHide:true,env});
                child.on('message',message=>{if(message.type==='result')result=safeResult(message.result);});
                child.send({...payload,id:run.id,tempDir:temp,python:p.python||'python',resourcePath:process.resourcesPath});
            } else if (run.engine==='jest') {
                report=path.join(temp,'jest.json');command=node;args=[path.join(cwd,'node_modules/jest/bin/jest.js'),'--runInBand','--json',`--outputFile=${report}`,'--watch=false'];
            } else if (run.engine==='junit') {
                report=path.join(temp,'reports');const configFile=path.join(temp,'junit-config.json');fs.writeFileSync(configFile,JSON.stringify({project:cwd,temp,report,java:p.java||'java',javac:p.javac||'javac',jar:p.junitJar,classPath:payload.classPath?project(payload.classPath):cwd,compile:payload.compile}));command=node;args=[path.join(__dirname,'junit-child.cjs'),configFile];
            } else if (run.engine==='nunit') {
                report=path.join(temp,'results.trx');command=p.dotnet||'dotnet';args=['test',payload.nativeProject||cwd,'--nologo','--logger',`trx;LogFileName=${report}`,'--results-directory',temp];
            } else if (run.engine==='pytest') {
                report=path.join(temp,'pytest.xml');command=p.python||'python';args=['-m','pytest',cwd,`--junitxml=${report}`,'-q'];
            } else if (run.engine==='python') {
                delete env.LVX_PARAMETERS;
                command=p.python||'python';args=['-u',path.join(__dirname,'python-child.py').replace(/\.asar([\\/])/,'.asar.unpacked$1'),temp];
            } else if (run.engine==='java') {
                const file=path.join(temp,'LvxTest.java');fs.writeFileSync(file,payload.code||'');command=p.java||'java';args=[file];
            } else if (run.engine==='csharp') {
                const sdk=require('node:child_process').spawnSync(p.dotnet||'dotnet',['--version'],{cwd,env,windowsHide:true,encoding:'utf8',timeout:10000});const major=Number(sdk.stdout?.trim().match(/^(\d+)\./)?.[1]);if(sdk.status!==0||major<8||major>30)throw Error('A working .NET SDK version 8 or newer is required.');fs.writeFileSync(path.join(temp,'LvxTest.csproj'),'<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net'+major+'.0</TargetFramework></PropertyGroup></Project>');fs.writeFileSync(path.join(temp,'Program.cs'),payload.code||'');command=p.dotnet||'dotnet';args=['run','--project',path.join(temp,'LvxTest.csproj'),'--nologo'];
            }
            if (!child) child=spawn(command,args,{cwd,env,windowsHide:true,detached:process.platform!=='win32',stdio:[run.engine==='python'?'pipe':'ignore','pipe','pipe']});
            active.set(run.id,{child,run,temp,completion});
            if(run.engine==='python'){
                protocol=createProtocol({onOutput:(stream,text)=>output(run,stream,Buffer.from(text)),onResult:value=>{result=safeResult(value);},onError:error=>{protocolError=error;}});
                child.stdout.on('data',chunk=>protocol.push(chunk));
                child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(payload));
            }else child.stdout.on('data',chunk=>output(run,'stdout',chunk));
            child.stderr.on('data',chunk=>{output(run,'stderr',chunk);if(payload.debug) { const endpoint=chunk.toString().match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/);if(endpoint) void attachDebugger(run,endpoint[0]).catch(error=>emit('debug',{id:run.id,state:'unavailable',error:error.message})); }});
            timer=setTimeout(()=>{timedOut=true;void killTree(child);},timeout);
            const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});clearTimeout(timer);protocol?.end();output(run,'stdout','',true);output(run,'stderr','',true);
            if (run.status==='CANCELLED') return;
            if (timedOut) { result={status:'ERROR',total:0,passed:0,failed:0,errors:1,error:`Run exceeded ${timeout}ms and its process tree was stopped.`}; }
            else if(['python','robot'].includes(run.engine)){
                if(protocolError||!result||!TERMINAL.has(result.status))result={status:'ERROR',total:0,passed:0,failed:0,errors:1,error:protocolError?.message||'Native runner stopped without a terminal result.'};
                else if(exit.code!==0&&result.status==='SUCCESS')result={...result,status:'ERROR',errors:(result.errors||0)+1,error:'Native runner exited unsuccessfully despite its result.'};
            }
            else if (report) {
                try {
                    if (run.engine==='jest') result=adapters.parseJest(fs.readFileSync(report,'utf8'));
                    else if (run.engine==='junit') {
                        const files=fs.existsSync(report)?fs.readdirSync(report).filter(f=>f.endsWith('.xml')):[];if(!files.length) throw new Error('JUnit did not produce XML reports.');
                        const parts=files.map(f=>adapters.parseXML(fs.readFileSync(path.join(report,f),'utf8')));result=adapters.finish(parts.reduce((r,a)=>{for(const k of ['total','passed','failed','errors','pending']) r[k]+=a[k]||0;return r;},{total:0,passed:0,failed:0,errors:0,pending:0}));result.cases=parts.flatMap(p=>p.cases||[]);
                    } else result=adapters.parseXML(fs.readFileSync(report,'utf8'));
                    if (exit.code!==0 && result.status==='SUCCESS') {result.status='ERROR';result.errors++;result.error='Native runner exited unsuccessfully despite its report.';}
                } catch(error) {result={status:'ERROR',total:0,passed:0,failed:0,errors:1,error:`Native report unavailable or invalid: ${error.message}`};}
            } else if (!result) result={status:exit.code===0?'SUCCESS':'ERROR',total:1,passed:exit.code===0?1:0,failed:0,errors:exit.code===0?0:1};
            if(payload.expectedOutput!=null&&!['javascript','playwright'].includes(run.engine)){const normalize=value=>{const text=String(value||'').replace(/\r\n/g,'\n').replace(/\r/g,'\n');return payload.expectedOutputNormalize==='trim-end'?text.trimEnd():text.replace(/\n$/,'');};result.total=(result.total||0)+1;if(normalize((run.stdout||'')+(payload.expectedOutputCombineStderr?run.stderr||'':''))===normalize(payload.expectedOutput))result.passed=(result.passed||0)+1;else{result.failed=(result.failed||0)+1;if(result.status==='SUCCESS')result.status='FAILURE';}}
            Object.assign(run,safeResult(result),{finishedAt:new Date().toISOString(),exitCode:exit.code});write(run);
        } finally {
            clearTimeout(timer);const client=debugClients.get(run.id);client?.socket.close();debugClients.delete(run.id);completedDebugRuns.delete(run.id);
            try {
                if(path.dirname(path.resolve(temp))!==path.resolve(tempRoot)||!path.basename(temp).startsWith('lvx-run-'))throw Error('Unsafe temporary run cleanup target');
                fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:25});
            }catch(error){run.cleanupError=redact('Temporary run cleanup needs attention: '+error.message);write(run);emit('recovery-error',{id:run.id,message:run.cleanupError});}
            finally{active.delete(run.id);resolveCompletion();}
        }
    }
    async function cancel(id) {
        get(id);const run=active.get(id)?.run||get(id),entry=active.get(id);if(TERMINAL.has(run.status)&&!entry) return clone(run);
        if(entry?.controller) entry.controller.abort();
        run.status='CANCELLED';run.finishedAt=new Date().toISOString();write(run);await killTree(entry?.child);
        if(entry?.child&&entry.child.exitCode===null&&entry.child.signalCode===null)await new Promise(resolve=>entry.child.once('close',resolve));
        if(entry?.completion)await entry.completion;
        return clone(run);
    }
    async function attachDebugger(run,url) {
        const socket=new WebSocket(url), requests=new Map();let sequence=0;
        const client={socket,runId:run.id,paused:null,script:null,send(method,params={}){return new Promise((resolve,reject)=>{if(socket.readyState!==WebSocket.OPEN)return reject(new Error('Debugger is disconnected.'));const id=++sequence,timer=setTimeout(()=>{requests.delete(id);reject(new Error('Debugger request timed out.'));},5000);requests.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});}};
        socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const q=requests.get(data.id);if(q)clearTimeout(q.timer);requests.delete(data.id);data.error?q?.reject(new Error(data.error.message)):q?.resolve(data.result);}else if(data.method==='Debugger.paused'){client.paused=data.params;const {selectedFrame,...context}=pausedContext(client,run.debugSource);emit('debug',{id:run.id,state:'paused',location:(selectedFrame||data.params.callFrames[0])?.location,...context});}else if(data.method==='Debugger.resumed'){client.paused=null;emit('debug',{id:run.id,state:'running'});}else if(data.method==='Debugger.scriptParsed'&&data.params.url.includes(`lvx-authored-${run.id}`)) client.script=data.params;});
        socket.addEventListener('close',()=>{for(const q of requests.values()){clearTimeout(q.timer);q.reject(new Error('Debugger closed.'));}requests.clear();});
        await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});debugClients.set(run.id,client);if(completedDebugRuns.has(run.id)){socket.close();return;}await client.send('Runtime.enable');await client.send('Debugger.enable');await client.send('Debugger.setBlackboxPatterns',{patterns:['^node:','^internal/','(?:^|[\\\\/])script-child\\.cjs$']});await client.send('Debugger.setAsyncCallStackDepth',{maxDepth:16});client.enabled=true;if(run.debugReady)emit('debug',{id:run.id,state:'connected'});
    }
    async function debug(payload) {
        get(payload.id);if(payload.command==='stop') return cancel(payload.id);
        const client=debugClients.get(payload.id);if(!client) throw new Error('This run has no active JavaScript debugger. Start with debug enabled.');
        if(payload.command==='breakpoint') {const line=Number(payload.line),source=active.get(payload.id)?.run.debugSource;if(!Number.isInteger(line)||line<1) throw new Error('Breakpoint line must be a positive integer.');if(!source||line>source.lines)throw new Error('Breakpoint is outside the authored test source.');if(!client.script)throw new Error('Authored source has not loaded yet.');const lineNumber=source.lineOffset+line-1;const possible=await client.send('Debugger.getPossibleBreakpoints',{start:{scriptId:client.script.scriptId,lineNumber,columnNumber:0},end:{scriptId:client.script.scriptId,lineNumber:lineNumber+1,columnNumber:0},restrictToFunction:false});if(!possible.locations.length)throw new Error('This line has no executable breakpoint.');return client.send('Debugger.setBreakpoint',{location:possible.locations[0]});}
        if(payload.command==='pause') {if(!active.get(payload.id)?.run.debugReady)throw new Error('Wait for the authored test to start before pausing.');return client.send('Debugger.pause');}
        if(payload.command==='resume'||payload.command==='stepOver') {if(!client.paused) throw new Error('Pause execution first.');if(payload.command==='stepOver'){const context=pausedContext(client,active.get(payload.id)?.run.debugSource);if(!context.stepOverAvailable)throw new Error(context.message);}return client.send(payload.command==='resume'?'Debugger.resume':'Debugger.stepOver');}
        if(payload.command==='removeBreakpoint'){if(typeof payload.breakpointId!=='string')throw new Error('Breakpoint ID is required.');return client.send('Debugger.removeBreakpoint',{breakpointId:payload.breakpointId});}
        if(payload.command==='variables') {if(!client.paused) throw new Error('Pause execution to inspect variables.');const {selectedFrame,...context}=pausedContext(client,active.get(payload.id)?.run.debugSource);if(!selectedFrame)return {variables:[],...context};const scopes=payload.objectId?[{type:'object',object:{objectId:payload.objectId}}]:(selectedFrame.scopeChain||[]).filter(s=>['local','block','catch','closure'].includes(s.type));const variables=[],seen=new Set();for(const scope of scopes){const data=await client.send('Runtime.getProperties',{objectId:scope.object.objectId,ownProperties:true});for(const v of data.result.filter(v=>v.value)){if(seen.has(v.name))continue;seen.add(v.name);variables.push({name:v.name,scope:scope.type,type:v.value.type,objectId:v.value.objectId||null,value:redact(v.value.value===undefined?v.value.description:JSON.stringify(v.value.value))});}}return {variables,...context};}
        throw new Error('Unknown debugger command.');
    }
    async function runWorkflow(payload, internal = {}) {
        requireWorkspace();const validation=GraphEngine.validate(payload.workflow,{strict:true});if(!validation.valid) throw new Error(validation.errors.join(' '));
        const plan=GraphEngine.executionPlan(validation.workflow,payload),workflow=plan.workflow, id=crypto.randomUUID(), controller=new AbortController();
        const run={id,engine:'workflow',workspaceRoot,status:'RUNNING',startedAt:new Date().toISOString(),results:{},total:0,passed:0,failed:0,errors:0,pending:0,reviewDecisions:[],pendingReviews:[],runnerAssignments:plan.runnerAssignments,originalRunId:internal.originalRunId||null,workflowHash:crypto.createHash('sha256').update(JSON.stringify(validation.workflow)).digest('hex'),parametersHash:crypto.createHash('sha256').update(JSON.stringify(payload.parameters||{})).digest('hex')};
        run.name=typeof workflow.name==='string'&&workflow.name.trim()?Array.from(workflow.name.trim()).slice(0,200).join(''):'Workflow';
        let complete;const completion=new Promise(resolve=>{complete=resolve;});
        write(run);active.set(id,{controller,run,completion});
        void (async()=>{
            try {
                const result=await new GraphEngine().execute(workflow,async(node,inputs,context)=>{
                    if(context.signal?.aborted) return {status:'CANCELLED'};
                    const started=Date.now();output(run,'stdout',`[${node.id}] ${node.type} attempt ${context.attempt}\n`);
                    try{const result=await machina.execute(node,inputs,{...context,workflow,parameters:payload.parameters||{},runnerAssignments:plan.runnerAssignments,log:(stream,text)=>output(run,stream,text),review:(node,kind,proposal)=>requestReview(run,node,kind,proposal,controller.signal),isReviewApproved:evidence=>run.reviewDecisions.some(decision=>decision.decisionId===evidence.decisionId&&decision.decision==='approve'&&decision.deployRequested===true&&decision.proposalHash===evidence.proposalHash&&decision.finalCodeHash===evidence.finalCodeHash)});output(run,'stdout',`[${node.id}] ${result.status}\n`);const safe=safeResult(result);if(['code-review','ai-unit-test'].includes(GraphEngine.normalizeNodeType(node.type))&&result.artifacts?.reviewEvidence){safe.artifacts||={};safe.artifacts.reviewEvidence=safeReview(result.artifacts.reviewEvidence);}return {...safe,duration:Date.now()-started};}catch(error){if(controller.signal.aborted)return {status:'CANCELLED',total:0,passed:0,failed:0,errors:0};output(run,'stderr',`[${node.id}] ${error.message}\n`);throw error;}
                },{signal:controller.signal,initialResults:internal.initialResults,onState:state=>{run.results=clone(state.results);write(run);}});
                const counters=Object.values(result.results).reduce((r,n)=>{for(const k of ['total','passed','failed','errors','pending'])r[k]+=n[k]||0;if(n.status==='PENDING')r.pending++;return r;},{total:0,passed:0,failed:0,errors:0,pending:0});
                Object.assign(run,result,counters,{finishedAt:new Date().toISOString()});if(!run.total&&run.status==='SUCCESS'){run.status='ERROR';run.errors++;}
                run.runnerLogs=[];for(const runner of workflow.nodes.filter(node=>node.type==='start-runner'&&node.data.downloadLogs&&node.data.logPath)){
                    const results=Object.fromEntries(Object.entries(run.results).filter(([nodeId])=>plan.runnerAssignments[nodeId]===runner.id).map(([nodeId,value])=>{if(runner.data.captureAIContext)return [nodeId,value];const copy=clone(value);if(copy.artifacts)for(const key of Object.keys(copy.artifacts))if(/aiSummary|aiLogSummary|generatedCode|finalCode|lastGeneratedCode|history|reviewEvidence/i.test(key))delete copy.artifacts[key];if(Array.isArray(copy.attempts))for(const attempt of copy.attempts)if(attempt.artifacts)for(const key of Object.keys(attempt.artifacts))if(/aiSummary|aiLogSummary|generatedCode|finalCode|lastGeneratedCode|history|reviewEvidence/i.test(key))delete attempt.artifacts[key];return [nodeId,copy];}));const filename=/\.(log|txt)$/i.test(runner.data.logPath)?runner.data.logPath:path.join(runner.data.logPath,runner.id.replace(/[^a-zA-Z0-9_-]/g,'_')+'-'+run.id+'.log');
                    try{const saved=machinaFiles.writeFile(workspaceRoot,filename,JSON.stringify(redact({runId:id,runnerId:runner.id,results}),null,2),{replace:false});run.runnerLogs.push({runnerId:runner.id,path:saved});if(runner.data.saveIndividualNodeLogs)for(const [nodeId,value]of Object.entries(results))run.runnerLogs.push({runnerId:runner.id,nodeId,path:machinaFiles.writeFile(workspaceRoot,path.join(path.dirname(saved),'node-'+nodeId.replace(/[^a-zA-Z0-9_-]/g,'_')+'-'+run.id+'.log'),JSON.stringify(redact(value),null,2))});}catch(error){run.errors++;if(run.status!=='CANCELLED')run.status='ERROR';run.runnerLogs.push({runnerId:runner.id,error:redact(error.message)});}
                }
                write(run);
            }catch(error){run.status=controller.signal.aborted?'CANCELLED':'ERROR';if(!controller.signal.aborted)run.errors++;run.error=redact(error.message);run.finishedAt=new Date().toISOString();write(run);}finally{output(run,'stdout','',true);output(run,'stderr','',true);active.delete(id);complete();}
        })();return clone(run);
    }
    function arm(schedule) {
        const key=scheduleKey(schedule);
        clearTimeout(timers.get(key));timers.delete(key);if(closed||!schedule.enabled || schedule.workspaceRoot!==workspaceRoot || !currentSchedule(schedule)) return;
        let delay=Date.parse(schedule.nextRun)-Date.now();
        if(delay<0&&schedule.missedRun==='skip'){schedule.nextRun=new Date(Date.now()+schedule.intervalMs).toISOString();save();delay=schedule.intervalMs;}
        const timer=setTimeout(async()=>{timers.delete(key);if(!schedule.enabled||closed||schedule.workspaceRoot!==workspaceRoot||!currentSchedule(schedule))return;if(Date.parse(schedule.nextRun)>Date.now()+50){arm(schedule);return;}try{const r=await runWorkflow({workflow:schedule.workflow});schedule.lastRunId=r.id;schedule.lastError=null;}catch(error){schedule.lastError=error.message;}schedule.nextRun=new Date(Date.now()+schedule.intervalMs).toISOString();save();arm(schedule);},Math.min(2147483647,Math.max(0,delay)));timer.unref?.();timers.set(key,timer);
    }
    for(const schedule of config.schedules) arm(schedule);
    return {
        setWorkspace(root){if(closed)throw new Error('Execution service is closed.');if(active.size)throw new Error('Stop active runs before switching workspace.');workspaceRoot=root?fs.realpathSync(root):null;workspaceGeneration++;capabilityCache.clear();for(const schedule of config.schedules)arm(schedule);},
        async handle(action,payload={}) {
            if(closed)throw new Error('Execution service is closed.');
            switch(action){
                case 'capabilities':return capability(workspaceRoot,payload.refresh===true);
                case 'runtimeConfiguration':return {...options.runtimePaths};
                case 'configureRuntimes':{if(payload.expectedPathsHash&&require('node:crypto').createHash('sha256').update(JSON.stringify(options.runtimePaths||{})).digest('hex')!==payload.expectedPathsHash)throw new Error('Runtime settings changed during setup. Your newer choice was preserved. Review setup again.');const allowed=new Set(['node','python','java','javac','dotnet','junitJar','browserRoot']);const next={};for(const [key,value]of Object.entries(payload.paths||{})){if(!allowed.has(key)||typeof value!=='string'||!path.isAbsolute(value)||!(key==='browserRoot'?fs.statSync(value).isDirectory():fs.statSync(value).isFile()))throw new Error('Choose an existing runtime executable, browser folder or JUnit JAR.');next[key]=fs.realpathSync(value);}options.runtimePaths={...(options.runtimePaths||{}),...next};config.runtimePaths=options.runtimePaths;save();capabilityCache.clear();return payload.commitOnly?{configured:true}:capability(workspaceRoot);}
                case 'start':return start(payload);
                case 'cancel':return cancel(payload.id);
                case 'runs':return [...records.values()].filter(run=>workspaceRoot&&run.workspaceRoot===workspaceRoot).sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).map(clone);
                case 'getRun':return clone(get(payload.id));
                case 'pruneRuns':{
                    requireWorkspace();if(!Array.isArray(payload.ids)||payload.ids.length>10000||payload.ids.some(id=>!uuid(id))||new Set(payload.ids).size!==payload.ids.length)throw Error('Retention needs up to 10000 unique native run UUIDs.');
                    if(fs.lstatSync(runsDir).isSymbolicLink())throw Error('Run retention refuses a linked persistence directory.');const canonical=fs.realpathSync(runsDir),targets=[];
                    for(const id of payload.ids){const run=get(id);if(active.has(id)||!TERMINAL.has(run.status)||run.pendingReviews?.length||[...reviews.keys()].some(key=>key.startsWith(id+':')))throw Error('Retention cannot prune an active or pending run.');const filename=path.join(runsDir,id+'.json'),stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||path.dirname(fs.realpathSync(filename))!==canonical)throw Error('Run retention refuses linked or invalid persistence files.');targets.push({id,filename});}
                    const deletedRunIds=[];for(const target of targets){fs.unlinkSync(target.filename);records.delete(target.id);deletedRunIds.push(target.id);}return {deletedRunIds,deletedCount:deletedRunIds.length};
                }
                case 'debug':return debug(payload);
                case 'exportConfiguration':return exportConfiguration();
                case 'validateConfiguration':return validateConfiguration(payload.configuration,{replace:payload.replace===true});
                case 'importConfiguration':return importConfiguration(payload.configuration,{replace:payload.replace===true});
                case 'validateWorkflow':return GraphEngine.validate(payload.workflow,{strict:payload.strict!==false});
                case 'runWorkflow':return runWorkflow(payload);
                case 'reviewDecision':return reviewDecision(payload);
                case 'pendingReviews':return [...records.values()].filter(run=>run.workspaceRoot===workspaceRoot&&run.status==='RUNNING').flatMap(run=>(run.pendingReviews||[]).map(review=>({id:run.id,...clone(review)})));
                case 'sourceFiles':requireWorkspace();return redact(machina.sourceFiles(payload));
                case 'generatePreview':{requireWorkspace();const generation=workspaceGeneration,result=await machina.generatePreview(payload);if(closed||generation!==workspaceGeneration)throw Error('Workspace changed while generating the preview. Retry in the selected workspace.');return redact(result);}
                case 'rerunFailed':{const old=get(payload.id);if(old.engine!=='workflow'||!TERMINAL.has(old.status))throw new Error('Choose a completed workflow run.');const validation=GraphEngine.validate(payload.workflow,{strict:true});if(!validation.valid)throw new Error(validation.errors.join(' '));if(crypto.createHash('sha256').update(JSON.stringify(validation.workflow)).digest('hex')!==old.workflowHash)throw new Error('Workflow changed. Start a fresh run instead of reusing evidence.');if(crypto.createHash('sha256').update(JSON.stringify(payload.parameters||{})).digest('hex')!==old.parametersHash)throw new Error('Run parameters changed. Start a fresh run instead of reusing evidence.');const failed=new Set(Object.entries(old.results).filter(([,r])=>r.status!=='SUCCESS').map(([id])=>id));if(!failed.size)throw new Error('This run has no failed steps.');const affected=new Set(failed);let changed=true;while(changed){changed=false;for(const edge of validation.workflow.edges)if(affected.has(edge.source)&&!affected.has(edge.target)){affected.add(edge.target);changed=true;}}const initialResults=Object.fromEntries(Object.entries(old.results).filter(([id,r])=>!affected.has(id)&&r.status==='SUCCESS').map(([id,r])=>[id,{...r,reusedFromRunId:old.id}]));return runWorkflow({workflow:validation.workflow,parameters:payload.parameters},{originalRunId:old.id,initialResults});}
                case 'fixtures':return scopedFixtures().map(item=>clone(portableFixture(item)));
                case 'saveFixture':{requireWorkspace();if(typeof payload.name!=='string'||!payload.name.trim()||!['javascript','playwright','python'].includes(payload.engine))throw new Error('Fixture needs a name and JavaScript, Playwright or Python engine. Native frameworks use their project setup/teardown hooks.');const id=payload.id||crypto.randomUUID(),version=1+Math.max(0,...scopedFixtures().filter(f=>f.id===id).map(f=>f.version));const item={id,version,name:payload.name,engine:payload.engine,setup:String(payload.setup||''),cleanup:String(payload.cleanup||''),workspaceRoot};if(configurationHasCredential({fixtures:[item]}))throw new Error('Fixture contains a resolved credential. Use a secret parameter reference.');config.fixtures.push(item);save();return portableFixture(item);}
                case 'schedules':return clone(config.schedules.filter(item=>item.workspaceRoot===workspaceRoot));
                case 'saveSchedule':{requireWorkspace();const validation=GraphEngine.validate(payload.workflow,{strict:true});if(!validation.valid)throw new Error(validation.errors.join(' '));const intervalMs=Number(payload.intervalMs);if(!Number.isInteger(intervalMs)||intervalMs<1000||intervalMs>31536000000)throw new Error('Schedule interval must be between one second and one year.');if(!['skip','run-once'].includes(payload.missedRun))throw new Error('Choose a missed-run policy.');const item={id:payload.id||crypto.randomUUID(),name:String(payload.name||'Scheduled workflow'),workspaceRoot,workflow:validation.workflow,intervalMs,missedRun:payload.missedRun,enabled:payload.enabled===true,nextRun:payload.nextRun||new Date(Date.now()+intervalMs).toISOString()};if(!Number.isFinite(Date.parse(item.nextRun)))throw new Error('Invalid next run date.');const check=validateConfiguration({format:'lvx-execution-configuration',schemaVersion:1,fixtures:[],schedules:[portableSchedule(item)]});if(!check.valid)throw new Error(check.errors.join(' '));const index=config.schedules.findIndex(s=>s.id===item.id&&s.workspaceRoot===workspaceRoot);if(index<0)config.schedules.push(item);else config.schedules[index]=item;save();arm(item);return clone(item);}
                case 'cancelSchedule':{const item=config.schedules.find(s=>s.id===payload.id&&s.workspaceRoot===workspaceRoot);if(!item)throw new Error('Schedule not found.');item.enabled=false;const key=scheduleKey(item);clearTimeout(timers.get(key));timers.delete(key);save();if(payload.cancelActive&&item.lastRunId&&!TERMINAL.has(get(item.lastRunId).status))await cancel(item.lastRunId);return clone(item);}
                case 'templates':return [{id:'assertion',name:'Check a value',description:'A single explicit assertion. Added only when you choose it.',workflow:{schemaVersion:1,nodes:[{id:'check',type:'script',data:{name:'Check a value',engine:'javascript',code:'assert(parameters.actual === parameters.expected, "Values should match");',parameterSchema:{actual:{type:'number',required:true},expected:{type:'number',required:true}},parameters:{actual:2,expected:2}}}],edges:[]}}];
                case 'exportWorkflow':{const validation=GraphEngine.validate(payload.workflow,{strict:true});if(!validation.valid)throw new Error(validation.errors.join(' '));const fixtureIds=new Set(validation.workflow.nodes.map(n=>n.data.fixtureId).filter(Boolean));const content={format:'lvx-workflow',schemaVersion:1,workflow:validation.workflow,fixtures:scopedFixtures().filter(f=>fixtureIds.has(f.id)).map(portableFixture)};return {...content,checksum:crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex')};}
                case 'importWorkflow':{const {checksum,...content}=payload.bundle||{};if(content.format!=='lvx-workflow'||content.schemaVersion!==1||crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex')!==checksum)throw new Error('Workflow bundle checksum or version is invalid.');const validation=GraphEngine.validate(content.workflow,{strict:true});if(!validation.valid)throw new Error(validation.errors.join(' '));const configuration={format:'lvx-execution-configuration',schemaVersion:1,fixtures:content.fixtures||[],schedules:[]};const check=validateConfiguration(configuration);if(!check.valid)throw new Error(check.errors.join(' '));if(payload.commit===true)importConfiguration(configuration,{fixtureOnly:true});return {valid:true,workflow:validation.workflow,fixtureCount:(content.fixtures||[]).length,requiresTrust:true,committed:payload.commit===true};}
                default:throw new Error(`Unknown execution action: ${action}`);
            }
        },
        async close(){if(closed)return;closed=true;workspaceGeneration++;for(const timer of timers.values())clearTimeout(timer);timers.clear();await Promise.all([...capabilityWorkers].map(worker=>worker.terminate()));await Promise.all([...active.keys()].map(cancel));const deadline=Date.now()+5000;while(active.size&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));if(active.size)throw new Error('Some execution sessions are still shutting down.');}
    };
}
module.exports={createService,validateParameters,killTree,within,TERMINAL};
