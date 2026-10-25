const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message} Expected ${expected}, got ${actual}`);
    }
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

const tests = [];

function test(name, fn) {
    tests.push({ name, fn });
}

function createLocalStorage(initial = {}) {
    const storage = { ...initial };

    return {
        storage,
        localStorage: {
            getItem(key) {
                return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null;
            },
            setItem(key, value) {
                storage[key] = String(value);
            },
            removeItem(key) {
                delete storage[key];
            },
            key(index) {
                return Object.keys(storage)[index] || null;
            },
            get length() {
                return Object.keys(storage).length;
            }
        }
    };
}

function createFakeIndexedDB() {
    const databases = new Map();

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function createRequest() {
        return {
            result: null,
            error: null,
            onsuccess: null,
            onerror: null,
            onupgradeneeded: null
        };
    }

    function createStoreInterface(storeData) {
        return {
            put(value) {
                const request = createRequest();
                setTimeout(() => {
                    const record = clone(value);
                    storeData.records.set(record[storeData.keyPath], record);
                    request.result = record[storeData.keyPath];
                    request.onsuccess && request.onsuccess({ target: request });
                }, 0);
                return request;
            },
            get(key) {
                const request = createRequest();
                setTimeout(() => {
                    request.result = storeData.records.has(key) ? clone(storeData.records.get(key)) : undefined;
                    request.onsuccess && request.onsuccess({ target: request });
                }, 0);
                return request;
            },
            getAll() {
                const request = createRequest();
                setTimeout(() => {
                    request.result = Array.from(storeData.records.values()).map(clone);
                    request.onsuccess && request.onsuccess({ target: request });
                }, 0);
                return request;
            },
            delete(key) {
                const request = createRequest();
                setTimeout(() => {
                    storeData.records.delete(key);
                    request.onsuccess && request.onsuccess({ target: request });
                }, 0);
                return request;
            },
            clear() {
                const request = createRequest();
                setTimeout(() => {
                    storeData.records.clear();
                    request.onsuccess && request.onsuccess({ target: request });
                }, 0);
                return request;
            },
            createIndex() {
                return {};
            }
        };
    }

    function createDbInterface(dbData) {
        return {
            objectStoreNames: {
                contains(name) {
                    return dbData.stores.has(name);
                }
            },
            createObjectStore(name, options = {}) {
                const storeData = {
                    keyPath: options.keyPath || 'id',
                    records: new Map()
                };
                dbData.stores.set(name, storeData);
                return createStoreInterface(storeData);
            },
            transaction(storeNames) {
                const firstStoreName = Array.isArray(storeNames) ? storeNames[0] : storeNames;
                const storeData = dbData.stores.get(firstStoreName);
                return {
                    objectStore() {
                        return createStoreInterface(storeData);
                    }
                };
            },
            close() { }
        };
    }

    return {
        indexedDB: {
            open(name, version = 1) {
                const request = createRequest();

                setTimeout(() => {
                    let dbData = databases.get(name);
                    const isNewDb = !dbData;
                    const oldVersion = dbData ? dbData.version : 0;

                    if (!dbData) {
                        dbData = { version, stores: new Map() };
                        databases.set(name, dbData);
                    }

                    const db = createDbInterface(dbData);
                    request.result = db;

                    if (isNewDb || version > oldVersion) {
                        dbData.version = version;
                        request.onupgradeneeded && request.onupgradeneeded({
                            target: { result: db },
                            oldVersion,
                            newVersion: version
                        });
                    }

                    request.onsuccess && request.onsuccess({ target: { result: db } });
                }, 0);

                return request;
            },
            databases() {
                return Promise.resolve(Array.from(databases.keys()).map(name => ({ name })));
            }
        }
    };
}

async function createStorageEnvironment(initialLocalStorage = {}) {
    const { storage, localStorage } = createLocalStorage(initialLocalStorage);
    const fakeIndexedDb = createFakeIndexedDB();
    let uuidCounter = 0;

    global.window = global;
    global.localStorage = localStorage;
    global.indexedDB = fakeIndexedDb.indexedDB;
    global.navigator = global.navigator || {};
    global.navigator.storage = {
        estimate: async () => ({
            usage: 1024 * 1024,
            quota: 10 * 1024 * 1024
        })
    };
    global.crypto = {
        randomUUID() {
            uuidCounter += 1;
            return `uuid-${uuidCounter}`;
        }
    };
    global.electronAPI = {
        secureStorage: {
            isEncryptionAvailable: () => true,
            encryptString: (text) => Buffer.from(`enc:${text}`, 'utf8').toString('base64'),
            decryptString: (cipherText) => Buffer.from(cipherText, 'base64').toString('utf8').replace(/^enc:/, '')
        }
    };

    delete require.cache[require.resolve('./secure-config.js')];
    delete require.cache[require.resolve('./storage-manager.js')];

    global.secureConfig = require('./secure-config.js');
    const { StorageManager } = require('./storage-manager.js');
    const storageManager = new StorageManager();
    await storageManager.ensureReady();

    return { storage, localStorage, storageManager };
}

test('StorageManager should save and reload merged storage preferences', async () => {
    const { storageManager } = await createStorageEnvironment();

    const saved = storageManager.saveStoragePreferences({
        mode: 'custom',
        showWarningAt: 70,
        customPolicies: {
            versions: {
                enabled: false
            }
        }
    });

    const loaded = storageManager.loadStoragePreferences();
    assertEqual(saved.mode, 'custom', 'Saved storage mode should persist.');
    assertEqual(loaded.showWarningAt, 70, 'Warning threshold should persist.');
    assertEqual(loaded.customPolicies.versions.enabled, false, 'Custom policy overrides should be preserved.');
    assertEqual(loaded.customPolicies.screenshots.maxEntries, 100, 'Default policy values should still be present.');
});

test('StorageManager should enforce version retention based on age and entry count', async () => {
    const { storageManager } = await createStorageEnvironment();

    await storageManager.put(storageManager.STORES.versions, {
        id: 'suite-a',
        suiteId: 'suite-a',
        versions: [
            { versionId: 'v1', timestamp: '2025-01-01T00:00:00.000Z', changeDescription: 'old', suiteSnapshot: { id: 'suite-a' }, diff: { modified: [] } },
            { versionId: 'v2', timestamp: '2026-03-20T00:00:00.000Z', changeDescription: 'recent-1', suiteSnapshot: { id: 'suite-a' }, diff: { modified: [] } },
            { versionId: 'v3', timestamp: '2026-03-25T00:00:00.000Z', changeDescription: 'recent-2', suiteSnapshot: { id: 'suite-a' }, diff: { modified: [] } },
            { versionId: 'v4', timestamp: '2026-03-27T00:00:00.000Z', changeDescription: 'recent-3', suiteSnapshot: { id: 'suite-a' }, diff: { modified: [] } }
        ]
    });

    storageManager.saveStoragePreferences({
        mode: 'custom',
        customPolicies: {
            versions: {
                enabled: true,
                maxEntries: 2,
                maxAgeDays: 30,
                strategy: 'oldest-first'
            }
        }
    });

    const summary = await storageManager.enforceRetentionPolicies();
    const record = await storageManager.get(storageManager.STORES.versions, 'suite-a');

    assertEqual(summary.deletedByStore.versions, 2, 'Two version entries should be removed.');
    assert(record, 'Version record should still exist after cleanup.');
    assertEqual(record.versions.length, 2, 'Only the newest two version entries should remain.');
    assertEqual(record.versions[0].versionId, 'v3', 'The retained versions should be the newest non-expired entries.');
    assertEqual(record.versions[1].versionId, 'v4', 'The newest version should remain.');
});

test('StorageManager should skip automatic cleanup in unlimited mode', async () => {
    const { storageManager } = await createStorageEnvironment();

    await storageManager.put(storageManager.STORES.versions, {
        id: 'suite-b',
        suiteId: 'suite-b',
        versions: [
            { versionId: 'v1', timestamp: '2025-01-01T00:00:00.000Z', changeDescription: 'old', suiteSnapshot: { id: 'suite-b' }, diff: { modified: [] } }
        ]
    });

    storageManager.saveStoragePreferences({ mode: 'unlimited', showWarningAt: 10 });

    const summary = await storageManager.enforceRetentionPolicies();
    const record = await storageManager.get(storageManager.STORES.versions, 'suite-b');

    assertEqual(summary.mode, 'unlimited', 'Cleanup summary should report unlimited mode.');
    assertEqual(summary.deletedCount, 0, 'Unlimited mode should not delete anything.');
    assert(summary.warningThresholdExceeded, 'Unlimited mode should still calculate storage warnings.');
    assert(record, 'Record should remain untouched in unlimited mode.');
});

test('TestHistoryManager should apply configured execution history retention', async () => {
    const { localStorage } = createLocalStorage({
        test_execution_history: JSON.stringify([
            { id: 'h1', suiteId: 'suite', suiteName: 'Suite', timestamp: '2026-03-01T00:00:00.000Z', status: 'PASSED', executionTime: 10 },
            { id: 'h2', suiteId: 'suite', suiteName: 'Suite', timestamp: '2026-03-20T00:00:00.000Z', status: 'PASSED', executionTime: 10 },
            { id: 'h3', suiteId: 'suite', suiteName: 'Suite', timestamp: '2026-03-25T00:00:00.000Z', status: 'PASSED', executionTime: 10 },
            { id: 'h4', suiteId: 'suite', suiteName: 'Suite', timestamp: '2026-03-27T00:00:00.000Z', status: 'PASSED', executionTime: 10 }
        ])
    });

    const context = {
        console,
        window: {},
        localStorage,
        document: {
            getElementById() {
                return null;
            }
        },
        Chart: function Chart() { },
        setTimeout,
        clearTimeout,
        Date,
        Math,
        Buffer,
        TextEncoder
    };

    context.window = context;
    context.window.storageManager = {
        loadStoragePreferences() {
            return { mode: 'custom' };
        },
        resolveRetentionPolicies() {
            return {
                execution_history: {
                    enabled: true,
                    maxEntries: 2,
                    maxAgeDays: 14,
                    strategy: 'oldest-first'
                }
            };
        }
    };

    const code = fs.readFileSync(path.join(__dirname, 'reporting-dashboard.js'), 'utf8');
    vm.createContext(context);
    vm.runInContext(code, context);

    const manager = new context.window.TestHistoryManager();
    const cleanup = manager.runConfiguredCleanup();
    const remaining = manager.getHistory();

    assertEqual(cleanup.deletedCount, 2, 'Execution history cleanup should remove expired and excess entries.');
    assertEqual(remaining.length, 2, 'Only two execution history records should remain.');
    assertEqual(remaining[0].id, 'h3', 'The newest retained execution entries should be preserved.');
    assertEqual(remaining[1].id, 'h4', 'The newest retained execution entries should be preserved.');
});

(async () => {
    for (const { name, fn } of tests) {
        try {
            await fn();
            console.log(`PASS ${name}`);
        } catch (error) {
            console.error(`FAIL ${name}: ${error.message}`);
            process.exit(1);
        }
    }
})();
