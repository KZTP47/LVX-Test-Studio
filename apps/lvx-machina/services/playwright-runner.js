const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Executes a raw Playwright script text by saving it to a temp file and running it with Node.
 * Returns a promise that resolves with the execution logs and status.
 * 
 * @param {string} scriptContent - The JavaScript code content to execute.
 * @returns {Promise<{status: string, logs: string}>}
 */
async function runPlaywrightScript(scriptContent) {
    return new Promise((resolve, reject) => {
        // 1. Create a temporary file in the PROJECT directory (not system temp) 
        // to ensure require('playwright') finds the node_modules in this project.
        const tmpDir = path.join(process.cwd(), '.temp_exec');
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        const tmpFile = path.join(tmpDir, `pw_test_${Date.now()}.js`);

        // 2. Wrap script if necessary? 
        // For now, assume the user writes a full script or valid async block.
        // We might want to inject basic imports if missing, but let's trust the user or provide a template later.
        // A common issue is top-level await. We can wrap in an IIFE just in case if it's not a module.
        // But for Playwright default is often standard script. Let's just write raw first.

        fs.writeFileSync(tmpFile, scriptContent, 'utf8');

        console.log(`[Playwright Runner] Executing temp file: ${tmpFile}`);

        // 3. Execute via Node
        // We assume 'playwright' is installed in the project's node_modules, 
        // so running 'node tmpFile' from the project root (where node_modules is) should find it
        // IF we set the CWD correctly.
        exec(`node "${tmpFile}"`, { cwd: process.cwd() }, (error, stdout, stderr) => {
            // Cleanup temp file (optional, maybe keep for debug?)
            try { fs.unlinkSync(tmpFile); } catch (e) { }

            const logs = `--- STDOUT ---\n${stdout}\n\n--- STDERR ---\n${stderr}`;

            if (error) {
                console.error(`[Playwright Runner] Error: ${error.message}`);
                resolve({
                    status: 'FAILURE',
                    logs: logs + `\n\nEXIT ERROR: ${error.message}`
                });
            } else {
                console.log(`[Playwright Runner] Success`);
                resolve({
                    status: 'SUCCESS',
                    logs: logs
                });
            }
        });
    });
}

module.exports = { runPlaywrightScript };
