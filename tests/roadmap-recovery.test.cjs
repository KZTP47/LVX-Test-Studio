'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { createService } = require('../services/workspace/index.cjs');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..'), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const proofs = [];
const sourceFiles = ['services/workspace/index.cjs', 'studio-recovery.js', 'tests/roadmap-recovery.test.cjs'];
const dependencies = ['services/workspace/archive.cjs', 'services/workspace/store.cjs', 'services/studio-host.cjs', 'services/execution/index.cjs', 'services/preview/index.cjs', 'services/security/index.js', 'main.js', 'preload.js', 'studio-workbench.js', 'studio-storage.js', 'styles.css', 'icons.js', 'ui-modules.json', 'assets/app-modules.js'];
const manifest = names => Object.fromEntries(names.map(name => [name, sha(fs.readFileSync(path.join(root, name)))]));
const before = manifest([...sourceFiles, ...dependencies]);
function files(directory) { return fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => item.isDirectory() ? files(path.join(directory, item.name)) : [path.join(directory, item.name)]) : []; }
function record(id, name = 'Recovered check') { return { collection: 'checks', id, value: { name, engine: 'javascript', code: 'assert(31===31);' }, expectedRevision: null }; }
function recheck(archive) { archive.manifest.records = archive.payload.records.length; archive.manifest.artifacts = archive.payload.artifacts.length; archive.manifest.payloadChecksum = sha(JSON.stringify(archive.payload)); return archive; }
function scenario(name, fn, options = {}) {
  test(name, options, async t => { const start = Date.now(); try { await fn(t); proofs.push({ name, status: 'PASS', durationMs: Date.now() - start }); } catch (error) { proofs.push({ name, status: 'FAIL', durationMs: Date.now() - start, error: error.message }); throw error; } });
}

scenario('FW-19 validateRecovery checks a corrupt database without mutation and only a valid explicit archive replaces it', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-recovery-store-')), workspaceRoot = path.join(folder, 'workspace'), dataDir = path.join(folder, 'private'); fs.mkdirSync(workspaceRoot);
  let service = createService({ dataDir, workspaceRoot });
  t.after(async () => { await service.close(); fs.rmSync(folder, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 }); });
  await service.handle('transact', { records: [record('check')] });
  const archive = await service.handle('backup'); await service.close();
  const database = files(dataDir).find(file => file.endsWith('workspace.sqlite'));
  const damaged = Buffer.from('LVX deliberate corrupt SQLite recovery positive control'); fs.writeFileSync(database, damaged);
  service = createService({ dataDir, workspaceRoot }); assert.equal((await service.handle('status')).status, 'ERROR');
  const invalid = structuredClone(archive); invalid.payload.records[0].value.name = 'Tampered';
  const failed = await service.handle('validateRecovery', { archive: invalid });
  assert.equal(failed.valid, false); assert.match(failed.errors.join(' '), /checksum/); assert.deepEqual(fs.readFileSync(database), damaged);
  await assert.rejects(service.handle('recover', { archive: invalid }), { code: 'ARCHIVE_INVALID' }); assert.deepEqual(fs.readFileSync(database), damaged);
  const valid = await service.handle('validateRecovery', { archive });
  assert.equal(valid.valid, true); assert.equal(valid.records, archive.payload.records.length); assert.equal(valid.revision, null); assert.deepEqual(fs.readFileSync(database), damaged);
  const restored = await service.handle('recover', { archive }); assert.equal(restored.recovered, true); assert.deepEqual(fs.readFileSync(restored.preservedDatabase), damaged);
  assert.equal((await service.handle('read', { collection: 'checks', id: 'check' })).value.name, 'Recovered check');
});

