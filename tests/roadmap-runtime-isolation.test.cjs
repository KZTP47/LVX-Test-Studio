'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createService, TERMINAL } = require('../services/execution/index.cjs');
const { createDriver } = require('../services/execution/robot-child.cjs');
const { pythonEnvironment } = require('../services/execution/python-environment.cjs');
const { createRedactor } = require('../services/execution/redaction.cjs');
const { pausedContext } = require('../services/execution/debug-context.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function harness(t, options = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-isolation-proof-'));
    const events = [], tempRoot = path.join(root, 'native-temp'), dataDir = path.join(root, 'state');
    const service = createService({ workspaceRoot: root, dataDir, tempRoot, emit: event => events.push(event), ...options });
    t.after(async () => { await service.close(); await sleep(100); fs.rmSync(root, { recursive: true, force: true }); });
    return { root, tempRoot, dataDir, events, service };
}
async function terminal(service, id, timeout = 20000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) { const run = await service.handle('getRun', { id }); if (TERMINAL.has(run.status)) return run; await sleep(20); }
    throw new Error('Native run did not terminate.');
}
function files(root) { return fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(root, entry.name)) : [path.join(root, entry.name)]) : []; }
function assertNoSecret(value, secret) {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    for (const representation of [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret), secret.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')]) assert.equal(serialized.includes(representation), false, 'Credential representation must not escape redaction.');
}
const secret = 'quoted"\\credential\nÅ<&value';
const credentials = { parameters: { key: { secretRef: 'secret:fixture' } }, parameterSchema: { key: { secret: true, required: true } } };

test('SECRETS native Python keeps quoted credentials/config/results off disk and deep-redacts artifacts/events', async t => {
    const h = await harness(t, { resolveSecret: async () => secret });
    const run = await h.service.handle('start', { engine: 'python', ...credentials, code: 'import json,time\nprint(parameters["key"])\nprint(json.dumps(parameters["key"],ensure_ascii=False))\nARTIFACTS={"nested":[{"value":parameters["key"]}],parameters["key"]:"key-redaction"}\ntime.sleep(0.4)' });
    await sleep(150);
    for (const file of files(h.tempRoot)) { assert.doesNotMatch(path.basename(file), /python-(config|result)/); assertNoSecret(fs.readFileSync(file, 'utf8'), secret); }
    const done = await terminal(h.service, run.id);
    assert.equal(done.status, 'SUCCESS', done.error || done.stderr);
    assert.equal(done.artifacts.nested[0].value, '[REDACTED]'); assert.ok(done.artifacts['[REDACTED]']);
    assertNoSecret(done, secret); assertNoSecret(h.events, secret);
    for (const file of files(h.dataDir)) assertNoSecret(fs.readFileSync(file, 'utf8'), secret);
    await sleep(50); assert.equal(files(h.tempRoot).length, 0);
});

test('SECRETS hard-cancelled and abruptly crashed native Python never leave credential temp files', async t => {
    const h = await harness(t, { resolveSecret: async () => secret });
    const started = await h.service.handle('start', { engine: 'python', ...credentials, code: 'print("ready",flush=True)\nwhile True: pass', timeoutMs: 10000 });
    const until = Date.now() + 3000;
    while (!(await h.service.handle('getRun', { id: started.id })).stdout.includes('ready') && Date.now() < until) await sleep(20);
    let heartbeat = false; setTimeout(() => { heartbeat = true; }, 0); await sleep(20); assert.equal(heartbeat, true);
    for (const file of files(h.tempRoot)) assertNoSecret(fs.readFileSync(file, 'utf8'), secret);
    const at = Date.now(); await h.service.handle('cancel', { id: started.id }); assert.ok(Date.now() - at < 2000);
    assert.equal(fs.readdirSync(h.tempRoot).length, 0, 'Cancel resolves only after its temporary directory is cleaned');
    const crashed = await h.service.handle('start', { engine: 'python', ...credentials, code: 'import os\nos._exit(7)' });
    const done = await terminal(h.service, crashed.id);
    assert.equal(done.status, 'ERROR'); assert.match(done.error, /terminal result/);
    await sleep(50); assert.equal(fs.readdirSync(h.tempRoot).length, 0);
    assertNoSecret(h.events, secret);
});

test('SECRETS JavaScript nested artifacts and UTF-8/split encoded log packets are redacted before persistence', async t => {
    const h = await harness(t, { resolveSecret: async () => secret });
    const run = await h.service.handle('start', { ...credentials, code: 'for(const byte of Buffer.from(parameters.key)){process.stdout.write(Buffer.from([byte]));await new Promise(r=>setTimeout(r,1));} console.log(JSON.stringify(parameters.key)); artifacts.secret={value:parameters.key};assert(true);' });
    const done = await terminal(h.service, run.id);
    assert.equal(done.status, 'SUCCESS'); assert.equal(done.artifacts.secret.value, '[REDACTED]');
    assertNoSecret(done, secret); assertNoSecret(h.events, secret);
    for (const file of files(h.dataDir)) assertNoSecret(fs.readFileSync(file, 'utf8'), secret);
    assert.match(done.stdout, /REDACTED/);
});

test('ROBOT native framework runs advanced syntax/setup/teardown and distinguishes failures, zero and unknown keywords', async t => {
    const h = await harness(t);
    const caps = await h.service.handle('capabilities');
    assert.equal(caps.engines.find(engine => engine.id === 'robot').available, true, 'Pinned Robot Framework must be discoverable in child PYTHONPATH.');
    const code = '*** Settings ***\nTest Setup    Set Test Variable    ${started}    yes\nTest Teardown    Log To Console    teardown-ran\n*** Test Cases ***\nNative syntax\n    FOR    ${i}    IN RANGE    3\n        IF    ${i} == 2\n            Should Be Equal    ${started}    yes\n        END\n    END\nSecond\n    Should Be Equal As Integers    2    2\n';
    const run = await h.service.handle('start', { engine: 'robot', code });
    const done = await terminal(h.service, run.id);
    assert.equal(done.status, 'SUCCESS', done.error || done.stderr); assert.equal(done.total, 2); assert.equal(done.passed, 2);
    assert.match(done.stdout, /teardown-ran/); assert.match(done.artifacts.robotOutputXml, /<robot/); assert.equal(done.cases.length, 2);
    for (const [code, status, total] of [['*** Test Cases ***\nNegative\n    Should Be Equal    left    right', 'FAILURE', 1], ['*** Settings ***\nDocumentation    No tests', 'ERROR', 0], ['*** Test Cases ***\nUnknown\n    Imaginary Unsupported Keyword', 'FAILURE', 1]]) {
        const started = await h.service.handle('start', { engine: 'robot', code }); const actual = await terminal(h.service, started.id);
        assert.equal(actual.status, status, actual.error || actual.stderr); assert.equal(actual.total, total);
    }
});

test('ROBOT BrowserLibrary uses real isolated Chromium and parent assertions; negative controls cannot become green', async t => {
    const h = await harness(t, { resolveSecret: async () => secret });
    const websiteHTML = '<input id="name"><button onclick="document.querySelector(\'output\').textContent=document.querySelector(\'input\').value">Go</button><output></output><div id="bridge"></div><script>document.querySelector("#bridge").textContent=typeof window.electronAPI</script>';
    const code = '*** Settings ***\nLibrary    BrowserLibrary\n*** Test Cases ***\nBrowser actions\n    Input Text    css=#name    Ada\n    Click Element    button\n    Wait For Element    output\n    Element Should Be Visible    output\n    Element Should Contain    output    Ada\n    Page Should Contain    Ada\n    ${text}=    Get Text    output\n    Should Be Equal    ${text}    Ada\n    Element Should Contain    css=#bridge    undefined\n';
    let run = await h.service.handle('start', { engine: 'robot', code, websiteHTML });
    let done = await terminal(h.service, run.id, 30000);
    assert.equal(done.status, 'SUCCESS', done.error || done.stderr || done.artifacts?.robotOutputXml);
    run = await h.service.handle('start', { engine: 'robot', code: code.replace('Element Should Contain    output    Ada', 'Element Should Contain    output    wrong'), websiteHTML });
    done = await terminal(h.service, run.id, 30000); assert.equal(done.status, 'FAILURE'); assert.equal(done.failed, 1);
    const logged = await h.service.handle('start', { engine: 'robot', ...credentials, code: '*** Test Cases ***\nSecret\n    Log To Console    ${key}\n    Should Not Be Empty    ${key}\n' });
    const evidence = await terminal(h.service, logged.id);
    assert.equal(evidence.status, 'SUCCESS', evidence.error || evidence.stderr); assertNoSecret(evidence, secret); assertNoSecret(h.events, secret);
    assert.match(evidence.stdout, /REDACTED/);
    const failedSecret = await h.service.handle('start', { engine: 'robot', ...credentials, code: '*** Test Cases ***\nSecret failure\n    Should Be Equal    ${key}    wrong\n' });
    const failure = await terminal(h.service, failedSecret.id);
    assert.equal(failure.status, 'FAILURE'); assertNoSecret(failure, secret); assert.match(failure.artifacts.robotOutputXml, /REDACTED/);
});

test('ROBOT authenticated keyword driver rejects unauthenticated, page-origin and unknown API requests', async t => {
    const driver = await createDriver({ websiteHTML: '<p>Driver fixture</p>' }); t.after(() => driver.close());
    const body = JSON.stringify({ name: 'Page Should Contain', args: ['Driver fixture'] });
    assert.equal((await fetch(driver.endpoint, { method: 'POST', body })).status, 403);
    assert.equal((await fetch(driver.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${driver.token}`, Origin: 'https://untrusted.example' }, body })).status, 403);
    const unknown = await fetch(driver.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${driver.token}` }, body: JSON.stringify({ name: 'Evaluate arbitrary JavaScript', args: ['true'] }) });
    assert.equal(unknown.status, 400); assert.match((await unknown.json()).error, /Unsupported/);
    assert.equal((await fetch(driver.endpoint.replace('/keyword', '/result'), { method: 'POST', headers: { Authorization: `Bearer ${driver.token}` }, body: '{}' })).status, 403);
});

test('ROBOT hard loop cancellation stops native Python tree and leaves parent responsive and temp clean', async t => {
    const h = await harness(t);
    const run = await h.service.handle('start', { engine: 'robot', code: '*** Test Cases ***\nLoop\n    Log To Console    robot-loop-ready\n    WHILE    True    limit=NONE\n        No Operation\n    END', timeoutMs: 10000 });
    const until = Date.now() + 3000;
    while (!(await h.service.handle('getRun', { id: run.id })).stdout.includes('robot-loop-ready') && Date.now() < until) await sleep(20);
    let responsive = false; setTimeout(() => { responsive = true; }, 0); await sleep(10); assert.equal(responsive, true);
    const before = Date.now(); await h.service.handle('cancel', { id: run.id }); assert.ok(Date.now() - before < 2000);
    assert.equal((await h.service.handle('getRun', { id: run.id })).status, 'CANCELLED');
    await sleep(80); assert.equal(fs.readdirSync(h.tempRoot).length, 0);
});

test('RUNTIME package discovery is scoped per child and escaped secret redaction remains valid JSON', () => {
    const before = process.env.PYTHONPATH;
    const env = pythonEnvironment(); assert.ok(env.PYTHONPATH.includes('python-')); assert.equal(process.env.PYTHONPATH, before);
    const { redact, add } = createRedactor(); add(secret);
    const value = redact({ [secret]: ['prefix ' + secret, { nested: secret }] });
    assert.deepEqual(JSON.parse(JSON.stringify(value)), { '[REDACTED]': ['prefix [REDACTED]', { nested: '[REDACTED]' }] });
});

test('CONFIG portable execution configuration preserves fixture versions, isolates workspaces and disables restored schedules', async t => {
    const h = await harness(t);
    const fixture = await h.service.handle('saveFixture', { name: 'Native fixture', engine: 'python', setup: 'fixture["ready"]=True' });
    const second = await h.service.handle('saveFixture', { id: fixture.id, name: 'Native fixture', engine: 'python', setup: 'fixture["ready"]=2' });
    const workflow = { schemaVersion: 1, nodes: [{ id: 'proof', type: 'script', data: { name: 'Proof', engine: 'python', code: 'assert fixture["ready"]==2', fixtureId: second.id, fixtureVersion: 2 } }], edges: [] };
    await h.service.handle('saveSchedule', { name: 'Restored only with consent', workflow, intervalMs: 60000, missedRun: 'skip', enabled: true });
    const portable = await h.service.handle('exportConfiguration');
    assert.deepEqual(portable.fixtures.map(item => item.version), [1, 2]);
    assert.equal(JSON.stringify(portable).includes(h.root.replaceAll('\\', '\\\\')), false);
    assert.equal('workspaceRoot' in portable.schedules[0], false);
    assert.equal((await h.service.handle('validateConfiguration', { configuration: portable })).valid, true);
    const other = path.join(h.root, 'other-workspace'); fs.mkdirSync(other);
    h.service.setWorkspace(other);
    assert.equal((await h.service.handle('exportConfiguration')).fixtures.length, 0);
    // Portable project-local IDs can be rebound without stealing A's timer.
    assert.equal((await h.service.handle('validateConfiguration', { configuration: portable })).valid, true);
    const destination = createService({ workspaceRoot: other, dataDir: path.join(h.root, 'restored-state') });
    t.after(() => destination.close());
    await destination.handle('importConfiguration', { configuration: portable });
    assert.deepEqual((await destination.handle('fixtures')).map(item => item.version), [1, 2]);
    assert.equal((await destination.handle('schedules'))[0].enabled, false);
    assert.equal((await destination.handle('schedules'))[0].workspaceRoot, other);
    const run = await destination.handle('start', { engine: 'python', fixtureId: fixture.id, fixtureVersion: 2, code: 'assert fixture["ready"]==2' });
    assert.equal((await terminal(destination, run.id)).status, 'SUCCESS');
});

test('CONFIG invalid/conflicting imports are all-or-nothing and resolved credentials are rejected', async t => {
    const h = await harness(t, { resolveSecret: async () => secret });
    const run = await h.service.handle('start', { engine: 'python', ...credentials, code: 'assert len(parameters["key"])>0' });
    assert.equal((await terminal(h.service, run.id)).status, 'SUCCESS');
    await h.service.handle('saveFixture', { id: 'existing', name: 'Original', engine: 'python', setup: 'pass' });
    const original = await h.service.handle('exportConfiguration');
    const invalid = structuredClone(original);
    invalid.fixtures.push({ id: 'new', version: 1, name: 'Would partially import', engine: 'python', setup: '', cleanup: '' });
    invalid.fixtures[0].setup = 'changed immutable body';
    const preview = await h.service.handle('validateConfiguration', { configuration: invalid });
    assert.equal(preview.valid, false); assert.match(preview.errors.join(' '), /conflict/);
    await assert.rejects(h.service.handle('importConfiguration', { configuration: invalid }), { code: 'CONFIGURATION_INVALID' });
    assert.deepEqual(await h.service.handle('exportConfiguration'), original);
    const leaking = structuredClone(original); leaking.fixtures[0].setup = `print(${JSON.stringify(secret)})`;
    assert.equal((await h.service.handle('validateConfiguration', { configuration: leaking })).valid, false);
});

test('WORKSPACE workflows/runs/fixtures cannot be read, debugged, reused or cancelled from another workspace', async t => {
    const h = await harness(t);
    const fixture = await h.service.handle('saveFixture', { name: 'Private setup', engine: 'javascript', setup: 'fixture.value=9;' });
    const workflow = { schemaVersion: 1, nodes: [{ id: 'proof', type: 'script', data: { name: 'Private workflow', engine: 'javascript', code: 'assert(true);' } }], edges: [] };
    const run = await h.service.handle('runWorkflow', { workflow });
    const done = await terminal(h.service, run.id);
    assert.equal(done.workspaceRoot, h.root); assert.equal(done.status, 'SUCCESS');
    const other = path.join(h.root, 'other'); fs.mkdirSync(other); h.service.setWorkspace(other);
    assert.deepEqual(await h.service.handle('runs'), []);
    assert.deepEqual(await h.service.handle('fixtures'), []);
    assert.equal((await h.service.handle('exportWorkflow', { workflow })).fixtures.length, 0);
    for (const action of ['getRun', 'debug', 'cancel']) await assert.rejects(h.service.handle(action, { id: run.id, command: 'variables' }), /selected workspace/);
    await assert.rejects(h.service.handle('start', { code: 'assert(true);', fixtureId: fixture.id }), /not found/);
    h.service.setWorkspace(h.root);
    assert.ok((await h.service.handle('runs')).some(item => item.id === run.id));
    assert.equal((await h.service.handle('fixtures'))[0].id, fixture.id);
});

test('SECRETS report-writing native frameworks reject vault parameters before resolution and retain ordinary support', async t => {
    let resolutions = 0;
    const h = await harness(t, { resolveSecret: async () => { resolutions++; return secret; } });
    for (const engine of ['jest', 'junit', 'nunit', 'pytest']) await assert.rejects(h.service.handle('start', { engine, ...credentials }), /writes reports to disk/);
    assert.equal(resolutions, 0);
    const caps = await h.service.handle('capabilities');
    assert.equal(caps.engines.find(engine => engine.id === 'pytest').secretParameters, false);
    assert.equal(caps.engines.find(engine => engine.id === 'robot').secretParameters, true);
});

test('CONFIG restoring empty schedules removes old timers, while fixture-only bundle imports preserve them', async t => {
    const h = await harness(t);
    const workflow = { schemaVersion: 1, nodes: [{ id: 'proof', type: 'script', data: { name: 'Proof', engine: 'javascript', code: 'assert(true);' } }], edges: [] };
    const fixture = await h.service.handle('saveFixture', { name: 'Dependency', engine: 'javascript', setup: 'fixture.ready=true;' });
    const dependent = structuredClone(workflow); dependent.nodes[0].data.fixtureId = fixture.id;
    const bundle = await h.service.handle('exportWorkflow', { workflow: dependent });
    await h.service.handle('saveSchedule', { name: 'Existing schedule', workflow, intervalMs: 60000, missedRun: 'skip', enabled: true });
    await h.service.handle('importWorkflow', { bundle, commit: true });
    assert.equal((await h.service.handle('schedules')).length, 1);
    const portable = await h.service.handle('exportConfiguration'); portable.schedules = [];
    await h.service.handle('importConfiguration', { configuration: portable });
    assert.equal((await h.service.handle('schedules')).length, 0);
});

test('SECRETS credential equal to SUCCESS cannot corrupt typed run metadata or spare nested artifact values', async t => {
    const h = await harness(t, { resolveSecret: async () => 'SUCCESS' });
    const run = await h.service.handle('start', { engine: 'python', ...credentials, code: 'print(parameters["key"])\nARTIFACTS={"status":parameters["key"],"nested":{"status":parameters["key"]}}' });
    const done = await terminal(h.service, run.id);
    assert.equal(done.status, 'SUCCESS', done.error || done.stderr);
    assert.equal(done.engine, 'python'); assert.equal(done.workspaceRoot, h.root);
    assert.equal(done.artifacts.status, '[REDACTED]'); assert.equal(done.artifacts.nested.status, '[REDACTED]');
    assert.match(done.stdout, /REDACTED/); assert.doesNotMatch(done.stdout, /SUCCESS/);
    assert.ok(h.events.some(event => event.type === 'run' && event.status === 'SUCCESS'));
    const stored = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'runs', `${run.id}.json`), 'utf8'));
    assert.equal(stored.status, 'SUCCESS'); assert.equal(stored.artifacts.status, '[REDACTED]');
});

