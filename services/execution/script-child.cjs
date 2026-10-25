'use strict';
// Authored code is deliberately executed in its own OS process. This is a
// cancellation boundary, not a sandbox: only a trusted workspace may run it.
const nodeAssert = require('node:assert/strict');
process.once('message', async config => {
    let capturedOutput='',capturedStderr='',outputOverflow=false;const stdoutWrite=process.stdout.write.bind(process.stdout),stderrWrite=process.stderr.write.bind(process.stderr);if(config.expectedOutput!=null){const capture=(stream,original)=>(chunk,...args)=>{if(!outputOverflow){if(stream==='stdout')capturedOutput+=String(chunk);else capturedStderr+=String(chunk);if(capturedOutput.length+capturedStderr.length>8*1024*1024){outputOverflow=true;capturedOutput=capturedStderr='';}}return original(chunk,...args);};process.stdout.write=capture('stdout',stdoutWrite);if(config.expectedOutputCombineStderr)process.stderr.write=capture('stderr',stderrWrite);}
    const result = { status: 'SUCCESS', total: 0, passed: 0, failed: 0, errors: 0, artifacts: {} };
    const counted = fn => (...args) => { result.total++; try { fn(...args); result.passed++; } catch (error) { result.failed++; throw error; } };
    const assert = counted((condition, message) => nodeAssert.ok(condition, message));
    const expect = actual => ({
        toBe: counted(expected => nodeAssert.equal(actual, expected)),
        toEqual: counted(expected => nodeAssert.deepEqual(actual, expected)),
        toBeTruthy: counted(() => nodeAssert.ok(actual)),
        toBeFalsy: counted(() => nodeAssert.ok(!actual)),
        toContain: counted(expected => nodeAssert.ok(actual?.includes(expected)))
    });
    let browser = null;
    const context = { ...(config.contextVariables || {}), contextVariables:config.contextVariables||{}, parameters: config.parameters || {}, inputs: config.inputs || {}, fixture: {}, artifacts: result.artifacts, assert, expect, require, process, console, setTimeout, clearTimeout, setInterval, clearInterval, Buffer, fetch };
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    try {
        if (config.engine === 'playwright') {
            const playwright = require(config.playwrightPath);
            browser = await playwright.chromium.launch({ headless: true });
            context.browser = browser; context.page = await browser.newPage();
        }
        const prelude = `with(context) { let cleanup = async()=>{}; try { cleanup=async()=>{${config.cleanup || ''}\n}; ${config.setup || ''}\n await(async()=>{\n${config.debug ? "process.send?.({type:'authoredReady'});\n" : ''}`;
        const source = `${prelude}${config.code || ''}\n})(); } catch(e) { report(e,false); } finally { try { await cleanup(); } catch(e) { report(e,true); } } }\n//# sourceURL=lvx-authored-${config.id}.js`;
        if(config.debug)process.send?.({type:'debugSource',lineOffset:prelude.split('\n').length+1,lines:String(config.code||'').split('\n').length});
        await new AsyncFunction('context', 'report', source)(context, (error, cleanup) => {
            if (cleanup || error?.code !== 'ERR_ASSERTION') result.errors++;
            result.status = result.errors ? 'ERROR' : 'FAILURE';
            process.stderr.write(`${cleanup ? 'Cleanup: ' : ''}${error.stack || error}\n`);
        });
    } catch (error) { result.status = 'ERROR'; result.errors++; process.stderr.write(`${error.stack || error}\n`); }
    finally { await browser?.close(); }
    if(config.expectedOutput!=null){const normalize=value=>{const text=String(value).replace(/\r\n/g,'\n').replace(/\r/g,'\n');return config.expectedOutputNormalize==='trim-end'?text.trimEnd():text.replace(/\n$/,'');};try{assert(!outputOverflow&&normalize(capturedOutput+capturedStderr)===normalize(config.expectedOutput),'Expected output must match actual stdout within the 8 MB limit.');}catch(error){if(result.status!=='ERROR')result.status='FAILURE';process.stderr.write(error.message+'\n');}}
    if (!result.total && !result.errors) { result.status = 'ERROR'; result.errors++; process.stderr.write('No assertions ran. Add an assertion to prove the expected outcome.\n'); }
    if (result.failed && result.status === 'SUCCESS') result.status = 'FAILURE';
    process.send?.({ type: 'result', result }, () => process.exit(result.status === 'SUCCESS' ? 0 : 1));
});
