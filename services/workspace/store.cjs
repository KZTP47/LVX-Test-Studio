'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_VERSION = 2;
const KEY = /^[a-zA-Z0-9][a-zA-Z0-9_.:@-]*$/;
class WorkspaceError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
function key(value, label) {
  if (typeof value !== 'string' || !KEY.test(value)) throw new WorkspaceError('VALIDATION', `${label} must be a nonempty identifier (letters, numbers, . _ : @ -).`);
  return value;
}
function json(value) {
  const result = JSON.stringify(value);
  if (result === undefined) throw new WorkspaceError('VALIDATION', 'Record value must be JSON data.');
  return result;
}
function rowRecord(row) {
  return row && { collection: row.collection, id: row.id, value: JSON.parse(row.value), revision: row.revision, modified: row.modified };
}
function decodeBase64(value, maxBytes = 0) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new WorkspaceError('VALIDATION', 'Artifact byte budget must be a nonnegative integer; zero disables it.');
  if (typeof value !== 'string') throw new WorkspaceError('VALIDATION', 'Artifact must be base64 text.');
  if (maxBytes > 0 && value.length > Math.ceil(maxBytes / 3) * 4) throw new WorkspaceError('VALIDATION', 'Artifact exceeds the selected byte budget.');
  const bytes = Buffer.from(value, 'base64');
  // Round-trip validation is linear and rejects whitespace, missing padding and
  // nonalphabet bytes without the pathological cost of a repeated-group regex.
  if ((maxBytes > 0 && bytes.length > maxBytes) || bytes.toString('base64') !== value) throw new WorkspaceError('VALIDATION', 'Artifact must be canonical base64 and fit the selected byte budget.');
  return bytes;
}

