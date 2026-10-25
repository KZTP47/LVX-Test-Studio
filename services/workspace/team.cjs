'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const { WorkspaceError, key, sha256 } = require('./store.cjs');

function identity(row) { return { id: row.id, workspaceId: row.tenant, name: row.name, role: row.role, revoked: !!row.revoked, created: row.created }; }
function createIdentity(store, { name, role = 'viewer', workspaceId = 'default' }) {
  key(workspaceId, 'Team workspace id');
  if (typeof name !== 'string' || !name.trim() || name.length > 200 || !['owner', 'editor', 'viewer'].includes(role)) throw new WorkspaceError('VALIDATION', 'Identity needs a name and owner/editor/viewer role.');
  const token = crypto.randomBytes(32).toString('base64url');
  const row = { id: crypto.randomUUID(), tenant: workspaceId, name: name.trim(), role, token_hash: sha256(token), revoked: 0, created: new Date().toISOString() };
  store.db.prepare('INSERT INTO identities VALUES(?,?,?,?,?,?,?)').run(row.id, row.tenant, row.name, row.role, row.token_hash, 0, row.created);
  return { identity: identity(row), token };
}
// Keep API routing separate from local desktop actions. Every request is authenticated;
// the namespace is derived from the verified identity, never from request data.
function createTeam(store, emit = () => {}) {
  let server, activeWorkspace;
  const namespace = tenant => `team.${sha256(tenant).slice(0, 20)}.`;
  function externalRecord(record, prefix) {
    const value = structuredClone(record.value);
    if (Array.isArray(value?.dependencies)) value.dependencies = value.dependencies.map(ref => ({ ...ref, collection: ref.collection.startsWith(prefix) ? ref.collection.slice(prefix.length) : ref.collection }));
    return { ...record, collection: record.collection.slice(prefix.length), value };
  }
  function internalRecord(record, prefix) {
    const value = structuredClone(record.value);
    if (value?.dependencies !== undefined) {
      if (!Array.isArray(value.dependencies)) throw new WorkspaceError('VALIDATION', 'Record dependencies must be an array.');
      value.dependencies = value.dependencies.map(ref => ({ collection: `${prefix}${key(ref.collection, 'Dependency collection')}`, id: key(ref.id, 'Dependency id') }));
    }
    return { ...record, collection: `${prefix}${key(record.collection, 'Collection')}`, value };
  }
  function listIdentities(workspaceId = activeWorkspace || 'default') { return { identities: store.db.prepare('SELECT * FROM identities WHERE tenant=? ORDER BY created,id').all(key(workspaceId, 'Team workspace id')).map(identity) }; }
  function revoke({ id, workspaceId = activeWorkspace || 'default' }) {
    key(id, 'Identity id'); key(workspaceId, 'Team workspace id');
    const row = store.db.prepare('SELECT * FROM identities WHERE id=? AND tenant=?').get(id, workspaceId);
    if (!row) throw new WorkspaceError('NOT_FOUND', 'Identity was not found in this team workspace.');
    if (row.role === 'owner' && !row.revoked && store.db.prepare("SELECT COUNT(*) AS count FROM identities WHERE tenant=? AND role='owner' AND revoked=0").get(workspaceId).count <= 1) throw new WorkspaceError('LAST_OWNER', 'Create another owner before revoking the last owner.');
    store.db.prepare('UPDATE identities SET revoked=1 WHERE id=? AND tenant=?').run(id, workspaceId);
    return { status: 'SUCCESS', id, revoked: true };
  }
  async function body(request) {
    if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw new WorkspaceError('VALIDATION', 'Content-Type must be application/json.');
    const chunks = []; let length = 0;
    for await (const chunk of request) { length += chunk.length; if (length > 2 * 1024 * 1024) throw new WorkspaceError('PAYLOAD_TOO_LARGE', 'Request exceeds 2 MiB.'); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new WorkspaceError('VALIDATION', 'Request must contain valid JSON.'); }
  }
  async function route(request, response) {
    let requestPrefix;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    try {
      if (request.headers.origin) throw new WorkspaceError('FORBIDDEN', 'Browser cross-origin requests are disabled.');
      const auth = /^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(request.headers.authorization || '');
      const user = auth && store.db.prepare('SELECT * FROM identities WHERE token_hash=? AND revoked=0').get(sha256(auth[1]));
      if (!user) throw new WorkspaceError('UNAUTHORIZED', 'A valid team identity token is required.');
      const url = new URL(request.url, 'http://127.0.0.1');
      const match = /^\/v1\/workspaces\/([^/]+)\/(records|transact|identities|revoke)$/.exec(url.pathname);
      if (!match) throw new WorkspaceError('NOT_FOUND', 'Unknown team API route.');
      const tenant = decodeURIComponent(match[1]);
      if (tenant !== user.tenant) throw new WorkspaceError('FORBIDDEN', 'Identity is not authorized for this workspace.');
      const action = match[2];
      const prefix = namespace(tenant);
      requestPrefix = prefix;
      let result;
      if (request.method === 'GET' && action === 'records') {
        const collection = url.searchParams.get('collection');
        if (collection) {
          const found = store.list(`${prefix}${key(collection, 'Collection')}`);
          result = { ...found, records: found.records.map(record => externalRecord(record, prefix)) };
        } else {
          const found = store.list();
          result = { revision: found.revision, records: found.records.filter(record => record.collection.startsWith(prefix)).map(record => externalRecord(record, prefix)) };
        }
      } else if (request.method === 'POST' && action === 'transact') {
        if (!['owner', 'editor'].includes(user.role)) throw new WorkspaceError('FORBIDDEN', 'Viewer identities cannot change records.');
        const payload = await body(request);
        if (!Array.isArray(payload.records)) throw new WorkspaceError('VALIDATION', 'Transaction records are required.');
        const records = payload.records.map(record => internalRecord(record, prefix));
        result = store.transact(records);
        result.changes = result.changes.map(change => ({ ...change, collection: change.collection.slice(prefix.length) }));
        emit({ domain: 'workspace', type: 'changed', revision: result.revision, teamWorkspace: tenant, changes: result.changes });
      } else if (action === 'identities' && user.role === 'owner' && request.method === 'GET') result = listIdentities(tenant);
      else if (action === 'identities' && user.role === 'owner' && request.method === 'POST') {
        const payload = await body(request);
        result = createIdentity(store, { name: payload.name, role: payload.role, workspaceId: tenant });
      } else if (action === 'revoke' && user.role === 'owner' && request.method === 'POST') result = revoke({ id: (await body(request)).id, workspaceId: tenant });
      else throw new WorkspaceError('FORBIDDEN', 'This role cannot perform that action.');
      response.writeHead(200); response.end(JSON.stringify(result));
    } catch (error) {
      const code = { UNAUTHORIZED: 401, FORBIDDEN: 403, CONFLICT: 409, NOT_FOUND: 404, PAYLOAD_TOO_LARGE: 413 }[error.code] || 400;
      const details = error.details ? structuredClone(error.details) : undefined;
      if (requestPrefix && details?.current) details.current = externalRecord(details.current, requestPrefix);
      if (requestPrefix && details?.collection?.startsWith(requestPrefix)) details.collection = details.collection.slice(requestPrefix.length);
      response.writeHead(code); response.end(JSON.stringify({ error: { code: error.code || 'ERROR', message: error.message, details } }));
    }
  }
  return {
    async start({ port = 0, workspaceId = 'default', ownerName = 'Workspace owner' } = {}) {
      if (server) throw new WorkspaceError('TEAM_RUNNING', 'Stop the current team service before starting another.');
      if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new WorkspaceError('VALIDATION', 'Port must be 0–65535.');
      key(workspaceId, 'Team workspace id');
      if (typeof ownerName !== 'string' || !ownerName.trim() || ownerName.length > 200) throw new WorkspaceError('VALIDATION', 'Owner name must contain 1–200 characters.');
      const candidate = http.createServer((request, response) => { void route(request, response); });
      candidate.requestTimeout = 15000; candidate.headersTimeout = 10000;
      await new Promise((resolve, reject) => { candidate.once('error', reject); candidate.listen(port, '127.0.0.1', resolve); });
      server = candidate; activeWorkspace = workspaceId;
      let owner;
      try { owner = createIdentity(store, { name: ownerName, role: 'owner', workspaceId }); }
      catch (error) { await this.stop(); throw error; }
      return { status: 'SUCCESS', ...this.status(), owner: owner.identity, ownerToken: owner.token, sharing: 'loopback-only', note: 'Tokens grant access only on this computer. Remote sharing requires an explicitly configured secure tunnel or deployment.' };
    },
    status() { return { running: !!server, url: server ? `http://127.0.0.1:${server.address().port}` : null, workspaceId: activeWorkspace || null, authentication: 'bearer-sha256', binding: '127.0.0.1' }; },
    async stop() { if (server) { const current = server; server = null; current.closeAllConnections(); await new Promise((resolve, reject) => current.close(error => error ? reject(error) : resolve())); } return { status: 'SUCCESS', running: false }; },
    create(payload) { return createIdentity(store, { ...payload, workspaceId: payload.workspaceId || activeWorkspace || 'default' }); },
    list: listIdentities,
    revoke
  };
}
module.exports = { createTeam, createIdentity };
