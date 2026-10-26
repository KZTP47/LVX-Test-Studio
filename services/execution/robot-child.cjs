'use strict';
// Trusted Robot code runs in Python; page content runs in a separate Chromium
// process. The page receives neither Electron APIs nor the driver bearer token.
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createProtocol } = require('./python-protocol.cjs');
const { pythonEnvironment } = require('./python-environment.cjs');
const KEYWORDS = new Set(['Click Element', 'Input Text', 'Element Should Contain', 'Element Should Be Visible', 'Element Should Exist', 'Page Should Contain', 'Wait For Element', 'Wait Until Element Is Visible', 'Get Text', 'Get Value', 'Open Browser', 'Go To', 'Close Browser', 'Select From List', 'Check Checkbox', 'Uncheck Checkbox']);
function executable(config) {
    for (const root of [process.env.PLAYWRIGHT_BROWSERS_PATH, config.resourcePath && path.join(config.resourcePath, 'playwright-browsers'), path.resolve(__dirname, '../../.external/playwright-browsers')].filter(Boolean)) {
        if (!fs.existsSync(root)) continue;
        for (const directory of fs.readdirSync(root).filter(name => /^chromium-\d+$/.test(name)).sort().reverse()) for (const file of ['chrome-win64/chrome.exe', 'chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
            const candidate = path.join(root, directory, file); if (fs.existsSync(candidate)) return candidate;
        }
    }
    return undefined;
}
function nativeFile(name) { return path.join(__dirname, name).replace(/\.asar([\\/])/, '.asar.unpacked$1'); }
async function createDriver(config) {
    const token = crypto.randomBytes(32).toString('base64url');
    const origins = new Set();
    for (const origin of config.allowedOrigins || []) origins.add(new URL(origin).origin);
    let browser, context, page, opening;
    function authorize(url) {
        const target = new URL(url);
        if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('Browser navigation requires an HTTP(S) URL without embedded credentials.');
        origins.add(target.origin); return target.href;
    }
    async function ensurePage() {
        if (page) return page;
        if (!opening) opening = (async () => {
            const playwright = require('playwright');
            browser = await playwright.chromium.launch({ headless: require('./browser-mode.cjs').browserMode(config.browserMode)==='headless', executablePath: executable(config) });
            context = await browser.newContext({ serviceWorkers: 'block' });
            await context.route('**/*', route => {
                try { const url = new URL(route.request().url()); if (['about:', 'data:', 'blob:'].includes(url.protocol) || origins.has(url.origin)) return route.continue(); } catch {}
                return route.abort('blockedbyclient');
            });
            if (context.routeWebSocket) await context.routeWebSocket('**/*', socket => socket.close());
            page = await context.newPage(); page.setDefaultTimeout(5000);
            if (config.websiteUrl) await page.goto(authorize(config.websiteUrl), { waitUntil: 'domcontentloaded' });
            else if (typeof (config.websiteHTML ?? config.websiteHtml) === 'string') await page.setContent(config.websiteHTML ?? config.websiteHtml);
            return page;
        })();
        return opening;
    }
    async function keyword(name, args) {
        if (!KEYWORDS.has(name)) throw new Error(`Unsupported BrowserLibrary keyword: ${name}`);
        if (!Array.isArray(args) || args.length > 4 || args.some(arg => !['string', 'number', 'boolean'].includes(typeof arg) && arg !== null)) throw new Error('Browser keyword arguments must be scalar values.');
        if (name === 'Close Browser') { await browser?.close(); browser = context = page = opening = null; return null; }
        if (name === 'Open Browser' && args[1] && !['chrome', 'chromium', 'headlesschrome'].includes(String(args[1]).toLowerCase())) throw new Error('BrowserLibrary supports bundled Chromium only.');
        const target = await ensurePage();
        const selector = String(args[0] ?? ''), text = String(args[1] ?? '');
        if (name === 'Open Browser' || name === 'Go To') { if (selector && selector !== 'about:blank') await target.goto(authorize(selector), { waitUntil: 'domcontentloaded' }); return name === 'Open Browser' ? '1' : null; }
        if (name === 'Page Should Contain') { const actual = await target.locator('body').textContent(); if (!actual?.includes(selector)) throw new Error(`Page did not contain expected text: ${selector}`); return null; }
        const locator = target.locator(selector);
        if (name === 'Click Element') return locator.click();
        if (name === 'Input Text') return locator.fill(text);
        if (name === 'Element Should Be Visible') { if (!await locator.isVisible()) throw new Error(`Element is not visible: ${selector}`); return null; }
        if (name === 'Element Should Exist') { if (!await locator.count()) throw new Error(`Element does not exist: ${selector}`); return null; }
        if (name === 'Element Should Contain') { if (!(await locator.textContent())?.includes(text)) throw new Error(`Element ${selector} did not contain expected text: ${text}`); return null; }
        if (name === 'Get Text') return locator.textContent();
        if (name === 'Get Value') return locator.inputValue();
        if (name === 'Select From List') return locator.selectOption(text);
        if (name === 'Check Checkbox') return locator.check();
        if (name === 'Uncheck Checkbox') return locator.uncheck();
        const seconds = args[1] === undefined ? 5 : Number(args[1]);
        if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60) throw new Error('Wait timeout must be 0–60 seconds.');
        return locator.waitFor({ state: name === 'Wait Until Element Is Visible' ? 'visible' : 'attached', timeout: Math.max(1, seconds * 1000) });
    }
    const server = http.createServer(async (request, response) => {
        response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
        if (request.method !== 'POST' || request.url !== '/keyword' || request.headers.origin || request.headers.authorization !== `Bearer ${token}`) { response.writeHead(403); response.end('{"error":"Driver request denied"}'); return; }
        try {
            let bytes = 0, chunks = [];
            for await (const chunk of request) { bytes += chunk.length; if (bytes > 1024 * 1024) throw new Error('Keyword payload exceeded 1 MiB.'); chunks.push(chunk); }
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const result = await keyword(payload.name, payload.args || []);
            response.writeHead(200); response.end(JSON.stringify({ value: result ?? null }));
        } catch (error) { response.writeHead(400); response.end(JSON.stringify({ error: error.message })); }
    });
    server.requestTimeout = 65000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return { endpoint: `http://127.0.0.1:${server.address().port}/keyword`, token, async close() { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
async function run(config) {
    let driver, result, protocolError, exit;
    try {
        driver = await createDriver(config);
        const python = spawn(config.python || 'python', ['-u', nativeFile('robot-child.py'), config.tempDir], { cwd: process.cwd(), env: pythonEnvironment({ resourcePath: config.resourcePath }), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        const protocol = createProtocol({ onOutput: (kind, text) => process[kind].write(text), onResult: value => { result = value; }, onError: error => { protocolError = error; } });
        python.stdout.on('data', chunk => protocol.push(chunk)); python.stderr.on('data', chunk => process.stderr.write(chunk));
        python.stdin.on('error', () => {}); python.stdin.end(JSON.stringify({ ...config, driver: { endpoint: driver.endpoint, token: driver.token } }));
        exit = await new Promise((resolve, reject) => { python.once('error', reject); python.once('close', code => resolve(code)); }); protocol.end();
        if (protocolError || !result) throw protocolError || new Error('Robot stopped without a native result.');
        if (exit !== 0 && result.status === 'SUCCESS') throw new Error('Robot exited unsuccessfully despite its result.');
    } catch (error) { result = { status: 'ERROR', total: 0, passed: 0, failed: 0, errors: 1, error: error.message }; }
    finally { await driver?.close(); }
    process.send?.({ type: 'result', result }, () => process.exit(result.status === 'SUCCESS' ? 0 : 1));
}
if (require.main === module) process.once('message', config => { void run(config); });
module.exports = { createDriver, KEYWORDS };