scenario('FW-19 recovery validation rejects credential material, malformed manifests and missing dependencies before database access', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-recovery-validation-')), workspaceRoot = path.join(folder, 'workspace'); fs.mkdirSync(workspaceRoot);
  const secret = 'recovery-known-' + crypto.randomUUID();
  const service = createService({ dataDir: path.join(folder, 'private'), workspaceRoot, redact: value => JSON.parse(JSON.stringify(value).split(secret).join('[REDACTED]')) });
  t.after(async () => { await service.close(); fs.rmSync(folder, { recursive: true, force: true }); });
  const archive = await service.handle('backup');
  const leaking = recheck({ ...structuredClone(archive), payload: { records: [{ collection: 'checks', id: 'leak', value: { note: secret } }], artifacts: [] } });
  assert.equal((await service.handle('validateRecovery', { archive: leaking })).valid, false);
  const missing = recheck({ ...structuredClone(archive), payload: { records: [{ collection: 'checks', id: 'missing', value: { dependencies: [{ collection: 'datasets', id: 'gone' }] } }], artifacts: [] } });
  assert.match((await service.handle('validateRecovery', { archive: missing })).errors.join(' '), /Missing imported dependency/);
  assert.equal((await service.handle('validateRecovery', { archive: {} })).valid, false);
  assert.equal((await service.handle('status')).revision, 0);
});

