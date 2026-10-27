const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Electron supplies Node in installed applications; launch CWD and PATH are irrelevant.
async function runPlaywrightScript(scriptContent) {
    if (typeof scriptContent !== 'string' || !scriptContent.trim()) {
        return { status: 'ERROR', logs: 'A nonempty Playwright script is required.' };
    }
    let directory;
    try {
        const playwrightEntry = require.resolve('playwright');
        const moduleRoot = path.dirname(path.dirname(playwrightEntry));
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-playwright-'));
        const filename = path.join(directory, 'test.cjs');
        fs.writeFileSync(filename, scriptContent, 'utf8');
        const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: moduleRoot };
        const bundledBrowsers = process.resourcesPath && path.join(process.resourcesPath, 'playwright-browsers');
        if (!env.PLAYWRIGHT_BROWSERS_PATH && bundledBrowsers && fs.existsSync(bundledBrowsers)) env.PLAYWRIGHT_BROWSERS_PATH = bundledBrowsers;
        const developmentBrowsers = path.resolve(__dirname, '../.external/playwright-browsers');
        if (!env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(developmentBrowsers)) env.PLAYWRIGHT_BROWSERS_PATH = developmentBrowsers;
        return await new Promise(resolve => {
            require('./legacy-processes.cjs').track(execFile(process.execPath, [filename], {
                cwd: directory, env, windowsHide: true, timeout: 0, maxBuffer: Infinity
            }, (error, stdout, stderr) => resolve({
                status: error ? (typeof error.code === 'number' ? 'FAILURE' : 'ERROR') : 'SUCCESS',
                logs: `--- STDOUT ---\n${stdout || ''}\n\n--- STDERR ---\n${stderr || ''}${error ? `\nEXIT ERROR: ${error.message}` : ''}`
            })));
        });
    } catch (error) {
        return { status: 'ERROR', logs: `Playwright runtime unavailable: ${error.message}` };
    } finally {
        if (directory) fs.rmSync(directory, { recursive: true, force: true });
    }
}
module.exports = { runPlaywrightScript };
