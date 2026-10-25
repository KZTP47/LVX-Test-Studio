const fs = require('fs');
const path = require('path');

const DEFAULT_LOG_RETENTION = Object.freeze({
    enabled: true,
    maxFiles: 50,
    maxAgeDays: 30,
    maxTotalSizeMB: 100
});

const DEFAULT_ALLOWED_EXTENSIONS = new Set(['.log', '.txt', '.json', '.html', '.xml', '.md']);

function normalizePositiveInteger(value, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return fallback;
    }

    return Math.round(numeric);
}

function normalizeLogRetention(retention = {}, fallback = DEFAULT_LOG_RETENTION) {
    const base = { ...fallback, ...(retention || {}) };
    return {
        enabled: base.enabled !== false,
        maxFiles: normalizePositiveInteger(base.maxFiles, fallback.maxFiles),
        maxAgeDays: normalizePositiveInteger(base.maxAgeDays, fallback.maxAgeDays),
        maxTotalSizeMB: normalizePositiveInteger(base.maxTotalSizeMB, fallback.maxTotalSizeMB)
    };
}

function resolveLogRetention(storagePreferences) {
    if (storagePreferences?.mode === 'custom' && storagePreferences?.logRetention) {
        return normalizeLogRetention(storagePreferences.logRetention, DEFAULT_LOG_RETENTION);
    }

    return normalizeLogRetention({}, DEFAULT_LOG_RETENTION);
}

function getAllowedExtensions(options = {}) {
    const explicitExtensions = Array.isArray(options.extensions)
        ? options.extensions
        : options.extension
            ? [options.extension]
            : [];

    if (explicitExtensions.length === 0) {
        return DEFAULT_ALLOWED_EXTENSIONS;
    }

    const normalized = explicitExtensions
        .map(extension => String(extension || '').trim().toLowerCase())
        .filter(Boolean)
        .map(extension => extension.startsWith('.') ? extension : `.${extension}`);

    return normalized.length > 0 ? new Set(normalized) : DEFAULT_ALLOWED_EXTENSIONS;
}

function listLogFiles(logDir, options = {}) {
    if (!logDir || !fs.existsSync(logDir)) {
        return [];
    }

    const allowedExtensions = getAllowedExtensions(options);

    return fs.readdirSync(logDir)
        .map(fileName => {
            const filePath = path.join(logDir, fileName);
            const stats = fs.statSync(filePath);
            return {
                path: filePath,
                name: fileName,
                size: stats.size,
                mtimeMs: stats.mtimeMs,
                isFile: stats.isFile()
            };
        })
        .filter(file => file.isFile)
        .filter(file => allowedExtensions.has(path.extname(file.name).toLowerCase()));
}

function rotateLogFiles(logDir, storagePreferences, options = {}) {
    const summary = {
        deletedCount: 0,
        deletedPaths: [],
        skipped: false,
        reason: null,
        retention: resolveLogRetention(storagePreferences)
    };

    if (!logDir || !fs.existsSync(logDir)) {
        summary.skipped = true;
        summary.reason = 'missing-directory';
        return summary;
    }

    if (storagePreferences?.mode === 'unlimited') {
        summary.skipped = true;
        summary.reason = 'unlimited';
        return summary;
    }

    if (!summary.retention.enabled) {
        summary.skipped = true;
        summary.reason = 'disabled';
        return summary;
    }

    const deleteFile = (file) => {
        try {
            fs.unlinkSync(file.path);
            summary.deletedCount += 1;
            summary.deletedPaths.push(file.path);
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                throw error;
            }
        }
    };

    const maxAgeCutoffMs = Date.now() - (summary.retention.maxAgeDays * 24 * 60 * 60 * 1000);
    let remaining = listLogFiles(logDir, options);

    remaining
        .filter(file => file.mtimeMs < maxAgeCutoffMs)
        .forEach(deleteFile);

    remaining = listLogFiles(logDir, options).sort((a, b) => a.mtimeMs - b.mtimeMs);

    if (remaining.length > summary.retention.maxFiles) {
        const overflow = remaining.slice(0, remaining.length - summary.retention.maxFiles);
        overflow.forEach(deleteFile);
    }

    remaining = listLogFiles(logDir, options).sort((a, b) => a.mtimeMs - b.mtimeMs);

    const maxTotalSizeBytes = summary.retention.maxTotalSizeMB * 1024 * 1024;
    let totalSize = remaining.reduce((sum, file) => sum + file.size, 0);

    for (const file of remaining) {
        if (totalSize <= maxTotalSizeBytes) {
            break;
        }

        deleteFile(file);
        totalSize -= file.size;
    }

    return summary;
}

module.exports = {
    DEFAULT_LOG_RETENTION,
    normalizeLogRetention,
    resolveLogRetention,
    rotateLogFiles
};