scenario('FW-19 actual Electron restart exposes keyboard recovery and restores records/config without granting imported code trust', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-recovery-desktop-')), workspace = path.join(folder, 'workspace'), profile = path.join(folder, 'profile'); fs.mkdirSync(workspace);
  let app, page;
  async function close() { if (!app) return; const current = app; app = null; await current.evaluate(({ app }) => app.quit()).catch(() => {}); await current.close().catch(() => {}); }
  t.after(async () => { await close(); fs.rmSync(folder, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }); });
  async function launch() {
    const env = { ...process.env, LVX_TEST_USER_DATA: profile, LVX_TEST_HIDDEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: os.tmpdir(), env });
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) { window.setContentSize(1440, 1000); window.webContents.setBackgroundThrottling(false); window.showInactive(); } });
    page = await app.firstWindow(); page.setDefaultTimeout(20000); await page.waitForFunction(() => window.LVXStudioInitialized && window.LVXRecovery && window.LVXCredentials);
  }
  const invoke = (domain, action, payload = {}) => page.evaluate(({ domain, action, payload }) => window.electronAPI.studioOps.invoke(domain, action, payload), { domain, action, payload });
  await launch();
  await app.evaluate(({ dialog }, workspace) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] }); }, workspace);
  await page.evaluate(() => window.electronAPI.studioOps.chooseWorkspace()); await invoke('security', 'trust', { trusted: true });
  await invoke('workspace', 'transact', { records: [record('restored-check', 'Archive proof')] });
  const fixture = await invoke('execution', 'saveFixture', { name: 'Recoverable setup', engine: 'javascript', setup: 'fixture.answer=31;', cleanup: 'console.log("Recovery fixture cleanup");' });
  const workflow = { schemaVersion: 1, nodes: [{ id: 'check', type: 'script', data: { engine: 'javascript', name: 'Recovered native proof', code: 'assert(fixture.answer===31);', fixtureId: fixture.id, fixtureVersion: fixture.version } }], edges: [] };
  await invoke('execution', 'saveSchedule', { name: 'Restore disabled', workflow, intervalMs: 60000, enabled: true, missedRun: 'skip', nextRun: new Date(Date.now() + 3600000).toISOString() });
  const archive = await invoke('workspace', 'backup', { includeArtifacts: true });
  assert.ok(archive.payload.records.some(item => item.collection === 'execution-config'));
  const validFile = path.join(folder, 'valid-archive.json'), badFile = path.join(folder, 'tampered-archive.json'), malformedFile = path.join(folder, 'malformed.json');
  fs.writeFileSync(validFile, JSON.stringify(archive)); const bad = structuredClone(archive); bad.payload.records.find(item => item.id === 'restored-check').value.name = 'Checksum bypass'; fs.writeFileSync(badFile, JSON.stringify(bad)); fs.writeFileSync(malformedFile, '{not-json');
  await close();
  const database = files(path.join(profile, 'studio', 'workspace')).find(file => file.endsWith('workspace.sqlite')); assert.ok(database);
  const damaged = Buffer.from('LVX UI test: intentionally damaged SQLite database'); fs.writeFileSync(database, damaged);
  // Remove the fixture's runtime copy too: a successful post-recovery check
  // must prove archive restoration rather than rediscover pre-existing config.
  fs.writeFileSync(path.join(profile, 'studio', 'execution', 'configuration.json'), JSON.stringify({ fixtures: [], schedules: [] }));
  await launch();
  assert.equal((await invoke('workspace', 'status')).status, 'ERROR');
  const emptyConfiguration = await invoke('execution', 'exportConfiguration'); assert.equal(emptyConfiguration.fixtures.length, 0); assert.equal(emptyConfiguration.schedules.length, 0);
  await page.evaluate(() => window.LVXStudio.open());
  const ui = page.locator('#studio-workbench'); await ui.locator('[data-page="workspace"]').click();
  await ui.getByRole('heading', { name: 'Restore your project', exact: true }).waitFor();
  const file = ui.getByLabel('Project archive', { exact: true }), validate = ui.getByRole('button', { name: 'Validate archive', exact: true }), restore = ui.getByRole('button', { name: 'Restore project from archive', exact: true }), confirmation = ui.getByRole('checkbox', { name: 'I understand this replaces the current project with the selected archive.' });
  assert.equal(await restore.isDisabled(), true); assert.equal(await confirmation.isDisabled(), true); assert.equal(await validate.isDisabled(), true);
  await file.setInputFiles(malformedFile); await validate.click(); await ui.getByRole('alert').filter({ hasText: 'not valid JSON' }).waitFor(); assert.equal(await restore.isDisabled(), true); assert.deepEqual(fs.readFileSync(database), damaged);
  await file.setInputFiles(badFile); await validate.focus(); await page.keyboard.press('Enter');
  await ui.getByRole('heading', { name: 'Archive needs attention' }).waitFor(); assert.match(await ui.locator('[data-recovery-preview]').innerText(), /checksum/); assert.equal(await restore.isDisabled(), true); assert.deepEqual(fs.readFileSync(database), damaged);
  // File metadata above the former picker ceiling remains selectable. Contents still require validation.
  await file.evaluate((input,archive) => { const item = new File([JSON.stringify(archive)], 'large-declared-archive.json', { type: 'application/json' }); Object.defineProperty(item, 'size', { value: 100 * 1024 * 1024 }); const list = new DataTransfer(); list.items.add(item); input.files = list.files; input.dispatchEvent(new Event('change', { bubbles: true })); }, archive);
  await validate.waitFor({state:'visible'});assert.equal(await validate.isEnabled(),true);await validate.click();
  await ui.getByRole('heading', { name: 'Archive validated', exact: true }).waitFor();assert.equal(await restore.isDisabled(),true);assert.deepEqual(fs.readFileSync(database),damaged);
  await file.setInputFiles(validFile); await validate.focus(); await page.keyboard.press('Enter');
  await ui.getByRole('heading', { name: 'Archive validated', exact: true }).waitFor(); assert.equal(await restore.isDisabled(), true);
  const preview = await ui.locator('[data-recovery-preview]').innerText(); assert.match(preview, new RegExp(`${archive.payload.records.length} project records`));
  await ui.locator('[data-recovery-preview]').scrollIntoViewIfNeeded();
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus(); });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const screenshot = path.join(os.tmpdir(), 'lvx-recovery-validated-' + Date.now() + '.png');
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const image = await Promise.race([BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }), new Promise((_, reject) => setTimeout(() => reject(new Error('Native recovery capture timed out.')), 10000))]);
    return image.toPNG().toString('base64');
  });
  fs.writeFileSync(screenshot, Buffer.from(png, 'base64')); assert.ok(fs.statSync(screenshot).size > 10000, 'Native capture must contain rendered recovery UI');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
  assert.equal(await ui.locator('#studio-content').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
  await confirmation.focus(); await page.keyboard.press('Space'); assert.equal(await restore.isEnabled(), true); await page.keyboard.press('Tab'); assert.equal(await restore.evaluate(button => document.activeElement === button), true); await page.keyboard.press('Enter');
  await ui.getByRole('heading', { name: 'Project restored', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
  assert.equal((await invoke('workspace', 'status')).status, 'SUCCESS'); assert.equal((await invoke('workspace', 'read', { collection: 'checks', id: 'restored-check' })).value.name, 'Archive proof');
  const preserved = files(path.dirname(database)).find(file => file.includes('workspace.sqlite.preserved-') && !/-wal$|-shm$/.test(file)); assert.ok(preserved); assert.deepEqual(fs.readFileSync(preserved), damaged);
  const configuration = await invoke('execution', 'exportConfiguration'); assert.equal(configuration.fixtures[0].id, fixture.id); assert.equal(configuration.fixtures[0].version, fixture.version); assert.equal(configuration.schedules[0].enabled, false);
  await assert.rejects(invoke('execution', 'runWorkflow', { workflow }), /review|imported|trust/i);
  const pending = await invoke('host', 'pendingImports'); assert.ok(pending.length > 0);
  await ui.getByRole('button', { name: 'Open recovered project', exact: true }).click(); await ui.getByRole('heading', { name: 'Protect and move your work' }).waitFor();
  assert.match(await ui.innerText(), /Review imported executable content/);
  proofs.push({ name: 'Rendered evidence', status: 'PASS', screenshot, screenshotSha256: sha(fs.readFileSync(screenshot)), records: archive.payload.records.length, restoredFixtureVersions: configuration.fixtures.length, restoredSchedulesDisabled: true, importedContentDenied: pending.length, keyboard: 'Enter validates; Space confirms; Tab reaches Restore; Enter restores at 200% zoom; headings and errors receive focus', zoom200: 'No horizontal overflow; actual keyboard confirmation and restoration complete at 200% zoom' });
}, { timeout: 180000 });

scenario('FW-19 minimal replacement clears old native fixtures, schedules and baselines while merge preserves them', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-recovery-replace-')), workspace = path.join(folder, 'workspace'); fs.mkdirSync(workspace);
  const env = { ...process.env, LVX_TEST_USER_DATA: path.join(folder, 'profile'), LVX_TEST_HIDDEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: os.tmpdir(), env });
  t.after(async () => { await app.evaluate(({ app }) => app.quit()).catch(() => {}); await app.close().catch(() => {}); fs.rmSync(folder, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }); });
  const page = await app.firstWindow(); await page.waitForFunction(() => window.LVXStudioInitialized);
  const invoke = (domain, action, payload = {}) => page.evaluate(({ domain, action, payload }) => window.electronAPI.studioOps.invoke(domain, action, payload), { domain, action, payload });
  const preview = (action, payload = {}) => page.evaluate(({ action, payload }) => window.electronAPI.previewOps.invoke(action, payload), { action, payload });
  await app.evaluate(({ dialog }, workspace) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] }); }, workspace);
  await page.evaluate(() => window.electronAPI.studioOps.chooseWorkspace()); await invoke('security', 'trust', { trusted: true });
  await invoke('workspace', 'transact', { records: [record('minimal-check')] });
  const image = await app.evaluate(({ nativeImage }) => nativeImage.createFromBitmap(Buffer.from([0, 60, 180, 255]), { width: 1, height: 1 }).toPNG().toString('base64'));
  const imageBytes = Buffer.from(image, 'base64');
  const baseline = { schemaVersion: 1, type: 'lvx-native-baselines', workspaceBinding: sha(workspace), items: [{ id: sha('minimal-replacement'), sha256: sha(imageBytes), bytes: imageBytes.length, image }] };
  async function seed() {
    const fixture = await invoke('execution', 'saveFixture', { name: 'Old private state', engine: 'javascript', setup: 'fixture.old=9;' });
    const workflow = { schemaVersion: 1, nodes: [{ id: 'old', type: 'script', data: { engine: 'javascript', code: 'assert(fixture.old===9);', fixtureId: fixture.id } }], edges: [] };
    await invoke('execution', 'saveSchedule', { name: 'Old active schedule', workflow, intervalMs: 60000, enabled: true, missedRun: 'skip', nextRun: new Date(Date.now() + 3600000).toISOString() });
    await preview('importBaselines', { archive: baseline });
    const healthy = await invoke('workspace', 'backup');
    assert.ok(healthy.payload.records.some(item => item.collection === 'execution-config')); assert.ok(healthy.payload.records.some(item => item.collection === 'baselines'));
    assert.equal((await preview('exportBaselines')).items.length, 1);
    return recheck({ ...structuredClone(healthy), payload: { records: healthy.payload.records.filter(item => item.collection === 'checks'), artifacts: [] } });
  }
  let minimal = await seed();
  const merge = await invoke('workspace', 'previewImport', { archive: minimal }); await invoke('workspace', 'import', { archive: minimal, mode: 'merge', expectedWorkspaceRevision: merge.revision });
  assert.equal((await invoke('execution', 'exportConfiguration')).fixtures.length, 1); assert.equal((await preview('exportBaselines')).items.length, 1);
  for (const action of ['recover', 'import']) {
    if (action === 'import') minimal = await seed();
    const validation = await invoke('workspace', action === 'recover' ? 'validateRecovery' : 'previewImport', { archive: minimal }); assert.equal(validation.valid, true);
    await invoke('workspace', action, { archive: minimal, ...(action === 'import' ? { mode: 'replace', expectedWorkspaceRevision: validation.revision } : {}) });
    const configuration = await invoke('execution', 'exportConfiguration'); assert.equal(configuration.fixtures.length, 0, action); assert.equal(configuration.schedules.length, 0, action);
    assert.equal((await preview('exportBaselines')).items.length, 0, action); assert.ok(await invoke('workspace', 'read', { collection: 'checks', id: 'minimal-check' }));
  }
}, { timeout: 120000 });

