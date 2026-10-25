const { app, BrowserWindow, ipcMain, dialog, safeStorage, session } = require('electron');
const path = require('path');
const { exec, execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

// const __filename = fileURLToPath(import.meta.url); // Not needed in CommonJS
// const __dirname = path.dirname(__filename); // __dirname is global in CommonJS

if (process.env.LVX_TEST_USER_DATA) app.setPath('userData', path.resolve(process.env.LVX_TEST_USER_DATA));
const studioHost = require('./services/studio-host.cjs').createStudioHost({app,BrowserWindow,ipcMain,dialog,safeStorage,session});
studioHost.register();

const createWindow = () => {
    const win = new BrowserWindow({
        icon: path.join(__dirname, 'assets/icons/lvx-test-studio.png'),
        show: process.env.LVX_TEST_HIDDEN !== '1',
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    win.loadFile(path.join(__dirname, 'index.html'));
    // win.webContents.openDevTools(); // Optional: Open DevTools
};

// ==========================================
// GIT OPERATIONS HANDLER
// ==========================================
ipcMain.handle('git-ops', async (event, command, args) => {
    studioHost.sender(event);
    require('./services/security').validatePayload(args||{});
    if (command !== 'check') await studioHost.trusted();
    console.log('[Main] Git Ops Request:', command);

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
        let { url, branch, auth } = args;
        if(typeof auth==='string'&&auth.startsWith('secret:'))auth=studioHost.resolveSecret(auth);
        if (!url) throw new Error('Repo URL is required');

        // created clean path
        const repoName = url.split('/').pop().replace('.git', '').replace(/[^a-zA-Z0-9-_]/g, '');
        const parentDir = path.join(studioHost.workspaceRoot, '.lvx', 'repositories');
        fs.mkdirSync(parentDir, { recursive: true });
        const targetPath = fs.mkdtempSync(path.join(parentDir, (repoName || 'repository') + '_'));

        return new Promise((resolve, reject) => {
            let cloneUrl = url;
            if (auth) {
                if (cloneUrl.startsWith('https://')) {
                    cloneUrl = cloneUrl.replace('https://', `https://${auth}@`);
                }
            }

            const cloneArgs = ['clone', ...(branch ? ['-b', String(branch)] : []), '--', cloneUrl, targetPath];
            console.log('[Main] Cloning repository (credentials omitted from log)');
            execFile('git', cloneArgs, { windowsHide: true,timeout:120000,maxBuffer:16*1024*1024 }, (err, stdout, stderr) => {
                const safe=value=>studioHost.redact(auth?String(value||'').split(auth).join('[REDACTED]'):String(value||''));
                if (err) {
                    console.error('[Main] Clone Error:', safe(stderr));
                    reject(new Error(safe(stderr || err.message)));
                } else {
                    console.log('[Main] Clone Success:', targetPath);
                    resolve({
                        success: true,
                        path: targetPath,
                        logs: safe(stdout + '\n' + stderr)
                    });
                }
            });
        });
    }
});

// ==========================================
// FILE OPERATIONS HANDLER
// ==========================================
ipcMain.handle('file-ops', async (event, command, args) => {
    studioHost.sender(event);
    require('./services/security').validatePayload(args);
    await studioHost.trusted();
    if (command === 'listFiles') {
        const { dirPath, extension } = args;
        studioHost.scoped(dirPath, {mustExist:true,directory:true});

        if (!fs.existsSync(dirPath)) throw new Error('Directory does not exist');

        const getAllFiles = (dir, ext, fileList = []) => {
            const files = fs.readdirSync(dir);
            files.forEach(file => {
                const filePath = path.join(dir, file);
                studioHost.scoped(filePath, {mustExist:true});
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
        studioHost.scoped(filePath, {mustExist:true});
        const content = fs.readFileSync(filePath, 'utf-8');
        return content;
    }

    if (command === 'writeFile') {
        const { filePath, content } = args;
        studioHost.scoped(filePath, {mustExist:false});
        await studioHost.checkImported({code:content});
        fs.writeFileSync(filePath, content, 'utf-8');
        return { success: true };
    }

});

// SYSTEM OPERATIONS HANDLER (Shell Commands)
// ==========================================
ipcMain.handle('sys-ops', async (event, command, args) => {
    studioHost.sender(event);
    require('./services/security').validatePayload(args);
    await studioHost.trusted();
    if (command === 'runCommand') {
        const { cwd, cmd } = args;
        studioHost.scoped(cwd, {mustExist:true,directory:true});
        if(typeof cmd !== 'string' || !cmd.trim() || cmd.length > 32768) throw new Error('Command is missing or too long.');
        await studioHost.checkImported({command:cmd});

        if (!fs.existsSync(cwd)) {
            return { exitCode: 1, stdout: '', stderr: `Directory not found: ${cwd}` };
        }

        return new Promise((resolve) => {
            console.log('Executing an authorized workspace command.');
            exec(cmd, { cwd: cwd, windowsHide:true,timeout:120000,maxBuffer:16*1024*1024 }, (error, stdout, stderr) => {
                resolve({
                    exitCode: error ? error.code || 1 : 0,
                    stdout: studioHost.redact(stdout || ''),
                    stderr: studioHost.redact(stderr || (error ? error.message : ''))
                });
            });
        });
    }
});

// ==========================================
// AI API HANDLER
// ==========================================
ipcMain.handle('ai-ops', async (event, command, args = {}) => {
    try {
        studioHost.sender(event);
        await studioHost.trusted();
        require('./services/security').validatePayload(args);
        if (command !== 'generate') throw Error('Unknown AI operation.');
        return await require('./services/ai-provider.cjs').requestAI(args, {resolveSecret: ref => studioHost.resolveSecret(ref), redact: value => studioHost.redact(value)});
    } catch (error) { throw Error(studioHost.redact(error.message)); }
});

// Clear corrupted GPU/disk cache on startup to prevent IndexedDB failures
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

app.whenReady().then(async () => {
    await studioHost.restoreWorkspace();
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
let studioClosing=false;
app.on('browser-window-created',(_event,win)=>{
    win.on('closed',()=>setImmediate(()=>{
        const mainWindows=BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()&&!w.webContents.isDestroyed()&&w.webContents.getURL().split('#')[0]===require('node:url').pathToFileURL(path.join(__dirname,'index.html')).href);
        if(!mainWindows.length&&!studioClosing&&process.platform!=='darwin')app.quit();
    }));
});
app.on('before-quit',event=>{
    if(studioClosing)return;
    event.preventDefault();studioClosing=true;
    studioHost.close().catch(()=>{}).finally(()=>app.quit());
});

// IPC Handler Placeholders
const { runPlaywrightScript } = require('./services/playwright-runner');

ipcMain.handle('run-playwright-test', async (event, testScript) => {
    studioHost.sender(event);
    await studioHost.trusted();
    await studioHost.checkImported({code:testScript});
    if(typeof testScript !== 'string' || testScript.length > 1024*1024) throw new Error('Invalid Playwright script.');
    console.log('Received Playwright test request. Length:', testScript.length);
    try {
        const result = await runPlaywrightScript(testScript);
        return result;
    } catch (err) {
        return { status: 'ERROR', logs: `Internal Runner Error: ${err.message}` };
    }
});
