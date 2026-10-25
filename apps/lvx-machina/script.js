
// ============================================
// EXECUTION ENGINE
// ============================================

let pyodideInstance = null;
let pyodideLoadPromise = null;
let robotFrameworkInstalled = false;
let executionConfig = null;

// Monaco Editor instance
let currentMonacoEditor = null;
let suiteEditorInitToken = 0;

// ============================================
// INPUT MODAL (Prompt Replacement)
// ============================================

let currentInputCallback = null;

function getSecureConfigApi() {
    if (typeof window !== 'undefined' && window.secureConfig) {
        return window.secureConfig;
    }

    return {
        loadConfig: (storageKey, defaultValue = null) => {
            try {
                const raw = localStorage.getItem(storageKey);
                return raw ? JSON.parse(raw) : defaultValue;
            } catch (error) {
                return defaultValue;
            }
        },
        saveConfig: (storageKey, value) => {
            localStorage.setItem(storageKey, JSON.stringify(value));
            return true;
        },
        clearConfig: (storageKey) => localStorage.removeItem(storageKey)
    };
}

function getMockRuntimeApi() {
    if (typeof window !== 'undefined' && window.mockRuntime) {
        return window.mockRuntime;
    }

    return {
        buildSuiteExecutionPlan: (_suite, inputs = {}) => ({
            baseContextVariables: inputs && typeof inputs === 'object' ? { ...inputs } : {},
            beforeDelayMs: 0,
            afterDelayMs: 0,
            iterations: [],
            hasFileIterations: false
        }),
        delay: () => Promise.resolve(),
        resolveTemplateVariables: (text) => String(text || '')
    };
}

async function initializeStorageManager() {
    if (typeof window === 'undefined' || !window.storageManager || typeof window.storageManager.ensureReady !== 'function') {
        return false;
    }

    try {
        await window.storageManager.ensureReady();
        let cleanupSummary = null;
        if (typeof window.storageManager.enforceRetentionPolicies === 'function') {
            cleanupSummary = await window.storageManager.enforceRetentionPolicies();
        }

        if (
            window.electronAPI?.sessionExports?.cleanup &&
            typeof window.storageManager.loadStoragePreferences === 'function'
        ) {
            const sessionCleanup = await window.electronAPI.sessionExports.cleanup(
                window.storageManager.loadStoragePreferences()
            );

            cleanupSummary = {
                ...(cleanupSummary || {}),
                sessionExports: sessionCleanup,
                deletedCount: (cleanupSummary?.deletedCount || 0) + (sessionCleanup?.deletedCount || 0)
            };
            if (cleanupSummary?.warningThresholdExceeded && typeof showMessage === 'function') {
                const estimate = cleanupSummary.estimate;
                const used = estimate?.used ? formatStorageStatusBytes(estimate.used) : 'unknown usage';
                showMessage(`Storage is getting full (${cleanupSummary.estimate?.percentUsed || 'n/a'}%, ${used}). Open Dashboard → Storage to review cleanup settings.`, 'info');
            }
        }
        await refreshStorageStatusDisplay(cleanupSummary);
        return true;
    } catch (error) {
        console.warn('[StorageManager] Falling back to legacy local storage:', error);
        return false;
    }
}

function formatStorageStatusBytes(bytes) {
    const numeric = Number(bytes) || 0;
    if (numeric < 1024) return `${numeric} B`;

    const units = ['KB', 'MB', 'GB'];
    let value = numeric / 1024;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function getStorageModeDisplayLabel(mode) {
    switch (mode) {
        case 'unlimited':
            return 'Keep everything';
        case 'custom':
            return 'Custom';
        default:
            return 'Smart cleanup';
    }
}

async function refreshStorageStatusDisplay(cleanupSummary = null) {
    const target = document.getElementById('storage-info');
    if (!target) return;

    const parts = [];

    if (currentStorage && typeof currentStorage.getStatusMessage === 'function') {
        parts.push(currentStorage.getStatusMessage());
    } else {
        parts.push('Storage ready');
    }

    if (window.storageManager && typeof window.storageManager.loadStoragePreferences === 'function') {
        const preferences = window.storageManager.loadStoragePreferences();
        const estimate = cleanupSummary?.estimate || await window.storageManager.getStorageEstimate();

        parts.push(`Auto-cleanup: ${getStorageModeDisplayLabel(preferences.mode)}`);

        if (estimate?.quota) {
            parts.push(`Usage: ${formatStorageStatusBytes(estimate.used)} / ${formatStorageStatusBytes(estimate.quota)} (${estimate.percentUsed}%)`);
        }

        if (window.electronAPI?.sessionExports?.getSummary) {
            try {
                const sessionSummary = cleanupSummary?.sessionExports || await window.electronAPI.sessionExports.getSummary();
                if (sessionSummary) {
                    parts.push(`Sessions: ${sessionSummary.count} export(s), ${formatStorageStatusBytes(sessionSummary.totalSizeBytes || 0)}`);
                }
            } catch (error) {
                console.warn('[StorageStatus] Failed to load session export summary:', error);
            }
        }

        if (cleanupSummary?.deletedCount) {
            parts.push(`Removed ${cleanupSummary.deletedCount} stored item(s)`);
        }
    }

    target.textContent = parts.join(' | ');
}

const THEME_STORAGE_KEY = 'lvx_theme_preference';

function getRunProgressElements() {
    return {
        container: document.getElementById('run-progress-container'),
        text: document.getElementById('run-progress-text'),
        percent: document.getElementById('run-progress-percent'),
        bar: document.getElementById('run-progress-bar')
    };
}

function resetRunProgress() {
    const { container, text, percent, bar } = getRunProgressElements();
    if (container) container.classList.add('hidden');
    if (text) text.textContent = '';
    if (percent) percent.textContent = '0%';
    if (bar) bar.style.width = '0%';
}

function updateRunProgress(current, total, label = '') {
    const { container, text, percent, bar } = getRunProgressElements();
    if (!container || !text || !percent || !bar) return;

    const safeTotal = Math.max(1, Number(total) || 1);
    const safeCurrent = Math.max(0, Math.min(Number(current) || 0, safeTotal));
    const progressPercent = Math.round((safeCurrent / safeTotal) * 100);

    container.classList.remove('hidden');
    text.textContent = label || `Running test ${safeCurrent} of ${safeTotal}...`;
    percent.textContent = `${progressPercent}%`;
    bar.style.width = `${progressPercent}%`;
}

function applyTheme(theme) {
    const normalizedTheme = theme === 'dark' ? 'dark' : 'light';
    document.body.classList.toggle('theme-dark', normalizedTheme === 'dark');
    document.body.dataset.theme = normalizedTheme;

    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (themeToggleBtn) {
        themeToggleBtn.textContent = normalizedTheme === 'dark' ? 'Light Theme' : 'Dark Theme';
    }

    try {
        localStorage.setItem(THEME_STORAGE_KEY, normalizedTheme);
    } catch (error) {
        console.warn('[Theme] Failed to persist theme preference:', error);
    }
}

function loadThemePreference() {
    try {
        return localStorage.getItem(THEME_STORAGE_KEY) || 'light';
    } catch (error) {
        return 'light';
    }
}

function toggleTheme() {
    const nextTheme = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
}

window.toggleTheme = toggleTheme;

function getDefaultExecutionConfig() {
    return {
        mode: 'real',
        javaType: 'jdoodle',
        csharpType: 'jdoodle',
        jdoodleClientId: '',
        jdoodleClientSecret: '',
        robotType: 'browser',
        robotBackendUrl: 'http://localhost:5000',
        robotApiUrl: ''
    };
}

async function buildHttpError(response, context) {
    let details = '';

    try {
        details = (await response.text()).trim();
    } catch (error) {
        details = '';
    }

    return new Error(`${context} (HTTP ${response.status}): ${details || response.statusText || 'Unknown error'}`);
}

async function parseJsonResponse(response, context) {
    try {
        return await response.json();
    } catch (error) {
        throw new Error(`${context}: backend returned invalid JSON.`);
    }
}

function notifyFetchFailure(context, error) {
    if (typeof showMessage !== 'function') return;

    const message = error?.message || String(error);
    showMessage(message.startsWith(context) ? message : `${context}: ${message}`, 'error');
}

function showInputModal(title, defaultValue, callback) {
    console.log("Showing Input Modal:", title, defaultValue);
    document.getElementById('input-modal-title').textContent = title;
    const input = document.getElementById('input-modal-value');
    input.value = defaultValue || '';
    currentInputCallback = callback;
    const modal = document.getElementById('input-modal');
    modal.classList.remove('hidden');
    console.log("Modal classes after remove hidden:", modal.className);
    input.focus();
}

function closeInputModal() {
    document.getElementById('input-modal').classList.add('hidden');
    currentInputCallback = null;
}

function handleInputModalSubmit(event) {
    event.preventDefault();
    const value = document.getElementById('input-modal-value').value;
    if (currentInputCallback) {
        currentInputCallback(value);
    }
    closeInputModal();
}

// Make global
window.showInputModal = showInputModal;

// ============================================
// FEATURE 2: TEST ORGANIZATION VARIABLES
// ============================================

// Filter state
let suiteFilters = {
    searchText: '',
    tagFilter: '',
    languageFilter: '',
    sortOption: 'dateModified'
};

// Tag management
let currentEditTags = [];

// Bulk operations
let bulkModeActive = false;
let selectedSuites = new Set();


async function initializePyodide() {
    if (pyodideInstance) return pyodideInstance;
    if (pyodideLoadPromise) return pyodideLoadPromise;

    try {
        pyodideLoadPromise = loadPyodide({
            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.24.1/full/"
        });

        console.log("Loading Pyodide...");
        pyodideInstance = await pyodideLoadPromise;
        console.log("Pyodide loaded successfully");
        return pyodideInstance;
    } catch (error) {
        pyodideInstance = null;
        pyodideLoadPromise = null;
        console.error("Failed to load Pyodide:", error);
        throw error;
    }
}

async function installRobotFramework() {
    if (robotFrameworkInstalled) return true;

    try {
        const pyodide = await initializePyodide();

        showMessage('Installing Robot Framework... This may take 10-15 seconds', 'info');

        // Install Robot Framework via micropip
        await pyodide.loadPackage('micropip');
        const micropip = pyodide.pyimport('micropip');
        await micropip.install('robotframework');

        // Create custom BrowserLibrary for DOM automation
        // Note: Python indentation is critical here. Using 4 spaces.
        await pyodide.runPythonAsync(`
from robot.api.deco import keyword, library
import js
from js import document, window, console
import time

@library(scope='GLOBAL')
class BrowserLibrary:
    """Custom Robot Framework library for browser automation using native DOM APIs.
    
    This library provides browser automation capabilities that work entirely in the browser
    without requiring Selenium or external drivers. It is enhanced to work with iframes.
    """
    
    ROBOT_LIBRARY_SCOPE = 'GLOBAL'
    ROBOT_LIBRARY_VERSION = '1.1.0'

    def _get_target_document_and_window(self):
        """Helper to get the document and window of the test iframe, or the main ones."""
        iframe = document.getElementById('test-website-iframe')
        if iframe and iframe.contentWindow and iframe.contentWindow.document:
            return iframe.contentWindow.document, iframe.contentWindow
        return document, window
    
    @keyword('Click Element')
    def click_element(self, selector):
        """Click an element identified by CSS selector."""
        target_doc, _ = self._get_target_document_and_window()
        element = target_doc.querySelector(selector)
        if not element:
            raise AssertionError(f"Element not found: {selector}")
        element.click()
        console.log(f"Clicked element: {selector}")
    
    @keyword('Input Text')
    def input_text(self, selector, text):
        """Input text into an element identified by CSS selector."""
        target_doc, _ = self._get_target_document_and_window()
        element = target_doc.querySelector(selector)
        if not element:
            raise AssertionError(f"Element not found: {selector}")
        element.value = text
        # Trigger input event for frameworks like React/Vue
        event = js.Event.new('input', {'bubbles': True})
        element.dispatchEvent(event)
        console.log(f"Input text into {selector}: {text}")
    
    @keyword('Element Should Be Visible')
    def element_should_be_visible(self, selector):
        """Verify that element is visible on the page."""
        target_doc, target_window = self._get_target_document_and_window()
        element = target_doc.querySelector(selector)
        if not element:
            raise AssertionError(f"Element not found: {selector}")
        
        style = target_window.getComputedStyle(element)
        if style.display == 'none' or style.visibility == 'hidden':
            raise AssertionError(f"Element is not visible: {selector}")
        console.log(f"Element is visible: {selector}")
    
    @keyword('Element Should Contain')
    def element_should_contain(self, selector, text):
        """Verify that element contains expected text."""
        target_doc, _ = self._get_target_document_and_window()
        element = target_doc.querySelector(selector)
        if not element:
            raise AssertionError(f"Element not found: {selector}")
        
        if text not in element.textContent:
            raise AssertionError(f"Element '{selector}' does not contain '{text}'. Actual: {element.textContent}")
        console.log(f"Element {selector} contains: {text}")
    
    @keyword('Get Text')
    def get_text(self, selector):
        """Get text content of an element."""
        target_doc, _ = self._get_target_document_and_window()
        element = target_doc.querySelector(selector)
        if not element:
            raise AssertionError(f"Element not found: {selector}")
        return element.textContent
    
    @keyword('Get Value')
    def get_value(self, selector):
        """Get value of an input element."""
        target_doc, _ = self._get_target_document_and_window()
        element = target_doc.querySelector(selector)
        if not element:
            raise AssertionError(f"Element not found: {selector}")
        return element.value
    
    @keyword('Page Should Contain')
    def page_should_contain(self, text):
        """Verify that page contains expected text."""
        target_doc, _ = self._get_target_document_and_window()
        if text not in target_doc.body.textContent:
            raise AssertionError(f"Page does not contain: {text}")
        console.log(f"Page contains: {text}")
    
    @keyword('Element Should Exist')
    def element_should_exist(self, selector):
        """Verify that element exists on the page."""
        target_doc, _ = self._get_target_document_and_window()
        element = target_doc.querySelector(selector)
        if not element:
            raise AssertionError(f"Element does not exist: {selector}")
        console.log(f"Element exists: {selector}")
    
    @keyword('Wait For Element')
    def wait_for_element(self, selector, timeout=5):
        """Wait for element to appear on the page."""
        start_time = time.time()
        timeout = float(timeout)
        target_doc, _ = self._get_target_document_and_window()
        
        while time.time() - start_time < timeout:
            element = target_doc.querySelector(selector)
            if element:
                console.log(f"Element found: {selector}")
                return
            time.sleep(0.1)
        
        raise AssertionError(f"Element not found after {timeout}s: {selector}")
    
    @keyword('Select From List')
    def select_from_list(self, selector, value):
        """Select option from dropdown list."""
        target_doc, _ = self._get_target_document_and_window()
        element = target_doc.querySelector(selector)
        if not element:
            raise AssertionError(f"Element not found: {selector}")
        
        element.value = value
        event = js.Event.new('change', {'bubbles': True})
        element.dispatchEvent(event)
        console.log(f"Selected '{value}' from {selector}")
    
    @keyword('Check Checkbox')
    def check_checkbox(self, selector):
        """Check a checkbox."""
        target_doc, _ = self._get_target_document_and_window()
        element = target_doc.querySelector(selector)
        if not element:
            raise AssertionError(f"Element not found: {selector}")
        element.checked = True
        event = js.Event.new('change', {'bubbles': True})
        element.dispatchEvent(event)
        console.log(f"Checked checkbox: {selector}")
    
    @keyword('Uncheck Checkbox')
    def uncheck_checkbox(self, selector):
        """Uncheck a checkbox."""
        target_doc, _ = self._get_target_document_and_window()
        element = target_doc.querySelector(selector)
        if not element:
            raise AssertionError(f"Element not found: {selector}")
        element.checked = False
        event = js.Event.new('change', {'bubbles': True})
        element.dispatchEvent(event)
        console.log(f"Unchecked checkbox: {selector}")
    
    @keyword('Get Element Count')
    def get_element_count(self, selector):
        """Get count of elements matching selector."""
        target_doc, _ = self._get_target_document_and_window()
        elements = target_doc.querySelectorAll(selector)
        return len(elements)
    
    @keyword('Execute JavaScript')
    def execute_javascript(self, script):
        """Execute JavaScript code in the context of the iframe or main window."""
        _, target_window = self._get_target_document_and_window()
        return target_window.eval(script)
`);

        robotFrameworkInstalled = true;
        showMessage('Robot Framework + BrowserLibrary installed successfully!', 'success');
        return true;
    } catch (error) {
        console.error('Failed to install Robot Framework:', error);
        showMessage('Failed to install Robot Framework: ' + error.message, 'error');
        throw error;
    }
}

function getExecutionValidationApi() {
    return window.ExecutionValidation || {
        normalizeExecutionText: (value) => String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd(),
        getSuiteValidationSource: (suite) => String(suite?.expected_output ?? '').trim(),
        getSuiteValidationMode: (language, source) => {
            const trimmed = String(source ?? '').trim();
            if (!trimmed) return 'none';
            return language === 'python' && (
                /(^|\s)assert\s+/.test(trimmed) ||
                /\bassert_output_equals\s*\(/.test(trimmed)
            ) ? 'python-assertions' : 'expected-output';
        },
        buildOutputMismatchMessage: (expected, actual) => [
            'Validation failed: actual output did not match the expected output.',
            '',
            '[EXPECTED]',
            String(expected ?? ''),
            '',
            '[ACTUAL]',
            String(actual ?? '')
        ].join('\n')
    };
}

function initializeSafeModalBackdrops() {
    if (window.ModalBackdrop && typeof window.ModalBackdrop.attachSafeBackdropClosers === 'function') {
        window.ModalBackdrop.attachSafeBackdropClosers(document);
    }
}

function scheduleSuiteModalEditorInitialization(language, initialCode = '') {
    const initToken = ++suiteEditorInitToken;

    const initializeEditor = async () => {
        const suiteModal = document.getElementById('suite-modal');
        if (!suiteModal || suiteModal.classList.contains('hidden') || initToken !== suiteEditorInitToken) return;

        try {
            currentMonacoEditor = await initializeMonaco('monaco-editor-container', language, initialCode);
            if (initToken !== suiteEditorInitToken) return;

            window.currentMonacoEditor = currentMonacoEditor;
            currentMonacoEditor?.layout?.();
            console.log(`Monaco Editor initialized for language: ${language}`);
        } catch (error) {
            if (initToken !== suiteEditorInitToken) return;
            console.error('Failed to initialize Monaco:', error);
            showMessage('Failed to load code editor', 'error');
        }
    };

    const launch = () => {
        if (initToken !== suiteEditorInitToken) return;
        initializeEditor();
    };

    if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => window.requestAnimationFrame(launch));
    } else {
        setTimeout(launch, 0);
    }
}

function prewarmSuiteEditor() {
    if (typeof window.prewarmMonacoEditor !== 'function') return;

    const triggerPrewarm = () => {
        window.prewarmMonacoEditor();
    };

    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(triggerPrewarm, { timeout: 1500 });
    } else {
        setTimeout(triggerPrewarm, 250);
    }
}

function clearPythonValidationGlobals(pyodide) {
    pyodide.runPython(`
for _validation_name in ('TEST_OUTPUT', 'TEST_STDOUT', 'TEST_STDERR', 'ARTIFACTS', 'assert_output_equals'):
    globals().pop(_validation_name, None)
`);
}

function convertPyodideArtifactsValue(value) {
    if (value == null) return {};

    if (typeof value.toJs === 'function') {
        try {
            const converted = value.toJs();
            if (converted instanceof Map) {
                return Object.fromEntries(converted);
            }
            return converted || {};
        } finally {
            if (typeof value.destroy === 'function') {
                value.destroy();
            }
        }
    }

    if (value instanceof Map) {
        return Object.fromEntries(value);
    }

    if (typeof value === 'object') {
        return value;
    }

    return {};
}

