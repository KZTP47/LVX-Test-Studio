'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function element() { const attributes=new Map();return {setAttribute(key,value){attributes.set(key,String(value));},removeAttribute(key){attributes.delete(key);},getAttribute(key){return attributes.get(key)??null;}, value:'', checked:false, disabled:false, innerHTML:'', textContent:'', dataset:{}, style:{}, remove(){}, classList:{add(){},remove(){},toggle(){}}, addEventListener(){}, querySelectorAll(){return [];} }; }
function harness(files, extra = {}) {
    const data = new Map(), nodes = new Map();
    const document = { readyState:'loading', addEventListener(){}, querySelectorAll(){return [];}, querySelector(){return null;},
        getElementById(id){ if (!nodes.has(id)) nodes.set(id,element()); return nodes.get(id); }, createElement(){return element();}, body:element() };
    const context = { console:{log(){},warn(){},error(){}}, document, localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)},
        setTimeout,clearTimeout,setInterval,clearInterval,AbortController,URL, Blob, performance, Map,Set,Date,Math,Promise,showMessage(){},...extra };
    context.window=context;
    vm.createContext(context);
    for (const file of files) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
    return { context,nodes,data,run:code=>vm.runInContext(code,context) };
}
const security = extra => harness(['security-testing.js'],extra);
test('B01: standard OSV arrays, empty fallback and unknown CVSS retain every finding', async()=>{
    const vulns=[{id:'cvss',severity:[{type:'CVSS_V3',score:'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'}]},
        {id:'fallback',severity:[],database_specific:{severity:'HIGH'}},{id:'unknown',severity:[{score:'unrecognized'}]}];
    const h=security({fetch:async()=>({ok:true,json:async()=>({vulns})})});
    const result=await h.context.securityManager.runDependencyScan('{"dependencies":{"fixture":"1.0.0"}}');
    assert.deepEqual(Array.from(result.vulnerabilities,v=>v.severity),['CRITICAL','HIGH','UNKNOWN']);
    assert.equal(result.summary.total,3);assert.equal(result.policyPassed,false);
    assert.equal(h.run("new DependencyScanner()._mapSeverity('low')"),'LOW');
});
test('B02: rejected/non-OK dependency lookups remain ERROR and retry rather than cache clean',async()=>{
    let calls=0;
    const h=security({fetch:async()=>{calls++;throw new Error('offline fixture');}});
    for(let i=0;i<2;i++) {const r=await h.context.securityManager.runDependencyScan('{"dependencies":{"fixture":"1.0.0"}}');assert.equal(r.status,'ERROR');assert.equal(r.policyPassed,false);assert.match(r.error,/offline fixture/);}
    assert.equal(calls,2);
    h.context.fetch=async()=>({ok:false,status:503});
    assert.match((await h.context.securityManager.runDependencyScan('{"dependencies":{"fixture":"1.0.0"}}')).error,/503/);
    h.context.fetch=async()=>({ok:true,json:async()=>({})});
    assert.equal((await h.context.securityManager.runDependencyScan('{"dependencies":{"fixture":"1.0.0"}}')).policyPassed,true);
    assert.equal((await h.context.securityManager.runDependencyScan('{"dependencies":{"fixture":"^1.0.0"}}')).status,'ERROR');
});
test('B03: unavailable infrastructure is an explicit ERROR; array and backend object normalize',async()=>{
    const h=security();
    for(const type of ['docker_container','docker_image','k8s_yaml','network_port','not-supported']) {
        const r=await h.context.securityManager.runInfrastructureScan(type==='network_port'?'localhost:1234':'fixture',type);
        assert.equal(r.status,'ERROR');assert.equal(r.policyPassed,false);assert.match(r.error,/unavailable|Unsupported/);
    }
    h.context.electronAPI={scanInfrastructure:async({type})=>({status:'SUCCESS',vulnerabilities:[{severity:'HIGH',description:type}]})};
    const r=await h.context.securityManager.runInfrastructureScan('fixture','docker_image');assert.equal(r.summary.high,1);
    h.context.securityManager.registerScanner('docker',{scanImage:async()=>[]});
    assert.equal((await h.context.securityManager.runInfrastructureScan('fixture','docker_image')).policyPassed,true);
    h.context.securityManager.registerScanner('docker',{scanImage:async()=>({summary:{total:0}})});
    assert.equal((await h.context.securityManager.runInfrastructureScan('fixture','docker_image')).status,'ERROR');
});
test('B04: every numeric maximum applies before fail-on severity, including low fail-on',()=>{
    const h=security(), m=h.context.securityManager;
    m.savePolicy({failOn:'critical',maxHigh:1,maxMedium:1,maxLow:1});
    for(const level of ['high','medium','low']) assert.equal(m.checkPolicyCompliance({critical:0,high:0,medium:0,low:0,[level]:2}),false);
    assert.equal(m.checkPolicyCompliance({critical:0,high:1,medium:1,low:1}),true);
    m.savePolicy({failOn:'low'});assert.equal(m.checkPolicyCompliance({critical:0,high:0,medium:0,low:1}),false);
});
test('B05: policy UI preserves zero and rejects negative/fractional maxima',()=>{
    const h=harness(['security-testing.js','security-ui.js']);
    for(const level of ['critical','high','medium','low'])h.context.document.getElementById('policy-max-'+level).value='0';
    h.context.saveSecurityPolicy();
    assert.equal(h.context.securityManager.policy.maxHigh,0);assert.equal(h.context.securityManager.policy.maxLow,0);
    h.context.document.getElementById('policy-max-high').value='-1';assert.equal(h.context.saveSecurityPolicy(),false);assert.equal(h.context.securityManager.policy.maxHigh,0);
    h.context.document.getElementById('policy-max-high').value='1.5';assert.equal(h.context.saveSecurityPolicy(),false);assert.equal(h.context.securityManager.policy.maxHigh,0);
});
test('B06: save and selected-suite scan use awaited configured LVXApp storage',async()=>{
    const h=harness(['security-testing.js','security-ui.js']);let saved,refresh=0;
    h.context.LVXApp={getStorage:async()=>({saveSuite:async suite=>{await Promise.resolve();saved=suite;return 12;}}),refreshSuites:async()=>{assert.ok(saved);refresh++;},getSelectedSuite:()=>({id:4,code:'const selected = 1;',language:'javascript'})};
    h.context.prompt=()=> 'Saved security';h.context.document.getElementById('security-code-input').value='const original = 1;';h.context.document.getElementById('scan-type-sast').checked=true;
    h.run('lastScanResults = {summary:{total:0}}');await h.context.saveSecurityScanAsSuite();assert.equal(saved.name,'Saved security');assert.equal(refresh,1);
    await h.context.scanCurrentSuite();assert.equal(h.context.document.getElementById('security-code-input').value,'const selected = 1;');
});
test('B07: result rendering orders critical before high and low',()=>{
    const h=harness(['security-testing.js','security-ui.js']);
    h.context.displayScanResults({summary:{},policyPassed:false,vulnerabilities:[{severity:'LOW',description:'low-marker'},{severity:'CRITICAL',description:'critical-marker'},{severity:'HIGH',description:'high-marker'}]});
    const html=h.context.document.getElementById('security-vulnerabilities-list').innerHTML;
    assert.ok(html.indexOf('critical-marker')<html.indexOf('high-marker'));assert.ok(html.indexOf('high-marker')<html.indexOf('low-marker'));
});
test('B08: history retains 100 scans with details and newest-first identity',()=>{
    const h=security(),m=h.context.securityManager;
    for(let i=0;i<120;i++)m._saveToHistory({id:i,summary:{critical:1},vulnerabilities:[{severity:'CRITICAL',description:'fixture'}]});
    const history=m.getHistory(1000);assert.equal(history.length,100);assert.equal(history[0].id,119);assert.equal(history[99].id,20);assert.equal(history[0].vulnerabilities[0].severity,'CRITICAL');
});
const unit=extra=>harness(['unit-testing.js'],extra);
test('B09/B10/B11: shared const fixtures, awaited promises and teardown on failure',async()=>{
    const h=unit();h.context.events=[];
    let r=await h.context.executeJavaScriptUnitTest({name:'shared',setup_code:'const fixture = await Promise.resolve(42);',test_code:'return Promise.resolve().then(() => assert(fixture === 42));',teardown_code:'events.push(fixture);'});
    assert.equal(r.status,'PASS');assert.equal(r.assertions_passed,1);assert.deepEqual(h.context.events,[42]);
    r=await h.context.executeJavaScriptUnitTest({name:'negative',setup_code:'const fixture = 12;',test_code:'return new Promise(resolve => setTimeout(resolve, 5)).then(() => assert(false, "async failure"));',teardown_code:'events.push(fixture); throw new Error("cleanup failure");'});
    assert.equal(r.status,'FAIL');assert.match(r.error,/async failure/);assert.match(r.cleanup_error,/cleanup failure/);assert.deepEqual(h.context.events,[42,12]);
    r=await h.context.executeJavaScriptUnitTest({name:'setup failure',setup_code:'const fixture = "cleanup"; throw new Error("setup failure");',test_code:'assert(true)',teardown_code:'return Promise.resolve().then(() => events.push(fixture));'});
    assert.equal(r.status,'FAIL');assert.equal(h.context.events.at(-1),'cleanup');
});
test('B10: cooperative async timeout fails and aborts its test signal',async()=>{
    const h=unit();h.context.events=[];
    const r=await h.context.executeJavaScriptUnitTest({name:'timeout',timeout_ms:10,test_code:'return new Promise(resolve => signal.addEventListener("abort", () => { events.push("aborted"); resolve(); }));',teardown_code:'events.push("cleaned");'});
    assert.equal(r.status,'FAIL');assert.match(r.error,/timed out/);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(h.context.events,['aborted','cleaned']);
});
function pythonRuntime() {
    const candidates=[process.env.LVX_TEST_PYTHON,process.env.LVX_PYTHON,'python',path.join(root,'.external','python','Scripts','python.exe'),path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'),'python'];
    for(const exe of candidates.filter(Boolean)){const r=spawnSync(exe,['-c','import sys;print(sys.executable)'],{encoding:'utf8'});if(r.status===0)return exe;}
    throw new Error('Python required for actual generated framework regression');
}
function realPythonAdapter(){return {loadPackage:async()=>{},runPythonAsync:async code=>{
    // Execute the exact generated program; only echo its final expression as Pyodide would return it.
    const program=code.replace(/json\.dumps\(_lvx_result\)\s*$/,'print(json.dumps(_lvx_result))');
    const result=spawnSync(pythonRuntime(),['-c',program],{encoding:'utf8',env:{...process.env,PYTHONPATH:[path.join(root,'.external','python-test-packages'),path.join(root,'.external','python-runtime-packages'),path.join(root,'.external','python-packages'),process.env.PYTHONPATH].filter(Boolean).join(path.delimiter)},timeout:20000});
    assert.equal(result.status,0,result.stderr);return result.stdout.trim();
}};}
test('B11/B12: actual unittest discovery executes failures and always runs teardown',async()=>{
    const h=unit({initializePyodide:async()=>realPythonAdapter()});
    const r=await h.context.executePythonUnitTest({name:'real unittest',test_framework:'unittest',setup_code:'fixture = 42',test_code:'class Failure(unittest.TestCase):\n    def test_failure(self):\n        self.assertEqual(fixture, 41)',teardown_code:'print("teardown-confirmed", fixture)'});
    assert.equal(r.status,'FAIL');assert.equal(r.assertions_failed,1);assert.match(r.output,/teardown-confirmed 42/);assert.match(r.output,/FAIL: test_failure/);
    const pass=await h.context.executePythonUnitTest({name:'positive',test_framework:'unittest',test_code:'class Positive(unittest.TestCase):\n    def test_pass(self):\n        self.assertTrue(True)'});assert.equal(pass.status,'PASS');assert.equal(pass.assertions_passed,1);
    const empty=await h.context.executePythonUnitTest({name:'empty',test_framework:'unittest',test_code:'x=1'});assert.equal(empty.status,'FAIL');assert.match(empty.error,/No unittest/);
});
test('B12: actual pytest discovery never passes a failing or empty suite',async()=>{
    const h=unit({initializePyodide:async()=>realPythonAdapter()});
    const bad=await h.context.executePythonUnitTest({name:'pytest negative',test_framework:'pytest',setup_code:'fixture=42',test_code:'def test_failure():\n    assert fixture == 41',teardown_code:'print("pytest-cleanup")'});
    assert.equal(bad.status,'FAIL');assert.match(bad.output,/pytest-cleanup/);
    const check=spawnSync(pythonRuntime(),['-c','import pytest'],{encoding:'utf8',env:{...process.env,PYTHONPATH:[path.join(root,'.external','python-test-packages'),path.join(root,'.external','python-runtime-packages'),path.join(root,'.external','python-packages')].join(path.delimiter)}});
    assert.equal(check.status,0,'Install pytest in .external/python-packages to verify the supported framework');
    assert.match(bad.output,/FAILED/);
    const good=await h.context.executePythonUnitTest({name:'pytest positive',test_framework:'pytest',test_code:'def test_success():\n    assert True'});assert.equal(good.status,'PASS');assert.equal(good.assertions_passed,1);
});
test('Framework modes without their real engine fail visibly; no seeded unit tests',async()=>{
    const h=unit();assert.equal(h.run('unitTests.length'),0);
    const jest=await h.context.executeJavaScriptUnitTest({test_framework:'jest',test_code:'test("never",()=>{throw Error("fail")})'});assert.equal(jest.status,'FAIL');assert.match(jest.error,/Jest runtime unavailable/);
    const python=await h.context.executePythonUnitTest({test_framework:'pytest'});assert.equal(python.status,'FAIL');assert.match(python.error,/unavailable/);
});
test('B13/B19: every advanced step receives runner window and exact threshold stays zero',async()=>{
    const h=harness(['visual-web-tester.js']);const runner={document:{}},calls=[];
    h.context.advancedAssertions={saveBaseline:async win=>calls.push(win),compareWithBaseline:async(win,name,threshold)=>{calls.push(win);assert.equal(threshold,0);return {passed:true,diffPercentage:0};},measurePerformance:async win=>{calls.push(win);return {loadComplete:1};},checkAccessibility:async win=>{calls.push(win);return {issues:[],passed:true};}};
    for(const name of ['Save Screenshot Baseline','Compare Screenshot','Check Performance','Check Accessibility'])await h.run('vwt_availableSteps').find(s=>s.name===name).execute({name:'fixture',threshold:'0',maxLoadTime:'10'},runner,()=>{});
    assert.equal(calls.length,4);assert.ok(calls.every(win=>win===runner));
    await assert.rejects(()=>h.run('vwt_availableSteps').find(s=>s.name==='Compare Screenshot').execute({threshold:'-1'},runner,()=>{}),/between/);
});
test('B14: unlabelled controls without IDs fail; associated, wrapping and ARIA names pass',async()=>{
    const h=harness(['advanced-assertions.js']);
    const control=(tag,attrs={},labels=[])=>({tagName:tag.toUpperCase(),labels,id:attrs.id||'',value:attrs.value||'',getAttribute:k=>attrs[k]??null,closest:()=>null});
    const controls=[control('input'),control('select'),control('textarea'),control('input',{'aria-label':'Name'}),control('input',{},[{textContent:'Wrapped label'}]),control('input',{'aria-labelledby':'label'}),control('input',{type:'hidden'})];
    const doc={querySelectorAll:s=>s==='input, textarea, select'?controls:[],getElementById:id=>id==='label'?{textContent:'Referenced label'}:null};
    const r=await h.context.advancedAssertions.checkAccessibility({document:doc});assert.equal(r.errorCount,3);assert.equal(r.passed,false);
    controls.splice(0,3);assert.equal((await h.context.advancedAssertions.checkAccessibility({contentWindow:{document:doc}})).passed,true);
});
test('B15: each integration receives only its configured success/failure event',async()=>{
    const h=harness(['integrations.js']);const manager=h.context.integrationsManager;const sent=[];
    manager.saveIntegration({id:'success',notifyOnSuccess:true});manager.saveIntegration({id:'failure',notifyOnFailure:true});manager.saveIntegration({id:'all',notifyOnAll:true});manager.saveIntegration({id:'none'});
    manager._sendToIntegration=async i=>sent.push(i.id);
    await manager.sendNotification({status:'SUCCESS'});assert.deepEqual(sent,['success','all']);sent.length=0;
    await manager.sendNotification({status:'ERROR'});assert.deepEqual(sent,['failure','all']);
});
test('B17: Monaco parses complete multiword cells, tab cells and assignment targets',()=>{
    const h=harness(['monaco-config.js']);let markers;
    h.context.monaco={MarkerSeverity:{Warning:4,Error:8},editor:{setModelMarkers:(m,owner,value)=>markers=value}};
    const lines=['*** Test Cases ***','Test','    Click Element    #submit','\tInput Text\t#field\tvalue','    ${value}=    Get Text    #heading','    Log    hello','    Nonexistent Keyword    value'];
    h.context.validateRobotFramework({getModel:()=>({getLinesContent:()=>lines})});assert.equal(markers.length,1);assert.match(markers[0].message,/Nonexistent Keyword/);
});
test('B18: Resume runs to completion, Step pauses once, and Stop unblocks breakpoints',async()=>{
    const h=harness(['debugger.js','visual-web-tester.js']);const d=h.context.testDebugger;
    h.run('vwt_steps = [{name:"Click Element",params:{selector:"#one"}},{name:"Click Element",params:{selector:"#two"}}]; vwt_files.html="<html></html>"');
    const iframe=h.context.document.getElementById('vwt-iframe');let clicks=0;iframe.contentWindow={document:{querySelector:()=>({click(){clicks++;}})}};
    h.context.electronAPI={previewOps:{invoke:async(action)=>action==='open'?{id:'debug-session',html:'<html></html>'}:action==='step'?(clicks++,{html:'<html></html>',logs:[]}):{closed:true}}};
    const run=h.context.runTestInDebugMode();await new Promise(resolve=>setImmediate(resolve));assert.equal(d.isPaused,true);d.resume();await run;assert.equal(clicks,2);assert.equal(d.isActive,false);
    clicks=0;const stepping=h.context.runTestInDebugMode();await new Promise(resolve=>setImmediate(resolve));d.stepOver();await new Promise(resolve=>setImmediate(resolve));assert.equal(clicks,1);assert.equal(d.isPaused,true);d.stepOver();await stepping;assert.equal(clicks,2);assert.equal(d.isPaused,false);
    d.startDebugSession([{name:'blocked'}],()=>{});d.breakpoints.add(0);const next=d.executeNextStep();d.stopDebugSession();assert.equal(await next,null);
});
test('B20: selector proposals escape literal punctuation, digits and attribute quotes',()=>{
    const h=harness(['element-picker.js']);const picker=new h.context.ElementPicker('fixture');
    const picked={id:'form.email',name:'user"name',className:'form:input',tagName:'INPUT',type:'text',placeholder:'one\ntwo',attributes:[{name:'data-test',value:'a"b\\c'}],textContent:'',children:[],parentElement:null};
    picker.iframeDoc={body:{},querySelectorAll:selector=> selector==='input[name="user\\22 name"]'||selector==='#form\\.email'||selector==='input'? [picked]:[]};
    const selectors=picker.getAllPossibleSelectors(picked).map(s=>s.selector);
    assert.ok(selectors.includes('#form\\.email'));assert.ok(selectors.includes('input[name="user\\22 name"]'));
    assert.match(picker._escapeIdentifier('1abc'),/^\\31 /);assert.match(picker._escapeIdentifier('-1abc'),/^-\\31 /);
    assert.equal(picker._escapeIdentifier('-'),'\\-');
});
test('B21: generators emit real Robot cells and continuation arguments, and prevent unsupported external checks from passing',()=>{
    const h=harness(['nocode-builder.js','visual-web-tester.js']);
    h.run('testSteps = [{name:"Click Element",params:{selector:"#submit"}},{name:"Input Text",params:{selector:"#text",text:"first\\nsecond  line"}}]');
    const code=h.context.generateCode(true);assert.match(code,/Library {4}BrowserLibrary/);assert.match(code,/ {4}Click Element {4}\\#submit/);assert.match(code,/ {4}\.\.\. {4}first/);assert.match(code,/second\\x20\\x20line/);
    h.run('vwt_steps = [{name:"Click Element",params:{selector:"#submit"}}]');assert.match(h.context.vwt_generateRobotCode(),/ {4}Click Element {4}\\#submit/);
    h.run('vwt_steps = [{name:"Check Accessibility",params:{}}]');assert.ok(h.context.vwt_generateRobotCode().includes("    Fail    Check\\x20Accessibility"));
});
test('B21: actual Robot dry-run accepts both builders; execution preserves multiline literal arguments',()=>{
    const h=harness(['nocode-builder.js','visual-web-tester.js']);
    const expected='first\nsecond  line\n${literal} \\path #value';
    h.run('testSteps = [{name:"Click Element",params:{selector:"#submit"}},{name:"Input Text",params:{selector:"#text",text:'+JSON.stringify(expected)+'}}]');
    const browser=h.context.generateCode(true),universal=h.context.generateCode(false);
    h.run('vwt_steps = [{name:"Click Element",params:{selector:"#submit"}}]');
    const visual=h.context.vwt_generateRobotCode();
    const program=`import json,sys,tempfile,os,contextlib,io\nfrom robot import run\ndata=json.load(sys.stdin)\nwith tempfile.TemporaryDirectory(prefix='lvx_robot_regression_') as folder:\n    library=os.path.join(folder,'BrowserLibrary.py')\n    with open(library,'w',encoding='utf8') as f:\n        f.write('import os\\nclass BrowserLibrary:\\n    def click_element(self, selector):\\n        assert selector == "#submit", repr(selector)\\n    def input_text(self, selector, text):\\n        assert selector == "#text", repr(selector)\\n        assert text == os.environ["LVX_EXPECT_TEXT"], repr(text)\\n')\n    for index,code in enumerate(data):\n        suite=os.path.join(folder,'suite'+str(index)+'.robot')\n        with open(suite,'w',encoding='utf8') as f: f.write(code)\n        capture=io.StringIO()\n        result=run(suite,pythonpath=[folder],dryrun=True,output=None,log=None,report=None,stdout=capture,stderr=capture)\n        assert result == 0, capture.getvalue()\n        if index != 1:\n            result=run(suite,pythonpath=[folder],output=None,log=None,report=None,stdout=capture,stderr=capture)\n            assert result == 0, capture.getvalue()\nprint('ROBOT_DRYRUN_AND_LITERAL_EXECUTION_OK')\n`;
    const result=spawnSync(pythonRuntime(),['-c',program],{input:JSON.stringify([browser,universal,visual]),encoding:'utf8',timeout:20000,env:{...process.env,PYTHONPATH:[path.join(root,'.external','python-test-packages'),path.join(root,'.external','python-runtime-packages'),path.join(root,'.external','python-packages')].join(path.delimiter),LVX_EXPECT_TEXT:expected}});
    assert.equal(result.status,0,result.stdout+'\n'+result.stderr);assert.match(result.stdout,/ROBOT_DRYRUN_AND_LITERAL_EXECUTION_OK/);
});
test('B21: Monaco completion snippets retain complete keywords and separate every argument cell',()=>{
    const h=harness(['monaco-config.js']);let provider;
    h.context.monaco={languages:{registerCompletionItemProvider:(language,value)=>{if(language==='robotframework')provider=value;},CompletionItemKind:{Keyword:1,Function:2,Snippet:3},CompletionItemInsertTextRule:{InsertAsSnippet:4}}};
    h.context.setupAutoCompletion();
    const suggestions=provider.provideCompletionItems({getWordUntilPosition:()=>({startColumn:1,endColumn:1})},{lineNumber:1}).suggestions;
    assert.equal(suggestions.find(s=>s.label==='Click Element').insertText,'Click Element    ${1:selector}');
    assert.equal(suggestions.find(s=>s.label==='Library').insertText,'Library    ${1:BrowserLibrary}');
    assert.equal(suggestions.find(s=>s.label==='Input Text').insertText,'Input Text    ${1:selector}    ${2:text}');
});

test('B21 integration: browser-only generator never drops native-only steps',()=>{
    const h=harness(['nocode-builder.js']);
    const step={name:'Go To URL',params:{url:'https://example.invalid'}};
    assert.match(h.context.ncbGenerateStep(step,true),/    Fail    /);
    assert.match(h.context.ncbGenerateStep(step,false),/    Go To    /);
});
test('B16: collaboration IDs are unique and awaited canonical version rendering leaves standalone versions intact',async()=>{
    const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
    for(const id of ['import-file-input','collab-import-file-input','versions-list','collab-versions-list']) {
        const matches=Array.from(html.matchAll(/\bid\s*=\s*['"]([^'"]+)['"]/g)).filter(match=>match[1]===id);
        assert.equal(matches.length,1,`${id} must identify exactly one control`);
    }
    assert.match(html,/getElementById\((?:"|&quot;)collab-import-file-input(?:"|&quot;)\)\.click/);
    const h=harness(['collaboration-ui2.js']);
    h.context.document.getElementById('versions-list').innerHTML='standalone-preserved';
    h.context.collaborationManager={getVersionHistory:async()=>[{id:'v',version:2,description:'collaboration-marker <img src=x onerror=alert(1)>',createdBy:'<b>fixture</b>',createdAt:new Date().toISOString()}]};
    await h.context.renderVersionHistory('suite');const rendered=h.context.document.getElementById('collab-versions-list').innerHTML;assert.match(rendered,/collaboration-marker/);assert.doesNotMatch(rendered,/<img|<b>/);assert.match(rendered,/&lt;img/);
    assert.equal(h.context.document.getElementById('versions-list').innerHTML,'standalone-preserved');
});
test('B13/B14: visual pipeline uses isolated broker, preserves assertions and closes every session',async()=>{
    const h=harness(['advanced-assertions.js','visual-web-tester.js']);let closed=0,fail=true;
    h.context.document.body.appendChild=()=>{};
    h.context.electronAPI={previewOps:{invoke:async(action,payload)=>{
        if(action==='open')return {id:'isolated-session',html:'<input>'};
        if(action==='close'){assert.equal(payload.id,'isolated-session');closed++;return {closed:true};}
        assert.equal(action,'step');assert.equal(payload.name,'Check Accessibility');
        return fail?{__lvxError:{code:'ASSERTION_FAILED',message:'Accessibility errors found'}}:{html:'<input aria-label="Name">',logs:['Accessibility passed']};
    }}};
    const suite={name:'pipeline fixture',website_html_content:'<input>',vwt_steps_json:JSON.stringify([{name:'Check Accessibility',params:{}}])};
    const result=await h.context.vwt_executeSuite(suite);assert.equal(result.status,'FAILURE');assert.match(result.error,/Accessibility errors found/);assert.equal(closed,1);
    fail=false;assert.equal((await h.context.vwt_executeSuite(suite)).status,'SUCCESS');assert.equal(closed,2);
    delete h.context.electronAPI;assert.equal((await h.context.vwt_executeSuite(suite)).status,'ERROR');
});

test('B19: exact image comparison detects one-channel and alpha-only differences',async()=>{
    const h=harness(['advanced-assertions.js']);const a=h.context.advancedAssertions;
    a.loadImage=async key=>({width:1,height:1,key});
    a.imageToCanvas=image=>({getContext:()=>({getImageData:()=>({data:image.key==='first'?[10,10,10,255]:[10,10,10,254]})})});
    h.context.document.createElement=()=>({getContext:()=>({createImageData:()=>({data:[0,0,0,0]}),putImageData(){}}),toDataURL:()=> 'data:fixture'});
    assert.equal((await a.compareImages('first','second',0)).diffPercentage,100);
    assert.equal((await a.compareImages('first','first',0)).diffPercentage,0);
});
test('B18: debugger retains error status and failure details after cleanup',async()=>{
    const h=harness(['debugger.js','visual-web-tester.js']);
    h.run('vwt_steps = [{name:"Click Element",params:{selector:"#missing"}}]; vwt_files.html="<html></html>"');
    const frame=h.context.document.getElementById('vwt-iframe');frame.contentWindow={document:{querySelector:()=>null}};
    h.context.electronAPI={previewOps:{invoke:async(action)=>action==='open'?{id:'debug-negative',html:'<html></html>'}:action==='step'?{__lvxError:{code:'ASSERTION_FAILED',message:'Element not found'}}:{closed:true}}};h.context.displayDebugError=()=>{};
    const run=h.context.runTestInDebugMode();await new Promise(resolve=>setImmediate(resolve));h.context.testDebugger.resume();await run;
    assert.match(h.context.document.getElementById('debug-status').innerHTML,/Error/);
    assert.match(h.context.testDebugger.getLastError().message,/Element not found/);
});

test('B16: version loading preserves latest selection and exposes canonical storage failures',async()=>{
 const h=harness(['collaboration-ui2.js']);let finishFirst;
 h.context.collaborationManager={getVersionHistory:id=>id==='slow'?new Promise(resolve=>finishFirst=resolve):Promise.resolve([{id:'latest',version:2,description:'latest selection',createdBy:'fixture',createdAt:new Date().toISOString()}])};
 const slow=h.context.renderVersionHistory('slow');await h.context.renderVersionHistory('latest');finishFirst([{id:'old',version:1,description:'stale selection',createdBy:'fixture',createdAt:new Date().toISOString()}]);await slow;
 const element=h.context.document.getElementById('collab-versions-list');assert.match(element.innerHTML,/latest selection/);assert.doesNotMatch(element.innerHTML,/stale selection/);
 h.context.collaborationManager.getVersionHistory=async()=>{throw Error('fixture storage unavailable');};await h.context.renderVersionHistory('failed');assert.match(element.textContent,/fixture storage unavailable/);assert.equal(element.getAttribute('role'),'alert');
});