class Store {
  constructor(filename, { quotaBytes = 0, beforeMigration } = {}) {
    if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 0) throw new WorkspaceError('VALIDATION', 'Workspace byte budget must be a nonnegative integer; zero disables it.');
    this.filename = filename;
    this.quotaBytes = quotaBytes;
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    try {
      this.db = new DatabaseSync(filename);
      this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
      const integrity = this.db.prepare('PRAGMA quick_check').get();
      if (Object.values(integrity)[0] !== 'ok') throw new Error('Integrity check failed.');
      this.migrate(beforeMigration);
    } catch (error) {
      this.db?.close();
      if (error.code === 'SCHEMA_NEWER') throw error;
      throw new WorkspaceError('WORKSPACE_UNAVAILABLE', 'Workspace database could not be opened. The original was preserved; restore a verified archive to recover.', { cause: error.message, filename });
    }
  }
  migrate(beforeMigration) {
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > SCHEMA_VERSION) throw new WorkspaceError('SCHEMA_NEWER', 'This workspace was created by a newer application.');
    if (version === SCHEMA_VERSION) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (version < 1) this.db.exec(`
        CREATE TABLE records (collection TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, revision INTEGER NOT NULL, modified TEXT NOT NULL, PRIMARY KEY(collection,id));
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO metadata VALUES ('revision','0');
      `);
      if (version < 2) this.db.exec(`
        CREATE TABLE artifacts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, name TEXT NOT NULL, mime_type TEXT NOT NULL, data BLOB NOT NULL, checksum TEXT NOT NULL, created TEXT NOT NULL);
        CREATE INDEX artifacts_runs ON artifacts(run_id);
        CREATE TABLE pinned_runs (run_id TEXT PRIMARY KEY);
        CREATE TABLE identities (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, revoked INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
      `);
      beforeMigration?.({ from: version, to: SCHEMA_VERSION });
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}; COMMIT;`);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  revision() { return Number(this.db.prepare("SELECT value FROM metadata WHERE key='revision'").get().value); }
  bump() { this.db.prepare("UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run(); return this.revision(); }
  read(collection, id) { return rowRecord(this.db.prepare('SELECT * FROM records WHERE collection=? AND id=?').get(key(collection, 'Collection'), key(id, 'Record id'))) || null; }
  list(collection, {boardId} = {}) {
    return this.snapshot(() => {
      if(boardId!==undefined&&!['agent-messages','agent-events','agent-runs','agent-sessions'].includes(collection))throw new WorkspaceError('VALIDATION','Board filtering is only supported for agent history collections.');
      const rows = boardId!==undefined ? this.db.prepare("SELECT * FROM records WHERE collection=? AND json_extract(value,'$.boardId')=? ORDER BY id").all(key(collection,'Collection'),key(boardId,'Board ID')) : collection ? this.db.prepare('SELECT * FROM records WHERE collection=? ORDER BY id').all(key(collection, 'Collection')) : this.db.prepare('SELECT * FROM records ORDER BY collection,id').all();
      return { records: rows.map(rowRecord), revision: this.revision(), schemaVersion: SCHEMA_VERSION };
    });
  }
  usage() {
    const records = this.db.prepare('SELECT COALESCE(SUM(length(CAST(value AS BLOB))),0) AS bytes FROM records').get().bytes;
    const artifacts = this.db.prepare('SELECT COALESCE(SUM(length(data)),0) AS bytes FROM artifacts').get().bytes;
    return { recordBytes: records, artifactBytes: artifacts, totalBytes: records + artifacts, quotaBytes: this.quotaBytes };
  }
  checkQuota() {
    const usage = this.usage();
    if (this.quotaBytes > 0 && usage.totalBytes > this.quotaBytes) throw new WorkspaceError('QUOTA', 'The selected workspace byte budget was reached. Remove unneeded artifacts or change this optional budget.', usage);
  }
  snapshot(callback) {
    if (this.db.isTransaction) return callback();
    this.db.exec('BEGIN');
    try { const result = callback(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  transaction(callback) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = callback(); this.checkQuota(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  transact(records, { expectedWorkspaceRevision, failBeforeCommit = false, deleteArtifactsForRuns = [], protectedArtifactIds = [], retentionCleanup = false } = {}) {
    if (!Array.isArray(records) || !records.length) throw new WorkspaceError('VALIDATION', 'A transaction needs a nonempty list of records.');
    for(const values of [deleteArtifactsForRuns,protectedArtifactIds]){if(!Array.isArray(values))throw new WorkspaceError('VALIDATION','Invalid retained artifact selection.');for(const id of values)key(id,'Artifact cleanup identifier');}
    if(retentionCleanup&&records.some(r=>!r?.delete&&!(r?.collection==='storage-settings'&&['retention','retention-effects'].includes(r?.id))&&!(r?.collection==='baselines'&&r?.value?.type==='lvx-native-baselines'&&Array.isArray(r.value.items))))throw new WorkspaceError('VALIDATION','Internal retention transactions may only remove records, trim baseline archives or update their cleanup receipt.');
    const deletedRunIds = new Set(records.filter(r=>r?.collection==='runs'&&r.delete).map(r=>r.id));
    if(deleteArtifactsForRuns.some(id=>!deletedRunIds.has(id)))throw new WorkspaceError('VALIDATION','Artifact cleanup must accompany removal of its run record.');
    const identifiers = new Set();
    for (const record of records) {
      if (!record || typeof record !== 'object') throw new WorkspaceError('VALIDATION', 'Invalid record.');
      const identity = `${key(record.collection, 'Collection')}/${key(record.id, 'Record id')}`;
      if (identifiers.has(identity)) throw new WorkspaceError('VALIDATION', `Duplicate transaction record: ${identity}`);
      identifiers.add(identity);
      if (record.expectedRevision !== null && (!Number.isSafeInteger(record.expectedRevision) || record.expectedRevision < 1)) throw new WorkspaceError('VALIDATION', 'Each record needs an expectedRevision; use null only when creating a new record.');
      if (!record.delete) json(record.value);
    }
    return this.transaction(() => {
      if (expectedWorkspaceRevision !== undefined && expectedWorkspaceRevision !== this.revision()) throw new WorkspaceError('CONFLICT', 'Workspace changed since the preview. Reload and review the import again.', { revision: this.revision() });
      const changes = [];
      for (const record of records) {
        const current = this.read(record.collection, record.id);
        if ((current?.revision ?? null) !== record.expectedRevision) throw new WorkspaceError('CONFLICT', 'Another window changed this record. Reload it or merge your changes before saving.', { collection: record.collection, id: record.id, current });
        // A deleted/recreated record must never reuse a revision (the ABA problem).
        const revision = this.revision() + 1;
        if (record.delete) this.db.prepare('DELETE FROM records WHERE collection=? AND id=?').run(record.collection, record.id);
        else this.db.prepare('INSERT INTO records VALUES(?,?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET value=excluded.value,revision=excluded.revision,modified=excluded.modified').run(record.collection, record.id, json(record.value), revision, new Date().toISOString());
        changes.push({ collection: record.collection, id: record.id, revision: record.delete ? null : revision });
      }
      const protectedIds=new Set(protectedArtifactIds);let deletedArtifactCount=0,deletedArtifactBytes=0;
      const candidates=this.db.prepare('SELECT id,length(data) AS bytes FROM artifacts WHERE run_id=? AND NOT EXISTS(SELECT 1 FROM pinned_runs WHERE run_id=artifacts.run_id)'),remove=this.db.prepare('DELETE FROM artifacts WHERE id=?');
      for(const runId of new Set(deleteArtifactsForRuns))for(const artifact of candidates.all(runId))if(!protectedIds.has(artifact.id)){remove.run(artifact.id);deletedArtifactCount++;deletedArtifactBytes+=artifact.bytes;}
      if (failBeforeCommit) throw new WorkspaceError('ABORTED', 'Transaction aborted before commit.');
      return { status: 'SUCCESS', revision: this.bump(), changes, ...(deleteArtifactsForRuns.length?{deletedArtifactCount,deletedArtifactBytes}:{}) };
    });
  }
  close() { this.db?.close(); this.db = null; }
}

module.exports = { Store, WorkspaceError, SCHEMA_VERSION, sha256, key, json, decodeBase64 };
