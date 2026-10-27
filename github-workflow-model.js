/* Static GitHub Actions source models. Never execute imported workflow code. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LVXGitHubWorkflows = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  // Compatibility metadata: zero denotes no application capacity ceiling.
  const LIMITS = Object.freeze({ repositories: 0, workflows: 0, sourceBytes: 0, snapshotBytes: 0, jobs: 0 });
  const bytes = text => new TextEncoder().encode(text).length;
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const expression = value => typeof value === 'string' && value.includes('${{');
  function repositoryName(input) {
    let name = String(input || '').trim();
    if (/^https:\/\//i.test(name)) {
      const url = new URL(name);
      if (url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) throw Error('Use a github.com repository URL or owner/repository.');
      name = url.pathname.replace(/^\/+|\/+$/g, '');
    }
    name = name.replace(/\.git$/, '');
    if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})\/[a-zA-Z0-9_.-]{1,100}$/.test(name) || ['.', '..'].includes(name.split('/')[1])) throw Error('Enter a repository as owner/repository or https://github.com/owner/repository.');
    return name;
  }
  function workflowGraph(source, parseDocument) {
    if (typeof source !== 'string') throw Error('Workflow source must be text.');
    const doc = parseDocument(source, { version: '1.2', uniqueKeys: true, stringKeys: true });
    if (doc.errors.length) throw Error(doc.errors.map(error => error.message).join('\n'));
    const data = doc.toJS({ maxAliasCount: -1 });
    try { JSON.stringify(data); } catch { throw Error('Cyclic YAML aliases cannot be displayed. Inspect the workflow source.'); }
    if (!object(data) || !object(data.jobs)) throw Error('This YAML needs a jobs mapping to display a GitHub Actions workflow.');
    const entries = Object.entries(data.jobs);
    const diagnostics = doc.warnings.map(warning => warning.message), nodes = [], edges = [];
    for (const [id, value] of entries) {
      if (!object(value)) { diagnostics.push('Job ' + id + ' must be a mapping.'); continue; }
      let needs = value.needs == null ? [] : Array.isArray(value.needs) ? value.needs : [value.needs];
      needs = [...new Set(needs.map(need => {
        if (typeof need !== 'string') { diagnostics.push('Job ' + id + ' has a dependency that is not a job ID.'); return ''; }
        if (expression(need)) { diagnostics.push('Job ' + id + ' has a dynamic dependency; its edge cannot be resolved statically.'); return ''; }
        return need;
      }).filter(Boolean))];
      const steps = Array.isArray(value.steps) ? value.steps : [];
      nodes.push({ id, name: String(value.name || id), needs, steps, value,
        kind: value.uses ? 'Reusable workflow' : value.strategy?.matrix ? 'Matrix job' : 'Job',
        test: steps.some(step => object(step) && /\b(playwright|vitest|jest|pytest|cypress)\b|\bdotnet\s+test\b/.test(String(step.run || ''))) });
    }
    const byId = new Map(nodes.map(node => [node.id, node])), indegree = new Map(nodes.map(node => [node.id, 0]));
    for (const node of nodes) for (const need of node.needs) {
      if (!byId.has(need)) diagnostics.push('Job ' + node.id + ' needs missing job ' + need + '.');
      else { edges.push({ source: need, target: node.id }); indegree.set(node.id, indegree.get(node.id) + 1); }
    }
    const levels = new Map(nodes.map(node => [node.id, 0])), queue = nodes.filter(node => !indegree.get(node.id)).map(node => node.id), outgoing = new Map();
    for (const edge of edges) { const list = outgoing.get(edge.source) || []; list.push(edge); outgoing.set(edge.source, list); }
    for (let i = 0; i < queue.length; i++) for (const edge of outgoing.get(queue[i]) || []) {
      levels.set(edge.target, Math.max(levels.get(edge.target), levels.get(edge.source) + 1));
      indegree.set(edge.target, indegree.get(edge.target) - 1);
      if (!indegree.get(edge.target)) queue.push(edge.target);
    }
    if (queue.length < nodes.length) {
      diagnostics.push('Dependency cycle detected. Jobs in or downstream of the cycle are shown in the last column; this workflow cannot be ordered.');
      const last = [...levels.values()].reduce((max, value) => Math.max(max, value), 0) + 1;
      for (const node of nodes) if (indegree.get(node.id)) { levels.set(node.id, last); node.blocked = true; }
    }
    const rows = new Map();
    for (const node of nodes) {
      const level = levels.get(node.id), row = rows.get(level) || 0;
      node.x = 28 + level * 282; node.y = 28 + row * 112; rows.set(level, row + 1);
    }
    const trigger = data.on;
    const triggers = typeof trigger === 'string' ? [trigger] : Array.isArray(trigger) ? trigger.map(String) : object(trigger) ? Object.keys(trigger) : [];
    return { name: String(data.name || 'Unnamed workflow'), triggers, nodes, edges, diagnostics,
      width: nodes.reduce((max, node) => Math.max(max, node.x + 236), 500), height: nodes.reduce((max, node) => Math.max(max, node.y + 112), 150) };
  }
  async function importRepository({ repository, ref = '', token = '', request = fetch, signal }) {
    const fullName = repositoryName(repository), base = 'https://api.github.com/repos/' + fullName;
    ref = String(ref).trim();
    if (/[\x00-\x1f\x7f]/.test(ref)) throw Error('Use a branch, tag or commit without control characters.');
    if (token && !/^secret:[a-f0-9-]{36}$/.test(token)) throw Error('Use a protected desktop GitHub credential.');
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: 'Bearer ' + token } : {}) };
    const get = async path => {
      const response = await request(base + path, { headers, signal, redirect: 'error' });
      if (!response.ok) {
        const messages = { 401: 'GitHub rejected the sign-in. Replace the token and try again.', 403: 'GitHub denied access or its rate limit was reached. Check repository access or try again later.', 404: 'Repository or ref not found, or your sign-in cannot read it.', 429: 'GitHub rate limit reached. Try again later.' };
        throw Error(messages[response.status] || 'GitHub request failed (HTTP ' + response.status + '). Try importing again.');
      }
      return response.json();
    };
    const metadata = await get(''), branch = ref || metadata.default_branch;
    if (!branch) throw Error('This repository has no default branch or commits yet.');
    const commit = await get('/commits/' + encodeURIComponent(branch));
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit.sha || '') || !commit.commit?.tree?.sha) throw Error('GitHub did not return an immutable commit. Try again.');
    const tree = async sha => {
      const result = await get('/git/trees/' + encodeURIComponent(sha));
      if (result.truncated || !Array.isArray(result.tree)) throw Error('GitHub returned an incomplete directory. No workflows were imported.');
      return result.tree;
    };
    const root = await tree(commit.commit.tree.sha), github = root.find(entry => entry.path === '.github' && entry.type === 'tree');
    let files = [];
    if (github) {
      const folder = (await tree(github.sha)).find(entry => entry.path === 'workflows' && entry.type === 'tree');
      if (folder) files = (await tree(folder.sha)).filter(entry => entry.type === 'blob' && /\.ya?ml$/i.test(entry.path));
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    const workflows = []; let total = 0;
    // Bounded batches keep API pressure low; every file must succeed before the lane is saved.
    for (let start = 0; start < files.length; start += 4) {
      const batch = await Promise.all(files.slice(start, start + 4).map(async file => {
        const blob = await get('/git/blobs/' + encodeURIComponent(file.sha));
        if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw Error('GitHub returned unsupported or oversized source for ' + file.path + '.');
        const binary = atob(blob.content.replace(/\s/g, ''));
        const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
        return { path: '.github/workflows/' + file.path, sha: file.sha, source };
      }));
      for (const file of batch) workflows.push(file);
    }
    return { id: fullName.toLowerCase() + '@' + branch, fullName, ref: branch, commit: commit.sha, importedAt: new Date().toISOString(), workflows, selected: workflows[0]?.path || '', example: false };
  }
  function validateBoard(board) {
    if (!object(board) || board.version !== 1 || !Array.isArray(board.repositories)) throw Error('Saved GitHub repository view has an unsupported format.');
    const ids = new Set();
    for (const repo of board.repositories) {
      if (!object(repo) || typeof repo.id !== 'string' || ids.has(repo.id)) throw Error('Saved repository identities are invalid.');
      ids.add(repo.id); repositoryName(repo.fullName);
      if (typeof repo.ref !== 'string' || typeof repo.commit !== 'string' || !Array.isArray(repo.workflows)) throw Error('Saved repository source is invalid.');
      const paths = new Set(); let total = 0;
      for (const file of repo.workflows) {
        if (!object(file) || !/^\.github\/workflows\/[^/\\]+\.ya?ml$/i.test(file.path) || paths.has(file.path) || typeof file.source !== 'string') throw Error('Saved workflow source is invalid.');
        total += bytes(file.source); paths.add(file.path);
      }
      if ((repo.selected !== '' && !paths.has(repo.selected))) throw Error('Saved workflow selection or source size is invalid.');
    }
    return board;
  }
  function examples() {
    const simple = 'name: Build and test\non: [push, pull_request]\njobs:\n  install:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci\n  test:\n    needs: install\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n  package:\n    needs: test\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run build\n';
    const parallel = 'name: Checkout verification\non: [push, workflow_dispatch]\njobs:\n  prepare:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n  unit:\n    needs: prepare\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        node: [20, 22]\n    steps:\n      - run: npx vitest run\n  browser:\n    needs: prepare\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx playwright test\n  report:\n    needs: [unit, browser]\n    runs-on: ubuntu-latest\n    if: always()\n    steps:\n      - run: echo "Collect test reports"\n';
    const release = 'name: Release review\non: workflow_dispatch\njobs:\n  verify:\n    uses: example/shared/.github/workflows/check.yml@main\n  release:\n    needs: verify\n    runs-on: ubuntu-latest\n    environment: production\n    steps:\n      - run: echo "Release approved"\n';
    return ['web-client', 'checkout-api', 'shared-tools'].map((name, i) => ({ id: 'example:' + name, fullName: 'example/' + name, ref: 'main', commit: 'example snapshot', importedAt: '', example: true,
      selected: '.github/workflows/ci.yml', workflows: [{ path: '.github/workflows/ci.yml', source: [simple, parallel, release][i] }, { path: '.github/workflows/release.yaml', source: release }] }));
  }
  return { LIMITS, repositoryName, workflowGraph, importRepository, validateBoard, examples };
});
