const { app, BrowserWindow, ipcMain, safeStorage, dialog } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const { rotateLogFiles } = require('./log-rotation');
const {
    collectSessionExports,
    cleanupSessionExports,
    saveSessionExport,
    deleteSessionExport
} = require('./session-export-manager');
const { collectLegacyImportFiles } = require('./legacy-importer');

// const __filename = fileURLToPath(import.meta.url); // Not needed in CommonJS
// const __dirname = path.dirname(__filename); // __dirname is global in CommonJS

function getWorkspaceRoot() {
    if (app.isPackaged) {
        return path.resolve(path.dirname(process.execPath), '..', '..', '..');
    }

    return path.resolve(__dirname, '..');
}

function getSavedSessionsDir() {
    return path.join(getWorkspaceRoot(), 'saved sessions');
}

function getImportDefaultPath() {
    const sessionDir = getSavedSessionsDir();
    return fs.existsSync(sessionDir) ? sessionDir : getWorkspaceRoot();
}

const createWindow = () => {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    win.loadFile('index.html');
    // win.webContents.openDevTools(); // Optional: Open DevTools
};

ipcMain.on('secure-storage-sync', (event, payload) => {
    const { command, args } = payload || {};

    try {
        switch (command) {
            case 'isEncryptionAvailable':
                event.returnValue = { ok: true, value: safeStorage.isEncryptionAvailable() };
                return;
            case 'encryptString':
                if (!safeStorage.isEncryptionAvailable()) {
                    throw new Error('OS-level secure storage is not available on this device.');
                }
                event.returnValue = {
                    ok: true,
                    value: safeStorage.encryptString(String(args ?? '')).toString('base64')
                };
                return;
            case 'decryptString':
                if (!safeStorage.isEncryptionAvailable()) {
                    throw new Error('OS-level secure storage is not available on this device.');
                }
                event.returnValue = {
                    ok: true,
                    value: safeStorage.decryptString(Buffer.from(String(args ?? ''), 'base64'))
                };
                return;
            default:
                throw new Error(`Unknown secure storage command: ${command}`);
        }
    } catch (error) {
        event.returnValue = { ok: false, error: error.message };
    }
});

// ==========================================
// GIT OPERATIONS HANDLER
// ==========================================
ipcMain.handle('git-ops', async (event, command, args) => {
    console.log('[Main] Git Ops Request:', command, args);

    if (command === 'check') {
        return new Promise((resolve) => {
            exec('git --version', (err) => resolve(!err)); // Resolve true if no error
        });
    }

    if (command === 'install') {
        return new Promise((resolve, reject) => {
            // Use shell execution for winget to ensure it runs in a visible way if possible, or usually silent
            // Note: Winget might trigger UAC.
            console.log('[Main] Attempting to install Git via Winget...');
            const installCmd = 'winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements --silent';

            exec(installCmd, (err, stdout, stderr) => {
                if (err) {
                    console.error('[Main] Git Install Error:', err);
                    reject(new Error(`Installation failed: ${stderr || err.message}`));
                } else {
                    console.log('[Main] Git Installed:', stdout);
                    resolve(true);
                }
            });
        });
    }

    if (command === 'clone') {
        const { url, branch, auth, branchMissingPolicy, branchBase } = args;
        if (!url) throw new Error('Repo URL is required');

        // created clean path
        const repoName = url.split('/').pop().replace('.git', '').replace(/[^a-zA-Z0-9-_]/g, '');
        const timestamp = Date.now();
        const targetPath = path.join(os.tmpdir(), 'lvx-repos', `${repoName}_${timestamp}`);

        // Ensure parent dir exists
        const parentDir = path.dirname(targetPath);
        if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

        try {
            const result = cloneRepositoryWithBranchPolicy({
                url,
                branch,
                auth,
                branchMissingPolicy,
                branchBase,
                targetPath,
                createRemoteBranchIfMissing: true
            });
            console.log('[Main] Clone Success:', targetPath);
            return {
                success: true,
                path: targetPath,
                branch: result.branch,
                branchCreated: result.branchCreated,
                baseBranchUsed: result.baseBranchUsed,
                logs: result.branchCreated
                    ? `Created branch ${result.branch} from ${result.baseBranchUsed}`
                    : `Cloned branch ${result.branch}`
            };
        } catch (error) {
            console.error('[Main] Clone Error:', error.message);
            throw error;
        }
    }
});