test('CONFIG credential colliding with engine enum cannot rewrite fixture definitions or import schema metadata', async t => {
    const h = await harness(t, { resolveSecret: async () => 'python' });
    const run = await h.service.handle('start', { ...credentials, code: 'assert(parameters.key.length>0);' });
    assert.equal((await terminal(h.service, run.id)).status, 'SUCCESS');
    await h.service.handle('saveFixture', { name: 'Fixture', engine: 'python', setup: 'pass' });
    const exported = await h.service.handle('exportConfiguration');
    assert.equal(exported.fixtures[0].engine, 'python');
    assert.equal((await h.service.handle('validateConfiguration', { configuration: exported })).valid, true);
    await h.service.handle('importConfiguration', { configuration: exported });
    assert.equal((await h.service.handle('exportConfiguration')).fixtures[0].engine, 'python');
});

test('FW-05 runtime-only pauses expose actionable context without selecting Node timer scopes', () => {
    const runtime = { functionName: 'processTimers', url: 'node:internal/timers', location: { scriptId: 'runtime', lineNumber: 512, columnNumber: 3 }, scopeChain: [{ type: 'closure', object: { objectId: 'timer-internals' } }] };
    const client = { runId: 'proof', script: { scriptId: 'authored' }, paused: { callFrames: [runtime] } };
    const context = pausedContext(client, { lineOffset: 10, lines: 5 });
    assert.equal(context.pausedInRuntime, true); assert.equal(context.stepOverAvailable, false); assert.equal(context.selectedFrame, null);
    assert.match(context.message, /Resume or set an authored breakpoint/); assert.equal(context.frame.phase, 'runtime');
    const wrapper = { ...runtime, url: 'lvx-authored-proof.js', location: { scriptId: 'authored', lineNumber: 9, columnNumber: 1 } };
    client.paused.callFrames = [wrapper];
    assert.equal(pausedContext(client, { lineOffset: 10, lines: 5 }).selectedFrame, null);
});

