// ============================================
// INDEXEDDB VERSION STORAGE ADAPTER
// ============================================
// This replaces localStorage with IndexedDB for version histories
// Provides 50 MB - 1 GB+ storage instead of 5-10 MB

class IndexedDBVersionStorage {
  constructor() {
    this.dbName = 'LVX_Machina_Versions';
    this.dbVersion = 1;
    this.storeName = 'version_histories';
    this.db = null;
  }

  async initialize() {
    if (window.electronAPI?.studioOps) { this.native = true; return true; }
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('IndexedDB error:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('IndexedDB initialized for version storage');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(this.storeName)) {
          const objectStore = db.createObjectStore(this.storeName, { keyPath: 'suiteId' });
          objectStore.createIndex('suiteId', 'suiteId', { unique: true });
          console.log('Created IndexedDB object store for versions');
        }
      };
    });
  }

  async saveVersionHistory(suiteId, versions) {
    if (this.native) return this.saveNativeHistory(suiteId, versions);
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('IndexedDB not initialized'));
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const request = store.put({
        suiteId: suiteId,
        versions: versions,
        lastUpdated: new Date().toISOString()
      });

      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
      request.onerror = () => reject(request.error);
    });
  }

  async getVersionHistory(suiteId) {
    if (this.native) return (await this.nativeCall('list', { collection: 'versions' })).records.filter(r => r.value.suiteId === suiteId).map(r => r.value).sort((a,b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('IndexedDB not initialized'));
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(suiteId);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.versions : []);
      };

      request.onerror = () => reject(request.error);
    });
  }

  async deleteVersionHistory(suiteId) {
    if (this.native) { const list = (await this.nativeCall('list', { collection: 'versions' })).records.filter(r => r.value.suiteId === suiteId); if (list.length) await this.nativeCall('transact', { records: list.map(r => ({ collection:'versions', id:r.id, expectedRevision:r.revision, delete:true })) }); return; }
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('IndexedDB not initialized'));
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(suiteId);

      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
      request.onerror = () => reject(request.error);
    });
  }

  async getAllSuiteIds() {
    if (this.native) return [...new Set((await this.nativeCall('list', { collection:'versions' })).records.map(r => r.value.suiteId).filter(Boolean))];
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('IndexedDB not initialized'));
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAllKeys();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getStorageEstimate() {
    if (this.native) { const usage = await this.nativeCall('artifacts'); return { usage:usage.totalBytes, quota:usage.quotaBytes, usageMB:(usage.totalBytes/1048576).toFixed(2), quotaMB:(usage.quotaBytes/1048576).toFixed(2), percentUsed:usage.quotaBytes?(100*usage.totalBytes/usage.quotaBytes).toFixed(1):null }; }
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      return {
        usage: estimate.usage,
        quota: estimate.quota,
        usageMB: (estimate.usage / 1024 / 1024).toFixed(2),
        quotaMB: (estimate.quota / 1024 / 1024).toFixed(2),
        percentUsed: ((estimate.usage / estimate.quota) * 100).toFixed(1)
      };
    }
    return null;
  }

  async migrateFromLocalStorage() {
    // Desktop migration is explicitly previewed by LVXWorkspaceBridge. Opening
    // the version picker must never silently import or erase legacy originals.
    if (this.native) return 0;
    console.log('Migrating version histories from localStorage to IndexedDB...');

    let migrated = 0;
    const keys = Object.keys(localStorage).filter(k => k.startsWith('suite_versions_'));

    for (const key of keys) {
      try {
        const suiteId = key.replace('suite_versions_', '');
        if (localStorage.getItem(`idb_migrated_${suiteId}`)) continue;
        const versions = JSON.parse(localStorage.getItem(key));

        if (!Array.isArray(versions)) throw new Error('Invalid legacy history');
        const existing = await this.getVersionHistory(suiteId);
        const combined = new Map([...versions, ...existing].map(v => [v.versionId, v]));
        const merged = [...combined.values()].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
        await this.saveVersionHistory(suiteId, merged);
        const verified = await this.getVersionHistory(suiteId);
        if (JSON.stringify(verified) !== JSON.stringify(merged)) throw new Error('History migration verification failed');
        localStorage.setItem(`idb_migrated_${suiteId}`, new Date().toISOString());
        // Keep originals as recovery evidence. The active async reader now uses IndexedDB.
        migrated++;
      } catch (error) {
        console.error(`Failed to migrate ${key}:`, error);
        throw error;
      }
    }

    console.log(`Migrated ${migrated} version histories to IndexedDB`);
    return migrated;
  }

  async nativeCall(action, payload = {}) {
    const bridge = window.electronAPI.studioOps;
    const call = async (name, value = {}) => { const result = await (bridge.invokeRaw || bridge.invoke).call(bridge, 'workspace', name, value); if (result?.__lvxError) { const error = new Error(result.__lvxError.message); error.code = result.__lvxError.code; throw error; } return result; };
    const status = await call('status'); if (status.status !== 'SUCCESS' || !status.workspaceRoot) throw Error('Choose a healthy workspace before reading or saving versions.');
    return call(action, { ...payload, workspaceRoot:status.workspaceRoot });
  }

  async saveNativeHistory(suiteId, versions) {
    if (typeof suiteId !== 'string' || !suiteId || !Array.isArray(versions)) throw Error('A suite and version list are required.');
    const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}` : JSON.stringify(value);
    const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(value))))].map(b => b.toString(16).padStart(2,'0')).join('');
    const snapshot = await this.nativeCall('list', { collection:'versions' }), existing = new Map(snapshot.records.map(r => [r.id,r])), changes=[];
    for (const raw of versions) {
      const version = { ...JSON.parse(JSON.stringify(raw)), suiteId };
      version.suiteSnapshot = version.suiteSnapshot || version.suiteData || version.snapshot;
      if (!version.suiteSnapshot || typeof version.suiteSnapshot !== 'object') throw Error('A version snapshot is required; legacy metadata was preserved for explicit migration.');
      version.timestamp = version.timestamp || version.createdAt || version.dateCreated || new Date(0).toISOString();
      version.changeDescription = version.changeDescription || version.description || 'Imported version'; version.changedBy = version.changedBy || version.createdBy || 'local-user';
      const originalId = version.versionId || version.id;
      let id = typeof originalId === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:@-]*$/.test(originalId) ? originalId : `v-${(await digest({suiteId,version})).slice(0,48)}`;
      version.versionId=id;
      const previous=existing.get(id)||[...existing.values()].find(r=>r.value.suiteId===suiteId&&r.value.versionId===originalId);
      const semantic=v=>({suiteId:v.suiteId,versionId:v.versionId,timestamp:v.timestamp,suiteSnapshot:v.suiteSnapshot,changeDescription:v.changeDescription,changedBy:v.changedBy,version:v.version??null});
      if(previous && (stable(previous.value)===stable(version)||stable(semantic(previous.value))===stable(semantic(version))))continue;
      if(previous){version.originalVersionId=originalId;id=`v-${(await digest({suiteId,version})).slice(0,48)}`;version.versionId=id;if(existing.has(id)&&stable(existing.get(id).value)===stable(version))continue;}
      if(existing.has(id))throw Error('Conflicting canonical version identity. Preview a legacy migration to preserve both snapshots.');
      const safe=window.LVXCredentials?await window.LVXCredentials.protect(version,'Suite version'):version;changes.push({collection:'versions',id,value:safe,expectedRevision:null});existing.set(id,{value:safe});
    }
    if(changes.length)await this.nativeCall('transact',{records:changes,expectedWorkspaceRevision:snapshot.revision});
    return true;
  }
}

// ============================================
// ENHANCED VERSION CONTROL WITH INDEXEDDB
// ============================================

class VersionControlWithIndexedDB {
  constructor() {
    this.storage = new IndexedDBVersionStorage();
    this.initialized = false;
  }

  async initialize() {
    try {
      await this.storage.initialize();
      this.initialized = true;

      try { await this.storage.migrateFromLocalStorage(); }
      catch (error) {
        // A damaged legacy record must not disconnect histories already committed to IndexedDB.
        console.error('Some legacy histories could not migrate:', error);
        window.showMessage?.('Some legacy histories remain in local storage and were preserved for recovery.', 'warning');
      }
      return true;
    } catch (error) {
      this.initialized = false;
      console.error('Failed to initialize IndexedDB:', error);
      if (window.showMessage) {
        window.showMessage('Using localStorage fallback (limited storage)', 'warning');
      }
      return false;
    }
  }

  async saveVersion(suiteId, suiteSnapshot, changeDescription = 'Auto-save') {
    const versions = await this.getVersionHistory(suiteId);
    const newVersion = {
      versionId: this._generateId(),
      timestamp: new Date().toISOString(),
      suiteSnapshot: JSON.parse(JSON.stringify(suiteSnapshot)),
      changeDescription,
      changedBy: 'user'
    };

    if (versions.length > 0) {
      newVersion.diff = this._calculateDiff(
        versions[versions.length - 1].suiteSnapshot,
        suiteSnapshot
      );
    } else {
      newVersion.diff = { modified: [] };
    }

    versions.push(newVersion);

    if (this.initialized) {
      await this.storage.saveVersionHistory(suiteId, versions);
      if(this.storage.native)return newVersion.versionId;
      if (localStorage.getItem(`suite_versions_${suiteId}`) !== null) {
        localStorage.setItem(`idb_migrated_${suiteId}`, new Date().toISOString());
      }
      return newVersion.versionId;
    }
    return this._saveToLocalStorage(suiteId, versions, newVersion.versionId);
  }

  async getVersionHistory(suiteId) {
    if (this.storage.native) return this.storage.getVersionHistory(suiteId);
    if (this.initialized) {
      const legacy = localStorage.getItem(`suite_versions_${suiteId}`);
      if (legacy !== null && !localStorage.getItem(`idb_migrated_${suiteId}`)) {
        const committed = await this.storage.getVersionHistory(suiteId);
        const merged = new Map([...JSON.parse(legacy), ...committed].map(v => [v.versionId, v]));
        return [...merged.values()].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
      }
      return await this.storage.getVersionHistory(suiteId);
    }
    return this._getFromLocalStorage(suiteId);
  }

  async restoreVersion(suiteId, versionId) {
    const version = (await this.getVersionHistory(suiteId)).find(v => v.versionId === versionId);
    return version ? JSON.parse(JSON.stringify(version.suiteSnapshot)) : null;
  }

  async deleteVersionHistory(suiteId) {
    if(this.storage.native)return this.storage.deleteVersionHistory(suiteId);
    if (this.initialized) await this.storage.deleteVersionHistory(suiteId);
    localStorage.removeItem(`suite_versions_${suiteId}`);
    localStorage.removeItem(`idb_migrated_${suiteId}`);
  }

  async getStorageInfo() {
    if (this.initialized) {
      const estimate = await this.storage.getStorageEstimate();
      if (estimate) {
        return {
          type: this.storage.native ? 'SQLite workspace' : 'IndexedDB',
          ...estimate,
          isUnlimited: estimate.quota === 0
        };
      }
    }

    // Fallback to localStorage info
    let totalSize = 0;
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('suite_versions_')) {
        totalSize += localStorage.getItem(key).length;
      }
    });

    return {
      type: 'localStorage',
      usage: totalSize,
      quota: null,
      usageMB: (totalSize / 1024 / 1024).toFixed(2),
      quotaMB: 'Unknown (browser managed)',
      percentUsed: null,
      isUnlimited: false
    };
  }

  // Fallback methods
  _saveToLocalStorage(suiteId, versions, versionId) {
    try {
      localStorage.setItem(`suite_versions_${suiteId}`, JSON.stringify(versions));
      localStorage.removeItem(`idb_migrated_${suiteId}`);
      return versionId;
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        throw new Error('Storage quota exceeded. Please enable IndexedDB or clear old versions.');
      }
      throw e;
    }
  }

  _getFromLocalStorage(suiteId) {
    const data = localStorage.getItem(`suite_versions_${suiteId}`);
    return data ? JSON.parse(data) : [];
  }

  _calculateDiff(oldSuite, newSuite) {
    const diff = { modified: [] };

    if (oldSuite.name !== newSuite.name) {
      diff.modified.push({ field: 'name', old: oldSuite.name, new: newSuite.name });
    }
    if (oldSuite.code !== newSuite.code) {
      diff.modified.push({ field: 'code', old: oldSuite.code, new: newSuite.code });
    }
    if (oldSuite.description !== newSuite.description) {
      diff.modified.push({ field: 'description', old: oldSuite.description, new: newSuite.description });
    }
    if (oldSuite.language !== newSuite.language) {
      diff.modified.push({ field: 'language', old: oldSuite.language, new: newSuite.language });
    }
    if (oldSuite.expected_output !== newSuite.expected_output) {
      diff.modified.push({ field: 'expected_output', old: oldSuite.expected_output, new: newSuite.expected_output });
    }

    return diff;
  }

  _generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}

// ============================================
// USAGE
// ============================================

// Publish readiness before callers can save/read. Failure keeps one explicit local backend.
window.IndexedDBVersionStorage = IndexedDBVersionStorage;
window.VersionControlWithIndexedDB = VersionControlWithIndexedDB;
window.indexedDBVersionControl = new VersionControlWithIndexedDB();
window.indexedDBVersionControl.ready = window.indexedDBVersionControl.initialize();

// Helper function to check storage
window.checkIndexedDBStorage = async function() {
  if (window.indexedDBVersionControl) {
    const info = await window.indexedDBVersionControl.getStorageInfo();
    console.log('=== Storage Information ===');
    console.log(`Type: ${info.type}`);
    console.log(`Usage: ${info.usageMB} MB`);
    console.log(`Quota: ${info.quotaMB} MB`);
    console.log(`Percent Used: ${info.percentUsed}%`);
    console.log(`Unlimited: ${info.isUnlimited ? 'Yes ' : 'No '}`);
    return info;
  }
  return null;
};
