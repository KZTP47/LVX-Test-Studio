'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { parseDocument } = require('yaml');
const model = require('../github-workflow-model.js');
const graph = source => model.workflowGraph(source, parseDocument);
const sha = char => char.repeat(40);
function transport({ empty = false, failBlob = false, truncated = false } = {}) {
  const calls = [], source = '# Keep my comment\nname: Vérification\non: [push, pull_request]\njobs:\n  build:\n    runs-on: ubuntu-latest\n';
  const request = async (url, options) => {
    calls.push({ url, options }); const path = new URL(url).pathname.split('/sample')[1];
    const routes = {
      '': { default_branch: 'feature/ci' },
      '/commits/feature%2Fci': { sha: sha('a'), commit: { tree: { sha: sha('b') } } },
      ['/git/trees/' + sha('b')]: { tree: empty ? [] : [{ path: '.github', type: 'tree', sha: sha('c') }], truncated },
      ['/git/trees/' + sha('c')]: { tree: [{ path: 'workflows', type: 'tree', sha: sha('d') }] },
      ['/git/trees/' + sha('d')]: { tree: [{ path: 'ci.yml', type: 'blob', sha: sha('e'), size: 200 }, { path: 'release.yaml', type: 'blob', sha: sha('f'), size: 200 }, { path: 'nested', type: 'tree', sha: sha('f') }] },
      ['/git/blobs/' + sha('e')]: { encoding: 'base64', content: Buffer.from(source).toString('base64') },
      ['/git/blobs/' + sha('f')]: { encoding: 'base64', content: Buffer.from(source).toString('base64') }
    };
    if (failBlob && path.endsWith('/' + sha('f'))) return new Response('{}', { status: 403 });
    assert.ok(routes[path], path); return Response.json(routes[path]);
  };
  return { request, calls, source };
}
test('GitHub workflow graphs preserve on triggers, scalar/array needs and nonoverlapping fork/join layout', () => {
  const source = model.examples()[1].workflows[0].source, result = graph(source);
  assert.deepEqual(result.triggers, ['push', 'workflow_dispatch']); assert.equal(result.nodes.length, 4); assert.equal(result.edges.length, 4);
  const byId = new Map(result.nodes.map(node => [node.id, node]));
  assert.ok(byId.get('prepare').x < byId.get('unit').x); assert.ok(byId.get('unit').x < byId.get('report').x);
  assert.notEqual(byId.get('unit').y, byId.get('browser').y); assert.equal(byId.get('unit').kind, 'Matrix job'); assert.equal(byId.get('browser').test, true);
  assert.equal(new Set(result.nodes.map(node => node.x + ':' + node.y)).size, result.nodes.length);
  assert.equal(graph(model.examples()[2].workflows[0].source).nodes[0].kind, 'Reusable workflow');
});
test('GitHub workflow invalid YAML, duplicate keys, cycles, unknown/dynamic needs and aliases are truthful', () => {
  assert.throws(() => graph('jobs: [broken'), /flow|sequence|end/i);
  assert.throws(() => graph('jobs:\n  one: {}\n  one: {}'), /unique/i);
  assert.throws(() => graph('name: No jobs'), /jobs mapping/);
  assert.throws(() => graph('jobs: &cycle\n  one: *cycle'), /Cyclic YAML/);
  const cycle = graph('jobs:\n  a: {needs: b}\n  b: {needs: a}'); assert.match(cycle.diagnostics.join(' '), /cycle/); assert.equal(cycle.nodes.every(node => node.blocked), true);
  const broken = graph('jobs:\n  a:\n    needs: [missing, "${{ inputs.job }}"]'); assert.equal(broken.edges.length, 0); assert.match(broken.diagnostics.join(' '), /missing job/); assert.match(broken.diagnostics.join(' '), /dynamic/);
  assert.equal(graph('#' + 'x'.repeat(600 * 1024) + '\njobs: {a: {}}').nodes.length, 1);
});
test('GitHub repository input rejects credential URLs, nested URLs, traversal and non-GitHub hosts', () => {
  assert.equal(model.repositoryName('https://github.com/owner/repository.git/'), 'owner/repository');
  for (const invalid of ['owner', 'owner/..', 'https://user:password@github.com/owner/repo', 'https://example.com/owner/repo', 'https://github.com/owner/repo/tree/main', 'https://github.com/owner/repo?token=x']) assert.throws(() => model.repositoryName(invalid));
});
test('GitHub import resolves default branch and pins UTF-8 source and directories to immutable SHA with read-only requests', async () => {
  const t = transport(), repo = await model.importRepository({ repository: 'org/sample', request: t.request });
  assert.equal(repo.ref, 'feature/ci'); assert.equal(repo.commit, sha('a')); assert.equal(repo.workflows.length, 2); assert.equal(repo.workflows[0].source, t.source);
  assert.ok(t.calls.some(call => call.url.endsWith('/commits/feature%2Fci'))); assert.ok(t.calls.every(call => !call.options.method || call.options.method === 'GET'));
  assert.equal(repo.selected, '.github/workflows/ci.yml'); model.validateBoard({ version: 1, repositories: [repo] });
});
test('GitHub import represents workflowless repositories, rejects partial/truncated imports and requires protected auth', async () => {
  const empty = await model.importRepository({ repository: 'org/sample', request: transport({ empty: true }).request }); assert.deepEqual(empty.workflows, []); assert.equal(empty.selected, '');
  for (const options of [{ failBlob: true }, { truncated: true }]) await assert.rejects(model.importRepository({ repository: 'org/sample', request: transport(options).request }), /GitHub|incomplete/);
  await assert.rejects(model.importRepository({ repository: 'org/sample', token: 'raw-pat', request: transport().request }), /protected/);
  const t = transport(), token = 'secret:11111111-1111-4111-8111-111111111111'; await model.importRepository({ repository: 'org/sample', token, request: t.request }); assert.equal(t.calls[0].options.headers.Authorization, 'Bearer ' + token);
});
test('GitHub board validation preserves independent YAML selections and prevents ambiguous stored identities', () => {
  const repositories = model.examples(); repositories[0].selected = '.github/workflows/release.yaml';
  const board = model.validateBoard({ version: 1, repositories }); assert.equal(board.repositories[1].selected, '.github/workflows/ci.yml');
  assert.throws(() => model.validateBoard({ version: 1, repositories: [repositories[0], repositories[0]] }), /identities/);
  const corrupt = structuredClone(board); corrupt.repositories[0].selected = 'missing'; assert.throws(() => model.validateBoard(corrupt), /selection/);
});
