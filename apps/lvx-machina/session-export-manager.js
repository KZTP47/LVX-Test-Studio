const fs = require('fs');
const path = require('path');

const DEFAULT_SESSION_RETENTION = {
    enabled: true,
    keepForever: false,
    maxExports: 5
};

function normalizePositiveInteger(value, fallback, maxValue = null) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return fallback;
    }

    const rounded = Math.round(numeric);
    if (Number.isFinite(maxValue)) {
        return Math.min(rounded, maxValue);
    }

    return rounded;
}

function normalizeSessionRetention(retention = {}) {
    return {
        enabled: retention.enabled !== false,
        keepForever: !!retention.keepForever,
        maxExports: normalizePositiveInteger(
            retention.maxExports,
            DEFAULT_SESSION_RETENTION.maxExports,
            100
        )
    };
}

function resolveSessionRetention(storagePreferences = {}) {
    if (storagePreferences?.mode === 'unlimited') {
        return {
            ...DEFAULT_SESSION_RETENTION,
            enabled: false,
            keepForever: true
        };
    }

    if (storagePreferences?.mode === 'custom') {
        return normalizeSessionRetention({
            ...DEFAULT_SESSION_RETENTION,
            ...(storagePreferences.sessionRetention || {})
        });
    }

    return normalizeSessionRetention(DEFAULT_SESSION_RETENTION);
}

function ensureDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function isWithinDirectory(rootDir, targetPath) {
    const resolvedRoot = path.resolve(rootDir);
    const resolvedTarget = path.resolve(targetPath);
    return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

function walkJsonFiles(dirPath, results = []) {
    if (!fs.existsSync(dirPath)) {
        return results;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    entries.forEach(entry => {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            walkJsonFiles(fullPath, results);
            return;
        }

        if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
            const stats = fs.statSync(fullPath);
            results.push({
                path: fullPath,
                fileName: entry.name,
                relativePath: path.relative(dirPath, fullPath),
                sizeBytes: stats.size,
                modifiedAt: stats.mtime.toISOString()
            });
        }
    });

    return results;
}

function collectSessionExports(sessionDir) {
    if (!fs.existsSync(sessionDir)) {
        return {
            directory: sessionDir,
            count: 0,
            totalSizeBytes: 0,
            exports: []
        };
    }

    const sessionExports = walkJsonFiles(sessionDir)
        .map(entry => ({
            ...entry,
            relativePath: path.relative(sessionDir, entry.path)
        }))
        .sort((left, right) => {
            const rightTime = new Date(right.modifiedAt).getTime();
            const leftTime = new Date(left.modifiedAt).getTime();
            return rightTime - leftTime;
        });

    return {
        directory: sessionDir,
        count: sessionExports.length,
        totalSizeBytes: sessionExports.reduce((sum, entry) => sum + entry.sizeBytes, 0),
        exports: sessionExports
    };
}

function pruneEmptyDirectories(startDir, rootDir) {
    let currentDir = path.dirname(startDir);
    const resolvedRoot = path.resolve(rootDir);

    while (isWithinDirectory(resolvedRoot, currentDir) && currentDir !== resolvedRoot) {
        const entries = fs.readdirSync(currentDir);
        if (entries.length > 0) {
            break;
        }

        fs.rmdirSync(currentDir);
        currentDir = path.dirname(currentDir);
    }
}

function cleanupSessionExports(sessionDir, storagePreferences = {}) {
    ensureDirectory(sessionDir);

    const before = collectSessionExports(sessionDir);
    const retention = resolveSessionRetention(storagePreferences);
    if (!retention.enabled || retention.keepForever) {
        return {
            ...before,
            retention,
            deletedCount: 0,
            deletedFiles: [],
            skipped: true,
            reason: retention.keepForever ? 'keep-forever' : 'disabled'
        };
    }

    const filesToDelete = before.exports.slice(retention.maxExports);
    const deletedFiles = [];

    filesToDelete.forEach(entry => {
        if (!fs.existsSync(entry.path)) {
            return;
        }

        fs.rmSync(entry.path, { force: true });
        deletedFiles.push(entry.path);
        pruneEmptyDirectories(entry.path, sessionDir);
    });

    const after = collectSessionExports(sessionDir);
    return {
        ...after,
        retention,
        deletedCount: deletedFiles.length,
        deletedFiles,
        skipped: false
    };
}

function saveSessionExport(sessionDir, exportData, storagePreferences = {}, options = {}) {
    ensureDirectory(sessionDir);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = options.fileName || `pipeline_suites_export_${timestamp}.json`;
    const filePath = path.join(sessionDir, fileName);
    const serialized = JSON.stringify(exportData, null, 2);

    fs.writeFileSync(filePath, serialized, 'utf8');

    return {
        filePath,
        fileName,
        sizeBytes: Buffer.byteLength(serialized, 'utf8'),
        cleanupSummary: cleanupSessionExports(sessionDir, storagePreferences)
    };
}

function deleteSessionExport(sessionDir, targetPath) {
    ensureDirectory(sessionDir);

    if (!isWithinDirectory(sessionDir, targetPath)) {
        throw new Error('Refusing to delete a path outside the saved sessions directory.');
    }

    if (!fs.existsSync(targetPath)) {
        return collectSessionExports(sessionDir);
    }

    const stats = fs.statSync(targetPath);
    if (stats.isDirectory()) {
        fs.rmSync(targetPath, { recursive: true, force: true });
    } else {
        fs.rmSync(targetPath, { force: true });
        pruneEmptyDirectories(targetPath, sessionDir);
    }

    return collectSessionExports(sessionDir);
}

module.exports = {
    DEFAULT_SESSION_RETENTION,
    normalizeSessionRetention,
    resolveSessionRetention,
    collectSessionExports,
    cleanupSessionExports,
    saveSessionExport,
    deleteSessionExport
};
