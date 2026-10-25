const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

function harness(files = ['script.js']) {
    const values = new Map();
    const elements = new Map();
    const node = () => ({ value: '', checked: false, innerHTML: '', innerText: '', textContent: '', style: {},
        classList: { add() {}, remove() {}, contains() { return false; } }, appendChild() {}, remove() {},
        addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return node(); }, click() {} });
    const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); },
        querySelector() { return node(); }, querySelectorAll() { return []; }, createElement: node,
        body: { appendChild() {} }, addEventListener() {} };
    const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, document, Blob, URL, Date,
        setTimeout, clearTimeout, setInterval, clearInterval, performance, structuredClone,
        location: { href: 'http://localhost/index.html' }, confirm: () => true, alert() {},
        localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } });
    context.window = context;
    context.addEventListener = () => {};
    vm.runInContext(source('icons.js'),context,{filename:'icons.js'});
    vm.runInContext(source('execution-validation.js'),context,{filename:'execution-validation.js'});
    for (const file of files) vm.runInContext(source(file), context, { filename: file });
    return { context, elements, values, run: code => vm.runInContext(code, context) };
}
function suiteHarness() {
    const h = harness();
    h.run(`executionConfig = {mode:'real', robotType:'browser'};
        renderTestSuites = suites => { testSuites = suites; window.testSuites = suites; };
        autoSaveLogIfNeeded = () => {}; showMessage = () => {}; formatTime = () => 'now';
        currentStorage = new LocalStorageBackend(); window.currentStorage = currentStorage;`);
    return h;
}
function graph(nodes, edges = []) { return { id: 'p', name: 'Fixture', nodes: nodes.map((n, i) => ({ id: String(i), data: { name: 'N' + i }, ...n })), edges }; }
function pipelineHarness() {
    const h = harness(['graph-engine.js', 'pipeline-manager.js']);
    return h;
}

test('EXE-01 graph treats production FAILURE/ERROR and legacy aliases truthfully and stops dependents', async () => {
    const h = harness(['graph-engine.js']);
    for (const status of ['FAILURE', 'ERROR', 'FAILED', 'PASS']) {
        let count = 0;
        const g = graph([{ onFailure: 'stop' }, {}], [{ source: '0', target: '1' }]);
        const result = await new h.context.GraphEngine().execute(g, async () => { count++; return { status }; });
        assert.equal(result.status, status === 'PASS' ? 'SUCCESS' : status === 'FAILED' ? 'FAILURE' : status);
        assert.equal(count, status === 'PASS' ? 2 : 1);
    }
});

test('Graph suite nodes added through the editor and legacy test nodes dispatch the real suite runner',async()=>{
    const h=harness(['graph-engine.js','pipeline-manager.js','visual-editor.js']);
    const editor=new h.context.VisualEditor('fixture');editor.render=()=>{};editor._calculateNewNodePosition=()=>({x:0,y:0});editor.addTestNode({id:'suite',name:'Fixture'});
    assert.equal(editor.nodes[0].type,'test-suite');let calls=0;h.context.runTestSuite=async id=>{assert.equal(id,'suite');calls++;return{status:'SUCCESS'};};
    for(const type of ['test-suite','test']){editor.nodes[0].type=type;assert.equal((await h.context.runGraphPipeline({name:'Graph fixture',nodes:editor.nodes,edges:[]})).status,'SUCCESS');}assert.equal(calls,2);
});

test('EXE-02 canonical security palette nodes and legacy underscore imports dispatch actual scan handlers', async () => {
    for (const type of ['security-scan', 'security_scan']) {
        const h = pipelineHarness(); let calls = 0;
        h.context.securityManager = { async runCodeScan() { calls++; return { policyPassed: true, summary: { total: 0 } }; } };
        h.context.runTestSuite = () => { throw new Error('Incorrect suite dispatch'); };
        const result = await h.context.runGraphPipeline(graph([{ type, data: { name: 'scan', config: { code: 'const answer = 42;' } } }]));
        assert.equal(calls, 1); assert.equal(result.status, 'SUCCESS');
    }
});