// ==========================================
// FILE OPERATIONS HANDLER
// ==========================================
ipcMain.handle('file-ops', async (event, command, args) => {
    if (command === 'listFiles') {
        const { dirPath, extension } = args;

        // Security check: ensure accessing allowed paths (like tmp)
        // For now, allowing all for prototype, but should restrict in production

        if (!fs.existsSync(dirPath)) throw new Error('Directory does not exist');

        const getAllFiles = (dir, ext, fileList = []) => {
            const files = fs.readdirSync(dir);
            files.forEach(file => {
                const filePath = path.join(dir, file);
                const stat = fs.statSync(filePath);
                if (stat.isDirectory()) {
                    if (file !== '.git' && file !== 'node_modules') { // Ignore git and node_modules
                        getAllFiles(filePath, ext, fileList);
                    }
                } else {
                    if (!ext || file.endsWith('.' + ext)) {
                        fileList.push(filePath);
                    }
                }
            });
            return fileList;
        };

        return getAllFiles(dirPath, extension);
    }

    if (command === 'readFile') {
        const { filePath } = args;
        const content = fs.readFileSync(filePath, 'utf-8');
        return content;
    }

    if (command === 'writeFile') {
        const { filePath, content, options = {} } = args;
        const parentDir = path.dirname(filePath);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.writeFileSync(filePath, content, 'utf-8');

        let logRotation = null;
        if (options.rotateLogs) {
            logRotation = rotateLogFiles(parentDir, options.storagePreferences, {
                extension: path.extname(filePath)
            });
        }

        return { success: true, logRotation };
    }

    if (command === 'pickSaveFile') {
        const {
            title,
            defaultPath,
            defaultFileName,
            filters
        } = args || {};

        const resolvedDefaultPath = defaultPath
            || (defaultFileName ? path.join(getImportDefaultPath(), defaultFileName) : getImportDefaultPath());

        const result = await dialog.showSaveDialog({
            title: title || 'Save File',
            defaultPath: resolvedDefaultPath,
            filters: Array.isArray(filters) && filters.length > 0
                ? filters
                : [
                    { name: 'Markdown Files', extensions: ['md'] },
                    { name: 'Text Files', extensions: ['txt'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
        });

        return {
            canceled: !!result.canceled,
            filePath: result.filePath || ''
        };
    }

    if (command === 'zip') {
        const { sourcePaths, zipPath } = args;
        if (!sourcePaths || !zipPath) throw new Error('Source paths and zip path are required');

        // PowerShell Compress-Archive uses comma separated paths (escaped for PS)
        // Note: Paths must exist.
        const sourceList = Array.isArray(sourcePaths) 
            ? sourcePaths.map(p => `"${p.replace(/"/g, '`"')}"`).join(',') 
            : `"${sourcePaths.replace(/"/g, '`"')}"`;

        const outPath = `"${zipPath.replace(/"/g, '`"')}"`;

        const psCmd = `powershell -Command "Compress-Archive -Path ${sourceList} -DestinationPath ${outPath} -Force"`;

        return new Promise((resolve, reject) => {
            console.log(`[Main] Executing Zip: ${psCmd}`);
            exec(psCmd, (err, stdout, stderr) => {
                if (err) {
                    console.error('[Main] Zip Error:', stderr);
                    reject(new Error(stderr || err.message));
                } else {
                    console.log('[Main] Zip Success:', zipPath);
                    resolve({ success: true, zipPath });
                }
            });
        });
    }

});

// ==========================================
// SESSION EXPORTS HANDLER
// ==========================================
ipcMain.handle('session-exports', async (event, command, args) => {
    const sessionDir = getSavedSessionsDir();

    if (command === 'getSummary') {
        return collectSessionExports(sessionDir);
    }

    if (command === 'cleanup') {
        return cleanupSessionExports(sessionDir, args?.storagePreferences || {});
    }

    if (command === 'saveExport') {
        const { data, storagePreferences } = args || {};
        if (!data || typeof data !== 'object') {
            throw new Error('Export data is missing or invalid.');
        }

        return saveSessionExport(sessionDir, data, storagePreferences || {});
    }

    if (command === 'deleteExport') {
        const { filePath } = args || {};
        if (!filePath) {
            throw new Error('Session export path is required.');
        }

        return deleteSessionExport(sessionDir, filePath);
    }

    throw new Error(`Unknown session export command: ${command}`);
});

// ==========================================
// LEGACY IMPORT HANDLER
// ==========================================
ipcMain.handle('legacy-imports', async (event, command, args) => {
    if (command === 'pickJsonFile') {
        const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            defaultPath: getImportDefaultPath(),
            filters: [
                { name: 'JSON Files', extensions: ['json'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (result.canceled || !result.filePaths?.[0]) {
            return { canceled: true };
        }

        return {
            canceled: false,
            filePath: result.filePaths[0]
        };
    }

    if (command === 'pickSessionFolder') {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            defaultPath: getImportDefaultPath()
        });

        if (result.canceled || !result.filePaths?.[0]) {
            return { canceled: true };
        }

        return {
            canceled: false,
            folderPath: result.filePaths[0]
        };
    }

    if (command === 'readJsonFile') {
        const { filePath } = args || {};
        if (!filePath) {
            throw new Error('File path is required.');
        }

        if (!fs.existsSync(filePath)) {
            throw new Error(`File does not exist: ${filePath}`);
        }

        return {
            filePath,
            fileName: path.basename(filePath),
            content: fs.readFileSync(filePath, 'utf8')
        };
    }

    if (command === 'readSessionFolder') {
        const { folderPath } = args || {};
        if (!folderPath) {
            throw new Error('Folder path is required.');
        }

        if (!fs.existsSync(folderPath)) {
            throw new Error(`Folder does not exist: ${folderPath}`);
        }

        const files = collectLegacyImportFiles(folderPath).map(entry => ({
            ...entry,
            content: fs.readFileSync(entry.path, 'utf8')
        }));

        return {
            folderPath,
            files
        };
    }

    throw new Error(`Unknown legacy import command: ${command}`);
});

// SYSTEM OPERATIONS HANDLER (Shell Commands)
// ==========================================
ipcMain.handle('sys-ops', async (event, command, args) => {
    if (command === 'runCommand') {
        const { cwd, cmd } = args;

        if (!fs.existsSync(cwd)) {
            return { exitCode: 1, stdout: '', stderr: `Directory not found: ${cwd}` };
        }

        return new Promise((resolve) => {
            console.log(`Executing command: ${cmd} in ${cwd}`);
            exec(cmd, { cwd: cwd }, (error, stdout, stderr) => {
                resolve({
                    exitCode: error ? error.code || 1 : 0,
                    stdout: stdout || '',
                    stderr: stderr || (error ? error.message : '')
                });
            });
        });
    }
});

// ==========================================
// AI API HANDLER
// ==========================================
ipcMain.handle('ai-ops', async (event, command, args) => {
    if (command === 'generate') {
        const {
            provider,
            model,
            apiKey,
            prompt,
            userPrompt,
            systemPrompt,
            customEndpoint,
            maxTokens: userMaxTokens
        } = args || {};
        const effectivePrompt = prompt ?? userPrompt ?? '';
        const tokenLimit = userMaxTokens || 16384;

        if (!provider || typeof provider !== 'string') {
            throw new Error(`Unknown AI provider: ${provider}`);
        }

        if (!effectivePrompt.trim()) {
            throw new Error('Missing AI prompt');
        }

        // Determine the API endpoint and request format based on provider
        let url, headers, body;

        if (provider === 'openai') {
            url = 'https://api.openai.com/v1/chat/completions';
            headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            };
            body = JSON.stringify({
                model: model || 'gpt-4o',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: effectivePrompt }
                ],
                temperature: 0.3,
                max_tokens: tokenLimit
            });
        } else if (provider === 'anthropic') {
            url = 'https://api.anthropic.com/v1/messages';
            headers = {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            };
            body = JSON.stringify({
                model: model || 'claude-sonnet-4-20250514',
                max_tokens: tokenLimit,
                system: systemPrompt,
                messages: [
                    { role: 'user', content: effectivePrompt }
                ]
            });
        } else if (provider === 'google') {
            url = `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.5-flash'}:generateContent?key=${apiKey}`;
            headers = { 'Content-Type': 'application/json' };
            body = JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [{ parts: [{ text: effectivePrompt }] }],
                generationConfig: { temperature: 0.3, maxOutputTokens: tokenLimit }
            });
        } else if (provider === 'custom') {
            // Custom OpenAI-compatible endpoint
            url = customEndpoint;
            headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            };
            body = JSON.stringify({
                model: model || 'default',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: effectivePrompt }
                ],
                temperature: 0.3,
                max_tokens: tokenLimit
            });
        } else {
            throw new Error(`Unknown AI provider: ${provider}`);
        }

        console.log(`[Main] AI API Request to ${provider} (${model})`);

        // Use Node.js built-in fetch (available in Electron's Node.js >= 18)
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: body
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`AI API Error (${response.status}): ${errorText}`);
        }

        const data = await response.json();

        // Extract the generated text based on provider response format
        let generatedText = '';
        if (provider === 'openai' || provider === 'custom') {
            generatedText = data.choices?.[0]?.message?.content || '';
        } else if (provider === 'anthropic') {
            generatedText = data.content?.[0]?.text || '';
        } else if (provider === 'google') {
            generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        }

        return { success: true, generatedText: generatedText, text: generatedText };
    }
});

