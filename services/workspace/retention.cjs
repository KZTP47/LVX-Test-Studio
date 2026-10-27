'use strict';
const crypto = require('node:crypto');
const { WorkspaceError } = require('./store.cjs');
const DEFAULT_POLICIES = Object.freeze({
  execution_history: { enabled: false, maxEntries: 0, maxAgeDays: 0, strategy: 'oldest-first' },
  security_scans: { enabled: false, maxEntries: 0, maxAgeDays: 0, strategy: 'oldest-first' },
  screenshots: { enabled: false, maxEntries: 0, maxAgeDays: 0, strategy: 'oldest-first' },
  versions: { enabled: false, maxEntries: 0, maxAgeDays: 0, strategy: 'oldest-first' }
});
const COLLECTIONS = Object.freeze({ execution_history: ['runs', 'history', 'execution_history'], security_scans: ['security-history', 'security-results', 'security_scans'], screenshots: ['baselines', 'screenshots'], versions: ['versions'] });
const clone = value => JSON.parse(JSON.stringify(value));
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}` : JSON.stringify(value);
const hash = value => crypto.createHash('sha256').update(stable(value)).digest('hex');
const fail = (code, message) => { throw new WorkspaceError(code, message); };
function normalizePreferences(value = {}) {
  const mode = value.mode || 'unlimited';
  if (!['smart', 'custom', 'unlimited'].includes(mode)) fail('VALIDATION', 'Choose smart, custom or unlimited storage mode.');
  const integer = (v, fallback) => { const n = v ?? fallback; if (!Number.isSafeInteger(n) || n < 0) fail('VALIDATION', 'Storage budgets must be nonnegative integers; zero disables a budget.'); return n; };
  const customPolicies = {};
  for (const key of Object.keys(value.customPolicies || {})) if (!Object.hasOwn(DEFAULT_POLICIES, key)) fail('VALIDATION', `Unsupported storage policy category: ${key}.`);
  for (const [name, defaults] of Object.entries(DEFAULT_POLICIES)) {
    const p = value.customPolicies?.[name] || {};
    if (p.enabled !== undefined && typeof p.enabled !== 'boolean') fail('VALIDATION', 'Policy enabled switches must be true or false.');
    if (p.strategy !== undefined && p.strategy !== 'oldest-first') fail('VALIDATION', 'The supported cleanup strategy is oldest-first.');
    customPolicies[name] = { enabled: p.enabled ?? (Object.keys(p).length ? true : defaults.enabled), maxEntries: integer(p.maxEntries, defaults.maxEntries), maxAgeDays: integer(p.maxAgeDays, defaults.maxAgeDays), strategy: 'oldest-first' };
  }
  const showWarningAt = integer(value.showWarningAt, 80);
  if (showWarningAt > 100) fail('VALIDATION', 'Warning percentage must be between zero and 100.');
  return { mode, customPolicies, showWarningAt, lastCleanupDate: null, lastCleanupSummary: null };
}
function createRetentionService({ store, workspaceRoot, dataDir, redact = v => v, emit = () => {}, now = () => Date.now() } = {}) {
  const previews = new Map();
  const ready = () => { if (!workspaceRoot || !store) fail('WORKSPACE_REQUIRED', 'Choose a workspace before managing storage.'); };
  const saved = () => store.read('storage-settings', 'retention');
  const effectsRecord = () => store.read('storage-settings', 'retention-effects');
  const foreignEffects = () => store.list('retention-foreign-effects').records;
  function effectsState() { const record=effectsRecord(),value=record?.value||{};if(record&&(!value||typeof value!=='object'||Array.isArray(value)))fail('EFFECT_SCHEMA','Pending cleanup receipt record is malformed. Restore a verified archive.');if(value.schemaVersion!==undefined&&value.schemaVersion!==1)fail('EFFECT_SCHEMA','Pending cleanup effects use an unsupported schema. Existing receipts were preserved.');if(value.pending!==undefined&&!Array.isArray(value.pending))fail('EFFECT_SCHEMA','Pending cleanup receipt queue is malformed. Restore a verified archive.');return {record,value:{schemaVersion:1,pending:clone(value.pending||[]),completed:clone(Array.isArray(value.completed)?value.completed:[]),completedPrunedCount:Number.isSafeInteger(value.completedPrunedCount)&&value.completedPrunedCount>=0?value.completedPrunedCount:0}}; }
  const preferences = () => { const record = saved(); return { ...normalizePreferences(record?.value), lastCleanupDate: record?.value?.lastCleanupDate || null, lastCleanupSummary: record?.value?.lastCleanupSummary || null }; };
  const timestamp = (value, fallback) => { for (const v of [value?.timestamp, value?.dateCreated, value?.createdAt, value?.dateModified, value?.lastUpdated, fallback]) { const n = Date.parse(v); if (Number.isFinite(n)) return n; } return now(); };
  function inventory(snapshot = store.list()) {
    const categories = Object.fromEntries(Object.keys(COLLECTIONS).map(k => [k, []]));
    const pinned = new Set(store.db.prepare('SELECT run_id FROM pinned_runs').all().map(r => r.run_id));
    for (const record of snapshot.records) {
      const category = Object.keys(COLLECTIONS).find(k => COLLECTIONS[k].includes(record.collection)); if (!category) continue;
      const value = record.value || {}, base = { category, collection: record.collection, id: record.id, revision: record.revision, record, time: timestamp(value, record.modified), bytes: Buffer.byteLength(JSON.stringify(value)), pinned: value.pinned === true || pinned.has(record.id) || pinned.has(value.runId), active: ['RUNNING', 'PENDING', 'WAITING'].includes(value.status), group: category === 'versions' ? value.suiteId || value.originalSuiteId || record.id : category };
      if (category === 'screenshots' && value.type === 'lvx-native-baselines' && Array.isArray(value.items)) {
        if(value.items.some(item=>!item||typeof item.id!=='string'||!item.id)||new Set(value.items.map(item=>item.id)).size!==value.items.length)fail('VALIDATION','Native baseline archive has invalid or duplicate image identifiers. Repair or restore it before cleanup.');
        for (const item of value.items) categories[category].push({ ...base, itemId: item.id, time: timestamp(item, record.modified), bytes: Number(item.bytes) || Buffer.byteLength(item.image || ''), pinned: base.pinned || item.pinned === true });
      } else categories[category].push(base);
    }
    return { snapshot, categories };
  }
  function plan() { return store.snapshot(() => {
    const p = preferences(), { snapshot, categories } = inventory(), removed = [], retainedByCategory = {}, policies = p.mode === 'custom' ? p.customPolicies : clone(DEFAULT_POLICIES);
    for (const [category, entries] of Object.entries(categories)) {
      const policy = policies[category], groups = new Map(); for (const entry of entries) { if (!groups.has(entry.group)) groups.set(entry.group, []); groups.get(entry.group).push(entry); }
      for (const group of groups.values()) {
        let kept = 0; for (const entry of group.sort((a, b) => b.time - a.time || a.id.localeCompare(b.id) || String(a.itemId).localeCompare(String(b.itemId)))) {
          if (p.mode === 'unlimited' || !policy.enabled || entry.pinned || entry.active) { kept++; continue; }
          const expired = policy.maxAgeDays > 0 && (now() - entry.time) / 86400000 > policy.maxAgeDays, overflow = policy.maxEntries > 0 && kept >= policy.maxEntries;
          if (expired || overflow) removed.push({ ...entry, reason: expired ? 'age' : 'count' }); else kept++;
        }
      }
      retainedByCategory[category] = entries.length - removed.filter(e => e.category === category).length;
    }
    // Do not create dangling archive dependencies. Referenced evidence remains
    // retained until its dependent record is itself removed in this transaction.
    const deletionKeys = new Set(removed.filter(e => !e.itemId).map(e => `${e.collection}/${e.id}`));
    const protectedKeys = new Set(),lookup=new Map(snapshot.records.map(record=>[`${record.collection}/${record.id}`,record])),queue=snapshot.records.filter(record=>!deletionKeys.has(`${record.collection}/${record.id}`));
    for(let index=0;index<queue.length;index++)for(const ref of queue[index].value?.dependencies||[]){const key=`${ref.collection}/${ref.id}`;if(!protectedKeys.has(key)){protectedKeys.add(key);if(lookup.has(key))queue.push(lookup.get(key));}}
    const final = removed.filter(e => !protectedKeys.has(`${e.collection}/${e.id}`));
    const finalKeys=new Set(final.filter(e=>!e.itemId).map(e=>`${e.collection}/${e.id}`)),protectedArtifactIds=new Set();
    function artifactReferences(value,key=''){if(Array.isArray(value)){for(const child of value)artifactReferences(child,key);return;}if(value&&typeof value==='object'){if(value.collection==='artifacts'&&typeof value.id==='string')protectedArtifactIds.add(value.id);for(const [name,child]of Object.entries(value))artifactReferences(child,name);return;}if(typeof value==='string'&&['artifactId','artifactIds'].includes(key))protectedArtifactIds.add(value);}
    for(const record of snapshot.records)if(!finalKeys.has(`${record.collection}/${record.id}`))artifactReferences(record.value);
    const deletedRunIds=new Set(final.filter(e=>e.collection==='runs').map(e=>e.id));
    const artifactCandidates=store.db.prepare('SELECT a.id,a.run_id AS runId,length(a.data) AS bytes FROM artifacts a LEFT JOIN pinned_runs p ON a.run_id=p.run_id WHERE p.run_id IS NULL').all().filter(a=>deletedRunIds.has(a.runId)&&!protectedArtifactIds.has(a.id));
    return { revision: snapshot.revision, preferences: p, policies, removed: final, retainedByCategory, artifactCandidates,protectedArtifactIds:[...protectedArtifactIds], protectedReferences: [...protectedKeys], counts: Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, v.length])), bytes: Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, v.reduce((n, e) => n + e.bytes, 0)])) };
  }); }
  function publicPlan(p) { return { revision: p.revision, mode: p.preferences.mode, counts: p.counts, bytes: p.bytes, deleteByCategory: Object.fromEntries(Object.keys(COLLECTIONS).map(k => [k, p.removed.filter(e => e.category === k).length])), candidates: p.removed.map(({ category, collection, id, itemId, reason, bytes }) => ({ category, collection, id, ...(itemId ? { itemId } : {}), reason, bytes })), protectedReferences: p.protectedReferences,artifactCandidates:p.artifactCandidates,deleteArtifactCount:p.artifactCandidates.length,deleteArtifactBytes:p.artifactCandidates.reduce((n,a)=>n+a.bytes,0),protectedArtifactIds:p.protectedArtifactIds }; }
  function apply(p, { automatic = false } = {}) {
    if (p.revision !== store.revision()) fail('CONFLICT', 'Workspace changed after the cleanup preview. Preview it again.');
    const records = [], byRecord = new Map(), deletedRunIds = [], changedBaselineArchives = [], deletedScreenshotFiles = [];
    for (const entry of p.removed) { const key = `${entry.collection}/${entry.id}`; if (!byRecord.has(key)) byRecord.set(key, []); byRecord.get(key).push(entry); }
    const retainedNativeFiles=new Set(store.list().records.filter(record=>!byRecord.has(`${record.collection}/${record.id}`)&&typeof record.value?.nativeFile==='string').map(record=>record.value.nativeFile.replace(/\\/g,'/')));
    for (const entries of byRecord.values()) {
      const first = entries[0], record = first.record;
      if (first.itemId) { const ids = new Set(entries.map(e => e.itemId)), value = { ...record.value, items: record.value.items.filter(item => !ids.has(item.id)) }; records.push({ collection: record.collection, id: record.id, value, expectedRevision: record.revision }); changedBaselineArchives.push({ id: record.id, archive: value }); }
      else {
        if(record.value?.type==='lvx-managed-suite-baseline'){
          if(typeof record.value.nativeFile!=='string'||!/^\.lvx[\\/]baselines[\\/][a-f0-9]{64}\.png$/.test(record.value.nativeFile)||!/^[a-f0-9]{64}$/.test(record.value.sha256||''))fail('VALIDATION','Managed suite baseline has an invalid scoped filename or checksum. Restore or repair its record before cleanup.');
          const retainedReference=retainedNativeFiles.has(record.value.nativeFile.replace(/\\/g,'/'));
          if(!retainedReference&&!deletedScreenshotFiles.some(file=>file.path===record.value.nativeFile))deletedScreenshotFiles.push({path:record.value.nativeFile,sha256:record.value.sha256});
        }
        records.push({ collection: record.collection, id: record.id, delete: true, expectedRevision: record.revision }); if (record.collection === 'runs') deletedRunIds.push(record.id); if (record.collection === 'baselines') changedBaselineArchives.push({ id: record.id, archive: null });
      }
    }
    const summary = { ...publicPlan(p), deletedCount: p.removed.length, deletedRunIds, changedBaselineArchives, deletedScreenshotFiles, automatic, completedAt: new Date(now()).toISOString() };
    if (automatic && !records.length) return summary;
    // SQLite and native files cannot share a transaction. Persist a compact
    // outbox before removing the canonical records, so a restart can reconcile
    // every native mirror without guessing which evidence was deleted.
    const effects=effectsState();
    if(deletedRunIds.length||changedBaselineArchives.length||deletedScreenshotFiles.length){
      const receipt={id:crypto.randomUUID(),workspaceRoot,createdAt:summary.completedAt,status:'pending',deletedCount:summary.deletedCount,deleteArtifactCount:summary.deleteArtifactCount,deletedRunIds:[...deletedRunIds],changedBaselineArchives:changedBaselineArchives.map(entry=>({id:entry.id})),deletedScreenshotFiles:clone(deletedScreenshotFiles)};
      effects.value.pending.push(receipt);
      records.push({collection:'storage-settings',id:'retention-effects',value:effects.value,expectedRevision:effects.record?.revision??null});summary.effectReceiptId=receipt.id;summary.pendingEffectsCount=effects.value.pending.length;
    }
    const current = saved(); records.push({ collection: 'storage-settings', id: 'retention', value: { ...p.preferences, lastCleanupDate: summary.completedAt, lastCleanupSummary: { deletedCount: summary.deletedCount, deleteByCategory: summary.deleteByCategory, deleteArtifactCount:summary.deleteArtifactCount,deleteArtifactBytes:summary.deleteArtifactBytes,automatic } }, expectedRevision: current?.revision ?? null });
    const result = store.transact(records, { expectedWorkspaceRevision: p.revision,deleteArtifactsForRuns:deletedRunIds,protectedArtifactIds:p.protectedArtifactIds }); emit({ domain: 'workspace', type: 'changed', ...result }); return { ...summary, revision: result.revision };
  }
  return {
    async handle(action, payload = {}) {
      ready(); if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('VALIDATION', 'Storage action needs an object payload.');
      if (action === 'getPreferences') return store.snapshot(()=>({ preferences: preferences(), revision: saved()?.revision ?? null, defaults: normalizePreferences() }));
      if (action === 'status') { const p = plan(), usage = store.usage(),effects=effectsState(),foreign=foreignEffects(); return { ...publicPlan(p), preferences: p.preferences, usage, percentUsed: usage.quotaBytes ? usage.totalBytes / usage.quotaBytes * 100 : 0, warningThresholdExceeded: usage.quotaBytes > 0 && usage.totalBytes / usage.quotaBytes * 100 >= p.preferences.showWarningAt, supportedCollections: COLLECTIONS, pendingEffectsCount:effects.value.pending.length,deferredForeignEffects:foreign.map(r=>({id:r.id,sourceWorkspaceRoot:r.value.sourceWorkspaceRoot,reason:r.value.reason,deferredAt:r.value.deferredAt})),lastEffectCompletion:effects.value.completed.at(-1)||null,lastImport: store.list('migrations').records.map(r => r.value).sort((a, b) => String(b.committedAt || '').localeCompare(String(a.committedAt || '')))[0] || null }; }
      if(action==='pendingEffects'){const effects=effectsState();return {receipts:effects.value.pending,completed:effects.value.completed,completedPrunedCount:effects.value.completedPrunedCount,deferredForeign:foreignEffects().map(r=>({id:r.id,...r.value})),revision:effects.record?.revision??null,workspaceRoot};}
      if(action==='deferredForeignEffects')return {receipts:foreignEffects().map(r=>({id:r.id,...r.value})),readOnly:true};
      if(action==='deferForeignEffects'){
        const id=payload.id||payload.receiptId;if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))fail('VALIDATION','Choose a valid pending effect receipt.');const effects=effectsState(),receipt=effects.value.pending.find(entry=>entry.id===id);
        if(!receipt){const existing=foreignEffects().find(record=>record.value.sourceReceipt?.id===id);if(existing)return {status:'DEFERRED',alreadyDeferred:true,id:existing.id,reason:existing.value.reason};fail('NOT_FOUND','Pending foreign receipt was not found.');}
        if(receipt.workspaceRoot===workspaceRoot)fail('VALIDATION','This receipt belongs to the selected workspace and must be reconciled normally.');
        const deferredId=`foreign-${hash(receipt)}`,existing=store.read('retention-foreign-effects',deferredId),reason='This cleanup originated in another workspace. Its full source intent is preserved for review; no native effects were replayed in this project.';
        effects.value.pending=effects.value.pending.filter(entry=>entry.id!==id);const records=[{collection:'storage-settings',id:'retention-effects',value:effects.value,expectedRevision:effects.record.revision}];if(!existing)records.push({collection:'retention-foreign-effects',id:deferredId,value:{status:'deferred-foreign',sourceWorkspaceRoot:receipt.workspaceRoot,deferredAt:new Date(now()).toISOString(),reason,sourceReceipt:clone(receipt)},expectedRevision:null});
        const result=store.transact(records);emit({domain:'workspace',type:'changed',...result});return {status:'DEFERRED',id:deferredId,reason,revision:result.revision};
      }
      if(action==='acknowledgeEffects'){
        const id=payload.id||payload.receiptId;if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))fail('VALIDATION','Choose a valid cleanup effect receipt.');const effects=effectsState(),receipt=effects.value.pending.find(entry=>entry.id===id);
        if(!receipt){if(effects.value.completed.some(entry=>entry.id===id))return {status:'SUCCESS',alreadyAcknowledged:true,id};fail('NOT_FOUND','Pending cleanup receipt was not found.');}
        if(receipt.workspaceRoot!==workspaceRoot)fail('WORKSPACE_CHANGED','Cleanup receipt belongs to another workspace. Its effects were preserved for review.');
        const supplied=payload.result||payload.nativeEffects||{},keys=['deletedNativeRuns','deletedBaselineFiles','absentBaselineFiles','warnings'],actual={},counts={};
        for(const key of keys){if(supplied[key]!==undefined&&!Array.isArray(supplied[key]))fail('VALIDATION','Native cleanup results must contain lists.');const values=supplied[key]||[];if(values.some(value=>typeof value!=='string'))fail('VALIDATION','Native cleanup result entries must be text.');counts[key]=values.length;actual[key]=values.map(value=>redact(value));}
        const completed={id,workspaceRoot,completedAt:new Date(now()).toISOString(),status:counts.warnings?'completed-with-preserved-files':'completed',nativeEffects:actual,totalCounts:counts,truncated:keys.some(key=>counts[key]>actual[key].length)};
        effects.value.pending=effects.value.pending.filter(entry=>entry.id!==id);effects.value.completed.push(completed);
        const result=store.transact([{collection:'storage-settings',id:'retention-effects',value:effects.value,expectedRevision:effects.record.revision}]);emit({domain:'workspace',type:'changed',...result});return {status:'SUCCESS',id,completion:completed,revision:result.revision};
      }
      if (action === 'setPreferences' || action === 'restoreDefaults') { const next = normalizePreferences(action === 'restoreDefaults' ? {} : payload.preferences), prior = preferences(); next.lastCleanupDate = prior.lastCleanupDate; next.lastCleanupSummary = prior.lastCleanupSummary; const result = store.transact([{ collection: 'storage-settings', id: 'retention', value: next, expectedRevision: payload.expectedRevision ?? null }]); emit({ domain: 'workspace', type: 'changed', ...result }); return { preferences: next, revision: saved().revision }; }
      if (action === 'previewCleanup') { const p = plan(), token = crypto.randomUUID(); previews.set(token, { plan: p }); return { ...publicPlan(p), token }; }
      if (action === 'applyCleanup') { const entry = previews.get(payload.token); if (!entry) fail('PREVIEW_REQUIRED', 'Preview storage cleanup again.'); if (payload.expectedWorkspaceRevision !== entry.plan.revision) fail('CONFLICT', 'Cleanup revision does not match its preview.'); const result = apply(entry.plan); previews.delete(payload.token); return result; }
      if (action === 'autoCleanup') return apply(plan(), { automatic: true });
      fail('UNKNOWN_ACTION', `Unknown retention action: ${String(action)}`);
    },
    close() { previews.clear(); }
  };
}
module.exports = { createRetentionService, normalizePreferences, DEFAULT_POLICIES, COLLECTIONS, stable, hash };