test('EXE-03 connected scans reach gates; missing/unavailable or unrelated evidence cannot pass', async () => {
    const h = pipelineHarness();
    h.context.securityManager = { async runCodeScan() { return { policyPassed: true, summary: { total: 1, critical: 1, high: 0, medium: 0 } }; } };
    const nodes = [{ type: 'security-scan', data: { name: 'scan', config: { code: 'const a = 1;' } } }, { type: 'security-gate', data: { name: 'gate', config: { maxCritical: 0 } } }];
    assert.equal((await h.context.runGraphPipeline(graph(nodes, [{ source: '0', target: '1' }]))).status, 'FAILURE');
    assert.equal((await h.context.runGraphPipeline(graph([nodes[1]]))).status, 'ERROR');
    assert.equal((await h.context.runGraphPipeline(graph(nodes))).status, 'ERROR');
    nodes[1].data.config.maxCritical = 1;
    assert.equal((await h.context.runGraphPipeline(graph(nodes, [{ source: '0', target: '1' }]))).status, 'SUCCESS');
});

test('EXE-04 actual website adapter status survives shared suite result normalization', async () => {
    const h = suiteHarness();
    h.context.electronAPI={studioOps:{}};
    h.run(`executeRobotFrameworkBrowser = async () => ({success:true, output:'Website assertion passed'});`);
    const result = await h.context.executeSuiteCore({ language: 'website', name: 'local fixture', website_url: 'about:blank#fixture', code: 'test' });
    assert.equal(result.status, 'SUCCESS');
    h.run(`executeRobotFrameworkBrowser = async () => ({success:false, output:'Assertion mismatch'});`);
    assert.equal((await h.context.executeSuiteCore({ language: 'website', website_url: 'about:blank#fixture', code: 'test' })).status, 'FAILURE');
    assert.equal((await h.context.executeSuiteCore({language:'website',website_url:'about:blank',code:''})).status,'ERROR');
    delete h.context.electronAPI;
    assert.equal((await h.context.executeSuiteCore({language:'website',website_url:'about:blank',code:'test'})).status,'ERROR');
});

test('EXE-05 saved input_files delivered to Python Java CSharp with legacy migration', async () => {
    const h = suiteHarness(); const inputs = [{ filename: 'fixture.txt', content: '42' }];
    for (const language of ['python', 'java', 'csharp']) {
        h.context.capture = null;
        h.run(`execute${language === 'python' ? 'Python' : language === 'java' ? 'Java' : 'CSharp'}Code = async (code, files) => { window.capture = files; return {success:true, output:''}; };`);
        assert.equal((await h.context.executeSuiteCore({ language, code: '', input_files: inputs })).status, 'SUCCESS');
        assert.equal(h.context.capture, inputs);
    }
});

test('EXE-06 stdout diagnostics never override authoritative success or failure', async () => {
    const h = suiteHarness();
    await h.run(`currentStorage.saveSuite({id:'s', name:'S', language:'python', code:''})`);
    h.run(`testSuites = JSON.parse(localStorage.getItem('pipeline_test_suites'));`);
    for (const output of ['10 passed, 0 failed', 'Expected exception handled', '10 passed']) {
        h.context.fixtureOutput = output;
        h.run(`executePythonCode = async () => ({success:true, output:window.fixtureOutput});`);
        assert.equal((await h.context.runTestSuite('s', true)).status, 'SUCCESS');
    }
    h.run(`executePythonCode = async () => ({success:false, output:'10 passed'});`);
    assert.equal((await h.context.runTestSuite('s', true)).status, 'FAILURE');
});