async function executePythonCode(code, inputFiles, contextVariables = {}, validationSource = '') {
    try {
        const pyodide = await initializePyodide();
        clearPythonValidationGlobals(pyodide);

        // Get Python's current working directory and write files there
        const cwd = pyodide.runPython('import os; os.getcwd()');

        // Create a virtual filesystem with input files in the working directory
        for (const file of inputFiles) {
            const filePath = `${cwd}/${file.filename}`;
            pyodide.FS.writeFile(filePath, file.content);
        }

        // Capture stdout
        let output = '';
        pyodide.runPython(`
import sys
from io import StringIO
sys.stdout = StringIO()
sys.stderr = StringIO()
`);

        // Inject Inputs
        if (contextVariables) {
            for (const [key, value] of Object.entries(contextVariables)) {
                pyodide.globals.set(key, value);
            }
        }

        // Run the code
        try {
            await pyodide.runPythonAsync(code);
        } catch (execError) {
            output = pyodide.runPython(`sys.stderr.getvalue()`) || execError.message;
            throw new Error(output);
        }

        const stdoutValue = pyodide.runPython(`sys.stdout.getvalue()`);
        const stderrValue = pyodide.runPython(`sys.stderr.getvalue()`);
        output = `${stdoutValue || ''}${stderrValue || ''}`;

        // Extract and Convert Artifacts (Map -> Object)
        let artifactsObj = {};
        try {
            const rawArtifactsValue = pyodide.globals.get('ARTIFACTS');
            artifactsObj = convertPyodideArtifactsValue(rawArtifactsValue);
        } catch (artifactError) {
            console.warn('Unable to extract ARTIFACTS from Python execution:', artifactError);
        }

        const validationApi = getExecutionValidationApi();
        const validationMode = validationApi.getSuiteValidationMode('python', validationSource);

        if (validationMode === 'python-assertions') {
            pyodide.globals.set('TEST_OUTPUT', output);
            pyodide.globals.set('TEST_STDOUT', stdoutValue || '');
            pyodide.globals.set('TEST_STDERR', stderrValue || '');
            pyodide.globals.set('ARTIFACTS', artifactsObj);

            pyodide.runPython(`
def assert_output_equals(expected):
    actual = TEST_OUTPUT.rstrip("\\n")
    expected_value = str(expected).rstrip("\\n")
    if actual != expected_value:
        raise AssertionError(f"Expected output {expected_value!r}, got {actual!r}")
`);

            try {
                await pyodide.runPythonAsync(validationSource);
                output = pyodide.runPython(`
stdout_value = sys.stdout.getvalue()
stderr_value = sys.stderr.getvalue()
stdout_value + stderr_value
`);
            } catch (validationError) {
                output = pyodide.runPython(`
stdout_value = sys.stdout.getvalue()
stderr_value = sys.stderr.getvalue()
stdout_value + stderr_value
`);
                return {
                    success: false,
                    output: output,
                    error: `Test code failed: ${validationError.message}`,
                    artifacts: artifactsObj
                };
            }
        } else if (validationMode === 'expected-output') {
            const normalizedActual = validationApi.normalizeExecutionText(output);
            const normalizedExpected = validationApi.normalizeExecutionText(validationSource);
            if (normalizedActual !== normalizedExpected) {
                return {
                    success: false,
                    output: output,
                    error: validationApi.buildOutputMismatchMessage(normalizedExpected, normalizedActual),
                    artifacts: artifactsObj
                };
            }
        }

        return {
            success: true,
            output: output,
            error: null,
            artifacts: artifactsObj
        };

    } catch (error) {
        return {
            success: false,
            output: error.output || '',
            error: error.message
        };
    }
}

async function executeRobotFrameworkBrowser(code) {
    if (!robotFrameworkInstalled) {
        await installRobotFramework();
    }

    try {
        const pyodide = await initializePyodide();

        // Create a temporary robot file in Pyodide's virtual filesystem
        const tempFileName = 'test_suite.robot';

        await pyodide.runPythonAsync(`
import sys
from io import StringIO
from robot import run

# Setup output capture
sys.stdout = StringIO()
sys.stderr = StringIO()

# Write robot file
with open('${tempFileName}', 'w') as f:
 f.write("""${code.replace(/"/g, '\\"').replace(/\n/g, '\\n')}""")

# Run robot tests with BrowserLibrary available
try:
 # Register BrowserLibrary
 from robot.libraries import STDLIBS
 # Note: BrowserLibrary is already defined globally from installation
 
 result = run('${tempFileName}', outputdir='NONE', output='NONE', log='NONE', report='NONE')
 output = sys.stdout.getvalue()
 error = sys.stderr.getvalue()
 success = (result == 0)
except Exception as e:
 output = sys.stdout.getvalue()
 error = str(e) + "\\n" + sys.stderr.getvalue()
 success = False
 result = -1
 `);

        const success = await pyodide.runPythonAsync('success');
        const output = await pyodide.runPythonAsync('output');
        const error = await pyodide.runPythonAsync('error');
        const exitCode = await pyodide.runPythonAsync('result');

        return {
            success: success,
            output: output || '(Robot Framework execution completed)',
            error: error || null,
            exitCode: exitCode
        };
    } catch (error) {
        return {
            success: false,
            output: null,
            error: error.message,
            exitCode: -1
        };
    }
}

