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

global.window = {};
const storage = {};
global.localStorage = {
    getItem(key) {
        return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null;
    },
    setItem(key, value) {
        storage[key] = String(value);
    },
    removeItem(key) {
        delete storage[key];
    }
};

let persistedScans = [];
let clearedStores = [];
global.window.storageManager = {
    STORES: { securityScans: 'security_scans' },
    getAll() {
        return [];
    },
    put(storeName, record) {
        persistedScans = persistedScans.filter(item => item.id !== record.id);
        persistedScans.push(JSON.parse(JSON.stringify(record)));
        return record.id;
    },
    clear(storeName) {
        clearedStores.push(storeName);
        persistedScans = [];
        return true;
    }
};

global.fetch = async (url) => {
    if (String(url).includes('api.osv.dev')) {
        return {
            ok: true,
            json: async () => ({ vulns: [] })
        };
    }
    return { ok: false, headers: { get() { return null; } } };
};

delete require.cache[require.resolve('./security-testing.js')];
require('./security-testing.js');

(async () => {
    await test('SecurityTestManager should persist scan history through StorageManager and keep sync history access', async () => {
        const result = await global.window.securityManager.runCodeScan('eval(userInput)', {
            language: 'javascript',
            scanTypes: ['sast'],
            name: 'Stored Scan'
        });

        const history = global.window.securityManager.getHistory(10);

        assertEqual(result.name, 'Stored Scan', 'Scan result should keep its configured name.');
        assertEqual(history.length, 1, 'Scan history should be available synchronously after saving.');
        assertEqual(history[0].name, 'Stored Scan', 'History should preserve the scan name.');
        assertEqual(persistedScans.length, 1, 'StorageManager should receive the persisted scan record.');
    });

    await test('SecurityTestManager should clear persisted history through StorageManager', () => {
        global.window.securityManager.clearHistory();

        assertEqual(global.window.securityManager.getHistory().length, 0, 'In-memory scan history should be cleared.');
        assert(clearedStores.includes('security_scans'), 'StorageManager clear should be called for security scans.');
    });
})();