test('EXE-07 silent pipeline runs every configured row and passes graph inputs without UI', async () => {
    const h = suiteHarness(); const calls = [];
    h.context.capture = (code, inputs) => calls.push({ code, inputs });
    h.context.dataManager = { getDataSet: () => ({ name: 'Rows', data: [{ n: '1' }, { n: '2' }] }), replaceVariables: (text, row) => text.replaceAll('${n}', row.n) };
    h.run(`executePythonCode = async (code, files, inputs) => { window.capture(code, inputs); return {success:true, output:code}; };`);
    await h.run(`currentStorage.saveSuite({id:'s', name:'S', language:'python', code:'row=\${n}', dataSetId:'d'})`);
    h.run(`testSuites = JSON.parse(localStorage.getItem('pipeline_test_suites'));`);
    const result = await h.context.runTestSuite('s', true, { repoPath: 'fixture' });
    assert.equal(result.status, 'SUCCESS'); assert.deepEqual(calls.map(call => call.code), ['row=1', 'row=2']);
    assert.equal(calls[0].inputs.repoPath, 'fixture');
    assert.equal(h.elements.has('run-modal'), false);
});

test('EXE-08 data-driven completion updates one existing suite on repeated runs', async () => {
    const h = suiteHarness();
    h.context.dataManager = { replaceVariables: text => text };
    h.run(`executePythonCode = async () => ({success:true, output:'done'});`);
    await h.run(`currentStorage.saveSuite({id:'s',name:'S',language:'python',code:''})`);
    const suite = await h.run(`currentStorage.getAllSuites().then(suites=>suites[0])`);
    for (let i = 0; i < 3; i++) await h.context.runDataDrivenTest(suite, { name: 'D', data: [{}] }, true);
    const saved = await h.run('currentStorage.getAllSuites()');
    assert.equal(saved.length, 1); assert.equal(saved[0].last_run_status, 'SUCCESS');
});

test('EXE-09 concurrent creates updates deletes and view unassignment preserve every mutation', async () => {
    const h = suiteHarness();
    await h.run(`Promise.all([currentStorage.saveSuite({id:'a',view_id:'v'}),currentStorage.saveSuite({id:'b',view_id:'v'}),currentStorage.saveSuite({id:'c'})])`);
    await h.run(`Promise.all([currentStorage.updateSuite('a',{name:'A'}),currentStorage.updateSuite('b',{name:'B'}),currentStorage.deleteSuite('c')])`);
    let saved = await h.run('currentStorage.getAllSuites()');
    assert.equal(saved.length, 2); assert.deepEqual(Array.from(saved, s => s.name), ['A', 'B']);
    h.run(`testSuites = JSON.parse(localStorage.getItem('pipeline_test_suites')); views=[{id:'v',name:'V'}]; saveViewsToStorage=()=>{};renderViews=()=>{};`);
    await h.context.deleteView('v');
    saved = await h.run('currentStorage.getAllSuites()'); assert.ok(saved.every(s => s.view_id === null));
});

test('EXE-10 Expected Output exact assertion applies to core and data-driven rows', async () => {
    const h = suiteHarness();
    h.run(`executePythonCode = async code => ({success:true,output:code});`);
    assert.equal((await h.context.executeSuiteCore({language:'python',code:'match\r\n',expected_output:'match'})).status, 'SUCCESS');
    const result = await h.context.executeSuiteCore({language:'python',code:'different',expected_output:'match'});
    assert.equal(result.status, 'FAILURE'); assert.match(result.error, /Expected Output mismatch/);
    h.context.dataManager = { replaceVariables: (text, row) => text.replaceAll('${n}', row.n) };
    await h.run(`currentStorage.saveSuite({id:'s',language:'python',code:'\${n}',expected_output:'\${n}'})`);
    const suite = (await h.run('currentStorage.getAllSuites()'))[0];
    assert.equal((await h.context.runDataDrivenTest(suite, {name:'D',data:[{n:'1'},{n:'2'}]}, true)).status, 'SUCCESS');
    suite.expected_output='wrong';
    assert.equal((await h.context.runDataDrivenTest(suite, {name:'D',data:[{n:'1'}]}, true)).status, 'FAILURE');
});

