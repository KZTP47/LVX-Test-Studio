const fs = require('fs');
const path = require('path');

const TestRunner = {
    passed: 0,
    failed: 0,
    test(name, fn) {
        try {
            fn();
            this.passed += 1;
            console.log(`PASS ${name}`);
        } catch (error) {
            this.failed += 1;
            console.error(`FAIL ${name}: ${error.message}`);
        }
    },
    asyncTest(name, fn) {
        return Promise.resolve()
            .then(fn)
            .then(() => {
                this.passed += 1;
                console.log(`PASS ${name}`);
            })
            .catch(error => {
                this.failed += 1;
                console.error(`FAIL ${name}: ${error.message}`);
            });
    },
    assertEqual(actual, expected, message = '') {
        if (actual !== expected) {
            throw new Error(`${message} Expected ${expected}, got ${actual}`);
        }
    },
    assert(condition, message) {
        if (!condition) {
            throw new Error(message);
        }
    }
};

function createMockElement() {
    return {
        innerHTML: '',
        textContent: '',
        style: {},
        children: [],
        classList: {
            add() { },
            remove() { }
        },
        appendChild(child) {
            this.children.push(child);
            return child;
        },
        remove() { },
        querySelector() { return createMockElement(); },
        querySelectorAll() { return []; },
        addEventListener() { },
        removeEventListener() { },
        setAttribute() { },
        getBoundingClientRect() {
            return { left: 0, top: 0, width: 1200, height: 800 };
        }
    };
}

function createLocalStorage() {
    const storage = {};
    return {
        storage,
        getItem(key) {
            return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null;
        },
        setItem(key, value) {
            storage[key] = String(value);
        },
        removeItem(key) {
            delete storage[key];
        }
    };
}

function createMockDOM() {
    global.document = {
        getElementById() {
            return createMockElement();
        },
        createElement() {
            return createMockElement();
        },
        createElementNS() {
            return createMockElement();
        },
        body: createMockElement()
    };
    global.window = global;
}

function loadVisualEditor() {
    createMockDOM();
    const visualEditorPath = path.join(__dirname, 'visual-editor.js');
    const visualEditorCode = fs.readFileSync(visualEditorPath, 'utf8');
    eval(visualEditorCode.replace('window.VisualEditor', 'global.VisualEditor').replace('window.visualEditor', '// global.visualEditor'));
    return global.VisualEditor;
}

async function runTests() {
    const VisualEditor = loadVisualEditor();

    TestRunner.test('AI Log Summary output modal should render a save button', () => {
        const editor = new VisualEditor('test-container');
        document.body.children = [];

        editor.showAILogSummaryOutput(
            { id: 'ai-node', data: { name: 'AI Log Summary' } },
            'Summary body',
            { sourceNames: ['Suite A'], providerLabel: 'Google (Gemini)' }
        );

        const modal = document.body.children[document.body.children.length - 1];
        TestRunner.assert(modal.innerHTML.includes('cfg-ai-log-output-save'), 'Save button should be rendered');
    });

    await TestRunner.asyncTest('AI Log Summary save should use configured directory paths', async () => {
        const editor = new VisualEditor('test-container');
        const writes = [];

        global.window.electronAPI = {
            fileOps: {
                writeFile: async (filePath, content) => {
                    writes.push({ filePath, content });
                    return { success: true };
                }
            }
        };

        const node = {
            id: 'ai-node',
            data: {
                name: 'AI Log Summary',
                savePath: 'C:\\Logs\\AI Summaries\\'
            }
        };

        const result = await editor.saveAILogSummaryToFile(node, 'Summary output', {
            providerLabel: 'Google (Gemini)',
            sourceNames: ['Suite A'],
            generatedAt: '2026-03-28T12:00:00.000Z',
            allowPicker: false,
            silent: true
        });

        TestRunner.assertEqual(result.success, true, 'Save should succeed');
        TestRunner.assert(writes.length === 1, 'One file should be written');
        TestRunner.assert(writes[0].filePath.startsWith('C:\\Logs\\AI Summaries\\'), 'Directory save path should be used');
        TestRunner.assert(/ai-log-summary-2026-03-28t12-00-00z\.md$/i.test(writes[0].filePath), 'Generated markdown filename should be appended');
        TestRunner.assert(writes[0].content.includes('# AI Log Summary'), 'Saved content should include a heading');
        TestRunner.assertEqual(node.data.lastSummaryPath, writes[0].filePath, 'Node should track the last saved path');
    });

    await TestRunner.asyncTest('AI Log Summary save should use save dialog when no path is configured', async () => {
        const editor = new VisualEditor('test-container');
        let picked = false;
        let writePath = '';

        global.window.electronAPI = {
            fileOps: {
                pickSaveFile: async (options) => {
                    picked = true;
                    TestRunner.assert(options.defaultFileName.includes('ai-log-summary'), 'Picker should receive a default file name');
                    return {
                        canceled: false,
                        filePath: 'C:\\Exports\\manual-summary.md'
                    };
                },
                writeFile: async (filePath) => {
                    writePath = filePath;
                    return { success: true };
                }
            }
        };

        const result = await editor.saveAILogSummaryToFile(
            { id: 'ai-node', data: { name: 'AI Log Summary', savePath: '' } },
            'Summary output',
            {
                providerLabel: 'OpenAI',
                sourceNames: ['Suite A'],
                generatedAt: '2026-03-28T12:00:00.000Z',
                silent: true
            }
        );

        TestRunner.assertEqual(picked, true, 'Save dialog should be opened');
        TestRunner.assertEqual(result.success, true, 'Manual save should succeed');
        TestRunner.assertEqual(writePath, 'C:\\Exports\\manual-summary.md', 'Picked save path should be written');
    });

    TestRunner.test('secureConfig should encrypt AI Log Summary API keys inside pipelines', () => {
        const localStorage = createLocalStorage();
        global.localStorage = localStorage;
        global.window.electronAPI = {
            secureStorage: {
                isEncryptionAvailable: () => true,
                encryptString: (text) => Buffer.from(`enc:${text}`, 'utf8').toString('base64'),
                decryptString: (cipherText) => Buffer.from(cipherText, 'base64').toString('utf8').replace(/^enc:/, '')
            }
        };

        delete require.cache[require.resolve('./secure-config.js')];
        const secureConfig = require('./secure-config.js');

        secureConfig.saveConfig('lvx_pipelines', [
            {
                id: 'pipeline-1',
                type: 'graph',
                nodes: [
                    {
                        id: 'ai-node',
                        type: 'ai-log-summary',
                        data: {
                            apiKey: 'secret-key',
                            provider: 'google'
                        }
                    }
                ]
            }
        ]);

        const raw = JSON.parse(localStorage.getItem('lvx_pipelines'));
        const storedApiKey = raw[0].nodes[0].data.apiKey;
        TestRunner.assert(storedApiKey.__lvxEncrypted === true, 'API key should be stored encrypted');

        const loaded = secureConfig.loadConfig('lvx_pipelines', []);
        TestRunner.assertEqual(loaded[0].nodes[0].data.apiKey, 'secret-key', 'API key should decrypt on load');
    });

    console.log(`Tests: ${TestRunner.passed + TestRunner.failed} | Passed: ${TestRunner.passed} | Failed: ${TestRunner.failed}`);
    return TestRunner.failed === 0;
}

runTests().then(success => {
    process.exit(success ? 0 : 1);
});
