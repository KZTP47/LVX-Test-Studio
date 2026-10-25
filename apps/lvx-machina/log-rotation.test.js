const fs = require('fs');
const path = require('path');
const os = require('os');
const { rotateLogFiles, resolveLogRetention } = require('./log-rotation');

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
    return fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-log-rotation-'));
}

function createFile(dirPath, fileName, sizeBytes, ageDays) {
    const filePath = path.join(dirPath, fileName);
    fs.writeFileSync(filePath, Buffer.alloc(sizeBytes, 'a'));
    const mtime = new Date(Date.now() - (ageDays * 24 * 60 * 60 * 1000));
    fs.utimesSync(filePath, mtime, mtime);
    return filePath;
}

function cleanupDir(dirPath) {
    fs.rmSync(dirPath, { recursive: true, force: true });
}

test('resolveLogRetention should honor custom preferences', async () => {
    const retention = resolveLogRetention({
        mode: 'custom',
        logRetention: {
            maxFiles: 10,
            maxAgeDays: 7,
            maxTotalSizeMB: 25
        }
    });

    assertEqual(retention.maxFiles, 10, 'Custom maxFiles should be used.');
    assertEqual(retention.maxAgeDays, 7, 'Custom maxAgeDays should be used.');
    assertEqual(retention.maxTotalSizeMB, 25, 'Custom maxTotalSizeMB should be used.');
});

test('rotateLogFiles should remove old logs and enforce file count', async () => {
    const dirPath = createTempDir();

    try {
        createFile(dirPath, 'old.log', 128, 45);
        createFile(dirPath, 'new-1.log', 128, 5);
        createFile(dirPath, 'new-2.log', 128, 4);
        createFile(dirPath, 'new-3.log', 128, 3);

        const summary = rotateLogFiles(dirPath, {
            mode: 'custom',
            logRetention: {
                enabled: true,
                maxFiles: 2,
                maxAgeDays: 30,
                maxTotalSizeMB: 10
            }
        }, { extension: '.log' });

        const remainingFiles = fs.readdirSync(dirPath).sort();

        assertEqual(summary.deletedCount, 2, 'One expired file and one overflow file should be deleted.');
        assertEqual(remainingFiles.length, 2, 'Only two log files should remain.');
        assert(remainingFiles.includes('new-2.log'), 'The newer retained file should remain.');
        assert(remainingFiles.includes('new-3.log'), 'The newest retained file should remain.');
    } finally {
        cleanupDir(dirPath);
    }
});

test('rotateLogFiles should enforce total size cap using oldest-first deletion', async () => {
    const dirPath = createTempDir();

    try {
        createFile(dirPath, 'a.log', 1024 * 1024 * 3, 3);
        createFile(dirPath, 'b.log', 1024 * 1024 * 3, 2);
        createFile(dirPath, 'c.log', 1024 * 1024 * 3, 1);

        const summary = rotateLogFiles(dirPath, {
            mode: 'custom',
            logRetention: {
                enabled: true,
                maxFiles: 50,
                maxAgeDays: 30,
                maxTotalSizeMB: 5
            }
        }, { extension: '.log' });

        const remainingFiles = fs.readdirSync(dirPath).sort();

        assertEqual(summary.deletedCount, 2, 'Oldest files should be removed until size is under the cap.');
        assertEqual(remainingFiles.length, 1, 'Only one file should remain after enforcing size cap.');
        assertEqual(remainingFiles[0], 'c.log', 'The newest log file should be preserved.');
    } finally {
        cleanupDir(dirPath);
    }
});

test('rotateLogFiles should skip cleanup in unlimited mode', async () => {
    const dirPath = createTempDir();

    try {
        createFile(dirPath, 'keep.log', 128, 365);

        const summary = rotateLogFiles(dirPath, { mode: 'unlimited' }, { extension: '.log' });
        const remainingFiles = fs.readdirSync(dirPath);

        assertEqual(summary.skipped, true, 'Unlimited mode should skip rotation.');
        assertEqual(summary.reason, 'unlimited', 'Unlimited mode should explain why it skipped cleanup.');
        assertEqual(remainingFiles.length, 1, 'No files should be deleted in unlimited mode.');
    } finally {
        cleanupDir(dirPath);
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
