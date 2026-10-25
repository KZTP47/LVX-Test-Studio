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
        return { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
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

function flushAsyncWork() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

async function setupStorageEnvironment(initialLocalStorage = {}) {
    const { storage, localStorage } = createLocalStorage(initialLocalStorage);
    const fakeIndexedDb = createFakeIndexedDB();

    global.window = global;
    global.localStorage = localStorage;
    global.indexedDB = fakeIndexedDb.indexedDB;
    global.crypto = {
        randomUUID() {
            return 'uuid-fixed';
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

test('StorageManager should migrate collaboration versions_* keys into the shared versions store', async () => {
    const legacySnapshot = [{
        id: 'snap-1',
        suiteId: 'suite-collab',
        version: 1,
        description: 'Legacy collaboration snapshot',
        suiteData: { id: 'suite-collab', name: 'Suite A', code: 'print(1)' },
        createdBy: 'Alice',
        createdAt: '2026-03-27T08:00:00.000Z'
    }];

    const { localStorage, storageManager } = await setupStorageEnvironment({
        'versions_suite-collab': JSON.stringify(legacySnapshot)
    });

    const record = await storageManager.get(storageManager.STORES.versions, 'suite-collab');
    assert(record, 'Migrated collaboration version record should exist.');
    assertEqual(record.versions.length, 1, 'One migrated collaboration version should be stored.');
    assertEqual(record.versions[0].changeDescription, 'Legacy collaboration snapshot', 'Legacy collaboration description should be normalized.');
    assertEqual(localStorage.getItem('versions_suite-collab'), null, 'Legacy collaboration version key should be removed after migration.');
});

test('CollaborationManager should persist version snapshots through StorageManager', async () => {
    const { storageManager } = await setupStorageEnvironment();

    const context = {
        console,
        window: {},
        localStorage: global.localStorage,
        storageManager,
        secureConfig: global.secureConfig,
        URL,
        fetch: async () => ({ ok: true, json: async () => ({}) }),
        Blob: function Blob(parts) { this.parts = parts; this.size = parts.join('').length; },
        setTimeout,
        clearTimeout,
        Date,
        Math
    };

    context.window = context;
    context.window.addEventListener = () => { };
    context.window.location = { hash: '' };
    context.window.importFromSharedLink = () => { };
    context.window.showMessage = () => { };

    const code = fs.readFileSync(path.join(__dirname, 'collaboration.js'), 'utf8');
    vm.createContext(context);
    vm.runInContext(code, context);

    await context.window.collaborationManager.initialize();

    const snapshot = context.window.collaborationManager.createVersionSnapshot({
        id: 'suite-42',
        name: 'Collab Suite',
        code: 'print(42)'
    }, 'Created from collaboration view');

    await flushAsyncWork();
    await flushAsyncWork();

    assertEqual(snapshot.version, 1, 'First collaboration snapshot should be version 1.');

    const record = await storageManager.get(storageManager.STORES.versions, 'suite-42');
    assert(record, 'Collaboration snapshot should be written to StorageManager.');
    assertEqual(record.versions.length, 1, 'Shared version store should contain the collaboration snapshot.');
    assertEqual(record.versions[0].changeDescription, 'Created from collaboration view', 'Shared version store should use the collaboration description.');
});

test('IndexedDBVersionStorage should use the shared StorageManager versions store', async () => {
    const { storageManager } = await setupStorageEnvironment();

    const context = {
        console,
        window: {
            storageManager,
            showMessage() { },
            localStorage: global.localStorage
        },
        localStorage: global.localStorage,
        navigator: {
            storage: {
                estimate: async () => ({ usage: 1024, quota: 4096 })
            }
        },
        setTimeout,
        clearTimeout,
        Date,
        Math,
        JSON
    };

    context.window.window = context.window;

    const code = fs.readFileSync(path.join(__dirname, 'indexeddb-version-storage.js'), 'utf8');
    vm.createContext(context);
    vm.runInContext(code, context);

    const adapter = new context.window.IndexedDBVersionStorage();
    await adapter.initialize();
    await adapter.saveVersionHistory('suite-adapter', [{
        versionId: 'v-adapter',
        timestamp: '2026-03-28T00:00:00.000Z',
        suiteSnapshot: { id: 'suite-adapter', name: 'Adapter Suite' },
        changeDescription: 'Adapter save',
        changedBy: 'user',
        diff: { modified: [] }
    }]);

    const record = await storageManager.get(storageManager.STORES.versions, 'suite-adapter');
    assert(record, 'Adapter should write into the shared StorageManager.');
    assertEqual(record.versions[0].changeDescription, 'Adapter save', 'Adapter should preserve version entries.');
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
