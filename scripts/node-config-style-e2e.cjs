'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { _electron } = require('playwright');
const { root, hash, sourceManifest } = require('./source-manifest.cjs');
const methods = {
  'security-scan': 'showSecurityNodeConfig', 'security-gate': 'showSecurityNodeConfig',
  'git-repo': 'showGitNodeConfig', 'unit-test-runner': 'showUnitTestConfig',
  'ai-unit-test': 'showAIUnitTestConfig', 'ai-log-summary': 'showAILogSummaryConfig',
  'log-collector': 'showLogCollectorConfig', 'start-runner': 'showStartRunnerConfig',
  'wait-delay': 'showWaitDelayConfig', 'api-performance': 'showAPIPerformanceConfig',
  'api-contract': 'showAPIContractConfig', 'code-review': 'showCodeReviewConfig',
  'website-ux-auto-tester': 'showWebsiteUXAutoTesterConfig', 'push-deploy': 'showPushDeployConfig'
};

async function run({ packaged = false, appDirectory = path.join(root, 'release/win-unpacked') } = {}) {
  require('./build-ui.cjs').buildUI({ check: true });
  const source = sourceManifest(), testScriptSha256 = hash(fs.readFileSync(__filename));
  appDirectory = path.resolve(root, appDirectory);
  const verifyCandidate = () => {
    assert.ok(appDirectory.startsWith(path.join(root, 'release') + path.sep), 'Candidate must be inside this project release directory');
    const asar = require('@electron/asar'), archive = path.join(appDirectory, 'resources/app.asar');
    for (const entry of source.files.filter(entry => entry.file !== 'package.json')) assert.equal(hash(asar.extractFile(archive, entry.file.split('/').join(path.sep))), entry.sha256, 'Stale packaged source: ' + entry.file);
    const metadata = JSON.parse(asar.extractFile(archive, 'package.json'));
    assert.equal(metadata.version, require('../package.json').version); assert.equal(metadata.license, 'MIT');
    return { asarSha256: hash(fs.readFileSync(archive)), executableSha256: hash(fs.readFileSync(path.join(appDirectory, 'LVX Test Studio.exe'))) };
  };
  const packageProof = packaged ? verifyCandidate() : null;
  const original = fs.readFileSync(path.join(root, 'apps/lvx-machina/visual-editor.js'), 'utf8');
  const themes = Object.entries(methods).map(([type, method]) => {
    const start = original.search(new RegExp('\\n    (?:async )?' + method + '\\('));
    assert.ok(start >= 0);
    const tag = original.slice(start).match(/<div class="aero-modal[^>]+style="([^"]+)"/)[1];
    return { type, method, background: tag.match(/background:\s*([^;]+)/)[1] };
  });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-config-style-'));
  const workspace = path.join(temporary, 'project'); fs.mkdirSync(workspace);
  const checks = [], screenshots = [], errors = [], observations = [];
  let app, page;
  const check = (name, value) => { assert.ok(value, name); checks.push(name); console.log('PASS', name); };
  try {
    const env = { ...process.env, LVX_TEST_USER_DATA: path.join(temporary, 'profile'), LVX_TEST_HIDDEN: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ ...(packaged ? { executablePath: path.join(appDirectory, 'LVX Test Studio.exe') } : { args: [root] }), cwd: os.tmpdir(), env });
    page = await app.firstWindow(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1600, 1000); w.webContents.setBackgroundThrottling(false); w.showInactive(); });
    await page.waitForFunction(() => window.LVXStudioInitialized === true);
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, workspace);
    await page.evaluate(async () => { await electronAPI.studioOps.chooseWorkspace(); await electronAPI.studioOps.invoke('security', 'trust', { trusted: true }); await LVXApp.useStorage(LVXWorkspaceBridge.createBackend()); });
    await page.locator('[data-page="graph"]').click(); await page.locator('.ve-palette-item').first().waitFor();
    const open = async type => page.evaluate(async type => {
      const editor = LVXStudio.graphEditor;
      let node = editor.nodes.find(node => node.type === type);
      if (!node) {
        document.querySelector('.ve-palette-item[data-type="' + type + '"]').click();
        node = editor.nodes.at(-1);
      }
      await editor[editor._getNodeConfigHandlerName(node)](node.id);
    }, type);
    const shot = async name => {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForTimeout(150);
      const bytes = Buffer.from(await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')), 'base64');
      const file = 'docs/verification/screenshots/node-configs-' + (packaged ? 'packaged/' : 'source/') + name + '.png';
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), bytes);
      screenshots.push({ file, sha256: hash(bytes), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
    };
    for (const appearance of ['light', 'dark']) {
      await page.evaluate(appearance => document.body.classList.toggle('theme-dark', appearance === 'dark'), appearance);
      for (const theme of themes) {
        await open(theme.type);
        const modal = page.locator('.mg-dialog'); await modal.waitFor();
        const result = await modal.evaluate((dialog, theme) => {
          const inner = dialog.querySelector('.aero-modal'), style = getComputedStyle(inner);
          const probe = document.createElement('span'); probe.style.background = theme.background; document.body.append(probe);
          const expected = getComputedStyle(probe).backgroundImage; probe.remove();
          const rectangle = inner.getBoundingClientRect();
          return { background: style.backgroundImage, expected, width: rectangle.width, height: rectangle.height,
            withinViewport: rectangle.left >= 0 && rectangle.top >= 0 && rectangle.right <= innerWidth + 1 && rectangle.bottom <= innerHeight + 1,
            headingSvg: !!inner.querySelector('h3 svg'),
            extras: ['retryAttempts', 'retryDelay', 'onFailure', 'resources'].every(name => !!inner.querySelector('[data-extra="' + name + '"]')),
            fields: [...inner.querySelectorAll('input[id],select[id],textarea[id]')].map(field => field.id),
            focusInside: dialog.contains(document.activeElement),
            footerLast: !inner.querySelector(':scope > .flex.justify-end') || inner.querySelector(':scope > .flex.justify-end') === inner.lastElementChild
          };
        }, theme);
        observations.push({ type: theme.type, appearance, ...result });
        const correct = result.background === result.expected && result.withinViewport && result.headingSvg && result.focusInside && result.footerLast;
        if (!correct) console.error('Dialog observation', theme.type, appearance, result);
        check(theme.type + ' retains its exact original gradient and contained form in ' + appearance + ' appearance', correct);
        check(theme.type + ' retains new execution settings in ' + appearance + ' appearance', result.extras);
        if (appearance === 'light') await shot(theme.type);
        await modal.locator('.mg-execution-details > summary').click();
        await modal.locator('[data-extra="retryAttempts"]').fill('2');
        await modal.locator('[data-extra="resources"]').fill('dialog-style-fixture');
        await modal.getByRole('button', { name: /^Save(?: Configuration)?$/i }).click();
        await page.waitForFunction(() => !document.querySelector('.mg-dialog'));
        check(theme.type + ' saves current execution settings without losing the node in ' + appearance + ' appearance', await page.evaluate(type => {
          const node = LVXStudio.graphEditor.nodes.find(node => node.type === type);
          return node.retry.maxAttempts === 2 && node.resources.includes('dialog-style-fixture');
        }, theme.type));
      }
    }
    await page.evaluate(() => document.body.classList.remove('theme-dark'));
    await open('ai-unit-test');
    check('AI unit tester restores the original three-column strategy layout', await page.locator('.mg-dialog .grid-cols-3').evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length === 3));
    const originalFieldIds = ['cfg-ai-filename', 'cfg-ai-automation-mode', 'cfg-ai-source-strategy', 'cfg-ai-test-mode', 'cfg-ai-provider', 'cfg-ai-model', 'cfg-ai-max-tokens', 'cfg-ai-load-files', 'cfg-ai-generate'];
    check('AI unit tester retains its source selection, generation, provider and automation controls', await page.evaluate(ids => ids.every(id => !!document.getElementById(id)), originalFieldIds));
    for (const zoom of [1, 2]) {
      await app.evaluate(({ BrowserWindow }, zoom) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1366, 900); w.webContents.setZoomFactor(zoom); }, zoom);
      check('AI unit tester footer and advanced fields remain reachable at1366x900 and zoom' + zoom, await page.locator('.mg-dialog').evaluate(async dialog => {
        const details = dialog.querySelector('.mg-execution-details'); details.open = true;
        for (const element of [dialog.querySelector('[data-extra="retryAttempts"]'), dialog.querySelector('#cfg-ai-save')]) {
          element.scrollIntoView({ block: 'nearest' }); element.focus();
          const rect = element.getBoundingClientRect();
          if (document.activeElement !== element || rect.left < 0 || rect.top < 0 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1) return false;
        }
        return true;
      }));
      await shot('ai-unit-test-zoom-' + zoom);
    }
    await page.locator('.mg-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    for (const zoom of [1, 2]) {
      await app.evaluate(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom), zoom);
      for (const theme of themes) {
        await open(theme.type);
        const reachable = await page.locator('.mg-dialog').evaluate(dialog => {
          dialog.querySelector('.mg-execution-details').open = true;
          const inner = dialog.querySelector('.aero-modal'), bounds = inner.getBoundingClientRect();
          if (bounds.left < 0 || bounds.top < 0 || bounds.right > innerWidth + 1 || bounds.bottom > innerHeight + 1) return false;
          const save = [...dialog.querySelectorAll('button')].find(button => /^Save(?: Configuration)?$/i.test(button.textContent.trim()));
          for (const element of [dialog.querySelector('[data-extra="retryAttempts"]'), save]) {
            element.scrollIntoView({ block: 'nearest' }); element.focus();
            const rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            if (document.activeElement !== element || rect.left < 0 || rect.top < 0 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1 || !element.contains(hit)) return false;
          }
          return true;
        });
        check(theme.type + ' configuration and new fields stay reachable at1366x900 and zoom' + zoom, reachable);
        await page.locator('.mg-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
      }
    }
    check('No uncaught renderer errors across all original configuration forms', errors.length === 0);
    assert.equal(sourceManifest().digest, source.digest); assert.equal(hash(fs.readFileSync(__filename)), testScriptSha256);
    if (packaged) assert.deepEqual(verifyCandidate(), packageProof);
    const report = { status: 'SUCCESS', recordedAt: new Date().toISOString(), sourceDigest: source.digest, testScriptSha256, packaged, packageProof, artifactDirectoryAtTest: packaged ? path.relative(root, appDirectory) : null, checks, observations, screenshots, errors, boundary: 'Disposable real Electron workspace; forms save locally. No live model, Git clone, network target or deployment invoked.' };
    fs.writeFileSync(path.join(root, 'docs/verification/node-config-style-' + (packaged ? 'packaged' : 'source') + '-results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('NODE_CONFIG_STYLE_VERIFIED');
  } finally {
    if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); }
    assert.equal(path.dirname(temporary), os.tmpdir()); fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
}
if (require.main === module) run({ packaged: process.argv.includes('--packaged'), ...(process.argv.includes('--app-dir') ? { appDirectory: process.argv[process.argv.indexOf('--app-dir') + 1] } : {}) }).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
