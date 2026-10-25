'use strict';
const { WorkspaceError, SCHEMA_VERSION, sha256, key, json, decodeBase64 } = require('./store.cjs');
const SECRET_FIELD = /^(?:api[_-]?key|password|passwd|secret|secret[_-]?value|ciphertext|encryption[_-]?key|access[_-]?token|refresh[_-]?token|authorization|private[_-]?key|credential|credentials|client[_-]?secret|token)$/i;
const SECRET_COLLECTION = /^(?:secrets?|credentials?|ciphertext|identities|team[-_]?tokens?|auth(?:entication)?)$/i;
const sensitiveCollection = name => String(name).split(/[.:]/).some(part => SECRET_COLLECTION.test(part));
const PRIVATE_PEM = /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g;
function scrub(value,context='') {
  if (Array.isArray(value)) return value.map(child=>scrub(child,context));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([name,child]) => !SECRET_FIELD.test(name)||['parameterSchema','parameter_schema','schema'].includes(context)||(name==='secret'&&typeof child==='boolean')||(typeof child==='string'&&/^secret:[a-f0-9-]{36}$/.test(child))||(child&&typeof child==='object'&&Object.keys(child).length===1&&/^secret:[a-f0-9-]{36}$/.test(child.secretRef||''))).map(([name, child]) => [name, scrub(child,name)]));
  if (typeof value === 'string') return value.replace(PRIVATE_PEM, '[REDACTED PRIVATE KEY]').replace(/\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9_]{20,})\b/g, '[REDACTED CREDENTIAL]').replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/:]+:[^\s/@]+@/gi, '$1[REDACTED]@');
  return value;
}
function buildArchive(store, { collections, recordIds, includeArtifacts = true } = {}, redact = value => value) {
  const all = store.list().records;
  const lookup = new Map(all.map(record => [`${record.collection}/${record.id}`, record]));
  if (collections !== undefined && (!Array.isArray(collections) || collections.some(collection => typeof collection !== 'string'))) throw new WorkspaceError('VALIDATION', 'Archive collections must be a list of names.');
  if (recordIds !== undefined && (!Array.isArray(recordIds) || recordIds.some(ref => !ref || typeof ref.collection !== 'string' || typeof ref.id !== 'string'))) throw new WorkspaceError('VALIDATION', 'Archive record selection must contain collection/id references.');
  if (typeof includeArtifacts !== 'boolean') throw new WorkspaceError('VALIDATION', 'Include artifacts must be true or false.');
  const selected = all.filter(record => !sensitiveCollection(record.collection) && (!collections || collections.includes(record.collection)) && (!recordIds || recordIds.some(ref => ref.collection === record.collection && ref.id === record.id)));
  const needed = new Map();
  function add(record) {
    const id = `${record.collection}/${record.id}`;
    if (needed.has(id)) return;
    if (sensitiveCollection(record.collection)) throw new WorkspaceError('ARCHIVE_DEPENDENCY', 'Executable data cannot depend on a credential record; use an opaque secret reference.');
    needed.set(id, record);
    for (const ref of record.value?.dependencies || []) {
      const dependency = lookup.get(`${ref.collection}/${ref.id}`);
      if (!dependency) throw new WorkspaceError('ARCHIVE_DEPENDENCY', `Missing dependency: ${ref.collection}/${ref.id}`);
      add(dependency);
    }
  }
  selected.forEach(add);
  const records = [...needed.values()].sort((a, b) => `${a.collection}/${a.id}`.localeCompare(`${b.collection}/${b.id}`)).map(record => ({ collection: record.collection, id: record.id, value: redact(scrub(record.value),{collection:record.collection,id:record.id,kind:'record'}) }));
  const runIds = new Set(records.filter(record => /runs|history/.test(record.collection)).map(record => record.id));
  const artifacts = includeArtifacts ? store.db.prepare('SELECT a.*,p.run_id AS pinned FROM artifacts a LEFT JOIN pinned_runs p ON a.run_id=p.run_id ORDER BY a.id').all().filter(row => !collections && !recordIds || runIds.has(row.run_id)).map(row => {
    // Text evidence can contain tokens in arbitrary logs; use the security service's
    // known-secret redactor as well as structural/pattern redaction.
    const original = Buffer.from(row.data);
    const text = original.toString('utf8');
    let sanitized = String(redact(scrub(text)));
    if (/^application\/json/.test(row.mime_type)) {
      try { sanitized = json(redact(scrub(JSON.parse(text)))); } catch { /* Non-JSON evidence still receives text redaction. */ }
    }
    const isText = /^(?:text\/|application\/(?:json|xml|javascript))/.test(row.mime_type);
    if (!isText && sanitized !== text) throw new WorkspaceError('SECRET_ARTIFACT', `Binary artifact ${row.name} contains credential material. Exclude artifacts or remove the sensitive evidence before exporting.`);
    const data = isText ? Buffer.from(sanitized) : original;
    return { id: row.id, runId: row.run_id, name: row.name, mimeType: row.mime_type, dataBase64: data.toString('base64'), checksum: sha256(data), created: row.created, pinned: !!row.pinned };
  }) : [];
  const payload = { records, artifacts };
  return { format: 'lvx-workspace', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), workspaceRevision: store.revision(), secretsExcluded: true, manifest: { records: records.length, artifacts: artifacts.length, checksumAlgorithm: 'sha256', payloadChecksum: sha256(json(payload)) }, payload };
}
function verifyArchive(archive, store, redact = value => value) {
  const errors = [];
  if (!archive || archive.format !== 'lvx-workspace' || archive.schemaVersion !== SCHEMA_VERSION) errors.push('Unsupported archive format or schema version.');
  if (!archive?.secretsExcluded) errors.push('Archive must declare that credentials are excluded.');
  const records = archive?.payload?.records;
  const artifacts = archive?.payload?.artifacts;
  if (!Array.isArray(records) || !Array.isArray(artifacts)) errors.push('Archive records and artifacts must be arrays.');
  else {
    if (records.length > 10000 || artifacts.length > 10000) errors.push('Archive exceeds the 10,000 records/artifacts import limit.');
    if (archive.manifest?.payloadChecksum !== sha256(json(archive.payload))) errors.push('Archive checksum does not match its contents.');
    if (archive.manifest?.checksumAlgorithm !== 'sha256' || archive.manifest?.records !== records.length || archive.manifest?.artifacts !== artifacts.length) errors.push('Archive manifest counts or checksum algorithm are invalid.');
    const seen = new Set();
    for (const record of records) {
      try { key(record.collection, 'Collection'); key(record.id, 'Record id'); json(record.value); } catch { errors.push('Archive contains an invalid record.'); continue; }
      const id = `${record.collection}/${record.id}`;
      if (seen.has(id)) errors.push(`Duplicate record: ${id}`);
      seen.add(id);
      if (sensitiveCollection(record.collection) || json(redact(scrub(record.value),{collection:record.collection,id:record.id,kind:'record'})) !== json(record.value)) errors.push(`Archive contains credential data: ${id}`);
    }
    for (const record of records) {
      const dependencies = record?.value?.dependencies;
      if (dependencies === undefined) continue;
      if (!Array.isArray(dependencies)) { errors.push('Archive record dependencies must be an array.'); continue; }
      for (const ref of dependencies) {
        if (!ref || typeof ref.collection !== 'string' || typeof ref.id !== 'string') { errors.push('Invalid imported dependency.'); continue; }
        if (!seen.has(`${ref.collection}/${ref.id}`)) errors.push(`Missing imported dependency: ${ref.collection}/${ref.id}`);
      }
    }
    const artifactIds = new Set();
    for (const artifact of artifacts) {
      try {
        key(artifact.id, 'Artifact id'); key(artifact.runId, 'Run id');
        if (artifactIds.has(artifact.id)) throw new Error();
        artifactIds.add(artifact.id);
        if (typeof artifact.name !== 'string' || artifact.name.length > 500 || typeof artifact.mimeType !== 'string' || artifact.mimeType.length > 200 || !Number.isFinite(Date.parse(artifact.created))) throw new Error();
        if (sha256(decodeBase64(artifact.dataBase64)) !== artifact.checksum) throw new Error();
      } catch { errors.push('Archive contains an invalid or corrupt artifact.'); }
    }
  }
  return { valid: errors.length === 0, errors, revision: store?.revision() ?? null, schemaVersion: SCHEMA_VERSION, records: Array.isArray(records) ? records.length : 0, artifacts: Array.isArray(artifacts) ? artifacts.length : 0, conflicts: store && Array.isArray(records) ? records.filter(record => { try { return !!store.read(record.collection, record.id); } catch { return false; } }).map(({ collection, id }) => ({ collection, id })) : [], trustRequired: true, secretsExcluded: true };
}
function importArchive(store, archive, { mode = 'merge', expectedWorkspaceRevision } = {}, redact = value => value) {
  const preview = verifyArchive(archive, store, redact);
  if (!preview.valid) throw new WorkspaceError('ARCHIVE_INVALID', 'Archive failed validation. Nothing was imported.', preview);
  if (!['merge', 'replace'].includes(mode)) throw new WorkspaceError('VALIDATION', 'Choose merge or replace import mode.');
  if (!Number.isSafeInteger(expectedWorkspaceRevision)) throw new WorkspaceError('VALIDATION', 'Preview the archive before importing; its workspace revision is required.');
  return store.transaction(() => {
    if (expectedWorkspaceRevision !== store.revision()) throw new WorkspaceError('CONFLICT', 'Workspace changed after the import preview. Preview it again.', { revision: store.revision() });
    if (mode === 'replace') store.db.exec('DELETE FROM records; DELETE FROM artifacts; DELETE FROM pinned_runs;');
    for (const record of archive.payload.records) {
      store.db.prepare('INSERT INTO records VALUES(?,?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET value=excluded.value,revision=excluded.revision,modified=excluded.modified').run(record.collection, record.id, json(record.value), store.revision() + 1, new Date().toISOString());
    }
    for (const artifact of archive.payload.artifacts) {
      const existing = store.db.prepare('SELECT checksum FROM artifacts WHERE id=?').get(artifact.id);
      if (existing && existing.checksum !== artifact.checksum) throw new WorkspaceError('CONFLICT', 'An artifact with this identifier already has different contents.');
      store.db.prepare('INSERT OR IGNORE INTO artifacts VALUES(?,?,?,?,?,?,?)').run(artifact.id, artifact.runId, artifact.name, artifact.mimeType, Buffer.from(artifact.dataBase64, 'base64'), artifact.checksum, artifact.created);
      if (artifact.pinned) store.db.prepare('INSERT OR IGNORE INTO pinned_runs VALUES(?)').run(artifact.runId);
    }
    return { status: 'SUCCESS', revision: store.bump(), importedRecords: archive.payload.records.length, importedArtifacts: archive.payload.artifacts.length, trustRequired: true };
  });
}
function exportArchive(store, options, redact) { return store.snapshot(() => buildArchive(store, options, redact)); }
module.exports = { exportArchive, verifyArchive, importArchive, scrub };