test.after(() => {
  const after = manifest([...sourceFiles, ...dependencies]), drift = Object.keys(before).filter(name => before[name] !== after[name]);
  const sourceManifest = Object.fromEntries(sourceFiles.map(name => [name, after[name]]));
  const report = { schemaVersion: 1, scope: 'leaf-recovery / FW-19 approachable corrupt-database recovery', verifiedAt: new Date().toISOString(), status: proofs.filter(item => item.name !== 'Rendered evidence').length === 4 && proofs.every(item => item.status === 'PASS') && !drift.length ? 'SELF_VERIFIED_AWAITING_PARENT' : 'FINDINGS_OR_SOURCE_DRIFT', sourceManifest, sourceDigest: sha(JSON.stringify(sourceManifest)), dependencyManifestBefore: before, dependencyManifestAfter: after, sourceDrift: drift, scenarios: proofs, counts: { tests: proofs.filter(item => item.name !== 'Rendered evidence').length, pass: proofs.filter(item => item.name !== 'Rendered evidence' && item.status === 'PASS').length, fail: proofs.filter(item => item.status === 'FAIL').length }, passes: ['Pure recovery validation is reachable before SQLite access, without mutation.', 'Added scoped desktop file validation, explicit replacement acknowledgement, preserved-original receipt, disabled/busy/error/focus semantics and warnings.', 'Proved invalid JSON, checksum tampering, secret/dependency rejection, large declared file selection and real restart with corrupt SQLite; no data replacement before validation. Found absent native-state records could leave old schedules alive; parent fixed replacement clearing.', 'Verified actual full-app keyboard restore at 200% zoom, restoration from empty runtime configuration, exact record/native fixture recovery, disabled schedules, imported code trust denial and minimal replacement clearing of old fixtures/schedules/native PNG baselines; merge preserves existing state. Source digests checked.'], boundary: 'Real Electron full application, real SQLite corruption/reopen and native configuration import, disposable profile and fixture directory. No real user data, credentials or remote services.', limits: ['Requires a previously exported valid LVX JSON archive; recovery does not reconstruct data absent from that archive.', 'Original SQLite and journals are preserved in private project storage; this UI does not attempt forensic repair.', 'Checksums establish integrity, not authorship. Imported executable content remains blocked pending explicit review.', 'SQLite commit and restoration of native runtime configuration/evidence are separate host steps; real host warnings remain visible before opening the recovered project.'], parentReview: 'Manual REVIEW and independent gate rerun remain parent-owned.' };
  fs.mkdirSync(path.join(root, 'docs/verification'), { recursive: true }); fs.writeFileSync(path.join(root, 'docs/verification/roadmap-recovery.json'), JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(drift, [], 'Recovery source/dependencies changed during actual verification');
});
