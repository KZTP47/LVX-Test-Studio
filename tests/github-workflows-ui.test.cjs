'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const root = path.resolve(__dirname, '..');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.external/playwright-browsers');
const { chromium } = require('playwright'), { createServer } = require('../scripts/dev-server.cjs');
async function fixture(t) {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() => window.LVXStudioInitialized);
  await page.locator('.lvx-task-nav [data-page="githubActions"]').click();
  await page.locator('.gw-import').waitFor();
  return { page, errors };
}
test('GitHub UI repository lanes isolate workflow selection, inspect jobs by keyboard, persist, remove and fit narrow screens', async t => {
  const { page, errors } = await fixture(t);
  assert.equal(await page.locator('.gw-lane').count(), 0);
  await page.getByRole('button', { name: 'Load example repositories', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.gw-lane').length === 3);
  const first = page.locator('.gw-lane').nth(0), second = page.locator('.gw-lane').nth(1);
  await first.locator('select').selectOption('.github/workflows/release.yaml');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('lvx_github_workflows_browser_v1')).repositories[0].selected.endsWith('release.yaml'));
  assert.equal(await second.locator('select').inputValue(), '.github/workflows/ci.yml');
  await second.locator('g[data-job="browser"]').focus(); await page.keyboard.press('Enter');
  assert.match(await second.locator('.gw-inspector').innerText(), /npx playwright test/);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click(); assert.equal(await page.locator('.gw-zoom output').innerText(), '110%');
  assert.equal(await page.locator('#studio-notice').innerText(), '');
  const output = path.join(root, 'output/playwright'); fs.mkdirSync(output, { recursive: true });
  await page.locator('#toast-container').evaluateAll(elements => elements.forEach(element => element.remove()));
  await page.screenshot({ path: path.join(output, 'github-workflows-desktop.png'), fullPage: true });
  await page.locator('.gw-lanes').screenshot({ path: path.join(output, 'github-workflows-lanes.png') });
  await page.getByRole('button', { name: 'Job list', exact: true }).click(); assert.equal(await page.locator('.gw-canvas').count(), 0); assert.ok(await page.locator('.gw-job-list button').count() >= 8);
  await page.reload(); await page.waitForFunction(() => window.LVXStudioInitialized); await page.locator('.lvx-task-nav [data-page="githubActions"]').click(); await page.locator('.gw-lane').first().waitFor();
  assert.equal(await page.locator('.gw-lane').count(), 3); assert.equal(await page.locator('.gw-lane').first().locator('select').inputValue(), '.github/workflows/release.yaml');
  await page.locator('.gw-lane').nth(1).getByRole('button', { name: /Remove repository/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.gw-lane').length === 2);
  assert.match(await page.locator('.gw-lane').nth(1).innerText(), /shared-tools/);
  await page.setViewportSize({ width: 700, height: 1000 });
  await page.screenshot({ path: path.join(output, 'github-workflows-narrow.png'), fullPage: true });
  await page.locator('.gw-lane').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'github-workflows-narrow-lane.png'), fullPage: true });
  const sizes = await page.locator('.gw-workspace').evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth })); assert.ok(sizes.scroll <= sizes.client + 2, JSON.stringify(sizes));
  assert.equal(await page.locator('#studio-notice').innerText(), '');
  await page.evaluate(() => document.body.classList.add('theme-dark'));
  await page.locator('.gw-lane').first().screenshot({ path: path.join(output, 'github-workflows-dark-lane.png') });
  assert.deepEqual(errors, []);
});
test('GitHub UI live import preserves source, handles empty repos/errors, and removal cancels late refresh', async t => {
  const { page, errors } = await fixture(t); let empty = false, denied = false, delayed = false, resolveDelay;
  await page.route('https://api.github.com/repos/org/live**', async route => {
    const part = new URL(route.request().url()).pathname.split('/live')[1];
    if (denied) return route.fulfill({ status: 403, json: {} });
    if (delayed && part === '') await new Promise(resolve => { resolveDelay = resolve; });
    const sha = char => char.repeat(40), source = '# Exact comment\nname: "<img src=x onerror=alert(1)>"\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "literal"\n';
    const routes = { '': { default_branch: 'main' }, '/commits/main': { sha: sha('a'), commit: { tree: { sha: sha('b') } } }, ['/git/trees/' + sha('b')]: { tree: empty ? [] : [{ path: '.github', type: 'tree', sha: sha('c') }] }, ['/git/trees/' + sha('c')]: { tree: [{ path: 'workflows', type: 'tree', sha: sha('d') }] }, ['/git/trees/' + sha('d')]: { tree: [{ path: 'ci.yml', type: 'blob', sha: sha('e'), size: source.length }] }, ['/git/blobs/' + sha('e')]: { encoding: 'base64', content: Buffer.from(source).toString('base64') } };
    await route.fulfill({ json: routes[part] });
  });
  await page.locator('.gw-import [name="repository"]').fill('org/live'); await page.locator('.gw-import button').click();
  await page.locator('.gw-lane').waitFor(); assert.equal(await page.locator('.gw-lane img').count(), 0);
  await page.locator('.gw-source summary').click(); assert.match(await page.locator('.gw-source pre').innerText(), /^# Exact comment/);
  denied = true; await page.getByRole('button', { name: 'Refresh org/live', exact: true }).click();
  await page.locator('.gw-lane .gw-error').waitFor(); assert.equal(await page.locator('.gw-node').count(), 1);
  denied = false; empty = true; await page.getByRole('button', { name: 'Refresh org/live', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.gw-lane')?.textContent.includes('No workflow YAML files')); assert.equal(await page.locator('.gw-node').count(), 0);
  delayed = true; await page.getByRole('button', { name: 'Refresh org/live', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.gw-lane').textContent.includes('Refreshing'));
  await page.getByRole('button', { name: 'Remove repository org/live', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.gw-lane'));
  resolveDelay?.(); await page.locator('.gw-import [name="repository"]').fill('org/live'); delayed = false; empty = false; await page.locator('.gw-import button').click(); await page.locator('.gw-node').waitFor();
  assert.equal(await page.locator('.gw-lane').count(), 1);
  // A form re-import uses a different busy slot than a lane refresh. Removal must cancel both.
  delayed = true; await page.locator('.gw-import button').click(); await page.waitForFunction(() => document.querySelector('.gw-import button').disabled);
  await page.getByRole('button', { name: 'Remove repository org/live', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.gw-lane'));
  resolveDelay?.(); await page.getByRole('button', { name: 'Job list', exact: true }).click();
  assert.equal(await page.locator('.gw-lane').count(), 0); assert.equal(await page.locator('#studio-notice').innerText(), ''); assert.deepEqual(errors, []);
});
test('GitHub UI uses canonical desktop workspace storage with revision conflicts and opaque credential requests', async t => {
  const { page } = await fixture(t);
  const result = await page.evaluate(async () => {
    const { mountGitHubWorkflows } = await import('/github-workflows.js');
    const host = document.createElement('section'); document.body.append(host);
    const requests = [], token = 'secret:11111111-1111-4111-8111-111111111111'; let saved = null, conflict = false;
    const invoke = async (domain, action, payload) => {
      requests.push({ domain, action, payload: structuredClone(payload) });
      if (action === 'read') return saved;
      if (action === 'transact') { if (conflict) throw Error('Another window changed this record'); const r = payload.records[0]; if (r.expectedRevision !== (saved?.revision ?? null)) throw Error('Revision mismatch'); saved = { value: r.value, revision: (saved?.revision ?? 0) + 7 }; return { changes: [{ id: r.id, revision: saved.revision }] }; }
      if (domain === 'githubStudio' && action === 'snapshot') { authorized = payload.credentialReference === token && payload.workspaceRoot === 'C:\\fixture'; throw Error('Fixture denied GitHub import'); }
    };
    let encrypted = false, authorized = false;
    const credentials = window.LVXCredentials;
    window.LVXCredentials = { protect: async value => { encrypted = value.token === 'private-test-token'; return { token }; }, request: async (_url, options) => { authorized = options.headers.Authorization === 'Bearer ' + token; return new Response('{}', { status: 401 }); } };
    const mounted = await mountGitHubWorkflows(host, { desktop: true, workspaceRoot: 'C:\\fixture', invoke });
    host.querySelector('[data-action="examples"]').click();
    await new Promise(resolve => setTimeout(resolve, 20));
    const count = host.querySelectorAll('.gw-lane').length;
    host.querySelector('.gw-workflow-picker select').value = '.github/workflows/release.yaml'; host.querySelector('.gw-workflow-picker select').dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
    conflict = true; host.querySelector('[data-action="remove"]').click(); await new Promise(resolve => setTimeout(resolve, 20));
    const retained = host.querySelectorAll('.gw-lane').length, conflictVisible = host.querySelector('.gw-notice').textContent.includes('Another window');
    host.querySelector('[name="repository"]').value = 'org/private'; host.querySelector('[name="token"]').value = 'private-test-token'; host.querySelector('form').requestSubmit(); await new Promise(resolve => setTimeout(resolve, 40));
    const passwordCleared = host.querySelector('[name="token"]').value === '';
    host.querySelector('[data-action="forget"]').click(); await new Promise(resolve => setTimeout(resolve, 20));
    mounted.unmount(); host.remove(); window.LVXCredentials = credentials;
    return { count, retained, conflictVisible, encrypted, authorized, passwordCleared, requests, saved };
  });
  assert.equal(result.count, 3); assert.equal(result.retained, 3); assert.equal(result.conflictVisible, true); assert.equal(result.encrypted, true); assert.equal(result.authorized, true); assert.equal(result.passwordCleared, true);
  const writes = result.requests.filter(request => request.action === 'transact'); assert.equal(writes[0].payload.records[0].expectedRevision, null); assert.equal(writes[1].payload.records[0].expectedRevision, 7); assert.equal(writes[2].payload.records[0].expectedRevision, 14);
  assert.ok(result.requests.filter(request => request.domain === 'workspace').every(request => request.payload.workspaceRoot === 'C:\\fixture')); assert.equal(JSON.stringify(result.requests).includes('private-test-token'), false);
  assert.equal(result.requests.some(request => request.action === 'deleteSecret' && request.payload.reference.startsWith('secret:')), true);
});