test('EXE-11 individual unit Run uses graph injection/command adapter with upstream clone path', async () => {
    const h = harness(['graph-engine.js','pipeline-manager.js','visual-editor.js']); const writes = []; const commands = [];
    h.context.electronAPI = { fileOps: { writeFile: async (...args) => writes.push(args) }, sysOps: { runCommand: async (...args) => { commands.push(args); return {exitCode:0,stdout:'ok'}; } } };
    const editor = new h.context.VisualEditor('fixture');
    editor.nodes=[{id:'git',data:{clonedPath:'C:/fixture'}},{id:'unit',type:'unit-test-runner',data:{testCode:'console.log(42)',testFilename:'test.cjs',command:'node test.cjs'}}];
    editor.edges=[{source:'git',target:'unit'}];
    assert.equal((await editor.runNode('unit')).status,'SUCCESS');
    assert.deepEqual(writes,[['C:/fixture/test.cjs','console.log(42)']]); assert.deepEqual(commands,[['C:/fixture','node test.cjs']]);
    editor.nodes[0].data.clonedPath=''; assert.equal((await editor.runNode('unit')).status,'ERROR');
});

test('EXE-12 editor working copy and returned graph never mutate saved nested data', () => {
    const h = harness(['visual-editor.js']); const editor = new h.context.VisualEditor('fixture'); editor.render=()=>{};
    const saved={nodes:[{id:'a',type:'security_scan',position:{x:1},data:{config:{scanTypes:['sast']}}}],edges:[]};
    editor.loadGraph(saved); editor.nodes[0].position.x=100; editor.nodes[0].data.config.scanTypes.push('xss'); editor.nodes.push({id:'b'});
    assert.equal(saved.nodes.length,1); assert.equal(saved.nodes[0].position.x,1); assert.equal(saved.nodes[0].data.config.scanTypes.length,1);
    assert.equal(editor.nodes[0].type,'security-scan'); const output=editor.getGraph();output.nodes[0].position.x=200;assert.equal(editor.nodes[0].position.x,100);
});

test('EXE-13 actual code scan receives checkbox categories; none selected is an error', async () => {
    const h = pipelineHarness(); let options;
    h.context.securityManager={runCodeScan:async(code,config)=>{options=config;return {policyPassed:true,summary:{total:0}};}};
    const node={type:'security-scan',data:{name:'S',config:{code:'const n = 1',sast:false,secrets:false,xss:true,scanTypes:['sast']}}};
    assert.equal((await h.context.runGraphPipeline(graph([node]))).status,'SUCCESS');assert.deepEqual(Array.from(options.scanTypes),['xss']);
    node.data.config.xss=false;assert.equal((await h.context.runGraphPipeline(graph([node]))).status,'ERROR');
});

test('EXE-15 website edit method alias invokes existing toggle behavior', () => {
    const h = harness(); h.context.document.querySelector=()=>({value:'url'});
    h.context.setTimeout = () => 0;
    h.run('updateCodeEditor=()=>{};populateViewSelectOptions=()=>{};renderTagsInEditor=()=>{};updateDataSetDropdown=()=>{};switchEditorTab=()=>{};');
    assert.doesNotThrow(()=>h.context.openNormalSuiteEditor({id:'url',language:'website',website_method:'url',website_url:'https://fixture.invalid',name:'Fixture'}));
    assert.equal(h.elements.get('website_url').value, 'https://fixture.invalid');
    assert.doesNotThrow(()=>h.context.toggleWebsiteMethod());
    h.context.document.querySelector=()=>({value:'upload'});assert.doesNotThrow(()=>h.context.toggleWebsiteMethod());
});

