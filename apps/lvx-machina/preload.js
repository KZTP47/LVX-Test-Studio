const { contextBridge, ipcRenderer } = require('electron');

function invokeSecureStorage(command, args) {
    const result = ipcRenderer.sendSync('secure-storage-sync', { command, args });
    if (!result?.ok) {
        throw new Error(result?.error || 'Secure storage request failed');
    }
    return result.value;
}

contextBridge.exposeInMainWorld('electronAPI', {
    runPlaywrightTest: (script) => ipcRenderer.invoke('run-playwright-test', script),

    // Fast-path HTTP Request (Bypasses CORS for API/Contract Testing)
    httpRequest: (args) => ipcRenderer.invoke('http-request', args),

    // Fast-path Zipping (Memory content to file for Log Collector)
    zipFiles: (args) => ipcRenderer.invoke('zip-files', args),

    // Advanced Git & Shell handlers (For Push & Deploy)
    gitCloneToTemp: (args) => ipcRenderer.invoke('git-clone-to-temp', args),
    gitCommitAndPush: (args) => ipcRenderer.invoke('git-commit-and-push', args),
    removeTempDirectory: (dir) => ipcRenderer.invoke('remove-temp-directory', dir),
    runShellCommand: (args) => ipcRenderer.invoke('run-shell-command', args),

    // Git Operations
    gitOps: {
        check: () => ipcRenderer.invoke('git-ops', 'check'),
        install: () => ipcRenderer.invoke('git-ops', 'install'),
        clone: (urlOrArgs, branch, auth) => {
            const request = (urlOrArgs && typeof urlOrArgs === 'object' && !Array.isArray(urlOrArgs))
                ? urlOrArgs
                : { url: urlOrArgs, branch, auth };
            return ipcRenderer.invoke('git-ops', 'clone', request);
        }
    },

    // File Operations
    fileOps: {
        listFiles: (dirPath, extension) => ipcRenderer.invoke('file-ops', 'listFiles', { dirPath, extension }),
        readFile: (filePath) => ipcRenderer.invoke('file-ops', 'readFile', { filePath }),
        writeFile: (filePath, content, options = {}) => ipcRenderer.invoke('file-ops', 'writeFile', { filePath, content, options }),
        pickSaveFile: (options = {}) => ipcRenderer.invoke('file-ops', 'pickSaveFile', options),
        zip: (args) => ipcRenderer.invoke('file-ops', 'zip', args)
    },

    sessionExports: {
        getSummary: () => ipcRenderer.invoke('session-exports', 'getSummary'),
        cleanup: (storagePreferences = {}) => ipcRenderer.invoke('session-exports', 'cleanup', { storagePreferences }),
        saveExport: (data, storagePreferences = {}) => ipcRenderer.invoke('session-exports', 'saveExport', { data, storagePreferences }),
        deleteExport: (filePath) => ipcRenderer.invoke('session-exports', 'deleteExport', { filePath })
    },

    legacyImports: {
        pickJsonFile: () => ipcRenderer.invoke('legacy-imports', 'pickJsonFile'),
        pickSessionFolder: () => ipcRenderer.invoke('legacy-imports', 'pickSessionFolder'),
        readJsonFile: (filePath) => ipcRenderer.invoke('legacy-imports', 'readJsonFile', { filePath }),
        readSessionFolder: (folderPath) => ipcRenderer.invoke('legacy-imports', 'readSessionFolder', { folderPath })
    },

    // System Operations
    sysOps: {
        runCommand: (cwd, cmd) => ipcRenderer.invoke('sys-ops', 'runCommand', { cwd, cmd })
    },

    // AI Operations
    aiOps: {
        generate: (...args) => {
            const request = (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]))
                ? args[0]
                : {
                    provider: args[0],
                    model: args[1],
                    apiKey: args[2],
                    prompt: args[3],
                    systemPrompt: args[4],
                    customEndpoint: args[5],
                    maxTokens: args[6]
                };
            return ipcRenderer.invoke('ai-ops', 'generate', request);
        }
    },

    secureStorage: {
        isEncryptionAvailable: () => {
            try {
                return !!invokeSecureStorage('isEncryptionAvailable');
            } catch (error) {
                return false;
            }
        },
        encryptString: (text) => invokeSecureStorage('encryptString', text),
        decryptString: (cipherText) => invokeSecureStorage('decryptString', cipherText)
    }
});
