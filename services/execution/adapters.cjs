'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pythonEnvironment } = require('./python-environment.cjs');
const ENGINES = ['javascript', 'playwright', 'python', 'robot', 'java', 'csharp', 'jest', 'junit', 'nunit', 'pytest'];
async function probe(command,args,env,acceptedCodes=[0],signal){
 try{const r=await require('../machina/process.cjs').runProcess(command,args,{env,signal,killTree:require('../process-control.cjs').stopProcessTree});return {available:acceptedCodes.includes(r.exitCode),version:String(r.stdout||r.stderr||'').trim(),command};}
 catch(error){if(signal?.aborted)throw error;return {available:false,version:error.message,command};}
}
async function capabilities(options = {}) {
    const p = options.runtimePaths || {};
    const node = await probe(p.node || options.nodeExecutable || process.execPath, ['--version'],undefined,[0],options.signal);
    const python = await probe(p.python || 'python', ['--version'],undefined,[0],options.signal);
    const java = await probe(p.java || 'java', ['-version'],undefined,[0],options.signal);
    const javac = await probe(p.javac || 'javac', ['-version'],undefined,[0],options.signal);
    const dotnet = await probe(p.dotnet || 'dotnet', ['--list-sdks'],undefined,[0],options.signal);
    dotnet.available = dotnet.available && /\d+\.\d+\.\d+/.test(dotnet.version);
    const jestPath = options.workspaceRoot && path.join(options.workspaceRoot, 'node_modules', 'jest', 'bin', 'jest.js');
    const junitJar = p.junitJar || null;
    let nunitProjectReady=false;
    if(options.workspaceRoot&&fs.existsSync(options.workspaceRoot)){
        for(const name of fs.readdirSync(options.workspaceRoot).filter(name=>name.endsWith('.csproj'))){
            const project=fs.readFileSync(path.join(options.workspaceRoot,name),'utf8');
            if(['Microsoft.NET.Test.Sdk','NUnit','NUnit3TestAdapter'].every(name=>new RegExp(`<PackageReference\\b[^>]*\\bInclude\\s*=\\s*["']${name.replaceAll('.','\\.')}["']`,'i').test(project)))nunitProjectReady=true;
        }
    }
    let playwrightAvailable=false,playwrightVersion='';
    try {
        const playwright=require('playwright');playwrightVersion=require('playwright/package.json').version;
        playwrightAvailable=fs.existsSync(playwright.chromium.executablePath());
        const resources=options.browserResourcePath||process.resourcesPath;
        const browserRoots=[...(p.browserRoot?[p.browserRoot]:[]),...(process.env.PLAYWRIGHT_BROWSERS_PATH?[process.env.PLAYWRIGHT_BROWSERS_PATH]:[resources&&path.join(resources,'playwright-browsers'),path.resolve(__dirname,'../../.external/playwright-browsers')])].filter(Boolean);
        for(const root of browserRoots)if(fs.existsSync(root))for(const folder of fs.readdirSync(root))if(/^chromium-\d+$/.test(folder))for(const executable of ['chrome-win64/chrome.exe','chrome-linux/chrome','chrome-linux64/chrome','chrome-mac/Chromium.app/Contents/MacOS/Chromium'])if(fs.existsSync(path.join(root,folder,executable)))playwrightAvailable=true;
    }catch{}
    const settled=await Promise.allSettled(ENGINES.map(async id => {
        let runtime = node, prerequisite = '';
        if (['python','pytest','robot'].includes(id)) runtime = python;
        if (['java','junit'].includes(id)) runtime = { ...java, available: java.available && javac.available };
        if (['csharp','nunit'].includes(id)) runtime = dotnet;
        const runtimeAvailable=runtime.available;
        if(id==='nunit')runtime={...dotnet,available:dotnet.available&&nunitProjectReady};
        if (id === 'playwright') runtime = {...node,available:node.available&&playwrightAvailable,version:playwrightVersion};
        if (id === 'jest') runtime = { ...node, available: node.available && !!jestPath && fs.existsSync(jestPath) };
        if (id === 'junit') runtime = { ...runtime, available: runtime.available && !!junitJar && fs.existsSync(junitJar) };
        if (id === 'pytest') runtime = await probe(p.python || 'python', ['-m', 'pytest', '--version'], pythonEnvironment({resourcePath:options.browserResourcePath}),[0],options.signal);
        if (id === 'robot') { runtime = await probe(p.python || 'python', ['-m', 'robot', '--version'], pythonEnvironment({resourcePath:options.browserResourcePath}), [0, 251],options.signal); runtime.available = runtime.available && /^Robot Framework \d/.test(runtime.version); runtime.browserAvailable = playwrightAvailable; }
        if (!runtime.available) prerequisite = ({playwright:'Run npm run setup to install the pinned Playwright Chromium browser.',jest:'Install Jest in the selected project (npm install --save-dev jest).',junit:'Install a JDK and configure runtimePaths.junitJar to a JUnit Platform Console Standalone JAR.',nunit:'Install .NET SDK and add Microsoft.NET.Test.Sdk, NUnit and NUnit3TestAdapter to your project.',pytest:'Install Python and pytest (python -m pip install pytest).',java:'Install a JDK including javac.',csharp:'Install .NET SDK.',python:'Install Python 3.'})[id] || 'Install Node.js.';
        if(id==='robot'&&!runtime.available)prerequisite='Install Python 3 and the pinned Robot Framework package. BrowserLibrary additionally requires bundled Chromium.';
        if(id==='nunit'&&dotnet.available&&!nunitProjectReady)prerequisite='Choose an NUnit project directory whose .csproj references Microsoft.NET.Test.Sdk, NUnit and NUnit3TestAdapter. Restore its packages before Run.';
        const secretParameters=!['jest','junit','nunit','pytest'].includes(id);
        return { id, ...runtime, runtimeAvailable, prerequisite, secretParameters, secretParametersPrerequisite:secretParameters?null:'This framework writes reports to disk. Vault-backed parameters require a memory-only JavaScript, Playwright, Python or Robot engine.', debugger: { pause: id === 'javascript', resume: id === 'javascript', stepOver: id === 'javascript', variables: id === 'javascript', breakpoints: id === 'javascript', reason: id === 'javascript' ? null : 'This adapter does not expose an interactive debugger. Use its native IDE debugger; cancellation and output are available here.' } };
    }));
    const failure=settled.find(item=>item.status==='rejected');if(failure)throw failure.reason;
    return {engines:settled.map(item=>item.value),runtimes:{node,python,java,javac,dotnet}};
}
function attributes(text) { const out = {}; for (const m of text.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)) out[m[1]] = m[2]; return out; }
function xmlText(text) { return String(text||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').trim(); }
function parseXML(text) {
    if (/<TestRun\b/.test(text)) {
        const m = text.match(/<Counters\s+([^>]+)>?/); if (!m) throw new Error('TRX report has no test counters.');
        const a = attributes(m[1]); const total = Number(a.total), passed = Number(a.passed || 0), failed = Number(a.failed || 0), pending = Number(a.notExecuted || 0), errors = Number(a.error || 0) + Number(a.aborted || 0);
        const result=finish({total,passed,failed,errors,pending});
        result.cases=[...text.matchAll(/<UnitTestResult\b([^>]*?)(?:\/>|>([\s\S]*?)<\/UnitTestResult>)/g)].map(match=>{const attrs=attributes(match[1]);return {name:attrs.testName||attrs.testId,status:attrs.outcome==='Passed'?'SUCCESS':attrs.outcome==='Failed'?'FAILURE':'ERROR',duration:attrs.duration||null,message:xmlText(match[2])};});return result;
    }
    const suites = [...text.matchAll(/<testsuite\b([^>]*)>/g)].map(m => attributes(m[1]));
    if (!suites.length) throw new Error('JUnit XML report has no test suites.');
    const result=finish(suites.reduce((r,a) => ({total:r.total+Number(a.tests||0),passed:0,failed:r.failed+Number(a.failures||0),errors:r.errors+Number(a.errors||0),pending:r.pending+Number(a.skipped||a.disabled||0)}), {total:0,passed:0,failed:0,errors:0,pending:0}), true);
    result.cases=[...text.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)].map(match=>{const attrs=attributes(match[1]),body=match[2]||'';return {name:attrs.name,className:attrs.classname||null,status:/<error\b/.test(body)?'ERROR':/<failure\b/.test(body)?'FAILURE':/<skipped\b/.test(body)?'PENDING':'SUCCESS',durationSeconds:Number(attrs.time||0),message:xmlText(body)};});return result;
}
function finish(r, derivePassed = false) {
    if (derivePassed) r.passed = r.total-r.failed-r.errors-r.pending;
    if (Object.values(r).some(n => !Number.isInteger(n) || n < 0) || r.passed+r.failed+(r.pending||0) > r.total) throw new Error('Invalid test counters in native report.');
    const accounted=r.passed+r.failed+r.errors+(r.pending||0);
    if(accounted<r.total)r.errors+=r.total-accounted;
    return { ...r, status: !r.total || r.errors || r.pending ? 'ERROR' : r.failed ? 'FAILURE' : 'SUCCESS' };
}
function parseJest(text) {
    const a = JSON.parse(text);
    const result=finish({ total: Number(a.numTotalTests), passed: Number(a.numPassedTests||0), failed: Number(a.numFailedTests||0), errors: Number(a.numRuntimeErrorTestSuites||0), pending: Number(a.numPendingTests||0)+Number(a.numTodoTests||0) });
    if(a.wasInterrupted||a.success===false&&result.status==='SUCCESS'){result.status='ERROR';result.errors++;}
    result.cases=(a.testResults||[]).flatMap(suite=>(suite.assertionResults||[]).map(item=>({name:item.fullName||item.title,file:suite.name,status:item.status==='passed'?'SUCCESS':item.status==='failed'?'FAILURE':item.status==='pending'||item.status==='todo'?'PENDING':'ERROR',durationMs:item.duration??null,messages:item.failureMessages||[]})));
    return result;
}
module.exports = { capabilities, parseXML, parseJest, finish, ENGINES };
