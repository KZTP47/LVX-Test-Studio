'use strict';
const crypto = require('node:crypto');
const workflow = require('./workflow.cjs');
const tests = require('./test-source.cjs');
const remoteModule = require('./remote.cjs');
const hash = source => crypto.createHash('sha256').update(source).digest('hex');
function validPath(path) {
  if (typeof path !== 'string' || !path || /[\\\x00-\x1f\x7f:]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw Error('Use a relative repository file path without traversal or control characters.');
  return path;
}
const active = files => files.filter(file => !file.isDeleted);
function demoFiles() {
  const first = require('../../github-workflow-model.js').examples()[0];
  const source = first.workflows[0].source.replace('on: [push, pull_request]', 'on: [push, pull_request, workflow_call]').replace('npm test', 'npm run check:all');
  return [
    { path: '.github/workflows/ci.yml', content: '# Repository checks — keep this comment\n' + source, kind: 'workflow' },
    { path: '.github/workflows/release.yaml', content: first.workflows[1].source.replace('example/shared/.github/workflows/check.yml@main', './.github/workflows/ci.yml'), kind: 'workflow' },
    { path: 'tests/login.spec.ts', kind: 'test', content: "import { test, expect } from '@playwright/test';\n\n// Login helpers stay untouched by case edits.\ntest.describe('Account', () => {\n  test('sign in @smoke', async ({ page }) => {\n    await page.goto('/login');\n    await expect(page.getByRole('heading')).toHaveText('Sign in');\n  });\n});\n" },
    { path: 'tests/checkout.spec.ts', kind: 'test', content: "import { test, expect } from '@playwright/test';\n\ntest('checkout @regression', async ({ page }) => {\n  await page.goto('/checkout');\n  await expect(page.getByRole('button', { name: 'Pay' })).toBeVisible();\n});\n" },
    { path: 'src/price.test.ts', kind: 'test', content: "import { describe, it, expect } from 'vitest';\n\nconst tax = (price: number) => price * 1.2;\ndescribe('Pricing', () => {\n  it('adds tax @unit', () => {\n    expect(tax(10)).toBe(12);\n  });\n});\n" },
    { path: 'package.json', kind: 'context', content: JSON.stringify({ name: 'lvx-offline-example', scripts: { test: 'vitest run', 'check:all': 'vitest run && playwright test' }, devDependencies: { '@playwright/test': '^1.58.0', vitest: '^3.0.0' } }, null, 2) + '\n' }
  ].map(file => ({ ...file, originalContent: file.content, mode: '100644', sha: null }));
}
function createService(options = {}) {
  const getSelectedRoot = options.getWorkspaceRoot;
  let bindingRoot = getSelectedRoot?.(), closed = false;
  options = { ...options, getWorkspaceRoot: () => !closed && getSelectedRoot?.() === bindingRoot ? bindingRoot : null };
  const rawWorkspace = options.workspace;
  if (rawWorkspace) options = { ...options, workspace: { async handle(action, payload) {
    if (!payload.workspaceRoot || payload.workspaceRoot !== options.getWorkspaceRoot?.()) throw Error('Project folder changed before repository data could be saved. Reopen its original project to recover the operation.');
    return rawWorkspace.handle(action, payload);
  } } };
  const remote = remoteModule.createService(options);
  const demos = new Map();
  const initializingDemos = new Map();
  function requireBinding(payload) {
    const root = options.getWorkspaceRoot?.();
    if (!root || payload.workspaceRoot !== root) throw Error('Reopen GitHub Actions in the selected project folder.');
    return root;
  }
  async function forRepo(payload) {
    if (!payload.simulated) return remote;
    const name = payload.repository || payload.fullName || 'example/web-client';
    const key = payload.workspaceRoot + ':' + name;
    if (initializingDemos.has(key)) return initializingDemos.get(key);
    if (!demos.has(key)) {
      const initialization = (async () => {
      const { createDemoTransport } = require('./demo-remote.cjs');
      const transport = createDemoTransport({ repository: name, defaultBranch: 'main', files: demoFiles() });
      const collection = 'github-studio-demo-remotes', id = hash(name).slice(0, 40), root = payload.workspaceRoot;
      let record = options.workspace ? await options.workspace.handle('read', { workspaceRoot: root, collection, id }) : null;
      const mapNames = ['blobs', 'trees', 'commits', 'refs', 'pulls', 'runs', 'jobs'];
      if (record) {
        if (record.value.repository !== name || !mapNames.every(field => Array.isArray(record.value[field]))) throw Error('Offline repository state is invalid. Restore a project backup before publishing.');
        for (const field of mapNames) transport.state[field] = new Map(record.value[field]);
        for (const field of ['nextPR', 'initialCommit', 'mergeBlocked']) transport.state[field] = record.value[field];
      }
      async function persist() {
        if (!options.workspace) return;
        if (options.getWorkspaceRoot?.() !== root) throw Error('Project changed while saving the offline repository.');
        const value = { repository: name, ...Object.fromEntries(mapNames.map(field => [field, [...transport.state[field]]])), nextPR: transport.state.nextPR, initialCommit: transport.state.initialCommit, mergeBlocked: transport.state.mergeBlocked };
        const saved = await options.workspace.handle('transact', { workspaceRoot: root, records: [{ collection, id, value, expectedRevision: record?.revision ?? null }] });
        record = { revision: saved.changes.find(change => change.id === id).revision };
      }
      if (!record) await persist();
      const fetch = async (url, init = {}) => { const response = await transport(url, init); if (init.method && !['GET', 'HEAD'].includes(init.method)) await persist(); return response; };
      fetch.simulated = true;
      demos.set(key, remoteModule.createService({ ...options, request: fetch, fetch }));
      return demos.get(key);
      })();
      initializingDemos.set(key, initialization);
      try { return await initialization; } finally { initializingDemos.delete(key); }
    }
    return demos.get(key);
  }
  function checkSource(payload) {
    if (typeof payload.source !== 'string') throw Error('Use source text.');
    if (payload.expectedHash && hash(payload.source) !== payload.expectedHash) throw Error('Source changed since this form was opened. Reload the file.');
  }
  return {
    async handle(action, payload = {}) {
      const binding = requireBinding(payload);
      let result;
      if (action === 'apiValidateTest') { require('../api-atlas/runner.cjs').validateDefinition(payload.test); if(payload.test.schema !== undefined) await require('../api-atlas/runner.cjs').schemaValidate(payload.test.schema, null, payload.test.dialect); result = { valid: true }; }
      else if (action === 'apiDiscover') result = await require('../api-atlas/discovery.cjs').discover(payload.repositories);
      else if (action === 'workflowInspect') { checkSource(payload); result = workflow.inspectWorkflow(payload.source); }
      else if (action === 'workflowEdit') { checkSource(payload); result = workflow.editWorkflow(payload.source, payload.operation); }
      else if (action === 'matrix') result = workflow.expandMatrix(payload.matrix, { limit: payload.limit ?? 100, offset: payload.offset ?? 0 });
      else if (action === 'discoverTests') { checkSource(payload); validPath(payload.path); result = await tests.discover({ ...payload, frameworkHint: payload.frameworkHint || undefined }); }
      else if (action === 'editTest') { checkSource(payload); validPath(payload.path); result = await tests.mutate({ ...payload, expectedFingerprint: payload.expectedHash, frameworkHint: payload.frameworkHint || undefined }); }
      else if (action === 'repositoryTests') {
        const files = active(payload.files || []);
        const candidates = files.filter(file => file.kind === 'test');
        const discoveries = [];
        for (const file of candidates) { validPath(file.path); discoveries.push(await tests.discover({ path: file.path, source: file.content, frameworkHint: file.frameworkHint })); }
        const mapping = await tests.inferLinks({ workflows: files.filter(file => file.kind === 'workflow').map(file => ({ path: file.path, source: file.content })), files: candidates.map(file => ({ path: file.path, source: file.content, frameworkHint: file.frameworkHint })), packageSources: files.filter(file => /(^|\/)package\.json$/.test(file.path)).map(file => ({ path: file.path, source: file.content })) });
        result = { discoveries, mapping };
      } else if (action === 'createTestFile') {
        validPath(payload.path);
        if (remoteModule.classify(payload.path) !== 'test') throw Error('Use a recognized test path, such as tests/check.spec.ts, src/check.test.ts, test_check.py, or ExampleTests.cs.');
        if ((payload.paths || []).some(path => path.toLowerCase() === payload.path.toLowerCase())) throw Error('A file with this path already exists. Choose another name.');
        const content = await tests.scaffold({ path: payload.path, framework: payload.framework, title: payload.title, bodySource: payload.bodySource, tags: payload.tags || [] });
        const source = typeof content === 'string' ? content : content.source;
        const validation = await tests.discover({ path: payload.path, source, frameworkHint: payload.framework });
        if ((validation.diagnostics || []).some(item => item.severity === 'error')) throw Error('The new test source is invalid: ' + validation.diagnostics.filter(item => item.severity === 'error').map(item => item.message).join(' '));
        const changed = [{ path: payload.path, content: source, originalContent: null, sha: null, kind: 'test', mode: '100644', frameworkHint: payload.framework }];
        if (payload.wire) {
          const wire = payload.wire; validPath(wire.path);
          const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
          if (/[^a-zA-Z0-9_./-]/.test(payload.path)) throw Error('Automatic CI wiring supports simple file paths. Save the file without wiring and review its shell command manually.');
          const commands = { playwright: 'npx playwright test ' + quote(payload.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), vitest: 'npx vitest run ' + quote(payload.path), jest: 'npx jest --runTestsByPath ' + quote(payload.path), pytest: 'python -m pytest ' + quote(payload.path), unittest: 'python -m unittest ' + quote(payload.path.replace(/\.py$/, '').replaceAll('/', '.')), robot: 'python -m robot ' + quote(payload.path), nunit: 'dotnet test', xunit: 'dotnet test', mstest: 'dotnet test' };
          if (!commands[payload.framework]) throw Error('Choose a known test framework for automatic CI wiring.');
          const edited = workflow.editWorkflow(wire.source, { type: 'addStep', jobId: wire.jobId, value: { name: 'Run ' + payload.path, run: commands[payload.framework], 'working-directory': '.' } });
          changed.push({ path: wire.path, content: edited.source, expectedSource: wire.source });
        }
        result = { files: changed };
      } else if (action === 'demo') {
        const repository = payload.repository || 'example/web-client';
        result = await (await forRepo({ ...payload, repository, simulated: true })).handle('snapshot', { ...payload, repository, ref: 'main' });
        result.example = true;
      } else {
        const stagedPaths = payload.stagedPaths || (payload.files || []).filter(file => file.staged).map(file => file.path);
        if (action === 'previewStage') for (const file of (payload.files || []).filter(file => stagedPaths.includes(file.path) && !file.isDeleted)) {
          if (file.conflict) throw Error('Review the remote baseline conflict for ' + file.path + ' before staging it.');
          const kind = remoteModule.classify(file.path);
          const validation = kind === 'workflow' ? workflow.inspectWorkflow(file.content) : kind === 'test' ? await tests.discover({ path: file.path, source: file.content, frameworkHint: file.frameworkHint }) : null;
          const errors = (validation?.diagnostics || []).filter(item => item.severity === 'error');
          if (errors.length) throw Error('Fix ' + file.path + ' before publishing: ' + errors.map(item => item.message).join(' '));
        }
        result = await (await forRepo(payload)).handle(action, payload);
      }
      if (binding !== options.getWorkspaceRoot?.()) throw Error('Project folder changed during the operation. Reopen the repository.');
      return result;
    },
    async setWorkspace(root) { bindingRoot = root; await remote.setWorkspace?.(root); await Promise.allSettled(initializingDemos.values()); for (const demo of demos.values()) await demo.close?.(); demos.clear(); },
    async close() { closed = true; await remote.close?.(); await Promise.allSettled(initializingDemos.values()); for (const demo of demos.values()) await demo.close?.(); demos.clear(); }
  };
}
module.exports = { createService, demoFiles, validPath };
