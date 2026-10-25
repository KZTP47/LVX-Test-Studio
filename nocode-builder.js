// Robot uses two or more spaces (or a tab) between cells. Escape literals so
// user text cannot accidentally create extra cells, variables or physical rows.
function ncbRobotCell(value) {
    const text = String(value ?? '');
    return text === '' ? '${EMPTY}' : text.replace(/\\/g, '\\\\').replace(/\$/g, '\\$').replace(/#/g, '\\#')
        .replace(/ /g, '\\x20').replace(/\t/g, '\\t').replace(/\r/g, '\\r');
}
function ncbRobotRow(keyword, ...args) {
    const prelude = [];
    const cells = args.map((value, index) => {
        const lines = String(value ?? '').split('\n');
        if (lines.length === 1) return ncbRobotCell(value);
        const variable = '${lvx_arg_' + index + '}';
        prelude.push(`    ${variable}=    Catenate    SEPARATOR=\\n`);
        lines.forEach(line => prelude.push(`    ...    ${ncbRobotCell(line)}`));
        return variable;
    });
    return [...prelude, `    ${keyword}${cells.length ? '    ' + cells.join('    ') : ''}`].join('\n');
}

// ============================================
// NO-CODE VISUAL TEST BUILDER - ENHANCED
// ============================================

// --- Configuration for available steps ---
const availableSteps = [
 // --- Navigation ---
 {
 name: 'Go To URL',
 description: 'Navigates to a specific URL.',
 params: [{ key: 'url', label: 'URL', type: 'text', placeholder: 'e.g., https://example.com' }],
 template: (p) => ` Go To ${p.url}`
 },
 // --- Page Actions ---
 {
 name: 'Click Element',
 description: 'Clicks an element on the page.',
 params: [{ key: 'selector', label: 'CSS Selector', type: 'text', placeholder: 'e.g., #submit-button' }],
 template: (p) => ` Click Element ${p.selector}`
 },
 {
 name: 'Input Text',
 description: 'Types text into an input field.',
 params: [
 { key: 'selector', label: 'CSS Selector', type: 'text', placeholder: 'e.g., input[name="username"]' },
 // MODIFIED: Changed type to 'textarea' for multi-line input
 { key: 'text', label: 'Text to Input', type: 'textarea', placeholder: 'e.g., john_doe' }
 ],
 template: (p) => {
 // MODIFIED: Robust multi-line Robot Framework generation using triple-double-quotes
 const indentedText = p.text.replace(/^/gm, ' ');
 return ` Input Text ${p.selector} """\n${indentedText}\n """`;
 }
 },
 {
 name: 'Choose File',
 description: 'Uploads a file to a file input element.',
 params: [
 { key: 'selector', label: 'CSS Selector', type: 'text', placeholder: 'e.g., input[type="file"]' },
 { key: 'filepath', label: 'File Path', type: 'text', placeholder: 'e.g., /path/to/file.xlsx' }
 ],
 template: (p) => ` Choose File ${p.selector} ${p.filepath}`
 },
 {
 name: 'Scroll Page',
 description: 'Scrolls the page to the top or bottom.',
 params: [
 { key: 'direction', label: 'Direction', type: 'select', options: ['Bottom', 'Top'] }
 ],
 template: (p) => {
 if (p.direction === 'Top') {
 return ` Execute JavaScript window.scrollTo(0, 0)`;
 }
 return ` Execute JavaScript window.scrollTo(0, document.body.scrollHeight)`;
 }
 },
 {
 name: 'Scroll To Element',
 description: 'Scrolls until a specific element is visible.',
 params: [
 { key: 'selector', label: 'CSS Selector', type: 'text', placeholder: 'e.g., #footer' }
 ],
 template: (p) => ` Execute JavaScript document.querySelector('${p.selector}').scrollIntoView()`
 },
 // --- Verifications ---
 {
 name: 'Element Should Be Visible',
 description: 'Verifies that an element is visible.',
 params: [{ key: 'selector', label: 'CSS Selector', type: 'text', placeholder: 'e.g., #welcome-message' }],
 template: (p) => ` Element Should Be Visible ${p.selector}`
 },
 {
 name: 'Element Should Contain',
 description: 'Verifies an element contains specific text.',
 params: [
 { key: 'selector', label: 'CSS Selector', type: 'text', placeholder: 'e.g., h1' },
 { key: 'text', label: 'Expected Text', type: 'text', placeholder: 'e.g., Welcome' }
 ],
 template: (p) => ` Element Should Contain ${p.selector} ${p.text}`
 },
 {
 name: 'Page Should Contain',
 description: 'Verifies that text exists anywhere on the page.',
 params: [
 { key: 'text', label: 'Expected Text', type: 'text', placeholder: 'e.g., Success' }
 ],
 template: (p) => ` Page Should Contain ${p.text}`
 },
 {
 name: 'Wait For Element',
 description: 'Waits for an element to appear.',
 params: [
 { key: 'selector', label: 'CSS Selector', type: 'text', placeholder: 'e.g., #results' },
 { key: 'timeout', label: 'Timeout (seconds)', type: 'number', placeholder: '5' }
 ],
 template: (p) => ` Wait For Element ${p.selector} timeout=${p.timeout || 5}`
 },
 // --- Form Interactions ---
 {
 name: 'Check Checkbox',
 description: 'Selects (checks) a checkbox.',
 params: [
 { key: 'selector', label: 'CSS Selector', type: 'text', placeholder: 'e.g., #terms-and-conditions' }
 ],
 template: (p) => ` Check Checkbox ${p.selector}`
 },
 {
 name: 'Uncheck Checkbox',
 description: 'Deselects (unchecks) a checkbox.',
 params: [
 { key: 'selector', label: 'CSS Selector', type: 'text', placeholder: 'e.g., #newsletter-signup' }
 ],
 template: (p) => ` Uncheck Checkbox ${p.selector}`
 },
 {
 name: 'Select From Dropdown',
 description: 'Selects an option from a dropdown list.',
 params: [
 { key: 'selector', label: 'CSS Selector of Dropdown', type: 'text', placeholder: 'e.g., #country-select' },
 { key: 'value', label: 'Option to Select', type: 'text', placeholder: 'e.g., USA' }
 ],
 template: (p) => ` Select From List ${p.selector} ${p.value}`
 },
 // --- Data & Variables ---
 {
 name: 'Get Text',
 description: 'Gets the text of an element and stores it in a variable.',
 params: [
 { key: 'variable', label: 'Variable Name', type: 'text', placeholder: 'e.g., ${header_text}' },
 { key: 'selector', label: 'CSS Selector', type: 'text', placeholder: 'e.g., h1' }
 ],
 template: (p) => ` ${p.variable} Get Text ${p.selector}`
 },
 {
 name: 'Log',
 description: 'Logs a message or variable to the console.',
 params: [
 { key: 'message', label: 'Message/Variable', type: 'text', placeholder: 'e.g., ${my_variable}' }
 ],
 template: (p) => ` Log ${p.message}`
 }
];

function ncbGenerateStep(step, browserOnly) {
    const p = step.params || {};
    const row = ncbRobotRow;
    if (browserOnly && ['Go To URL', 'Choose File'].includes(step.name)) return row('Fail', `${step.name} requires a native browser backend; it cannot be omitted from this test.`);
    switch (step.name) {
        case 'Go To URL': return row('Go To', p.url);
        case 'Click Element': return row('Click Element', p.selector);
        case 'Input Text': return row('Input Text', p.selector, p.text);
        case 'Choose File': return row('Choose File', p.selector, p.filepath);
        case 'Scroll Page': return row('Execute JavaScript', p.direction === 'Top' ? 'window.scrollTo(0, 0)' : 'window.scrollTo(0, document.body.scrollHeight)');
        case 'Scroll To Element': return row('Execute JavaScript', `document.querySelector(${JSON.stringify(p.selector)}).scrollIntoView()`);
        case 'Element Should Be Visible': return row('Element Should Be Visible', p.selector);
        case 'Element Should Contain': return row('Element Should Contain', p.selector, p.text);
        case 'Page Should Contain': return row('Page Should Contain', p.text);
        case 'Wait For Element': return row(browserOnly ? 'Wait For Element' : 'Wait Until Element Is Visible', p.selector, String(p.timeout || 5));
        case 'Check Checkbox': return row(browserOnly ? 'Check Checkbox' : 'Select Checkbox', p.selector);
        case 'Uncheck Checkbox': return row(browserOnly ? 'Uncheck Checkbox' : 'Unselect Checkbox', p.selector);
        case 'Select From Dropdown': return row(browserOnly ? 'Select From List' : 'Select From List By Value', p.selector, p.value);
        case 'Get Text': {
            if (!/^\$\{[a-zA-Z_][\w ]*\}$/.test(p.variable || '')) throw new Error('Get Text requires a Robot variable such as ${header_text}');
            return `    ${p.variable}=    Get Text    ${ncbRobotCell(p.selector)}`;
        }
        case 'Log': return row('Log', p.message);
        default: throw new Error(`Unsupported builder step: ${step.name}`);
    }
}

availableSteps.forEach(config => { config.template = params => ncbGenerateStep({ name: config.name, params }, true); });

// --- State Management ---
let testSteps = [];
let selectedStepIndex = null;
let dragStartIndex = null;

// --- Core Functions ---

/**
 * Initializes the No-Code Builder UI components.
 */
function initializeNoCodeBuilder() {
 const toolbox = document.getElementById('nocode-toolbox');
 if (!toolbox) return;

 toolbox.innerHTML = '';
 availableSteps.forEach(step => {
 const stepEl = document.createElement('div');
 stepEl.className = 'aero-button p-3 rounded cursor-grab no-code-step';
 stepEl.draggable = true;
 stepEl.innerHTML = `
 <div class="font-semibold">${step.name}</div>
 <div class="text-xs aero-text-muted">${step.description}</div>
 `;
 stepEl.addEventListener('dragstart', (e) => {
 // This is for adding NEW steps from the toolbox
 dragStartIndex = null;
 e.dataTransfer.setData('text/plain', step.name);
 });
 toolbox.appendChild(stepEl);
 });

 const canvas = document.getElementById('nocode-canvas');
 canvas.addEventListener('dragover', (e) => {
 e.preventDefault();
 canvas.classList.add('drag-over');
 });
 canvas.addEventListener('dragleave', () => canvas.classList.remove('drag-over'));
 canvas.addEventListener('drop', handleDrop);
}

/**
 * Opens the builder modal and populates it.
 */
function openNoCodeBuilder() {
 testSteps = [];
 selectedStepIndex = null;
 renderCanvas();
 renderPropertiesPanel();
 document.getElementById('nocode-builder-modal').classList.remove('hidden');
 document.body.classList.add('modal-open');
}

/**
 * Closes the builder modal.
 */
function closeNoCodeBuilder() {
 document.getElementById('nocode-builder-modal').classList.add('hidden');
 document.body.classList.remove('modal-open');
}

/**
 * Handles dropping a new step onto the canvas.
 * @param {DragEvent} e - The drop event.
 */
function handleDrop(e) {
 e.preventDefault();
 document.getElementById('nocode-canvas').classList.remove('drag-over');

 // This handler is for ADDING new steps.
 // We only proceed if we are NOT re-ordering (dragStartIndex will be a number when re-ordering).
 if (dragStartIndex !== null) {
 return;
 }

 const stepName = e.dataTransfer.getData('text/plain');
 const stepConfig = availableSteps.find(s => s.name === stepName);

 if (stepConfig) {
 const newStep = {
 id: `step_${Date.now()}`,
 name: stepConfig.name,
 params: {}
 };
 stepConfig.params.forEach(p => {
 if (p.type === 'select' && p.options) {
 newStep.params[p.key] = p.options[0];
 } else {
 newStep.params[p.key] = '';
 }
 });

 testSteps.push(newStep);
 renderCanvas();
 selectStep(testSteps.length - 1);
 }
}

/**
 * Renders the list of added test steps on the canvas.
 */
function renderCanvas() {
 const canvas = document.getElementById('nocode-canvas');
 canvas.innerHTML = '';

 if (testSteps.length === 0) {
 canvas.innerHTML = `<div class="text-center aero-text-muted p-8">Drag steps from the left panel and drop them here.</div>`;
 }

 testSteps.forEach((step, index) => {
 const stepEl = document.createElement('div');
 const stepConfig = availableSteps.find(s => s.name === step.name);
 stepEl.className = `p-4 mb-2 rounded border-l-4 flex justify-between items-center no-code-step ${selectedStepIndex === index ? 'aero-button-primary' : 'aero-card'}`;
 stepEl.draggable = true;
 stepEl.dataset.index = index;

 stepEl.innerHTML = `
 <div>
 <span class="font-bold">${index + 1}. ${step.name}</span>
 </div>
 <button class="aero-button-danger text-xs py-1 px-2 rounded" onclick="deleteStep(${index}, event)">Delete</button>
 `;

 stepEl.addEventListener('click', () => selectStep(index));

 // Drag and drop for REORDERING existing steps
 stepEl.addEventListener('dragstart', (e) => {
 dragStartIndex = index;
 e.dataTransfer.effectAllowed = 'move';
 });

 stepEl.addEventListener('dragover', (e) => e.preventDefault());

 stepEl.addEventListener('drop', (e) => {
 if (dragStartIndex === null) {
 return;
 }
 e.stopPropagation();
 e.preventDefault();

 const dropIndex = index;
 if (dragStartIndex === dropIndex) return;

 const draggedItem = testSteps[dragStartIndex];

 testSteps.splice(dragStartIndex, 1);
 testSteps.splice(dropIndex, 0, draggedItem);

 dragStartIndex = null;

 renderCanvas();
 selectStep(dropIndex);
 });

 canvas.appendChild(stepEl);
 });
}

/**
 * Renders the properties form for the currently selected step.
 */
function renderPropertiesPanel() {
 const propertiesPanel = document.getElementById('nocode-properties');
 if (selectedStepIndex === null || !testSteps[selectedStepIndex]) {
 propertiesPanel.innerHTML = `<div class="text-center aero-text-muted p-8">Select a step to configure its properties.</div>`;
 return;
 }

 const step = testSteps[selectedStepIndex];
 const stepConfig = availableSteps.find(s => s.name === step.name);

 let formHTML = `<h3 class="text-xl font-bold aero-text-primary mb-4">Properties for: ${step.name}</h3>`;

 stepConfig.params.forEach(param => {
 const value = step.params[param.key] || '';
 formHTML += `<div class="mb-3">
 <label class="block text-sm font-medium aero-text-secondary mb-1">${param.label}</label>`;

 if (param.type === 'select') {
 formHTML += `<select oninput="updateStepParam(${selectedStepIndex}, '${param.key}', this.value)" class="w-full aero-input p-2 rounded">`;
 param.options.forEach(option => {
 formHTML += `<option value="${option}" ${value === option ? 'selected' : ''}>${option}</option>`;
 });
 formHTML += `</select>`;
 } else if (param.type === 'textarea') { // Handle textarea input for multi-line
 formHTML += `<textarea
 placeholder="${param.placeholder || ''}"
 oninput="updateStepParam(${selectedStepIndex}, '${param.key}', this.value)"
 class="w-full aero-input p-2 rounded h-32">${escapeHtml(value)}</textarea>`;
 } else {
 formHTML += `<input type="${param.type}"
 placeholder="${param.placeholder || ''}"
 value="${escapeHtml(value)}"
 oninput="updateStepParam(${selectedStepIndex}, '${param.key}', this.value)"
 class="w-full aero-input p-2 rounded">`;
 }
 formHTML += `</div>`;
 });

 propertiesPanel.innerHTML = formHTML;
}

// --- Event Handlers and Actions ---

function selectStep(index) {
 selectedStepIndex = index;
 renderCanvas();
 renderPropertiesPanel();
}

function deleteStep(index, event) {
 event.stopPropagation();
 testSteps.splice(index, 1);

 if (selectedStepIndex === index) {
 selectedStepIndex = null;
 } else if (selectedStepIndex > index) {
 selectedStepIndex--;
 }

 renderCanvas();
 renderPropertiesPanel();
}

function updateStepParam(index, key, value) {
 if (testSteps[index]) {
 testSteps[index].params[key] = value;
 }
}

/**
 * Generates UNIVERSAL Robot Framework code and applies it.
 */
function generateAndApplyCode() {
 generateCode(false);
}

/**
 * Generates BROWSER-ONLY Robot Framework code and applies it.
 */
function generateAndApplyBrowserCode() {
 generateCode(true);
}

/**
 * Generates Robot Framework code from the visual steps and applies it to the main editor.
 * @param {boolean} browserOnly - If true, filters out steps not compatible with the in-browser library.
 */
function generateCode(browserOnly = false) {
 if (testSteps.length === 0) {
 showMessage('Add at least one step to generate code.', 'error');
 return;
 }

 let stepsToGenerate = testSteps;
 let removedStepsCount = 0;

 // Unsupported browser-only actions produce explicit Fail rows instead of being dropped.

 let code = `*** Settings ***\n`;
 if (browserOnly) {
 code += `Library    BrowserLibrary\n\n`;
 } else {
 code += `Library    SeleniumLibrary\n\n`;
 }
 code += `*** Test Cases ***\n`;
 code += `Visually Generated Test Case\n`;

 stepsToGenerate.forEach(step => {
 const stepConfig = availableSteps.find(s => s.name === step.name);
 if (stepConfig) {
 code += ncbGenerateStep(step, browserOnly) + '\n';
 }
 });

 // Use Monaco editor instance if available, otherwise fallback to textarea
 const monacoInstance = window.getMonacoInstance ? window.getMonacoInstance() : null;
 if (monacoInstance) {
 monacoInstance.setValue(code);
 } else {
 // Fallback to old textarea method
 const codeEditor = document.getElementById('suite_code');
 if (codeEditor) {
 codeEditor.value = code;
 }
 }

 if (removedStepsCount > 0) {
 showMessage(`Code generated! ${removedStepsCount} incompatible step(s) were removed for browser-only execution.`, 'warning');
 } else {
 showMessage('Robot Framework code generated!', 'success');
 }

 closeNoCodeBuilder();
 return code;
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', initializeNoCodeBuilder);

// Utility function to escape HTML for safe rendering (copied from script.js)
function escapeHtml(text) {
 if (text === null || typeof text === 'undefined') return '';
 const div = document.createElement('div');
 div.textContent = text;
 return div.innerHTML;
}
