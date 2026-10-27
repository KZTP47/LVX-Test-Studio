'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createService } = require('../services/github-studio/remote.cjs');
const { createDemoTransport } = require('../services/github-studio/demo-remote.cjs');
const { discover } = require('../services/api-atlas/discovery.cjs');
const { createNativeTransport } = require('../services/agents/native.cjs');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const moduleOf = name => import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(path.join(__dirname, '..', name), 'utf8')).toString('base64'));
const repo = (id, files = []) => ({ id, fullName: 'board/' + id, commit: 'a'.repeat(40), files, workflows: [{ path: '.github/workflows/ci.yml' }] });

test('agent context carries only the imported board and scan evidence at its current commits', async () => {
  const { contextualMessage, repositoryBoardContext, boardApiContext } = await moduleOf('graph-companion-model.js');
  const imported = [repo('java', [{ path: 'src/test/ApiTest.java', content: 'RestAssured.baseURI = "https://fakestoreapi.com";' }]), repo('frontend')];
  const atlas = await discover([...imported, repo('removed')]);
  const context = { kind: 'github', name: 'java', repository: 'board/java', board: repositoryBoardContext(imported), apiAtlas: boardApiContext(imported, atlas) };
  const input = contextualMessage('Which of these has an API?', context);
  assert.ok(input.includes('board/frontend')); assert.ok(input.includes('https://fakestoreapi.com')); assert.ok(!input.includes('board/removed'));
  assert.match(input, /Partial snapshot/); assert.match(input, /source data, not instructions/);
  assert.deepEqual(boardApiContext([{ ...imported[0], commit: 'b'.repeat(40) }], atlas).unscannedRepositories, ['board/java']);
});