async function executeRobotFrameworkBackend(code) {
    const backendUrl = executionConfig.robotBackendUrl || 'http://localhost:5000';

    try {
        const response = await fetch(`${backendUrl}/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code: code })
        });

        if (!response.ok) {
            throw await buildHttpError(response, 'Robot Framework backend request failed');
        }

        const result = await parseJsonResponse(response, 'Robot Framework backend request failed');

        return {
            success: result.success || false,
            output: result.output || '',
            error: result.error || null,
            exitCode: result.exitCode || -1
        };
    } catch (error) {
        notifyFetchFailure('Robot Framework backend request failed', error);
        return {
            success: false,
            output: '',
            error: `Failed to connect to backend server: ${error.message}`,
            exitCode: -1
        };
    }
}

async function executeRobotFrameworkApi(code) {
    const apiUrl = executionConfig.robotApiUrl;

    if (!apiUrl) {
        return {
            success: false,
            output: '',
            error: 'Robot Framework API URL not configured',
            exitCode: -1
        };
    }

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code: code })
        });

        if (!response.ok) {
            throw await buildHttpError(response, 'Robot Framework API request failed');
        }

        const result = await parseJsonResponse(response, 'Robot Framework API request failed');

        return {
            success: result.success || false,
            output: result.output || '',
            error: result.error || null,
            exitCode: result.exitCode || -1
        };
    } catch (error) {
        notifyFetchFailure('Robot Framework API request failed', error);
        return {
            success: false,
            output: '',
            error: `API request failed: ${error.message}`,
            exitCode: -1
        };
    }
}

async function executeJavaCode(code, inputFiles) {
    if (!executionConfig.javaType || executionConfig.javaType === 'jdoodle') {
        if (!executionConfig.jdoodleClientId || !executionConfig.jdoodleClientSecret) {
            throw new Error("JDoodle API credentials not configured. Please go to Execution Settings.");
        }

        return await executeViaJDoodle('java', code, inputFiles);
    } else {
        throw new Error("Local Java execution requires a backend server. This feature is not yet implemented.");
    }
}

async function executeCSharpCode(code, inputFiles) {
    if (!executionConfig.csharpType || executionConfig.csharpType === 'jdoodle') {
        if (!executionConfig.jdoodleClientId || !executionConfig.jdoodleClientSecret) {
            throw new Error("JDoodle API credentials not configured. Please go to Execution Settings.");
        }

        return await executeViaJDoodle('csharp', code, inputFiles);
    } else {
        throw new Error("Local C# execution requires a backend server. This feature is not yet implemented.");
    }
}

async function executeViaJDoodle(language, code, inputFiles) {
    // Prepare stdin (concatenate all input files)
    const stdin = inputFiles.map(f => f.content).join('\n');

    const payload = {
        clientId: executionConfig.jdoodleClientId,
        clientSecret: executionConfig.jdoodleClientSecret,
        script: code,
        stdin: stdin,
        language: language === 'java' ? 'java' : 'csharp',
        versionIndex: "0"
    };

    try {
        const response = await fetch('https://api.jdoodle.com/v1/execute', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw await buildHttpError(response, 'JDoodle execution request failed');
        }

        const result = await parseJsonResponse(response, 'JDoodle execution request failed');

        if (result.error) {
            return {
                success: false,
                output: result.output || '',
                error: result.error
            };
        }

        return {
            success: !result.statusCode || result.statusCode === 200,
            output: result.output || '',
            error: result.statusCode && result.statusCode !== 200 ? `Exit code: ${result.statusCode}` : null
        };
    } catch (error) {
        notifyFetchFailure('JDoodle execution request failed', error);
        return {
            success: false,
            output: '',
            error: error.message
        };
    }
}

function loadExecutionConfig() {
    executionConfig = {
        ...getDefaultExecutionConfig(),
        ...(getSecureConfigApi().loadConfig('execution_config', getDefaultExecutionConfig()) || {})
    };
    updateExecutionDisplay();
}

function updateExecutionDisplay() {
    const modeText = executionConfig.mode === 'real' ? 'Real Execution' : 'Simulated';
    const modeClass = executionConfig.mode === 'real' ? 'text-green-400' : 'text-yellow-400';
    document.getElementById('exec-mode-display').innerHTML = `<span class="${modeClass}">${modeText}</span>`;
}

function openExecutionSettingsModal() {
    // Safely set radio buttons with null checks
    const execModeRadio = document.querySelector(`input[name="execution-mode"][value="${executionConfig.mode}"]`);
    if (execModeRadio) execModeRadio.checked = true;

    const javaTypeRadio = document.querySelector(`input[name="java-execution-type"][value="${executionConfig.javaType}"]`);
    if (javaTypeRadio) javaTypeRadio.checked = true;

    const csharpTypeRadio = document.querySelector(`input[name="csharp-execution-type"][value="${executionConfig.csharpType}"]`);
    if (csharpTypeRadio) csharpTypeRadio.checked = true;

    const robotTypeRadio = document.querySelector(`input[name="robot-execution-type"][value="${executionConfig.robotType}"]`);
    if (robotTypeRadio) robotTypeRadio.checked = true;

    const jdoodleClientId = document.getElementById('jdoodle-client-id');
    if (jdoodleClientId) jdoodleClientId.value = executionConfig.jdoodleClientId || '';

    const jdoodleClientSecret = document.getElementById('jdoodle-client-secret');
    if (jdoodleClientSecret) jdoodleClientSecret.value = executionConfig.jdoodleClientSecret || '';

    const robotBackendUrl = document.getElementById('robot-backend-url');
    if (robotBackendUrl) robotBackendUrl.value = executionConfig.robotBackendUrl || 'http://localhost:5000';

    const robotApiUrl = document.getElementById('robot-api-url');
    if (robotApiUrl) robotApiUrl.value = executionConfig.robotApiUrl || '';

    // Setup Robot Framework radio button handlers
    document.querySelectorAll('input[name="robot-execution-type"]').forEach(radio => {
        radio.addEventListener('change', function () {
            const browserConfig = document.getElementById('robot-browser-config');
            const backendConfig = document.getElementById('robot-backend-config');
            const apiConfig = document.getElementById('robot-api-config');

            if (!browserConfig || !backendConfig || !apiConfig) return;

            if (this.value === 'browser') {
                browserConfig.classList.remove('hidden');
                backendConfig.classList.add('hidden');
                apiConfig.classList.add('hidden');
            } else if (this.value === 'backend') {
                browserConfig.classList.add('hidden');
                backendConfig.classList.remove('hidden');
                apiConfig.classList.add('hidden');
            } else {
                browserConfig.classList.add('hidden');
                backendConfig.classList.add('hidden');
                apiConfig.classList.remove('hidden');
            }
        });
    });

    // Trigger initial state
    const selectedRobotRadio = document.querySelector('input[name="robot-execution-type"]:checked');
    if (selectedRobotRadio) {
        const selectedRobot = selectedRobotRadio.value;
        const browserConfig = document.getElementById('robot-browser-config');
        const backendConfig = document.getElementById('robot-backend-config');
        const apiConfig = document.getElementById('robot-api-config');

        if (browserConfig && backendConfig && apiConfig) {
            if (selectedRobot === 'browser') {
                browserConfig.classList.remove('hidden');
                backendConfig.classList.add('hidden');
                apiConfig.classList.add('hidden');
            } else if (selectedRobot === 'backend') {
                browserConfig.classList.add('hidden');
                backendConfig.classList.remove('hidden');
                apiConfig.classList.add('hidden');
            } else {
                browserConfig.classList.add('hidden');
                backendConfig.classList.add('hidden');
                apiConfig.classList.remove('hidden');
            }
        }
    }

    document.getElementById('execution-settings-modal').classList.remove('hidden');
}

function closeExecutionSettingsModal() {
    document.getElementById('execution-settings-modal').classList.add('hidden');
}

function saveExecutionSettings() {
    const execModeRadio = document.querySelector('input[name="execution-mode"]:checked');
    const javaTypeRadio = document.querySelector('input[name="java-execution-type"]:checked');
    const csharpTypeRadio = document.querySelector('input[name="csharp-execution-type"]:checked');
    const robotTypeRadio = document.querySelector('input[name="robot-execution-type"]:checked');

    if (execModeRadio) executionConfig.mode = execModeRadio.value;
    if (javaTypeRadio) executionConfig.javaType = javaTypeRadio.value;
    if (csharpTypeRadio) executionConfig.csharpType = csharpTypeRadio.value;
    if (robotTypeRadio) executionConfig.robotType = robotTypeRadio.value;

    const jdoodleClientId = document.getElementById('jdoodle-client-id');
    const jdoodleClientSecret = document.getElementById('jdoodle-client-secret');
    const robotBackendUrl = document.getElementById('robot-backend-url');
    const robotApiUrl = document.getElementById('robot-api-url');

    if (jdoodleClientId) executionConfig.jdoodleClientId = jdoodleClientId.value;
    if (jdoodleClientSecret) executionConfig.jdoodleClientSecret = jdoodleClientSecret.value;
    if (robotBackendUrl) executionConfig.robotBackendUrl = robotBackendUrl.value;
    if (robotApiUrl) executionConfig.robotApiUrl = robotApiUrl.value;

    getSecureConfigApi().saveConfig('execution_config', executionConfig);
    updateExecutionDisplay();
    closeExecutionSettingsModal();
    showMessage("Execution settings saved", 'success');
}

// ============================================
// STORAGE ABSTRACTION LAYER
// ============================================

let currentStorage = null;
let storageConfig = null;

// Storage Interface - all backends must implement these methods
class StorageBackend {
    async initialize() { throw new Error("Not implemented"); }
    async getAllSuites() { throw new Error("Not implemented"); }
    async saveSuite(suite) { throw new Error("Not implemented"); }
    async updateSuite(id, suite) { throw new Error("Not implemented"); }
    async deleteSuite(id) { throw new Error("Not implemented"); }
    async subscribeToChanges(callback) { /* Optional */ }
    getStatusMessage() { return "Connected"; }
}

// ============================================
// LOCAL STORAGE BACKEND
// ============================================

class LocalStorageBackend extends StorageBackend {
    constructor() {
        super();
        this.STORAGE_KEY = 'pipeline_test_suites';
        this.changeListeners = [];
        this.storageManager = null;
    }

    async initialize() {
        if (!window.localStorage) {
            throw new Error("localStorage is not available in this browser");
        }

        if (window.storageManager && typeof window.storageManager.ensureReady === 'function') {
            try {
                await window.storageManager.ensureReady();
                this.storageManager = window.storageManager;
            } catch (error) {
                console.warn('[LocalStorageBackend] IndexedDB storage unavailable, continuing with legacy localStorage:', error);
                this.storageManager = null;
            }
        }

        return true;
    }

    async getAllSuites() {
        let suites = [];

        if (this.storageManager) {
            try {
                suites = await this.storageManager.getAll(this.storageManager.STORES.testSuites);
            } catch (error) {
                console.warn('[LocalStorageBackend] Failed to read suites from StorageManager, using legacy localStorage:', error);
                this.storageManager = null;
            }
        }

        if (!this.storageManager) {
            suites = getSecureConfigApi().loadConfig(this.STORAGE_KEY, []) || [];
        }

        // Migration logic: Add new fields to existing suites
        return suites.map(suite => {
            if (!suite.tags) suite.tags = [];
            if (suite.isFavorite === undefined) suite.isFavorite = false;
            if (!suite.dateCreated) suite.dateCreated = new Date().toISOString();
            if (!suite.dateModified) suite.dateModified = new Date().toISOString();
            return suite;
        });
    }

    async saveSuite(suite) {
        const suites = await this.getAllSuites();
        suite.id = suite.id || this._generateId();
        suite.last_run_time = suite.last_run_time || null;
        suite.last_run_status = suite.last_run_status || 'NEVER_RUN';
        suite.last_run_log = suite.last_run_log || '';

        // Add new fields for Feature 2: Test Organization
        suite.tags = suite.tags || [];
        suite.isFavorite = suite.isFavorite || false;
        suite.dateCreated = suite.dateCreated || new Date().toISOString();
        suite.dateModified = new Date().toISOString();

        if (this.storageManager) {
            try {
                await this.storageManager.put(this.storageManager.STORES.testSuites, suite);
            } catch (error) {
                console.warn('[LocalStorageBackend] Failed to save suite through StorageManager, using legacy localStorage:', error);
                this.storageManager = null;
            }
        }

        if (!this.storageManager) {
            suites.push(suite);
            getSecureConfigApi().saveConfig(this.STORAGE_KEY, suites);
        }

        await this._notifyListeners();
        return suite.id;
    }

    async updateSuite(id, updates) {
        const suites = await this.getAllSuites();
        const index = suites.findIndex(s => s.id === id);
        if (index !== -1) {
            // Save version before updating
            if (window.versionControl) {
                window.versionControl.saveVersion(
                    id,
                    suites[index],
                    'Auto-save before update'
                );
            }
            // Set dateModified on update
            updates.dateModified = new Date().toISOString();
            const nextSuite = { ...suites[index], ...updates };

            if (this.storageManager) {
                try {
                    await this.storageManager.put(this.storageManager.STORES.testSuites, nextSuite);
                } catch (error) {
                    console.warn('[LocalStorageBackend] Failed to update suite through StorageManager, using legacy localStorage:', error);
                    this.storageManager = null;
                }
            }

            if (!this.storageManager) {
                suites[index] = nextSuite;
                getSecureConfigApi().saveConfig(this.STORAGE_KEY, suites);
            }

            await this._notifyListeners();
        }
    }

    async deleteSuite(id) {
        if (this.storageManager) {
            try {
                await this.storageManager.delete(this.storageManager.STORES.testSuites, id);
            } catch (error) {
                console.warn('[LocalStorageBackend] Failed to delete suite through StorageManager, using legacy localStorage:', error);
                this.storageManager = null;
            }
        }

        if (!this.storageManager) {
            const suites = await this.getAllSuites();
            const filtered = suites.filter(s => s.id !== id);
            getSecureConfigApi().saveConfig(this.STORAGE_KEY, filtered);
        }

        await this._notifyListeners();
    }

    async subscribeToChanges(callback) {
        this.changeListeners.push(callback);
        const suites = await this.getAllSuites();
        callback(suites);
    }

    async _notifyListeners() {
        const suites = await this.getAllSuites();
        this.changeListeners.forEach(cb => cb(suites));
    }

    _generateId() {
        return 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    getStatusMessage() {
        if (this.storageManager) {
            return 'Connected: Local IndexedDB Storage';
        }
        return 'Connected: Local Storage (Legacy Fallback)';
    }
}

// ============================================
// FIREBASE BACKEND
// ============================================

class FirebaseBackend extends StorageBackend {
    constructor(config) {
        super();
        this.config = config;
        this.app = null;
        this.db = null;
        this.auth = null;
        this.userId = null;
        this.unsubscribe = null;
    }

    async initialize() {
        try {
            if (!window.firebaseModules) {
                throw new Error("Firebase modules not loaded");
            }

            const { initializeApp, getFirestore, getAuth, signInAnonymously, onAuthStateChanged } = window.firebaseModules;

            this.app = initializeApp(this.config);
            this.db = getFirestore(this.app);
            this.auth = getAuth(this.app);

            await signInAnonymously(this.auth);

            return new Promise((resolve, reject) => {
                onAuthStateChanged(this.auth, (user) => {
                    if (user) {
                        this.userId = user.uid;
                        resolve(true);
                    } else {
                        reject(new Error("Authentication failed"));
                    }
                });
            });
        } catch (error) {
            console.error("Firebase initialization error:", error);
            throw error;
        }
    }

    async getAllSuites() {
        return [];
    }

    async saveSuite(suite) {
        const { collection, addDoc } = window.firebaseModules;
        suite.userId = this.userId;
        suite.last_run_time = suite.last_run_time || null;
        suite.last_run_status = suite.last_run_status || 'NEVER_RUN';
        suite.last_run_log = suite.last_run_log || '';

        const docRef = await addDoc(collection(this.db, 'test_suites'), suite);
        return docRef.id;
    }

    async updateSuite(id, updates) {
        // Save version before updating
        if (window.versionControl && window.testSuites) {
            const existingSuite = window.testSuites.find(s => s.id === id);
            if (existingSuite) {
                window.versionControl.saveVersion(
                    id,
                    existingSuite,
                    'Auto-save before update'
                );
            }
        }
        const { doc, updateDoc } = window.firebaseModules;
        const docRef = doc(this.db, 'test_suites', id);
        await updateDoc(docRef, updates);
    }

    async deleteSuite(id) {
        const { doc, deleteDoc } = window.firebaseModules;
        const docRef = doc(this.db, 'test_suites', id);
        await deleteDoc(docRef);
    }

    async subscribeToChanges(callback) {
        const { collection, query, where, onSnapshot } = window.firebaseModules;
        const q = query(
            collection(this.db, 'test_suites'),
            where('userId', '==', this.userId)
        );

        this.unsubscribe = onSnapshot(q, (snapshot) => {
            const suites = [];
            snapshot.forEach((doc) => {
                suites.push({ id: doc.id, ...doc.data() });
            });
            callback(suites);
        });
    }

    getStatusMessage() {
        return `Connected: Firebase (User: ${this.userId ? this.userId.substring(0, 8) + '...' : 'Unknown'})`;
    }
}

// ============================================
// CUSTOM API BACKEND
// ============================================

class CustomApiBackend extends StorageBackend {
    constructor(config) {
        super();
        this.baseUrl = config.baseUrl;
        this.authHeader = config.authHeader;
        this.pollInterval = null;
    }

    async initialize() {
        try {
            await this._fetch('GET', '');
            return true;
        } catch (error) {
            throw new Error(`Cannot connect to API: ${error.message}`);
        }
    }

    async getAllSuites() {
        const response = await this._fetch('GET', '');
        return response;
    }

    async saveSuite(suite) {
        suite.last_run_time = suite.last_run_time || null;
        suite.last_run_status = suite.last_run_status || 'NEVER_RUN';
        suite.last_run_log = suite.last_run_log || '';

        const response = await this._fetch('POST', '', suite);
        return response.id;
    }

    async updateSuite(id, updates) {
        // Save version before updating
        if (window.versionControl && window.testSuites) {
            const existingSuite = window.testSuites.find(s => s.id === id);
            if (existingSuite) {
                window.versionControl.saveVersion(
                    id,
                    existingSuite,
                    'Auto-save before update'
                );
            }
        }
        await this._fetch('PUT', `/${id}`, updates);
    }

    async deleteSuite(id) {
        await this._fetch('DELETE', `/${id}`);
    }

    async subscribeToChanges(callback) {
        const poll = async () => {
            try {
                const suites = await this.getAllSuites();
                callback(suites);
            } catch (error) {
                console.error("Polling error:", error);
            }
        };

        await poll();
        this.pollInterval = setInterval(poll, 5000);
    }

    async _fetch(method, path, body = null) {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        if (this.authHeader) {
            options.headers['Authorization'] = this.authHeader;
        }

        if (body) {
            options.body = JSON.stringify(body);
        }

        let response;
        try {
            response = await fetch(this.baseUrl + path, options);
        } catch (error) {
            throw new Error(`Custom API request failed: ${error.message}`);
        }

        if (!response.ok) {
            throw await buildHttpError(response, 'Custom API request failed');
        }

        if (method !== 'DELETE') {
            return await parseJsonResponse(response, 'Custom API request failed');
        }
    }

    getStatusMessage() {
        return `Connected: Custom API (${this.baseUrl})`;
    }
}

// ============================================
// STORAGE MANAGER
// ============================================

async function initializeStorage() {
    try {
        storageConfig = getSecureConfigApi().loadConfig('storage_config', null);
        if (!storageConfig) {
            storageConfig = { type: 'localStorage' };
            getSecureConfigApi().saveConfig('storage_config', storageConfig);
        }

        await connectToStorage(storageConfig);

        // Initialize Environment Manager
        if (window.environmentManager) {
            window.initializeEnvironmentDisplay();
            window.addEventListener('environmentChanged', (e) => {
                const env = window.environmentManager.getEnvironment(e.detail.envId);
                window.updateEnvironmentDisplay(env);
            });
        }

    } catch (error) {
        console.error("Storage initialization error:", error);
        showMessage("Failed to initialize storage: " + error.message, 'error');
        document.getElementById('storage-info').textContent = "Storage initialization failed. Click Settings to configure.";
    }
}

async function connectToStorage(config) {
    try {
        switch (config.type) {
            case 'localStorage':
                currentStorage = new LocalStorageBackend();
                break;

            case 'firebase':
                if (!config.firebaseConfig) {
                    throw new Error("Firebase configuration is missing");
                }
                currentStorage = new FirebaseBackend(config.firebaseConfig);
                break;

            case 'customApi':
                if (!config.apiConfig) {
                    throw new Error("API configuration is missing");
                }
                currentStorage = new CustomApiBackend(config.apiConfig);
                break;

            default:
                throw new Error("Unknown storage type: " + config.type);
        }

        document.getElementById('storage-info').textContent = "Connecting to storage...";
        await currentStorage.initialize();
        await currentStorage.subscribeToChanges(renderTestSuites);
        window.currentStorage = currentStorage;
        await refreshStorageStatusDisplay();
        showMessage("Storage connected successfully", 'success');

    } catch (error) {
        console.error("Storage connection error:", error);
        currentStorage = null;
        window.currentStorage = null;
        throw error;
    }
}

// ============================================
// SETTINGS MODAL
// ============================================

function openSettingsModal() {
    if (storageConfig) {
        const storageTypeRadio = document.querySelector(`input[name="storage-type"][value="${storageConfig.type}"]`);
        if (storageTypeRadio) storageTypeRadio.checked = true;

        if (storageConfig.type === 'firebase' && storageConfig.firebaseConfig) {
            const fc = storageConfig.firebaseConfig;
            const fbApiKey = document.getElementById('firebase-api-key');
            const fbAuthDomain = document.getElementById('firebase-auth-domain');
            const fbProjectId = document.getElementById('firebase-project-id');
            const fbStorageBucket = document.getElementById('firebase-storage-bucket');

            if (fbApiKey) fbApiKey.value = fc.apiKey || '';
            if (fbAuthDomain) fbAuthDomain.value = fc.authDomain || '';
            if (fbProjectId) fbProjectId.value = fc.projectId || '';
            if (fbStorageBucket) fbStorageBucket.value = fc.storageBucket || '';
        }

        if (storageConfig.type === 'customApi' && storageConfig.apiConfig) {
            const ac = storageConfig.apiConfig;
            const apiBaseUrl = document.getElementById('custom-api-base-url');
            const apiAuthHeader = document.getElementById('custom-api-auth-header');

            if (apiBaseUrl) apiBaseUrl.value = ac.baseUrl || '';
            if (apiAuthHeader) apiAuthHeader.value = ac.authHeader || '';
        }
    }

    // Setup storage type radio handlers
    document.querySelectorAll('input[name="storage-type"]').forEach(radio => {
        radio.addEventListener('change', function () {
            const firebaseConfig = document.getElementById('firebase-config');
            const customApiConfig = document.getElementById('custom-api-config');

            if (!firebaseConfig || !customApiConfig) return;

            firebaseConfig.classList.add('hidden');
            customApiConfig.classList.add('hidden');

            if (this.value === 'firebase') {
                firebaseConfig.classList.remove('hidden');
            } else if (this.value === 'customApi') {
                customApiConfig.classList.remove('hidden');
            }
        });
    });

    // Trigger initial state
    const selectedTypeRadio = document.querySelector('input[name="storage-type"]:checked');
    if (selectedTypeRadio) {
        const selectedType = selectedTypeRadio.value;
        const firebaseConfig = document.getElementById('firebase-config');
        const customApiConfig = document.getElementById('custom-api-config');

        if (firebaseConfig && customApiConfig) {
            if (selectedType === 'firebase') {
                firebaseConfig.classList.remove('hidden');
            } else if (selectedType === 'customApi') {
                customApiConfig.classList.remove('hidden');
            }
        }
    }

    document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettingsModal() {
    document.getElementById('settings-modal').classList.add('hidden');
}

async function saveSettings() {
    const storageTypeRadio = document.querySelector('input[name="storage-type"]:checked');
    if (!storageTypeRadio) {
        showMessage("Please select a storage type", 'error');
        return;
    }

    const newConfig = {
        type: storageTypeRadio.value
    };

    if (newConfig.type === 'firebase') {
        const fbApiKey = document.getElementById('firebase-api-key');
        const fbAuthDomain = document.getElementById('firebase-auth-domain');
        const fbProjectId = document.getElementById('firebase-project-id');
        const fbStorageBucket = document.getElementById('firebase-storage-bucket');

        newConfig.firebaseConfig = {
            apiKey: fbApiKey ? fbApiKey.value : '',
            authDomain: fbAuthDomain ? fbAuthDomain.value : '',
            projectId: fbProjectId ? fbProjectId.value : '',
            storageBucket: fbStorageBucket ? fbStorageBucket.value : ''
        };

        if (!newConfig.firebaseConfig.apiKey || !newConfig.firebaseConfig.projectId) {
            showMessage("Please fill in Firebase credentials", 'error');
            return;
        }
    } else if (newConfig.type === 'customApi') {
        const apiBaseUrl = document.getElementById('custom-api-base-url');
        const apiAuthHeader = document.getElementById('custom-api-auth-header');

        newConfig.apiConfig = {
            baseUrl: apiBaseUrl ? apiBaseUrl.value : '',
            authHeader: apiAuthHeader ? apiAuthHeader.value : ''
        };

        if (!newConfig.apiConfig.baseUrl) {
            showMessage("Please enter API base URL", 'error');
            return;
        }
    }

    try {
        getSecureConfigApi().saveConfig('storage_config', newConfig);
        storageConfig = newConfig;
        await connectToStorage(newConfig);
        closeSettingsModal();
    } catch (error) {
        showMessage("Failed to connect: " + error.message, 'error');
    }
}

// ============================================
// TEST SUITE RENDERING
// ============================================

let testSuites = [];
window.testSuites = testSuites;
let editingSuiteId = null;

// ============================================
// VIEWS MANAGEMENT
// ============================================

let views = [];
let currentViewId = null; // null means "All Views"

function initializeViews() {
    try {
        const savedViews = localStorage.getItem('views');
        if (savedViews) {
            views = JSON.parse(savedViews);
        } else {
            views = []; // Start with no views, show all by default
        }
        renderViews();
    } catch (error) {
        console.error('Error initializing views:', error);
        views = [];
    }
}

function saveViewsToStorage() {
    localStorage.setItem('views', JSON.stringify(views));
}

function renderViews() {
    const viewsList = document.getElementById('views-list');
    if (!viewsList) return;

    viewsList.innerHTML = '';

    // "All Views" option
    const allViewsBtn = document.createElement('button');
    allViewsBtn.className = `w-full text-left p-3 rounded transition duration-200 ${currentViewId === null ? 'aero-button-primary' : 'aero-button hover:aero-button-primary'
        }`;
    allViewsBtn.innerHTML = `
 <div class="flex justify-between items-center">
 <span class="font-semibold">All Views</span>
 <span class="text-xs aero-badge-info">${testSuites.length}</span>
 </div>
 `;
    allViewsBtn.onclick = () => switchView(null);
    viewsList.appendChild(allViewsBtn);

    // Individual views
    views.forEach(view => {
        const suitesInView = testSuites.filter(s => s.view_id === view.id);
        const viewBtn = document.createElement('div');
        viewBtn.className = `${currentViewId === view.id ? 'aero-button-primary' : 'aero-button hover:aero-button-primary'
            } p-3 rounded transition duration-200 mb-2`;
        viewBtn.innerHTML = `
 <div class="flex justify-between items-center cursor-pointer" onclick="switchView('${view.id}')">
 <div class="flex-1">
 <div class="font-semibold text-sm">${escapeHtml(view.name)}</div>
 ${view.description ? `<div class="text-xs aero-text-muted mt-1">${escapeHtml(view.description)}</div>` : ''}
 </div>
 <span class="text-xs aero-badge-info ml-2">${suitesInView.length}</span>
 </div>
 <div class="flex gap-2 mt-2">
 <button onclick="event.stopPropagation(); duplicateView('${view.id}')"
 class="aero-button-purple text-xs py-1 px-2 rounded transition duration-200 flex-1"
 title="Duplicate View">
 Duplicate
 </button>
 <button onclick="event.stopPropagation(); deleteView('${view.id}')" 
 class="aero-button-danger text-xs py-1 px-2 rounded transition duration-200 flex-1" 
 title="Delete View">
 Delete
 </button>
 </div>
 `;
        viewsList.appendChild(viewBtn);
    });
}

function switchView(viewId) {
    currentViewId = viewId;
    renderViews();
    renderTestSuites(testSuites);

    // Update the current view name display
    const viewNameSpan = document.getElementById('current-view-name');
    if (viewNameSpan) {
        if (viewId === null) {
            viewNameSpan.textContent = '';
        } else {
            const view = views.find(v => v.id === viewId);
            if (view) {
                viewNameSpan.textContent = `(View: ${view.name})`;
            }
        }
    }
}

function openAddViewModal() {
    const modal = document.getElementById('add-view-modal');
    if (!modal) return;

    modal.classList.remove('hidden');

    const nameInput = document.getElementById('view-name');
    if (nameInput) nameInput.value = '';

    const descInput = document.getElementById('view-description');
    if (descInput) descInput.value = '';
}

function closeAddViewModal() {
    const modal = document.getElementById('add-view-modal');
    if (modal) modal.classList.add('hidden');
}

function createView(event) {
    event.preventDefault();

    const nameEl = document.getElementById('view-name');
    const descEl = document.getElementById('view-description');

    if (!nameEl || !descEl) {
        showMessage('Form elements not found', 'error');
        return;
    }

    const name = nameEl.value.trim();
    const description = descEl.value.trim();

    if (!name) {
        showMessage('View name is required', 'error');
        return;
    }

    const newView = {
        id: 'view-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        name: name,
        description: description,
        created_at: new Date().toISOString()
    };

    views.push(newView);
    saveViewsToStorage();
    renderViews();
    closeAddViewModal();
    showMessage(`View "${name}" created`, 'success');
}

async function duplicateView(viewId) {
    const originalView = views.find(v => v.id === viewId);
    if (!originalView) {
        showMessage('Original view not found!', 'error');
        return;
    }

    const suitesInView = testSuites.filter(s => s.view_id === viewId);

    // 1. Ask the user if they want to duplicate the test suites as well.
    let confirmMessage = `Duplicate the view "${originalView.name}"?`;
    if (suitesInView.length > 0) {
        confirmMessage += `\n\nThis view contains ${suitesInView.length} test suite(s). Do you want to duplicate these test suites into the new view?`;
    }
    const shouldDuplicateSuites = confirm(confirmMessage);

    try {
        // 2. Create the new view object.
        const newViewId = 'view-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        const newView = {
            ...originalView,
            id: newViewId,
            name: `${originalView.name} (Copy)`
        };

        // 3. Save the new view.
        views.push(newView);
        saveViewsToStorage();

        // 4. If confirmed, duplicate all test suites from the original view.
        if (shouldDuplicateSuites && suitesInView.length > 0) {
            for (const originalSuite of suitesInView) {
                // Create a copy of the suite object
                const { id, ...suiteDataToCopy } = originalSuite;

                // Append "(Copy)" to the name
                suiteDataToCopy.name = `${originalSuite.name} (Copy)`;

                // Assign the new suite to our new view
                suiteDataToCopy.view_id = newViewId;

                // Reset run history for the new copy
                suiteDataToCopy.last_run_status = 'NEVER_RUN';
                suiteDataToCopy.last_run_time = null;
                suiteDataToCopy.last_run_log = '';

                // Save the new suite using the storage backend
                await currentStorage.saveSuite(suiteDataToCopy);
            }
        }

        // 5. Refresh the UI and show a success message.
        renderViews();
        let successMessage = `View "${originalView.name}" duplicated.`;
        if (shouldDuplicateSuites && suitesInView.length > 0) {
            successMessage += ` Copied ${suitesInView.length} test suite(s).`;
        }
        showMessage(successMessage, 'success');

    } catch (error) {
        console.error("View duplication error:", error);
        showMessage("Failed to duplicate view: " + error.message, 'error');
    }
}

function deleteView(viewId) {
    const view = views.find(v => v.id === viewId);
    if (!view) return;

    // Count suites in this view
    const suitesInView = testSuites.filter(s => s.view_id === viewId);

    let confirmMsg = `Delete view "${view.name}"?`;
    if (suitesInView.length > 0) {
        confirmMsg += `\n\nThis view contains ${suitesInView.length} test suite(s). They will be moved to "All Views" (unassigned).`;
    }

    if (!confirm(confirmMsg)) {
        return;
    }

    // Remove view
    views = views.filter(v => v.id !== viewId);
    saveViewsToStorage();

    // If this was the current view, switch to All Views
    if (currentViewId === viewId) {
        currentViewId = null;
    }

    // Unassign suites from this view
    if (suitesInView.length > 0) {
        suitesInView.forEach(async suite => {
            try {
                await currentStorage.updateSuite(suite.id, { view_id: null });
            } catch (error) {
                console.error('Error updating suite:', error);
            }
        });
    }

    renderViews();
    renderTestSuites(testSuites);
    showMessage(`View "${view.name}" deleted`, 'success');
}

function populateViewSelectOptions() {
    const select = document.getElementById('suite_view');
    if (!select) return;

    // Clear existing options except the first one
    select.innerHTML = '<option value="">All Views (Default)</option>';

    // Add view options
    views.forEach(view => {
        const option = document.createElement('option');
        option.value = view.id;
        option.textContent = view.name;
        select.appendChild(option);
    });
}

function renderTestSuites(suites) {
    testSuites = suites;
    window.testSuites = suites;

    // Filter by current view first
    let filteredSuites = suites;
    if (currentViewId !== null) {
        filteredSuites = suites.filter(s => s.view_id === currentViewId);
    }

    // Apply search filter
    if (suiteFilters.searchText) {
        filteredSuites = filteredSuites.filter(suite => {
            const searchIn = [
                suite.name || '',
                suite.description || '',
                ...(suite.tags || [])
            ].join(' ').toLowerCase();
            return searchIn.includes(suiteFilters.searchText);
        });
    }

    // Apply tag filter
    if (suiteFilters.tagFilter) {
        filteredSuites = filteredSuites.filter(suite =>
            suite.tags && suite.tags.includes(suiteFilters.tagFilter)
        );
    }

    // Apply language filter
    if (suiteFilters.languageFilter) {
        filteredSuites = filteredSuites.filter(suite =>
            suite.language === suiteFilters.languageFilter
        );
    }

    // Apply sorting
    filteredSuites = [...filteredSuites]; // Create a copy to avoid mutating original
    if (suiteFilters.sortOption === 'name') {
        filteredSuites.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (suiteFilters.sortOption === 'dateCreated') {
        filteredSuites.sort((a, b) => new Date(b.dateCreated || 0) - new Date(a.dateCreated || 0));
    } else if (suiteFilters.sortOption === 'dateModified') {
        filteredSuites.sort((a, b) => new Date(b.dateModified || 0) - new Date(a.dateModified || 0));
    } else if (suiteFilters.sortOption === 'favorites') {
        filteredSuites.sort((a, b) => {
            if (a.isFavorite && !b.isFavorite) return -1;
            if (!a.isFavorite && b.isFavorite) return 1;
            return new Date(b.dateModified || 0) - new Date(a.dateModified || 0);
        });
    }

    const container = document.getElementById('test-suites');
    if (!container) return; // Guard clause if container doesn't exist

    const loadingMsg = document.getElementById('loading-message');
    if (loadingMsg) loadingMsg.remove();

    if (filteredSuites.length === 0) {
        const noResultsMsg = suiteFilters.searchText || suiteFilters.tagFilter || suiteFilters.languageFilter
            ? 'No test suites match your filters.'
            : `No test suites found${currentViewId ? ' in this view' : ''}. Click "Add New Test Suite" to get started.`;
        container.innerHTML = `<p class="aero-text-muted text-center py-8">${noResultsMsg}</p>`;
        return;
    }

    // Update views panel counts and tag dropdown
    renderViews();
    updateTagFilterDropdown();

    container.innerHTML = filteredSuites.map(suite => {
        const statusBadge = suite.last_run_status === 'SUCCESS' ? 'aero-badge-success' :
            suite.last_run_status === 'FAILURE' ? 'aero-badge-error' : '';
        const isWebsite = suite.language === 'website';

        // Check if it's a Visual Web Test (website + upload)
        const isVisualWebTest = isWebsite && suite.website_method === 'upload';

        const languageDisplay = isVisualWebTest ? '✨ VISUAL WEB' :
            isWebsite ? 'WEBSITE (URL)' :
                suite.language.toUpperCase();

        const cardBorderColor = isVisualWebTest ? 'border-purple-500' : 'border-blue-500';

        // Bulk mode checkbox
        const isSelected = selectedSuites.has(suite.id);
        const bulkCheckbox = bulkModeActive ? `
 <div class="absolute top-3 left-3">
 <input type="checkbox" 
 ${isSelected ? 'checked' : ''} 
 onclick="event.stopPropagation(); toggleSuiteSelection('${suite.id}')"
 class="w-5 h-5 cursor-pointer">
 </div>
 ` : '';

        // Tags display
        const tagsDisplay = suite.tags && suite.tags.length > 0 ? `
 <div class="flex flex-wrap gap-1 mt-2">
 ${suite.tags.map(tag => `
 <span class="aero-badge-info text-xs px-2 py-1 rounded-full">
 ${escapeHtml(tag)}
 </span>
 `).join('')}
 </div>
 ` : '';

        return `
 <div class="aero-card p-6 border-l-4 ${cardBorderColor} relative ${bulkModeActive ? 'cursor-pointer hover:bg-opacity-80' : ''}" 
 ${bulkModeActive ? `onclick="toggleSuiteSelection('${suite.id}')"` : ''}>
 ${bulkCheckbox}
 <div class="flex justify-between items-start mb-3 ${bulkModeActive ? 'ml-8' : ''}">
 <div class="flex-1">
 <div class="flex items-center gap-2 mb-2">
 <h3 class="text-xl font-bold aero-text-primary">${escapeHtml(suite.name)}</h3>
 <button onclick='toggleFavorite(event, "${suite.id}")' 
 class='text-2xl hover:scale-110 transition-transform'
 title='${suite.isFavorite ? "Remove from favorites" : "Add to favorites"}'>
 ${suite.isFavorite ? '★' : '☆'}
 </button>
 </div>
 <p class="aero-text-muted text-sm">${escapeHtml(suite.description || 'No description')}</p>
 ${isWebsite && suite.website_method === 'url' ? `
 <p class="text-xs aero-text-muted mt-1">🔗— ${escapeHtml(suite.website_url || 'No URL')}</p>
 ` : ''}
 ${isVisualWebTest ? `
 <p class="text-xs aero-text-success mt-1">Uploaded site files</p>
 ` : ''}
 ${tagsDisplay}
 </div>
 <div class="flex flex-col items-end space-y-2">
 <span class="aero-badge-info">
 ${languageDisplay}
 </span>
 ${suite.last_run_status && suite.last_run_status !== 'NEVER_RUN' ? `
 <span class="${statusBadge}">
 ${suite.last_run_status}
 </span>
 ` : ''}
 </div>
 </div>
 
 ${suite.last_run_time ? `
 <div class="text-xs aero-text-muted mb-3">
 Last run: ${new Date(suite.last_run_time).toLocaleString()}
 </div>
 ` : ''}
 
 <div class="flex justify-end space-x-2" onclick="event.stopPropagation()">
 <button onclick="openSuiteHistoryModal('${suite.id}')" 
  class="aero-button-info text-sm font-semibold py-1 px-3 rounded transition"
  title="View Execution History">
  📈 History
 </button>
 <button onclick="openVersionHistory(event, '${suite.id}')" 
  class="aero-button-info text-sm font-semibold py-1 px-3 rounded transition"
  title="View Version History">
  Versions
 </button>
 <button onclick="duplicateSuite('${suite.id}')" 
 class="aero-button-purple text-sm font-semibold py-1 px-3 rounded transition">
 Duplicate
 </button>
 <button onclick="exportSuiteToJSON('${suite.id}')" 
 class="aero-button-info text-sm font-semibold py-1 px-3 rounded transition">
 Export
 </button>
 <button onclick="runTestSuite('${suite.id}')" 
 class="aero-button-success text-sm font-semibold py-1 px-3 rounded transition">
 >>Run
 </button>
 <button onclick="editSuite('${suite.id}')" 
 class="aero-button-primary text-sm font-semibold py-1 px-3 rounded transition">
 Edit
 </button>
 <button onclick="deleteSuite('${suite.id}')" 
 class="aero-button-danger text-sm font-semibold py-1 px-3 rounded transition">
 Delete
 </button>
 </div>
 </div>
 `;
    }).join('');
}

function openAddSuiteModal() {
    if (!currentStorage) {
        showMessage("Please configure storage first (click Settings)", 'error');
        return;
    }

    editingSuiteId = null;
    const modalTitle = document.getElementById('modal-title');
    if (modalTitle) {
        const envName = window.environmentManager ? window.environmentManager.getActiveEnvironment().name : '';
        modalTitle.innerHTML = `Add New Test Suite <span class="text-sm font-normal text-gray-400 ml-2">Env: ${escapeHtml(envName)}</span>`;
    }

    const suiteForm = document.getElementById('suite-form');
    if (suiteForm) suiteForm.reset();

    const suiteId = document.getElementById('suite-id');
    if (suiteId) suiteId.value = '';

    const paramsContainer = document.getElementById('parameters-container');
    if (paramsContainer) paramsContainer.innerHTML = '';

    const filesContainer = document.getElementById('input-files-container');
    if (filesContainer) filesContainer.innerHTML = '';

    const enableLogSaving = document.getElementById('enable_log_saving');
    if (enableLogSaving) enableLogSaving.checked = false;

    const logConfigOptions = document.getElementById('log-config-options');
    if (logConfigOptions) logConfigOptions.classList.add('hidden');

    // Populate view options
    populateViewSelectOptions();

    // Reset website integration data
    websiteFiles = { html: null, css: [], js: [] };
    const websiteConfig = document.getElementById('website-testing-config');
    if (websiteConfig) websiteConfig.classList.add('hidden');
    updateCodeEditor();

    const uploadedPreview = document.getElementById('website-files-preview');
    if (uploadedPreview) uploadedPreview.innerHTML = 'No files uploaded yet';

    // Reset tags
    currentEditTags = [];
    renderTagsInEditor();
    setMockBuilderStateInEditor(getDefaultMockBuilderState());

    const suiteModal = document.getElementById('suite-modal');
    if (suiteModal) {
        suiteModal.classList.remove('hidden');
        scheduleSuiteModalEditorInitialization('python', '');
    }
}

function closeEditorModal() {
    const modal = document.getElementById('suite-modal');
    if (modal) modal.classList.add('hidden');
    suiteEditorInitToken += 1;
}

// ============================================
// *** NEW EDIT LOGIC ***
// This function now acts as a router,
// deciding which editor modal to open.
// ============================================
function editSuite(suiteId) {
    const suite = testSuites.find(s => s.id === suiteId);
    if (!suite) {
        console.error("Suite not found:", suiteId);
        showMessage("Error: Test suite not found.", 'error');
        return;
    }

    // This is the logic you requested:
    // If it's a 'website' language test AND it uses the 'upload' method,
    // it was almost certainly made by the Visual Web Tester.
    if (suite.language === 'website' && suite.website_method === 'upload') {

        // Check if the visual editor's function exists
        if (typeof openVisualWebTesterForEdit === 'function') {
            openVisualWebTesterForEdit(suite);
        } else {
            console.error("Visual Web Tester edit function not found. Opening standard editor as fallback.");
            showMessage("Visual editor function not found. Opening standard editor.", 'error');
            openNormalSuiteEditor(suite); // Fallback to normal editor
        }

    } else {
        // This is for all other test types:
        // Python, Java, C#, Robot, or 'website' with 'url' method
        openNormalSuiteEditor(suite);
    }
}

// ============================================
// *** NEW FUNCTION ***
// This contains the logic from the *original*
// editSuite function, now repurposed to
// only open the standard editor.
// ============================================

function switchEditorTab(tab) {
    ['code', 'data'].forEach(t => {
        const el = document.getElementById(`tab-${t}`);
        if (el) {
            el.className = t === tab
                ? 'py-2 px-4 font-semibold aero-text-primary border-b-2 border-blue-500 cursor-pointer'
                : 'py-2 px-4 font-semibold aero-text-muted cursor-pointer hover:text-white';
        }
        const content = document.getElementById(`editor-tab-${t}`);
        if (content) {
            content.classList.toggle('hidden', t !== tab);
        }
    });
}

function updateDataSetDropdown(selectedId = null) {
    const select = document.getElementById('suite_data_set');
    if (!select) return;

    const dataSets = window.dataManager.getAllDataSets();

    select.innerHTML = '<option value="">None (Single Test)</option>';
    dataSets.forEach(ds => {
        const option = document.createElement('option');
        option.value = ds.id;
        option.textContent = ds.name;
        if (ds.id === selectedId) option.selected = true;
        select.appendChild(option);
    });

    // Update preview if selected
    const previewContainer = document.getElementById('data-set-preview');
    if (selectedId) {
        const ds = window.dataManager.getDataSet(selectedId);
        if (ds) {
            previewContainer.innerHTML = `
        <div class="text-xs aero-text-muted mb-2">
          Selected: <strong>${ds.name}</strong> (${ds.data.length} rows)
        </div>
        <div class="flex flex-wrap gap-1">
          ${ds.headers.map(h => `<code class="aero-badge-info text-xs">\${${h}}</code>`).join('')}
        </div>
      `;
            previewContainer.classList.remove('hidden');
        } else {
            previewContainer.classList.add('hidden');
        }
    } else {
        previewContainer.classList.add('hidden');
    }
}

function updateCodeEditor() {
    const languageSelect = document.getElementById('suite_language');
    const websiteConfig = document.getElementById('website-testing-config');
    const validationLabel = document.getElementById('validation-label');
    const validationHint = document.getElementById('validation-hint');
    const validationField = document.getElementById('expected_output');

    if (!languageSelect) return;

    const language = languageSelect.value;

    // Show/hide website config
    if (websiteConfig) {
        if (language === 'website') {
            websiteConfig.classList.remove('hidden');
        } else {
            websiteConfig.classList.add('hidden');
        }
    }

    // Update Monaco Editor language if it exists
    if (window.currentMonacoEditor) {
        let editorLang = language;
        if (language === 'website') editorLang = 'robot'; // Website tests use Robot Framework syntax

        const model = window.currentMonacoEditor.getModel();
        if (model) {
            monaco.editor.setModelLanguage(model, editorLang);
        }
    }

    if (validationLabel && validationHint && validationField) {
        if (language === 'python') {
            validationLabel.textContent = 'Validation / Test Code (Optional)';
            validationHint.textContent = 'For Python suites, write assertion code here. Available values: TEST_OUTPUT, TEST_STDOUT, TEST_STDERR, ARTIFACTS. You can also use assert_output_equals("PRINT"). Plain text without assertion syntax is treated as exact expected output.';
            validationField.placeholder = 'assert_output_equals("PRINT")';
        } else {
            validationLabel.textContent = 'Expected Output / Validation (Optional)';
            validationHint.textContent = 'For non-Python suites, this field is compared against the actual output as exact expected text.';
            validationField.placeholder = 'PRINT';
        }
    }
}

function getDefaultMockBuilderState() {
    if (window.mockBuilder && typeof window.mockBuilder.getDefaultState === 'function') {
        return window.mockBuilder.getDefaultState();
    }

    return {
        mocks: [],
        setupSteps: [],
        teardownSteps: [],
        fileData: {
            filePath: '',
            usageMode: 'per-row',
            selectedRows: '',
            sampleSize: '',
            columnMappings: {}
        }
    };
}

function getMockBuilderStateFromEditor() {
    const input = document.getElementById('mock_builder_json');
    const fallback = getDefaultMockBuilderState();
    if (!input || !input.value) {
        return fallback;
    }

    try {
        const parsed = JSON.parse(input.value);
        if (window.mockBuilder && typeof window.mockBuilder.normalizeState === 'function') {
            return window.mockBuilder.normalizeState(parsed);
        }
        return parsed;
    } catch (error) {
        console.warn('Failed to parse mock builder state:', error);
        return fallback;
    }
}

function updateMockBuilderSummary(state = getMockBuilderStateFromEditor()) {
    const summaryEl = document.getElementById('mock-builder-summary');
    if (!summaryEl) return;

    const mocks = Array.isArray(state?.mocks) ? state.mocks.length : 0;
    const setupSteps = Array.isArray(state?.setupSteps) ? state.setupSteps.length : 0;
    const teardownSteps = Array.isArray(state?.teardownSteps) ? state.teardownSteps.length : 0;
    const filePathText = state?.fileData?.filePath ? ` File source: ${state.fileData.filePath}` : '';

    if (mocks === 0 && setupSteps === 0 && teardownSteps === 0 && !filePathText) {
        summaryEl.textContent = 'No mock data, setup steps, or file-based test data configured yet.';
        return;
    }

    summaryEl.textContent = `${mocks} mock(s), ${setupSteps} setup step(s), ${teardownSteps} teardown step(s).${filePathText}`;
}

function setMockBuilderStateInEditor(state) {
    const normalizedState = window.mockBuilder && typeof window.mockBuilder.normalizeState === 'function'
        ? window.mockBuilder.normalizeState(state)
        : (state || getDefaultMockBuilderState());
    const input = document.getElementById('mock_builder_json');
    if (input) {
        input.value = JSON.stringify(normalizedState);
    }
    updateMockBuilderSummary(normalizedState);
}

function openMockBuilder() {
    if (!window.mockBuilder || typeof window.mockBuilder.open !== 'function') {
        showMessage('Mock Builder is not loaded yet.', 'error');
        return;
    }

    window.mockBuilder.open({
        state: getMockBuilderStateFromEditor(),
        onSave: (state) => setMockBuilderStateInEditor(state)
    });
}

function openNormalSuiteEditor(suite) {
    editingSuiteId = suite.id; // Set the global editing ID

    // Helper function to safely set element value
    const setElementValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value || '';
    };

    const setElementText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    const setElementChecked = (id, checked) => {
        const el = document.getElementById(id);
        if (el) el.checked = checked;
    };

    const envName = window.environmentManager ? window.environmentManager.getActiveEnvironment().name : '';
    const modalTitle = document.getElementById('modal-title');
    if (modalTitle) {
        modalTitle.innerHTML = `Edit Test Suite <span class="text-sm font-normal text-gray-400 ml-2">Env: ${escapeHtml(envName)}</span>`;
    }
    setElementValue('suite-id', suite.id);
    setElementValue('suite_name', suite.name);
    setElementValue('suite_description', suite.description);
    setElementValue('suite_language', suite.language);
    setElementValue('expected_output', suite.expected_output);
    setElementValue('mock_builder_json', JSON.stringify(suite.mock_builder || getDefaultMockBuilderState()));
    setElementValue('webhook_url', suite.webhook_url);
    setElementValue('integration_info', suite.integration_info);
    updateMockBuilderSummary(suite.mock_builder || getDefaultMockBuilderState());

    // Load log configuration
    if (suite.log_config) {
        setElementChecked('enable_log_saving', suite.log_config.enabled || false);
        setElementValue('log_filename', suite.log_config.filename || 'log_{suite_name}_{timestamp}');
        setElementValue('log_format', suite.log_config.format || 'txt');
        setElementValue('log_save_trigger', suite.log_config.save_trigger || 'always');

        const logOptions = document.getElementById('log-config-options');
        if (logOptions) logOptions.classList.toggle('hidden', !suite.log_config.enabled);
    } else {
        setElementChecked('enable_log_saving', false);
        const logOptions = document.getElementById('log-config-options');
        if (logOptions) logOptions.classList.add('hidden');
    }

    // Ensure the correct code editor view is shown
    updateCodeEditor();

    // Load website integration data if applicable
    if (suite.language === 'website') {
        document.getElementById('website-testing-config')?.classList.remove('hidden');

        const method = suite.website_method || 'url';
        const methodRadio = document.querySelector(`input[name="website-method"][value="${method}"]`);
        if (methodRadio) methodRadio.checked = true;
        toggleWebsiteMethod();

        if (method === 'url') {
            document.getElementById('website_url').value = suite.website_url || '';
            // Clear file content if we switch to URL
            websiteFiles.html = null;
            websiteFiles.css = [];
            websiteFiles.js = [];
        } else if (method === 'upload') {
            // Restore uploaded files
            websiteFiles.html = suite.website_html_content;
            websiteFiles.css = suite.website_css_contents || [];
            websiteFiles.js = suite.website_js_contents || [];

            // Update preview
            const preview = document.getElementById('website-files-preview');
            let previewText = '';
            if (websiteFiles.html) previewText += ' HTML file loaded<br>';
            if (websiteFiles.css.length > 0) previewText += ` ${websiteFiles.css.length} CSS file(s) loaded<br>`;
            if (websiteFiles.js.length > 0) previewText += ` ${websiteFiles.js.length} JS file(s) loaded<br>`;
            if (preview) {
                preview.innerHTML = '<strong>Loaded Files:</strong><br>' + (previewText || 'No files loaded');
            }
        }
    }

    // Populate view options and set selected view
    populateViewSelectOptions();
    const viewSelect = document.getElementById('suite_view');
    if (viewSelect && suite.view_id) {
        viewSelect.value = suite.view_id;
    }

    // Clear and repopulate Environment Parameters
    const paramsContainer = document.getElementById('parameters-container');
    if (paramsContainer) {
        paramsContainer.innerHTML = '';
        if (suite.parameters && suite.parameters.length > 0) {
            suite.parameters.forEach(param => {
                addParameterInput(param.key, param.value);
            });
        }
    }

    // Clear and repopulate External Test Inputs (Mock Files)
    const filesContainer = document.getElementById('input-files-container');
    if (filesContainer) {
        filesContainer.innerHTML = '';
        if (suite.input_files && suite.input_files.length > 0) {
            suite.input_files.forEach(file => {
                addInputFile(file.filename, file.content);
            });
        }
    }
    // Load tags for editing
    currentEditTags = suite.tags || [];
    renderTagsInEditor();

    // Initialize Data Set Tab
    updateDataSetDropdown(suite.dataSetId);
    switchEditorTab('code');

    const dataSetSelect = document.getElementById('suite_data_set');
    if (dataSetSelect) {
        dataSetSelect.onchange = (e) => updateDataSetDropdown(e.target.value);
    }

    const suiteModal = document.getElementById('suite-modal');
    if (suiteModal) {
        suiteModal.classList.remove('hidden');
        let editorLanguage = suite.language || 'python';
        if (editorLanguage === 'website') {
            editorLanguage = 'robot'; // Website tests use Robot Framework
        }
        scheduleSuiteModalEditorInitialization(editorLanguage, suite.code || '');
    }
}

async function saveSuite(event) {
    event.preventDefault();

    if (!currentStorage) {
        showMessage("Storage not initialized", 'error');
        return;
    }

    // Helper function to safely get element value
    const getElementValue = (id, defaultValue = '') => {
        const el = document.getElementById(id);
        return el ? (el.value || defaultValue) : defaultValue;
    };

    const getElementChecked = (id) => {
        const el = document.getElementById(id);
        return el ? el.checked : false;
    };

    const suite = {
        name: getElementValue('suite_name'),
        description: getElementValue('suite_description'),
        language: getElementValue('suite_language', 'python'),
        code: currentMonacoEditor ? currentMonacoEditor.getValue() : '',
        expected_output: getElementValue('expected_output'),
        mock_builder: getMockBuilderStateFromEditor(),
        webhook_url: getElementValue('webhook_url'),
        integration_info: getElementValue('integration_info'),
        view_id: getElementValue('suite_view') || null,
        dataSetId: getElementValue('suite_data_set') || null,
        execution_mode: executionConfig ? executionConfig.mode : 'real',
        parameters: getParametersFromForm(),
        input_files: getInputFilesFromForm(),
        tags: currentEditTags, // Save tags
        log_config: {
            enabled: getElementChecked('enable_log_saving'),
            filename: getElementValue('log_filename', 'log_{suite_name}_{timestamp}'),
            format: getElementValue('log_format', 'txt'),
            save_trigger: getElementValue('log_save_trigger', 'always')
        }
    };

    // Add website integration data if applicable
    if (suite.language === 'website') {
        const method = document.querySelector('input[name="website-method"]:checked')?.value || 'url';
        suite.website_method = method;

        if (method === 'url') {
            suite.website_url = document.getElementById('website_url').value;
            // Clear file content if we switch to URL
            suite.website_html_content = null;
            suite.website_css_contents = [];
            suite.website_js_contents = [];
        } else if (method === 'upload') {
            // Store the uploaded file contents
            suite.website_html_content = websiteFiles.html;
            suite.website_css_contents = websiteFiles.css;
            suite.website_js_contents = websiteFiles.js;
            // Clear URL if we switch to upload
            suite.website_url = '';
        }
    }

    try {
        let savedSuiteId = null;

        if (editingSuiteId) {
            // Save version before updating existing suite
            const existingSuite = testSuites.find(s => s.id === editingSuiteId);
            if (existingSuite && window.versionControl) {
                window.versionControl.saveVersion(
                    editingSuiteId,
                    existingSuite,
                    'Manual save from editor'
                );
            }
            await currentStorage.updateSuite(editingSuiteId, suite);
            savedSuiteId = editingSuiteId;
            showMessage("Test suite updated successfully", 'success');
        } else {
            savedSuiteId = await currentStorage.saveSuite(suite);
            showMessage("Test suite created successfully", 'success');

            // If graph view was active when creating this test, add it as a node
            if (window._graphViewActiveForNewTest && window.visualEditor && savedSuiteId) {
                // Find the saved suite from the updated list
                const savedSuite = testSuites.find(s => s.id === savedSuiteId) || { id: savedSuiteId, name: suite.name };
                window.visualEditor.addTestNode(savedSuite);

                // Also refresh the available suites list in the sidebar
                if (window.testSuites) {
                    window.visualEditor.setAvailableSuites(window.testSuites);
                }
            }
        }

        // Clear the graph view flag
        window._graphViewActiveForNewTest = false;

        closeEditorModal();
    } catch (error) {
        console.error("Save error:", error);
        showMessage("Failed to save: " + error.message, 'error');
    }
}

async function duplicateSuite(suiteId) {
    if (!currentStorage) {
        showMessage("Storage not initialized", 'error');
        return;
    }

    // Find the original suite data from our local cache
    const originalSuite = testSuites.find(s => s.id === suiteId);
    if (!originalSuite) {
        showMessage('Original suite not found to duplicate!', 'error');
        return;
    }

    // 1. Create a copy of the suite object using the spread syntax.
    // 2. IMPORTANT: We remove the 'id' property. This tells the saveSuite
    // function that this is a NEW suite, so it will generate a new unique ID.
    const { id, ...suiteDataToCopy } = originalSuite;

    // 3. Append "(Copy)" to the name to avoid confusion.
    suiteDataToCopy.name = `${originalSuite.name} (Copy)`;

    // 4. Reset run history for the new copy.
    suiteDataToCopy.last_run_status = 'NEVER_RUN';
    suiteDataToCopy.last_run_time = null;
    suiteDataToCopy.last_run_log = '';

    try {
        // 5. Use the existing saveSuite function to create the new suite.
        await currentStorage.saveSuite(suiteDataToCopy);
        showMessage("Test suite duplicated successfully!", 'success');
    } catch (error) {
        console.error("Duplication error:", error);
        showMessage("Failed to duplicate suite: " + error.message, 'error');
    }
}

async function deleteSuite(suiteId) {
    if (!confirm('Are you sure you want to delete this test suite?')) {
        return;
    }

    // Ask if user wants to keep version history
    const keepHistory = confirm(
        'Do you want to keep the version history for this suite?\n' +
        '(You can restore it later from the version archive)'
    );

    try {
        await currentStorage.deleteSuite(suiteId);

        // Delete version history if user chose not to keep it
        if (!keepHistory && window.versionControl) {
            window.versionControl.deleteVersionHistory(suiteId);
        }

        showMessage("Test suite deleted", 'success');
    } catch (error) {
        console.error("Delete error:", error);
        showMessage("Failed to delete: " + error.message, 'error');
    }
}

// ============================================
// PARAMETERS & INPUT FILES
// ============================================

function addParameterInput(key = '', value = '') {
    const container = document.getElementById('parameters-container');
    const id = 'param-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

    const div = document.createElement('div');
    div.className = 'flex space-x-2';
    div.id = id;
    div.innerHTML = `
 <input type="text" placeholder="Key" value="${escapeHtml(key)}" 
 class="flex-1 bg-gray-700 border border-gray-600 text-white p-2 rounded text-sm">
 <input type="text" placeholder="Value" value="${escapeHtml(value)}" 
 class="flex-1 bg-gray-700 border border-gray-600 text-white p-2 rounded text-sm">
 <button type="button" onclick="document.getElementById('${id}').remove()" 
 class="bg-red-600 hover:bg-red-500 text-white px-3 rounded text-sm">×</button>
 `;
    container.appendChild(div);
}

function getParametersFromForm() {
    const container = document.getElementById('parameters-container');
    const params = [];
    container.querySelectorAll('div').forEach(div => {
        const inputs = div.querySelectorAll('input[type="text"]');
        if (inputs.length === 2 && inputs[0].value && inputs[1].value) {
            params.push({
                key: inputs[0].value,
                value: inputs[1].value
            });
        }
    });
    return params;
}

function addInputFile(filename = '', content = '') {
    const container = document.getElementById('input-files-container');
    const id = 'file-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    const fileInputId = 'file-input-' + id;

    const div = document.createElement('div');
    div.className = 'p-3 bg-gray-700 rounded border border-gray-600';
    div.id = id;
    div.innerHTML = `
 <div class="flex justify-between items-center mb-2">
 <input type="text" id="${id}-filename" placeholder="Filename (e.g., test_data.csv)" value="${escapeHtml(filename)}" 
 class="flex-1 bg-gray-800 border border-gray-600 text-white p-2 rounded text-sm mr-2">
 <label for="${fileInputId}" 
 class="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-sm cursor-pointer whitespace-nowrap mr-2">
 Browse...
 </label>
 <input type="file" id="${fileInputId}" class="hidden">
 <button type="button" onclick="document.getElementById('${id}').remove()" 
 class="bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded text-sm">Remove</button>
 </div>
 <textarea id="${id}-content" placeholder="File content (or click Browse to load a file)..." rows="3" 
 class="w-full bg-gray-800 border border-gray-600 text-white p-2 rounded text-sm font-mono">${escapeHtml(content)}</textarea>
 <div id="${id}-file-info" class="text-xs text-gray-400 mt-1"></div>
 `;
    container.appendChild(div);

    const fileInput = document.getElementById(fileInputId);
    fileInput.addEventListener('change', function (e) {
        handleFileLoad(e, id);
    });
}

function handleFileLoad(event, containerId) {
    const file = event.target.files[0];
    if (!file) return;

    const filenameInput = document.getElementById(`${containerId}-filename`);
    const contentTextarea = document.getElementById(`${containerId}-content`);
    const fileInfo = document.getElementById(`${containerId}-file-info`);

    filenameInput.value = file.name;
    fileInfo.textContent = `Loading ${file.name}...`;

    const reader = new FileReader();

    const isBinary = file.type.startsWith('image/') ||
        file.type.startsWith('video/') ||
        file.type.startsWith('audio/') ||
        file.name.match(/\.(exe|bin|zip|tar|gz|pdf|doc|docx|xls|xlsx)$/i);

    reader.onload = function (e) {
        if (isBinary) {
            const base64 = btoa(
                new Uint8Array(e.target.result)
                    .reduce((data, byte) => data + String.fromCharCode(byte), '')
            );
            contentTextarea.value = `[Binary file - Base64 encoded]\n${base64}`;
            fileInfo.innerHTML = `Loaded: <strong>${file.name}</strong> (${formatFileSize(file.size)}) - Binary file encoded as Base64`;
        } else {
            contentTextarea.value = e.target.result;
            fileInfo.innerHTML = `Loaded: <strong>${file.name}</strong> (${formatFileSize(file.size)})`;
        }
    };

    reader.onerror = function () {
        fileInfo.innerHTML = `Error loading file: ${file.name}`;
        contentTextarea.value = '';
    };

    if (isBinary) {
        reader.readAsArrayBuffer(file);
    } else {
        reader.readAsText(file);
    }

    event.target.value = '';
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function getInputFilesFromForm() {
    const container = document.getElementById('input-files-container');
    const files = [];
    container.querySelectorAll('div[id^="file-"]').forEach(div => {
        const id = div.id;
        const filenameInput = document.getElementById(`${id}-filename`);
        const contentTextarea = document.getElementById(`${id}-content`);

        if (filenameInput && contentTextarea) {
            const filename = filenameInput.value;
            const content = contentTextarea.value;

            if (filename && content) {
                files.push({ filename, content });
            }
        }
    });
    return files;
}


// ============================================
// LOG FILE MANAGEMENT
// ============================================

let currentLogData = null;
let currentSuiteForLog = null;

function formatLogFilename(pattern, suite, status) {
    const now = new Date();
    const timestamp = now.getTime();
    const date = now.toISOString().split('T')[0];
    const time = now.toTimeString().split(' ')[0].replace(/:/g, '-');

    return pattern
        .replace('{suite_name}', suite.name.replace(/[^a-zA-Z0-9]/g, '_'))
        .replace('{timestamp}', timestamp)
        .replace('{date}', date)
        .replace('{time}', time)
        .replace('{status}', status.toLowerCase());
}

function formatLogContent(logText, format, suite, status) {
    const now = new Date();

    switch (format) {
        case 'json':
            return JSON.stringify({
                suite_name: suite.name,
                description: suite.description,
                language: suite.language,
                timestamp: now.toISOString(),
                status: status,
                execution_mode: executionConfig.mode,
                parameters: suite.parameters || [],
                log: logText
            }, null, 2);

        case 'html':
            return `<!DOCTYPE html>
<html>
<head>
 <meta charset="UTF-8">
 <title>Test Log - ${suite.name}</title>
 <style>
 body { font-family: 'Courier New', monospace; background: #1a1a1a; color: #00ff00; padding: 20px; }
 .header { background: #2d2d2d; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
 .header h1 { margin: 0; color: #00ff00; }
 .header .meta { color: #888; font-size: 12px; margin-top: 10px; }
 .status-success { color: #00ff00; }
 .status-failure { color: #ff0000; }
 .log-content { background: #0d0d0d; padding: 15px; border-radius: 5px; white-space: pre-wrap; }
 </style>
</head>
<body>
 <div class="header">
 <h1>Test Execution Log</h1>
 <div class="meta">
 <strong>Suite:</strong> ${suite.name}<br>
 <strong>Language:</strong> ${suite.language}<br>
 <strong>Date:</strong> ${now.toLocaleString()}<br>
 <strong>Status:</strong> <span class="status-${status.toLowerCase()}">${status}</span>
 </div>
 </div>
 <div class="log-content">${logText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
</body>
</html>`;

        case 'xml':
            return `<?xml version="1.0" encoding="UTF-8"?>
<test-execution>
 <suite name="${suite.name}" language="${suite.language}">
 <timestamp>${now.toISOString()}</timestamp>
 <status>${status}</status>
 <mode>${executionConfig.mode}</mode>
 <log><![CDATA[
${logText}
 ]]></log>
 </suite>
</test-execution>`;

        case 'md':
            return `# Test Execution Log

**Suite:** ${suite.name} 
**Language:** ${suite.language} 
**Date:** ${now.toLocaleString()} 
**Status:** ${status}

## Execution Log

\`\`\`
${logText}
\`\`\`
`;

        default:
            return logText;
    }
}

function autoSaveLogIfNeeded(suite, log, status) {
    if (!suite.log_config || !suite.log_config.enabled) {
        return;
    }

    const trigger = suite.log_config.save_trigger || 'always';

    let shouldSave = false;
    if (trigger === 'always') {
        shouldSave = true;
    } else if (trigger === 'failure' && status === 'FAILURE') {
        shouldSave = true;
    } else if (trigger === 'success' && status === 'SUCCESS') {
        shouldSave = true;
    }

    if (!shouldSave) return;

    const format = suite.log_config.format || 'txt';
    const extension = format === 'txt' ? 'txt' : format;
    const filename = formatLogFilename(suite.log_config.filename || 'log_{suite_name}_{timestamp}', suite, status) + '.' + extension;
    const content = formatLogContent(log, format, suite, status);

    // Trigger download
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function downloadCurrentLog() {
    if (!currentLogData || !currentSuiteForLog) {
        showMessage('No log data available', 'error');
        return;
    }

    const suite = currentSuiteForLog;
    const format = suite.log_config && suite.log_config.enabled ? suite.log_config.format : 'txt';
    const extension = format === 'txt' ? 'txt' : format;
    const filename = (suite.log_config && suite.log_config.enabled)
        ? formatLogFilename(suite.log_config.filename, suite, currentLogData.status) + '.' + extension
        : `${suite.name.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.txt`;

    const content = (suite.log_config && suite.log_config.enabled)
        ? formatLogContent(currentLogData.log, format, suite, currentLogData.status)
        : currentLogData.log;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    showMessage('Log downloaded', 'success');
}


// ============================================
// TEST EXECUTION
// ============================================

async function executeSuiteCore(suite) {
    try {
        const validationApi = getExecutionValidationApi();
        const mockRuntimeApi = getMockRuntimeApi();
        const validationSource = validationApi.getSuiteValidationSource(suite);
        const inputFiles = suite.input_files || suite.inputFiles || [];
        const runtimePlan = suite.mockRuntimePlan || mockRuntimeApi.buildSuiteExecutionPlan(suite, suite.contextVariables || {});
        const runtimeContextVariables = {
            ...(runtimePlan.baseContextVariables || {}),
            ...((suite.contextVariables && typeof suite.contextVariables === 'object') ? suite.contextVariables : {})
        };

        // Replace environment variables
        const codeWithEnvironment = window.environmentManager
            ? window.environmentManager.replaceEnvironmentVariables(suite.code)
            : suite.code;
        const codeToExecute = mockRuntimeApi.resolveTemplateVariables(codeWithEnvironment, runtimeContextVariables);
        const resolvedValidationSource = mockRuntimeApi.resolveTemplateVariables(validationSource, runtimeContextVariables);

        let result;
        if (suite.language === 'python') {
            result = await executePythonCode(codeToExecute, inputFiles, runtimeContextVariables, resolvedValidationSource);
        } else if (suite.language === 'robot') {
            if (executionConfig.robotType === 'browser') {
                result = await executeRobotFrameworkBrowser(codeToExecute);
            } else if (executionConfig.robotType === 'backend') {
                result = await executeRobotFrameworkBackend(codeToExecute);
            } else {
                result = await executeRobotFrameworkApi(codeToExecute);
            }
        } else if (suite.language === 'java') {
            result = await executeJavaCode(codeToExecute, inputFiles);
        } else if (suite.language === 'csharp') {
            result = await executeCSharpCode(codeToExecute, inputFiles);
        } else if (suite.language === 'website') {
            // For website integration, we might need to handle variable replacement differently 
            // if it uses specific fields, but for now we assume code replacement is sufficient 
            // or handled within executeWebsiteIntegration if it uses suite.code
            const suiteWithEnv = { ...suite, code: codeToExecute };
            result = await executeWebsiteIntegration(suiteWithEnv);
        } else if (suite.language === 'playwright') {
            if (window.electronAPI && window.electronAPI.runPlaywrightTest) {
                // Call Electron Backend
                const backendResult = await window.electronAPI.runPlaywrightTest(codeToExecute);
                result = {
                    success: backendResult.status === 'SUCCESS',
                    output: backendResult.logs,
                    error: backendResult.status === 'SUCCESS' ? null : backendResult.logs
                };
            } else {
                throw new Error("Playwright execution is only available in the Desktop App (Electron).");
            }
        } else if (suite.language === 'security') {
            // Security Test - run SAST and Secrets scanning
            if (!window.securityManager) {
                throw new Error("Security manager not loaded. Please reload the application.");
            }

            const scanConfig = suite.securityConfig || {};
            const scanLanguage = scanConfig.scanLanguage || 'javascript';
            const scanTypes = scanConfig.scanTypes || ['sast', 'secrets'];

            const scanResult = await window.securityManager.runCodeScan(codeToExecute, {
                language: scanLanguage,
                scanTypes: scanTypes,
                name: suite.name
            });

            // Build output
            let output = `🔒 Security Scan Results\n`;
            output += `========================\n\n`;
            output += `Policy Status: ${scanResult.policyPassed ? '✅ PASSED' : '❌ FAILED'}\n\n`;
            output += `Vulnerability Summary:\n`;
            output += `  🔴 Critical: ${scanResult.summary.critical}\n`;
            output += `  🟠 High: ${scanResult.summary.high}\n`;
            output += `  🟡 Medium: ${scanResult.summary.medium}\n`;
            output += `  🟢 Low: ${scanResult.summary.low}\n`;
            output += `  Total: ${scanResult.summary.total}\n\n`;

            if (scanResult.vulnerabilities && scanResult.vulnerabilities.length > 0) {
                output += `\nVulnerabilities Found:\n`;
                output += `----------------------\n`;
                scanResult.vulnerabilities.forEach((vuln, i) => {
                    output += `\n${i + 1}. [${vuln.severity}] ${vuln.ruleName || vuln.type}\n`;
                    output += `   Line ${vuln.line}: ${vuln.description}\n`;
                    if (vuln.recommendation) {
                        output += `   Fix: ${vuln.recommendation}\n`;
                    }
                });
            }

            result = {
                success: scanResult.policyPassed,
                output: output,
                error: scanResult.policyPassed ? null : `Found ${scanResult.summary.total} vulnerabilities, policy failed`
            };
        } else {
            throw new Error(`Unsupported language: ${suite.language}`);
        }

        if (suite.language !== 'python' && result.success && resolvedValidationSource) {
            const normalizedActual = validationApi.normalizeExecutionText(result.output || '');
            const normalizedExpected = validationApi.normalizeExecutionText(resolvedValidationSource);
            if (normalizedActual !== normalizedExpected) {
                result = {
                    ...result,
                    success: false,
                    error: validationApi.buildOutputMismatchMessage(normalizedExpected, normalizedActual)
                };
            }
        }

        return {
            status: result.success ? 'SUCCESS' : 'FAILURE',
            output: result.output || '',
            error: result.error || null,
            artifacts: {
                ...runtimeContextVariables,
                ...(result.artifacts || {}),
                mockExecutionContext: runtimeContextVariables
            }
        };
    } catch (error) {
        return {
            status: 'FAILURE',
            output: '',
            error: error.message
        };
    }
}

async function runMockBuilderFileDataDrivenTest(suite, runtimePlan, silent = false) {
    const mockRuntimeApi = getMockRuntimeApi();
    const startTime = Date.now();
    const iterations = Array.isArray(runtimePlan?.iterations) ? runtimePlan.iterations : [];

    if (!silent) {
        document.getElementById('run-modal').classList.remove('hidden');
        document.getElementById('run-modal-title').textContent = 'Run Test Suite';
        document.getElementById('run-modal-content').textContent = `Initializing Mock Builder execution with ${iterations.length} row(s)...`;
        document.getElementById('run-status-indicator').innerHTML = '<span class="text-yellow-400"><div class="spinner"></div> Running...</span>';
        updateRunProgress(0, iterations.length, `Preparing row 1 of ${iterations.length}...`);
    }

    let totalLog = `=== MOCK BUILDER EXECUTION LOG ===\n`;
    totalLog += `Suite: ${suite.name}\n`;
    totalLog += `Iterations: ${iterations.length}\n`;
    totalLog += `Started: ${new Date().toLocaleString()}\n\n`;

    let successCount = 0;
    let failureCount = 0;
    let lastArtifacts = {};

    for (let index = 0; index < iterations.length; index += 1) {
        const iteration = iterations[index] || {};
        const rowContextVariables = iteration.contextVariables || {};
        const iterationPlan = {
            ...runtimePlan,
            baseContextVariables: rowContextVariables,
            iterations: [],
            hasFileIterations: false
        };

        if (!silent) {
            document.getElementById('run-status-indicator').innerHTML =
                `<span class="text-yellow-400"><div class="spinner"></div> Running Row ${index + 1}/${iterations.length}...</span>`;
            updateRunProgress(index, iterations.length, `Running row ${index + 1} of ${iterations.length}...`);
        }

        totalLog += `[ROW ${index + 1}] ${iteration.label || `Row ${index + 1}`}\n`;

        const visibleVariables = Object.keys(rowContextVariables)
            .filter(key => key.startsWith('test_'))
            .sort();
        if (visibleVariables.length) {
            totalLog += `Variables: ${visibleVariables.map(key => `${key}=${JSON.stringify(rowContextVariables[key])}`).join(', ')}\n`;
        }

        if (iterationPlan.beforeDelayMs > 0) {
            totalLog += `Before-delay: ${iterationPlan.beforeDelayMs}ms\n`;
            if (!silent) {
                document.getElementById('run-modal-content').textContent = totalLog;
            }
            await mockRuntimeApi.delay(iterationPlan.beforeDelayMs);
        }

        const result = await executeSuiteCore({
            ...suite,
            contextVariables: rowContextVariables,
            mockRuntimePlan: iterationPlan
        });
        lastArtifacts = result.artifacts || {};

        totalLog += `Status: ${result.status}\n`;
        if (result.status === 'SUCCESS') {
            successCount += 1;
        } else {
            failureCount += 1;
        }

        totalLog += `Output:\n${result.output || ''}\n`;
        if (result.error) {
            totalLog += `Error:\n${result.error}\n`;
        }

        if (iterationPlan.afterDelayMs > 0) {
            totalLog += `After-delay: ${iterationPlan.afterDelayMs}ms\n`;
            if (!silent) {
                document.getElementById('run-modal-content').textContent = totalLog;
            }
            await mockRuntimeApi.delay(iterationPlan.afterDelayMs);
        }

        totalLog += '-----------------------------------\n';

        if (!silent) {
            document.getElementById('run-modal-content').textContent = totalLog;
        }
    }

    const finalStatus = failureCount === 0 ? 'SUCCESS' : 'FAILURE';
    totalLog += `\n=== SUMMARY ===\n`;
    totalLog += `Total Rows: ${iterations.length}\n`;
    totalLog += `Success: ${successCount}\n`;
    totalLog += `Failure: ${failureCount}\n`;
    totalLog += `Final Status: ${finalStatus}\n`;

    if (!silent) {
        document.getElementById('run-modal-content').textContent = totalLog;
        document.getElementById('run-status-indicator').innerHTML = finalStatus === 'SUCCESS'
            ? '<span class="text-green-400">Completed</span>'
            : '<span class="text-red-400">Failed</span>';
        updateRunProgress(iterations.length, iterations.length, `Finished ${iterations.length} of ${iterations.length} rows`);
    }

    suite.last_run_status = finalStatus;
    suite.last_run_time = new Date().toISOString();
    suite.last_run_log = totalLog;
    await currentStorage.saveSuite(suite);

    autoSaveLogIfNeeded(suite, totalLog, finalStatus);

    currentLogData = { log: totalLog, status: finalStatus };
    currentSuiteForLog = suite;

    if (window.testHistoryManager) {
        window.testHistoryManager.recordExecution(suite.id, suite.name, {
            status: finalStatus === 'SUCCESS' ? 'PASSED' : 'FAILED',
            executionTime: Date.now() - startTime,
            errorMessage: failureCount > 0 ? `${failureCount} iteration(s) failed` : null,
            iterationCount: iterations.length,
            passedIterations: successCount,
            failedIterations: failureCount
        });
    }

    if (window.integrationsManager && !silent) {
        const testResult = {
            suiteId: suite.id,
            suiteName: suite.name,
            status: finalStatus === 'SUCCESS' ? 'PASSED' : 'FAILED',
            executionTime: Date.now() - startTime,
            timestamp: new Date().toISOString(),
            errorMessage: failureCount > 0 ? `${failureCount} of ${iterations.length} iteration(s) failed` : null,
            iterationCount: iterations.length,
            passedIterations: successCount,
            failedIterations: failureCount
        };

        const integrations = window.integrationsManager.getEnabledIntegrations();
        const shouldNotify = integrations.some(integration => {
            if (integration.notifyOnAll) return true;
            if (integration.notifyOnFailure && testResult.status === 'FAILED') return true;
            if (integration.notifyOnSuccess && testResult.status === 'PASSED') return true;
            return false;
        });

        if (shouldNotify) {
            window.integrationsManager.sendNotification(testResult).catch(error => {
                console.error('Failed to send notifications:', error);
            });
        }
    }

    renderTestSuites(testSuites);

    return { status: finalStatus, log: totalLog, artifacts: lastArtifacts };
}

async function runDataDrivenTest(suite, dataSet, silent = false, baseInputs = {}) {
    const mockRuntimeApi = getMockRuntimeApi();
    const startTime = Date.now();

    if (!silent) {
        document.getElementById('run-modal').classList.remove('hidden');
        document.getElementById('run-modal-title').textContent = 'Run Test Suite';
        document.getElementById('run-modal-content').textContent = `Initializing Data-Driven Test with ${dataSet.data.length} rows...`;
        document.getElementById('run-status-indicator').innerHTML = '<span class="text-yellow-400"><div class="spinner"></div> Running...</span>';
        updateRunProgress(0, dataSet.data.length, `Preparing row 1 of ${dataSet.data.length}...`);
    }

    let totalLog = `=== DATA-DRIVEN EXECUTION LOG ===\n`;
    totalLog += `Suite: ${suite.name}\n`;
    totalLog += `Data Set: ${dataSet.name} (${dataSet.data.length} rows)\n`;
    totalLog += `Started: ${new Date().toLocaleString()}\n\n`;

    let successCount = 0;
    let failureCount = 0;
    let lastArtifacts = {};

    for (let i = 0; i < dataSet.data.length; i++) {
        const row = dataSet.data[i];
        const rowLogPrefix = `[ROW ${i + 1}] `;
        const rowInputs = {
            ...(baseInputs || {}),
            ...row,
            DATA_ROW: row
        };
        const perRowPlan = mockRuntimeApi.buildSuiteExecutionPlan(suite, rowInputs);

        if (!silent) {
            document.getElementById('run-status-indicator').innerHTML =
                `<span class="text-yellow-400"><div class="spinner"></div> Running Row ${i + 1}/${dataSet.data.length}...</span>`;
            updateRunProgress(i, dataSet.data.length, `Running row ${i + 1} of ${dataSet.data.length}...`);
        }

        const substitutedCode = window.dataManager.replaceVariables(suite.code, row);
        const substitutedValidation = window.dataManager.replaceVariables(suite.expected_output || '', row);
        const tempSuite = {
            ...suite,
            code: substitutedCode,
            expected_output: substitutedValidation,
            contextVariables: perRowPlan.baseContextVariables,
            mockRuntimePlan: {
                ...perRowPlan,
                iterations: [],
                hasFileIterations: false
            }
        };

        if (perRowPlan.beforeDelayMs > 0) {
            totalLog += `${rowLogPrefix} Before-delay: ${perRowPlan.beforeDelayMs}ms\n`;
            if (!silent) {
                document.getElementById('run-modal-content').textContent = totalLog;
            }
            await mockRuntimeApi.delay(perRowPlan.beforeDelayMs);
        }

        const result = await executeSuiteCore(tempSuite);
        lastArtifacts = result.artifacts || {};

        totalLog += `${rowLogPrefix} Status: ${result.status}\n`;
        if (result.status === 'SUCCESS') successCount++;
        else failureCount++;

        totalLog += `Output:\n${result.output}\n`;
        if (result.error) totalLog += `Error:\n${result.error}\n`;

        if (perRowPlan.afterDelayMs > 0) {
            totalLog += `${rowLogPrefix} After-delay: ${perRowPlan.afterDelayMs}ms\n`;
            if (!silent) {
                document.getElementById('run-modal-content').textContent = totalLog;
            }
            await mockRuntimeApi.delay(perRowPlan.afterDelayMs);
        }

        totalLog += '-----------------------------------\n';

        if (!silent) {
            document.getElementById('run-modal-content').textContent = totalLog;
        }
    }

    const finalStatus = failureCount === 0 ? 'SUCCESS' : 'FAILURE';
    totalLog += `\n=== SUMMARY ===\n`;
    totalLog += `Total Rows: ${dataSet.data.length}\n`;
    totalLog += `Success: ${successCount}\n`;
    totalLog += `Failure: ${failureCount}\n`;
    totalLog += `Final Status: ${finalStatus}\n`;

    if (!silent) {
        document.getElementById('run-modal-content').textContent = totalLog;
    }

    const statusHtml = finalStatus === 'SUCCESS'
        ? '<span class="text-green-500">✔ Success</span>'
        : '<span class="text-red-500">✘ Failure</span>';
    if (!silent) {
        document.getElementById('run-status-indicator').innerHTML = statusHtml;
        updateRunProgress(dataSet.data.length, dataSet.data.length, `Finished ${dataSet.data.length} of ${dataSet.data.length} rows`);
    }

    suite.last_run_status = finalStatus;
    suite.last_run_time = new Date().toISOString();
    suite.last_run_log = totalLog;
    await currentStorage.saveSuite(suite);

    autoSaveLogIfNeeded(suite, totalLog, finalStatus);

    currentLogData = { log: totalLog, status: finalStatus };
    currentSuiteForLog = suite;

    // Record execution in history
    if (window.testHistoryManager) {
        const executionResult = {
            status: finalStatus === 'SUCCESS' ? 'PASSED' : 'FAILED',
            executionTime: Date.now() - startTime,
            errorMessage: failureCount > 0 ? `${failureCount} iteration(s) failed` : null,
            iterationCount: dataSet.data.length,
            passedIterations: successCount,
            failedIterations: failureCount
        };
        window.testHistoryManager.recordExecution(suite.id, suite.name, executionResult);
    }

    // Send notifications
    if (window.integrationsManager && !silent) {
        const testResult = {
            suiteId: suite.id,
            suiteName: suite.name,
            status: finalStatus === 'SUCCESS' ? 'PASSED' : 'FAILED',
            executionTime: Date.now() - startTime,
            timestamp: new Date().toISOString(),
            errorMessage: failureCount > 0 ? `${failureCount} of ${dataSet.data.length} iteration(s) failed` : null,
            iterationCount: dataSet.data.length,
            passedIterations: successCount,
            failedIterations: failureCount
        };

        // Check if any integration wants to be notified
        const integrations = window.integrationsManager.getEnabledIntegrations();
        const shouldNotify = integrations.some(integration => {
            if (integration.notifyOnAll) return true;
            if (integration.notifyOnFailure && testResult.status === 'FAILED') return true;
            if (integration.notifyOnSuccess && testResult.status === 'PASSED') return true;
            return false;
        });

        if (shouldNotify) {
            // Send notifications asynchronously without blocking test execution
            window.integrationsManager.sendNotification(testResult).catch(error => {
                console.error('Failed to send notifications:', error);
            });
        }
    }

    renderTestSuites(testSuites);

    return { status: finalStatus, log: totalLog, artifacts: lastArtifacts };
}

async function runTestSuite(suiteId, silent = false, inputs = {}) {
    const suite = testSuites.find(s => s.id === suiteId);
    if (!suite) {
        if (!silent) showMessage('Suite not found', 'error');
        return { status: 'FAILURE', log: 'Suite not found' };
    }

    // *** NEW LOGIC: Reroute Visual Web Tests to the Live Runner ***
    if (suite.language === 'website' && suite.website_method === 'upload' && !silent) {
        if (typeof vwt_openLiveRunner === 'function') {
            vwt_openLiveRunner(suite);
            return { status: 'PENDING', log: 'Opened in Visual Runner' };
        }
    }

    const mockRuntimeApi = getMockRuntimeApi();
    const runtimePlan = mockRuntimeApi.buildSuiteExecutionPlan(suite, inputs);

    if (runtimePlan.hasFileIterations) {
        return await runMockBuilderFileDataDrivenTest(suite, runtimePlan, silent);
    }

    // Check for Data Set
    if (suite.dataSetId) {
        const dataSet = window.dataManager.getDataSet(suite.dataSetId);
        if (dataSet && dataSet.data.length > 0) {
            return await runDataDrivenTest(suite, dataSet, silent, runtimePlan.baseContextVariables);
        }
    }

    if (!silent) {
        document.getElementById('run-modal').classList.remove('hidden');
        document.getElementById('run-modal-title').textContent = 'Run Test Suite';
        document.getElementById('run-modal-content').textContent = 'Initializing...';
        document.getElementById('run-status-indicator').innerHTML = '<span class="text-yellow-400"><div class="spinner"></div> Running...</span>';
        updateRunProgress(0, 1, 'Running test 1 of 1...');
    }

    const startTime = new Date();
    let log = `=== PIPELINE EXECUTION LOG ===\n`;
    log += `Suite: ${suite.name}\n`;
    log += `Language: ${suite.language}\n`;
    log += `Mode: ${executionConfig.mode}\n`;
    log += `Started: ${formatTime(startTime)}\n`;
    log += `--- PIPELINE STARTED ---\n\n`;

    let status = 'SUCCESS';
    let executionOutput = '';

    let result = null;

    if (executionConfig.mode === 'real') {
        log += `[EXECUTION] Running ${suite.language} code...\n\n`;
        if (!silent) document.getElementById('run-modal-content').textContent = log;

        if (runtimePlan.beforeDelayMs > 0) {
            log += `[SETUP] Waiting ${runtimePlan.beforeDelayMs}ms before execution...\n`;
            if (!silent) document.getElementById('run-modal-content').textContent = log;
            await mockRuntimeApi.delay(runtimePlan.beforeDelayMs);
        }

        // Inject inputs into suite object for core execution
        const suiteWithInputs = {
            ...suite,
            contextVariables: runtimePlan.baseContextVariables,
            mockRuntimePlan: runtimePlan
        };
        result = await executeSuiteCore(suiteWithInputs);

        log += `[OUTPUT]\n${result.output}\n`;
        if (result.error) {
            log += `[STDERR]\n${result.error}\n`;
        }

        status = result.status;
        executionOutput = result.output;

        // Check for error indicators in output if status is SUCCESS but output looks suspicious
        if (status === 'SUCCESS') {
            const errorIndicators = ['error', 'exception', 'failed', 'failure'];
            const hasErrorInOutput = errorIndicators.some(indicator =>
                (result.output || '').toLowerCase().includes(indicator) ||
                (result.error || '').toLowerCase().includes(indicator)
            );

            if (hasErrorInOutput) {
                status = 'FAILURE';
                log += `[WARNING] Error indicators detected in output despite successful execution.\n`;
            }
        }

        if (runtimePlan.afterDelayMs > 0) {
            log += `[TEARDOWN] Waiting ${runtimePlan.afterDelayMs}ms after execution...\n`;
            if (!silent) document.getElementById('run-modal-content').textContent = log;
            await mockRuntimeApi.delay(runtimePlan.afterDelayMs);
        }

    } else {
        // Simulated mode
        log += `[CODE] Displaying code (simulation mode)...\n\n`;
        if (suite.code) {
            const resolvedCode = mockRuntimeApi.resolveTemplateVariables(suite.code, runtimePlan.baseContextVariables);
            log += resolvedCode.split('\n').map(line => ` ${line}`).join('\n');
        } else {
            log += ` (no code defined)`;
        }
        log += `\n\n[RESULT] Simulated execution completed.\n`;
        await new Promise(r => setTimeout(r, 1500));
    }

    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    log += `\n[STATUS] ${status}: ${status === 'SUCCESS' ? 'All tests passed.' : 'Execution encountered errors.'}\n\n`;
    log += `--- PIPELINE END-\n`;
    log += `Duration: ${duration}s. Final Status: ${status}`;

    if (!silent) {
        document.getElementById('run-modal-content').textContent = log;
        document.getElementById('run-status-indicator').innerHTML = status === 'SUCCESS' ?
            '<span class="text-green-400">Completed</span>' :
            '<span class="text-red-400">Failed</span>';
        updateRunProgress(1, 1, 'Finished test 1 of 1');

        // Store log data for download
        currentLogData = { log: log, status: status };
        currentSuiteForLog = suite;
    }

    // Auto-save log if configured
    autoSaveLogIfNeeded(suite, log, status);

    // Record execution in history
    if (window.testHistoryManager) {
        // Check if result is defined in this scope, if not use status
        const errorMsg = status === 'FAILURE' ? 'Test failed' : null;

        const executionResult = {
            status: status === 'SUCCESS' ? 'PASSED' : 'FAILED',
            executionTime: endTime - startTime,
            errorMessage: errorMsg,
            iterationCount: 1
        };
        window.testHistoryManager.recordExecution(suite.id, suite.name, executionResult);
    }

    // Send notifications
    if (window.integrationsManager && !silent) {
        const testResult = {
            suiteId: suite.id,
            suiteName: suite.name,
            status: status === 'SUCCESS' ? 'PASSED' : 'FAILED',
            executionTime: Math.floor(endTime - startTime),
            timestamp: new Date().toISOString(),
            errorMessage: status === 'FAILURE' ? 'Test failed' : null
        };

        // Check if any integration wants to be notified
        const integrations = window.integrationsManager.getEnabledIntegrations();
        const shouldNotify = integrations.some(integration => {
            if (integration.notifyOnAll) return true;
            if (integration.notifyOnFailure && testResult.status === 'FAILED') return true;
            if (integration.notifyOnSuccess && testResult.status === 'PASSED') return true;
            return false;
        });

        if (shouldNotify) {
            // Send notifications asynchronously without blocking test execution
            window.integrationsManager.sendNotification(testResult).catch(error => {
                console.error('Failed to send notifications:', error);
            });
        }
    }

    try {
        await currentStorage.updateSuite(suiteId, {
            last_run_status: status,
            last_run_time: new Date().toISOString(),
            last_run_log: log
        });
    } catch (error) {
        console.error("Update error:", error);
        if (!silent) showMessage("Failed to update run status: " + error.message, 'error');
    }

    return {
        status: status,
        log: log,
        duration: duration,
        artifacts: (status === 'SUCCESS' && executionConfig.mode === 'real' && result) ? result.artifacts : {}
    };
}

// Expose runTestSuite globally
window.runTestSuite = runTestSuite;

function closeRunModal() {
    document.getElementById('run-modal').classList.add('hidden');
    document.getElementById('run-modal-title').textContent = 'Run Test Suite';
    resetRunProgress();
}

function formatTime(date) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ============================================
// IMPORT/EXPORT
// ============================================

function buildSuiteExportPayload(suiteId) {
    const suite = testSuites.find(item => item.id === suiteId);
    if (!suite) {
        throw new Error('Suite not found');
    }

    const versionHistories = {};
    if (window.versionControl && typeof window.versionControl.getVersionHistory === 'function') {
        const versions = window.versionControl.getVersionHistory(suite.id);
        if (versions && versions.length > 0) {
            versionHistories[suite.id] = versions;
        }
    }

    const matchingView = suite.view_id ? views.find(view => view.id === suite.view_id) : null;

    return {
        exported_at: new Date().toISOString(),
        export_type: 'single_suite',
        export_version: '2.0',
        source_suite_id: suite.id,
        views: matchingView ? [matchingView] : [],
        test_suites: [suite],
        version_histories: versionHistories
    };
}

async function saveJsonPayloadToFile(data, defaultFileName, successMessage) {
    const serialized = JSON.stringify(data, null, 2);

    if (window.electronAPI?.fileOps?.pickSaveFile && window.electronAPI?.fileOps?.writeFile) {
        const saveResult = await window.electronAPI.fileOps.pickSaveFile({
            title: 'Save JSON File',
            defaultFileName,
            filters: [{ name: 'JSON Files', extensions: ['json'] }]
        });

        if (saveResult?.canceled || !saveResult?.filePath) {
            return false;
        }

        await window.electronAPI.fileOps.writeFile(saveResult.filePath, serialized);
        showMessage(successMessage || `Saved ${defaultFileName}`, 'success');
        return true;
    }

    const blob = new Blob([serialized], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = defaultFileName;
    link.click();
    URL.revokeObjectURL(url);
    showMessage(successMessage || `Saved ${defaultFileName}`, 'success');
    return true;
}

async function exportSuiteToJSON(suiteId) {
    try {
        const suite = testSuites.find(item => item.id === suiteId);
        if (!suite) {
            throw new Error('Suite not found');
        }

        const safeName = String(suite.name || 'suite')
            .replace(/[^a-zA-Z0-9_-]+/g, '_')
            .replace(/^_+|_+$/g, '')
            || 'suite';
        const payload = buildSuiteExportPayload(suiteId);
        await saveJsonPayloadToFile(payload, `${safeName}.json`, `Exported suite "${suite.name}"`);
    } catch (error) {
        console.error('Suite export error:', error);
        showMessage(`Failed to export suite: ${error.message}`, 'error');
    }
}

async function importSuiteJsonText(text, sourceName) {
    const summary = await importLegacyJsonText(text, sourceName, {
        persistLastImport: true,
        updateUi: true
    });
    showMessage(formatImportSummaryMessage(summary), 'success');
    return summary;
}

async function importSuiteFromJSON(event) {
    const input = event?.target;

    try {
        if (!currentStorage) {
            throw new Error('Please configure storage first');
        }

        const file = input?.files?.[0];
        if (!file) {
            return null;
        }

        const text = await readFileAsText(file);
        return await importSuiteJsonText(text, file.name);
    } catch (error) {
        console.error('Suite import error:', error);
        showMessage(`Failed to import suite: ${error.message}`, 'error');
        return null;
    } finally {
        if (input) {
            input.value = null;
        }
    }
}

async function importSuiteFile() {
    try {
        if (!currentStorage) {
            throw new Error('Please configure storage first');
        }

        if (!window.electronAPI?.legacyImports?.pickJsonFile) {
            const input = document.getElementById('suite-import-file-input');
            if (input) {
                input.value = '';
                input.click();
            }
            return null;
        }

        const pickedFile = await window.electronAPI.legacyImports.pickJsonFile();
        if (pickedFile?.canceled || !pickedFile?.filePath) {
            return null;
        }

        const fileData = await window.electronAPI.legacyImports.readJsonFile(pickedFile.filePath);
        return await importSuiteJsonText(fileData.content, fileData.fileName);
    } catch (error) {
        console.error('Suite import dialog error:', error);
        showMessage(`Failed to import suite: ${error.message}`, 'error');
        return null;
    }
}

window.exportSuiteToJSON = exportSuiteToJSON;
window.importSuiteFromJSON = importSuiteFromJSON;
window.importSuiteFile = importSuiteFile;

async function exportToJSON() {
    // Collect all version histories from localStorage
    const versionHistories = {};

    if (testSuites && Array.isArray(testSuites)) {
        testSuites.forEach(suite => {
            if (suite.id && window.versionControl) {
                const versions = window.versionControl.getVersionHistory(suite.id);
                if (versions && versions.length > 0) {
                    versionHistories[suite.id] = versions;
                }
            }
        });
    }

    // Export pipelines if they exist
    let pipelines = [];
    try {
        pipelines = getSecureConfigApi().loadConfig('lvx_pipelines', []) || [];
    } catch (e) { console.error("Pipeline export error", e); }

    const data = {
        exported_at: new Date().toISOString(),
        storage_type: storageConfig.type,
        execution_mode: executionConfig.mode,
        views: views,
        test_suites: testSuites,
        pipelines: pipelines,
        version_histories: versionHistories,
        export_version: '2.0'
    };

    const versionCount = Object.keys(versionHistories).reduce((sum, key) => sum + versionHistories[key].length, 0);

    if (window.electronAPI?.sessionExports?.saveExport && window.storageManager?.loadStoragePreferences) {
        try {
            const exportResult = await window.electronAPI.sessionExports.saveExport(
                data,
                window.storageManager.loadStoragePreferences()
            );

            await refreshStorageStatusDisplay({
                sessionExports: exportResult.cleanupSummary,
                deletedCount: exportResult.cleanupSummary?.deletedCount || 0
            });

            if (
                typeof window.refreshStorageDashboard === 'function' &&
                document.getElementById('dashboard-storage-tab')?.classList.contains('active')
            ) {
                await window.refreshStorageDashboard();
            }

            showMessage(
                `Export saved to ${exportResult.fileName}: ${testSuites.length} suite(s), ${pipelines.length} pipeline(s), ${versionCount} version(s)`,
                'success'
            );
            return;
        } catch (error) {
            console.warn('[SessionExport] Falling back to browser download:', error);
        }
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pipeline_suites_export_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);

    showMessage(`Export completed: ${testSuites.length} suite(s), ${pipelines.length} pipeline(s), ${versionCount} version(s)`, 'success');
}

function generateImportedEntityId(prefix) {
    if (window.crypto?.randomUUID) {
        return `${prefix}_${window.crypto.randomUUID()}`;
    }

    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function cloneImportedValue(value) {
    if (value == null || typeof value !== 'object') {
        return value;
    }

    return JSON.parse(JSON.stringify(value));
}

function mergeImportedViews(importedViews = []) {
    if (!Array.isArray(importedViews) || importedViews.length === 0) {
        return { importedCount: 0, viewIdMapping: {} };
    }

    const existingViews = Array.isArray(views) ? views : [];
    const viewIdMapping = {};
    let importedCount = 0;

    importedViews.forEach((rawView, index) => {
        if (!rawView || typeof rawView !== 'object') {
            return;
        }

        const importedView = cloneImportedValue(rawView);
        const fallbackName = `Imported View ${index + 1}`;
        const normalizedName = String(importedView.name || importedView.title || fallbackName).trim() || fallbackName;
        const oldId = importedView.id || null;

        const existingById = oldId ? existingViews.find(view => view.id === oldId) : null;
        if (existingById) {
            viewIdMapping[oldId] = existingById.id;
            return;
        }

        const existingByName = existingViews.find(view => {
            return String(view.name || '').trim().toLowerCase() === normalizedName.toLowerCase();
        });
        if (existingByName) {
            if (oldId) {
                viewIdMapping[oldId] = existingByName.id;
            }
            return;
        }

        let nextId = oldId || generateImportedEntityId('view');
        if (existingViews.some(view => view.id === nextId)) {
            nextId = generateImportedEntityId('view');
        }

        existingViews.push({
            ...importedView,
            id: nextId,
            name: normalizedName
        });

        if (oldId) {
            viewIdMapping[oldId] = nextId;
        }
        viewIdMapping[nextId] = nextId;
        importedCount += 1;
    });

    if (importedCount > 0) {
        views = existingViews;
        saveViewsToStorage();
        renderViews();
    }

    return { importedCount, viewIdMapping };
}

function mergeImportedPipelines(importedPipelines = []) {
    if (!Array.isArray(importedPipelines) || importedPipelines.length === 0) {
        return { importedCount: 0 };
    }

    const secureConfigApi = getSecureConfigApi();
    const existingPipelines = secureConfigApi.loadConfig('lvx_pipelines', []) || [];
    let importedCount = 0;

    importedPipelines.forEach((rawPipeline, index) => {
        if (!rawPipeline || typeof rawPipeline !== 'object') {
            return;
        }

        const importedPipeline = cloneImportedValue(rawPipeline);
        importedPipeline.name = String(importedPipeline.name || `Imported Pipeline ${index + 1}`).trim() || `Imported Pipeline ${index + 1}`;
        importedPipeline.id = importedPipeline.id || generateImportedEntityId('pipeline');
        if (existingPipelines.some(pipeline => pipeline.id === importedPipeline.id)) {
            importedPipeline.id = generateImportedEntityId('pipeline');
        }

        existingPipelines.push(importedPipeline);
        importedCount += 1;
    });

    if (importedCount > 0) {
        secureConfigApi.saveConfig('lvx_pipelines', existingPipelines);
        if (typeof loadPipelines === 'function') {
            loadPipelines();
        }
    }

    return { importedCount };
}

async function importSuitesFromPayload(importedSuites = [], viewIdMapping = {}) {
    if (!Array.isArray(importedSuites) || importedSuites.length === 0) {
        return { importedCount: 0, idMapping: {} };
    }

    const idMapping = {};
    let importedCount = 0;

    for (const rawSuite of importedSuites) {
        if (!rawSuite || typeof rawSuite !== 'object') {
            continue;
        }

        const importedSuite = cloneImportedValue(rawSuite);
        const oldId = importedSuite.id;
        delete importedSuite.id;

        if (importedSuite.view_id && viewIdMapping[importedSuite.view_id]) {
            importedSuite.view_id = viewIdMapping[importedSuite.view_id];
        }

        if (importedSuite.view_id && !views.some(view => view.id === importedSuite.view_id)) {
            importedSuite.view_id = null;
        }

        const newId = await currentStorage.saveSuite(importedSuite);
        if (oldId && newId) {
            idMapping[oldId] = newId;
        }
        importedCount += 1;
    }

    return { importedCount, idMapping };
}

async function importVersionHistoriesFromPayload(versionHistories = {}, idMapping = {}, viewIdMapping = {}) {
    if (!window.versionControl || typeof window.versionControl.importVersionHistory !== 'function') {
        return 0;
    }

    let importedCount = 0;

    for (const [oldSuiteId, versionsToImport] of Object.entries(versionHistories || {})) {
        const newSuiteId = idMapping[oldSuiteId];
        if (!newSuiteId || !Array.isArray(versionsToImport)) {
            continue;
        }

        const adjustedVersions = versionsToImport.map(version => {
            const adjustedVersion = cloneImportedValue(version);
            if (adjustedVersion?.suiteSnapshot && typeof adjustedVersion.suiteSnapshot === 'object') {
                adjustedVersion.suiteSnapshot.id = newSuiteId;
                if (adjustedVersion.suiteSnapshot.view_id && viewIdMapping[adjustedVersion.suiteSnapshot.view_id]) {
                    adjustedVersion.suiteSnapshot.view_id = viewIdMapping[adjustedVersion.suiteSnapshot.view_id];
                }
            }
            return adjustedVersion;
        });

        importedCount += await window.versionControl.importVersionHistory(newSuiteId, adjustedVersions);
    }

    return importedCount;
}

async function refreshImportedDataViews() {
    if (currentStorage?.getAllSuites) {
        const suites = await currentStorage.getAllSuites();
        renderTestSuites(suites);
        if (window.visualEditor) {
            window.visualEditor.setAvailableSuites(suites);
        }
    }

    if (
        typeof window.refreshStorageDashboard === 'function' &&
        document.getElementById('dashboard-storage-tab')?.classList.contains('active')
    ) {
        await window.refreshStorageDashboard();
    }

    if (typeof window.refreshStorageStatusDisplay === 'function') {
        await window.refreshStorageStatusDisplay();
    }
}

function saveLastImportSummary(summary) {
    if (window.storageManager?.saveLastImportSummary) {
        window.storageManager.saveLastImportSummary(summary);
    }
}

function formatImportSummaryMessage(summary) {
    const parts = [];
    if (summary.importedSuites) parts.push(`${summary.importedSuites} suite(s)`);
    if (summary.importedPipelines) parts.push(`${summary.importedPipelines} pipeline(s)`);
    if (summary.importedViews) parts.push(`${summary.importedViews} view(s)`);
    if (summary.importedVersions) parts.push(`${summary.importedVersions} version(s)`);

    const importedFilesLabel = summary.importedFiles > 1
        ? `${summary.importedFiles} file(s)`
        : summary.sourceName;

    let message = `Imported ${parts.join(', ') || '0 items'} from ${importedFilesLabel}`;
    if (summary.failedFiles || summary.skippedFiles) {
        message += ` (${summary.skippedFiles || 0} skipped, ${summary.failedFiles || 0} failed)`;
    }
    return message;
}

async function applyLegacyImportPayload(payload, options = {}) {
    if (!currentStorage) {
        throw new Error('Please configure storage first.');
    }

    const { importedCount: importedViews, viewIdMapping } = mergeImportedViews(payload.views || []);
    const { importedCount: importedPipelines } = mergeImportedPipelines(payload.pipelines || []);
    const { importedCount: importedSuites, idMapping } = await importSuitesFromPayload(payload.suites || [], viewIdMapping);
    const importedVersions = await importVersionHistoriesFromPayload(payload.versionHistories || {}, idMapping, viewIdMapping);

    const summary = {
        timestamp: new Date().toISOString(),
        sourceName: payload.sourceName || options.sourceName || 'Imported data',
        importedFiles: options.importedFiles || 1,
        importedSuites,
        importedPipelines,
        importedViews,
        importedVersions,
        skippedFiles: options.skippedFiles || 0,
        failedFiles: options.failedFiles || 0
    };

    if (options.persistLastImport !== false) {
        saveLastImportSummary(summary);
    }

    if (options.updateUi !== false) {
        await refreshImportedDataViews();
    }

    return summary;
}

async function importLegacyJsonText(text, sourceName, options = {}) {
    if (!window.LegacyImporter?.extractImportPayload) {
        throw new Error('Legacy importer is not available.');
    }

    const payload = window.LegacyImporter.extractImportPayload(text, { sourceName });
    return applyLegacyImportPayload(payload, options);
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = event => resolve(String(event.target?.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Failed to read selected file.'));
        reader.readAsText(file);
    });
}

async function importFromJSON(event) {
    const input = event?.target;

    try {
        if (!currentStorage) {
            throw new Error('Please configure storage first');
        }

        const file = input?.files?.[0];
        if (!file) {
            return null;
        }

        const text = await readFileAsText(file);
        const summary = await importLegacyJsonText(text, file.name);
        showMessage(formatImportSummaryMessage(summary), 'success');
        return summary;
    } catch (error) {
        console.error('Import error:', error);
        showMessage(`Failed to import: ${error.message}`, 'error');
        return null;
    } finally {
        if (input) {
            input.value = null;
        }
    }
}

async function importLegacyJsonFileFromDashboard() {
    if (!window.electronAPI?.legacyImports?.pickJsonFile) {
        const input = document.getElementById('storage-import-json-input') || document.getElementById('main-import-file-input');
        if (input) {
            input.value = '';
            input.click();
        }
        return null;
    }

    const pickedFile = await window.electronAPI.legacyImports.pickJsonFile();
    if (pickedFile?.canceled || !pickedFile?.filePath) {
        return null;
    }

    const fileData = await window.electronAPI.legacyImports.readJsonFile(pickedFile.filePath);
    const summary = await importLegacyJsonText(fileData.content, fileData.fileName);
    showMessage(formatImportSummaryMessage(summary), 'success');
    return summary;
}

async function importLegacySessionFolderFromDashboard() {
    if (!window.electronAPI?.legacyImports?.pickSessionFolder) {
        throw new Error('Folder import is only available in the Electron app.');
    }

    const pickedFolder = await window.electronAPI.legacyImports.pickSessionFolder();
    if (pickedFolder?.canceled || !pickedFolder?.folderPath) {
        return null;
    }

    const folderData = await window.electronAPI.legacyImports.readSessionFolder(pickedFolder.folderPath);
    const files = Array.isArray(folderData?.files) ? folderData.files : [];
    if (files.length === 0) {
        showMessage('No JSON files were found in the selected folder.', 'info');
        return null;
    }

    const aggregate = {
        timestamp: new Date().toISOString(),
        sourceName: folderData.folderPath,
        importedFiles: files.length,
        importedSuites: 0,
        importedPipelines: 0,
        importedViews: 0,
        importedVersions: 0,
        skippedFiles: 0,
        failedFiles: 0
    };

    for (const file of files) {
        try {
            const summary = await importLegacyJsonText(file.content, file.relativePath || file.fileName, {
                persistLastImport: false,
                updateUi: false
            });
            aggregate.importedSuites += summary.importedSuites;
            aggregate.importedPipelines += summary.importedPipelines;
            aggregate.importedViews += summary.importedViews;
            aggregate.importedVersions += summary.importedVersions;
        } catch (error) {
            aggregate.failedFiles += 1;
            console.warn(`[LegacyImport] Failed to import ${file.relativePath || file.fileName}:`, error);
        }
    }

    saveLastImportSummary(aggregate);
    await refreshImportedDataViews();
    showMessage(formatImportSummaryMessage(aggregate), aggregate.failedFiles ? 'info' : 'success');
    return aggregate;
}

window.importLegacyJsonFileFromDashboard = importLegacyJsonFileFromDashboard;
window.importLegacySessionFolderFromDashboard = importLegacySessionFolderFromDashboard;

function showMessage(text, type = 'info') {
    const messageBox = document.getElementById('message-box');
    const classes = {
        success: 'aero-button-success',
        error: 'aero-button-danger',
        info: 'aero-button-primary'
    };

    messageBox.className = `fixed top-5 right-5 z-50 transition-all duration-300 ${classes[type]} px-6 py-3 rounded-lg shadow-lg`;
    messageBox.textContent = text;
    messageBox.style.transform = 'translateX(0)';

    setTimeout(() => {
        messageBox.style.transform = 'translateX(150%)';
    }, 3000);
}

function escapeHtml(text) {
    if (text === null || typeof text === 'undefined') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// WEBSITE INTEGRATION FUNCTIONS
// ============================================

let websiteFiles = {
    html: null,
    css: [],
    js: []
};

function toggleWebsiteIntegrationOptions() {
    const languageEl = document.getElementById('suite_language');
    if (!languageEl) return;

    const language = languageEl.value;
    const websiteOptions = document.getElementById('website-testing-config');
    const templateBtn = document.getElementById('load-website-template-btn');

    if (language === 'website') {
        if (websiteOptions) websiteOptions.classList.remove('hidden');
        if (templateBtn) templateBtn.classList.remove('hidden');
    } else {
        if (websiteOptions) websiteOptions.classList.add('hidden');
        if (templateBtn) templateBtn.classList.add('hidden');
    }
}

function loadWebsiteTemplate() {
    const template = `*** Settings ***
Library BrowserLibrary

*** Test Cases ***
Test Website Form Submission
 [Documentation] Example: Test a form on your website
 # The website will be loaded automatically in an iframe
 # You can interact with it using BrowserLibrary keywords
 
 # Example: Fill in a form
 Input Text id=nameInput John Doe
 Input Text id=emailInput john@example.com
 Click Element id=submitButton
 
 # Verify results
 Element Should Contain id=result Success
 
Test Website Navigation
 [Documentation] Example: Test navigation and element visibility
 
 # Check if an element exists
 Element Should Exist css=.header
 
 # Get text from an element
 \${text}= Get Text id=welcomeMessage
 Should Contain \${text} Welcome
 
 # Click a button
 Click Element xpath=//button[text()='Learn More']
 
 # Wait for element to appear
 Wait For Element id=moreInfo timeout=5s
 Element Should Be Visible id=moreInfo

*** Keywords ***
# Add your custom keywords here if needed
`;
    const codeEl = document.getElementById('suite_code');
    if (codeEl) {
        codeEl.value = template;
        showMessage('Example template loaded! Customize it for your website.', 'success');
    }
}

function toggleWebsiteGuide() {
    const content = document.getElementById('website-guide-content');
    const icon = document.getElementById('guide-toggle-icon');

    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        icon.textContent = '\/';
    } else {
        content.classList.add('hidden');
        icon.textContent = '>>';
    }
}

function toggleWebsiteMethodInputs() {
    const method = document.querySelector('input[name="website-method"]:checked').value;
    const urlInput = document.getElementById('website-url-input');
    const uploadInput = document.getElementById('website-upload-input');

    if (method === 'url') {
        urlInput.classList.remove('hidden');
        uploadInput.classList.add('hidden');
    } else {
        urlInput.classList.add('hidden');
        uploadInput.classList.remove('hidden');
    }
}

async function handleWebsiteFileUpload(input, type) {
    const files = input.files;
    if (!files || files.length === 0) return;

    const preview = document.getElementById('website-files-preview'); // Changed ID
    let previewText = '';

    if (type === 'html') {
        const file = files[0];
        websiteFiles.html = await readFileAsText(file);
        previewText += ` HTML: ${file.name}<br>`;
    } else if (type === 'css') {
        websiteFiles.css = [];
        for (let file of files) {
            const content = await readFileAsText(file);
            websiteFiles.css.push({ name: file.name, content }); // Store as object
            previewText += ` CSS: ${file.name}<br>`;
        }
    } else if (type === 'js') {
        websiteFiles.js = [];
        for (let file of files) {
            const content = await readFileAsText(file);
            websiteFiles.js.push({ name: file.name, content }); // Store as object
            previewText += ` JS: ${file.name}<br>`;
        }
    }

    if (preview) {
        preview.innerHTML = '<strong>Uploaded Files:</strong><br>' + previewText;
    }
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });
}

function buildWebsiteHTML() {
    if (!websiteFiles.html) return null;

    let html = websiteFiles.html;

    // Inject CSS into the HTML
    if (websiteFiles.css.length > 0) {
        const cssStyles = websiteFiles.css.map(file =>
            `<style>/* ${file.name} */\n${file.content}</style>`
        ).join('\n');

        // Try to inject before </head> or at the start of <body>
        if (html.includes('</head>')) {
            html = html.replace('</head>', cssStyles + '\n</head>');
        } else if (html.includes('<body')) {
            html = html.replace(/<body[^>]*>/, (match) => match + '\n' + cssStyles);
        } else {
            html = cssStyles + '\n' + html;
        }
    }

    // Inject JS into the HTML
    if (websiteFiles.js.length > 0) {
        const jsScripts = websiteFiles.js.map(file =>
            `<script>/* ${file.name} */\n${file.content}</script>`
        ).join('\n');

        // Try to inject before </body> or at the end
        if (html.includes('</body>')) {
            html = html.replace('</body>', jsScripts + '\n</body>');
        } else {
            html = html + '\n' + jsScripts;
        }
    }

    return html;
}

async function executeWebsiteIntegration(suite) {
    let log = '[WEBSITE INTEGRATION TEST]\n';
    log += `Testing: ${suite.name}\n`;
    log += `Method: ${suite.website_method || 'url'}\n\n`;

    let websiteUrl = suite.website_url;
    let websiteHTML = null;

    if (suite.website_method === 'upload' && suite.website_html_content) {
        // Build the complete HTML from uploaded files
        const tempFiles = {
            html: suite.website_html_content,
            css: suite.website_css_contents || [],
            js: suite.website_js_contents || []
        };

        // Temporarily swap global websiteFiles to build HTML
        const originalFiles = websiteFiles;
        websiteFiles = tempFiles;
        websiteHTML = buildWebsiteHTML();
        websiteFiles = originalFiles; // Restore

        if (!websiteHTML) {
            throw new Error('Failed to build website HTML from stored files.');
        }

        // Create a blob URL for the uploaded site
        const blob = new Blob([websiteHTML], { type: 'text/html' });
        websiteUrl = URL.createObjectURL(blob);
        log += `[INFO] Loaded uploaded website files\n`;
    } else {
        log += `[INFO] Loading external website: ${websiteUrl}\n`;
    }

    if (!websiteUrl) {
        throw new Error('No website URL or files provided');
    }

    log += `\n[CREATING TEST ENVIRONMENT]\n`;
    log += `Creating iframe for website...\n`;

    // Find or create iframe
    let iframe = document.getElementById('test-website-iframe');
    if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'test-website-iframe';
        // Position it off-screen but available
        iframe.style.cssText = 'position:absolute; top:-9999px; left:-9999px; width:1280px; height:720px; border:none; z-index:9999;';
        document.body.appendChild(iframe);
    }

    iframe.src = websiteUrl;

    log += `[SUCCESS] Website loaded in test environment\n\n`;

    // Wait for iframe to load
    await new Promise((resolve, reject) => {
        iframe.onload = resolve;
        iframe.onerror = () => reject(new Error('Iframe failed to load.'));
        setTimeout(() => reject(new Error('Iframe load timeout.')), 5000);
    });

    log += `[EXECUTING TEST SCRIPT]\n`;

    try {
        // Execute the Robot Framework test
        if (suite.language === 'website' && suite.code) {
            log += `Running Robot Framework tests...\n\n`;

            const result = await executeRobotFrameworkBrowser(suite.code);

            log += result.output || 'Test execution completed\n';
            if (result.error) {
                log += `[STDERR]\n${result.error}\n`;
            }

            // Clean up
            iframe.src = 'about:blank';
            if (suite.website_method === 'upload' && websiteUrl.startsWith('blob:')) {
                URL.revokeObjectURL(websiteUrl);
            }

            return {
                status: result.success ? 'SUCCESS' : 'FAILURE',
                log: log,
                output: result.output,
                error: result.error
            };
        }

    } catch (error) {
        log += `\n[ERROR] ${error.message}\n`;
        iframe.src = 'about:blank';
        if (suite.website_method === 'upload' && websiteUrl.startsWith('blob:')) {
            URL.revokeObjectURL(websiteUrl);
        }
        throw error;
    }

    log += `\n[TEST COMPLETED]\n`;
    log += `Closing test environment...\n`;

    // Clean up
    iframe.src = 'about:blank';
    if (suite.website_method === 'upload' && websiteUrl.startsWith('blob:')) {
        URL.revokeObjectURL(websiteUrl);
    }

    return {
        status: 'SUCCESS',
        log: log
    };
}

// ============================================
// FEATURE 2: TEST ORGANIZATION FUNCTIONS (RE-ADDED)
// ============================================

function filterSuites() {
    // Get current filter values
    const searchInput = document.getElementById('suite-search');
    const tagFilterEl = document.getElementById('tag-filter');
    const languageFilterEl = document.getElementById('language-filter');
    const sortOptionEl = document.getElementById('sort-option');

    if (searchInput) suiteFilters.searchText = searchInput.value.toLowerCase();
    if (tagFilterEl) suiteFilters.tagFilter = tagFilterEl.value;
    if (languageFilterEl) suiteFilters.languageFilter = languageFilterEl.value;
    if (sortOptionEl) suiteFilters.sortOption = sortOptionEl.value;

    // Re-render with filters applied
    renderTestSuites(testSuites);
}

function updateTagFilterDropdown() {
    const allTags = new Set();
    testSuites.forEach(suite => {
        if (suite.tags && Array.isArray(suite.tags)) {
            suite.tags.forEach(tag => allTags.add(tag));
        }
    });

    const dropdown = document.getElementById('tag-filter');
    if (dropdown) {
        dropdown.innerHTML = '<option value="">All Tags</option>' +
            Array.from(allTags).sort().map(tag =>
                `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`
            ).join('');
    }
}

function addTag() {
    const input = document.getElementById('new-tag-input');
    if (!input) return;

    const tag = input.value.trim();
    if (tag && !currentEditTags.includes(tag)) {
        currentEditTags.push(tag);
        renderTagsInEditor();
    }
    input.value = '';
}

function removeTag(tag) {
    currentEditTags = currentEditTags.filter(t => t !== tag);
    renderTagsInEditor();
}

function renderTagsInEditor() {
    const container = document.getElementById('tag-input-container');
    if (!container) return;

    container.innerHTML = currentEditTags.map(tag => `
    <span class='aero-badge-info flex items-center gap-1 px-3 py-1 rounded-full'>
    ${escapeHtml(tag)}
    <button type="button" onclick='removeTag("${escapeHtml(tag)}")' 
    class='ml-1 hover:bg-red-400 rounded-full w-4 h-4 flex items-center justify-center text-xs font-bold'>×</button>
    </span>
    `).join('');
}

function toggleFavorite(event, suiteId) {
    event.stopPropagation(); // Prevent card click
    const suite = testSuites.find(s => s.id === suiteId);
    if (suite) {
        suite.isFavorite = !suite.isFavorite;
        currentStorage.updateSuite(suiteId, { isFavorite: suite.isFavorite });
        renderTestSuites(testSuites); // Refresh display
    }
}

function toggleBulkMode() {
    bulkModeActive = !bulkModeActive;
    selectedSuites.clear();

    const btn = document.getElementById('bulk-mode-toggle');
    if (btn) {
        btn.textContent = bulkModeActive ? 'Cancel' : 'Bulk Select';
        btn.className = bulkModeActive ? 'aero-button-danger px-4 py-2 rounded-lg' : 'aero-button-info px-4 py-2 rounded-lg';
    }

    // Show/hide bulk actions toolbar
    const toolbar = document.getElementById('bulk-actions-toolbar');
    if (toolbar) {
        toolbar.classList.toggle('hidden', !bulkModeActive);
    }

    renderTestSuites(testSuites);
    updateSelectedCount();
}

function toggleSuiteSelection(suiteId) {
    if (selectedSuites.has(suiteId)) {
        selectedSuites.delete(suiteId);
    } else {
        selectedSuites.add(suiteId);
    }
    updateSelectedCount();
    renderTestSuites(testSuites);
}

function updateSelectedCount() {
    const countEl = document.getElementById('selected-count');
    if (countEl) {
        countEl.textContent = selectedSuites.size;
    }
}

async function bulkRun() {
    if (selectedSuites.size === 0) {
        showMessage('No suites selected', 'warning');
        return;
    }

    if (!confirm(`Run ${selectedSuites.size} selected test suite(s)?`)) {
        return;
    }

    showMessage(`Running ${selectedSuites.size} test suite(s)...`, 'info');
    document.getElementById('run-modal').classList.remove('hidden');
    document.getElementById('run-modal-title').textContent = 'Bulk Run Progress';
    document.getElementById('run-modal-content').textContent = '';
    document.getElementById('run-status-indicator').innerHTML = '<span class="text-yellow-400"><div class="spinner"></div> Running...</span>';
    updateRunProgress(0, selectedSuites.size, `Running test 1 of ${selectedSuites.size}...`);

    let bulkLog = `=== BULK RUN EXECUTION LOG ===\n`;
    bulkLog += `Started: ${new Date().toLocaleString()}\n`;
    bulkLog += `Suites: ${selectedSuites.size}\n\n`;

    let completedRuns = 0;
    for (const suiteId of selectedSuites) {
        completedRuns += 1;
        const suite = testSuites.find(item => item.id === suiteId);
        updateRunProgress(completedRuns - 1, selectedSuites.size, `Running test ${completedRuns} of ${selectedSuites.size}: ${suite?.name || suiteId}`);
        const result = await runTestSuite(suiteId, true);
        bulkLog += `[${completedRuns}/${selectedSuites.size}] ${suite?.name || suiteId}: ${result?.status || 'UNKNOWN'}\n`;
        document.getElementById('run-modal-content').textContent = bulkLog;
        // Small delay between runs
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    updateRunProgress(selectedSuites.size, selectedSuites.size, `Finished ${selectedSuites.size} of ${selectedSuites.size} tests`);
    document.getElementById('run-status-indicator').innerHTML = '<span class="text-green-400">Completed</span>';
    document.getElementById('run-modal-content').textContent = `${bulkLog}\nBulk run completed.`;
    showMessage('Bulk run completed', 'success');
}

async function bulkDelete() {
    if (selectedSuites.size === 0) {
        showMessage('No suites selected', 'warning');
        return;
    }

    if (!confirm(`Delete ${selectedSuites.size} selected test suite(s)? This cannot be undone.`)) {
        return;
    }

    try {
        for (const suiteId of selectedSuites) {
            await currentStorage.deleteSuite(suiteId);
        }
        selectedSuites.clear();
        updateSelectedCount();
        showMessage(`Successfully deleted test suites`, 'success');
    } catch (error) {
        console.error("Bulk delete error:", error);
        showMessage("Failed to delete some suites: " + error.message, 'error');
    }
}

function bulkExport() {
    if (selectedSuites.size === 0) {
        showMessage('No suites selected', 'warning');
        return;
    }

    const selectedSuitesData = testSuites.filter(s => selectedSuites.has(s.id));

    const data = {
        exported_at: new Date().toISOString(),
        export_type: 'bulk_selection',
        suite_count: selectedSuitesData.length,
        test_suites: selectedSuitesData
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bulk_export_${selectedSuitesData.length}_suites_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);

    showMessage(`Exported ${selectedSuitesData.length} test suite(s)`, 'success');
}

function bulkAddTag() {
    if (selectedSuites.size === 0) {
        showMessage('No suites selected', 'warning');
        return;
    }

    const tagName = prompt('Enter tag name to add to selected suites:');
    if (!tagName || tagName.trim() === '') {
        return;
    }

    const tag = tagName.trim();

    try {
        for (const suiteId of selectedSuites) {
            const suite = testSuites.find(s => s.id === suiteId);
            if (suite) {
                if (!suite.tags) suite.tags = [];
                if (!suite.tags.includes(tag)) {
                    suite.tags.push(tag);
                    currentStorage.updateSuite(suiteId, { tags: suite.tags });
                }
            }
        }
        showMessage(`Added tag "${tag}" to ${selectedSuites.size} suite(s)`, 'success');
        updateTagFilterDropdown();
    } catch (error) {
        console.error("Bulk add tag error:", error);
        showMessage("Failed to add tags: " + error.message, 'error');
    }
}

// ============================================
// UI RESIZING LOGIC
// ============================================

function initResizeDrag(resizerId, targetId, direction) {
    const resizer = document.getElementById(resizerId);
    const target = document.getElementById(targetId);

    if (!resizer || !target) return;

    let isResizing = false;
    let lastDownX = 0;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        lastDownX = e.clientX;
        resizer.classList.add('active');
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const offset = e.clientX - lastDownX;
        lastDownX = e.clientX;

        const currentWidth = parseInt(getComputedStyle(target).width);
        const newWidth = currentWidth + offset;

        if (newWidth > 150 && newWidth < 600) { // Min/Max widths
            target.style.width = `${newWidth}px`;
        }
    });

    document.addEventListener('mouseup', () => {
        isResizing = false;
        resizer.classList.remove('active');
        document.body.style.cursor = 'default';
    });
}

/**
 * Makes an element resizable via a bottom-right corner handle
 */
function makeElementResizable(element) {
    const handle = element.querySelector('.resize-handle-corner');
    if (!handle) return;

    let isResizing = false;
    let lastDownX = 0;
    let lastDownY = 0;

    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        lastDownX = e.clientX;
        lastDownY = e.clientY;

        // Remove restrictive max-widths if present to allow free resizing
        element.style.maxWidth = '98vw';
        element.style.maxHeight = '95vh';

        e.preventDefault();
        e.stopPropagation();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const dx = e.clientX - lastDownX;
        const dy = e.clientY - lastDownY;

        lastDownX = e.clientX;
        lastDownY = e.clientY;

        const rect = element.getBoundingClientRect();
        element.style.width = `${rect.width + dx}px`;
        element.style.height = `${rect.height + dy}px`;
    });

    document.addEventListener('mouseup', () => {
        isResizing = false;
    });
}

function initAllResizables() {
    // Sidebar
    initResizeDrag('sidebar-resizer', 'views-panel', 'horizontal');

    // Modals - attach to all modals with the resize handle
    document.querySelectorAll('.aero-modal').forEach(modal => {
        if (modal.querySelector('.resize-handle-corner')) {
            makeElementResizable(modal);
        }
    });
}

function isTypingContext(target = document.activeElement) {
    if (!target) return false;

    const tagName = String(target.tagName || '').toUpperCase();
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName)) {
        return true;
    }

    if (target.isContentEditable) {
        return true;
    }

    const className = typeof target.className === 'string' ? target.className : '';
    return className.includes('inputarea')
        || className.includes('monaco')
        || className.includes('overflow-guard');
}

function isSuiteEditorOpen() {
    const suiteModal = document.getElementById('suite-modal');
    return Boolean(suiteModal && !suiteModal.classList.contains('hidden'));
}

function isGraphEditorOpen() {
    const graphRoot = document.getElementById('visual-editor-root');
    return Boolean(graphRoot && !graphRoot.classList.contains('hidden'));
}

async function runCurrentSuiteFromShortcut() {
    if (!isSuiteEditorOpen()) {
        return false;
    }

    if (!editingSuiteId) {
        showMessage('Save the suite before running it from the editor shortcut.', 'info');
        return true;
    }

    await runTestSuite(editingSuiteId);
    return true;
}

function saveCurrentSuiteFromShortcut() {
    if (!isSuiteEditorOpen()) {
        return false;
    }

    const form = document.getElementById('suite-form');
    if (!form) {
        return false;
    }

    if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
    } else {
        saveSuite({ preventDefault() { } });
    }
    return true;
}

function focusSuiteSearchFromShortcut() {
    const searchInput = document.getElementById('suite-search');
    if (!searchInput) {
        return false;
    }

    searchInput.focus();
    if (typeof searchInput.select === 'function') {
        searchInput.select();
    }
    return true;
}

async function handleKeyboardShortcuts(event) {
    const key = String(event.key || '').toLowerCase();
    const ctrlOrMeta = event.ctrlKey || event.metaKey;

    if (ctrlOrMeta && key === 's') {
        if (saveCurrentSuiteFromShortcut()) {
            event.preventDefault();
        }
        return;
    }

    if (ctrlOrMeta && key === 'enter') {
        if (isSuiteEditorOpen()) {
            event.preventDefault();
            await runCurrentSuiteFromShortcut();
        }
        return;
    }

    if (ctrlOrMeta && key === 'n') {
        event.preventDefault();
        openAddSuiteModal();
        return;
    }

    if (ctrlOrMeta && key === 'f') {
        if (focusSuiteSearchFromShortcut()) {
            event.preventDefault();
        }
        return;
    }

    if (ctrlOrMeta && key === 'z' && !event.shiftKey) {
        if (isGraphEditorOpen() && window.visualEditor?.undo?.()) {
            event.preventDefault();
        }
        return;
    }

    if ((ctrlOrMeta && key === 'y') || (ctrlOrMeta && event.shiftKey && key === 'z')) {
        if (isGraphEditorOpen() && window.visualEditor?.redo?.()) {
            event.preventDefault();
        }
        return;
    }

    if (key === 'delete' && !isTypingContext()) {
        if (isGraphEditorOpen() && window.visualEditor?.deleteSelectedNode?.()) {
            event.preventDefault();
        }
    }
}

// ============================================
// INITIALIZATION
// ============================================

window.onload = async function () {
    await initializeStorageManager();
    loadExecutionConfig();
    initializeViews(); // Initialize views system
    applyTheme(loadThemePreference());
    prewarmSuiteEditor();
    await initializeStorage();
    if (window.versionControl && typeof window.versionControl.initialize === 'function') {
        await window.versionControl.initialize();
    }
    if (window.collaborationManager && typeof window.collaborationManager.initialize === 'function') {
        await window.collaborationManager.initialize();
    }
    initializeSafeModalBackdrops();
    // Initialize Pipelines if manager exists
    if (typeof initializePipelineManager === 'function') initializePipelineManager();

    // Initialize Resizing
    initAllResizables();
    window.addEventListener('keydown', handleKeyboardShortcuts);

    // Check for demos (Producer/Consumer)
    setTimeout(() => {
        if (window.currentStorage && window.testSuites) {
            ensureDemoSuites();
        }
    }, 2000);
};

window.refreshStorageStatusDisplay = refreshStorageStatusDisplay;

// ===================================
// DEMO CONTENT
// ===================================

function ensureDemoSuites() {
    if (!window.testSuites || !window.currentStorage) return;

    // Check if suites already exist
    const producerId = 'demo_producer_v1';
    const consumerId = 'demo_consumer_v1';

    // We check by ID or Name to avoid duplicates/partials
    const producerIndex = testSuites.findIndex(s => s.id === producerId || s.name === "Demo: Artifact Producer");
    if (producerIndex === -1) {
        const producerSuite = {
            id: producerId,
            name: "Demo: Artifact Producer",
            description: "Generates a secret token artifact.",
            language: "python",
            code: "import time\nprint(\"Starting producer...\")\ntime.sleep(1)\n\n# Define Artifact\n# The Graph Engine looks for this dictionary\nARTIFACTS = {'secret_token': 'ABC-123-XYZ'}\nprint(\"Artifact 'secret_token' created.\")",
            tags: ["demo", "graph"],
            last_run_status: "NEVER_RUN"
        };
        testSuites.push(producerSuite);
        currentStorage.saveSuite(producerSuite);
    }

    const consumerIndex = testSuites.findIndex(s => s.id === consumerId || s.name === "Demo: Artifact Consumer");
    if (consumerIndex === -1) {
        const consumerSuite = {
            id: consumerId,
            name: "Demo: Artifact Consumer",
            description: "Waits for secret_token and verifies it.",
            language: "python",
            code: "import time\nprint(\"Starting consumer...\")\n\n# Check for artifact injected by Graph Engine\n# Inputs are injected as global variables\ntoken = globals().get('secret_token')\n\nif not token:\n    raise Exception(\"Missing required artifact: secret_token. Did you link the Producer node?\")\n\nprint(f\"Received token: {token}\")\n\nif token == 'ABC-123-XYZ':\n    print(\"Verification SUCCESS!\")\nelse:\n    raise Exception(f\"Invalid token value: {token}\")",
            tags: ["demo", "graph"],
            last_run_status: "NEVER_RUN"
        };
        testSuites.push(consumerSuite);
        currentStorage.saveSuite(consumerSuite);
    }

    // ===== SECURITY DEMO SUITES =====

    // Demo: Vulnerable JavaScript
    const vulnJsId = 'demo_security_vuln_js';
    const vulnJsIndex = testSuites.findIndex(s => s.id === vulnJsId || s.name === "🔓 Security Demo: Vulnerable JS");
    if (vulnJsIndex === -1) {
        const vulnJsSuite = {
            id: vulnJsId,
            name: "🔓 Security Demo: Vulnerable JS",
            description: "JavaScript code with security vulnerabilities. Use Security Testing Center to find issues!",
            language: "javascript",
            code: `// ⚠️ Vulnerable JavaScript Code Example
// Use the Security Testing Center (🔒 button) to scan this code!

const password = "supersecret123";
const apiKey = "AKIAIOSFODNN7EXAMPLE";

function processUserInput(input) {
    eval(input);  // Code injection vulnerability
    document.innerHTML = input;  // XSS vulnerability
    document.write('<script>' + input + '</script>');
}

const db = "mongodb://admin:password@db.example.com:27017";
exec(\`rm -rf \${userInput}\`);  // Command injection

console.log("This code has multiple security issues!");`,
            tags: ["demo", "security", "vulnerable"],
            last_run_status: "NEVER_RUN"
        };
        testSuites.push(vulnJsSuite);
        currentStorage.saveSuite(vulnJsSuite);
    }

    // Demo: Vulnerable Python
    const vulnPyId = 'demo_security_vuln_py';
    const vulnPyIndex = testSuites.findIndex(s => s.id === vulnPyId || s.name === "🔓 Security Demo: Vulnerable Python");
    if (vulnPyIndex === -1) {
        const vulnPySuite = {
            id: vulnPyId,
            name: "🔓 Security Demo: Vulnerable Python",
            description: "Python code with security vulnerabilities. Use Security Testing Center to find issues!",
            language: "python",
            code: `# ⚠️ Vulnerable Python Code Example
# Use the Security Testing Center (🔒 button) to scan this code!

password = "admin123"
api_key = "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456"

def run_user_code(code):
    exec(code)  # Code execution vulnerability
    eval(user_input)  # Eval vulnerability

import subprocess
subprocess.call(cmd, shell=True)  # Shell injection

import pickle
data = pickle.loads(user_data)  # Unsafe deserialization

print("This code has multiple security issues!")`,
            tags: ["demo", "security", "vulnerable"],
            last_run_status: "NEVER_RUN"
        };
        testSuites.push(vulnPySuite);
        currentStorage.saveSuite(vulnPySuite);
    }

    // Demo: Secure JavaScript
    const secureJsId = 'demo_security_secure_js';
    const secureJsIndex = testSuites.findIndex(s => s.id === secureJsId || s.name === "🔒 Security Demo: Secure JS");
    if (secureJsIndex === -1) {
        const secureJsSuite = {
            id: secureJsId,
            name: "🔒 Security Demo: Secure JS",
            description: "Secure JavaScript code that passes security scans. Compare with the vulnerable version!",
            language: "javascript",
            code: `// ✅ Secure JavaScript Code Example
// This code should pass the Security Testing Center scan!

const config = {
    apiEndpoint: process.env.API_URL,
    timeout: 5000
};

function processUserInput(input) {
    // Sanitize input before use
    const sanitized = DOMPurify.sanitize(input);
    element.textContent = sanitized;  // Safe - uses textContent
}

function calculateTotal(items) {
    return items.reduce((sum, item) => sum + item.price, 0);
}

async function fetchData(url) {
    const response = await fetch(url);
    return response.json();
}

console.log("Application started - secure code!");`,
            tags: ["demo", "security", "secure"],
            last_run_status: "NEVER_RUN"
        };
        testSuites.push(secureJsSuite);
        currentStorage.saveSuite(secureJsSuite);
    }

    // Demo: Secure Python
    const securePyId = 'demo_security_secure_py';
    const securePyIndex = testSuites.findIndex(s => s.id === securePyId || s.name === "🔒 Security Demo: Secure Python");
    if (securePyIndex === -1) {
        const securePySuite = {
            id: securePyId,
            name: "🔒 Security Demo: Secure Python",
            description: "Secure Python code that passes security scans. Compare with the vulnerable version!",
            language: "python",
            code: `# ✅ Secure Python Code Example
# This code should pass the Security Testing Center scan!

import os
import json
import subprocess

def get_config():
    api_key = os.environ.get("API_KEY")
    return {"key": api_key}

def process_data(items):
    total = sum(item["price"] for item in items)
    return {"total": total}

def run_command(args_list):
    # Safe - using list instead of shell=True
    result = subprocess.run(args_list, capture_output=True)
    return result.stdout

def load_data(filepath):
    with open(filepath, 'r') as f:
        return json.load(f)  # Safe - using json instead of pickle

print("Application ready - secure code!")`,
            tags: ["demo", "security", "secure"],
            last_run_status: "NEVER_RUN"
        };
        testSuites.push(securePySuite);
        currentStorage.saveSuite(securePySuite);
    }

    renderTestSuites(testSuites);
    if (window.visualEditor) window.visualEditor.setAvailableSuites(testSuites);
    console.log("Demo suites check complete");
}