// Clear corrupted GPU/disk cache on startup to prevent IndexedDB failures
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

app.whenReady().then(async () => {
    // Clear stale cache that causes "Access is denied" and IndexedDB errors
    try {
        const session = require('electron').session;
        await session.defaultSession.clearCache();
        await session.defaultSession.clearStorageData({ storages: ['cachestorage'] });
        console.log('[Main] Cache cleared successfully');
    } catch (e) {
        console.warn('[Main] Cache clear warning (non-fatal):', e.message);
    }

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});


// IPC Handler Placeholders
const { runPlaywrightScript } = require('./services/playwright-runner');

ipcMain.handle('run-playwright-test', async (event, testScript) => {
    console.log('Received Playwright test request. Length:', testScript.length);
    try {
        const result = await runPlaywrightScript(testScript);
        return result;
    } catch (err) {
        return { status: 'ERROR', logs: `Internal Runner Error: ${err.message}` };
    }
});

// --- G6 PIPELINE IPC HANDLERS ---
const { execSync, execFileSync } = require('child_process');
const http = require('http');
const https = require('https');

function runGitCommand(args, cwd) {
    return execFileSync('git', args, {
        cwd: cwd || undefined,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
}

function normalizeGitAuth(auth) {
    if (!auth) return null;
    if (typeof auth === 'string') {
        const token = auth.trim();
        return token ? { type: 'token', token } : null;
    }

    if (typeof auth === 'object') {
        const token = String(auth.token || '').trim();
        if (auth.type === 'token' && token) {
            return {
                type: 'token',
                token,
                username: auth.username || 'x-access-token'
            };
        }
    }

    return null;
}

function buildAuthenticatedGitUrl(rawUrl, auth = {}) {
    const normalizedAuth = normalizeGitAuth(auth);
    const token = normalizedAuth?.type === 'token' ? String(normalizedAuth.token || '').trim() : '';
    if (!token || !/^https?:\/\//i.test(rawUrl || '')) {
        return rawUrl;
    }

    const parsed = new URL(rawUrl);
    parsed.username = normalizedAuth.username || 'x-access-token';
    parsed.password = token;
    return parsed.toString();
}

function remoteBranchExists(url, branch, auth) {
    const targetBranch = String(branch || '').trim();
    if (!url || !targetBranch) {
        return false;
    }

    const cloneUrl = buildAuthenticatedGitUrl(url, auth);
    const output = runGitCommand(['ls-remote', '--heads', cloneUrl, targetBranch]);
    return Boolean(String(output || '').trim());
}

function cloneRepositoryWithBranchPolicy({
    url,
    branch,
    auth,
    branchMissingPolicy = 'fail',
    branchBase = 'main',
    targetPath,
    createRemoteBranchIfMissing = false
}) {
    const normalizedAuth = normalizeGitAuth(auth);
    const targetBranch = String(branch || 'main').trim() || 'main';
    const baseBranch = String(branchBase || 'main').trim() || 'main';
    const missingPolicy = String(branchMissingPolicy || 'fail').trim().toLowerCase();
    const cloneUrl = buildAuthenticatedGitUrl(url, normalizedAuth);

    const branchExists = remoteBranchExists(url, targetBranch, normalizedAuth);
    if (branchExists) {
        runGitCommand(['clone', '--branch', targetBranch, '--single-branch', cloneUrl, targetPath]);
        return {
            path: targetPath,
            branch: targetBranch,
            branchCreated: false,
            branchExists: true,
            baseBranchUsed: targetBranch
        };
    }

    if (missingPolicy !== 'create') {
        throw new Error(`Remote branch ${targetBranch} not found in origin`);
    }

    if (!remoteBranchExists(url, baseBranch, normalizedAuth)) {
        throw new Error(`Cannot create branch ${targetBranch} because base branch ${baseBranch} does not exist in origin`);
    }

    runGitCommand(['clone', '--branch', baseBranch, '--single-branch', cloneUrl, targetPath]);
    runGitCommand(['checkout', '-b', targetBranch], targetPath);

    if (createRemoteBranchIfMissing) {
        if (!normalizedAuth?.token) {
            throw new Error(`Remote branch ${targetBranch} does not exist. Creating it requires a Personal Access Token or authenticated remote.`);
        }
        runGitCommand(['push', '--set-upstream', 'origin', targetBranch], targetPath);
    }

    return {
        path: targetPath,
        branch: targetBranch,
        branchCreated: true,
        branchExists: false,
        baseBranchUsed: baseBranch
    };
}

// 1. Zipping Log Collectors
ipcMain.handle('zip-files', async (event, args) => {
    return new Promise((resolve, reject) => {
        try {
            const archiver = require('archiver');
            const { files, outputPath } = args;
            
            // Ensure dir exists
            const outDir = path.dirname(outputPath);
            if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
            
            const output = fs.createWriteStream(outputPath);
            const archive = archiver('zip', { zlib: { level: 9 } });
            
            output.on('close', () => resolve({ success: true, path: outputPath, bytes: archive.pointer() }));
            archive.on('warning', err => console.warn('[Zip warning]', err));
            archive.on('error', err => { throw err; });
            
            archive.pipe(output);
            
            // Files is an array of { filename, content }
            if (Array.isArray(files)) {
                files.forEach(f => archive.append(f.content, { name: f.filename }));
            }
            
            archive.finalize();
        } catch (e) {
            console.error('[Zip Error]', e);
            reject(e.message);
        }
    });
});

// 2. Fast-Path HTTP Request (bypasses CORS)
ipcMain.handle('http-request', async (event, args) => {
    return new Promise((resolve, reject) => {
        try {
            const { url, method = 'GET', headers = {}, body, timeout = 30000 } = args;
            const parsedUrl = new URL(url);
            const client = parsedUrl.protocol === 'https:' ? https : http;
            
            const options = {
                method,
                headers,
                timeout
            };
            
            const req = client.request(parsedUrl, options, (res) => {
                let responseBody = '';
                res.on('data', chunk => responseBody += chunk);
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: responseBody
                    });
                });
            });
            
            req.on('error', err => reject({ success: false, error: err.message }));
            req.on('timeout', () => { req.destroy(); reject({ success: false, error: 'Request timed out' }); });
            
            if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
            req.end();
        } catch (e) {
            reject({ success: false, error: e.message });
        }
    });
});