test('EXE-16 latest engine cycle errors persist ERROR and timestamp over old SUCCESS', async () => {
    const h = pipelineHarness();const p=graph([{},{}],[{source:'0',target:'1'},{source:'1',target:'0'}]);p.lastStatus='SUCCESS';
    h.run('pipelines=[]');h.context.fixture=p;h.run('pipelines.push(window.fixture)');
    assert.equal((await h.context.runGraphPipeline(p)).status,'ERROR');
    const saved=JSON.parse(h.values.get('lvx_pipelines'))[0];assert.equal(saved.lastStatus,'ERROR');assert.ok(saved.lastRun);assert.equal(h.elements.get('pipeline-overall-status').innerText,'ERROR');
});

function runnerHarness() {
    const dirs=[];const pending=[];const realRequire=require;
    function requireStub(name) {
        if(name==='child_process') return {execFile:(runtime,args,options,callback)=>pending.push({runtime,args,options,callback})};
        if(name==='fs') return {...fs,mkdtempSync:prefix=>{const dir=fs.mkdtempSync(prefix);dirs.push(dir);return dir;}};
        return realRequire(name);
    }
    requireStub.resolve=()=>path.join(root,'node_modules','playwright','index.js');
    const context=vm.createContext({require:requireStub,module:{exports:{}},__dirname:path.join(root,'services'),process:{execPath:'C:/installed/LVX.exe',env:{PATH:''},resourcesPath:'C:/installed/resources'},console});
    vm.runInContext(source('services/playwright-runner.js'),context);
    return {run:context.module.exports.runPlaywrightScript,pending,dirs};
}

test('DRV-01 child runner uses packaged Electron Node and explicit module/browser paths outside launch cwd',async()=>{
    const h=runnerHarness();const result=h.run('console.log(42)');const child=h.pending[0];
    assert.equal(child.runtime,'C:/installed/LVX.exe');assert.equal(child.options.env.ELECTRON_RUN_AS_NODE,'1');assert.equal(child.options.windowsHide,true);
    assert.equal(child.options.env.NODE_PATH,path.join(root,'node_modules'));assert.equal(child.options.cwd,path.dirname(child.args[0]));assert.notEqual(child.options.cwd,root);
    child.callback(null,'42','');assert.equal((await result).status,'SUCCESS');assert.equal(fs.existsSync(h.dirs[0]),false);
});

test('EXE-14 concurrent invocations have isolated files and clean up only their own directory',async()=>{
    const h=runnerHarness();const first=h.run('first');const second=h.run('second');
    assert.notEqual(h.pending[0].args[0],h.pending[1].args[0]);assert.equal(fs.readFileSync(h.pending[0].args[0],'utf8'),'first');assert.equal(fs.readFileSync(h.pending[1].args[0],'utf8'),'second');
    h.pending[0].callback(null,'first','');await first;assert.equal(fs.existsSync(h.pending[1].args[0]),true);
    h.pending[1].callback({code:1,message:'fixture failure'},'','failure');assert.equal((await second).status,'FAILURE');assert.ok(h.dirs.every(dir=>!fs.existsSync(dir)));
});

test('startup never creates demos; LVXApp refresh awaits storage and updates compatibility state',async()=>{
    const h=suiteHarness();assert.doesNotMatch(source('script.js'),/ensureDemoSuites|demo_producer_v1|demo_consumer_v1/);
    await h.run(`currentStorage.saveSuite({id:'s',name:'S'})`);
    assert.equal((await h.context.LVXApp.refreshSuites()).length,1);assert.equal(h.context.LVXApp.getSuites()[0].id,'s');
    assert.equal(await h.context.LVXApp.getStorage(),h.context.currentStorage);h.run(`selectedSuites.add('s')`);assert.equal(h.context.LVXApp.getSelectedSuite().id,'s');
});


