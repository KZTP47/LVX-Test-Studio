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

function createStorage() {
    const store = new Map();
    return {
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(key, String(value));
        },
        removeItem(key) {
            store.delete(key);
        }
    };
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

global.window = global;
global.localStorage = createStorage();

delete require.cache[require.resolve('./data-manager.js')];
require('./data-manager.js');

test('DataManager should detect supported file types', () => {
    const manager = new global.DataManager();

    assertEqual(manager.inferFileType('users.csv'), 'csv', 'CSV extension should be detected');
    assertEqual(manager.inferFileType('people.xlsx'), 'excel', 'Excel extension should be detected');
    assertEqual(manager.inferFileType('payload.json'), 'json', 'JSON extension should be detected');
    assertEqual(manager.inferFileType('notes.txt'), 'text', 'Text extension should be detected');
});

test('DataManager should parse object-array JSON into headers and rows', () => {
    const manager = new global.DataManager();
    const parsed = manager.parseJSONData('[{"username":"alice","email":"a@b.com"},{"username":"bob","email":"b@b.com"}]');

    assertEqual(parsed.headers.length, 2, 'Two headers should be detected');
    assert(parsed.headers.includes('username'), 'username header should be present');
    assertEqual(parsed.data.length, 2, 'Two rows should be parsed');
    assertEqual(parsed.data[0].username, 'alice', 'First row values should be preserved');
});

test('DataManager should parse text files into line-based rows when not CSV', () => {
    const manager = new global.DataManager();
    const parsed = manager.parseTextData('alice\nbob\ncharlie');

    assertEqual(parsed.headers.length, 1, 'Text data should use a single text column');
    assertEqual(parsed.headers[0], 'text', 'Text header should be named text');
    assertEqual(parsed.data.length, 3, 'Each line should become one row');
    assertEqual(parsed.data[2].text, 'charlie', 'Line content should be preserved');
});

test('DataManager should persist data sets through StorageManager when available', () => {
    const persisted = [];
    global.window.storageManager = {
        STORES: { datasets: 'datasets' },
        getAll() {
            return [];
        },
        replaceAll(storeName, items) {
            persisted.length = 0;
            items.forEach(item => persisted.push({ ...item }));
            return true;
        }
    };

    const manager = new global.DataManager();
    const dataSetId = manager.saveDataSet({
        name: 'IndexedDB Users',
        headers: ['username'],
        data: [{ username: 'alice' }]
    });

    assertEqual(persisted.length, 1, 'StorageManager should receive the saved data set.');
    assertEqual(persisted[0].id, dataSetId, 'Persisted data set should keep the generated ID.');
    assertEqual(persisted[0].name, 'IndexedDB Users', 'Persisted data set name should be preserved.');
});
