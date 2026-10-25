
// ============================================
// EXECUTION ENGINE
// ============================================

let pyodideInstance = null;
let pyodideLoading = false;
let robotFrameworkInstalled = false;
let executionConfig = null;
const fetchWithProtectedCredentials = (...args) => window.LVXCredentials ? window.LVXCredentials.request(...args) : fetch(...args);

// Monaco Editor instance
let currentMonacoEditor = null;

// ============================================
// INPUT MODAL (Prompt Replacement)
// ============================================

let currentInputCallback = null;

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
    if (pyodideLoading) {
        // Wait for existing load
        while (pyodideLoading) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return pyodideInstance;
    }

    pyodideLoading = true;
    try {
        console.log("Loading Pyodide...");
        pyodideInstance = await loadPyodide({
            indexURL: new URL('assets/vendor/pyodide/', window.location.href).href
        });
        console.log("Pyodide loaded successfully");
        pyodideLoading = false;
        return pyodideInstance;
    } catch (error) {
        pyodideLoading = false;
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
        const wheelName = 'robotframework-7.3.2-py3-none-any.whl';
        const response = await fetchWithProtectedCredentials(new URL('assets/vendor/python/' + wheelName, window.location.href));
        if (!response.ok) throw new Error('Bundled Robot Framework wheel is unavailable');
        pyodide.FS.writeFile('/tmp/' + wheelName, new Uint8Array(await response.arrayBuffer()));
        await micropip.install('emfs:/tmp/' + wheelName);

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

# Robot imports libraries by module name; expose the actual decorated class.
import sys, types
_browser_module = types.ModuleType('BrowserLibrary')
_browser_module.BrowserLibrary = BrowserLibrary
sys.modules['BrowserLibrary'] = _browser_module
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

async function executeDesktopCode(engine, code, inputFiles = [], contextVariables = {}, executionOptions = {}) {
    const api=window.electronAPI.studioOps;
    const run=await api.invoke('execution','start',{engine,code,inputFiles,contextVariables,timeoutMs:120000,...executionOptions});
    window.LVXActiveRuns ||= new Set();
    window.LVXActiveRuns.add(run.id);
    try {
        for (;;) {
            const current=await api.invoke('execution','getRun',{id:run.id});
            if(!['RUNNING','PENDING'].includes(current.status)) return {success:current.status==='SUCCESS',status:current.status,output:(current.stdout||'')+(current.stderr||''),error:current.error||(current.status==='CANCELLED'?'Run cancelled':null),artifacts:current.artifacts||{},runId:current.id};
            await new Promise(resolve=>setTimeout(resolve,100));
        }
    } finally {window.LVXActiveRuns.delete(run.id);}
}
window.cancelDesktopRuns=async()=>{for(const id of window.LVXActiveRuns||[])await window.electronAPI.studioOps.invoke('execution','cancel',{id});};

async function executePythonCode(code, inputFiles = [], contextVariables = {}, executionOptions = {}) {
    if (window.electronAPI?.studioOps) return executeDesktopCode('python', code, inputFiles, contextVariables, executionOptions);
    const execute = async () => {
        try {
            const pyodide = await initializePyodide();
            pyodide.globals.set('_lvx_execution_config', JSON.stringify({ code, files: inputFiles, context: contextVariables, validationCode:executionOptions.validationCode||'' }));
            const serialized = await pyodide.runPythonAsync(`
import json as _lvx_json, io as _lvx_io, contextlib as _lvx_contextlib
import os as _lvx_os, tempfile as _lvx_tempfile, traceback as _lvx_traceback
_lvx_cfg = _lvx_json.loads(_lvx_execution_config)
_lvx_namespace = dict(_lvx_cfg['context'])
_lvx_namespace['__name__'] = '__main__'
_lvx_stream = _lvx_io.StringIO()
_lvx_errstream = _lvx_io.StringIO()
_lvx_old_cwd = _lvx_os.getcwd()
_lvx_result = {'success': True, 'output': '', 'error': None, 'artifacts': {}}
with _lvx_tempfile.TemporaryDirectory(prefix='lvx_suite_') as _lvx_dir:
    try:
        _lvx_os.chdir(_lvx_dir)
        with _lvx_contextlib.redirect_stdout(_lvx_stream), _lvx_contextlib.redirect_stderr(_lvx_errstream):
            for _lvx_file in _lvx_cfg['files']:
                _lvx_name = _lvx_file['filename']
                _lvx_path = _lvx_os.path.abspath(_lvx_name)
                if _lvx_os.path.commonpath([_lvx_dir, _lvx_path]) != _lvx_dir:
                    raise ValueError('Input file must stay within the suite directory')
                _lvx_os.makedirs(_lvx_os.path.dirname(_lvx_path), exist_ok=True)
                with open(_lvx_path, 'w', encoding='utf-8') as _lvx_handle:
                    _lvx_handle.write(str(_lvx_file['content']))
            exec(compile(_lvx_cfg['code'], '<lvx-suite>', 'exec'), _lvx_namespace)
            if _lvx_cfg.get('validationCode'):
                _lvx_namespace.update(TEST_OUTPUT=_lvx_stream.getvalue()+_lvx_errstream.getvalue(), TEST_STDOUT=_lvx_stream.getvalue(), TEST_STDERR=_lvx_errstream.getvalue())
                def assert_output_equals(expected):
                    assert _lvx_namespace['TEST_OUTPUT'].replace('\\r\\n','\\n').replace('\\r','\\n').rstrip() == str(expected).replace('\\r\\n','\\n').replace('\\r','\\n').rstrip(), 'Expected output mismatch'
                _lvx_namespace['assert_output_equals'] = assert_output_equals
                exec(compile(_lvx_cfg['validationCode'], '<lvx-validation>', 'exec'), _lvx_namespace)
            _lvx_result['artifacts'] = _lvx_namespace.get('ARTIFACTS', {})
            _lvx_json.dumps(_lvx_result['artifacts'])
    except BaseException:
        _lvx_result.update(success=False, error=_lvx_traceback.format_exc(), artifacts={})
    finally:
        _lvx_os.chdir(_lvx_old_cwd)
_lvx_result['output'] = _lvx_stream.getvalue()+_lvx_errstream.getvalue()
_lvx_json.dumps(_lvx_result)
`);
            return JSON.parse(serialized);
        } catch (error) { return { success:false, output:'', error:error.message, artifacts:{} }; }
    };
    return window.withPythonRuntime ? window.withPythonRuntime(execute) : execute();
}
async function executeRobotFrameworkBrowser(code, executionOptions = {}) {
    if (window.electronAPI?.studioOps) return executeDesktopCode('robot', code, [], {}, executionOptions);
    const execute = () => executeRobotFrameworkBrowserIsolated(code);
    return window.withPythonRuntime ? window.withPythonRuntime(execute) : execute();
}
async function executeRobotFrameworkBrowserIsolated(code) {
    if (!robotFrameworkInstalled) {
        await installRobotFramework();
    }

    try {
        const pyodide = await initializePyodide();

        // Create a temporary robot file in Pyodide's virtual filesystem
        const tempFileName = 'test_suite.robot';
        pyodide.globals.set('_lvx_robot_source', code);

        await pyodide.runPythonAsync(`
import sys
from io import StringIO
from robot import run

# Setup output capture
_lvx_robot_old_stdout, _lvx_robot_old_stderr = sys.stdout, sys.stderr
sys.stdout = StringIO()
sys.stderr = StringIO()

# Write robot file
with open('${tempFileName}', 'w', encoding='utf-8') as f:
 f.write(_lvx_robot_source)

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
finally:
 sys.stdout, sys.stderr = _lvx_robot_old_stdout, _lvx_robot_old_stderr
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
        const response = await fetchWithProtectedCredentials(`${backendUrl}/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code: code })
        });

        const result = await response.json();

        return {
            success: result.success || false,
            output: result.output || '',
            error: result.error || null,
            exitCode: result.exitCode || -1
        };
    } catch (error) {
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
        const response = await fetchWithProtectedCredentials(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code: code })
        });

        const result = await response.json();

        return {
            success: result.success || false,
            output: result.output || '',
            error: result.error || null,
            exitCode: result.exitCode || -1
        };
    } catch (error) {
        return {
            success: false,
            output: '',
            error: `API request failed: ${error.message}`,
            exitCode: -1
        };
    }
}

