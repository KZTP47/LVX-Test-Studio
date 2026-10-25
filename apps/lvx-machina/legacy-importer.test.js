const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    extractImportPayload,
    collectLegacyImportFiles
} = require('./legacy-importer');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message} Expected ${expected}, got ${actual}`);
    }
}

const tests = [];

function test(name, fn) {
    tests.push({ name, fn });
}

function createTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-legacy-import-'));
}

function cleanupDir(dirPath) {
    fs.rmSync(dirPath, { recursive: true, force: true });
}

test('extractImportPayload should parse session export files with views, pipelines, and versions', () => {
    const payload = extractImportPayload(JSON.stringify({
        views: [{ id: 'view-1', name: 'Security View' }],
        pipelines: [{ id: 'pipe-1', name: 'Pipeline 1' }],
        test_suites: [{ id: 'suite-1', name: 'Suite A', code: 'print(1)', language: 'python' }],
        version_histories: {
            'suite-1': [{ versionId: 'v1', timestamp: '2026-03-27T10:00:00.000Z', suiteSnapshot: { id: 'suite-1' } }]
        }
    }), { sourceName: 'export.json' });

    assertEqual(payload.format, 'session-export', 'Session export format should be detected.');
    assertEqual(payload.suites.length, 1, 'One suite should be extracted.');
    assertEqual(payload.views.length, 1, 'One view should be extracted.');
    assertEqual(payload.pipelines.length, 1, 'One pipeline should be extracted.');
    assertEqual(payload.versionHistories['suite-1'].length, 1, 'Version history should be preserved.');
});

test('extractImportPayload should parse old app state backups and single suite files', () => {
    const backupPayload = extractImportPayload({
        appState: {
            test_suites: [{ id: 'suite-2', name: 'Backup Suite', code: 'console.log(1);', language: 'javascript' }],
            views: [{ id: 'view-2', name: 'Backup View' }]
        }
    }, { sourceName: 'backup.json' });

    assertEqual(backupPayload.format, 'app-state-backup', 'App state backup format should be detected.');
    assertEqual(backupPayload.suites.length, 1, 'Backup suite should be extracted.');
    assertEqual(backupPayload.views.length, 1, 'Backup view should be extracted.');

    const singleSuitePayload = extractImportPayload({
        name: 'Standalone Suite',
        language: 'python',
        code: 'print("ok")'
    }, { sourceName: 'single-suite.json' });

    assertEqual(singleSuitePayload.format, 'single-suite', 'Single suite format should be detected.');
    assertEqual(singleSuitePayload.suites.length, 1, 'Single suite payload should import one suite.');
});

test('collectLegacyImportFiles should find nested JSON files only', () => {
    const tempDir = createTempDir();

    try {
        fs.mkdirSync(path.join(tempDir, 'nested', 'deeper'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'root.json'), '{}');
        fs.writeFileSync(path.join(tempDir, 'nested', 'session.json'), '{}');
        fs.writeFileSync(path.join(tempDir, 'nested', 'deeper', 'ignored.txt'), 'hello');

        const files = collectLegacyImportFiles(tempDir);

        assertEqual(files.length, 2, 'Only JSON files should be collected.');
        assert(files.some(file => file.relativePath === 'root.json'), 'Root JSON file should be present.');
        assert(files.some(file => file.relativePath === path.join('nested', 'session.json')), 'Nested JSON file should be present.');
    } finally {
        cleanupDir(tempDir);
    }
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
