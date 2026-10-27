(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.LegacyImporter=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
  const suite=value=>object(value)&&['code','testCode','test_code','language','expected_output','mock_builder','testCases'].some(k=>Object.hasOwn(value,k));
  function normalizeSuite(value,index=0){const s=clone(value);s.name=s.name||`Imported suite ${index+1}`;if(!s.code&&typeof s.testCode==='string')s.code=s.testCode;if(!s.code&&typeof s.test_code==='string')s.code=s.test_code;if(!s.dateCreated&&s.created!==undefined)s.dateCreated=typeof s.created==='number'?new Date(s.created).toISOString():s.created;s.language=s.language||'javascript';s.tags=Array.isArray(s.tags)?s.tags:[];s.isFavorite=s.isFavorite??false;if(!s.dateModified&&s.dateCreated)s.dateModified=s.dateCreated;return s;}
  function normalizeVersion(value){const v=clone(value);v.suiteSnapshot=v.suiteSnapshot||v.suiteData||v.snapshot;if(v.suiteSnapshot)v.suiteSnapshot=normalizeSuite(v.suiteSnapshot);v.timestamp=v.timestamp||v.createdAt||v.dateCreated||v.dateModified||new Date(0).toISOString();if(typeof v.timestamp==='number')v.timestamp=new Date(v.timestamp).toISOString();v.changeDescription=v.changeDescription||v.description||`Version ${v.version||''}`.trim()||'Imported version';v.changedBy=v.changedBy||v.createdBy||'user';v.diff=v.diff||{modified:[]};return v;}
  function extractImportPayload(content,{sourceName='Imported file'}={}) {
    const parsed=typeof content==='string'?JSON.parse(content):clone(content);
    const result={sourceName,format:'unknown',suites:[],views:[],pipelines:[],versionHistories:{},extraRecords:[],warnings:[]};
    const seen=new Set();let depth=0;
    function visit(first){const pending=[first];while(pending.length){const value=pending.pop();if(!object(value)||seen.has(value))continue;seen.add(value);
      if(suite(value)){result.suites.push(value);continue;}
      for(const key of ['test_suites','suites','tests'])if(Array.isArray(value[key])){for(const item of value[key])if(object(item))result.suites.push(item);if(result.format==='unknown')result.format=key==='test_suites'?'session-export':key==='suites'?'legacy-suite-bundle':'legacy-test-bundle';}
      if(Array.isArray(value.views))for(const item of value.views)if(object(item))result.views.push(item);
      for(const key of ['pipelines','workflows'])if(Array.isArray(value[key]))for(const item of value[key])if(object(item))result.pipelines.push(item);
      for(const key of ['version_histories','versionHistories','suite_versions'])if(object(value[key]))for(const [id,versions]of Object.entries(value[key]))if(Array.isArray(versions)){result.versionHistories[id]||=[];for(const version of versions)if(object(version))result.versionHistories[id].push(version);}
      const extraCollections={execution_history:'history',security_scans:'security-history',screenshots:'baselines',datasets:'datasets',unit_tests:'unit-tests',test_environments:'environments'};
      for(const [key,collection]of Object.entries(extraCollections))if(Array.isArray(value[key]))for(const record of value[key].filter(object))result.extraRecords.push({collection,value:clone(record)});
      const configKeys=['notification_integrations','execution_config','storage_config','sharing_backend_config','cicd_backend_config','lvx_storage_preferences','storagePreferences'];
      for(const key of configKeys)if(Object.hasOwn(value,key)){result.extraRecords.push({collection:'legacy-config',value:{id:key,key,value:clone(value[key]),applyRequired:true}});result.warnings.push(`Configuration ${key} is preserved for explicit review and apply; it is not silently activated.`);}
      if(value.execution_mode!==undefined&&!Object.hasOwn(value,'execution_config')){result.extraRecords.push({collection:'legacy-config',value:{id:'execution_config',key:'execution_config',value:{mode:value.execution_mode},applyRequired:true}});result.warnings.push('The exported execution_mode is retained as a configuration draft; review engine settings before applying it.');}
      if(value.storage_type!==undefined&&!Object.hasOwn(value,'storage_config')){result.extraRecords.push({collection:'legacy-config',value:{id:'storage_config',key:'storage_config',value:{type:value.storage_type},applyRequired:true}});result.warnings.push('The exported storage_type is retained as a draft. Connection details absent from the export must be re-entered.');}
      for(const key of Object.keys(value))if(/config|preferences|environment|integration/i.test(key)&&!configKeys.includes(key)&&!['test_environments','execution_mode','storage_type'].includes(key))result.warnings.push(`Unsupported setting ${key} was not activated or imported. Export or re-enter it separately.`);
      for(const key of ['state','payload','bundle','session','data','appState'])if(object(value[key])){pending.push(value[key]);depth++;}
    }}
    if(Array.isArray(parsed)){result.format='suite-array';result.suites=parsed.filter(object);}else if(suite(parsed)){result.format='single-suite';result.suites=[parsed];}else visit(parsed);
    if(depth)result.format='app-state-backup';
    if(!result.suites.length&&!result.views.length&&!result.pipelines.length&&!result.extraRecords.length&&!Object.keys(result.versionHistories).length)throw Error(`"${sourceName}" contains no supported suites, views or workflows.`);
    result.suites=result.suites.map(normalizeSuite);
    result.raw=parsed;return result;
  }
  function normalizeImport(payload,{existingRecords=[],idFactory=()=>globalThis.crypto.randomUUID()}={}) {
    const reserved=new Set(existingRecords.map(r=>`${r.collection}/${r.id}`)),records=[],warnings=[...(payload.warnings||[])],maps={suites:Object.create(null),views:Object.create(null),pipelines:Object.create(null),nodes:Object.create(null),extra:Object.create(null)},origins=new Map();
    function id(collection,old){let candidate=String(old||'');if(!/^[a-zA-Z0-9][a-zA-Z0-9_.:@-]*$/.test(candidate)||reserved.has(`${collection}/${candidate}`)){do{candidate=`import-${idFactory()}`;}while(reserved.has(`${collection}/${candidate}`));}reserved.add(`${collection}/${candidate}`);return candidate;}
    // Each file is a separate import namespace, preventing accidental cross-file links.
    const groups=[['suites','suites'],['views','views'],['pipelines','workflows']];
    for(const [kind,collection]of groups)for(const item of payload[kind]){const old=String(item.id||'');if(old&&Object.hasOwn(maps[kind],old))throw Error(`Duplicate ${kind} id in one import: ${old}`);const next=id(collection,old);if(old)Object.defineProperty(maps[kind],old,{value:next,enumerable:true});const record={collection,id:next,expectedRevision:null,value:clone(item)};records.push(record);origins.set(record,item.id||null);}
    for(const entry of payload.extraRecords||[]){const old=String(entry.value.id||''),next=id(entry.collection,old);if(!maps.extra[entry.collection])maps.extra[entry.collection]=Object.create(null);if(old&&maps.extra[entry.collection][old])throw Error(`Duplicate ${entry.collection} id in one import.`);if(old)maps.extra[entry.collection][old]=next;const record={collection:entry.collection,id:next,expectedRevision:null,value:clone(entry.value)};records.push(record);origins.set(record,old);}
    const remap=(value,key='',nodeMap={})=>{
      if(Array.isArray(value))return value.map(v=>remap(v,key,nodeMap));
      if(object(value)){const mapped=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v,k,nodeMap)]));if(typeof value.collection==='string'&&typeof value.id==='string'){const kind=({suites:'suites',views:'views',workflows:'pipelines'})[value.collection];if(kind&&maps[kind][value.id])mapped.id=maps[kind][value.id];else if(maps.extra[value.collection]?.[value.id])mapped.id=maps.extra[value.collection][value.id];}return mapped;}
      if(typeof value!=='string')return value;
      if(['secretRef','secretId','credentialRef','code','template'].includes(key))return value;
      if(/^(source|target|sourceId|targetId|from|to|nodeId|sourceNode|targetNode|selectedNodeId)$/.test(key))return nodeMap[value]||value;
      if(/^(suiteId|suite_id|suiteIds|testSuiteId|test_suite_id|selectedSuiteId)$/.test(key))return maps.suites[value]||value;
      if(/^(viewId|view_id|viewIds|selectedViewId)$/.test(key))return maps.views[value]||value;
      if(/^(pipelineId|workflowId|pipeline_id|workflowIds)$/.test(key))return maps.pipelines[value]||value;
      const extraCollection=({dataSetId:'datasets',datasetId:'datasets',environmentId:'environments',envId:'environments',unitTestId:'unit-tests'})[key];if(extraCollection)return maps.extra[extraCollection]?.[value]||value;
      return value;
    };
    for(const record of records){let nodeMap=Object.create(null);const nodes=record.value.nodes||record.value.graph?.nodes;
      if(Array.isArray(nodes)){const used=new Set();for(const node of nodes){const old=String(node.id||'');if(!old||used.has(old))throw Error('Workflow nodes need unique identifiers.');used.add(old);nodeMap[old]=`node-${idFactory()}`;}maps.nodes[record.id]=nodeMap;}
      record.value=remap(record.value,'',nodeMap);record.value.id=record.id;
      const newNodes=record.value.nodes||record.value.graph?.nodes;if(Array.isArray(newNodes))for(const node of newNodes){node.originalNodeId=node.originalNodeId||node.id;node.id=nodeMap[node.id]||node.id;}
      record.value.importedFrom={sourceName:payload.sourceName,originalId:origins.get(record)??null};
      // Trust is deliberately not inherited from old renderer data.
      record.value.requiresTrustReview=true;delete record.value.trusted;delete record.value.trust;
    }
    // Studio stores one version per record. A bundle-shaped history record would
    // retain bytes but make the existing version picker unable to restore them.
    for(const [old,history]of Object.entries(payload.versionHistories)) {
      const target=maps.suites[old];if(!target)warnings.push(`History for missing suite ${old} was retained as orphan history.`);
      for(const version of history){const value=normalizeVersion(remap(version)),versionId=id('versions',value.versionId||value.id);if(value.versionId&&value.versionId!==versionId)value.originalVersionId=value.versionId;value.versionId=versionId;value.requiresTrustReview=true;if(!version.timestamp&&!version.createdAt&&!version.dateCreated&&!version.dateModified)value.timestampInferred=true;
        if(target){value.suiteId=target;if(value.suiteSnapshot)value.suiteSnapshot.id=target;if(value.snapshot)value.snapshot.id=target;}
        else {value.originalSuiteId=old;value.orphaned=true;delete value.suiteId;}
        records.push({collection:'versions',id:versionId,expectedRevision:null,value});}
    }
    return {records,maps,warnings,counts:{suites:payload.suites.length,views:payload.views.length,workflows:payload.pipelines.length,histories:Object.keys(payload.versionHistories).length,extraRecords:(payload.extraRecords||[]).length},sourceName:payload.sourceName};
  }
  function collectLegacyImportFiles(directoryPath,{maxFiles=0,maxDepth=0}={}) {
    for(const budget of [maxFiles,maxDepth])if(!Number.isSafeInteger(budget)||budget<0)throw Error('Legacy import budgets must be nonnegative integers; zero disables a budget.');
    if(typeof require!=='function')throw Error('Folder import requires the native workspace service.');const fs=require('node:fs'),path=require('node:path');const root=path.resolve(directoryPath);if(fs.lstatSync(root).isSymbolicLink())throw Error('Symbolic link import roots are not allowed.');const results=[];
    const pending=[{dir:root,depth:0}];while(pending.length){const {dir,depth}=pending.pop();if(maxDepth>0&&depth>maxDepth)throw Error('The selected legacy folder depth budget was reached.');for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('Symbolic links are not allowed in legacy imports.');if(entry.isDirectory())pending.push({dir:full,depth:depth+1});else if(entry.isFile()&&/\.json$/i.test(entry.name)){if(maxFiles>0&&results.length>=maxFiles)throw Error('The selected legacy folder file budget was reached.');results.push({path:full,fileName:entry.name,relativePath:path.relative(root,full)});}}}return results.sort((a,b)=>a.relativePath.localeCompare(b.relativePath));
  }
  function reconcileFolderReferences(records,reports) {
    const maps={suites:Object.create(null),views:Object.create(null),pipelines:Object.create(null)},ambiguous={suites:new Set(),views:new Set(),pipelines:new Set()};
    for(const report of reports)for(const kind of Object.keys(maps))for(const [old,next]of Object.entries(report.maps[kind]||{})){if(Object.hasOwn(maps[kind],old)){ambiguous[kind].add(old);delete maps[kind][old];}else if(!ambiguous[kind].has(old))Object.defineProperty(maps[kind],old,{value:next,enumerable:true,configurable:true});}
    const extra=new Map(),extraAmbiguous=new Set();for(const report of reports)for(const [collection,values]of Object.entries(report.maps.extra||{}))for(const [old,next]of Object.entries(values)){const key=`${collection}\0${old}`;if(extra.has(key)){extra.delete(key);extraAmbiguous.add(key);}else if(!extraAmbiguous.has(key))extra.set(key,next);}
    const fieldKind=key=> /^(suiteId|suite_id|suiteIds|testSuiteId|test_suite_id|selectedSuiteId)$/.test(key)?'suites':/^(viewId|view_id|viewIds|selectedViewId)$/.test(key)?'views':/^(pipelineId|workflowId|pipeline_id|workflowIds)$/.test(key)?'pipelines':null;
    const walk=(value,key='')=>{if(Array.isArray(value))return value.map(v=>walk(v,key));if(object(value)){const out=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,walk(v,k)]));const kind=({suites:'suites',views:'views',workflows:'pipelines'})[value.collection];if(kind&&maps[kind][value.id])out.id=maps[kind][value.id];else if(extra.has(`${value.collection}\0${value.id}`))out.id=extra.get(`${value.collection}\0${value.id}`);return out;}const kind=fieldKind(key),collection=({dataSetId:'datasets',datasetId:'datasets',environmentId:'environments',envId:'environments',unitTestId:'unit-tests'})[key];return kind&&typeof value==='string'?(maps[kind][value]||value):collection&&typeof value==='string'?(extra.get(`${collection}\0${value}`)||value):value;};
    for(const record of records){record.value=walk(record.value);if(record.collection==='versions'&&record.value.orphaned&&maps.suites[record.value.originalSuiteId]){const target=maps.suites[record.value.originalSuiteId];record.value.suiteId=target;record.value.orphaned=false;if(record.value.suiteSnapshot)record.value.suiteSnapshot.id=target;if(record.value.snapshot)record.value.snapshot.id=target;}}
    return records;
  }
  return {extractImportPayload,normalizeImport,reconcileFolderReferences,collectLegacyImportFiles,normalizeSuite,normalizeVersion};
});
