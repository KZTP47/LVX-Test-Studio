// ============================================
// INDEXEDDB VERSION STORAGE ADAPTER
// ============================================
// Legacy compatibility wrapper that now uses the shared StorageManager DB

class IndexedDBVersionStorage {
  constructor() {
    this.dbName = 'LVX_Machina_Storage';
    this.storeName = 'versions';
    this.storageManager = null;
  }

  async initialize() {
    if (!window.storageManager || typeof window.storageManager.ensureReady !== 'function') {
      throw new Error('Shared StorageManager is not available');
    }

    await window.storageManager.ensureReady();
    this.storageManager = window.storageManager;
    console.log('✅ Shared IndexedDB storage ready for version history');
  }

  async saveVersionHistory(suiteId, versions) {
    if (!this.storageManager) {
      throw new Error('IndexedDB storage not initialized');
    }

    await this.storageManager.put(this.storageManager.STORES.versions, {
      id: suiteId,
      suiteId,
      versions: Array.isArray(versions) ? JSON.parse(JSON.stringify(versions)) : [],
      dateModified: new Date().toISOString()
    });
  }

  async getVersionHistory(suiteId) {
    if (!this.storageManager) {
      throw new Error('IndexedDB storage not initialized');
    }

    const record = await this.storageManager.get(this.storageManager.STORES.versions, suiteId);
    return record && Array.isArray(record.versions) ? record.versions : [];
  }

  async deleteVersionHistory(suiteId) {
    if (!this.storageManager) {
      throw new Error('IndexedDB storage not initialized');
    }

    await this.storageManager.delete(this.storageManager.STORES.versions, suiteId);
  }

  async getAllSuiteIds() {
    if (!this.storageManager) {
      throw new Error('IndexedDB storage not initialized');
    }

    const records = await this.storageManager.getAll(this.storageManager.STORES.versions);
    return records.map(record => record.suiteId || record.id).filter(Boolean);
  }

  async getStorageEstimate() {
    if (!this.storageManager) {
      throw new Error('IndexedDB storage not initialized');
    }

    const estimate = await this.storageManager.getStorageEstimate();
    if (!estimate) {
      return null;
    }

    return {
      usage: estimate.used,
      quota: estimate.quota,
      usageMB: (estimate.used / 1024 / 1024).toFixed(2),
      quotaMB: (estimate.quota / 1024 / 1024).toFixed(2),
      percentUsed: estimate.percentUsed
    };
  }

  async migrateFromLocalStorage() {
    // The shared StorageManager now owns legacy migration on startup.
    await this.initialize();
    return 0;
  }
}

// ============================================
// ENHANCED VERSION CONTROL WITH SHARED INDEXEDDB
// ============================================

class VersionControlWithIndexedDB {
  constructor() {
    this.MAX_VERSIONS_PER_SUITE = 100;
    this.storage = new IndexedDBVersionStorage();
    this.initialized = false;
  }

  async initialize() {
    try {
      await this.storage.initialize();
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('Failed to initialize shared IndexedDB version storage:', error);
      if (window.showMessage) {
        window.showMessage('Using localStorage fallback for version adapter', 'warning');
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

    if (versions.length > this.MAX_VERSIONS_PER_SUITE) {
      versions.shift();
    }

    if (this.initialized) {
      try {
        await this.storage.saveVersionHistory(suiteId, versions);
        return newVersion.versionId;
      } catch (error) {
        console.error('IndexedDB save failed, falling back to localStorage:', error);
      }
    }

    return this._saveToLocalStorage(suiteId, versions, newVersion.versionId);
  }

  async getVersionHistory(suiteId) {
    if (this.initialized) {
      try {
        return await this.storage.getVersionHistory(suiteId);
      } catch (error) {
        console.error('IndexedDB get failed, falling back to localStorage:', error);
      }
    }

    return this._getFromLocalStorage(suiteId);
  }

  async deleteVersionHistory(suiteId) {
    if (this.initialized) {
      try {
        await this.storage.deleteVersionHistory(suiteId);
      } catch (error) {
        console.error('IndexedDB delete failed:', error);
      }
    }
    localStorage.removeItem(`suite_versions_${suiteId}`);
  }

  async getStorageInfo() {
    if (this.initialized) {
      const estimate = await this.storage.getStorageEstimate();
      if (estimate) {
        return {
          type: 'IndexedDB',
          ...estimate,
          isUnlimited: true
        };
      }
    }

    let totalSize = 0;
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('suite_versions_')) {
        totalSize += localStorage.getItem(key).length;
      }
    });

    return {
      type: 'localStorage',
      usage: totalSize,
      quota: 10 * 1024 * 1024,
      usageMB: (totalSize / 1024 / 1024).toFixed(2),
      quotaMB: '10',
      percentUsed: ((totalSize / (10 * 1024 * 1024)) * 100).toFixed(1),
      isUnlimited: false
    };
  }

  _saveToLocalStorage(suiteId, versions, versionId) {
    try {
      localStorage.setItem(`suite_versions_${suiteId}`, JSON.stringify(versions));
      return versionId;
    } catch (error) {
      if (error.name === 'QuotaExceededError') {
        throw new Error('Storage quota exceeded. Please clear old versions.');
      }
      throw error;
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

window.IndexedDBVersionStorage = IndexedDBVersionStorage;
window.VersionControlWithIndexedDB = VersionControlWithIndexedDB;

(async function () {
  console.log('🚀 Initializing shared IndexedDB version adapter...');

  window.indexedDBVersionControl = new VersionControlWithIndexedDB();
  const success = await window.indexedDBVersionControl.initialize();

  if (success) {
    console.log('✅ Shared IndexedDB version adapter ready.');
  } else {
    console.log('⚠️ Shared IndexedDB version adapter is using fallback mode.');
  }
})();

window.checkIndexedDBStorage = async function () {
  if (window.indexedDBVersionControl) {
    const info = await window.indexedDBVersionControl.getStorageInfo();
    console.log('=== Storage Information ===');
    console.log(`Type: ${info.type}`);
    console.log(`Usage: ${info.usageMB} MB`);
    console.log(`Quota: ${info.quotaMB} MB`);
    console.log(`Percent Used: ${info.percentUsed}%`);
    console.log(`Unlimited: ${info.isUnlimited ? 'Yes' : 'No'}`);
    return info;
  }
  return null;
};
