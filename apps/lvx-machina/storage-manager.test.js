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

async function test(name, fn) {
    try {
        await fn();
        console.log(`PASS ${name}`);
    } catch (error) {
        console.error(`FAIL ${name}: ${error.message}`);
        process.exit(1);
    }
}

function createLocalStorage() {
    const storage = {};

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
                    const key = record[storeData.keyPath];
                    storeData.records.set(key, record);
                    request.result = key;
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
                if (!storeData) {
                    throw new Error(`Store does not exist: ${firstStoreName}`);
                }
                return {
                    objectStore() {
                        return createStoreInterface(storeData);
                    }
                };
            },
            close() { }
        };
    }

    const indexedDB = {
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
        async databases() {
            return Array.from(databases.keys()).map(name => ({ name }));
        }
    };

    return {
        indexedDB,
        dumpStore(dbName, storeName) {
            const dbData = databases.get(dbName);
            if (!dbData) {
                return [];
            }
            const storeData = dbData.stores.get(storeName);
            if (!storeData) {
                return [];
            }
            return Array.from(storeData.records.values()).map(clone);
        }
    };
}

function createDocumentStub() {
    const element = {
        textContent: '',
        innerHTML: '',
        disabled: false,
        classList: {
            add() { },
            remove() { }
        }
    };

    return {
        getElementById() {
            return element;
        }
    };
}

function flushAsyncWork() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

async function loadStorageManagerContext() {
    const { storage, localStorage } = createLocalStorage();
    const fakeIndexedDb = createFakeIndexedDB();
    let uuidCounter = 0;

    global.window = global;
    global.localStorage = localStorage;
    global.indexedDB = fakeIndexedDb.indexedDB;
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

    const secureConfig = require('./secure-config.js');
    global.secureConfig = secureConfig;

    const storageManagerModule = require('./storage-manager.js');
    return {
        storage,
        localStorage,
        fakeIndexedDb,
        secureConfig,
        StorageManager: storageManagerModule.StorageManager
    };
}

test('StorageManager should migrate secure test suites into IndexedDB and keep sensitive fields encrypted at rest', async () => {
    const { localStorage, secureConfig, StorageManager } = await loadStorageManagerContext();

    secureConfig.saveConfig('pipeline_test_suites', [{
        id: 'suite-1',
        name: 'Encrypted Suite',
        apiKey: 'super-secret',
        tags: ['demo']
    }]);

    const storageManager = new StorageManager();
    await storageManager.ensureReady();

    const suites = await storageManager.getAll(storageManager.STORES.testSuites);
    assertEqual(suites.length, 1, 'Exactly one suite should be migrated.');
    assertEqual(suites[0].apiKey, 'super-secret', 'Sensitive fields should be decrypted on read.');
    assertEqual(localStorage.getItem('pipeline_test_suites'), null, 'Legacy suite key should be removed after successful migration.');

    const rawRecord = await new Promise((resolve, reject) => {
        const transaction = storageManager.db.transaction([storageManager.STORES.testSuites], 'readonly');
        const store = transaction.objectStore(storageManager.STORES.testSuites);
        const request = store.get('suite-1');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('Failed to read raw suite record.'));
    });

    assert(rawRecord && rawRecord.apiKey && rawRecord.apiKey.__lvxEncrypted === true, 'Sensitive suite data should stay encrypted inside IndexedDB.');
});