// 3. Git & Push Deploy Actions
ipcMain.handle('git-clone-to-temp', async (event, args) => {
    const { url, branch, auth, branchMissingPolicy, branchBase } = args;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-git-'));
    try {
        const tempClonePath = path.join(tempDir, 'repo');
        const result = cloneRepositoryWithBranchPolicy({
            url,
            branch,
            auth,
            branchMissingPolicy,
            branchBase,
            targetPath: tempClonePath,
            createRemoteBranchIfMissing: false
        });
        return {
            path: tempClonePath,
            cleanupPath: tempDir,
            branch: result.branch,
            branchCreated: result.branchCreated,
            baseBranchUsed: result.baseBranchUsed
        };
    } catch (e) {
        throw new Error(`Git clone failed: ${e.message}`);
    }
});

ipcMain.handle('git-commit-and-push', async (event, args) => {
    const { dir, message, branch, auth, remoteUrl } = args;
    try {
        const targetBranch = branch || 'main';
        runGitCommand(['config', 'user.name', 'LVX Machina'], dir);
        runGitCommand(['config', 'user.email', 'lvx-machina@local.invalid'], dir);

        if (remoteUrl) {
            const authenticatedRemoteUrl = buildAuthenticatedGitUrl(remoteUrl, auth);
            runGitCommand(['remote', 'set-url', 'origin', authenticatedRemoteUrl], dir);
        }

        runGitCommand(['add', '.'], dir);
        const statusOutput = runGitCommand(['status', '--porcelain'], dir);
        if (!statusOutput) {
            return { pushed: false, reason: 'No changes to commit' };
        }

        runGitCommand(['commit', '-m', message || 'Deploy from LVX-Machina'], dir);
        const commitSha = runGitCommand(['rev-parse', 'HEAD'], dir);
        runGitCommand(['push', 'origin', `HEAD:${targetBranch}`], dir);

        return {
            pushed: true,
            branch: targetBranch,
            commitSha
        };
    } catch (e) {
        throw new Error(`Git push failed: ${e.message}`);
    }
});

ipcMain.handle('remove-temp-directory', async (event, dir) => {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
        return true;
    } catch (e) {
        return false;
    }
});

ipcMain.handle('run-shell-command', async (event, args) => {
    try {
        const output = execSync(args.command, { encoding: 'utf-8', timeout: 60000 });
        return output;
    } catch (e) {
        throw new Error(`Command failed: ${e.message}`);
    }
});