test('FW-05 authored caller selection maps exact source lines and permits stepping only from authored top frame', () => {
    const runtime = { functionName: 'wait', url: 'node:timers', location: { scriptId: 'runtime', lineNumber: 22, columnNumber: 0 } };
    const authored = { functionName: 'scenario', url: 'lvx-authored-proof.js', location: { scriptId: 'authored', lineNumber: 12, columnNumber: 4 }, scopeChain: [{ type: 'local', object: { objectId: 'authored-locals' } }] };
    const client = { runId: 'proof', script: { scriptId: 'authored' }, paused: { callFrames: [runtime, authored] } };
    const source = { lineOffset: 10, lines: 5 };
    const caller = pausedContext(client, source);
    assert.equal(caller.selectedFrame, authored); assert.equal(caller.frame.line, 3); assert.equal(caller.pausedInRuntime, false); assert.equal(caller.stepOverAvailable, false);
    assert.match(caller.message, /Resume to an authored breakpoint/);
    client.paused.callFrames = [authored];
    const top = pausedContext(client, source);
    assert.equal(top.stepOverAvailable, true); assert.equal(top.message, null); assert.equal(top.frame.authored, true);
});

test('CONFIG A-to-B portable schedules keep scoped timer IDs, import idempotently and run only after explicit enable', async t => {
    const h = await harness(t);
    const fixture = await h.service.handle('saveFixture', { id: 'shared-fixture', name: 'Portable dependency', engine: 'javascript', setup: 'fixture.answer=19;' });
    const workflow = { schemaVersion: 1, nodes: [{ id: 'proof', type: 'script', data: { name: 'Portable proof', engine: 'javascript', code: 'assert(fixture.answer===19);', fixtureId: fixture.id, fixtureVersion: fixture.version } }], edges: [] };
    await h.service.handle('saveSchedule', { id: 'shared-schedule', name: 'Portable schedule', workflow, intervalMs: 60000, missedRun: 'skip', enabled: true });
    const original = await h.service.handle('exportConfiguration');
    const other = path.join(h.root, 'destination'); fs.mkdirSync(other);
    h.service.setWorkspace(other);
    assert.equal((await h.service.handle('validateConfiguration', { configuration: original })).valid, true);
    await h.service.handle('importConfiguration', { configuration: original });
    await h.service.handle('importConfiguration', { configuration: original });
    const restored = await h.service.handle('schedules');
    assert.equal(restored.length, 1); assert.equal(restored[0].id, 'shared-schedule'); assert.equal(restored[0].enabled, false); assert.equal(restored[0].workspaceRoot, other);
    assert.equal((await h.service.handle('fixtures')).length, 1);
    await sleep(100); assert.deepEqual(await h.service.handle('runs'), []);
    await h.service.handle('saveSchedule', { ...restored[0], enabled: true, nextRun: new Date(Date.now() + 150).toISOString() });
    let scheduled;
    for (const until = Date.now() + 15000; Date.now() < until;) {
        scheduled = (await h.service.handle('schedules'))[0];
        if (scheduled.lastRunId || scheduled.lastError) break;
        await sleep(25);
    }
    assert.equal(scheduled.lastError, null); assert.ok(scheduled.lastRunId, 'Explicitly enabled B schedule must actually arm and start');
    const done = await terminal(h.service, scheduled.lastRunId);
    assert.equal(done.status, 'SUCCESS', done.error); assert.equal(done.workspaceRoot, other);
    await h.service.handle('cancelSchedule', { id: scheduled.id });
    h.service.setWorkspace(h.root);
    assert.deepEqual(await h.service.handle('exportConfiguration'), original);
    assert.deepEqual(await h.service.handle('runs'), []);
});
