/* Canonical desktop suite storage and an explicit, non-destructive legacy import. */
(function (global) {
  'use strict';
  const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:@-]*$/;
  const SECRET = /(?:^(?:api[_-]?key|password|passwd|secret|secret[_-]?value|ciphertext|encryption[_-]?key|access[_-]?token|refresh[_-]?token|authorization|private[_-]?key|credential|credentials|client[_-]?secret|token)$|(?:api[_-]?key|password|passwd|secret|token|authheader|webhookurl|clientsecret|private[_-]?key)$)/i;
  const ARRAY_SOURCES = {
    pipeline_test_suites: 'suites', test_data_sets: 'datasets', test_environments: 'environments',
    lvx_pipelines: 'pipelines', lvx_unit_tests: 'unit-tests', test_execution_history: 'history',
    security_scan_history: 'security-history', notification_history: 'notification-history',
    views: 'views', team_members: 'legacy-team-members'
  };
  const LEGACY_CONFIGS = new Set(['notification_integrations','execution_config','storage_config','sharing_backend_config','cicd_backend_config','lvx_storage_preferences']);
  const EXACT_SOURCES = new Set([...Object.keys(ARRAY_SOURCES), ...LEGACY_CONFIGS, 'baseline_screenshots', 'test_comments', 'security_scan_results', 'security_policy', 'active_environment']);
  const isSource = name => EXACT_SOURCES.has(name) || name.startsWith('suite_versions_') || name.startsWith('versions_');
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  function failure(code, message, details) { const error = new Error(message); error.code = code; error.details = details; return error; }
  function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  }
  async function digest(value) {
    if (!global.crypto?.subtle) throw failure('CRYPTO_UNAVAILABLE', 'Secure browser hashing is unavailable. Open the desktop app to migrate safely.');
    const bytes = new TextEncoder().encode(typeof value === 'string' ? value : stable(value));
    return [...new Uint8Array(await global.crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function api(options = {}) {
    const bridge = global.electronAPI?.studioOps;
    const invoke = options.invoke || (bridge && (bridge.invokeRaw || bridge.invoke).bind(bridge));
    if (!invoke) throw failure('DESKTOP_REQUIRED', 'Workspace storage requires the desktop app and a selected workspace.');
    return {
      async call(action, payload = {}) {
        const result = await invoke('workspace', action, payload);
        if (result?.__lvxError) throw failure(result.__lvxError.code, result.__lvxError.message, result.__lvxError.details);
        return result;
      },
      onEvent: options.onEvent || (bridge?.onEvent && bridge.onEvent.bind(bridge))
    };
  }
  class DesktopStorageBackend {
    constructor(options = {}) {
      this.transport = api(options);
      const call=this.transport.call.bind(this.transport);
      this.transport.call=(action,payload={})=>call(action,{...payload,...(this.workspaceRoot?{workspaceRoot:this.workspaceRoot}:{})});
      this.cache = new Map(); this.edits = new Map(); this.listeners = new Set();
      this.pending = Promise.resolve(); this.refreshPending = null; this.workspaceRoot = null; this.initialized = false;
      this.lastError = null;
      this.unsubscribe = this.transport.onEvent?.(event => {
        if (event?.domain === 'workspace' && event.type === 'changed') void this.refresh().catch(error => { this.lastError = error; });
      });
    }
    async initialize() {
      const state = await this.transport.call('status');
      if (state.status !== 'SUCCESS' || !state.workspaceRoot) throw failure(state.error?.code || 'WORKSPACE_REQUIRED', state.error?.message || 'Choose a workspace folder first.');
      if (this.workspaceRoot && this.workspaceRoot !== state.workspaceRoot) throw failure('WORKSPACE_CHANGED', 'The workspace changed. Reopen this editor in the selected workspace.');
      this.workspaceRoot = state.workspaceRoot; this.initialized = true; return true;
    }
    async guard() { await this.initialize(); }
    suite(record) {
      const value = clone(record.value);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('INVALID_SUITE', 'A stored suite has an unsupported shape. Restore a verified archive or repair it in the workspace records view.');
      return { ...value, id: record.id, tags: value.tags || [], isFavorite: value.isFavorite ?? false, dateCreated: value.dateCreated || record.modified, dateModified: value.dateModified || record.modified };
    }
    async getAllSuites() {
      await this.guard();
      const { records } = await this.transport.call('list', { collection: 'suites' });
      this.cache = new Map(records.map(record => [record.id, clone(record)]));
      return records.map(record => this.suite(record));
    }
    queue(operation) { const result = this.pending.then(operation); this.pending = result.catch(() => {}); return result; }
    async refresh() {
      if (this.refreshPending) return this.refreshPending;
      this.refreshPending = (async () => {
        const suites = await this.getAllSuites();
        for (const listener of this.listeners) { try { await listener(clone(suites)); } catch (error) { this.lastError = error; } }
        return suites;
      })();
      try { return await this.refreshPending; } finally { this.refreshPending = null; }
    }
    async subscribeToChanges(callback) {
      if (typeof callback !== 'function') throw new TypeError('Storage listener must be a function.');
      this.listeners.add(callback);
      try { await callback(await this.getAllSuites()); } catch (error) { this.listeners.delete(callback); throw error; }
      return () => this.listeners.delete(callback);
    }
    async beginEdit(id) {
      await this.guard();
      const record = await this.transport.call('read', { collection: 'suites', id });
      if (!record) throw failure('NOT_FOUND', 'The suite was deleted in another window. Reload your list.');
      this.edits.set(id, clone(record)); this.cache.set(id, clone(record));
      return this.suite(record);
    }
    discardEdit(id) { this.edits.delete(id); }
    async reloadSuite(id) { this.discardEdit(id); return this.beginEdit(id); }
    saveSuite(suite) {
      return this.queue(async () => {
        await this.guard();
        if(global.LVXCredentials)suite=await global.LVXCredentials.protect(suite,'Suite');
        const id = suite.id || global.crypto.randomUUID();
        const now = new Date().toISOString();
        const value = { ...clone(suite), id, last_run_time: suite.last_run_time || null, last_run_status: suite.last_run_status || 'NEVER_RUN', last_run_log: suite.last_run_log || '', tags: suite.tags || [], isFavorite: suite.isFavorite ?? false, dateCreated: suite.dateCreated || now, dateModified: now };
        const result = await this.transport.call('transact', { records: [{ collection: 'suites', id, value, expectedRevision: null }], workspaceRoot: this.workspaceRoot });
        this.cache.set(id, { collection: 'suites', id, value, revision: result.changes[0].revision, modified: now });
        suite.id = id;
        try { await this.refresh(); } catch (error) { this.lastError = error; }
        return id;
      });
    }
    async commitUpdate(id, updates, original) {
      if(global.LVXCredentials)updates=await global.LVXCredentials.protect(updates,'Suite');
      const editing = this.edits.has(id);
      const now = new Date().toISOString();
      const value = { ...clone(original.value), ...clone(updates), id, dateModified: now };
      const versionId = global.crypto.randomUUID();
      const version = { suiteId: id, versionId, timestamp: now, suiteSnapshot: clone(original.value), changeDescription: 'Before desktop update', changedBy: 'local-user' };
      // Suite and pre-edit version are one transaction; a version is never added
      // when a stale suite update fails.
      const result = await this.transport.call('transact', { records: [
        { collection: 'suites', id, value, expectedRevision: original.revision },
        { collection: 'versions', id: versionId, value: version, expectedRevision: null }
      ], workspaceRoot: this.workspaceRoot });
      const committed = { collection: 'suites', id, value, revision: result.changes[0].revision, modified: now };
      this.cache.set(id, committed);
      if (editing) this.edits.set(id, clone(committed));
      try { await this.refresh(); } catch (error) { this.lastError = error; }
      return id;
    }
    updateSuite(id, updates) {
      return this.queue(async () => {
        await this.guard();
        const original = this.edits.get(id) || this.cache.get(id);
        if (!original) throw failure('REVISION_REQUIRED', 'Reload the suite before saving it. Its original revision is unavailable.');
        return this.commitUpdate(id, updates, original);
      });
    }
    mergeSuite(id, mergedValue, expectedRevision) {
      return this.queue(async () => {
        await this.guard();
        const latest = await this.transport.call('read', { collection: 'suites', id });
        if (!latest) throw failure('NOT_FOUND', 'This suite was deleted. Save your work as a new suite instead.');
        if(expectedRevision!==undefined&&latest.revision!==expectedRevision)throw failure('CONFLICT','The saved suite changed again while you reviewed the merge. Review the newer version before saving.');
        // A second writer racing the merge is still rejected by SQLite CAS.
        return this.commitUpdate(id, mergedValue, latest);
      });
    }
    deleteSuite(id) {
      return this.queue(async () => {
        await this.guard();
        const original = this.edits.get(id) || this.cache.get(id);
        if (!original) throw failure('REVISION_REQUIRED', 'Reload the suite before deleting it.');
        await this.transport.call('transact', { records: [{ collection: 'suites', id, expectedRevision: original.revision, delete: true }], workspaceRoot: this.workspaceRoot });
        this.cache.delete(id); this.edits.delete(id);
        try { await this.refresh(); } catch (error) { this.lastError = error; }
      });
    }
    getStatusMessage() { return this.initialized ? 'Connected: Desktop workspace (SQLite, revision protected)' : 'Choose a workspace to connect desktop storage'; }
    dispose() { this.unsubscribe?.(); this.listeners.clear(); this.edits.clear(); this.initialized = false; }
  }

  function rawSources() {
    const storage = global.localStorage;
    if (!storage) throw failure('SOURCE_UNAVAILABLE', 'Browser storage is unavailable. No legacy data was changed.');
    const values = {};
    for (let i = 0; i < storage.length; i++) {
      const name = storage.key(i);
      if (name && isSource(name)) values[name] = storage.getItem(name);
    }
    return Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
  }
  async function readIndexedVersions() {
    const adapter = global.indexedDBVersionControl;
    if (adapter?.ready) await adapter.ready;
    let db = adapter?.storage?.db;
    let owned = false;
    if (!db) {
      if (!global.indexedDB) return { records: [], coverage: 'unavailable' };
      if (typeof global.indexedDB.databases !== 'function') throw failure('VERSION_COVERAGE', 'Cannot safely inspect whether legacy IndexedDB exists. Retry in the desktop app or explicitly migrate without versions.');
      const databases = await global.indexedDB.databases();
      if (!databases.some(database => database.name === 'LVX_Machina_Versions')) return { records: [], coverage: 'absent' };
      db = await new Promise((resolve, reject) => {
        const request = global.indexedDB.open('LVX_Machina_Versions');
        let settled = false;
        function finish(ok, value) { if (settled) { if (ok) value.close(); return; } settled = true; if (ok) resolve(value); else reject(value); }
        request.onupgradeneeded = () => { request.transaction.abort(); finish(false, failure('VERSION_COVERAGE', 'Version database disappeared while opening; nothing was created.')); };
        request.onsuccess = () => finish(true, request.result);
        request.onerror = () => finish(false, failure('VERSION_READ', 'Legacy IndexedDB could not be opened. Originals remain unchanged.'));
        request.onblocked = () => finish(false, failure('VERSION_BLOCKED', 'Another window is blocking version history. Close its editor and retry.'));
      });
      owned = true;
    }
    try {
      if (!db.objectStoreNames.contains('version_histories')) throw failure('VERSION_SCHEMA', 'Legacy version database has an unsupported schema.');
      const records = await new Promise((resolve, reject) => {
        const transaction = db.transaction(['version_histories'], 'readonly');
        const request = transaction.objectStore('version_histories').openCursor();
        const result = [];
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          result.push(cursor.value); cursor.continue();
        };
        request.onerror = () => reject(failure('VERSION_READ', 'Version histories could not be read.'));
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => reject(failure('VERSION_READ', 'Version history snapshot was aborted. Nothing was migrated.'));
        transaction.onerror = () => reject(failure('VERSION_READ', 'Version history snapshot failed.'));
      });
      return { records, coverage: 'complete' };
    } finally { if (owned) db.close(); }
  }
  async function readConsolidatedLegacy({ includeVersions = true } = {}) {
    if (!global.indexedDB) return { records: [], coverage: 'unavailable' };
    if (typeof global.indexedDB.databases !== 'function') throw failure('LEGACY_COVERAGE', 'Cannot safely inspect the consolidated Machina database. Use the desktop app to preview migration; originals are unchanged.');
    const databases = await global.indexedDB.databases(); if (!databases.some(db => db.name === 'LVX_Machina_Storage')) return { records: [], coverage: 'absent' };
    const db = await new Promise((resolve, reject) => { const request = global.indexedDB.open('LVX_Machina_Storage'); request.onupgradeneeded = () => { request.transaction.abort(); reject(failure('LEGACY_COVERAGE', 'Consolidated storage disappeared; no database was created.')); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(failure('LEGACY_READ', 'Consolidated Machina storage could not be opened. Close the old app and retry.')); request.onblocked = () => reject(failure('LEGACY_BLOCKED', 'Close other Machina windows before previewing consolidated storage.')); });
    const supported = { test_suites: 'suites', execution_history: 'history', security_scans: 'security-history', screenshots: 'baselines', versions: 'versions', datasets: 'datasets', unit_tests: 'unit-tests' }, records = [];
    try {
      const stores = Object.keys(supported).filter(name => (includeVersions || name !== 'versions') && db.objectStoreNames.contains(name));
      if(stores.length)await new Promise((resolve,reject)=>{
        // One readonly transaction is a coherent snapshot across every original
        // category, even when another old Machina window is still open.
        const tx=db.transaction(stores,'readonly'),rows=Object.fromEntries(stores.map(name=>[name,[]]));
        for(const name of stores){const request=tx.objectStore(name).openCursor();request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;rows[name].push(clone(cursor.value));cursor.continue();};request.onerror=()=>reject(failure('LEGACY_READ',`Could not read ${name}; originals remain unchanged.`));}
        tx.oncomplete=()=>{for(const name of stores)for(const value of rows[name])records.push({collection:supported[name],value,source:`IndexedDB:LVX_Machina_Storage/${name}`});resolve();};tx.onerror=tx.onabort=()=>reject(failure('LEGACY_READ','Consolidated Machina snapshot failed; originals remain unchanged.'));
      });
      return { records, coverage: 'complete' };
    } finally { db.close(); }
  }
  function rejectLegacyEncrypted(value, path = 'legacy data') {
    if (!value || typeof value !== 'object') return;
    if (value.__lvxEncrypted) throw failure('LEGACY_ENCRYPTED', `Encrypted Machina value at ${path} cannot be used as configuration. Re-export a decrypted copy from the original app on its original OS account, or re-enter this credential in Setup & diagnostics. The original data is unchanged.`);
    for (const [key, child] of Object.entries(value)) rejectLegacyEncrypted(child, `${path}.${key}`);
  }
  function normalizeLegacySuite(value) { const result = clone(value); if (!result.code && typeof result.testCode === 'string') result.code = result.testCode; if (!result.code && typeof result.test_code === 'string') result.code = result.test_code; if (!result.dateCreated && result.created !== undefined) result.dateCreated = typeof result.created === 'number' ? new Date(result.created).toISOString() : result.created; result.language ||= 'javascript'; result.tags = Array.isArray(result.tags) ? result.tags : []; result.isFavorite ??= false; return result; }
  function normalizeLegacyDataset(value) { const result=clone(value),headers=Array.isArray(result.headers)?result.headers:[];if(!result.rows&&Array.isArray(result.data))result.rows=result.data.map(row=>Array.isArray(row)?Object.fromEntries(headers.map((h,i)=>[h,row[i]??''])):row);if(!result.schema&&headers.length)result.schema=headers.map(name=>{const values=(result.rows||[]).map(row=>row[name]).filter(v=>v!==null&&v!==undefined&&v!=='');const type=values.length&&values.every(v=>typeof v==='number')?(values.every(Number.isInteger)?'integer':'number'):values.length&&values.every(v=>typeof v==='boolean')?'boolean':'string';return {name,type};});return result; }
  function normalizeLegacyVersion(value) { const result = clone(value); result.suiteSnapshot ||= result.suiteData || result.snapshot; if (result.suiteSnapshot) result.suiteSnapshot = normalizeLegacySuite(result.suiteSnapshot); result.timestamp ||= result.createdAt || result.dateCreated || new Date(0).toISOString(); if(typeof result.timestamp==='number')result.timestamp=new Date(result.timestamp).toISOString(); result.changeDescription ||= result.description || 'Imported version'; result.changedBy ||= result.createdBy || 'user'; result.diff ||= { modified: [] }; return result; }
  function sanitize(value, omitted, context = '') {
    if (Array.isArray(value)) return value.map(child => sanitize(child, omitted, context));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([name]) => {
      if(name==='default'&&value.secret===true){omitted.count++;return false;}
      if (!SECRET.test(name) || ['schema','parameterSchema','parameter_schema'].includes(context) || (typeof value[name] === 'string' && /^secret:[a-f0-9-]{36}$/i.test(value[name])) || (value[name] && typeof value[name] === 'object' && Object.keys(value[name]).length===1 && /^secret:[a-f0-9-]{36}$/i.test(value[name].secretRef||'')) || (name==='secret' && typeof value[name]==='boolean')) return true;
      omitted.count++; return false;
    }).map(([name, child]) => [name, sanitize(child, omitted, name)]));
    if (typeof value === 'string') {
      const result = value.replace(/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]').replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/g, '[REDACTED CREDENTIAL]').replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:]+:[^\s/@]+@/gi, '$1[REDACTED]@');
      if (result !== value) omitted.count++;
      return result;
    }
    return value;
  }
  async function captureLegacy({ includeVersions = true } = {}) {
    if (typeof includeVersions !== 'boolean') throw failure('VALIDATION', 'Choose whether to include version histories.');
    const raw = rawSources();
    const versions = includeVersions ? await readIndexedVersions() : { records: [], coverage: 'excluded' };
    const consolidated = await readConsolidatedLegacy({ includeVersions });
    if (stable(raw) !== stable(rawSources())) throw failure('SOURCE_CHANGED', 'Legacy records changed while taking a snapshot. Retry the preview.');
    const errors = [], warnings = [], omitted = { count: 0 }, records = [], idMaps = new Map();
    const safeId = async (collection, id, fallback) => {
      const original = id === undefined || id === null || id === '' ? fallback : String(id);
      const safe = ID.test(original) ? original : `legacy-${(await digest(`${collection}\0${original}`)).slice(0, 40)}`;
      idMaps.set(`${collection}\0${original}`, safe);
      if (safe !== original) warnings.push(`An unsupported ${collection} identifier was mapped to a portable identifier; its original is retained in the record.`);
      return safe;
    };
    const add = async (collection, id, value, source) => {
      const fallback = `legacy-${(await digest({ collection, value, source })).slice(0, 40)}`;
      const canonicalId = await safeId(collection, id, fallback);
      rejectLegacyEncrypted(value, source);
      if (collection === 'suites') value = normalizeLegacySuite(value);
      if (collection === 'datasets') value = normalizeLegacyDataset(value);
      const sanitized = sanitize(clone(value), omitted);
      if (id !== undefined && String(id) !== canonicalId && sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) sanitized.legacyOriginalId = String(id);
      records.push({ collection, id: canonicalId, value: sanitized });
    };
    const versionSources = [];
    for (const entry of consolidated.records) {
      try {
        rejectLegacyEncrypted(entry.value, entry.source);
        if (entry.collection === 'versions') { if (!Array.isArray(entry.value.versions)) throw Error('Consolidated version history must contain a versions list.'); versionSources.push({ suiteId: String(entry.value.suiteId || entry.value.id || ''), versions: entry.value.versions, source: entry.source }); }
        else if (entry.collection === 'baselines') await add('baselines', entry.value.id || entry.value.name, { ...entry.value, name: entry.value.name || entry.value.id, baseline: entry.value.baseline || entry.value.data }, entry.source);
        else await add(entry.collection, entry.value.id, entry.value, entry.source);
      } catch (error) { errors.push(`${entry.source}: ${error.message}`); }
    }
    for (const [source, text] of Object.entries(raw)) {
      try {
        if (source === 'active_environment') { if (text) await add('project-preferences', 'active-environment', { environmentId: text }, source); continue; }
        const parsed = JSON.parse(text);
        if (LEGACY_CONFIGS.has(source)) { await add('legacy-config',source,{key:source,value:parsed,applyRequired:true},source);warnings.push(`Configuration ${source} is retained for explicit review and apply; it was not activated.`); }
        else if (source.startsWith('suite_versions_') || source.startsWith('versions_')) {
          if (!includeVersions) continue;
          if (!Array.isArray(parsed)) throw new Error('Version history must be an array.');
          versionSources.push({ suiteId: source.replace(/^(?:suite_versions_|versions_)/, ''), versions: parsed, source });
        } else if (ARRAY_SOURCES[source]) {
          if (!Array.isArray(parsed)) throw new Error('Expected a list of project records.');
          for (const [index, value] of parsed.entries()) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Project records must be objects.');
            await add(ARRAY_SOURCES[source], value.id, value, `${source}#${index}`);
          }
        } else if (source === 'baseline_screenshots') {
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a baseline map.');
          for (const [name, baseline] of Object.entries(parsed)) await add('baselines', name, { name, baseline }, source);
        } else if (source === 'test_comments') {
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a suite comment map.');
          for (const [suiteId, comments] of Object.entries(parsed)) {
            if (!Array.isArray(comments)) throw new Error('Suite comments must be an array.');
            for (const [index, comment] of comments.entries()) await add('comments', comment.id, { ...comment, suiteId }, `${source}#${suiteId}#${index}`);
          }
        } else if (source === 'security_policy') await add('security-policies', 'legacy-policy', parsed, source);
        else if (source === 'security_scan_results') {
          if (Array.isArray(parsed)) for (const value of parsed) await add('security-results', value.id, value, source);
          else if (parsed && typeof parsed === 'object') for (const [id, value] of Object.entries(parsed)) await add('security-results', id, { result: value }, source);
          else throw new Error('Expected security result records.');
        }
      } catch (error) { errors.push(`${source}: ${error.name === 'SyntaxError' ? 'Invalid JSON. Originals remain unchanged.' : error.message}`); }
    }
    for (const entry of versions.records) {
      if (!entry || !Array.isArray(entry.versions) || typeof entry.suiteId !== 'string') errors.push('IndexedDB contains an invalid version history.');
      else versionSources.push({ suiteId: entry.suiteId, versions: entry.versions, source: 'IndexedDB:version_histories' });
    }
    const remap = (collection, id) => idMaps.get(`${collection}\0${String(id)}`) || id;
    const versionIdentities = new Map();
    for (const entry of versionSources) for (const version of entry.versions) {
      if (!version || typeof version !== 'object') { errors.push('A legacy version is invalid.'); continue; }
      const value = { ...normalizeLegacyVersion(version), suiteId: remap('suites', entry.suiteId) };
      const identity = `${entry.suiteId}\0${version.versionId || version.id || ''}`;
      if (version.versionId || version.id) {
        if (versionIdentities.has(identity) && versionIdentities.get(identity) !== stable(version)) warnings.push('Conflicting historical snapshots with the same version label were preserved as separate evidence records.');
        versionIdentities.set(identity, stable(version));
      }
      const normalizedIdentity = normalizeLegacyVersion(version);
      const id = `v-${(await digest({ suiteId: entry.suiteId, versionId: version.versionId || version.id || null, timestamp: normalizedIdentity.timestamp, suiteSnapshot: normalizedIdentity.suiteSnapshot, changeDescription: normalizedIdentity.changeDescription, changedBy: normalizedIdentity.changedBy })).slice(0, 40)}`;
      value.versionId ||= version.id || id;
      await add('versions', id, value, entry.source);
    }
    const referenceCollection = { suiteId: 'suites', testSuiteId: 'suites', dataSetId: 'datasets', environmentId: 'environments', envId: 'environments', unitTestId: 'unit-tests' };
    function rewrite(value) {
      if (Array.isArray(value)) return value.map(rewrite);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value).map(([name, child]) => {
        if (referenceCollection[name] && child !== null) return [name, remap(referenceCollection[name], child)];
        if (name === 'dependencies' && Array.isArray(child)) return [name, child.map(ref => ref && typeof ref === 'object' ? { ...ref, id: remap(ref.collection, ref.id) } : ref)];
        const rewritten = rewrite(child);
        if (['suiteSnapshot', 'suiteData'].includes(name) && rewritten?.id) rewritten.id = remap('suites', rewritten.id);
        return [name, rewritten];
      }));
    }
    const unique = new Map();
    for (const record of records) {
      record.value = rewrite(record.value);
      if (record.value && typeof record.value === 'object' && !Array.isArray(record.value) && record.value.id !== undefined) record.value.id = record.id;
      const identity = `${record.collection}/${record.id}`;
      const previous = unique.get(identity);
      if (previous && stable(previous.value) !== stable(record.value) && !(record.collection === 'versions' && stable({ snapshot:previous.value.suiteSnapshot,timestamp:previous.value.timestamp,description:previous.value.changeDescription,user:previous.value.changedBy }) === stable({ snapshot:record.value.suiteSnapshot,timestamp:record.value.timestamp,description:record.value.changeDescription,user:record.value.changedBy }))) errors.push(`Conflicting legacy records share ${identity}. Originals are preserved; resolve the duplicate before migrating.`);
      else unique.set(identity, record);
    }
    const collected = [...unique.values()].sort((a, b) => `${a.collection}/${a.id}`.localeCompare(`${b.collection}/${b.id}`));
    const references = value => {
      const refs = [];
      if (Array.isArray(value)) value.forEach(child => refs.push(...references(child)));
      else if (value && typeof value === 'object') for (const [name, child] of Object.entries(value)) {
        if (referenceCollection[name] && child) refs.push({ collection: referenceCollection[name], id: String(child) });
        else refs.push(...references(child));
      }
      return refs;
    };
    for (const record of collected) {
      if (!record.value || typeof record.value !== 'object' || Array.isArray(record.value)) continue;
      if (record.value.dependencies !== undefined && !Array.isArray(record.value.dependencies)) errors.push(`Invalid dependency list in legacy ${record.collection} record.`);
      const explicit = Array.isArray(record.value.dependencies) ? record.value.dependencies : [];
      const refs = [...explicit, ...references(record.value)];
      const deps = new Map();
      for (const ref of refs) {
        if (!ref || typeof ref.collection !== 'string' || typeof ref.id !== 'string') { errors.push(`Invalid dependency in legacy ${record.collection} record.`); continue; }
        const identity = `${ref.collection}/${ref.id}`;
        if (unique.has(identity) && identity !== `${record.collection}/${record.id}`) deps.set(identity, ref);
        else if (!unique.has(identity)) {
          if (explicit.includes(ref)) errors.push(`A declared dependency is missing from legacy ${record.collection} data.`);
          else warnings.push(`A legacy ${record.collection} record refers to unavailable ${ref.collection} data. Historical evidence is preserved; review the reference before running.`);
        }
      }
      if (deps.size) record.value.dependencies = [...deps.values()];
    }
    if (omitted.count) warnings.push(`${omitted.count} credential-like fields or values were omitted. Configure credentials in the OS-backed secret vault; originals remain unchanged.`);
    if (versions.coverage === 'unavailable') warnings.push('IndexedDB is unavailable in this environment. Only localStorage versions could be captured.');
    if (!includeVersions) warnings.push('Version histories were explicitly excluded.');
    const selectedRaw = Object.fromEntries(Object.entries(raw).filter(([name]) => includeVersions || !/^(?:suite_versions_|versions_)/.test(name)));
    return { records: collected, errors, warnings: [...new Set(warnings)], counts: collected.reduce((result, record) => { result[record.collection] = (result[record.collection] || 0) + 1; return result; }, {}), sourceKeys: [...Object.keys(selectedRaw), ...new Set(consolidated.records.map(r => r.source))], versionCoverage: versions.coverage, consolidatedCoverage: consolidated.coverage, omittedCredentialFields: omitted.count, sourceFingerprint: await digest({ raw: selectedRaw, versions: versions.records, consolidated: consolidated.records, includeVersions }) };
  }
  async function previewLegacy(options = {}) {
    const transport = api(options);
    const state = await transport.call('status');
    if (state.status !== 'SUCCESS') throw failure('WORKSPACE_REQUIRED', 'Choose a healthy workspace before previewing legacy data.');
    const capture = await captureLegacy(options);
    const existing = await transport.call('list');
    const lookup = new Map(existing.records.map(record => [`${record.collection}/${record.id}`, record]));
    const migrationId = `legacy-${capture.sourceFingerprint}`;
    const marker = lookup.get(`migrations/${migrationId}`);
    const conflicts = marker ? [] : capture.records.filter(record => lookup.has(`${record.collection}/${record.id}`) && stable(lookup.get(`${record.collection}/${record.id}`).value) !== stable(record.value)).map(({ collection, id }) => ({ collection, id }));
    if (conflicts.length) capture.errors.push('Desktop records differ from this legacy snapshot. Resolve the listed conflicts; migration never overwrites desktop edits.');
    return { ...capture, valid: !capture.errors.length, conflicts, alreadyMigrated: !!marker, migrationId, workspaceRoot: state.workspaceRoot, workspaceRevision: existing.revision, recordsToCreate: marker ? [] : capture.records.filter(record => !lookup.has(`${record.collection}/${record.id}`)) };
  }
  async function migrateLegacy(options = {}) {
    const transport = api(options);
    const preview = await previewLegacy(options);
    if (options.expectedFingerprint && options.expectedFingerprint !== preview.sourceFingerprint) throw failure('SOURCE_CHANGED', 'Legacy data changed after your preview. Preview it again before importing.');
    if (!preview.valid) throw failure('MIGRATION_INVALID', 'Legacy migration failed validation. No desktop records or originals were changed.', { errors: preview.errors, conflicts: preview.conflicts });
    if (preview.alreadyMigrated) return { status: 'SUCCESS', alreadyMigrated: true, sourceFingerprint: preview.sourceFingerprint, counts: preview.counts, warnings: preview.warnings };
    const marker = { kind: 'legacy-browser-import', sourceFingerprint: preview.sourceFingerprint, committedAt: new Date().toISOString(), counts: preview.counts, sourceKeys: preview.sourceKeys, versionCoverage: preview.versionCoverage, dependencies: preview.records.map(({ collection, id }) => ({ collection, id })) };
    const records = [...preview.recordsToCreate.map(record => ({ ...record, expectedRevision: null })), { collection: 'migrations', id: preview.migrationId, value: marker, expectedRevision: null }];
    try {
      const current = await transport.call('status');
      if (current.workspaceRoot !== preview.workspaceRoot) throw failure('WORKSPACE_CHANGED', 'Workspace changed during migration. No data was imported.');
      const result = await transport.call('transact', { records, expectedWorkspaceRevision: preview.workspaceRevision, workspaceRoot: preview.workspaceRoot });
      return { ...result, migratedRecords: preview.recordsToCreate.length, counts: preview.counts, sourceFingerprint: preview.sourceFingerprint, warnings: preview.warnings, originalsRetained: true };
    } catch (error) {
      // An IPC response can be lost after COMMIT. The marker is proof that the
      // complete exact snapshot committed, so retrying does not duplicate it.
      if (error.code === 'CONFLICT') {
        const current = await transport.call('status');
        if (current.workspaceRoot === preview.workspaceRoot && await transport.call('read', { collection: 'migrations', id: preview.migrationId })) return { status: 'SUCCESS', alreadyMigrated: true, counts: preview.counts, sourceFingerprint: preview.sourceFingerprint, originalsRetained: true };
      }
      throw error;
    }
  }
  async function snapshotCompatibility(options = {}) {
    const transport=api(options), status=await transport.call('status');
    if(status.status!=='SUCCESS')throw failure('WORKSPACE_REQUIRED','Choose a healthy workspace before exporting.');
    // Preserve retained editors' current data without overwriting independently
    // edited canonical records. The snapshot is explicitly restorable after import.
    const keys=new Set([...EXACT_SOURCES,'execution_config','security_policy','cicd_backend_config','notification_integrations','sharing_backend_config']);
    const values={};for(let i=0;i<global.localStorage.length;i++){const key=global.localStorage.key(i);if(!keys.has(key)&&!isSource(key))continue;const text=global.localStorage.getItem(key);if(text===null)continue;if(key==='active_environment'){values[key]=text;continue;}try{values[key]=JSON.parse(text);}catch{throw failure('LEGACY_INVALID','Saved '+key+' is not valid JSON. Export stopped; the original data is retained.');}}
    const safe=global.LVXCredentials?await global.LVXCredentials.protect(values,'Compatibility archive'):values;
    const existing=await transport.call('read',{collection:'legacy-runtime',id:'browser-editors'});
    const fingerprint=await digest(safe);if(existing?.value?.fingerprint===fingerprint)return {unchanged:true};
    return transport.call('transact',{workspaceRoot:status.workspaceRoot,records:[{collection:'legacy-runtime',id:'browser-editors',value:{format:'lvx-browser-editors',schemaVersion:1,fingerprint,values:safe},expectedRevision:existing?.revision??null}]});
  }
  async function restoreCompatibility(options = {}) {
    const transport=api(options),status=await transport.call('status');
    const record=await transport.call('read',{collection:'legacy-runtime',id:'browser-editors'});
    if(!record)throw failure('NOT_FOUND','This project contains no retained-editor snapshot.');
    const snapshot=record.value;
    if(snapshot?.format!=='lvx-browser-editors'||snapshot.schemaVersion!==1||!snapshot.values||typeof snapshot.values!=='object'||Array.isArray(snapshot.values))throw failure('SNAPSHOT_INVALID','The retained-editor snapshot is invalid. Existing browser data was preserved.');
    const current=await transport.call('status');if(current.workspaceRoot!==status.workspaceRoot)throw failure('WORKSPACE_CHANGED','Choose the same workspace before restoring.');
    const prior={};for(const key of Object.keys(snapshot.values)){if(!isSource(key)&&!['execution_config','cicd_backend_config','notification_integrations','sharing_backend_config'].includes(key))throw failure('SNAPSHOT_INVALID','Unsupported browser setting in archive.');prior[key]=global.localStorage.getItem(key);}
    try{for(const [key,value]of Object.entries(snapshot.values))global.localStorage.setItem(key,key==='active_environment'?String(value):JSON.stringify(value));}
    catch(error){for(const [key,value]of Object.entries(prior))try{value===null?global.localStorage.removeItem(key):global.localStorage.setItem(key,value);}catch{}throw failure('RESTORE_FAILED','Browser storage could not restore all settings. Original values were restored where storage allowed it; the SQLite archive remains intact.');}
    return {restoredKeys:Object.keys(snapshot.values),reloadRequired:true};
  }
  global.LVXWorkspaceBridge = Object.freeze({
    createBackend: options => new DesktopStorageBackend(options), previewLegacy, migrateLegacy,
    backup: ({ invoke, onEvent, ...payload } = {}) => api({ invoke, onEvent }).call('backup', payload),
    previewArchive: (archive, options = {}) => api(options).call('previewImport', { archive }),
    restoreArchive: async (archive, { mode = 'merge', expectedWorkspaceRevision, ...options } = {}) => {
      const transport = api(options), state = await transport.call('status');
      return transport.call('import', { archive, mode, expectedWorkspaceRevision, workspaceRoot: state.workspaceRoot });
    },
    captureLegacy, snapshotCompatibility, restoreCompatibility
  });
})(window);
