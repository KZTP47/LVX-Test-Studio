'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store, WorkspaceError, SCHEMA_VERSION, sha256 } = require('./store.cjs');
const { exportArchive, verifyArchive, importArchive, scrub } = require('./archive.cjs');
const artifacts = require('./artifacts.cjs');
const datasets = require('./datasets.cjs');
const { createTeam } = require('./team.cjs');

function createService({ dataDir, workspaceRoot = null, emit = () => {}, quotaBytes, redact = value => value, beforeMigration, protectImport, onRetentionApplied } = {}) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw new WorkspaceError('VALIDATION', 'Workspace service needs an absolute private data directory.');
  let store, team, currentRoot, filename, unavailable, machina, categoryRetention;
  const notify = result => { emit({ domain: 'workspace', type: 'changed', revision: result.revision, changes: result.changes || [], imported: result.importedRecords }); return result; };
  function normalizeRoot(root) {
    if (root === null) return null;
    try {
      if (typeof root !== 'string' || !path.isAbsolute(root) || !fs.statSync(root).isDirectory()) throw new Error();
      return fs.realpathSync(root);
    } catch { throw new WorkspaceError('VALIDATION', 'Choose an existing workspace folder.'); }
  }
  function open(root) {
    unavailable = null; machina?.close?.(); machina = null; categoryRetention?.close?.(); categoryRetention = null;
    if (root === null) { currentRoot = null; filename = null; return; }
    currentRoot = normalizeRoot(root);
    filename = path.join(dataDir, 'workspaces', sha256(process.platform === 'win32' ? currentRoot.toLowerCase() : currentRoot).slice(0, 24), 'workspace.sqlite');
    unavailable = null;
    try { store = new Store(filename, { quotaBytes, beforeMigration }); team = createTeam(store, emit); }
    catch (error) { unavailable = error; store = null; team = null; }
  }
  function requireStore() {
    if (!currentRoot) throw new WorkspaceError('WORKSPACE_REQUIRED', 'Choose a workspace folder to save and manage your project.');
    if (unavailable) throw unavailable;
    return store;
  }
  function retentionService(){const db=requireStore();return categoryRetention||=require('./retention.cjs').createRetentionService({workspaceRoot:currentRoot,dataDir,store:db,redact,emit});}
  async function reconcileEffects(){
    const binding=currentRoot,service=retentionService(),pending=await service.handle('pendingEffects'),reconciled=[];
    if(!onRetentionApplied)return {reconciled,pendingCount:pending.receipts.length,coordinatorAvailable:false};
    for(const receipt of pending.receipts){
      if(binding!==currentRoot)throw new WorkspaceError('WORKSPACE_CHANGED','Workspace changed during evidence reconciliation. Reopen the original project.');
      if(receipt.workspaceRoot!==binding){await service.handle('deferForeignEffects',{id:receipt.id});continue;}
      const nativeEffects=await onRetentionApplied(receipt,binding);
      if(binding!==currentRoot)throw new WorkspaceError('WORKSPACE_CHANGED','Workspace changed before cleanup acknowledgment. Reopen the original project.');
      await service.handle('acknowledgeEffects',{id:receipt.id,nativeEffects:nativeEffects||receipt.nativeEffects||{}});reconciled.push({id:receipt.id,nativeEffects});
    }
    return {reconciled,pendingCount:(await service.handle('pendingEffects')).receipts.length,coordinatorAvailable:true};
  }
  async function retain(action='autoCleanup',payload={}){await reconcileEffects();const summary=await retentionService().handle(action,payload);if(summary.effectReceiptId)summary.reconciliation=await reconcileEffects();return summary;}
  async function committed(result){const summary=await retain();return notify({...result,...(summary.deletedCount?{retentionCleanup:summary}:{})});}
  async function setWorkspace(root) {
    const candidate = normalizeRoot(root);
    await team?.stop(); store?.close(); store = null; team = null; open(candidate);
    return status();
  }
  function status() { return { status: unavailable ? 'ERROR' : currentRoot ? 'SUCCESS' : 'PENDING', workspaceRoot: currentRoot, schemaVersion: SCHEMA_VERSION, revision: store?.revision() ?? null, engine: 'SQLite (WAL, synchronous FULL)', error: unavailable ? { code: unavailable.code, message: unavailable.message } : null, recoveryAvailable: !!filename && fs.existsSync(path.join(path.dirname(filename), 'last-backup.json')) }; }
  async function recover({ archive } = {}) {
    if (!currentRoot || !filename) throw new WorkspaceError('WORKSPACE_REQUIRED', 'Choose the workspace to recover.');
    const verified = archive || JSON.parse(fs.readFileSync(path.join(path.dirname(filename), 'last-backup.json'), 'utf8'));
    const preview = verifyArchive(verified, undefined, redact);
    if (!preview.valid) throw new WorkspaceError('ARCHIVE_INVALID', 'Recovery backup failed validation. Existing files were preserved.', preview);
    await team?.stop(); store?.close(); store = null; team = null;
    const recoveryFile = `${filename}.recover-${crypto.randomUUID()}`;
    const replacement = new Store(recoveryFile, { quotaBytes });
    try { importArchive(replacement, verified, { mode: 'replace', expectedWorkspaceRevision: 0 }, redact); replacement.close(); }
    catch (error) { replacement.close(); for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(`${recoveryFile}${suffix}`)) fs.unlinkSync(`${recoveryFile}${suffix}`); open(currentRoot); throw error; }
    // Preserve the original database and journals for forensic recovery. Only after
    // validation and a successful replacement transaction do we switch files.
    const preserved = `${filename}.preserved-${Date.now()}-${crypto.randomUUID()}`;
    for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(`${filename}${suffix}`)) fs.renameSync(`${filename}${suffix}`, `${preserved}${suffix}`);
    fs.renameSync(recoveryFile, filename);
    open(currentRoot);
    if (unavailable) throw unavailable;
    return notify({ status: 'SUCCESS', recovered: true, revision: store.revision(), preservedDatabase: preserved });
  }
  open(workspaceRoot);
  return {
    setWorkspace,
    redact(value) { return redact(scrub(value)); },
    async handle(action, payload = {}) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new WorkspaceError('VALIDATION', 'Workspace action payload must be an object.');
      if (action === 'status') return status();
      // Recovery validation must remain available when SQLite cannot open.
      // This is a pure archive check; it never touches or replaces the database.
      if (action === 'validateRecovery') return verifyArchive(payload.archive, undefined, redact);
      if (action === 'recover') return recover(payload);
      const db = requireStore();
      if (action.startsWith('machina:')) {
        if (!machina) machina = require('./machina.cjs').createMachinaWorkspace({workspaceRoot:currentRoot,dataDir,store:db,redact,protectImport,emit});
        const result=await machina.handle(action.slice('machina:'.length),payload);
        if(['machina:importLegacy'].includes(action)){const summary=await retain();if(summary.deletedCount)result.retentionCleanup=summary;}return result;
      }
      if(action.startsWith('retention:')){const name=action.slice('retention:'.length);return name==='reconcileEffects'?reconcileEffects():['applyCleanup','autoCleanup'].includes(name)?retain(name,payload):retentionService().handle(name,payload);}
      switch (action) {
        case 'list': return db.list(payload.collection);
        case 'read': return db.read(payload.collection, payload.id);
        case 'transact': return committed(db.transact(payload.records, { expectedWorkspaceRevision: payload.expectedWorkspaceRevision }));
        case 'backup': {
          const archive = exportArchive(db, payload, redact);
          const backupFile = path.join(path.dirname(filename), 'last-backup.json');
          const temp = `${backupFile}.${crypto.randomUUID()}.tmp`;
          try {
            const descriptor = fs.openSync(temp, 'wx', 0o600);
            try { fs.writeFileSync(descriptor, JSON.stringify(archive)); fs.fsyncSync(descriptor); }
            finally { fs.closeSync(descriptor); }
            fs.renameSync(temp, backupFile);
          }
          finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
          return archive;
        }
        case 'previewImport': return verifyArchive(payload.archive, db, redact);
        case 'import': return committed(importArchive(db, payload.archive, payload, redact));
        case 'artifacts': return artifacts.listArtifacts(db, payload);
        case 'putArtifact': return artifacts.putArtifact(db, payload);
        case 'readArtifact': return artifacts.readArtifact(db, payload);
        case 'pinArtifact': return artifacts.pinArtifact(db, payload);
        case 'retention': return artifacts.retention(db, payload);
        case 'validateDataset': return datasets.validateDataset(payload, currentRoot);
        case 'generateDataset': return datasets.generateDataset(payload);
        case 'maskDataset': return datasets.maskDataset(payload);
        case 'startTeam': return team.start(payload);
        case 'stopTeam': return team.stop();
        case 'teamStatus': return team.status();
        case 'createTeamIdentity': return team.create(payload);
        case 'revokeTeamIdentity': return team.revoke(payload);
        case 'listTeamIdentities': return team.list(payload.workspaceId);
        default: throw new WorkspaceError('UNKNOWN_ACTION', `Unknown workspace action: ${String(action)}`);
      }
    },
    async close() { await categoryRetention?.close?.(); await machina?.close?.(); await team?.stop(); store?.close(); store = null; }
  };
}
module.exports = { createService, WorkspaceError, SCHEMA_VERSION };