async function executeJavaCode(code, inputFiles = [], executionOptions = {}) {
    if (window.electronAPI?.studioOps) return executeDesktopCode('java', code, inputFiles, {}, executionOptions);
    if (!executionConfig.javaType || executionConfig.javaType === 'jdoodle') {
        if (!executionConfig.jdoodleClientId || !executionConfig.jdoodleClientSecret) {
            throw new Error("JDoodle API credentials not configured. Please go to Execution Settings.");
        }

        return await executeViaJDoodle('java', code, inputFiles);
    } else {
        throw new Error("Local Java execution requires a backend server. This feature is not yet implemented.");
    }
}

async function executeCSharpCode(code, inputFiles = [], executionOptions = {}) {
    if (window.electronAPI?.studioOps) return executeDesktopCode('csharp', code, inputFiles, {}, executionOptions);
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
        const response = await fetchWithProtectedCredentials('https://api.jdoodle.com/v1/execute', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

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
        return {
            success: false,
            output: '',
            error: error.message
        };
    }
}

function loadExecutionConfig() {
    const saved = localStorage.getItem('execution_config');
    if (saved) {
        executionConfig = JSON.parse(saved);
    } else {
        executionConfig = {
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

async function saveExecutionSettings() {
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

    try {
    if(window.LVXCredentials)executionConfig=await window.LVXCredentials.protect(executionConfig,'Execution settings');
    localStorage.setItem('execution_config', JSON.stringify(executionConfig));
    updateExecutionDisplay();
    closeExecutionSettingsModal();
    showMessage("Execution settings saved", 'success');
    }catch(error){showMessage('Execution settings could not be protected: '+error.message,'error');}
}

// ============================================
// STORAGE ABSTRACTION LAYER
// ============================================

let currentStorage = null;
let storageConfig = null;
let storageInitialization = null;

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
    }

    async initialize() {
        if (!window.localStorage) {
            throw new Error("localStorage is not available in this browser");
        }
        return true;
    }

    _readSuites() {
        const data = localStorage.getItem(this.STORAGE_KEY);
        const suites = data ? JSON.parse(data) : [];

        // Migration logic: Add new fields to existing suites
        return suites.map(suite => {
            if (!suite.tags) suite.tags = [];
            if (suite.isFavorite === undefined) suite.isFavorite = false;
            if (!suite.dateCreated) suite.dateCreated = new Date().toISOString();
            if (!suite.dateModified) suite.dateModified = new Date().toISOString();
            return suite;
        });
    }

    async getAllSuites() { return this._readSuites(); }

    async saveSuite(suite) {
        if(window.LVXCredentials)suite=await window.LVXCredentials.protect(suite,'Suite');
        const suites = this._readSuites();
        suite.id = suite.id || this._generateId();
        suite.last_run_time = suite.last_run_time || null;
        suite.last_run_status = suite.last_run_status || 'NEVER_RUN';
        suite.last_run_log = suite.last_run_log || '';

        // Add new fields for Feature 2: Test Organization
        suite.tags = suite.tags || [];
        suite.isFavorite = suite.isFavorite || false;
        suite.dateCreated = suite.dateCreated || new Date().toISOString();
        suite.dateModified = new Date().toISOString();

        if (suites.some(existing => existing.id === suite.id)) throw new Error('Suite already exists; use updateSuite.');
        suites.push(suite);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(suites));
        this._notifyListeners();
        return suite.id;
    }

    async updateSuite(id, updates) {
        if(window.LVXCredentials)updates=await window.LVXCredentials.protect(updates,'Suite');
        const suites = this._readSuites();
        const index = suites.findIndex(s => s.id === id);
        if (index !== -1) {
            // Capture the version before synchronously committing the local mutation.
            let versionSave;
            if (window.versionControl) {
                versionSave = window.versionControl.saveVersion(
                    id,
                    suites[index],
                    'Auto-save before update'
                );

            }
            // Set dateModified on update
            updates.dateModified = new Date().toISOString();
            suites[index] = { ...suites[index], ...updates };
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(suites));
            this._notifyListeners();
            if (versionSave) await versionSave;
        }
    }

    async deleteSuite(id) {
        const suites = this._readSuites();
        const filtered = suites.filter(s => s.id !== id);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(filtered));
        this._notifyListeners();
    }

    async subscribeToChanges(callback) {
        this.changeListeners.push(callback);
        const suites = this._readSuites();
        callback(suites);
    }

    _notifyListeners() {
        const suites = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
        this.changeListeners.forEach(cb => cb(suites));
    }

    _generateId() {
        return 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    getStatusMessage() {
        return `Connected: Local Storage (Browser Only)`;
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
            if (!window.firebaseModules && window.loadFirebaseModules) await window.loadFirebaseModules();
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
                await window.versionControl.saveVersion(
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
                await window.versionControl.saveVersion(
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

        const response = await fetchWithProtectedCredentials(this.baseUrl + path, options);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        if (method !== 'DELETE') {
            return await response.json();
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
        const savedConfig = localStorage.getItem('storage_config');
        if (savedConfig) {
            storageConfig = JSON.parse(savedConfig);
        } else {
            storageConfig = { type: 'localStorage' };
            localStorage.setItem('storage_config', JSON.stringify(storageConfig));
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

function connectToStorage(config) {
    const connection = connectToStorageBackend(config);
    storageInitialization = connection;
    return connection;
}

async function connectToStorageBackend(config) {
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
        document.getElementById('storage-info').textContent = currentStorage.getStatusMessage();
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
        if(window.LVXCredentials)Object.assign(newConfig,await window.LVXCredentials.protect(newConfig,'Storage settings'));
        localStorage.setItem('storage_config', JSON.stringify(newConfig));
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

async function deleteView(viewId) {
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

    // Unassign suites from this view
    if (suitesInView.length > 0) {
        try {
            await Promise.all(suitesInView.map(suite => currentStorage.updateSuite(suite.id, { view_id: null })));
        } catch (error) {
            showMessage('Failed to unassign view suites: ' + error.message, 'error');
            return;
        }
    }

    // Remove view
    views = views.filter(v => v.id !== viewId);
    saveViewsToStorage();

    // If this was the current view, switch to All Views
    if (currentViewId === viewId) {
        currentViewId = null;
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

        const languageDisplay = isVisualWebTest ? window.LVXIcons.svg('robot')+' VISUAL WEB' :
            isWebsite ? 'WEBSITE (URL)' :
                escapeHtml(suite.language.toUpperCase());

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
 title='${suite.isFavorite ? "Remove from favorites" : "Add to favorites"}' aria-label='${suite.isFavorite ? "Remove from favorites" : "Add to favorites"}' aria-pressed='${!!suite.isFavorite}'>
 ${window.LVXIcons.svg('star')}
 </button>
 </div>
 <p class="aero-text-muted text-sm">${escapeHtml(suite.description || 'No description')}</p>
 ${isWebsite && suite.website_method === 'url' ? `
 <p class="text-xs aero-text-muted mt-1">${window.LVXIcons.svg('link')} ${escapeHtml(suite.website_url || 'No URL')}</p>
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
 ${escapeHtml(suite.last_run_status)}
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
  ${window.LVXIcons.svg('chart')} History
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
    window.LVXProduct?.setSuiteMocks({});

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
    updateDataSetDropdown(null);
    const dataSetSelect = document.getElementById('suite_data_set');
    if (dataSetSelect) dataSetSelect.onchange = event => updateDataSetDropdown(event.target.value);
    switchEditorTab('code');

    // Reset website integration data
    websiteFiles = { html: null, css: [], js: [] };
    const websiteConfig = document.getElementById('website-testing-config');
    if (websiteConfig) websiteConfig.classList.add('hidden');

    const uploadedPreview = document.getElementById('website-files-preview');
    if (uploadedPreview) uploadedPreview.innerHTML = 'No files uploaded yet';

    // Reset tags
    currentEditTags = [];
    renderTagsInEditor();

    const suiteModal = document.getElementById('suite-modal');
    if (suiteModal) {
        suiteModal.classList.remove('hidden');

        // Initialize Monaco Editor after modal is visible
        setTimeout(async () => {
            try {
                const defaultLanguage = 'python';
                const defaultCode = '';
                currentMonacoEditor = await initializeMonaco('monaco-editor-container', defaultLanguage, defaultCode);
                console.log('Monaco Editor initialized in Add Suite modal');
            } catch (error) {
                console.error('Failed to initialize Monaco:', error);
                showMessage('Failed to load code editor', 'error');
            }
        }, 100);
    }
}

function closeEditorModal() {
    if(editingSuiteId)currentStorage?.discardEdit?.(editingSuiteId);
    const modal = document.getElementById('suite-modal');
    if (modal) modal.classList.add('hidden');

    // Dispose Monaco editor instance
    if (currentMonacoEditor) {
        try {
            currentMonacoEditor.dispose();
            currentMonacoEditor = null;
            console.log('Monaco Editor disposed');
        } catch (error) {
            console.error('Error disposing Monaco:', error);
        }
    }
}

// ============================================
// *** NEW EDIT LOGIC ***
// This function now acts as a router,
// deciding which editor modal to open.
// ============================================
async function editSuite(suiteId) {
    let desktopSuite=null;
    if(currentStorage?.beginEdit) {
        try {desktopSuite=await currentStorage.beginEdit(suiteId);} catch(error){showMessage(error.message,'error');return;}
    }
    const suite = desktopSuite || testSuites.find(s => s.id === suiteId);
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

function updateDataSetDropdown(selectedId) {
    const select = document.getElementById('suite_data_set');
    if (!select) return;
    if (selectedId === undefined) selectedId = select.value || null;
    const dataSets = window.dataManager?.getAllDataSets() || [];

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
    if (!previewContainer) return;
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
    if (currentMonacoEditor) {
        let editorLang = language;
        if (language === 'website' || language === 'robot') editorLang = 'robotframework';

        const model = currentMonacoEditor.getModel();
        if (model) {
            monaco.editor.setModelLanguage(model, editorLang === 'playwright' ? 'javascript' : editorLang);
            validateRobotFramework(currentMonacoEditor);
        }
    }
}

function openNormalSuiteEditor(suite) {
    editingSuiteId = suite.id; // Set the global editing ID
    window.LVXProduct?.setSuiteMocks(suite.mock_builder||{});

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
    setElementValue('webhook_url', suite.webhook_url);
    setElementValue('integration_info', suite.integration_info);

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

        // Initialize Monaco Editor with existing code after modal is visible
        setTimeout(async () => {
            try {
                // Map language for Monaco
                let editorLanguage = suite.language || 'python';
                if (editorLanguage === 'website') {
                    editorLanguage = 'robot'; // Website tests use Robot Framework
                }

                const suiteCode = suite.code || '';
                currentMonacoEditor = await initializeMonaco('monaco-editor-container', editorLanguage, suiteCode);
                console.log(`Monaco Editor initialized for editing with language: ${editorLanguage}`);
            } catch (error) {
                console.error('Failed to initialize Monaco:', error);
                showMessage('Failed to load code editor', 'error');
            }
        }, 100);
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
        mock_builder: window.LVXProduct?.getSuiteMocks()||{},
        description: getElementValue('suite_description'),
        language: getElementValue('suite_language', 'python'),
        code: currentMonacoEditor ? currentMonacoEditor.getValue() : '',
        expected_output: getElementValue('expected_output'),
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
            if (existingSuite && window.versionControl && !currentStorage.beginEdit) {
                await window.versionControl.saveVersion(
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
        if(currentStorage.beginEdit&&['CONFLICT','NOT_FOUND'].includes(error.code)){await showSuiteSaveConflict(suite,error);return;}
        showMessage("Failed to save: " + error.message, 'error');
    }
}

async function showSuiteSaveConflict(local,error) {
    const id=editingSuiteId,base=currentStorage.edits.get(id)?.value||{};
    const api=window.electronAPI.studioOps;
    const remote=await (api.invokeRaw||api.invoke)('workspace','read',{collection:'suites',id,workspaceRoot:currentStorage.workspaceRoot});
    if(remote?.__lvxError)throw new Error(remote.__lvxError.message);
    document.getElementById('suite-save-conflict')?.remove();
    const panel=document.createElement('section');panel.id='suite-save-conflict';panel.className='studio-conflict';panel.setAttribute('role','alert');
    const heading=document.createElement('h3');heading.textContent=remote?'Another window changed this suite':'This suite was deleted in another window';panel.append(heading);
    const explanation=document.createElement('p');explanation.textContent='Your draft is still open. Review the saved changes, save a separate copy, or export your draft.';panel.append(explanation);
    const action=(label,callback)=>{const button=document.createElement('button');button.type='button';button.className='aero-button px-3 py-2';button.textContent=label;button.onclick=async()=>{button.disabled=true;try{await callback();}catch(e){showMessage(e.message,'error');}finally{button.disabled=false;}};panel.append(button);};
    action('Export draft',async()=>{const safe=window.LVXCredentials?await window.LVXCredentials.protect(local,'Suite draft'):local;const url=URL.createObjectURL(new Blob([JSON.stringify(safe,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='lvx-suite-draft.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    action('Save as separate copy',async()=>{await currentStorage.saveSuite({...local,name:local.name+' (copy)'});closeEditorModal();await LVXApp.refreshSuites();});
    if(remote){
        action('Reload saved version',async()=>{await editSuite(id);panel.remove();});
        const {mergeConflict}=await import('./studio-model.js');const reviewed=mergeConflict(base,local,remote.value),choices=[];
        for(const field of reviewed.conflicts){const label=document.createElement('label');label.className='studio-field';label.textContent=field.replace(/_/g,' ');const select=document.createElement('select');for(const [key,text]of [['remote','Use saved value'],['local','Use my draft value']]){const option=document.createElement('option');option.value=key;option.textContent=text;select.append(option);}label.append(select);const details=document.createElement('details'),summary=document.createElement('summary'),values=document.createElement('pre');summary.textContent='Compare values';values.textContent=JSON.stringify({saved:remote.value[field],draft:local[field]},null,2);details.append(summary,values);label.append(details);panel.append(label);choices.push({field,select});}
        action('Save reviewed merge',async()=>{for(const {field,select}of choices)reviewed.merged[field]=select.value==='local'?local[field]:remote.value[field];await currentStorage.mergeSuite(id,reviewed.merged,remote.revision);closeEditorModal();await LVXApp.refreshSuites();});
    }
    document.getElementById('suite-form').append(panel);heading.tabIndex=-1;heading.focus();
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

function normalizeExecutionStatus(result) {
    if (result && result.status !== undefined) {
        const status = String(result.status).toUpperCase();
        if (['SUCCESS', 'PASS', 'PASSED'].includes(status)) return 'SUCCESS';
        if (['FAILURE', 'FAIL', 'FAILED'].includes(status)) return 'FAILURE';
        return 'ERROR';
    }
    return result?.success === true ? 'SUCCESS' : result?.success === false ? 'FAILURE' : 'ERROR';
}

// Expected Output uses exact text, normalizing platform newlines and one terminal newline.
function normalizeExpectedOutput(value) {
    return window.ExecutionValidation.normalizeExecutionText(value);
}

async function executeSuiteCore(suite) {
    try {
        if(typeof window.electronAPI?.studioOps?.invoke==='function')await window.electronAPI.studioOps.invoke('host','checkImported',{definition:suite});
        // Replace environment variables
        const codeToExecute = window.environmentManager
            ? window.environmentManager.replaceEnvironmentVariables(suite.code)
            : suite.code;

        const envInputs = window.environmentManager?.getExecutionParameters?.() || {parameters:{},parameterSchema:{}};
        const validationSource=window.ExecutionValidation.getSuiteValidationSource(suite),validationMode=window.ExecutionValidation.getSuiteValidationMode(suite.language,validationSource);
        const executionOptions = {...(validationMode==='python-assertions'?{validationCode:validationSource}:{}),parameters:{...envInputs.parameters,...(suite.parameters||{})},parameterSchema:{...envInputs.parameterSchema,...(suite.parameter_schema||suite.parameterSchema||{})}};
        let result;
        if (suite.language === 'python') {
            result = await executePythonCode(codeToExecute, suite.input_files ?? suite.inputFiles ?? [], suite.contextVariables || {}, executionOptions);
        } else if (suite.language === 'robot') {
            if (executionConfig.robotType === 'browser') {
                result = await executeRobotFrameworkBrowser(codeToExecute, executionOptions);
            } else if (executionConfig.robotType === 'backend') {
                result = await executeRobotFrameworkBackend(codeToExecute);
            } else {
                result = await executeRobotFrameworkApi(codeToExecute);
            }
        } else if (suite.language === 'java') {
            result = await executeJavaCode(codeToExecute, suite.input_files ?? suite.inputFiles ?? [], executionOptions);
        } else if (suite.language === 'csharp') {
            result = await executeCSharpCode(codeToExecute, suite.input_files ?? suite.inputFiles ?? [], executionOptions);
        } else if (suite.language === 'website') {
            if (suite.vwt_steps_json && typeof window.vwt_executeSuite === 'function') {
                result = await window.vwt_executeSuite(suite);
                result.output = result.log || '';
            } else {
            // For website integration, we might need to handle variable replacement differently 
            // if it uses specific fields, but for now we assume code replacement is sufficient 
            // or handled within executeWebsiteIntegration if it uses suite.code
            const suiteWithEnv = { ...suite, code: codeToExecute, executionOptions };
            result = await executeWebsiteIntegration(suiteWithEnv);
            }
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

            if (!scanResult?.summary || typeof scanResult.policyPassed !== 'boolean') throw new Error('Security scan evidence unavailable.');

            // Build output
            let output = `Security Scan Results\n`;
            output += `========================\n\n`;
            output += `Policy Status: ${scanResult.policyPassed ? 'PASSED' : 'FAILED'}\n\n`;
            output += `Vulnerability Summary:\n`;
            output += `  Critical: ${scanResult.summary.critical}\n`;
            output += `  High: ${scanResult.summary.high}\n`;
            output += `  Medium: ${scanResult.summary.medium}\n`;
            output += `  Low: ${scanResult.summary.low}\n`;
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
                status: scanResult.error || scanResult.status === 'ERROR' || scanResult.available === false ? 'ERROR' : scanResult.policyPassed ? 'SUCCESS' : 'FAILURE',
                success: scanResult.policyPassed,
                output: output,
                error: scanResult.policyPassed ? null : `Found ${scanResult.summary.total} vulnerabilities, policy failed`
            };
        } else {
            throw new Error(`Unsupported language: ${suite.language}`);
        }

        const status = normalizeExecutionStatus(result);
        const expected = suite.expected_output ?? suite.expectedOutput;
        const mismatch = status === 'SUCCESS' && validationMode!=='python-assertions' && expected !== undefined && expected !== null && String(expected) !== '' && normalizeExpectedOutput(result.output) !== normalizeExpectedOutput(expected);
        return {
            status: mismatch ? 'FAILURE' : status,
            output: result.output || '',
            error: mismatch ? 'Expected Output mismatch (exact comparison; CRLF normalized and one final newline ignored).' : result.error || null,
            artifacts: result.artifacts || {}
        };
    } catch (error) {
        return {
            status: 'ERROR',
            output: '',
            error: error.message
        };
    }
}

async function runDataDrivenTest(suite, dataSet, silent = false, inputs = {}) {
    const startTime = Date.now();
    if (!silent) document.getElementById('run-modal').classList.remove('hidden');
    if (!silent) document.getElementById('run-modal-content').textContent = `Initializing Data-Driven Test with ${dataSet.data.length} rows...`;

    let totalLog = `=== DATA-DRIVEN EXECUTION LOG ===\n`;
    totalLog += `Suite: ${suite.name}\n`;
    totalLog += `Data Set: ${dataSet.name} (${dataSet.data.length} rows)\n`;
    totalLog += `Started: ${new Date().toLocaleString()}\n\n`;

    let successCount = 0;
    let failureCount = 0;
    let errorCount = 0;
    const artifacts = {};

    for (let i = 0; i < dataSet.data.length; i++) {
        const row = dataSet.data[i];
        const rowLogPrefix = `[ROW ${i + 1}] `;

        if (!silent) document.getElementById('run-status-indicator').innerHTML =
            `<span class="text-yellow-400"><div class="spinner"></div> Running Row ${i + 1}/${dataSet.data.length}...</span>`;

        const substitutedCode = window.dataManager.replaceVariables(suite.code, row);
        const tempSuite = { ...suite, code: substitutedCode, contextVariables: inputs,
            expected_output: window.dataManager.replaceVariables(suite.expected_output || '', row),
            input_files: (suite.input_files ?? suite.inputFiles ?? []).map(file => ({ ...file, content: window.dataManager.replaceVariables(file.content || '', row) })) };

        const result = await executeSuiteCore(tempSuite);

        totalLog += `${rowLogPrefix} Status: ${result.status}\n`;
        if (result.status === 'SUCCESS') successCount++;
        else { failureCount++; if (result.status === 'ERROR') errorCount++; }
        if (result.status === 'SUCCESS') Object.assign(artifacts, result.artifacts || {});

        totalLog += `Output:\n${result.output}\n`;
        if (result.error) totalLog += `Error:\n${result.error}\n`;
        totalLog += '-----------------------------------\n';

        if (!silent) document.getElementById('run-modal-content').textContent = totalLog;
    }

    const finalStatus = errorCount ? 'ERROR' : failureCount === 0 ? 'SUCCESS' : 'FAILURE';
    totalLog += `\n=== SUMMARY ===\n`;
    totalLog += `Total Rows: ${dataSet.data.length}\n`;
    totalLog += `Success: ${successCount}\n`;
    totalLog += `Failure: ${failureCount}\n`;
    totalLog += `Final Status: ${finalStatus}\n`;

    if (!silent) document.getElementById('run-modal-content').textContent = totalLog;

    const statusHtml = finalStatus === 'SUCCESS'
        ? '<span class="text-green-500">'+window.LVXIcons.svg('check')+' Success</span>'
        : '<span class="text-red-500">'+window.LVXIcons.svg('close')+' Failure</span>';
    if (!silent) document.getElementById('run-status-indicator').innerHTML = statusHtml;

    suite.last_run_status = finalStatus;
    suite.last_run_time = new Date().toISOString();
    suite.last_run_log = totalLog;
    await currentStorage.updateSuite(suite.id, { last_run_status: finalStatus, last_run_time: suite.last_run_time, last_run_log: totalLog });

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

    return { status: finalStatus, log: totalLog, artifacts, duration: Date.now() - startTime };
}

async function runTestSuite(suiteId, silent = false, inputs = {}) {
    const suiteForPlan=testSuites.find(suite=>suite.id===suiteId);
    const mock=suiteForPlan?.mock_builder;
    if(mock&&(mock.mocks?.length||mock.setupSteps?.length||mock.teardownSteps?.length||mock.fileData?.rows?.length)&&window.electronAPI?.studioOps&&window.LVXMachinaGraph){
      return window.LVXMachinaGraph.runWorkflow({schemaVersion:1,name:suiteForPlan.name,nodes:[{id:'suite-'+suiteId,type:'test-suite',data:{suite:suiteForPlan,suiteId,name:suiteForPlan.name}}],edges:[]},{waitForCompletion:true,parameters:inputs});
    }
    const suite = testSuites.find(s => s.id === suiteId);
    if (!suite) {
        if (!silent) showMessage('Suite not found', 'error');
        return { status: 'FAILURE', log: 'Suite not found' };
    }

    // Check for Data Set
    if (suite.dataSetId) {
        const dataSet = window.dataManager?.getDataSet(suite.dataSetId);
        if (dataSet && dataSet.data.length > 0) {
            return await runDataDrivenTest(suite, dataSet, silent, inputs);
        }
        return { status: 'ERROR', log: 'Configured data set is missing or empty.' };
    }

    // *** NEW LOGIC: Reroute Visual Web Tests to the Live Runner ***
    if (suite.language === 'website' && suite.website_method === 'upload' && !silent) {
        if (typeof vwt_openLiveRunner === 'function') {
            vwt_openLiveRunner(suite);
            return { status: 'PENDING', log: 'Opened in Visual Runner' };
        }
    }

    if (!silent) {
        document.getElementById('run-modal').classList.remove('hidden');
        document.getElementById('run-modal-content').textContent = 'Initializing...';
        document.getElementById('run-status-indicator').innerHTML = '<span class="text-yellow-400"><div class="spinner"></div> Running...</span>';
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

        // Inject inputs into suite object for core execution
        const suiteWithInputs = { ...suite, contextVariables: inputs };
        result = await executeSuiteCore(suiteWithInputs);

        log += `[OUTPUT]\n${result.output}\n`;
        if (result.error) {
            log += `[STDERR]\n${result.error}\n`;
        }

        status = result.status;
        executionOutput = result.output;


    } else {
        // Simulated mode
        log += `[CODE] Displaying code (simulation mode)...\n\n`;
        if (suite.code) {
            log += suite.code.split('\n').map(line => ` ${line}`).join('\n');
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
}

function formatTime(date) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ============================================
// IMPORT/EXPORT
// ============================================

async function exportToJSON() {
    // Collect all version histories from localStorage
    const versionHistories = {};

    if (testSuites && Array.isArray(testSuites)) {
        for (const suite of testSuites) {
            if (suite.id && window.versionControl) {
                const versions = await window.versionControl.getVersionHistory(suite.id);
                if (versions && versions.length > 0) {
                    versionHistories[suite.id] = versions;
                }
            }
        }
    }

    // Export pipelines if they exist
    let pipelines = [];
    try {
        const storedPipelines = localStorage.getItem('lvx_pipelines');
        if (storedPipelines) pipelines = JSON.parse(storedPipelines);
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

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pipeline_suites_export_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);

    const versionCount = Object.keys(versionHistories).reduce((sum, key) => sum + versionHistories[key].length, 0);
    showMessage(`Export completed: ${testSuites.length} suite(s), ${pipelines.length} pipeline(s), ${versionCount} version(s)`, 'success');
}

async function importFromJSON(event) {
    const input = event.target, file = input.files[0];
    if (!file || input.disabled) return;
    input.value = '';
    window.LVXStudio?.clearImport?.();
    input.disabled = true;
    try {
        if (file.size > 100 * 1024 * 1024) throw new Error('This file is too large. Project imports support files up to 100 MB.');
        const content = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
        // Full project exports use the native validated importer, including graphs,
        // agents, conversations and evidence. Never reduce them to legacy suites.
        if (content?.format === 'lvx-workspace') {
            if (!window.LVXStudio?.importFile) throw new Error('Project import is unavailable. Open the current Windows desktop build.');
            await window.LVXStudio.importFile(file, content);
            return;
        }
        const suites = Array.isArray(content) ? content : content?.test_suites;
        if (!Array.isArray(suites)) throw new Error('Unsupported JSON file. Choose an LVX project export or a test-suite export. Import workflow bundles from Workflows.');
        if (suites.some(suite => !suite || typeof suite !== 'object' || Array.isArray(suite) || typeof suite.name !== 'string' || !suite.name.trim())) throw new Error('Every imported test suite needs a name. Nothing was imported.');
        if (!currentStorage) throw new Error('Please configure storage first.');
        // Validate the format before touching views or pipelines.
        if (Array.isArray(content.views)) { views = content.views; saveViewsToStorage(); renderViews(); }
        if (Array.isArray(content.pipelines)) { localStorage.setItem('lvx_pipelines', JSON.stringify(content.pipelines)); if (typeof loadPipelines === 'function') loadPipelines(); }
        let imported = 0, failed = 0;
        for (const suite of suites) {
            try { const {id, ...copy} = suite; if (!copy.view_id) copy.view_id = null; await currentStorage.saveSuite(copy); imported++; }
            catch (error) { failed++; console.error('Failed to import suite:', error); }
        }
        await window.LVXApp.refreshSuites();
        showMessage(failed ? `Imported ${imported} test suite(s); ${failed} could not be saved. Check storage before retrying.` : suites.length ? `Imported ${imported} test suite(s)` : 'No test suites found in file', failed ? 'error' : suites.length ? 'success' : 'info');
    } catch (error) {
        console.error('Import error:', error);
        showMessage('Failed to import: ' + error.message, 'error');
    } finally { input.disabled = false; }
}

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


    if (language === 'website') {
        if (websiteOptions) websiteOptions.classList.remove('hidden');

    } else {
        if (websiteOptions) websiteOptions.classList.add('hidden');

    }
}

function toggleWebsiteMethod() { return toggleWebsiteMethodInputs(); }

function toggleWebsiteMethodInputs() {
    const method = document.querySelector('input[name="website-method"]:checked').value;
    const urlInput = document.getElementById('website-url-config');
    const uploadInput = document.getElementById('website-upload-config');

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
    if (!window.electronAPI?.studioOps) throw new Error('Website integration tests require the desktop Robot runner. Browser preview cannot execute uploaded scripts.');
    if (!suite.code?.trim()) throw new Error('Add Robot test cases before running this website integration. No tests were executed.');
    let websiteHTML;
    if (suite.website_method === 'upload' && suite.website_html_content) {
        const originalFiles = websiteFiles;
        try {
            websiteFiles = {html:suite.website_html_content,css:suite.website_css_contents||[],js:suite.website_js_contents||[]};
            websiteHTML = buildWebsiteHTML();
        } finally { websiteFiles = originalFiles; }
        if (!websiteHTML) throw new Error('Failed to build the uploaded website.');
    } else if (!suite.website_url) throw new Error('Choose a website URL or upload website files.');
    const result = await executeRobotFrameworkBrowser(suite.code, {...(suite.executionOptions||{}), ...(websiteHTML?{websiteHTML}:{websiteUrl:suite.website_url})});
    return {...result,log:'[ISOLATED WEBSITE INTEGRATION]\n'+(result.output||''),output:result.output||''};
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

    for (const suiteId of selectedSuites) {
        await runTestSuite(suiteId);
        // Small delay between runs
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

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

async function bulkAddTag() {
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
                    await currentStorage.updateSuite(suiteId, { tags: suite.tags });
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

// ============================================
// INITIALIZATION
// ============================================

window.onload = async function () {
    if(window.LVXCredentials){try{await window.LVXCredentials.migrate();window.dispatchEvent(new Event('lvx-credentials-migrated'));}catch(error){showMessage(error.message,'error');window.LVXCredentialMigrationError=error.message;}}
    loadExecutionConfig();
    initializeViews(); // Initialize views system
    storageInitialization = initializeStorage();
    await storageInitialization;
    // Initialize Pipelines if manager exists
    if (typeof initializePipelineManager === 'function') initializePipelineManager();

    // Initialize Resizing
    initAllResizables();

};


window.LVXApp = {
    async useStorage(adapter) {
        if(!adapter||typeof adapter.getAllSuites!=='function')throw new Error('A suite storage adapter is required.');
        await adapter.initialize();
        currentStorage?.dispose?.();
        currentStorage=adapter;window.currentStorage=adapter;
        storageInitialization=Promise.resolve();
        await adapter.subscribeToChanges(renderTestSuites);
        document.getElementById('storage-info').textContent=adapter.getStatusMessage();
        return window.LVXApp.refreshSuites();
    },
    async getStorage() { if (storageInitialization) await storageInitialization; return currentStorage; },
    getSuites() { return testSuites; },
    getSelectedSuite() { return testSuites.find(s => s.id === editingSuiteId) || testSuites.find(s => selectedSuites.has(s.id)) || null; },
    async refreshSuites() {
        const storage = await window.LVXApp.getStorage();
        if (!storage) throw new Error('Storage is not connected.');
        const suites = await storage.getAllSuites();
        renderTestSuites(suites);
        return suites;
    }
};