test('DRV-01 real child runtime resolves shipped Playwright without launch-directory modules', async () => {
    const { runPlaywrightScript } = require('../services/playwright-runner');
    const result = await runPlaywrightScript("const {chromium} = require('playwright'); console.log('LOCAL_RUNTIME:' + typeof chromium.launch);");
    assert.equal(result.status, 'SUCCESS', result.logs);
    assert.match(result.logs, /LOCAL_RUNTIME:function/);
    const negative = await runPlaywrightScript("console.log('local failing control'); process.exitCode = 2;");
    assert.equal(negative.status, 'FAILURE');
});

test('EXE-02 palette drop dispatches the same canonical types through the graph', async () => {
    const h = harness(['graph-engine.js', 'pipeline-manager.js', 'visual-editor.js']);
    const editor = new h.context.VisualEditor('fixture'); editor.render = () => {};
    editor.canvas = { getBoundingClientRect: () => ({left:0,top:0}) };
    editor._handleDrop({preventDefault(){},dataTransfer:{getData:()=>JSON.stringify({type:'security-scan'})},clientX:20,clientY:30});
    let calls = 0;
    h.context.securityManager={runCodeScan:async()=>{calls++;return {policyPassed:true,summary:{total:0}};}};
    editor.nodes[0].data.config={code:'const x = 1;'};
    assert.equal((await h.context.runGraphPipeline({name:'Palette',nodes:editor.nodes,edges:[]})).status, 'SUCCESS');
    assert.equal(calls,1);
});

test('EXE-03 unavailable, incomplete, or unreadable scans stay ERROR instead of passing gates', async () => {
    const h = pipelineHarness();
    const scan={type:'security-scan',onFailure:'continue',data:{name:'S',config:{code:'const x = 1;'}}};
    const gate={type:'security-gate',data:{name:'G',config:{maxCritical:100}}};
    h.context.securityManager={runCodeScan:async()=>({status:'ERROR',error:'Scanner unavailable',policyPassed:false,summary:{total:0}})};
    assert.equal((await h.context.runGraphPipeline(graph([scan,gate],[{source:'0',target:'1'}]))).status,'ERROR');
    h.context.securityManager.runCodeScan=async()=>({policyPassed:true,summary:{total:0}});
    assert.equal((await h.context.runGraphPipeline(graph([scan,gate],[{source:'0',target:'1'}]))).status,'ERROR');
});

test('Robot runtime writes original source verbatim and registers an importable BrowserLibrary', async () => {
    const h = harness(); const values = new Map(); const programs=[];
    h.context.pyodideStub={globals:{set:(key,value)=>values.set(key,value)},runPythonAsync:async code=>{programs.push(code);return code==='success'?true:code==='result'?0:'';}};
    h.run('robotFrameworkInstalled=true;pyodideInstance=window.pyodideStub;');
    const robot='*** Test Cases ***\nCase\n    Log    literal \\n \\path';
    assert.equal((await h.context.executeRobotFrameworkBrowser(robot)).success,true);
    assert.equal(values.get('_lvx_robot_source'),robot);assert.match(programs[0],/f.write\(_lvx_robot_source\)/);
    assert.match(source('script.js'),/sys.modules\['BrowserLibrary'\] = _browser_module/);
});


test('LVXApp waits for configured backend readiness before authoritative refresh', async () => {
    const h = suiteHarness(); let release;
    h.context.connectionReady = new Promise(resolve => { release = resolve; });
    h.run('LocalStorageBackend.prototype.initialize = async function(){await window.connectionReady;};');
    const connection = h.context.connectToStorage({type:'localStorage'});
    let refreshed = false;
    const { refreshSuites } = h.context.LVXApp;
    const pending = refreshSuites().then(() => { refreshed = true; });
    await Promise.resolve(); assert.equal(refreshed, false);
    release(); await connection; await pending;assert.equal(refreshed,true);
    assert.equal(await h.context.LVXApp.getStorage(), h.context.currentStorage);
});
