'use strict';
// Real Electron renderer -> preload -> main -> local offline GitHub transport.
// Only the native directory chooser is redirected into this disposable workspace.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
async function run({ packaged = process.argv.includes('--packaged') } = {}) {
  const output = path.join(root, 'output'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-github-studio-')), workspace = path.join(temp, 'workspace'), profile = path.join(temp, 'profile');
  fs.mkdirSync(output, { recursive: true }); fs.mkdirSync(workspace);
  const mode = packaged ? 'packaged' : 'source', screenshots = [], checks = [], pageErrors = [], dialogs = [], started = new Date().toISOString();
  const receiptPath = path.join(output, 'github-studio-e2e.json');
  let previousHistory = []; try { previousHistory = JSON.parse(fs.readFileSync(receiptPath, 'utf8')).history || []; } catch {}
  const sourceFiles = ['github-workflows.js', 'github-repo-editor.js', 'services/github-studio/index.cjs', 'services/github-studio/test-source.cjs', 'services/github-studio/test-parsers/structured.cjs', 'services/github-studio/workflow.cjs', 'services/github-studio/remote.cjs', 'services/github-studio/demo-remote.cjs'];
  const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file, digest(fs.readFileSync(path.join(root, file)))]));
  let app, page, rejectNext = false, failed = null, packageProof = null, runtime = null;
  const check = (name, condition, evidence) => { assert.ok(condition, name); checks.push({ name, evidence: evidence ?? true }); console.log('PASS ' + name); };
  const receipt = () => ({ schemaVersion: 1, started, finished: new Date().toISOString(), mode, passed: !failed, checkCount: checks.length, checks, screenshots, pageErrors, dialogs, failure: failed?.stack || null, workspace, profile, sourceHashes, packageProof, runtime, scriptSha256: digest(fs.readFileSync(__filename)), history: [...previousHistory, { started, mode, passed: !failed, checkCount: checks.length, sourceDigest: digest(JSON.stringify(sourceHashes)) }].slice(-30) });
  const button = action => page.locator(`[data-gs="${action}"]`);
  const input = name => page.locator(`.gs-editor [name="${name}"]`);
  const settled = () => page.waitForFunction(() => !!document.querySelector('.gs-editor') && !document.querySelector('.gs-editor').hasAttribute('aria-busy'));
  async function click(action, selector = '') { await page.locator(`[data-gs="${action}"]${selector}`).click(); await settled(); }
  async function tab(name) { await click('tab', `[data-tab="${name}"]`); }
  async function board() { return page.evaluate(async () => (await window.LVXStudio.invoke('workspace', 'read', { collection: 'github-workflow-views', id: 'repository-lanes' })).value); }
  const repo = async () => (await board()).repositories.find(r => r.id === 'example:web-client');
  const file = async target => (await repo()).files.find(f => f.path === target);
  async function screen(label) { const filename = `github-studio-${mode}-${label}.png`, target = path.join(output, filename); await page.screenshot({ path: target, fullPage: true }); screenshots.push(target); }
  async function detailsContaining(selector) { const el = page.locator(selector); await el.evaluate(node => { for (let parent = node.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true; }); }
  async function yamlSource() { if (!await input('raw-source').isVisible()) await click('source-toggle'); return input('raw-source').inputValue(); }
  async function saveYaml(source) { await yamlSource(); await input('raw-source').fill(source); await click('save-source'); }
  async function chooseTest(target) { await input('test-path').selectOption(target); await settled(); }
  async function stage(paths) {
    await tab('changes');
    for (const item of await page.locator('[data-stage]').all()) { const target = await item.getAttribute('data-stage'); if (paths.includes(target)) await item.check(); else await item.uncheck(); await settled(); }
    assert.deepEqual((await repo()).stagedPaths.slice().sort(), paths.slice().sort());
  }
  async function publish(mode, branch) {
    const current = await repo(); await input('publish-mode').selectOption(mode); await input('publish-target').fill(current.ref);
    await input('publish-branch').fill(branch); await input('publish-message').fill('Desktop E2E ' + mode); await input('publish-title').fill('Desktop E2E ' + mode);
    await click('preview');
    await page.locator('.gs-diff').waitFor(); const diff = await page.locator('.gs-diff').innerText();
    check(mode + ' preview contains actual staged unified source diff', /(?:\+\+\+|@@|diff --git)/.test(diff), digest(diff));
    const previousOperation = (await repo()).lastPublication?.operationId;
    await click('publish'); check(mode + ' publication requires reviewed-diff confirmation', /review|confirmation|check/i.test(await page.locator('.gs-notice').innerText()) && (await repo()).lastPublication?.operationId === previousOperation);
    await input('confirm-publish').check(); await click('publish'); await page.locator('.gs-publication').waitFor();
    const saved = await repo(); check(mode + ' publication completes through offline main-process transport', saved.lastPublication?.state === 'complete' && saved.lastPublication.simulated === true, saved.lastPublication);
    check(mode + ' successful publication clears the earlier validation alert', await page.locator('.gs-notice').getAttribute('role') === 'status' && /complete/.test(await page.locator('.gs-notice').innerText()));
    return saved;
  }
  async function launch(relaunch = false) {
    const env = { ...process.env, LVX_TEST_USER_DATA: profile, LVX_TEST_HIDDEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: packaged ? path.join(process.env.LVX_PACKAGE_DIR || path.join(root, 'release/win-unpacked'), 'LVX Test Studio.exe') : require('electron'), args: packaged ? [] : ['.'], cwd: root, env });
    runtime = await app.evaluate(({ app }) => ({ electron: process.versions.electron, node: process.versions.node, version: app.getVersion() }));
    page = await app.firstWindow(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('dialog', async dialog => { dialogs.push({ type: dialog.type(), message: dialog.message(), accepted: !rejectNext }); const reject = rejectNext; rejectNext = false; if (reject) await dialog.dismiss(); else await dialog.accept(); });
    await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) { win.setContentSize(1500, 1000); win.webContents.setBackgroundThrottling(false); win.showInactive(); } });
    await page.setViewportSize({ width: 1500, height: 1000 }); await page.waitForFunction(() => window.LVXStudioInitialized === true);
    if (!relaunch) {
      await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, workspace);
      await page.evaluate(() => window.LVXStudio.open('start')); await page.locator('[data-action="choose-folder"]').first().click();
      await page.waitForFunction(target => window.LVXStudio.state.workspace?.workspaceRoot === target, workspace);
      await page.evaluate(() => window.LVXStudio.invoke('security', 'trust', { trusted: true }));
    }
    await page.locator('.lvx-task-nav [data-page="githubActions"]').click();
  }
  try {
    if (packaged) packageProof = require('./package-manifest.cjs').verifyPackage();
    await launch();
    check('Disposable selected and trusted workspace uses native IPC', (await page.evaluate(() => window.LVXStudio.invoke('host', 'status', {}))).workspaceRoot === workspace);
    await page.locator('[data-action="examples"]').click(); await page.waitForFunction(() => document.querySelectorAll('.gw-lane').length === 3);
    check('Three independent offline repository lanes load', (await board()).repositories.length === 3);
    await page.locator('.gw-lane select').nth(1).selectOption('.github/workflows/release.yaml');
    await page.waitForFunction(() => document.querySelector('.gw-notice').textContent.includes('selection saved'));
    const selectedBoard = await board(); check('Each repository YAML selection remains independent', selectedBoard.repositories[0].selected === '.github/workflows/ci.yml' && selectedBoard.repositories[1].selected === '.github/workflows/release.yaml');
    await page.locator('.gw-lane [data-action="remove"]').nth(2).click(); await page.waitForFunction(() => document.querySelectorAll('.gw-lane').length === 2);
    await page.locator('[data-action="examples"]').click(); await page.waitForFunction(() => document.querySelectorAll('.gw-lane').length === 3);
    check('Repository removal and reimport preserve existing lane selections', (await board()).repositories[1].selected === '.github/workflows/release.yaml');
    await page.locator('.gw-lane [data-action="edit-repository"]').first().click(); await settled();
    check('Editor hydrates a real immutable offline snapshot and repository test sources', (await repo()).example === true && /^[a-f0-9]{40}$/.test((await repo()).commit) && (await repo()).files.some(f => f.path === 'tests/login.spec.ts'));

    await tab('runs'); await click('refresh-runs'); await input('run-select').selectOption('101'); await settled();
    check('Live-run and job inspection uses matching simulated snapshot identity', await page.locator('.gs-runtime-jobs li').count() === 3);
    await click('watch-runs'); check('Run polling can be enabled', /Stop watching/.test(await button('watch-runs').innerText())); await click('watch-runs');

    await tab('workflow');
    const originalYaml = await yamlSource();
    await input('raw-source').fill('jobs: [broken'); await click('save-source');
    check('Invalid exact YAML is rejected and original draft retained', (await file('.github/workflows/ci.yml')).content === originalYaml && await page.locator('.gs-notice[role="alert"]').isVisible()); await screen('invalid-source');
    const rawBuffer = originalYaml + '# Unapplied buffer stays on cancel\n'; await input('raw-source').fill(rawBuffer); rejectNext = true;
    await input('workflow-path').selectOption('.github/workflows/release.yaml'); await settled();
    check('Cancel file navigation retains exact unapplied buffer and selected path', await input('workflow-path').inputValue() === '.github/workflows/ci.yml' && await input('raw-source').inputValue() === rawBuffer);
    await saveYaml(rawBuffer.replace('  test:\n', '  test:\n    strategy:\n      matrix:\n        node: [20, 22]\n'));
    await click('job', '[data-job="test"]'); await detailsContaining('[data-gs="matrix"]'); await click('matrix');
    check('Matrix expansion displays its bounded concrete combinations', /2 combinations/.test(await page.locator('.gs-matrix-result').innerText()));
    await input('job-name').fill('Tests edited through controls'); await input('job-runner').fill('windows-latest'); await input('job-condition').fill('always()'); await click('save-job');
    check('Workflow job controls persist runner/name/condition and original comment', /windows-latest/.test((await file('.github/workflows/ci.yml')).content) && (await file('.github/workflows/ci.yml')).content.includes('# Repository checks'));
    await detailsContaining('[name="step-0"]'); await input('step-0').fill('name: Execute all checks\nrun: npm run check:all\n'); await click('save-step', '[data-index="0"]');
    await detailsContaining('[name="new-step"]'); await input('new-step').fill('name: Temporary verification\nrun: echo verified\n'); await click('add-step');
    check('Workflow step add produces actual YAML', (await file('.github/workflows/ci.yml')).content.includes('Temporary verification'));
    await detailsContaining('[name="step-1"]'); await click('delete-step', '[data-index="1"]'); check('Workflow step delete preserves other steps', !(await file('.github/workflows/ci.yml')).content.includes('Temporary verification'));
    await input('new-job-id').fill('qa_manual'); await click('add-job'); check('New workflow job appears', await page.locator('[data-gs="job"][data-job="qa_manual"]').count() === 1); await click('delete-job');
    check('Workflow job delete leaves unrelated jobs intact', !/  qa_manual:/.test((await file('.github/workflows/ci.yml')).content));
    await input('workflow-path').selectOption('.github/workflows/release.yaml'); await settled(); await click('reusable');
    check('Reusable workflow source inspection reads local immutable/draft source', /workflow_call/.test(await page.locator('.gs-reusable').innerText()));
    await input('workflow-path').selectOption('.github/workflows/ci.yml'); await settled();

    await tab('tests'); await chooseTest('tests/login.spec.ts');
    check('Test hierarchy, routes, assertions and CI links render from main-process AST service', await page.locator('[data-gs="case"]').count() >= 2 && (await page.locator('.gs-case-details').innerText()).includes('navigation'));
    await input('case-title').fill('sign in desktop'); await click('rename-case');
    check('Test rename preserves imports and helper comments', (await file('tests/login.spec.ts')).content.includes('sign in desktop') && (await file('tests/login.spec.ts')).content.includes('// Login helpers stay untouched'));
    await input('case-tags').fill('@desktop\n@smoke'); await click('tags-case');
    await input('case-body').fill("await page.goto('/desktop');\nawait expect(page).toHaveTitle('Desktop');"); await click('body-case');
    check('Test tags/actions/assertions change the selected AST body', (await file('tests/login.spec.ts')).content.includes('/desktop') && (await file('tests/login.spec.ts')).content.includes('@desktop'));
    await detailsContaining('[name="assertion-0"]'); await input('assertion-0').fill("expect(page).toHaveTitle('Desktop assertion edited')"); await click('save-assertion', '[data-index="0"]');
    check('Individual assertion control updates the real parsed assertion', (await file('tests/login.spec.ts')).content.includes('Desktop assertion edited'));
    await input('append-action').fill('const desktopProof = 42;'); await click('append-action');
    check('Action control appends an actual source statement', (await file('tests/login.spec.ts')).content.includes('const desktopProof = 42;'));
    await detailsContaining('[name="action-2"]'); await input('action-2').fill('const desktopProof = 43;'); await click('save-action', '[data-index="2"]');
    check('Individual statement control edits only the selected action', (await file('tests/login.spec.ts')).content.includes('const desktopProof = 43;') && (await file('tests/login.spec.ts')).content.includes('/desktop'));
    await detailsContaining('[name="action-2"]'); await click('delete-action', '[data-index="2"]');
    check('Individual statement deletion keeps neighboring action and assertion', !(await file('tests/login.spec.ts')).content.includes('desktopProof') && (await file('tests/login.spec.ts')).content.includes('Desktop assertion edited'));
    await click('new-case-form'); await input('add-title').fill('temporary desktop case'); await input('add-body').fill('expect(2 + 2).toBe(4);'); await click('add-case');
    await page.getByRole('button', { name: 'temporary desktop case', exact: true }).click(); await settled(); await click('delete-case');
    check('Test add/delete leaves neighboring declarations and imports intact', !(await file('tests/login.spec.ts')).content.includes('temporary desktop case') && (await file('tests/login.spec.ts')).content.includes('sign in desktop'));

    await click('new-test-form'); await input('create-path').fill('tests/desktop-added.spec.ts'); await input('create-title').fill('desktop added'); await input('create-body').fill('expect(6 * 7).toBe(42);'); await input('wire-test').check(); await input('wire-workflow').selectOption('.github/workflows/ci.yml'); await input('wire-job').fill('test'); await click('create-test-file');
    check('Test-file creation and workflow auto-wire save one coherent draft', (await file('tests/desktop-added.spec.ts')).originalContent === null && (await file('.github/workflows/ci.yml')).content.includes('desktop-added'));
    const duplicateCount = (await repo()).files.length;
    await click('new-test-form'); await input('create-path').fill('tests/desktop-added.spec.ts'); await click('create-test-file');
    check('Duplicate-file creation fails without overwriting source', (await repo()).files.length === duplicateCount && await page.locator('.gs-notice[role="alert"]').isVisible());

    // A statically dynamic title is inspectable but does not get an unsafe rename button.
    await detailsContaining('[name="test-source"]'); const addedSource = (await file('tests/desktop-added.spec.ts')).content;
    await input('test-source').fill(addedSource.replace("test('desktop added'", "const dynamicTitle = 'desktop added';\ntest(dynamicTitle")); await click('save-test-source');
    check('Unsupported dynamic title has an explicitly disabled structured control', await button('rename-case').isDisabled());
    await detailsContaining('[name="test-source"]'); await input('test-source').fill(addedSource); await click('save-test-source');
    await click('new-test-form'); await input('create-path').fill('tests/disposable.test.ts'); await input('create-framework').selectOption('vitest'); await input('create-title').fill('disposable'); await click('create-test-file'); await click('delete-file', '[data-kind="test"]');
    check('Added test-file deletion removes the file instead of publishing an empty blob', !(await repo()).files.some(f => f.path === 'tests/disposable.test.ts'));
    for (const sample of [
      { framework: 'pytest', path: 'tests/test_desktop.py', title: 'test_desktop', renamed: 'test_desktop_verified', body: 'assert 3 * 7 == 21' },
      { framework: 'nunit', path: 'tests/DesktopTests.cs', title: 'DesktopProof', renamed: 'DesktopVerified', body: 'Assert.That(42, Is.EqualTo(42));' }
    ]) {
      await click('new-test-form'); await input('create-path').fill(sample.path); await input('create-framework').selectOption(sample.framework); await input('create-title').fill(sample.title); await click('create-test-file');
      check(sample.framework + ' scaffold and AST discovery load through native packaged-capable IPC', await input('case-title').inputValue() === sample.title && await button('rename-case').isEnabled());
      await input('case-title').fill(sample.renamed); await click('rename-case'); await input('case-body').fill(sample.body); await click('body-case');
      check(sample.framework + ' visual rename and body mutation preserve parseable source', (await file(sample.path)).content.includes(sample.renamed) && (await file(sample.path)).content.includes(sample.body));
      if (sample.framework === 'pytest') {
        await detailsContaining('[name="test-source"]');
        const collectionSource = 'class TestNative:\n    def test_one(self):\n        assert True\n';
        await input('test-source').fill(collectionSource); await click('save-test-source');
        await page.getByRole('button', { name: 'Suite: TestNative', exact: true }).click(); await settled();
        await input('case-title').fill('HiddenFromCollection'); await click('rename-case');
        check('pytest suite controls reject names that remove test collection', (await file(sample.path)).content === collectionSource && await page.locator('.gs-notice[role="alert"]').isVisible());
        await input('case-title').fill('TestNativeRenamed'); await click('rename-case');
        check('pytest suite valid rename retains its child test', (await file(sample.path)).content.includes('class TestNativeRenamed') && await page.locator('[data-gs="case"]').count() === 2);
      }
      if (sample.framework === 'nunit') {
        await page.getByRole('button', { name: /^Suite:/ }).click(); await settled();
        check('C# class rename stays disabled to preserve constructors and references', await button('rename-case').isDisabled());
      }
      await click('delete-file', '[data-kind="test"]'); check(sample.framework + ' temporary scaffold removal is isolated from other files', !(await repo()).files.some(f => f.path === sample.path) && !!await file('tests/login.spec.ts'));
    }
    await click('new-test-form'); await input('create-path').fill('tests/desktop.robot'); await input('create-framework').selectOption('robot'); await input('create-title').fill('Native robot'); await click('create-test-file');
    const robotSource = (await file('tests/desktop.robot')).content;
    for (const title of ['# Hidden', '*** Settings ***']) {
      await input('case-title').fill(title); await click('rename-case');
      check('Robot title control rejects ' + title, (await file('tests/desktop.robot')).content === robotSource && await page.locator('.gs-notice[role="alert"]').isVisible());
    }
    await click('delete-file', '[data-kind="test"]');
    await chooseTest('tests/checkout.spec.ts'); await click('delete-file', '[data-kind="test"]');
    check('Existing test-file deletion retains reviewed original identity as a tombstone', (await file('tests/checkout.spec.ts')).isDeleted === true && !!(await file('tests/checkout.spec.ts')).sha);
    await input('case-title').scrollIntoViewIfNeeded();
    await screen('tests-light');
    const appearance = page.locator('[data-theme-toggle]').first(); await appearance.click(); await input('case-title').scrollIntoViewIfNeeded(); await screen('tests-dark'); await appearance.click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(720, 900)); await page.setViewportSize({ width: 720, height: 900 }); await input('case-title').scrollIntoViewIfNeeded(); await screen('tests-narrow');
    check('Narrow editor retains visible source and action controls', await button('new-case-form').isVisible() && await input('test-path').isVisible());
    check('Narrow structured title control fits the viewport horizontally', await input('case-title').evaluate(node => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; }));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1500, 1000)); await page.setViewportSize({ width: 1500, height: 1000 });

    const unstaged = (await file('tests/login.spec.ts')).content;
    await stage(['.github/workflows/ci.yml', 'tests/desktop-added.spec.ts', 'tests/checkout.spec.ts']);
    const published = await publish('pr', 'lvx/desktop-e2e-pr');
    check('PR publication returns review branch and pull-request identity', published.lastPublication.prNumber > 0 && published.ref === 'lvx/desktop-e2e-pr');
    check('Unstaged test draft survives publication and base refresh', (await file('tests/login.spec.ts')).content === unstaged && (await file('tests/login.spec.ts')).content !== (await file('tests/login.spec.ts')).originalContent);
    check('One publication atomically applies additions, updates and deletions', !!await file('tests/desktop-added.spec.ts') && !(await repo()).files.some(f => f.path === 'tests/checkout.spec.ts') && (await file('.github/workflows/ci.yml')).content === (await file('.github/workflows/ci.yml')).originalContent);
    await screen('publication-pr');
    await stage(['tests/login.spec.ts']); await publish('direct', 'unused-direct-branch');
    check('Direct publication clears only the committed draft', (await file('tests/login.spec.ts')).content === (await file('tests/login.spec.ts')).originalContent);
    await tab('tests'); await chooseTest('tests/desktop-added.spec.ts'); await input('case-title').fill('desktop merge checked'); await click('rename-case'); await stage(['tests/desktop-added.spec.ts']);
    const merged = await publish('merge', 'lvx/desktop-e2e-merge'); check('Merge mode completes a simulated PR merge', merged.lastPublication.merged === true);
    const beforeClose = await repo(); await app.close(); app = null;
    await launch(true); await page.locator('.gw-lane [data-action="edit-repository"]').first().click(); await settled();
    const afterOpen = await repo();
    check('Drafts, source, selected repository and publication persist across complete Electron relaunch', afterOpen.commit === beforeClose.commit && afterOpen.lastPublication.operationId === beforeClose.lastPublication.operationId && afterOpen.files.find(f => f.path === 'tests/desktop-added.spec.ts').content.includes('desktop merge checked'));
    check('Persisted repository remains explicitly offline after relaunch', afterOpen.example === true && afterOpen.lastPublication.simulated === true);
    await screen('reopened'); check('No renderer exceptions during complete native feature flow', pageErrors.length === 0, pageErrors);
    check('Application source stayed unchanged throughout this verification run', sourceFiles.every(file => sourceHashes[file] === digest(fs.readFileSync(path.join(root, file)))));
  } catch (error) { failed = error; if (page && !page.isClosed()) { try { await screen('failure'); console.error('UI NOTICE:', await page.locator('.gs-notice,.gw-notice').allTextContents()); } catch {} } }
  finally { if (app) await app.close().catch(() => {}); fs.writeFileSync(receiptPath, JSON.stringify(receipt(), null, 2)); }
  if (failed) throw failed;
  console.log('LVX_GITHUB_STUDIO_E2E_VERIFIED ' + mode + ' ' + checks.length + ' checks ' + receiptPath);
  return receipt();
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
