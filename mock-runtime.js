(function(root, factory) {
  const api = factory(root); if (typeof module === 'object' && module.exports) module.exports = api;
  root.mockRuntime = api;
})(typeof globalThis === 'object' ? globalThis : this, function(root) {
  'use strict';
  const own = (o,k) => Object.prototype.hasOwnProperty.call(o || {}, k);
  const forbidden = new Set(['__proto__','prototype','constructor']);
  function variable(value) { if (typeof value !== 'string' || value.length>200 || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value) || forbidden.has(value)) throw Error('Use a valid variable name of up to 200 characters.'); return value; }
  const templates = Object.freeze({
    'api-response': '{\n  "status": 200,\n  "body": {"user_id":"{{random_id}}","email":"{{random_email}}","token":"{{random_token}}"}\n}',
    'database-record': '{\n  "id":"{{random_id}}","email":"{{random_email}}","name":"{{random_name}}","role":"user"\n}',
    'user-input': '{\n  "username":"{{random_name}}","email":"{{random_email}}","password":"Test123!"\n}',
    'file-content': 'Report generated at {{timestamp}}\nResult: SUCCESS', 'custom-object': '{\n  "key":"value"\n}'
  });
  const builtIns = ['random_id','random_email','random_name','timestamp','uuid','random_token','random_number:1-100'];
  const actions = ['create-test-data','set-environment','clear-test-data','reset-environment','wait','run-code'];
  function getBuiltInValue(token, options = {}) {
    const cache = options.variableCache; if (cache && own(cache,token)) return cache[token];
    const random = options.randomFn || Math.random;
    const number = () => { const n = Number(random()); if (!(n >= 0 && n < 1)) throw Error('Random source must return a number from zero to less than one.'); return n; };
    let value;
    switch(token) {
      case 'random_id': value = String(Math.floor(number()*900000)+100000); break;
      case 'random_email': value = `user${Math.floor(number()*100000)}@example.test`; break;
      case 'random_name': value = ['Alex Carter','Jamie Chen','Morgan Lee','Taylor Singh'][Math.floor(number()*4)]; break;
      case 'timestamp': value = (options.now ? new Date(options.now()) : new Date()).toISOString(); break;
      case 'uuid': value = (options.uuidFactory || (() => root.crypto.randomUUID()))(); break;
      case 'random_token': value = `tok_${Math.floor(number()*1e12).toString(36)}`; break;
      default: { const m = /^random_number:(-?\d+)-(-?\d+)$/.exec(token); if(m) {const min=Number(m[1]),max=Number(m[2]); if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||max<min||!Number.isSafeInteger(max-min+1)) throw Error('Invalid random number range.'); value=String(Math.floor(number()*(max-min+1))+min);} }
    }
    if(cache && value !== undefined) cache[token]=value; return value;
  }
  const serializeVariableValue = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  function resolveTemplateVariables(text, context = {}, options = {}) {
    return String(text ?? '').replace(/\{\{([^}]+)\}\}/g, (match,raw) => {const token=raw.trim(); const value=own(context,token)?context[token]:getBuiltInValue(token, options); if(value !== undefined) return serializeVariableValue(value); if(options.strict) throw Error(`Unknown template variable: ${token}`); return options.preserveUnknown===false?'':match;});
  }
  function buildMockValue(template, context={}, options={}) {
    // Replace parsed JSON leaves so quotes/newlines in row data cannot corrupt a fixture.
    let parsed; try { parsed=JSON.parse(template); } catch { return resolveTemplateVariables(template,context,options); }
    const walk=value => { if(typeof value==='string') { const exact=/^\{\{([^}]+)\}\}$/.exec(value); if(exact && own(context,exact[1].trim())) return context[exact[1].trim()]; return resolveTemplateVariables(value,context,options); } if(Array.isArray(value))return value.map(walk); if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,walk(v)])); return value; }; return walk(parsed);
  }
  const sanitizeVariableName = value => {const v=String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,''); return v.startsWith('test_')?v:`test_${v||'value'}`;};
  function flattenInputContext(inputs={}) { return {...Object.fromEntries(Object.entries(inputs).filter(([k])=>k!=='artifacts'&&!forbidden.has(k))),...Object.fromEntries(Object.entries(inputs.artifacts||{}).filter(([k])=>!forbidden.has(k)))}; }
  function parseSelectedRowIndexes(input,maxRows) {
    const tokens=String(input||'').trim().split(/[\s,]+/).filter(Boolean), result=[];
    for(const token of tokens) {if(!/^\d+$/.test(token)||Number(token)<1||Number(token)>maxRows)throw Error(`Selected row ${token} is outside 1–${maxRows}.`); const i=Number(token)-1;if(!result.includes(i))result.push(i);} return result;
  }
  function normalizeFileData(file={}) {
    const headers=Array.isArray(file.headers)?file.headers.map(String):[], rows=Array.isArray(file.rows)?file.rows:[];
    if(headers.length>500 || rows.length>10000)throw Error('Fixture files support up to 500 columns and 10,000 rows.');
    if(new Set(headers).size!==headers.length || headers.some(h=>!h||forbidden.has(h)))throw Error('Column headers must be unique and nonempty.');
    if(rows.some(r=>!r||Array.isArray(r)||typeof r!=='object'))throw Error('Each data row must be an object.');
    const usageMode=file.usageMode||'per-row'; if(!['all','per-row','selected','sample'].includes(usageMode))throw Error('Unknown file usage mode.');
    const used=new Set(),columnMappings=Object.fromEntries(headers.map(h=>{let name=file.columnMappings?.[h];if(!name){const base=sanitizeVariableName(h);name=base;for(let i=2;used.has(name);i++)name=`${base}_${i}`;}variable(name);if(['file_row','file_rows','file_row_index','file_row_number','file_row_count'].includes(name))throw Error('Column mappings cannot replace built-in file variables.');used.add(name);return [h,name];}));
    if(new Set(Object.values(columnMappings)).size!==headers.length)throw Error('Each column must map to a different variable.');
    return {...file,headers,rows,usageMode,columnMappings,selectedRows:file.selectedRows||'',sampleSize:file.sampleSize??5};
  }
  function getFileRowsForExecution(file={},options={}) {
    const data=normalizeFileData(file); let indexes=data.rows.map((_,i)=>i);
    if(data.usageMode==='selected') {indexes=parseSelectedRowIndexes(data.selectedRows,data.rows.length);if(data.rows.length&&!indexes.length)throw Error('Select at least one data row.');}
    if(data.usageMode==='sample') {const size=Number(data.sampleSize); if(!Number.isSafeInteger(size)||size<1)throw Error('Sample size must be a positive integer.');for(let i=indexes.length-1;i>0;i--){const n=(options.randomFn||Math.random)(); if(!(n>=0&&n<1))throw Error('Invalid random source.');const j=Math.floor(n*(i+1));[indexes[i],indexes[j]]=[indexes[j],indexes[i]];}indexes=indexes.slice(0,size);}
    return options.withIndexes ? indexes.map(i=>({row:data.rows[i],index:i})) : indexes.map(i=>data.rows[i]);
  }
  function mapFileRowVariables(file,row) {const data=normalizeFileData(file); return Object.fromEntries(data.headers.map(h=>[data.columnMappings[h],row?.[h]??'']));}
  function buildFileIterations(file={},options={}) {
    const data=normalizeFileData(file),selected=getFileRowsForExecution(data,{...options,withIndexes:true});if((data.fileName||data.headers.length)&&(!data.headers.length||!data.rows.length))throw Error('The loaded data file needs columns and at least one row.');if(!data.headers.length||!selected.length)return [];
    if(data.usageMode==='all')return [{label:'All rows',rowNumber:1,variables:{file_rows:selected.map(({row})=>mapFileRowVariables(data,row)),file_row_count:selected.length}}];
    return selected.map(({row,index})=>{const mapped=mapFileRowVariables(data,row);return {label:`Row ${index+1}`,rowNumber:index+1,variables:{...mapped,file_row:mapped,file_row_index:index,file_row_number:index+1}};});
  }
  function normalizeState(state={}) {
    const mocks=(state.mocks||[]).map((m,i)=>({...m,id:String(m.id||`mock_${i+1}`),name:m.name||`Fixture ${i+1}`,type:m.type||'custom-object',template:typeof m.template==='string'?m.template:templates[m.type]||templates['custom-object']}));
    if(new Set(mocks.map(m=>m.id)).size!==mocks.length)throw Error('Mock identifiers must be unique.');
    const normalizeSteps=steps=>(steps||[]).map(s=>({...s,variableName:s.variableName||s.target||'',envName:s.envName||s.target||'',envValue:s.envValue??s.value??'',delayMs:s.delayMs??s.value??0,language:s.language||'python',code:s.code??(s.action==='run-code'?s.value:'')??'',resetAll:s.resetAll!==false}));
    return {...state,mocks,setupSteps:normalizeSteps(state.setupSteps),teardownSteps:normalizeSteps(state.teardownSteps),fileData:normalizeFileData(state.fileData)};
  }
  function validateSteps(steps,mocks) {
    for(const s of steps) {if(!actions.includes(s.action))throw Error(`Unsupported setup/teardown action: ${s.action}. Free-text notes are not executable.`);if(s.action==='create-test-data'){variable(s.variableName);if(!mocks.some(m=>m.id===s.mockId))throw Error('Choose an existing mock for create-test-data.');}if(s.action==='clear-test-data')variable(s.variableName);if(s.action==='set-environment')variable(s.envName);if(s.action==='reset-environment'&&!s.resetAll)variable(s.envName);if(s.action==='wait'&&(!Number.isSafeInteger(Number(s.delayMs))||Number(s.delayMs)<0||Number(s.delayMs)>300000))throw Error('Wait must be 0–300,000 milliseconds.');if(s.action==='run-code'&&(!['python','javascript'].includes(s.language)||!String(s.code||'').trim()))throw Error('Run-code needs Python or JavaScript and a nonempty snippet.');}
  }
  function buildSuiteExecutionPlan(suite,inputs={},options={}) {
    const state=normalizeState(suite?.mock_builder||suite?.mockBuilder||{});validateSteps([...state.setupSteps,...state.teardownSteps],state.mocks);
    const baseContextVariables=flattenInputContext(inputs),resolutionOptions={...options,variableCache:options.variableCache||{}};
    // Compatibility preview is pure. executeSuitePlan applies ordered effects per row.
    for(const s of state.setupSteps){if(s.action==='create-test-data')baseContextVariables[s.variableName]=buildMockValue(state.mocks.find(m=>m.id===s.mockId).template,baseContextVariables,resolutionOptions);if(s.action==='set-environment')baseContextVariables[s.envName]=resolveTemplateVariables(s.envValue,baseContextVariables,resolutionOptions);}
    const iterations=buildFileIterations(state.fileData,options).map(i=>({...i,contextVariables:{...baseContextVariables,...i.variables}}));
    return {version:1,state,inputs:flattenInputContext(inputs),baseContextVariables,setupSteps:state.setupSteps,teardownSteps:state.teardownSteps,beforeDelayMs:state.setupSteps.filter(s=>s.action==='wait').reduce((n,s)=>n+Number(s.delayMs),0),afterDelayMs:state.teardownSteps.filter(s=>s.action==='wait').reduce((n,s)=>n+Number(s.delayMs),0),iterations,hasFileIterations:iterations.length>0};
  }
  function delay(ms,signal) {return new Promise((resolve,reject)=>{if(signal?.aborted)return reject(Error('Execution cancelled.'));const done=()=>{signal?.removeEventListener('abort',abort);resolve();};const timer=setTimeout(done,ms);const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(Error('Execution cancelled.'));};signal?.addEventListener('abort',abort,{once:true});});}
  async function executeSuitePlan(plan,options={}) {
    // Revalidate the plan at its native boundary: renderer-supplied plans are untrusted.
    const safe=buildSuiteExecutionPlan({mock_builder:plan.state},plan.inputs,options),results=[];
    if(typeof options.runIteration!=='function')throw Error('A native runIteration callback is required.');
    const rows=safe.hasFileIterations?safe.iterations:[{label:'Test',variables:{},rowNumber:1}];
    for(const iteration of rows){const context={...safe.inputs,...iteration.variables},environment={},original=new Map(),effects=[];const resolution={...options,strict:true,variableCache:{}};
      const apply=async(s,teardown=false)=>{if(!teardown&&options.signal?.aborted)throw Error('Execution cancelled.');switch(s.action){
        case 'create-test-data': context[s.variableName]=buildMockValue(safe.state.mocks.find(m=>m.id===s.mockId).template,context,resolution);break;
        case 'clear-test-data':delete context[s.variableName];break;
        case 'set-environment':if(!original.has(s.envName))original.set(s.envName,own(context,s.envName)?{value:context[s.envName]}:null);environment[s.envName]=resolveTemplateVariables(s.envValue,context,resolution);context[s.envName]=environment[s.envName];break;
        case 'reset-environment':for(const name of (s.resetAll?[...original.keys()]:[s.envName])){if(original.has(name)){const before=original.get(name);if(before)context[name]=before.value;else delete context[name];}delete environment[name];}break;
        case 'wait':await delay(Number(s.delayMs),teardown?undefined:options.signal);break;
        case 'run-code':if(typeof options.runCode!=='function')throw Error('Run-code requires the reviewed native code adapter.');{const output=await options.runCode({language:s.language,code:resolveTemplateVariables(s.code,context,resolution),contextVariables:{...context},environment:{...environment},signal:teardown?undefined:options.signal,phase:teardown?'teardown':'setup'});if(output&&['FAILURE','FAILED','ERROR','CANCELLED','TIMEOUT'].includes(output.status))throw Error(output.error||output.message||'Native helper code failed.');if(output?.variables)for(const [k,v] of Object.entries(output.variables))context[variable(k)]=v;}break;
        default:throw Error('Unsupported action.');}effects.push({phase:teardown?'teardown':'setup',action:s.action,status:'SUCCESS'});};
      let result,error;try{for(const s of safe.setupSteps)await apply(s);result=await options.runIteration({contextVariables:{...context},environment:{...environment},iteration,signal:options.signal});}catch(e){error=e;}finally{for(const s of safe.teardownSteps)try{await apply(s,true);}catch(e){error=error?new AggregateError([error,e],'Execution and cleanup failed.'):e;}}
      if(error)throw error;results.push({iteration:iteration.rowNumber,result,effects,finalContext:{...context}});
    }return {status:results.some(r=>r.result&&['FAILURE','FAILED','ERROR','CANCELLED','TIMEOUT'].includes(r.result.status))?'FAILED':'SUCCESS',results};
  }
  const MAX_FILE_BYTES=10*1024*1024;
  function fileType(name){const extension=/\.([^.]+)$/.exec(String(name))?.[1].toLowerCase();if(!['csv','tsv','json','txt','xls','xlsx'].includes(extension))throw Error('Choose a CSV, TSV, Excel (.xlsx or .xls), JSON or TXT file.');return extension;}
  function structuredRows(rows){
    if(rows.length>10000)throw Error('Fixture files support up to 500 columns and 10,000 rows.');
    const objects=rows.map(row=>Array.isArray(row)?Object.fromEntries(row.map((value,i)=>[`column_${i+1}`,value])):row&&typeof row==='object'?row:{value:row==null?'':String(row)});
    const headers=[...new Set(objects.flatMap(row=>Object.keys(row)))];
    return {headers,rows:objects.map(row=>Object.fromEntries(headers.map(header=>[header,row[header]??''])))};
  }
  function parseExcel(bytes,name,options){
    const xlsx=options.xlsx||root.XLSX;if(!xlsx?.read||!xlsx?.utils)throw Error('The bundled Excel reader is unavailable. Reopen Studio and try again.');
    const ole=[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1],zip=bytes[0]===0x50&&bytes[1]===0x4b&&bytes[2]===3&&bytes[3]===4;
    const binary=ole.every((v,i)=>bytes[i]===v)||(bytes[0]===9&&[0,2,4,8].includes(bytes[1])),xml=/urn:schemas-microsoft-com:office:spreadsheet/i.test(new TextDecoder().decode(bytes.subarray(0,8192)));
    if(!zip&&!binary&&!xml)throw Error('Excel file is malformed or is not a supported XLS/XLSX workbook.');
    let book;try{book=xlsx.read(bytes,{type:'array',sheetRows:10002,cellFormula:false,cellHTML:false,cellText:false});}catch(error){throw Error('Excel file could not be read: '+error.message);}
    const sheetName=book.SheetNames?.[0],sheet=book.Sheets?.[sheetName];if(!sheet)throw Error('Excel workbook needs a worksheet.');
    const ref=sheet['!fullref']||sheet['!ref'];if(!ref)throw Error('Excel must have a header row and at least one data row.');
    const range=xlsx.utils.decode_range(ref);if(range.e.c-range.s.c+1>500||range.e.r-range.s.r>10000)throw Error('Fixture files support up to 500 columns and 10,000 rows.');
    const matrix=xlsx.utils.sheet_to_json(sheet,{header:1,raw:true,defval:'',blankrows:false});if(matrix.length<2)throw Error('Excel must have a header row and at least one data row.');
    const headers=matrix.shift().map(value=>String(value??'')),rows=matrix.map(row=>Object.fromEntries(headers.map((header,i)=>[header,row[i]??''])));
    return normalizeFileData({fileName:name,fileType:'excel',sheetName,headers,rows});
  }
  function parseDataFile(input,name='data.csv',options={}) {
    const type=fileType(name),bytes=typeof input==='string'?new TextEncoder().encode(input):input instanceof ArrayBuffer?new Uint8Array(input):ArrayBuffer.isView(input)?new Uint8Array(input.buffer,input.byteOffset,input.byteLength):null;
    if(!bytes)throw Error('Data file content must be text or bytes.');if(bytes.byteLength>MAX_FILE_BYTES)throw Error('Data file exceeds 10 MB.');
    if(type==='xls'||type==='xlsx')return parseExcel(bytes,name,options);
    let text=typeof input==='string'?input:new TextDecoder('utf-8',{fatal:true}).decode(bytes);text=text.replace(/^\uFEFF/,'');
    if(type==='json'){let parsed;try{parsed=JSON.parse(text);}catch(error){throw Error('JSON is not valid: '+error.message);}const rows=Array.isArray(parsed)?parsed:parsed&&Array.isArray(parsed.data)?parsed.data:parsed&&Array.isArray(parsed.rows)?parsed.rows:parsed&&typeof parsed==='object'?[parsed]:null;if(!rows)throw Error('JSON must contain an object, an array, or a data/rows array.');return normalizeFileData({fileName:name,fileType:'json',...structuredRows(rows)});}
    if(type==='txt'){const lines=text.replace(/\r\n?/g,'\n').split('\n').filter(line=>line.trim()!=='');if(lines.length>=2&&lines[0].includes(',')){try{return {...parseDataFile(lines.join('\n'),'text.csv'),fileName:name,fileType:'text'};}catch{ /* Original text import falls back to complete text lines. */ }}return normalizeFileData({fileName:name,fileType:'text',headers:['text'],rows:lines.map(text=>({text}))});}
    const separator=/\.tsv$/i.test(name)?'\t':',';let field='',row=[],records=[],quoted=false,closed=false;
    const push=()=>{row.push(field);field='';closed=false;};for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"'){quoted=false;closed=true;}else field+=c;}else if(c===separator){push();}else if(c==='\r'||c==='\n'){push();records.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++;}else if(c==='"'&&!field&&!closed)quoted=true;else{if(closed)throw Error('Invalid CSV after closing quote.');field+=c;}}if(quoted)throw Error('Unclosed CSV quote.');if(field||row.length||closed){push();records.push(row);}const headers=(records.shift()||[]).map((h,i)=>i===0?h.replace(/^\uFEFF/,''):h);const rows=records.map((cells,i)=>{if(cells.length!==headers.length)throw Error(`Row ${i+2} has ${cells.length} columns; expected ${headers.length}.`);return Object.fromEntries(headers.map((h,j)=>[h,cells[j]]));});return normalizeFileData({fileName:name,fileType:separator==='\t'?'tsv':'csv',headers,rows});
  }
  async function readDataFile(file,options={}){if(!file)throw Error('Choose a data file first.');const type=fileType(file.name);if(file.size>MAX_FILE_BYTES)throw Error('Data file exceeds 10 MB.');if(typeof file.arrayBuffer==='function')return parseDataFile(await file.arrayBuffer(),file.name,options);if(type==='xls'||type==='xlsx')throw Error('This file picker cannot read binary workbooks. Reopen Studio and try again.');return parseDataFile(await file.text(),file.name,options);}
  return {templates,builtIns,actions,normalizeState,normalizeFileData,variable,getBuiltInValue,serializeVariableValue,resolveTemplateVariables,buildMockValue,sanitizeVariableName,flattenInputContext,parseSelectedRowIndexes,getFileRowsForExecution,mapFileRowVariables,buildFileIterations,buildSuiteExecutionPlan,executeSuitePlan,delay,parseDataFile,readDataFile};
});
