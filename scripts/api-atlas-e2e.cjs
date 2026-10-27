'use strict';
// Real Electron renderer + IPC + SQLite + native workflow + loopback HTTP.
// API descriptions and imported tests are in-memory fixtures, never project saves.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const packageDirectory = process.env.LVX_PACKAGE_DIR || path.join(root, 'release/win-unpacked');

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-api-atlas-e2e-'));
  const workspace = path.join(temporary, 'project');
  const output = path.join(root, 'output/api-atlas');
  fs.mkdirSync(workspace); fs.mkdirSync(output, { recursive: true });
  const requests = [], checks = [], errors = [];
  let app, page, failure = '', wrongStatus = false, wrongSchema = false;
  const server = http.createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    requests.push({ url: request.url, method: request.method });
    response.setHeader('content-type', 'application/json');
    response.setHeader('x-contract-version', 'v1');
    if (request.url === '/slow') {
      const timer = setTimeout(() => response.end('{"id":42,"state":"ready"}'), 8000);
      response.once('close', () => clearTimeout(timer));
      return;
    }
    response.statusCode = wrongStatus ? 503 : 200;
    response.end(JSON.stringify({ id: wrongSchema ? 'wrong type' : 42, state: 'ready' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const check = (name, passed) => { assert.ok(passed, name); checks.push(name); console.log('PASS ' + name); };
  const invoke = (domain, action, payload = {}) => page.evaluate(({ domain, action, payload }) => electronAPI.studioOps.invoke(domain, action, payload), { domain, action, payload: { ...payload, workspaceRoot: workspace } });
  const readAtlas = () => invoke('workspace', 'read', { collection: 'api-atlas', id: 'workspace' });
  const list = async collection => { const result = await invoke('workspace', 'list', { collection }); return result.records || result || []; };
  const open = async name => { await page.evaluate(name => LVXStudio.open(name), name); await page.locator(name === 'apiAtlas' ? '.aa-workspace' : name === 'githubActions' ? '.gw-workspace' : '.studio-workspace').first().waitFor(); };
  const settled = () => page.waitForFunction(() => document.querySelector('[data-aa="scan"]') && !document.querySelector('[data-aa="scan"]').disabled);
  const action = name => page.locator('button[data-aa="' + name + '"]');
  const chooseEndpoint = async route => {
    if (await action('close-section').count()) await action('close-section').click();
    if (!await page.locator('.aa-browser').evaluate(el => el.open)) await page.locator('.aa-browser>summary').click();
    await action('endpoint').filter({ hasText: route }).click();
  };
  const row = id => page.locator('tr').filter({ has: page.locator('[data-aa="run"][data-test="' + id + '"]') });
  const resize = async (width, height) => {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
    await page.setViewportSize({ width, height });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const shot = async name => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForTimeout(150);
    const pixels = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
    const bytes = Buffer.from(pixels, 'base64'); assert.ok(bytes.length > 1000, 'Native screenshot has rendered pixels');
    fs.writeFileSync(path.join(output, name + (packaged ? '-packaged' : '-source') + '.png'), bytes);
  };
  const saveDraft = async name => {
    const editor = page.locator('.aa-editor');
    if (name) await editor.locator('[name="name"]').fill(name);
    await editor.getByRole('button', { name: 'Save and apply test', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    assert.equal(await editor.count(), 0, 'Saving test succeeds: ' + await page.locator('.aa-notice').innerText());
    await settled();
  };
  const runSaved = async (id, status) => {
    const before = (await list('api-atlas-runs')).length;
    if (await action('close-section').count()) await action('close-section').click();
    await page.locator('[data-aa="run"][data-test="' + id + '"]').click();
    await settled();
    await row(id).locator('[data-status="' + status + '"]').waitFor();
    const runs = await list('api-atlas-runs');
    assert.equal(runs.length, before + 1, 'Each click saves exactly one fresh run');
    const result = runs.map(record => record.value).find(run => run.testId === id && run.status === status);
    await chooseEndpoint('/orders');
    return result;
  };
  const terminal = async id => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const run = await invoke('execution', 'getRun', { id });
      if (['SUCCESS', 'FAILURE', 'ERROR', 'CANCELLED'].includes(run.status)) return run;
      await new Promise(resolve => setTimeout(resolve, 75));
    }
    throw Error('Native API workflow did not finish within 30 seconds.');
  };
  try {
    if (packaged) require('./package-manifest.cjs').verifyPackage();
    const env = { ...process.env, LVX_TEST_USER_DATA: path.join(temporary, 'profile'), LVX_TEST_HIDDEN: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ ...(packaged ? { executablePath: path.join(packageDirectory, 'LVX Test Studio.exe') } : { args: [root] }), cwd: root, env });
    page = await app.firstWindow(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
    await resize(1600, 1100);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => window.LVXStudioInitialized === true);
    await app.evaluate(({ dialog }, workspace) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] }); }, workspace);
    await page.evaluate(async () => { await electronAPI.studioOps.chooseWorkspace(); await electronAPI.studioOps.invoke('security', 'trust', { trusted: true }); await LVXApp.useStorage(LVXWorkspaceBridge.createBackend()); });

    const schema = { type: 'object', required: ['id', 'state'], properties: { id: { type: 'integer' }, state: { type: 'string' } }, additionalProperties: false };
    const document = (title, apiPath) => ({ openapi: '3.0.3', info: { title, version: '1.0.0' }, servers: [{ url: origin }], paths: { [apiPath]: { get: { summary: title === 'Orders' ? 'Read an order' : 'Check checkout health', responses: { 200: { description: 'Healthy', content: { 'application/json': { schema } } } } } } } });
    const workflow = 'name: API service CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo Verify service\n';
    const fixtureFile = (filePath, content, kind = 'source') => ({ path: filePath, content: typeof content === 'string' ? content : JSON.stringify(content), originalContent: typeof content === 'string' ? content : JSON.stringify(content), kind });
    const repo = (id, title, apiPath, files = []) => ({ id, fullName: 'fixture/' + id, ref: 'main', commit: 'a'.repeat(40), example: true, selected: '.github/workflows/ci.yml', workflows: [{ path: '.github/workflows/ci.yml', source: workflow }], files: [fixtureFile('.github/workflows/ci.yml', workflow, 'workflow'), fixtureFile('openapi.json', document(title, apiPath)), ...files] });
    const postman = { info: { name: 'Order API smoke', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [{ name: 'Postman order smoke', request: { method: 'GET', url: origin + '/orders' } }] };
    const pact = { consumer: { name: 'Checkout' }, provider: { name: 'Orders' }, interactions: [{ description: 'Pact exact order', request: { method: 'GET', path: '/orders' }, response: { status: 200, body: { id: 42, state: 'ready' }, headers: { 'x-contract-version': 'v1' } } }] };
    const repositories = [repo('orders', 'Orders', '/orders', [fixtureFile('pacts/checkout-orders.json', pact)]), repo('checkout', 'Checkout', '/health', [fixtureFile('src/client.js', `fetch('${origin}/orders');`), fixtureFile('order.postman_collection.json', postman)])];
    await invoke('workspace', 'transact', { records: [{ collection: 'github-workflow-views', id: 'repository-lanes', expectedRevision: null, value: { version: 1, repositories } }] });
    await open('apiAtlas');
    check('Opening a new API workspace does not contact any endpoint', requests.length === 0);
    await action('scan').click(); await settled();
    let saved = await readAtlas();
    check('Real scan saves two repository services, endpoints and source/Pact connections', saved.value.atlas.services.length === 2 && saved.value.atlas.endpoints.length === 2 && saved.value.atlas.connections.length === 2 && saved.value.atlas.connections.every(connection => connection.target === 'orders'));
    check('Scanning imports Postman/Pact candidates without executing HTTP', saved.value.atlas.candidates.length === 2 && requests.length === 0);
    const orderEndpoint = saved.value.atlas.endpoints.find(endpoint => endpoint.path === '/orders');
    await chooseEndpoint('/health'); await action('close-section').click();
    const providerEdge = page.locator('.aa-network-edge[data-connection="' + saved.value.atlas.connections.at(-1).id + '"]');
    await providerEdge.scrollIntoViewIfNeeded();
    const hit = await providerEdge.evaluate(el => { const path=el.querySelector('.aa-edge-hit'),matrix=path.getScreenCTM(),length=path.getTotalLength(); for(let t=.1;t<.95;t+=.06){const p=path.getPointAtLength(length*t).matrixTransform(matrix);if(document.elementFromPoint(p.x,p.y)?.closest('.aa-network-edge')===el)return{x:p.x,y:p.y};}throw Error('No visible dependency hit area');});
    await page.mouse.click(hit.x,hit.y);
    check('Clicking an API connection opens the matched provider endpoint bubble', await page.locator('.aa-bubble .aa-inspector>header code').innerText() === '/orders' && await page.locator('[data-aa="endpoint"][data-endpoint="' + orderEndpoint.id + '"]').getAttribute('aria-pressed') === 'true');
    await chooseEndpoint('/health'); await action('close-section').click();
    await providerEdge.focus(); await page.keyboard.press('Enter');
    check('The service dependency graph supports keyboard endpoint selection', await page.locator('.aa-bubble .aa-inspector>header code').innerText() === '/orders');
    check('Keyboard graph activation moves focus to the named bubble heading', await page.evaluate(() => document.activeElement?.isConnected && document.activeElement.id === 'aa-bubble-title'));
    await page.keyboard.press('Tab');
    check('Tab continues from the heading to a meaningful control', await page.evaluate(() => document.activeElement?.isConnected && document.activeElement !== document.body && document.activeElement.matches('button,input,select,textarea,summary,a,[role="button"]')));

    await action('new').click(); await saveDraft('Orders API response');
    let apiTest = (await readAtlas()).value.tests.find(item => item.name === 'Orders API response');
    check('Visual API editor saves a real endpoint test in project SQLite', apiTest.kind === 'api' && apiTest.endpointId === orderEndpoint.id && apiTest.url === origin + '/orders');
    const positive = await runSaved(apiTest.id, 'PASSED');
    check('Saved API test makes a real HTTP request and keeps status assertion evidence', positive.checks.some(item => item.name === 'HTTP status' && item.passed) && requests.length === 1);
    wrongStatus = true; await runSaved(apiTest.id, 'FAILED'); wrongStatus = false;
    await runSaved(apiTest.id, 'PASSED');
    check('API tests rerun and retain both failed and successful run history', (await list('api-atlas-runs')).filter(record => record.value.testId === apiTest.id).length === 3);

    await action('tab-contract').click(); await action('new').click();
    check('Contract editor starts with the actual discovered response schema', JSON.parse(await page.locator('.aa-editor [name="schema"]').inputValue()).required.includes('id'));
    const actualSchema = await page.locator('.aa-editor [name="schema"]').inputValue();
    await page.locator('.aa-editor [name="schema"]').fill('{"type":"object","unsupportedAssertion":true}');
    await page.locator('.aa-editor button[type="submit"]').click();
    await page.waitForFunction(() => /unsupportedAssertion|unknown keyword/.test(document.querySelector('.aa-notice')?.textContent));
    check('Invalid contracts remain editable and cannot be saved as passing tests', await page.locator('.aa-editor [name="schema"]').inputValue() === '{"type":"object","unsupportedAssertion":true}' && (await readAtlas()).value.tests.length === 1 && /unsupportedAssertion|unknown keyword/.test(await page.locator('.aa-editor-notice[role="alert"]').innerText()));
    await page.locator('.aa-editor [name="schema"]').fill(actualSchema);
    await saveDraft('Orders response contract');
    const contractTest = (await readAtlas()).value.tests.find(item => item.name === 'Orders response contract');
    await runSaved(contractTest.id, 'PASSED');
    wrongSchema = true; const failedContract = await runSaved(contractTest.id, 'FAILED'); wrongSchema = false;
    check('Wrong provider response types produce real contract violations', failedContract.checks.some(item => item.name === 'Response JSON schema' && !item.passed && item.violations.length));
    await runSaved(contractTest.id, 'PASSED');

    await page.locator('.aa-imports article').filter({ hasText: 'Postman order smoke' }).getByRole('button', { name: 'Review imported test' }).click();
    check('Postman import opens a reviewable request before saving', await page.locator('.aa-editor [name="url"]').inputValue() === origin + '/orders');
    await saveDraft('Reviewed Postman smoke');
    await page.locator('.aa-imports article').filter({ hasText: 'Pact exact order' }).getByRole('button', { name: 'Review imported test' }).click();
    check('Pact import exposes exact expected response body and headers', JSON.parse(await page.locator('.aa-editor [name="expectedBody"]').inputValue()).id === 42 && JSON.parse(await page.locator('.aa-editor [name="expectedHeaders"]').inputValue())['x-contract-version'] === 'v1');
    await saveDraft('Reviewed Pact interaction');
    const beforeAll = (await list('api-atlas-runs')).length;
    await action('close-section').click(); await action('run-all').click(); await settled(); await chooseEndpoint('/orders');
    check('Run all executes all four API/contract/imported saved tests', (await list('api-atlas-runs')).length === beforeAll + 4 && (await readAtlas()).value.tests.length === 4);
    check('Saved test action labels remain readable on one line', await page.locator('.aa-row-actions button').evaluateAll(buttons => buttons.every(button => { const range = document.createRange(); range.selectNodeContents(button); return range.getClientRects().length === 1; })));

    await resize(1600, 1100); await page.locator('.aa-workspace').scrollIntoViewIfNeeded(); await shot('api-map-desktop');
    await page.evaluate(() => { document.body.classList.add('theme-dark'); document.body.dataset.theme = 'dark'; });
    check('Dark API panels apply the dark surface and readable foreground', await page.locator('.aa-bubble').evaluate(element => { const style = getComputedStyle(element); return style.backgroundColor !== 'rgb(244, 248, 255)' && getComputedStyle(element.closest('.aa-workspace')).color !== 'rgb(23, 47, 73)'; }));
    await shot('api-map-dark');
    await resize(700, 1000); await page.locator('.aa-workspace').scrollIntoViewIfNeeded();
    check('Narrow map stays within its viewport and stacks inspector below services', await page.locator('.aa-workspace').evaluate(element => { const bubble = element.querySelector('.aa-bubble').getBoundingClientRect(), map = element.querySelector('.aa-map').getBoundingClientRect(), inspector = element.querySelector('.aa-inspector').getBoundingClientRect(); return bubble.left >= 0 && bubble.right <= innerWidth && inspector.top >= map.bottom - 2 && map.width > 200; }));
    await shot('api-map-narrow');
    await page.locator('.aa-inspector').scrollIntoViewIfNeeded(); await shot('api-inspector-narrow');
    await resize(1600, 1100);
    await page.evaluate(() => { document.body.classList.remove('theme-dark'); document.body.dataset.theme = 'light'; });

    await open('githubActions'); await page.locator('.aa-lane-ports').nth(1).waitFor();
    check('Existing repository workflow lanes expose service API endpoint links', await page.locator('.gw-lane').count() === 2 && await page.locator('.aa-lane-ports [data-aa="lane-endpoint"]').count() === 2);
    await page.locator('.aa-lane-ports [data-aa="lane-endpoint"]').filter({ hasText: '/orders' }).click(); await page.locator('.aa-workspace').waitFor();
    check('Repository lane endpoint opens the shared saved API test dashboard', await page.locator('.aa-inspector>header code').innerText() === '/orders' && (await readAtlas()).value.tests.length === 4);
    await action('graph').click();
    await page.waitForFunction(() => LVXStudio.state.page === 'graph');
    const workflows = await list('workflows');
    let graph = workflows.map(record => record.value).find(value => value.name === 'API checks · GET /orders');
    check('Add to workflow saves actual native API and contract graph nodes', graph && graph.nodes.length === 4 && graph.nodes.every(node => node.data.apiAtlasEndpointId === orderEndpoint.id) && graph.nodes.some(node => node.type === 'api-contract') && graph.nodes.some(node => node.type === 'api-performance'));
    await page.locator('[data-id="api-' + apiTest.id + '"] .ve-node-config-btn').click();
    const nodeDialog = page.locator('.aa-node-dialog'); await nodeDialog.waitFor();
    await nodeDialog.locator('[name="url"]').fill(origin + '/orders?from=workflow-copy');
    await nodeDialog.locator('[name="expectedHeaders"]').fill('{"x-contract-version":"v1"}');
    await shot('workflow-api-copy-editor');
    await nodeDialog.getByRole('button', { name: 'Apply to workflow copy', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.aa-node-dialog') || document.querySelector('.aa-node-dialog [role="alert"]')?.textContent);
    assert.equal(await nodeDialog.count(), 0, 'Workflow API modal saves: ' + (await page.locator('.aa-node-dialog [role="alert"]').allTextContents()).join(' '));
    await nodeDialog.waitFor({ state: 'detached' });
    await page.locator('#ve-save-btn').click();
    await page.waitForFunction(async ({ workspace, id, url }) => {
      const record = await electronAPI.studioOps.invoke('workspace', 'read', { workspaceRoot: workspace, collection: 'workflows', id });
      return record.value.nodes.some(node => node.data.apiAtlasDefinition?.url === url);
    }, { workspace, id: graph.id, url: origin + '/orders?from=workflow-copy' });
    graph = (await invoke('workspace', 'read', { collection: 'workflows', id: graph.id })).value;
    check('Graph node editor saves the actual nested request and leaves the API map definition intact', graph.nodes.some(node => node.data.apiAtlasDefinition.url === origin + '/orders?from=workflow-copy' && node.data.apiAtlasDefinition.expectedHeaders['x-contract-version'] === 'v1') && (await readAtlas()).value.tests.find(test => test.id === apiTest.id).url === origin + '/orders');
    const nativeRun = await invoke('execution', 'runWorkflow', { workflow: graph });
    const nativeResult = await terminal(nativeRun.id);
    check('Native workflow runs the edited API request and contract definitions over HTTP', nativeResult.status === 'SUCCESS' && requests.some(request => request.url === '/orders?from=workflow-copy'));
    await page.waitForFunction(async ({ workspace, id }) => {
      const result = await electronAPI.studioOps.invoke('workspace', 'list', { workspaceRoot: workspace, collection: 'api-atlas-runs' });
      return (result.records || result).filter(record => record.value.workflowRunId === id).length === 4;
    }, { workspace, id: nativeRun.id });
    check('Native graph execution updates the shared endpoint run evidence', (await list('api-atlas-runs')).filter(record => record.value.workflowRunId === nativeRun.id).length === 4);
    wrongSchema = true;
    const failedNative = await terminal((await invoke('execution', 'runWorkflow', { workflow: graph })).id);
    wrongSchema = false;
    check('Native graph propagates contract failures instead of showing a passing run', ['FAILURE', 'ERROR'].includes(failedNative.status));
    await page.evaluate(() => LVXStudio.open('runs'));
    check('Unified Results exposes endpoint and workflow-copy history', await page.getByRole('heading', { name: 'API & contract test results', exact: true }).isVisible() && await page.locator('.aa-workspace').innerText().then(text => text.includes(nativeRun.id) && text.includes('Orders API response')));
    await page.getByRole('heading', { name: 'API & contract test results', exact: true }).scrollIntoViewIfNeeded();
    await shot('unified-api-results');

    await open('apiAtlas'); await settled();
    saved = await readAtlas();
    await invoke('workspace', 'transact', { records: [{ collection: 'api-atlas', id: 'workspace', expectedRevision: saved.revision, value: saved.value }] });
    const beforeStale = requests.length;
    await page.locator('[data-aa="run"][data-test="' + apiTest.id + '"]').click(); await settled();
    check('Stale test revisions refuse execution before contacting a service', requests.length === beforeStale && /changed in another window|reload/i.test(await page.locator('.aa-notice').innerText()));
    await page.locator('[data-aa="edit"][data-test="' + apiTest.id + '"]').click();
    await page.locator('.aa-editor [name="name"]').fill('Unsaved conflict draft');
    await page.locator('.aa-notice').evaluate(element => { element.textContent = ''; });
    await page.locator('.aa-editor button[type="submit"]').click();
    await page.waitForFunction(() => /another window|revision|conflict/i.test(document.querySelector('.aa-notice')?.textContent));
    check('A save revision conflict preserves the unsaved draft and canonical saved tests', await page.locator('.aa-editor [name="name"]').inputValue() === 'Unsaved conflict draft' && !(await readAtlas()).value.tests.some(test => test.name === 'Unsaved conflict draft') && /another window|revision|conflict/i.test(await page.locator('.aa-editor-notice[role="alert"]').innerText()));
    await open('apiAtlas'); await settled();
    await chooseEndpoint('/orders'); await action('tab-api').click(); await action('new').click();
    await page.locator('.aa-editor [name="url"]').fill(origin + '/slow'); await saveDraft('Cancellable endpoint');
    const cancellable = (await readAtlas()).value.tests.find(item => item.name === 'Cancellable endpoint');
    await action('close-section').click(); await page.locator('[data-aa="run"][data-test="' + cancellable.id + '"]').click(); await action('stop').waitFor({ state: 'visible' });
    const requestDeadline = Date.now() + 5000;
    while (!requests.some(request => request.url === '/slow') && Date.now() < requestDeadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(requests.some(request => request.url === '/slow'), 'Slow HTTP request actually started before cancellation');
    await action('stop').click(); await settled();
    await row(cancellable.id).locator('[data-status="CANCELLED"]').waitFor();
    check('Stop cancels in-flight HTTP work and persists a labelled cancellation', (await list('api-atlas-runs')).some(record => record.value.testId === cancellable.id && record.value.status === 'CANCELLED'));
    await page.reload(); await page.waitForFunction(() => window.LVXStudioInitialized === true); await open('apiAtlas'); await settled();
    check('Saved tests, endpoints and previous results survive a full renderer reload', (await readAtlas()).value.tests.length === 5 && await action('endpoint').count() === 2 && await page.locator('.aa-status[data-status="CANCELLED"]').count() === 1);
    check('No renderer exceptions', errors.length === 0);
    console.log('API_ATLAS_E2E_PASSED ' + checks.length + ' checks ' + (packaged ? 'packaged' : 'source'));
  } catch (error) {
    failure = error.stack;
    if (page) { console.error('API notice:', await page.locator('.aa-notice,.aa-editor-notice,.aa-node-dialog [role="alert"]').allTextContents().catch(() => [])); await shot('failure').catch(() => {}); }
    throw error;
  } finally {
    if (app) await app.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(output, 'last-' + (packaged ? 'packaged' : 'source') + '.log'), checks.map(name => 'PASS ' + name).join('\n') + '\n' + errors.join('\n') + '\n' + failure);
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
