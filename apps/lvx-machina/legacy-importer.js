(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    root.LegacyImporter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    const hasRequire = typeof require === 'function';
    const fs = hasRequire ? require('fs') : null;
    const path = hasRequire ? require('path') : null;

    function cloneValue(value) {
        if (value == null || typeof value !== 'object') {
            return value;
        }

        try {
            return JSON.parse(JSON.stringify(value));
        } catch (error) {
            return value;
        }
    }

    function isPlainObject(value) {
        return Object.prototype.toString.call(value) === '[object Object]';
    }

    function looksLikeSuite(value) {
        if (!isPlainObject(value)) {
            return false;
        }

        return ['name', 'code', 'language', 'description', 'expected_output'].some(key => {
            return Object.prototype.hasOwnProperty.call(value, key);
        });
    }

    function normalizeSuite(rawSuite, index) {
        const suite = cloneValue(rawSuite);
        if (!isPlainObject(suite)) {
            return null;
        }

        if (!suite.name) {
            suite.name = `Imported Suite ${index + 1}`;
        }

        if (!suite.tags || !Array.isArray(suite.tags)) {
            suite.tags = [];
        }

        if (!suite.dateCreated) {
            suite.dateCreated = new Date().toISOString();
        }

        if (!suite.dateModified) {
            suite.dateModified = new Date().toISOString();
        }

        return suite;
    }

    function extractVersionHistories(container) {
        if (!container) {
            return {};
        }

        const candidate = container.version_histories || container.versionHistories || container.suite_versions || {};
        if (!isPlainObject(candidate)) {
            return {};
        }

        const normalized = {};
        Object.entries(candidate).forEach(([suiteId, versions]) => {
            if (!suiteId || !Array.isArray(versions)) {
                return;
            }

            normalized[suiteId] = versions
                .filter(version => isPlainObject(version))
                .map(version => cloneValue(version));
        });

        return normalized;
    }

    function extractImportPayload(rawContent, options = {}) {
        const sourceName = options.sourceName || 'Imported file';
        const parsed = typeof rawContent === 'string'
            ? JSON.parse(rawContent)
            : cloneValue(rawContent);

        let suites = [];
        let views = [];
        let pipelines = [];
        let versionHistories = {};
        let format = 'unknown';

        if (Array.isArray(parsed)) {
            format = 'suite-array';
            suites = parsed;
        } else if (looksLikeSuite(parsed)) {
            format = 'single-suite';
            suites = [parsed];
        } else if (isPlainObject(parsed)) {
            const appState = isPlainObject(parsed.appState) ? parsed.appState : null;
            const nestedData = isPlainObject(parsed.data) ? parsed.data : null;
            const suiteCandidates = [
                parsed.test_suites,
                parsed.suites,
                parsed.tests,
                appState?.test_suites,
                appState?.suites,
                nestedData?.test_suites,
                nestedData?.suites
            ];
            suites = suiteCandidates.find(Array.isArray) || [];
            views = parsed.views || appState?.views || nestedData?.views || [];
            pipelines = parsed.pipelines || appState?.pipelines || nestedData?.pipelines || [];
            versionHistories = {
                ...extractVersionHistories(parsed),
                ...extractVersionHistories(appState),
                ...extractVersionHistories(nestedData)
            };

            if (Array.isArray(parsed.test_suites)) {
                format = 'session-export';
            } else if (Array.isArray(parsed.suites)) {
                format = 'legacy-suite-bundle';
            } else if (Array.isArray(parsed.tests)) {
                format = 'legacy-test-bundle';
            } else if (appState || nestedData) {
                format = 'app-state-backup';
            }
        }

        const normalizedSuites = suites
            .map((suite, index) => normalizeSuite(suite, index))
            .filter(Boolean);

        if (normalizedSuites.length === 0 && !Array.isArray(views) && !Array.isArray(pipelines)) {
            throw new Error(`"${sourceName}" does not contain any supported suites, exports, or backups.`);
        }

        return {
            sourceName,
            format,
            views: Array.isArray(views) ? views.filter(isPlainObject).map(cloneValue) : [],
            pipelines: Array.isArray(pipelines) ? pipelines.filter(isPlainObject).map(cloneValue) : [],
            suites: normalizedSuites,
            versionHistories,
            raw: parsed
        };
    }

    function collectLegacyImportFiles(directoryPath) {
        if (!fs || !path) {
            throw new Error('Folder import is only available in the Electron runtime.');
        }

        const results = [];

        function walk(currentPath) {
            fs.readdirSync(currentPath, { withFileTypes: true }).forEach(entry => {
                const fullPath = path.join(currentPath, entry.name);
                if (entry.isDirectory()) {
                    walk(fullPath);
                    return;
                }

                if (!entry.name.toLowerCase().endsWith('.json')) {
                    return;
                }

                results.push({
                    path: fullPath,
                    fileName: entry.name,
                    relativePath: path.relative(directoryPath, fullPath)
                });
            });
        }

        if (fs.existsSync(directoryPath)) {
            walk(directoryPath);
        }

        return results.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    }

    return {
        extractImportPayload,
        collectLegacyImportFiles
    };
});
