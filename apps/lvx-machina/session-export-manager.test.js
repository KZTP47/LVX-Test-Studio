const fs = require('fs');
const path = require('path');
const os = require('os');
const {
    resolveSessionRetention,
    cleanupSessionExports,
    saveSessionExport,
    deleteSessionExport
} = require('./session-export-manager');

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
    return fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-session-exports-'));
}

function cleanupDir(dirPath) {
    fs.rmSync(dirPath, { recursive: true, force: true });
}

function createLegacyExport(sessionDir, relativePath, ageDays = 0) {
    const fullPath = path.join(sessionDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, JSON.stringify({ exported_at: new Date().toISOString(), test_suites: [] }, null, 2));
    const mtime = new Date(Date.now() - (ageDays * 24 * 60 * 60 * 1000));
    fs.utimesSync(fullPath, mtime, mtime);
    return fullPath;
}

test('resolveSessionRetention should use smart defaults and unlimited override', async () => {
    const smart = resolveSessionRetention({ mode: 'smart' });
    const unlimited = resolveSessionRetention({ mode: 'unlimited' });

    assertEqual(smart.maxExports, 5, 'Smart mode should keep the default number of exports.');
    assertEqual(smart.keepForever, false, 'Smart mode should not keep exports forever.');
    assertEqual(unlimited.keepForever, true, 'Unlimited mode should disable automatic session cleanup.');
    assertEqual(unlimited.enabled, false, 'Unlimited mode should mark session cleanup as disabled.');
});

test('saveSessionExport should keep only the newest configured exports', async () => {
    const sessionDir = createTempDir();

    try {
        createLegacyExport(sessionDir, 'older\\pipeline_suites_export_old.json', 10);
        createLegacyExport(sessionDir, 'middle\\pipeline_suites_export_mid.json', 5);

        const result = saveSessionExport(sessionDir, { test_suites: [{ id: 'suite-1' }] }, {
            mode: 'custom',
            sessionRetention: {
                enabled: true,
                maxExports: 2
            }
        });

        const remainingFiles = [];
        const walk = (dirPath) => {
            fs.readdirSync(dirPath, { withFileTypes: true }).forEach(entry => {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    walk(fullPath);
                    return;
                }
                remainingFiles.push(path.relative(sessionDir, fullPath));
            });
        };
        walk(sessionDir);

        assertEqual(result.cleanupSummary.deletedCount, 1, 'One old export should be removed once the limit is exceeded.');
        assertEqual(remainingFiles.length, 2, 'Only the newest two exports should remain.');
        assert(remainingFiles.some(file => file === result.fileName), 'The newly saved export should remain.');
    } finally {
        cleanupDir(sessionDir);
    }
});

test('cleanupSessionExports should skip deletion when keep forever is enabled', async () => {
    const sessionDir = createTempDir();

    try {
        createLegacyExport(sessionDir, 'a.json', 30);
        createLegacyExport(sessionDir, 'nested\\b.json', 20);

        const summary = cleanupSessionExports(sessionDir, {
            mode: 'custom',
            sessionRetention: {
                enabled: false,
                keepForever: true,
                maxExports: 1
            }
        });

        assertEqual(summary.skipped, true, 'Keep forever mode should skip automatic cleanup.');
        assertEqual(summary.count, 2, 'All exports should remain when cleanup is skipped.');
    } finally {
        cleanupDir(sessionDir);
    }
});

test('deleteSessionExport should remove the file and empty parent folders', async () => {
    const sessionDir = createTempDir();

    try {
        const targetPath = createLegacyExport(sessionDir, 'nested\\folder\\pipeline_suites_export_old.json', 1);

        const summary = deleteSessionExport(sessionDir, targetPath);
        const nestedFolder = path.join(sessionDir, 'nested', 'folder');

        assertEqual(summary.count, 0, 'Deleting the only export should leave no managed session exports.');
        assertEqual(fs.existsSync(nestedFolder), false, 'Empty legacy session folders should be removed after delete.');
    } finally {
        cleanupDir(sessionDir);
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
