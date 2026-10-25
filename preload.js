const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    previewOps: {
        invoke: (action,payload={})=>ipcRenderer.invoke('studio:preview-command',action,JSON.parse(JSON.stringify(payload)))
    },
    studioOps: {
        invokeRaw: (domain,action,payload={})=>ipcRenderer.invoke('studio:invoke',domain,action,payload),
        invoke: async (domain, action, payload = {}) => {
            const result=await ipcRenderer.invoke('studio:invoke', domain, action, payload);
            if(result?.__lvxError){const error=new Error(result.__lvxError.message);error.code=result.__lvxError.code;error.details=result.__lvxError.details;throw error;}
            return result;
        },
        chooseWorkspace: () => ipcRenderer.invoke('studio:choose-workspace'),
        choosePath: payload => ipcRenderer.invoke('studio:choose-path',payload),
        openPreview: payload => ipcRenderer.invoke('studio:preview', payload),
        newWindow: () => ipcRenderer.invoke('studio:new-window'),
        onEvent: callback => {
            if(typeof callback !== 'function') throw new TypeError('Event callback required');
            const listener = (_event, data) => callback(data);
            ipcRenderer.on('studio:event',listener);
            return () => ipcRenderer.removeListener('studio:event',listener);
        }
    },
    runPlaywrightTest: (script) => ipcRenderer.invoke('run-playwright-test', script),

    // Git Operations
    gitOps: {
        check: () => ipcRenderer.invoke('git-ops', 'check'),
        install: () => ipcRenderer.invoke('git-ops', 'install'),
        clone: (url, branch, auth) => ipcRenderer.invoke('git-ops', 'clone', { url, branch, auth })
    },

    // File Operations
    fileOps: {
        listFiles: (dirPath, extension) => ipcRenderer.invoke('file-ops', 'listFiles', { dirPath, extension }),
        readFile: (filePath) => ipcRenderer.invoke('file-ops', 'readFile', { filePath }),
        writeFile: (filePath, content) => ipcRenderer.invoke('file-ops', 'writeFile', { filePath, content })
    },

    // System Operations
    sysOps: {
        runCommand: (cwd, cmd) => ipcRenderer.invoke('sys-ops', 'runCommand', { cwd, cmd })
    },

    // AI Operations
    aiOps: {
        generate: (provider, model, apiKey, prompt, systemPrompt, customEndpoint, maxTokens) =>
            ipcRenderer.invoke('ai-ops', 'generate', { provider, model, apiKey, prompt, systemPrompt, customEndpoint, maxTokens })
    }
});
