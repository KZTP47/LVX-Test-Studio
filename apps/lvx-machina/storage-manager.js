(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    root.StorageManager = api.StorageManager;
    root.storageManager = root.storageManager || new api.StorageManager();
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    function cloneValue(value) {
        if (value == null || typeof value !== 'object') {
            return value;
        }

        try {
            return JSON.parse(JSON.stringify(value));
        } catch (error) {
            return value;
        }
    }

    function getRandomId() {
        if (root.crypto && typeof root.crypto.randomUUID === 'function') {
            return root.crypto.randomUUID();
        }
        return `lvx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    }

    const DEFAULT_RETENTION_POLICIES = {
        execution_history: {
            enabled: true,
            maxEntries: 500,
            maxAgeDays: 90,
            strategy: 'oldest-first'
        },
        security_scans: {
            enabled: true,
            maxEntries: 50,
            maxAgeDays: 30,
            strategy: 'oldest-first'
        },
        screenshots: {
            enabled: true,
            maxEntries: 100,
            maxAgeDays: 30,
            strategy: 'oldest-first'
        },
        versions: {
            enabled: true,
            maxEntries: 20,
            maxAgeDays: 180,
            strategy: 'oldest-first'
        }
    };

    const DEFAULT_LOG_RETENTION = {
        enabled: true,
        maxFiles: 50,
        maxAgeDays: 30,
        maxTotalSizeMB: 100
    };

    const DEFAULT_SESSION_RETENTION = {
        enabled: true,
        keepForever: false,
        maxExports: 5
    };

    class StorageManager {
        constructor() {
            this.DB_NAME = 'LVX_Machina_Storage';
            this.DB_VERSION = 1;
            this.OLD_VERSION_DB_NAME = 'LVX_Machina_Versions';
            this.OLD_VERSION_STORE_NAME = 'version_histories';
            this.MIGRATION_KEY = 'lvx_storage_migrated_v2_core';
            this.MODULE_MIGRATION_KEY = 'lvx_storage_migrated_v3_modules';
            this.MIGRATION_REPORT_KEY = 'lvx_migration_report_core';
            this.STORAGE_PREFERENCES_KEY = 'lvx_storage_preferences';
            this.LAST_IMPORT_SUMMARY_KEY = 'lvx_storage_last_import_summary';
            this.db = null;
            this.readyPromise = null;
            this.migrationPromise = null;
            this.STORES = {
                testSuites: 'test_suites',
                executionHistory: 'execution_history',
                securityScans: 'security_scans',
                screenshots: 'screenshots',
                versions: 'versions',
                datasets: 'datasets',
                unitTests: 'unit_tests'
            };
            this.SECURE_STORES = new Set([
                this.STORES.testSuites,
                this.STORES.versions,
                this.STORES.unitTests
            ]);
        }

        async ensureReady() {
            if (this.db) {
                return this.db;
            }

            if (!this.readyPromise) {
                this.readyPromise = this.init().catch(error => {
                    this.readyPromise = null;
                    throw error;
                });
            }

            return this.readyPromise;
        }

        async init() {
            if (this.db) {
                return this.db;
            }

            if (!root.indexedDB) {
                throw new Error('IndexedDB is not available in this environment.');
            }

            this.db = await new Promise((resolve, reject) => {
                const request = root.indexedDB.open(this.DB_NAME, this.DB_VERSION);

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    this._upgradeDb(db);
                };

                request.onsuccess = (event) => {
                    resolve(event.target.result);
                };

                request.onerror = (event) => {
                    reject(event.target.error || request.error);
                };
            });

            await this._migrateLegacyData();
            return this.db;
        }

        _upgradeDb(db) {
            Object.values(this.STORES).forEach(storeName => {
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName, { keyPath: 'id' });
                }
            });
        }

        _getSecureConfigApi() {
            return root.secureConfig || {
                protectData: (value) => cloneValue(value),
                unprotectData: (value) => cloneValue(value),
                loadConfig: (storageKey, defaultValue = null) => {
                    try {
                        const raw = root.localStorage?.getItem(storageKey);
                        return raw ? JSON.parse(raw) : cloneValue(defaultValue);
                    } catch (error) {
                        return cloneValue(defaultValue);
                    }
                }
            };
        }

        _shouldSecureStore(storeName) {
            return this.SECURE_STORES.has(storeName);
        }

        _prepareRecord(storeName, data) {
            const record = cloneValue(data) || {};
            if (!record.id) {
                record.id = record.suiteId || getRandomId();
            }

            if (storeName === this.STORES.versions && !record.suiteId) {
                record.suiteId = record.id;
            }

            if (this._shouldSecureStore(storeName)) {
                return this._getSecureConfigApi().protectData(record);
            }

            return record;
        }

        _restoreRecord(storeName, data) {
            if (!data) {
                return null;
            }

            const record = cloneValue(data);
            if (this._shouldSecureStore(storeName)) {
                return this._getSecureConfigApi().unprotectData(record);
            }

            return record;
        }

        async put(storeName, data) {
            await this.ensureReady();
            const record = this._prepareRecord(storeName, data);

            await new Promise((resolve, reject) => {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.put(record);

                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error || new Error(`Failed to write to ${storeName}`));
            });

            return record.id;
        }

        async get(storeName, id) {
            await this.ensureReady();

            const result = await new Promise((resolve, reject) => {
                const transaction = this.db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.get(id);

                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error || new Error(`Failed to read from ${storeName}`));
            });

            return this._restoreRecord(storeName, result);
        }

        async getAll(storeName) {
            await this.ensureReady();

            const results = await new Promise((resolve, reject) => {
                const transaction = this.db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.getAll();

                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error || new Error(`Failed to read all from ${storeName}`));
            });

            return results.map(result => this._restoreRecord(storeName, result));
        }

        async delete(storeName, id) {
            await this.ensureReady();

            await new Promise((resolve, reject) => {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.delete(id);

                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error || new Error(`Failed to delete from ${storeName}`));
            });
        }

        async clear(storeName) {
            await this.ensureReady();

            await new Promise((resolve, reject) => {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.clear();

                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error || new Error(`Failed to clear ${storeName}`));
            });
        }

        async replaceAll(storeName, items = []) {
            await this.ensureReady();
            await this.clear(storeName);

            for (const item of items) {
                await this.put(storeName, item);
            }

            return true;
        }

        async getStorageEstimate() {
            if (root.navigator?.storage?.estimate) {
                const estimate = await root.navigator.storage.estimate();
                return {
                    used: estimate.usage || 0,
                    quota: estimate.quota || 0,
                    percentUsed: estimate.quota
                        ? ((estimate.usage / estimate.quota) * 100).toFixed(1)
                        : '0.0'
                };
            }
            return null;
        }

        getDefaultRetentionPolicies() {
            return cloneValue(DEFAULT_RETENTION_POLICIES);
        }

        getDefaultLogRetention() {
            return cloneValue(DEFAULT_LOG_RETENTION);
        }

        getDefaultSessionRetention() {
            return cloneValue(DEFAULT_SESSION_RETENTION);
        }

        getDefaultStoragePreferences() {
            return {
                mode: 'smart',
                customPolicies: this.getDefaultRetentionPolicies(),
                logRetention: this.getDefaultLogRetention(),
                sessionRetention: this.getDefaultSessionRetention(),
                showWarningAt: 80,
                lastCleanupDate: null
            };
        }

        loadLastImportSummary() {
            try {
                const raw = root.localStorage?.getItem(this.LAST_IMPORT_SUMMARY_KEY);
                if (!raw) {
                    return null;
                }

                return this._normalizeLastImportSummary(JSON.parse(raw));
            } catch (error) {
                console.warn('[StorageManager] Failed to load last import summary:', error);
                return null;
            }
        }

        saveLastImportSummary(summary) {
            const normalized = this._normalizeLastImportSummary(summary);
            if (!normalized) {
                root.localStorage?.removeItem(this.LAST_IMPORT_SUMMARY_KEY);
                return null;
            }

            root.localStorage?.setItem(this.LAST_IMPORT_SUMMARY_KEY, JSON.stringify(normalized));
            return normalized;
        }

        loadStoragePreferences() {
            const defaults = this.getDefaultStoragePreferences();

            try {
                const raw = root.localStorage?.getItem(this.STORAGE_PREFERENCES_KEY);
                if (!raw) {
                    return defaults;
                }

                const parsed = JSON.parse(raw);
                return this._mergeStoragePreferences(defaults, parsed);
            } catch (error) {
                console.warn('[StorageManager] Failed to load storage preferences, using defaults:', error);
                return defaults;
            }
        }

        saveStoragePreferences(preferences) {
            const merged = this._mergeStoragePreferences(this.getDefaultStoragePreferences(), preferences || {});
            root.localStorage?.setItem(this.STORAGE_PREFERENCES_KEY, JSON.stringify(merged));
            return merged;
        }

        resolveRetentionPolicies(preferences = this.loadStoragePreferences()) {
            if (preferences?.mode === 'custom') {
                return this._mergeRetentionPolicies(this.getDefaultRetentionPolicies(), preferences.customPolicies || {});
            }

            return this.getDefaultRetentionPolicies();
        }

        resolveLogRetention(preferences = this.loadStoragePreferences()) {
            if (preferences?.mode === 'custom') {
                return this._mergeLogRetention(this.getDefaultLogRetention(), preferences.logRetention || {});
            }

            return this.getDefaultLogRetention();
        }

        resolveSessionRetention(preferences = this.loadStoragePreferences()) {
            if (preferences?.mode === 'unlimited') {
                return {
                    ...this.getDefaultSessionRetention(),
                    enabled: false,
                    keepForever: true
                };
            }

            if (preferences?.mode === 'custom') {
                return this._mergeSessionRetention(this.getDefaultSessionRetention(), preferences.sessionRetention || {});
            }

            return this.getDefaultSessionRetention();
        }

        async enforceRetentionPolicies() {
            await this.ensureReady();

            const preferences = this.loadStoragePreferences();
            const estimate = await this.getStorageEstimate();
            const summary = {
                mode: preferences.mode,
                estimate,
                deletedCount: 0,
                deletedByStore: {},
                skippedStores: [],
                lastCleanupDate: preferences.lastCleanupDate || null,
                warningThresholdExceeded: this._shouldWarnAboutUsage(estimate, preferences)
            };

            if (preferences.mode === 'unlimited') {
                return summary;
            }

            const policies = this.resolveRetentionPolicies(preferences);

            for (const [storeName, policy] of Object.entries(policies)) {
                if (!policy?.enabled) {
                    summary.skippedStores.push(storeName);
                    continue;
                }

                const storeSummary = storeName === this.STORES.versions
                    ? await this._enforceVersionRetention(policy)
                    : await this._enforceFlatStoreRetention(storeName, policy);

                summary.deletedByStore[storeName] = storeSummary.deleted;
                summary.deletedCount += storeSummary.deleted;
            }

            const savedPreferences = this.saveStoragePreferences({
                ...preferences,
                lastCleanupDate: new Date().toISOString()
            });
            summary.lastCleanupDate = savedPreferences.lastCleanupDate;
            summary.estimate = await this.getStorageEstimate();
            summary.warningThresholdExceeded = this._shouldWarnAboutUsage(summary.estimate, savedPreferences);

            return summary;
        }

        async _migrateLegacyData() {
            if (this.migrationPromise) {
                return this.migrationPromise;
            }

            const coreMigrated = Boolean(root.localStorage?.getItem(this.MIGRATION_KEY));
            const moduleMigrated = Boolean(root.localStorage?.getItem(this.MODULE_MIGRATION_KEY));

            if (coreMigrated && moduleMigrated) {
                return null;
            }

            this.migrationPromise = (async () => {
                const report = {
                    migrated: 0,
                    skipped: 0,
                    errors: []
                };

                if (!coreMigrated) {
                    await this._migrateLegacySuites(report);
                    await this._migrateLegacyVersionHistory(report);
                    await this._migrateLegacyCollaborationVersions(report);
                    await this._migrateOldIndexedDbVersions(report);
                }

                if (!moduleMigrated) {
                    await this._migrateLegacyScreenshots(report);
                    await this._migrateLegacySecurityScans(report);
                    await this._migrateLegacyDatasets(report);
                    await this._migrateLegacyUnitTests(report);
                }

                try {
                    if (!coreMigrated) {
                        root.localStorage?.setItem(this.MIGRATION_KEY, Date.now().toString());
                    }
                    if (!moduleMigrated) {
                        root.localStorage?.setItem(this.MODULE_MIGRATION_KEY, Date.now().toString());
                    }
                    root.localStorage?.setItem(this.MIGRATION_REPORT_KEY, JSON.stringify(report));
                } catch (error) {
                    report.errors.push({ key: this.MIGRATION_REPORT_KEY, error: error.message });
                }

                return report;
            })().finally(() => {
                this.migrationPromise = null;
            });

            return this.migrationPromise;
        }

        async _migrateLegacyScreenshots(report) {
            const storageKey = 'baseline_screenshots';

            try {
                const raw = root.localStorage?.getItem(storageKey);
                if (!raw) {
                    return;
                }

                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    report.skipped += 1;
                    return;
                }

                const records = Object.entries(parsed)
                    .filter(([name, data]) => typeof name === 'string' && typeof data === 'string' && data.length > 0)
                    .map(([name, data]) => ({
                        id: name,
                        name,
                        data,
                        format: 'base64',
                        dateCreated: new Date().toISOString(),
                        dateModified: new Date().toISOString(),
                        _migratedFrom: storageKey
                    }));

                for (const record of records) {
                    await this.put(this.STORES.screenshots, record);
                }

                root.localStorage?.removeItem(storageKey);
                report.migrated += records.length;
            } catch (error) {
                console.error(`[StorageManager] Failed to migrate ${storageKey}:`, error);
                report.errors.push({ key: storageKey, error: error.message });
            }
        }

        async _migrateLegacySecurityScans(report) {
            const historyKey = 'security_scan_history';
            const resultsKey = 'security_scan_results';
            const recordsById = new Map();

            const addRecord = (item, sourceKey, fallbackName) => {
                if (!item || typeof item !== 'object') {
                    return false;
                }

                const normalized = cloneValue(item);
                normalized.id = normalized.id || getRandomId();
                normalized.name = normalized.name || fallbackName || 'Security Scan';
                normalized.timestamp = normalized.timestamp || normalized.dateCreated || new Date().toISOString();
                normalized.dateCreated = normalized.dateCreated || normalized.timestamp;
                normalized.dateModified = new Date().toISOString();
                normalized._migratedFrom = sourceKey;
                recordsById.set(normalized.id, normalized);
                return true;
            };

            try {
                const historyRaw = root.localStorage?.getItem(historyKey);
                if (historyRaw) {
                    const history = JSON.parse(historyRaw);
                    if (Array.isArray(history)) {
                        history.forEach(item => addRecord(item, historyKey, 'Security Scan History'));
                    }
                }

                const resultsRaw = root.localStorage?.getItem(resultsKey);
                if (resultsRaw) {
                    const results = JSON.parse(resultsRaw);
                    if (Array.isArray(results)) {
                        results.forEach(item => addRecord(item, resultsKey, 'Security Scan'));
                    } else if (results && typeof results === 'object') {
                        Object.values(results).forEach(item => addRecord(item, resultsKey, 'Security Scan'));
                    }
                }

                if (recordsById.size === 0) {
                    return;
                }

                for (const record of recordsById.values()) {
                    await this.put(this.STORES.securityScans, record);
                }

                root.localStorage?.removeItem(historyKey);
                root.localStorage?.removeItem(resultsKey);
                report.migrated += recordsById.size;
            } catch (error) {
                console.error('[StorageManager] Failed to migrate legacy security scans:', error);
                report.errors.push({ key: `${historyKey},${resultsKey}`, error: error.message });
            }
        }

        async _migrateLegacyDatasets(report) {
            const storageKey = 'test_data_sets';

            try {
                const raw = root.localStorage?.getItem(storageKey);
                if (!raw) {
                    return;
                }

                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed)) {
                    report.skipped += 1;
                    return;
                }

                for (const dataSet of parsed) {
                    const normalized = this.normalizeLegacyItem(this.STORES.datasets, dataSet);
                    normalized._migratedFrom = storageKey;
                    normalized._migratedAt = new Date().toISOString();
                    await this.put(this.STORES.datasets, normalized);
                    report.migrated += 1;
                }

                root.localStorage?.removeItem(storageKey);
            } catch (error) {
                console.error(`[StorageManager] Failed to migrate ${storageKey}:`, error);
                report.errors.push({ key: storageKey, error: error.message });
            }
        }

        async _migrateLegacyUnitTests(report) {
            const storageKey = 'lvx_unit_tests';

            try {
                const raw = root.localStorage?.getItem(storageKey);
                if (!raw) {
                    return;
                }

                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed)) {
                    report.skipped += 1;
                    return;
                }

                for (const unitTest of parsed) {
                    const normalized = this.normalizeLegacyItem(this.STORES.unitTests, unitTest);
                    normalized._migratedFrom = storageKey;
                    normalized._migratedAt = new Date().toISOString();
                    await this.put(this.STORES.unitTests, normalized);
                    report.migrated += 1;
                }

                root.localStorage?.removeItem(storageKey);
            } catch (error) {
                console.error(`[StorageManager] Failed to migrate ${storageKey}:`, error);
                report.errors.push({ key: storageKey, error: error.message });
            }
        }

        async _migrateLegacySuites(report) {
            const storageKey = 'pipeline_test_suites';
            const suites = this._loadLegacyConfig(storageKey, []);
            if (!Array.isArray(suites) || suites.length === 0) {
                return;
            }

            try {
                for (const suite of suites) {
                    const normalized = this.normalizeLegacyItem(this.STORES.testSuites, suite);
                    normalized._migratedFrom = storageKey;
                    normalized._migratedAt = new Date().toISOString();
                    normalized._originalFormat = this.detectLegacyFormat(suite);
                    await this.put(this.STORES.testSuites, normalized);
                    report.migrated += 1;
                }

                root.localStorage?.removeItem(storageKey);
            } catch (error) {
                console.error(`[StorageManager] Failed to migrate ${storageKey}:`, error);
                report.errors.push({ key: storageKey, error: error.message });
            }
        }

        async _migrateLegacyVersionHistory(report) {
            const keys = this._getLocalStorageKeys().filter(key => key.startsWith('suite_versions_'));
            if (keys.length === 0) {
                return;
            }

            for (const key of keys) {
                const suiteId = key.replace('suite_versions_', '');

                try {
                    const raw = root.localStorage?.getItem(key);
                    if (!raw) {
                        report.skipped += 1;
                        continue;
                    }

                    const parsed = JSON.parse(raw);
                    if (!Array.isArray(parsed)) {
                        report.skipped += 1;
                        continue;
                    }

                    const existingRecord = await this.get(this.STORES.versions, suiteId) || {
                        id: suiteId,
                        suiteId,
                        versions: []
                    };

                    const normalizedVersions = parsed.map(version => this._normalizeLegacyVersion(version));
                    existingRecord.versions = this._mergeVersionArrays(existingRecord.versions || [], normalizedVersions);
                    existingRecord.dateModified = new Date().toISOString();
                    existingRecord._migratedFrom = key;
                    existingRecord._migratedAt = new Date().toISOString();
                    await this.put(this.STORES.versions, existingRecord);

                    root.localStorage?.removeItem(key);
                    report.migrated += normalizedVersions.length;
                } catch (error) {
                    console.error(`[StorageManager] Failed to migrate ${key}:`, error);
                    report.errors.push({ key, error: error.message });
                }
            }
        }

        async _migrateLegacyCollaborationVersions(report) {
            const keys = this._getLocalStorageKeys().filter(key => key.startsWith('versions_'));
            if (keys.length === 0) {
                return;
            }

            for (const key of keys) {
                const suiteId = key.replace('versions_', '');

                try {
                    const raw = root.localStorage?.getItem(key);
                    if (!raw) {
                        report.skipped += 1;
                        continue;
                    }

                    const parsed = JSON.parse(raw);
                    if (!Array.isArray(parsed)) {
                        report.skipped += 1;
                        continue;
                    }

                    const existingRecord = await this.get(this.STORES.versions, suiteId) || {
                        id: suiteId,
                        suiteId,
                        versions: []
                    };

                    const normalizedVersions = parsed.map(version => this._normalizeLegacyVersion(version));
                    existingRecord.versions = this._mergeVersionArrays(existingRecord.versions || [], normalizedVersions);
                    existingRecord.dateModified = new Date().toISOString();
                    existingRecord._migratedFrom = key;
                    existingRecord._migratedAt = new Date().toISOString();
                    await this.put(this.STORES.versions, existingRecord);

                    root.localStorage?.removeItem(key);
                    report.migrated += normalizedVersions.length;
                } catch (error) {
                    console.error(`[StorageManager] Failed to migrate ${key}:`, error);
                    report.errors.push({ key, error: error.message });
                }
            }
        }

        async _migrateOldIndexedDbVersions(report) {
            try {
                if (!root.indexedDB || typeof root.indexedDB.databases !== 'function') {
                    return;
                }

                const databases = await root.indexedDB.databases();
                const hasOldDb = Array.isArray(databases) && databases.some(db => db.name === this.OLD_VERSION_DB_NAME);
                if (!hasOldDb) {
                    return;
                }

                const legacyDb = await new Promise((resolve, reject) => {
                    const request = root.indexedDB.open(this.OLD_VERSION_DB_NAME);
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error || new Error('Failed to open old version database'));
                });

                if (!legacyDb.objectStoreNames.contains(this.OLD_VERSION_STORE_NAME)) {
                    return;
                }

                const records = await new Promise((resolve, reject) => {
                    const transaction = legacyDb.transaction([this.OLD_VERSION_STORE_NAME], 'readonly');
                    const store = transaction.objectStore(this.OLD_VERSION_STORE_NAME);
                    const request = store.getAll();

                    request.onsuccess = () => resolve(request.result || []);
                    request.onerror = () => reject(request.error || new Error('Failed to read old version histories'));
                });

                for (const legacyRecord of records) {
                    const suiteId = legacyRecord?.suiteId || legacyRecord?.id;
                    if (!suiteId) {
                        report.skipped += 1;
                        continue;
                    }

                    const existingRecord = await this.get(this.STORES.versions, suiteId) || {
                        id: suiteId,
                        suiteId,
                        versions: []
                    };

                    const nextVersions = Array.isArray(legacyRecord?.versions)
                        ? legacyRecord.versions.map(version => this._normalizeLegacyVersion(version))
                        : [];
                    existingRecord.versions = this._mergeVersionArrays(existingRecord.versions || [], nextVersions);
                    existingRecord.dateModified = legacyRecord.lastUpdated || new Date().toISOString();
                    existingRecord._migratedFrom = this.OLD_VERSION_DB_NAME;
                    existingRecord._migratedAt = new Date().toISOString();
                    await this.put(this.STORES.versions, existingRecord);
                    report.migrated += nextVersions.length;
                }
            } catch (error) {
                console.error('[StorageManager] Failed to migrate old IndexedDB versions:', error);
                report.errors.push({ key: this.OLD_VERSION_DB_NAME, error: error.message });
            }
        }

        _loadLegacyConfig(storageKey, defaultValue = null) {
            if (storageKey === 'pipeline_test_suites') {
                return this._getSecureConfigApi().loadConfig(storageKey, defaultValue);
            }

            try {
                const raw = root.localStorage?.getItem(storageKey);
                return raw ? JSON.parse(raw) : cloneValue(defaultValue);
            } catch (error) {
                return cloneValue(defaultValue);
            }
        }

        _getLocalStorageKeys() {
            if (!root.localStorage) {
                return [];
            }

            const keys = [];
            for (let index = 0; index < root.localStorage.length; index += 1) {
                const key = root.localStorage.key(index);
                if (key) {
                    keys.push(key);
                }
            }
            return keys;
        }

        _mergeStoragePreferences(base, incoming) {
            const merged = {
                ...cloneValue(base),
                ...(cloneValue(incoming) || {})
            };

            if (!['smart', 'unlimited', 'custom'].includes(merged.mode)) {
                merged.mode = base.mode;
            }

            const showWarningAt = Number(merged.showWarningAt);
            merged.showWarningAt = Number.isFinite(showWarningAt)
                ? Math.max(1, Math.min(95, showWarningAt))
                : base.showWarningAt;

            merged.customPolicies = this._mergeRetentionPolicies(
                base.customPolicies || this.getDefaultRetentionPolicies(),
                incoming?.customPolicies || {}
            );

            merged.logRetention = this._mergeLogRetention(
                base.logRetention || this.getDefaultLogRetention(),
                incoming?.logRetention || {}
            );

            merged.sessionRetention = this._mergeSessionRetention(
                base.sessionRetention || this.getDefaultSessionRetention(),
                incoming?.sessionRetention || {}
            );

            if (merged.lastCleanupDate && Number.isNaN(new Date(merged.lastCleanupDate).getTime())) {
                merged.lastCleanupDate = null;
            }

            return merged;
        }

        _mergeRetentionPolicies(basePolicies, incomingPolicies) {
            const merged = cloneValue(basePolicies) || {};

            Object.entries(incomingPolicies || {}).forEach(([storeName, policy]) => {
                if (!merged[storeName] || !policy || typeof policy !== 'object') {
                    return;
                }

                const normalized = {
                    ...merged[storeName],
                    ...cloneValue(policy)
                };

                normalized.enabled = normalized.enabled !== false;
                normalized.maxEntries = this._normalizePositiveInteger(normalized.maxEntries, merged[storeName].maxEntries);
                normalized.maxAgeDays = this._normalizePositiveInteger(normalized.maxAgeDays, merged[storeName].maxAgeDays);
                normalized.strategy = normalized.strategy === 'oldest-first' ? 'oldest-first' : merged[storeName].strategy;

                merged[storeName] = normalized;
            });

            return merged;
        }

        _mergeLogRetention(baseRetention, incomingRetention) {
            const merged = {
                ...(cloneValue(baseRetention) || {}),
                ...(cloneValue(incomingRetention) || {})
            };

            merged.enabled = merged.enabled !== false;
            merged.maxFiles = this._normalizePositiveInteger(merged.maxFiles, baseRetention.maxFiles);
            merged.maxAgeDays = this._normalizePositiveInteger(merged.maxAgeDays, baseRetention.maxAgeDays);
            merged.maxTotalSizeMB = this._normalizePositiveInteger(merged.maxTotalSizeMB, baseRetention.maxTotalSizeMB);

            return merged;
        }

        _mergeSessionRetention(baseRetention, incomingRetention) {
            const merged = {
                ...(cloneValue(baseRetention) || {}),
                ...(cloneValue(incomingRetention) || {})
            };

            merged.enabled = merged.enabled !== false;
            merged.keepForever = !!merged.keepForever;
            merged.maxExports = Math.min(
                100,
                this._normalizePositiveInteger(merged.maxExports, baseRetention.maxExports)
            );

            return merged;
        }

        _normalizeLastImportSummary(summary) {
            if (!summary || typeof summary !== 'object') {
                return null;
            }

            const timestamp = summary.timestamp && !Number.isNaN(new Date(summary.timestamp).getTime())
                ? new Date(summary.timestamp).toISOString()
                : null;

            return {
                timestamp,
                sourceName: String(summary.sourceName || summary.source || 'Imported data'),
                importedFiles: Math.max(0, Number(summary.importedFiles) || 0),
                importedSuites: Math.max(0, Number(summary.importedSuites) || 0),
                importedPipelines: Math.max(0, Number(summary.importedPipelines) || 0),
                importedViews: Math.max(0, Number(summary.importedViews) || 0),
                importedVersions: Math.max(0, Number(summary.importedVersions) || 0),
                skippedFiles: Math.max(0, Number(summary.skippedFiles) || 0),
                failedFiles: Math.max(0, Number(summary.failedFiles) || 0)
            };
        }

        _normalizePositiveInteger(value, fallback) {
            const numeric = Number(value);
            if (!Number.isFinite(numeric) || numeric <= 0) {
                return fallback;
            }

            return Math.round(numeric);
        }

        _shouldWarnAboutUsage(estimate, preferences) {
            if (!estimate || !estimate.quota) {
                return false;
            }

            return parseFloat(estimate.percentUsed || '0') >= Number(preferences?.showWarningAt || 80);
        }

        async _enforceFlatStoreRetention(storeName, policy) {
            const allItems = await this.getAll(storeName);
            if (!Array.isArray(allItems) || allItems.length === 0) {
                return { deleted: 0 };
            }

            const cutoff = this._buildCutoffDate(policy.maxAgeDays);
            const expired = [];
            const kept = [];

            allItems.forEach(item => {
                const timestamp = this._getSortTimestamp(item);
                if (cutoff && timestamp < cutoff) {
                    expired.push(item);
                } else {
                    kept.push(item);
                }
            });

            let deleted = 0;
            for (const item of expired) {
                await this.delete(storeName, item.id);
                deleted += 1;
            }

            if (kept.length > policy.maxEntries) {
                const sorted = kept.slice().sort((a, b) => this._getSortTimestamp(a) - this._getSortTimestamp(b));
                const overflow = sorted.slice(0, kept.length - policy.maxEntries);

                for (const item of overflow) {
                    await this.delete(storeName, item.id);
                    deleted += 1;
                }
            }

            return { deleted };
        }

        async _enforceVersionRetention(policy) {
            const records = await this.getAll(this.STORES.versions);
            if (!Array.isArray(records) || records.length === 0) {
                return { deleted: 0 };
            }

            const cutoff = this._buildCutoffDate(policy.maxAgeDays);
            let deleted = 0;

            for (const record of records) {
                const versions = Array.isArray(record?.versions)
                    ? record.versions.map(version => this._normalizeLegacyVersion(version))
                    : [];

                const nonExpired = cutoff
                    ? versions.filter(version => this._getSortTimestamp(version) >= cutoff)
                    : versions.slice();

                deleted += Math.max(0, versions.length - nonExpired.length);

                const trimmed = nonExpired.length > policy.maxEntries
                    ? nonExpired
                        .slice()
                        .sort((a, b) => this._getSortTimestamp(a) - this._getSortTimestamp(b))
                        .slice(nonExpired.length - policy.maxEntries)
                    : nonExpired;

                deleted += Math.max(0, nonExpired.length - trimmed.length);

                if (trimmed.length === versions.length) {
                    continue;
                }

                if (trimmed.length === 0) {
                    await this.delete(this.STORES.versions, record.id);
                    continue;
                }

                await this.put(this.STORES.versions, {
                    ...record,
                    versions: trimmed,
                    dateModified: new Date().toISOString()
                });
            }

            return { deleted };
        }

        _buildCutoffDate(maxAgeDays) {
            const normalizedDays = this._normalizePositiveInteger(maxAgeDays, 0);
            if (!normalizedDays) {
                return null;
            }

            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - normalizedDays);
            return cutoff.getTime();
        }

        _getSortTimestamp(item) {
            const candidate = item?.timestamp || item?.dateCreated || item?.createdAt || item?.dateModified || item?.lastUpdated;
            const timestamp = candidate ? new Date(candidate).getTime() : NaN;

            if (Number.isFinite(timestamp)) {
                return timestamp;
            }

            return 0;
        }

        normalizeLegacyItem(storeName, item) {
            if (storeName === this.STORES.screenshots && typeof item === 'string') {
                return {
                    id: getRandomId(),
                    data: item,
                    format: 'base64',
                    dateCreated: new Date().toISOString(),
                    dateModified: new Date().toISOString()
                };
            }

            const normalized = cloneValue(item) || {};

            if (!normalized.dateCreated && normalized.created) {
                normalized.dateCreated = normalized.created;
            }
            if (typeof normalized.dateCreated === 'number') {
                normalized.dateCreated = new Date(normalized.dateCreated).toISOString();
            }
            if (!normalized.dateModified) {
                normalized.dateModified = normalized.dateCreated || new Date().toISOString();
            }

            if (storeName === this.STORES.testSuites) {
                if (typeof normalized.testCode === 'string' && !normalized.code) {
                    normalized.code = normalized.testCode;
                }
                if (!normalized.language) {
                    normalized.language = 'javascript';
                }
                if (!Array.isArray(normalized.tags)) {
                    normalized.tags = [];
                }
                if (normalized.isFavorite === undefined) {
                    normalized.isFavorite = false;
                }
                if (!normalized.id) {
                    normalized.id = getRandomId();
                }
            }

            if (storeName === this.STORES.versions) {
                normalized.id = normalized.id || normalized.suiteId || getRandomId();
                normalized.suiteId = normalized.suiteId || normalized.id;
                normalized.versions = Array.isArray(normalized.versions)
                    ? normalized.versions.map(version => this._normalizeLegacyVersion(version))
                    : [];
            }

            if (storeName === this.STORES.datasets) {
                normalized.id = normalized.id || getRandomId();
                normalized.name = normalized.name || 'Imported Data Set';
                normalized.headers = Array.isArray(normalized.headers) ? normalized.headers : [];
                normalized.data = Array.isArray(normalized.data) ? normalized.data : [];
            }

            if (storeName === this.STORES.unitTests) {
                normalized.id = normalized.id || getRandomId();
                normalized.tags = Array.isArray(normalized.tags) ? normalized.tags : [];
                normalized.status = normalized.status || 'NOT_RUN';
            }

            if (storeName === this.STORES.securityScans) {
                normalized.id = normalized.id || getRandomId();
                normalized.timestamp = normalized.timestamp || normalized.dateCreated || new Date().toISOString();
                normalized.summary = normalized.summary || { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
            }

            return normalized;
        }

        detectLegacyFormat(item) {
            if (item?.created && !item?.dateCreated) return 'v1-alpha';
            if (item?.testCode && !item?.code) return 'v1-beta';
            if (item?.passed !== undefined) return 'v1-legacy-bool';
            return 'v1-standard';
        }

        _normalizeLegacyVersion(version) {
            const normalized = cloneValue(version) || {};
            normalized.versionId = normalized.versionId || normalized.id || getRandomId();
            normalized.timestamp = normalized.timestamp || normalized.createdAt || new Date().toISOString();
            normalized.changeDescription = normalized.changeDescription || normalized.description || `Version ${normalized.version || ''}`.trim() || 'Imported version';
            normalized.changedBy = normalized.changedBy || normalized.createdBy || 'user';
            normalized.version = normalized.version || null;

            if (!normalized.diff) {
                normalized.diff = { modified: [] };
            }

            if (!normalized.suiteSnapshot && normalized.suiteData) {
                normalized.suiteSnapshot = cloneValue(normalized.suiteData);
            }

            return normalized;
        }

        _mergeVersionArrays(currentVersions, nextVersions) {
            const merged = new Map();
            [...(currentVersions || []), ...(nextVersions || [])].forEach(version => {
                const normalized = this._normalizeLegacyVersion(version);
                const key = normalized.versionId || normalized.id || `${normalized.timestamp}_${normalized.changeDescription}`;
                const existing = merged.get(key);

                if (!existing) {
                    merged.set(key, normalized);
                    return;
                }

                const existingTime = new Date(existing.timestamp || 0).getTime();
                const nextTime = new Date(normalized.timestamp || 0).getTime();
                if (nextTime >= existingTime) {
                    merged.set(key, normalized);
                }
            });

            return Array.from(merged.values()).sort((a, b) => {
                return new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime();
            });
        }
    }

    return {
        StorageManager
    };
});