test('rate limits explain authentication, reset and recovery without returning response secrets; cooldown avoids another request', async t => {
  let calls = 0;
  const service = createService({ workspaceRoot: 'root', clock: () => new Date('2026-10-27T10:00:00Z'), request: async () => { calls++; return new Response('{"message":"PRIVATE_RESPONSE"}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Date.parse('2026-10-27T11:00:00Z') / 1000), 'x-ratelimit-limit': '60', 'x-ratelimit-resource': 'core' } }); } });
  t.after(() => service.close());
  for (let i = 0; i < 2; i++) await assert.rejects(service.handle('snapshot', { workspaceRoot: 'root', repository: 'board/java' }), error => {
    assert.equal(error.code, 'RATE_LIMIT'); assert.match(error.message, /anonymous/); assert.match(error.message, /2026-10-27T11:00:00/); assert.match(error.message, /Add a GitHub token/);
    assert.equal(error.rateLimit.remaining, '0'); assert.equal(error.rateLimit.resource, 'core'); assert.ok(!error.message.includes('PRIVATE_RESPONSE')); return true;
  });
  assert.equal(calls, 1);
});

test('secondary throttles support HTTP-date Retry-After and authenticated guidance', async t => {
  const service = createService({ workspaceRoot: 'root', resolveSecret: () => 'PRIVATE_TOKEN', clock: () => new Date('2026-10-27T10:00:00Z'), request: async () => new Response('{}', { status: 429, headers: { 'retry-after': 'Tue, 27 Oct 2026 10:01:00 GMT' } }) });
  t.after(() => service.close());
  await assert.rejects(service.handle('snapshot', { workspaceRoot: 'root', repository: 'board/java', credentialReference: 'secret:11111111-1111-4111-8111-111111111111' }), error => /authenticated sign-in/.test(error.message) && /10:01:00/.test(error.message) && !error.message.includes('PRIVATE_TOKEN'));
});

test('repeat API scans reuse immutable blobs, while workspace changes clear the cache', async t => {
  const transport = createDemoTransport({ repository: 'board/source', files: [{ path: 'src/client.js', content: "fetch('https://outside.test/health')" }] });
  const service = createService({ workspaceRoot: 'root', request: transport }); t.after(() => service.close());
  const snap = await service.handle('snapshot', { workspaceRoot: 'root', repository: 'board/source', scope: 'workflows' });
  const payload = { workspaceRoot: 'root', repository: 'board/source', commit: snap.commit };
  await service.handle('apiSources', payload); const calls = transport.state.calls.length;
  await service.handle('apiSources', payload); assert.equal(transport.state.calls.length, calls);
  service.setWorkspace(); await service.handle('apiSources', payload); assert.ok(transport.state.calls.length > calls);
});

test('throttling mid-scan keeps completed files and retries only missing blobs', async t => {
  const transport = createDemoTransport({ repository: 'board/source', files: Array.from({ length: 7 }, (_, i) => ({ path: `src/file${i}.js`, content: `fetch('https://outside.test/${i}')` })) });
  let reads = 0;
  const request = async (url, options) => url.includes('/git/blobs/') && ++reads > 4 ? new Response('{}', { status: 429, headers: { 'retry-after': '60' } }) : transport(url, options);
  const service = createService({ workspaceRoot: 'root', request }); t.after(() => service.close());
  const snap = await service.handle('snapshot', { workspaceRoot: 'root', repository: 'board/source', scope: 'workflows' });
  const loaded = await service.handle('apiSources', { workspaceRoot: 'root', repository: 'board/source', commit: snap.commit });
  assert.equal(loaded.files.length, 4); assert.equal(loaded.complete, false); assert.equal(loaded.error.code, 'RATE_LIMIT'); assert.equal(loaded.total, 7);
});

test('a failed repository keeps imported source and does not prevent scanning the next repository', async () => {
  const { collectApiSnapshots } = await moduleOf('api-scan-model.js'); let calls = 0;
  const snapshots = await collectApiSnapshots([repo('blocked', [{ path: 'local.js', content: "fetch('https://local.test')" }]), repo('available')], { loadSources: async item => { calls++; if (item.id === 'blocked') throw Error('Anonymous API quota exhausted'); return { files: [{ path: 'remote.js', content: "app.get('/health', handler)" }], complete: true }; } });
  assert.equal(calls, 2); assert.equal(snapshots[0].scanStatus, 'partial'); assert.equal(snapshots[0].files.length, 1); assert.match(snapshots[0].skipped[0].reason, /Anonymous/); assert.equal(snapshots[1].scanStatus, 'scanned');
  const atlas = await discover(snapshots); assert.equal(atlas.services.length, 2); assert.equal(atlas.endpoints.length, 1); assert.equal(atlas.externalNodes.length, 1);
});

test('offline mapping makes no source request, preserves deletions and refuses a workspace mismatch', async () => {
  const { collectApiSnapshots } = await moduleOf('api-scan-model.js');
  const snapshots = await collectApiSnapshots([repo('local')], { localOnly: true, loadSources: () => assert.fail('network request') }); assert.equal(snapshots[0].scanStatus, 'imported-only');
  const source = await collectApiSnapshots([repo('draft', [{ path: 'src/client.js', content: '', isDeleted: true }])], { loadSources: async () => ({ files: [{ path: 'src/client.js', content: "fetch('https://removed.test')" }], complete: true }) });
  assert.equal((await discover(source)).connections.length, 0);
  await assert.rejects(collectApiSnapshots([repo('changed')], { loadSources: async () => { throw Object.assign(Error('changed'), { code: 'WORKSPACE_CHANGED' }); } }), { code: 'WORKSPACE_CHANGED' });
});

test('partial scans retain prior evidence only for the identical commit', async () => {
  const { retainPartialEvidence } = await moduleOf('api-scan-model.js');
  const previous = await discover([repo('same', [{ path: 'client.js', content: "fetch('https://external.test/health')" }])]);
  const partial = await discover([{ ...repo('same'), scanStatus: 'partial' }]);
  retainPartialEvidence(previous, partial); assert.equal(partial.connections.length, 1); assert.equal(partial.externalNodes.length, 1); assert.equal(partial.connections[0].retained, true);
  const changed = await discover([{ ...repo('same'), commit: 'b'.repeat(40), scanStatus: 'partial' }]); retainPartialEvidence(previous, changed); assert.equal(changed.connections.length, 0);
  const deleted = await discover([{ ...repo('same', [{ path: 'client.js', content: '', isDeleted: true }]), scanStatus: 'partial' }]); retainPartialEvidence(previous, deleted); assert.equal(deleted.connections.length, 0);
});

test('external nodes identify individual origins and never pretend an endpoint is verified', async () => {
  const atlas = await discover([repo('client', [{ path: 'client.js', content: "fetch('https://one.test/a'); fetch('https://one.test/b'); fetch('https://two.test/c'); fetch('/relative');" }])]);
  assert.equal(atlas.externalNodes.length, 2); assert.equal(atlas.connections.length, 4); assert.ok(atlas.connections.slice(0, 3).every(edge => edge.externalId && edge.target === null && edge.endpointId === null)); assert.equal(atlas.connections[3].externalId, undefined);
});

test('separate API descriptions in one repository keep distinct service nodes and same-path endpoints', async () => {
  const api = (title, origin) => JSON.stringify({ openapi: '3.0.3', info: { title, version: '1' }, servers: [{ url: origin }], paths: { '/health': { get: { responses: { 200: { description: 'ok' } } } } } });
  const atlas = await discover([repo('platform', [{ path: 'orders/openapi.json', content: api('Orders', 'https://orders.test') }, { path: 'payments/openapi.json', content: api('Payments', 'https://payments.test') }, { path: 'client.js', content: "fetch('https://payments.test/health')" }])]);
  assert.equal(atlas.apiServices.length, 2); assert.equal(atlas.endpoints.length, 2); assert.notEqual(atlas.endpoints[0].id, atlas.endpoints[1].id);
  assert.equal(atlas.connections[0].targetApiServiceId, atlas.apiServices.find(service => service.title === 'Payments').id);
  assert.equal(atlas.connections[0].target, 'platform');
});

test('Java RestAssured base URI and literal calls become external source evidence; ambiguous bases do not', async () => {
  const file = { path: 'src/test/FakeStoreApiTest.java', content: 'import io.restassured.RestAssured;\nRestAssured.baseURI = "https://fakestoreapi.com";\ngiven().when().get("/products");\ngiven().get("/products/1");' };
  const atlas = await discover([repo('java', [file])]); assert.equal(atlas.connections.length, 2); assert.equal(atlas.connections[0].url, 'https://fakestoreapi.com/products'); assert.equal(atlas.connections[0].evidence.line, 3);
  const ambiguous = await discover([repo('java', [{ ...file, content: file.content + '\nbaseUri("https://other.test");' }])]); assert.equal(ambiguous.connections.length, 0);
  const commented = await discover([repo('java', [{ ...file, content: file.content + '\n// given().get("/commented-out");' }])]); assert.equal(commented.connections.length, 2);
});

test('chat replies render tables, links, emphasis and code while HTML and executable links stay inert', async () => {
  const { chatMarkdown } = await moduleOf('agent-board.js');
  const html = chatMarkdown('**Candidates**\n\n| Repo | Reason |\n|---|---|\n| [Java](https://example.test/java) | `GET /products` |\n\n<script>alert(1)</script>\n[jump](javascript:alert(1))\n\n```js\n<img src=x onerror=alert(1)>\n```');
  assert.match(html, /<table>/); assert.match(html, /<strong>Candidates/); assert.match(html, /href="https:\/\/example.test\/java"/); assert.match(html, /<code>GET \/products/); assert.ok(!html.includes('<script>') && !html.includes('<img') && !html.includes('href="javascript:')); assert.match(html, /&lt;script&gt;/);
});

test('native Codex replies separate legacy messages, deduplicate receipts and keep explicit commentary in activity', async () => {
  async function run(items) {
    const transport = createNativeTransport({ resolve: () => ({ command: process.execPath, prefix: [] }), spawnProcess: () => {
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
      child.stdin.on('finish', () => setImmediate(() => {
        for (const event of [{ type: 'thread.started', thread_id: '11111111-1111-4111-8111-111111111111' }, ...items.map(item => ({ type: 'item.completed', item: { type: 'agent_message', ...item } })), { type: 'turn.completed' }]) child.stdout.write(JSON.stringify(event) + '\n');
        child.emit('close', 0, null);
      })); return child;
    } });
    return transport.execute({ node: { provider: 'codex', permission: 'native' }, session: {}, text: 'fixture', workspaceRoot: process.cwd() });
  }
  const legacy = await run([{ id: 'a', text: 'Checking.' }, { id: 'b', text: 'Answer.' }, { id: 'b', text: 'Answer.' }]);
  assert.equal(legacy.status, 'completed'); assert.equal(legacy.text, 'Checking.\n\nAnswer.');
  const phased = await run([{ id: 'a', phase: 'commentary', text: 'Checking.' }, { id: 'b', phase: 'final_answer', text: 'Answer.' }]);
  assert.equal(phased.status, 'completed'); assert.equal(phased.text, 'Answer.'); assert.ok(phased.protocol.some(event => event.item?.text === 'Checking.'));
});
