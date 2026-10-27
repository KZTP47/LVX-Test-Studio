'use strict';
// Real Electron, renderer, IPC and SQLite. Repository acquisition and the AI
// provider use labelled fixtures; no live GitHub or paid model request is sent.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..'), packaged = process.argv.includes('--packaged');
async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-board-api-repair-')), workspace = path.join(temporary, 'workspace'), output = path.join(root, 'output/board-api-repair');
  fs.mkdirSync(workspace); fs.mkdirSync(output, { recursive: true });
  const requests = [], errors = [], checks = [];
  const reply = '**Local fixture reply**\n\n| Repository | Evidence |\n|---|---|\n| Java | `GET /products` |\n| Platform | Two OpenAPI services |\n\n[Source](https://example.test/source)';
  const server = http.createServer(async (request, response) => { const chunks = []; for await (const chunk of request) chunks.push(chunk); requests.push(JSON.parse(Buffer.concat(chunks))); response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: reply } }] })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const check = (name, value) => { assert.ok(value, name); checks.push(name); console.log('PASS ' + name); };
  let app, page;
  const invoke = (domain, action, payload = {}) => page.evaluate(({ domain, action, payload }) => electronAPI.studioOps.invoke(domain, action, payload), { domain, action, payload: { ...payload, workspaceRoot: workspace } });
  const shot = async name => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const bytes = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
    fs.writeFileSync(path.join(output, name + (packaged ? '-packaged' : '-source') + '.png'), Buffer.from(bytes, 'base64'));
  };
  try {
    if (packaged) require('./package-manifest.cjs').verifyPackage();
    const env = { ...process.env, LVX_TEST_USER_DATA: path.join(temporary, 'profile'), LVX_TEST_HIDDEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ ...(packaged ? { executablePath: path.join(process.env.LVX_PACKAGE_DIR || path.join(root, 'release/win-unpacked'), 'LVX Test Studio.exe') } : { args: [root] }), cwd: root, env });
    page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1600, 1100); win.webContents.setBackgroundThrottling(false); });
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForFunction(() => window.LVXStudioInitialized === true);
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, workspace);
    await page.evaluate(async () => { await electronAPI.studioOps.chooseWorkspace(); await electronAPI.studioOps.invoke('security', 'trust', { trusted: true }); await LVXApp.useStorage(LVXWorkspaceBridge.createBackend()); });
    const workflow = 'name: Fixture CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo Local fixture\n';
    const file = (path, content) => ({ path, content, originalContent: content, kind: path.endsWith('.yml') ? 'workflow' : 'source' });
    const api = (title, origin) => JSON.stringify({ openapi: '3.0.3', info: { title, version: '1' }, servers: [{ url: origin }], paths: { '/health': { get: { responses: { 200: { description: 'healthy' } } } } } });
    const repo = (id, files) => ({ id, fullName: 'fixture/' + id, ref: 'main', commit: 'a'.repeat(40), importedAt: new Date().toISOString(), selected: '.github/workflows/ci.yml', workflows: [{ path: '.github/workflows/ci.yml', source: workflow }], files: [file('.github/workflows/ci.yml', workflow), ...files] });
    const repositories = [repo('java-client', [file('src/test/FakeStoreApiTest.java', 'import io.restassured.RestAssured;\nRestAssured.baseURI = "https://fakestoreapi.com";\ngiven().get("/products");'), file('src/client.js', "fetch('https://payments.test/health')")]), repo('platform', [file('orders/openapi.json', api('Orders API', 'https://orders.test')), file('payments/openapi.json', api('Payments API', 'https://payments.test'))]), repo('workflow-only', [])];
    await invoke('workspace', 'transact', { records: [{ collection: 'github-workflow-views', id: 'repository-lanes', value: { version: 1, repositories }, expectedRevision: null }] });
    await page.evaluate(() => LVXStudio.open('apiAtlas')); await page.locator('.aa-network').waitFor();
    check('Imported repositories appear before the first network scan', await page.locator('.aa-network-node').count() === 6);
    check('Imported-only coverage is explicit', (await page.locator('.aa-scan-report').innerText()).includes('imported-only'));
    await page.locator('[data-aa="scan-local"]').click(); await page.waitForFunction(() => document.querySelector('.aa-notice')?.textContent.includes('Map saved'));
    const before = await invoke('workspace', 'read', { collection: 'api-atlas', id: 'workspace' });
    check('Offline map saves Java external destination and both API services', before.value.atlas.externalNodes[0].title === 'fakestoreapi.com' && before.value.atlas.apiServices.length === 2);
    // Mount the same production module with only acquisition replaced. All
    // discovery, persistence and rendering continue through production IPC.
    await page.evaluate(async ({ workspace }) => {
      const { mountApiAtlas } = await import('./api-atlas.js'); const host = document.querySelector('.aa-workspace').parentElement;
      window.__repairSources = 0;
      window.__repairMount = await mountApiAtlas(host, { workspaceRoot: workspace, invoke: async (domain, action, payload) => {
        if (domain === 'githubStudio' && action === 'apiSources') {
          window.__repairSources++;
          if (payload.repository.endsWith('java-client')) throw Error('GitHub API quota exhausted (anonymous requests; no GitHub token supplied). Retry after 2026-10-27T12:00:00.000Z. Add a GitHub token in GitHub Actions.');
          if (payload.repository.endsWith('workflow-only')) throw Error('GitHub could not confirm this repository request.');
          return { files: [], complete: true, skipped: [] };
        }
        return electronAPI.studioOps.invoke(domain, action, JSON.parse(JSON.stringify(payload)));
      } });
    }, { workspace });
    await page.locator('.aa-toolbar [data-aa="scan"]').click(); await page.waitForFunction(() => document.querySelector('.aa-notice')?.textContent.includes('Map saved with partial'));
    check('One throttled repository does not stop the other repositories', await page.evaluate(() => window.__repairSources === 3));
    const report = await page.locator('.aa-scan-report').innerText();
    check('Failure report names repository, authentication, reset and recovery', ['fixture/java-client', 'anonymous', '2026-10-27T12:00:00', 'GitHub token', 'fixture/workflow-only'].every(value => report.includes(value)));
    check('External node is named and the map contains no invalid coordinates', await page.locator('.aa-external-node').textContent().then(text => text.includes('fakestoreapi.com')) && !await page.locator('.aa-network').innerHTML().then(html => html.includes('NaN')));
    const edge = page.locator('.aa-network-edge').filter({ has: page.locator('title').filter({ hasText: 'fakestoreapi.com' }) }).first();
    await edge.focus(); await page.keyboard.press('Enter');
    check('Keyboard activation exposes Java source evidence for an external link', (await page.locator('.aa-notice').innerText()).includes('FakeStoreApiTest.java:3'));
    await page.locator('.aa-network').scrollIntoViewIfNeeded(); await shot('api-connections');
    await page.locator('.aa-scan-report').scrollIntoViewIfNeeded(); await shot('scan-recovery');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(980, 850));
    check('Graph uses contained horizontal scrolling on a smaller window', await page.locator('.aa-network').evaluate(el => el.scrollWidth >= el.clientWidth && getComputedStyle(el).overflowX === 'auto'));
    await shot('narrow-graph'); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1100));
    const board = { schemaVersion: 1, id: 'repair-agent', name: 'Board context fixture', goal: '', mode: 'manual', maxTurns: 1, concurrency: 1, nodes: [{ id: 'a', name: 'Local context fixture', provider: 'api', model: 'fixture', apiConfig: { provider: 'custom', customEndpoint: 'http://127.0.0.1:' + server.address().port + '/chat', model: 'fixture' }, permission: 'native', instructions: '', position: { x: 50, y: 50 } }], edges: [] };
    await invoke('agents', 'saveBoard', { board, expectedRevision: null });
    await page.evaluate(() => { window.__repairMount.unmount(); return LVXStudio.open('githubActions'); }); await page.locator('.aa-repository-overview').waitFor();
    check('GitHub Actions shows repository, service and external connections above the lanes', await page.locator('.aa-repository-overview .aa-network-node').count() === 6 && await page.locator('.aa-repository-overview .aa-network-edge').count() >= 4);
    await page.locator('[name="gc-board"]').selectOption('repair-agent'); await page.locator('[name="gc-agent"]').selectOption('a');
    await page.locator('[data-gc="place"]').click(); await page.locator('.gw-lane').first().scrollIntoViewIfNeeded(); await page.locator('[data-gc-agent="a"] [data-gc="chat"]').click();
    const chat = page.locator('[data-gc-chat="a"]'); await chat.locator('[name="message"]').fill('Which repositories on this board contain APIs?');
    await chat.locator('[data-chat] button[type="submit"]').click(); await chat.locator('.lvx-chat-markdown table').waitFor();
    const prompt = requests[0]?.messages.at(-1).content || '';
    check('The actual agent request contains the whole imported board and its API scan diagnostics', ['fixture/java-client', 'fixture/platform', 'fixture/workflow-only', 'Orders API', 'Payments API', 'quota exhausted', 'fakestoreapi.com'].every(value => prompt.includes(value)));
    check('Assistant Markdown renders as a readable table and a safe link', await chat.locator('.lvx-chat-markdown th').count() === 2 && await chat.locator('.lvx-chat-markdown a').getAttribute('href') === 'https://example.test/source');
    await chat.locator('[data-gc="maximize"]').click(); await shot('agent-context');
    check('No renderer exceptions', errors.length === 0);
    console.log('BOARD_API_REPAIR_E2E_PASSED ' + checks.length + ' checks ' + (packaged ? 'packaged' : 'source'));
  } catch (error) { if (page) await shot('failure').catch(() => {}); throw error; }
  finally {
    if (app) await app.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(output, 'last-' + (packaged ? 'packaged' : 'source') + '.log'), checks.map(name => 'PASS ' + name).join('\n') + '\n' + errors.join('\n'));
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
