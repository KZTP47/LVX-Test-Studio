(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    root.secureConfig = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    const ENCRYPTED_MARKER = '__lvxEncrypted';
    const ENCRYPTED_VERSION = 1;
    const DEFAULT_SENSITIVE_PATTERNS = [
        /api[_-]?key/i,
        /clientsecret/i,
        /secret/i,
        /token/i,
        /authheader/i,
        /webhookurl/i,
        /password/i
    ];

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

    function getSecureStorageBridge() {
        return root?.electronAPI?.secureStorage || null;
    }

    function isEncryptionAvailable() {
        try {
            const bridge = getSecureStorageBridge();
            return !!(bridge && typeof bridge.isEncryptionAvailable === 'function' && bridge.isEncryptionAvailable());
        } catch (error) {
            return false;
        }
    }

    function getSensitivePatterns(options = {}) {
        const custom = Array.isArray(options.sensitivePatterns) ? options.sensitivePatterns : [];
        return [...DEFAULT_SENSITIVE_PATTERNS, ...custom];
    }

    function isSensitivePath(pathSegments, options = {}) {
        const path = pathSegments.join('.');
        const key = pathSegments[pathSegments.length - 1] || '';
        const explicitPaths = Array.isArray(options.sensitivePaths) ? options.sensitivePaths : [];
        const explicitKeys = Array.isArray(options.sensitiveKeys) ? options.sensitiveKeys : [];

        if (explicitPaths.includes(path)) {
            return true;
        }

        if (explicitKeys.includes(key)) {
            return true;
        }

        return getSensitivePatterns(options).some(pattern => {
            if (typeof pattern === 'string') {
                return pattern === key || path.endsWith(`.${pattern}`) || path === pattern;
            }
            return pattern.test(key);
        });
    }

    function encryptString(value) {
        const bridge = getSecureStorageBridge();
        if (!bridge || typeof bridge.encryptString !== 'function') {
            return value;
        }
        return bridge.encryptString(String(value));
    }

    function decryptString(value) {
        const bridge = getSecureStorageBridge();
        if (!bridge || typeof bridge.decryptString !== 'function') {
            return value;
        }
        return bridge.decryptString(String(value));
    }

    function protectData(value, options = {}, path = [], encryptionEnabled = isEncryptionAvailable()) {
        if (Array.isArray(value)) {
            return value.map((item, index) => protectData(item, options, path.concat(String(index)), encryptionEnabled));
        }

        if (value == null || typeof value !== 'object') {
            return value;
        }

        if (value[ENCRYPTED_MARKER]) {
            return value;
        }

        const output = {};

        Object.entries(value).forEach(([key, currentValue]) => {
            const nextPath = path.concat(key);

            if (
                encryptionEnabled &&
                typeof currentValue === 'string' &&
                currentValue &&
                isSensitivePath(nextPath, options)
            ) {
                try {
                    output[key] = {
                        [ENCRYPTED_MARKER]: true,
                        version: ENCRYPTED_VERSION,
                        value: encryptString(currentValue)
                    };
                    return;
                } catch (error) {
                    console.warn(`[secureConfig] Failed to encrypt ${nextPath.join('.')}:`, error);
                }
            }

            output[key] = protectData(currentValue, options, nextPath, encryptionEnabled);
        });

        return output;
    }

    function unprotectData(value) {
        if (Array.isArray(value)) {
            return value.map(item => unprotectData(item));
        }

        if (value == null || typeof value !== 'object') {
            return value;
        }

        if (value[ENCRYPTED_MARKER]) {
            try {
                return decryptString(value.value || '');
            } catch (error) {
                console.warn('[secureConfig] Failed to decrypt stored value:', error);
                return '';
            }
        }

        const output = {};
        Object.entries(value).forEach(([key, currentValue]) => {
            output[key] = unprotectData(currentValue);
        });
        return output;
    }

    function loadConfig(storageKey, defaultValue = null, options = {}) {
        try {
            const raw = root?.localStorage?.getItem(storageKey);
            if (!raw) {
                return cloneValue(defaultValue);
            }

            const parsed = JSON.parse(raw);
            return unprotectData(parsed, options);
        } catch (error) {
            console.warn(`[secureConfig] Failed to load ${storageKey}:`, error);
            return cloneValue(defaultValue);
        }
    }

    function saveConfig(storageKey, value, options = {}) {
        const preparedValue = protectData(value, options);
        root?.localStorage?.setItem(storageKey, JSON.stringify(preparedValue));
        return true;
    }

    function clearConfig(storageKey) {
        root?.localStorage?.removeItem(storageKey);
    }

    return {
        ENCRYPTED_MARKER,
        isEncryptionAvailable,
        isSensitivePath,
        protectData,
        unprotectData,
        loadConfig,
        saveConfig,
        clearConfig
    };
});