test('VersionControl should hydrate from and persist to StorageManager-backed version history', async () => {
    const { StorageManager } = await loadStorageManagerContext();
    const storageManager = new StorageManager();
    await storageManager.ensureReady();

    await storageManager.put(storageManager.STORES.versions, {
        id: 'suite-2',
        suiteId: 'suite-2',
        versions: [{
            versionId: 'v1',
            timestamp: '2026-03-27T10:00:00.000Z',
            suiteSnapshot: { id: 'suite-2', name: 'Original Suite', code: 'print(1)' },
            changeDescription: 'Initial',
            changedBy: 'user',
            diff: { modified: [] }
        }]
    });

    const context = {
        console,
        window: {},
        localStorage: global.localStorage,
        document: createDocumentStub(),
        escapeHtml: (value) => value,
        Blob: function Blob(parts) { this.parts = parts; },
        URL: {
            createObjectURL() { return 'blob:mock'; },
            revokeObjectURL() { }
        },
        showMessage() { },
        setTimeout,
        clearTimeout,
        Date,
        Math,
        JSON
    };

    context.window = context;
    context.window.storageManager = storageManager;
    context.window.localStorage = context.localStorage;
    context.window.document = context.document;
    context.window.showMessage = context.showMessage;
    context.window.escapeHtml = context.escapeHtml;
    context.window.URL = context.URL;

    const versionControlCode = fs.readFileSync(path.join(__dirname, 'version-control.js'), 'utf8');
    vm.createContext(context);
    vm.runInContext(versionControlCode, context);

    await context.window.versionControl.initialize();

    const hydrated = context.window.versionControl.getVersionHistory('suite-2');
    assertEqual(hydrated.length, 1, 'Hydrated version history should come from StorageManager.');
    assertEqual(hydrated[0].changeDescription, 'Initial', 'Hydrated version history should preserve metadata.');

    context.window.versionControl.saveVersion('suite-2', {
        id: 'suite-2',
        name: 'Updated Suite',
        code: 'print(2)',
        description: 'New body',
        language: 'python',
        expected_output: '2'
    }, 'Second');

    await flushAsyncWork();
    await flushAsyncWork();

    const storedRecord = await storageManager.get(storageManager.STORES.versions, 'suite-2');
    assertEqual(storedRecord.versions.length, 2, 'New versions should persist back into StorageManager.');
    assertEqual(storedRecord.versions[1].changeDescription, 'Second', 'Persisted history should include the new version.');
});

test('StorageManager should migrate screenshots, security scans, datasets, and unit tests from legacy localStorage keys', async () => {
    const { localStorage, StorageManager } = await loadStorageManagerContext();

    localStorage.setItem('baseline_screenshots', JSON.stringify({
        login_page: 'data:image/png;base64,AAAA'
    }));
    localStorage.setItem('security_scan_history', JSON.stringify([
        {
            id: 'scan-1',
            name: 'Manual Scan',
            type: 'code',
            timestamp: '2026-03-28T12:00:00.000Z',
            summary: { critical: 0, high: 1, medium: 0, low: 0, total: 1 },
            policyPassed: false,
            duration: 42
        }
    ]));
    localStorage.setItem('test_data_sets', JSON.stringify([
        {
            id: 'dataset-1',
            name: 'Users',
            headers: ['username'],
            data: [{ username: 'alice' }]
        }
    ]));
    localStorage.setItem('lvx_unit_tests', JSON.stringify([
        {
            id: 'ut-1',
            name: 'Unit Test',
            test_code: 'assert True',
            suite_id: 'suite-1'
        }
    ]));

    const storageManager = new StorageManager();
    await storageManager.ensureReady();

    const screenshots = await storageManager.getAll(storageManager.STORES.screenshots);
    const scans = await storageManager.getAll(storageManager.STORES.securityScans);
    const datasets = await storageManager.getAll(storageManager.STORES.datasets);
    const unitTests = await storageManager.getAll(storageManager.STORES.unitTests);

    assertEqual(screenshots.length, 1, 'Screenshot baselines should migrate into IndexedDB.');
    assertEqual(screenshots[0].name, 'login_page', 'Screenshot names should be preserved.');
    assertEqual(scans.length, 1, 'Security scan history should migrate into IndexedDB.');
    assertEqual(scans[0].summary.high, 1, 'Security scan summaries should survive migration.');
    assertEqual(datasets.length, 1, 'Data sets should migrate into IndexedDB.');
    assertEqual(datasets[0].data[0].username, 'alice', 'Dataset rows should survive migration.');
    assertEqual(unitTests.length, 1, 'Unit tests should migrate into IndexedDB.');
    assertEqual(unitTests[0].name, 'Unit Test', 'Unit test metadata should survive migration.');

    assertEqual(localStorage.getItem('baseline_screenshots'), null, 'Legacy screenshot key should be removed.');
    assertEqual(localStorage.getItem('security_scan_history'), null, 'Legacy security history key should be removed.');
    assertEqual(localStorage.getItem('test_data_sets'), null, 'Legacy dataset key should be removed.');
    assertEqual(localStorage.getItem('lvx_unit_tests'), null, 'Legacy unit test key should be removed.');
});
