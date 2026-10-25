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

function test(name, fn) {
    try {
        fn();
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

function createMockElement() {
    return {
        value: '',
        innerHTML: '',
        textContent: '',
        style: {},
        classList: {
            add() { },
            remove() { }
        },
        appendChild() { },
        addEventListener() { },
        removeEventListener() { },
        querySelector() { return createMockElement(); },
        querySelectorAll() { return []; }
    };
}

test('secureConfig should encrypt and decrypt sensitive config values', () => {
    const { storage, localStorage } = createLocalStorage();
    global.localStorage = localStorage;
    global.electronAPI = {
        secureStorage: {
            isEncryptionAvailable: () => true,
            encryptString: (text) => Buffer.from(`enc:${text}`, 'utf8').toString('base64'),
            decryptString: (cipherText) => Buffer.from(cipherText, 'base64').toString('utf8').replace(/^enc:/, '')
        }
    };

    delete require.cache[require.resolve('./secure-config.js')];
    const secureConfig = require('./secure-config.js');

    secureConfig.saveConfig('phase1_secure', {
        apiKey: 'top-secret',
        nested: {
            webhookUrl: 'https://hooks.example.test/demo'
        },
        harmless: 'visible'
    });

    const raw = JSON.parse(storage.phase1_secure);
    assert(raw.apiKey.__lvxEncrypted === true, 'apiKey should be stored encrypted.');
    assert(raw.nested.webhookUrl.__lvxEncrypted === true, 'webhookUrl should be stored encrypted.');
    assertEqual(raw.harmless, 'visible', 'Non-sensitive fields should stay plain.');

    const loaded = secureConfig.loadConfig('phase1_secure', null);
    assertEqual(loaded.apiKey, 'top-secret', 'apiKey should decrypt on load.');
    assertEqual(loaded.nested.webhookUrl, 'https://hooks.example.test/demo', 'webhookUrl should decrypt on load.');
});

test('saveUnitTest should update an existing unit test instead of duplicating it', () => {
    const { localStorage } = createLocalStorage();
    const context = {
        console,
        localStorage,
        showMessage: () => { },
        window: {},
        document: {
            getElementById() { return createMockElement(); },
            querySelector() { return createMockElement(); },
            querySelectorAll() { return []; },
            createElement() { return createMockElement(); }
        },
        setTimeout,
        clearTimeout,
        Date,
        Math
    };

    const code = fs.readFileSync(path.join(__dirname, 'unit-testing.js'), 'utf8');
    vm.createContext(context);
    vm.runInContext(code, context);

    context.saveUnitTest({ id: 'ut-1', name: 'Original Name' });
    context.saveUnitTest({ id: 'ut-1', name: 'Updated Name' });

    const allTests = context.getUnitTestsForSuite();
    assertEqual(allTests.length, 1, 'Unit tests should not duplicate on re-save.');
    assertEqual(allTests[0].name, 'Updated Name', 'Existing unit test should be replaced on re-save.');
});

test('saveUnitTest should persist unit tests through StorageManager when available', () => {
    const { localStorage } = createLocalStorage();
    const persisted = [];
    const context = {
        console,
        localStorage,
        showMessage: () => { },
        window: {
            storageManager: {
                STORES: { unitTests: 'unit_tests' },
                getAll() {
                    return [];
                },
                replaceAll(storeName, items) {
                    persisted.length = 0;
                    items.forEach(item => persisted.push({ ...item }));
                    return true;
                }
            }
        },
        document: {
            getElementById() { return createMockElement(); },
            querySelector() { return createMockElement(); },
            querySelectorAll() { return []; },
            createElement() { return createMockElement(); }
        },
        setTimeout,
        clearTimeout,
        Date,
        Math
    };

    const code = fs.readFileSync(path.join(__dirname, 'unit-testing.js'), 'utf8');
    vm.createContext(context);
    vm.runInContext(code, context);

    const saved = context.saveUnitTest({ name: 'Stored Test', test_code: 'assert True' });

    assert(saved, 'Unit test should save successfully.');
    assertEqual(persisted.length, 1, 'StorageManager should receive the saved unit test.');
    assertEqual(persisted[0].name, 'Stored Test', 'Persisted unit test should preserve its name.');
});
