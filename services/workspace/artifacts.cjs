'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const { WorkspaceError, sha256, key, decodeBase64 } = require('./store.cjs');

function listArtifacts(store, { runId } = {}) {
  if (runId) key(runId, 'Run id');
  const where = runId ? 'WHERE a.run_id=?' : '';
  const query = store.db.prepare(`SELECT a.id,a.run_id,a.name,a.mime_type,length(a.data) AS bytes,a.checksum,a.created,p.run_id AS pinned FROM artifacts a LEFT JOIN pinned_runs p ON a.run_id=p.run_id ${where} ORDER BY a.created,a.id`);
  const artifacts = (runId ? query.all(runId) : query.all()).map(row => ({ id: row.id, runId: row.run_id, name: row.name, mimeType: row.mime_type, bytes: row.bytes, checksum: row.checksum, created: row.created, pinned: !!row.pinned }));
  const files = [store.filename, `${store.filename}-wal`, `${store.filename}-shm`];
  const diskBytes = files.reduce((sum, file) => sum + (fs.existsSync(file) ? fs.statSync(file).size : 0), 0);
  return { artifacts, ...store.usage(), diskBytes };
}
function putArtifact(store, { runId, name, mimeType = 'application/octet-stream', dataBase64 }) {
  key(runId, 'Run id');
  if (typeof name !== 'string' || !name || typeof mimeType !== 'string') throw new WorkspaceError('VALIDATION', 'Artifact needs a name and media type.');
  const data = decodeBase64(dataBase64);
  const artifact = { id: crypto.randomUUID(), runId, name, mimeType, bytes: data.length, checksum: sha256(data), created: new Date().toISOString() };
  store.transaction(() => { store.db.prepare('INSERT INTO artifacts VALUES(?,?,?,?,?,?,?)').run(artifact.id, runId, name, mimeType, data, artifact.checksum, artifact.created); store.bump(); });
  return { status: 'SUCCESS', artifact };
}
function readArtifact(store, { id }) {
  const artifact = store.db.prepare('SELECT * FROM artifacts WHERE id=?').get(key(id, 'Artifact id'));
  if (!artifact) throw new WorkspaceError('NOT_FOUND', 'Artifact no longer exists.');
  const data = Buffer.from(artifact.data);
  if (sha256(data) !== artifact.checksum) throw new WorkspaceError('CORRUPT_ARTIFACT', 'Artifact checksum failed. Restore a verified backup.');
  return { id: artifact.id, runId: artifact.run_id, name: artifact.name, mimeType: artifact.mime_type, dataBase64: data.toString('base64'), checksum: artifact.checksum };
}
function pinArtifact(store, { runId, pinned = true }) {
  key(runId, 'Run id');
  if (typeof pinned !== 'boolean') throw new WorkspaceError('VALIDATION', 'Pin must be true or false.');
  store.transaction(() => { if (pinned) store.db.prepare('INSERT OR IGNORE INTO pinned_runs VALUES(?)').run(runId); else store.db.prepare('DELETE FROM pinned_runs WHERE run_id=?').run(runId); store.bump(); });
  return { status: 'SUCCESS', runId, pinned };
}
function retention(store, { maxAgeDays, maxBytes, dryRun = true } = {}) {
  if (maxAgeDays === undefined && maxBytes === undefined) throw new WorkspaceError('VALIDATION', 'Choose an age or byte limit.');
  if (maxAgeDays !== undefined && (!Number.isFinite(maxAgeDays) || maxAgeDays < 0)) throw new WorkspaceError('VALIDATION', 'Age must be a nonnegative number of days.');
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) throw new WorkspaceError('VALIDATION', 'Byte limit must be a nonnegative integer.');
  if (typeof dryRun !== 'boolean') throw new WorkspaceError('VALIDATION', 'Dry run must be true or false.');
  return store.transaction(() => {
    const { artifacts } = listArtifacts(store);
    let remainingBytes = artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);
    const removed = [];
    const cutoff = !maxAgeDays ? null : Date.now() - maxAgeDays * 86400000;
    for (const artifact of artifacts) {
      if (artifact.pinned) continue;
      if (cutoff !== null && Date.parse(artifact.created) < cutoff || maxBytes > 0 && remainingBytes > maxBytes) {
        removed.push(artifact); remainingBytes -= artifact.bytes;
      }
    }
    if (!dryRun && removed.length) { for (const artifact of removed) store.db.prepare('DELETE FROM artifacts WHERE id=?').run(artifact.id); store.bump(); }
    return { status: 'SUCCESS', dryRun, removed, removedBytes: removed.reduce((sum, artifact) => sum + artifact.bytes, 0), remainingBytes, limitBlockedByPinned: maxBytes > 0 && remainingBytes > maxBytes, pinnedRuns: store.db.prepare('SELECT COUNT(*) AS count FROM pinned_runs').get().count };
  });
}
module.exports = { listArtifacts, putArtifact, readArtifact, pinArtifact, retention };
