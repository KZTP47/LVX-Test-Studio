
// ============================================
// UNIT TESTING SYSTEM
// ============================================

// Data Structures
let unitTests = [];
let currentUnitTestFilter = {
    suiteId: null,
    searchText: '',
    statusFilter: '',
    frameworkFilter: ''
};

// Monaco editors for unit test editor
let unitTestEditors = {
    setup: null,
    test: null,
    teardown: null
};

let unitTestsReadyPromise = null;

function getUnitTestStorageManager() {
    return window.storageManager && window.storageManager.STORES ? window.storageManager : null;
}

async function syncUnitTestsFromIndexedDb() {
    const storageManager = getUnitTestStorageManager();
    if (!storageManager) {
        return unitTests;
    }

    try {
        const storedTests = await storageManager.getAll(storageManager.STORES.unitTests);
        if (Array.isArray(storedTests) && storedTests.length > 0) {
            unitTests = storedTests;
            if (typeof renderUnitTestsList === 'function') renderUnitTestsList();
            if (typeof renderUnitTestSuitesList === 'function') renderUnitTestSuitesList();
            if (typeof updateUnitTestStatistics === 'function') updateUnitTestStatistics();
        }
        localStorage.removeItem('lvx_unit_tests');
    } catch (error) {
        console.warn('Failed to load unit tests from IndexedDB:', error);
    }

    return unitTests;
}

async function persistUnitTestsToIndexedDb() {
    const storageManager = getUnitTestStorageManager();
    if (!storageManager) {
        localStorage.setItem('lvx_unit_tests', JSON.stringify(unitTests));
        return true;
    }

    try {
        await storageManager.replaceAll(storageManager.STORES.unitTests, unitTests);
        localStorage.removeItem('lvx_unit_tests');
        return true;
    } catch (error) {
        console.error('Failed to persist unit tests to IndexedDB:', error);
        if (typeof showMessage === 'function') showMessage('Failed to save unit tests', 'error');
        return false;
    }
}

// ============================================
// INITIALIZATION
// ============================================

function initializeUnitTestingSystem() {
    try {
        // Load unit tests from storage
        loadUnitTests();
        console.log('Unit Testing System initialized successfully');
    } catch (error) {
        console.error('Error initializing Unit Testing System:', error);
        if(typeof showMessage === 'function') showMessage('Failed to initialize Unit Testing System', 'error');
    }
}

// ============================================
// STORAGE FUNCTIONS
// ============================================

function loadUnitTests() {
    try {
        const stored = localStorage.getItem('lvx_unit_tests');
        if (stored) {
            unitTests = JSON.parse(stored);
        } else {
            unitTests = [];
        }
    } catch (error) {
        console.error('Error loading unit tests:', error);
        unitTests = [];
    }

    unitTestsReadyPromise = syncUnitTestsFromIndexedDb();
}

function saveUnitTestsToStorage() {
    try {
        persistUnitTestsToIndexedDb();
        return true;
    } catch (error) {
        console.error('Error saving unit tests:', error);
        showMessage('Failed to save unit tests', 'error');
        return false;
    }
}

function saveUnitTest(unitTest) {
    try {
        // Generate ID if not present
        if (!unitTest.id) {
            unitTest.id = `unittest-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        }
        
        // Set timestamps
        const now = new Date().toISOString();
        if (!unitTest.dateCreated) {
            unitTest.dateCreated = now;
        }
        unitTest.dateModified = now;
        
        // Set defaults
        unitTest.status = unitTest.status || 'NOT_RUN';
        unitTest.tags = unitTest.tags || [];
        unitTest.assertions_passed = unitTest.assertions_passed || 0;
        unitTest.assertions_failed = unitTest.assertions_failed || 0;
        unitTest.execution_time_ms = unitTest.execution_time_ms || 0;
        
        const existingIndex = unitTests.findIndex(test => test.id === unitTest.id);
        if (existingIndex >= 0) {
            unitTests[existingIndex] = {
                ...unitTests[existingIndex],
                ...unitTest
            };
        } else {
            unitTests.push(unitTest);
        }
        
        // Save to storage
        saveUnitTestsToStorage();
        
        showMessage(existingIndex >= 0 ? 'Unit test updated successfully' : 'Unit test created successfully', 'success');
        return unitTest;
    } catch (error) {
        console.error('Error saving unit test:', error);
        showMessage('Failed to save unit test', 'error');
        return null;
    }
}

function updateUnitTest(id, updates) {
    try {
        const index = unitTests.findIndex(test => test.id === id);
        if (index === -1) {
            showMessage('Unit test not found', 'error');
            return false;
        }
        
        // Update the test
        unitTests[index] = {
            ...unitTests[index],
            ...updates,
            dateModified: new Date().toISOString()
        };
        
        // Save to storage
        saveUnitTestsToStorage();
        
        showMessage('Unit test updated successfully', 'success');
        return true;
    } catch (error) {
        console.error('Error updating unit test:', error);
        showMessage('Failed to update unit test', 'error');
        return false;
    }
}

function deleteUnitTest(id) {
    try {
        const index = unitTests.findIndex(test => test.id === id);
        if (index === -1) {
            showMessage('Unit test not found', 'error');
            return false;
        }
        
        // Remove from array
        unitTests.splice(index, 1);
        
        // Save to storage
        saveUnitTestsToStorage();
        
        showMessage('Unit test deleted successfully', 'success');
        return true;
    } catch (error) {
        console.error('Error deleting unit test:', error);
        showMessage('Failed to delete unit test', 'error');
        return false;
    }
}

function getUnitTest(id) {
    return unitTests.find(test => test.id === id);
}

function getUnitTestsForSuite(suiteId) {
    if (!suiteId) {
        return unitTests;
    }
    return unitTests.filter(test => test.suite_id === suiteId);
}

function getUnitTestCountForSuite(suiteId) {
    return unitTests.filter(test => test.suite_id === suiteId).length;
}

// ============================================
// MODAL FUNCTIONS
// ============================================

function openUnitTestingModal() {
    try {
        const modal = document.getElementById('unit-testing-modal');
        if (!modal) {
            console.error('Unit testing modal not found');
            return;
        }
        
        // Reset filter
        currentUnitTestFilter = {
            suiteId: null,
            searchText: '',
            statusFilter: '',
            frameworkFilter: ''
        };
        
        // Clear search and filters
        const searchInput = document.getElementById('unit-test-search');
        const statusFilter = document.getElementById('unit-test-status-filter');
        const frameworkFilter = document.getElementById('unit-test-framework-filter');
        
        if (searchInput) searchInput.value = '';
        if (statusFilter) statusFilter.value = '';
        if (frameworkFilter) frameworkFilter.value = '';
        
        // Show modal
        modal.classList.remove('hidden');
        
        // Render content
        renderUnitTestSuitesList();
        renderUnitTestsList();
        updateUnitTestStatistics();
        
    } catch (error) {
        console.error('Error opening unit testing modal:', error);
        showMessage('Failed to open Unit Testing Center', 'error');
    }
}

function closeUnitTestingModal() {
    try {
        const modal = document.getElementById('unit-testing-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    } catch (error) {
        console.error('Error closing unit testing modal:', error);
    }
}

function openUnitTestEditor(testId = null) {
    try {
        const modal = document.getElementById('unit-test-editor-modal');
        if (!modal) {
            console.error('Unit test editor modal not found');
            return;
        }
        
        // Get form elements
        const form = document.getElementById('unit-test-form');
        const modalTitle = document.getElementById('unit-test-editor-title');
        
        if (testId) {
            // Edit mode
            const test = getUnitTest(testId);
            if (!test) {
                showMessage('Unit test not found', 'error');
                return;
            }
            
            modalTitle.textContent = 'Edit Unit Test';
            
            // Populate form
            document.getElementById('unit-test-id').value = test.id;
            document.getElementById('unit-test-name').value = test.name || '';
            document.getElementById('unit-test-description').value = test.description || '';
            document.getElementById('unit-test-framework').value = test.test_framework || 'custom';
            document.getElementById('unit-test-expected').value = test.expected_result || '';
            document.getElementById('unit-test-suite').value = test.suite_id || '';
            document.getElementById('unit-test-tags-input').value = test.tags ? test.tags.join(', ') : '';
            
            // Set code in editors (will be set after Monaco initializes)
            setTimeout(() => {
                if (unitTestEditors.setup) {
                    unitTestEditors.setup.setValue(test.setup_code || '');
                }
                if (unitTestEditors.test) {
                    unitTestEditors.test.setValue(test.test_code || '');
                }
                if (unitTestEditors.teardown) {
                    unitTestEditors.teardown.setValue(test.teardown_code || '');
                }
            }, 500);
            
        } else {
            // Create mode
            modalTitle.textContent = 'Create Unit Test';
            
            // Clear form
            form.reset();
            document.getElementById('unit-test-id').value = '';
            
            // Set default suite if filtered
            if (currentUnitTestFilter.suiteId) {
                document.getElementById('unit-test-suite').value = currentUnitTestFilter.suiteId;
            }
            
            // Clear editors
            setTimeout(() => {
                if (unitTestEditors.setup) unitTestEditors.setup.setValue('');
                if (unitTestEditors.test) unitTestEditors.test.setValue('');
                if (unitTestEditors.teardown) unitTestEditors.teardown.setValue('');
            }, 500);
        }
        
        // Show modal
        modal.classList.remove('hidden');
        
        // Initialize Monaco editors if not already initialized
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
            initializeUnitTestMonacoEditors();
        }, 100);
        
        // Populate suite dropdown
        populateUnitTestSuiteDropdown();
        
    } catch (error) {
        console.error('Error opening unit test editor:', error);
        showMessage('Failed to open unit test editor', 'error');
    }
}

function closeUnitTestEditor() {
    try {
        const modal = document.getElementById('unit-test-editor-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    } catch (error) {
        console.error('Error closing unit test editor:', error);
    }
}

function createNewUnitTest() {
    openUnitTestEditor(null);
}

// ============================================
// FORM HANDLING
// ============================================

function saveUnitTestFromForm() {
    try {
        const testId = document.getElementById('unit-test-id').value;
        const isEdit = !!testId;
        
        // Get form values
        const name = document.getElementById('unit-test-name').value.trim();
        const description = document.getElementById('unit-test-description').value.trim();
        const test_framework = document.getElementById('unit-test-framework').value;
        const expected_result = document.getElementById('unit-test-expected').value.trim();
        const suite_id = document.getElementById('unit-test-suite').value || null;
        const tags = document.getElementById('unit-test-tags-input').value
            .split(',')
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0);
        
        // Get code from editors (with fallback)
        let setup_code = '';
        let test_code = '';
        let teardown_code = '';
        
        if (unitTestEditors.setup && unitTestEditors.setup.getValue) {
            setup_code = unitTestEditors.setup.getValue();
        }
        
        if (unitTestEditors.test && unitTestEditors.test.getValue) {
            test_code = unitTestEditors.test.getValue();
        }
        
        if (unitTestEditors.teardown && unitTestEditors.teardown.getValue) {
            teardown_code = unitTestEditors.teardown.getValue();
        }
        
        // Validation
        if (!name) {
            showMessage('Please enter a test name', 'error');
            return;
        }
        
        if (!test_code) {
            showMessage('Please enter test code', 'error');
            return;
        }
        
        const unitTest = {
            name,
            description,
            test_framework,
            expected_result,
            suite_id,
            setup_code,
            test_code,
            teardown_code,
            tags
        };
        
        // Save or update
        if (isEdit) {
            const success = updateUnitTest(testId, unitTest);
            if (success) {
                closeUnitTestEditor();
                renderUnitTestsList();
                updateUnitTestStatistics();
            }
        } else {
            const saved = saveUnitTest(unitTest);
            if (saved) {
                closeUnitTestEditor();
                renderUnitTestsList();
                updateUnitTestStatistics();
            }
        }
        
    } catch (error) {
        console.error('Error saving unit test from form:', error);
        showMessage('Failed to save unit test: ' + error.message, 'error');
    }
}

function populateUnitTestSuiteDropdown() {
    try {
        const select = document.getElementById('unit-test-suite');
        if (!select) return;
        
        // Clear existing options except the first (None)
        select.innerHTML = '<option value="">None (Standalone)</option>';
        
        // Add test suites
        // Assume testSuites is available globally from script.js
        if (window.testSuites && Array.isArray(window.testSuites)) {
            window.testSuites.forEach(suite => {
                const option = document.createElement('option');
                option.value = suite.id;
                option.textContent = suite.name;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error populating suite dropdown:', error);
    }
}

// ============================================
// RENDERING FUNCTIONS
// ============================================

function renderUnitTestSuitesList() {
    try {
        const container = document.getElementById('unit-test-suites-list');
        if (!container) return;
        
        container.innerHTML = '';
        
        // Add "All Tests" option
        const allTestsItem = document.createElement('div');
        allTestsItem.className = `p-3 rounded-lg cursor-pointer transition duration-200 ${
            currentUnitTestFilter.suiteId === null 
                ? 'aero-button-primary text-white' 
                : 'aero-glass-panel hover:aero-button'
        }`;
        allTestsItem.innerHTML = `
            <div class="font-semibold ${currentUnitTestFilter.suiteId === null ? '' : 'aero-text-primary'}">All Tests</div>
            <div class="text-sm ${currentUnitTestFilter.suiteId === null ? 'text-white' : 'aero-text-muted'}">${unitTests.length} tests</div>
        `;
        allTestsItem.onclick = () => filterBySuite(null);
        container.appendChild(allTestsItem);
        
        // Add divider
        const divider = document.createElement('div');
        divider.className = 'border-t aero-divider my-2';
        container.appendChild(divider);
        
        // Add test suites
        if (window.testSuites) {
            window.testSuites.forEach(suite => {
                const count = getUnitTestCountForSuite(suite.id);
                const isSelected = currentUnitTestFilter.suiteId === suite.id;
                
                const suiteItem = document.createElement('div');
                suiteItem.className = `p-3 rounded-lg cursor-pointer transition duration-200 ${
                    isSelected 
                        ? 'aero-button-primary text-white' 
                        : 'aero-glass-panel hover:aero-button'
                }`;
                suiteItem.innerHTML = `
                    <div class="font-semibold ${isSelected ? '' : 'aero-text-primary'} truncate" title="${escapeHtml(suite.name)}">
                        ${escapeHtml(suite.name)}
                    </div>
                    <div class="text-sm ${isSelected ? 'text-white' : 'aero-text-muted'}">
                        ${count} test${count !== 1 ? 's' : ''}
                    </div>
                `;
                suiteItem.onclick = () => filterBySuite(suite.id);
                container.appendChild(suiteItem);
            });
        }
        
        // Add "Unlinked Tests" option
        const unlinkedCount = unitTests.filter(test => !test.suite_id).length;
        if (unlinkedCount > 0) {
            const unlinkedItem = document.createElement('div');
            unlinkedItem.className = `p-3 rounded-lg cursor-pointer transition duration-200 ${
                currentUnitTestFilter.suiteId === 'unlinked' 
                    ? 'aero-button-warning text-white' 
                    : 'aero-glass-panel hover:aero-button'
            }`;
            unlinkedItem.innerHTML = `
                <div class="font-semibold ${currentUnitTestFilter.suiteId === 'unlinked' ? '' : 'aero-text-warning'}">
                    Unlinked Tests
                </div>
                <div class="text-sm ${currentUnitTestFilter.suiteId === 'unlinked' ? 'text-white' : 'aero-text-muted'}">
                    ${unlinkedCount} test${unlinkedCount !== 1 ? 's' : ''}
                </div>
            `;
            unlinkedItem.onclick = () => filterBySuite('unlinked');
            container.appendChild(unlinkedItem);
        }
        
    } catch (error) {
        console.error('Error rendering unit test suites list:', error);
    }
}

function renderUnitTestsList() {
    try {
        const container = document.getElementById('unit-tests-list');
        if (!container) return;
        
        // Get filtered tests
        const filteredTests = getFilteredUnitTests();
        
        // Clear container
        container.innerHTML = '';
        
        // Update section title
        const titleEl = document.getElementById('unit-test-section-title');
        if (titleEl) {
            if (currentUnitTestFilter.suiteId === null) {
                titleEl.textContent = `All Unit Tests (${filteredTests.length})`;
            } else if (currentUnitTestFilter.suiteId === 'unlinked') {
                titleEl.textContent = `Unlinked Tests (${filteredTests.length})`;
            } else {
                const suite = window.testSuites ? window.testSuites.find(s => s.id === currentUnitTestFilter.suiteId) : null;
                titleEl.textContent = suite 
                    ? `${suite.name} - Unit Tests (${filteredTests.length})` 
                    : `Unit Tests (${filteredTests.length})`;
            }
        }
        
        // Show message if no tests
        if (filteredTests.length === 0) {
            container.innerHTML = `
                <div class="text-center py-12 aero-glass-panel">
                    <p class="text-lg aero-text-muted">No unit tests found</p>
                    <p class="text-sm aero-text-muted mt-2">Create your first unit test to get started</p>
                    <button onclick="createNewUnitTest()" class="aero-button-success py-2 px-4 rounded-lg mt-4">
                        + Create Unit Test
                    </button>
                </div>
            `;
            return;
        }
        
        // Render test cards
        filteredTests.forEach(test => {
            const card = createUnitTestCard(test);
            container.appendChild(card);
        });
        
    } catch (error) {
        console.error('Error rendering unit tests list:', error);
    }
}

function createUnitTestCard(test) {
    const card = document.createElement('div');
    card.className = 'aero-card p-4 rounded-lg mb-3 transition duration-200 hover:shadow-lg';
    card.dataset.testId = test.id;
    
    // Get status badge
    const statusBadge = getStatusBadge(test.status);
    
    // Get suite name
    let suiteName = 'Standalone';
    if (test.suite_id && window.testSuites) {
        const suite = window.testSuites.find(s => s.id === test.suite_id);
        suiteName = suite ? suite.name : 'Unknown Suite';
    }
    
    // Format last run time
    const lastRunTime = test.last_run_time 
        ? new Date(test.last_run_time).toLocaleString() 
        : 'Never run';
    
    card.innerHTML = `
        <div class="flex justify-between items-start mb-3">
            <div class="flex-1">
                <h4 class="font-semibold text-lg aero-text-primary mb-1">${escapeHtml(test.name)}</h4>
                <p class="text-sm aero-text-muted mb-2">${escapeHtml(test.description || 'No description')}</p>
                <div class="flex flex-wrap gap-2 items-center">
                    ${statusBadge}
                    <span class="aero-badge-info text-xs">${escapeHtml(test.test_framework)}</span>
                    <span class="text-xs aero-text-muted">Suite: ${escapeHtml(suiteName)}</span>
                    ${test.tags && test.tags.length > 0 
                        ? test.tags.map(tag => `<span class="text-xs px-2 py-1 rounded aero-glass-panel">${escapeHtml(tag)}</span>`).join('') 
                        : ''}
                </div>
            </div>
            <div class="flex gap-2 ml-4">
                <button onclick="runUnitTest('${test.id}')" 
                    class="aero-button-success py-1 px-3 rounded transition duration-200" 
                    title="Run Test">
                    ▶ Run
                </button>
                <button onclick="openUnitTestEditor('${test.id}')" 
                    class="aero-button-primary py-1 px-3 rounded transition duration-200" 
                    title="Edit Test">
                    ✎ Edit
                </button>
                <button onclick="confirmDeleteUnitTest('${test.id}')" 
                    class="aero-button-danger py-1 px-3 rounded transition duration-200" 
                    title="Delete Test">
                    ✕
                </button>
            </div>
        </div>
        
        ${test.status !== 'NOT_RUN' ? `
            <div class="mt-3 p-3 aero-glass-panel rounded text-sm">
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
                    <div>
                        <span class="aero-text-muted">Last Run:</span>
                        <div class="font-semibold aero-text-secondary">${lastRunTime}</div>
                    </div>
                    <div>
                        <span class="aero-text-muted">Assertions Passed:</span>
                        <div class="font-semibold aero-text-success">${test.assertions_passed || 0}</div>
                    </div>
                    <div>
                        <span class="aero-text-muted">Assertions Failed:</span>
                        <div class="font-semibold aero-text-danger">${test.assertions_failed || 0}</div>
                    </div>
                    <div>
                        <span class="aero-text-muted">Execution Time:</span>
                        <div class="font-semibold aero-text-secondary">${test.execution_time_ms || 0}ms</div>
                    </div>
                </div>
                ${test.last_run_error ? `
                    <div class="mt-2 p-2 bg-red-900 border border-red-700 rounded text-red-100 font-mono text-xs">
                        <div class="font-semibold mb-1">Error:</div>
                        <pre class="whitespace-pre-wrap">${escapeHtml(test.last_run_error)}</pre>
                    </div>
                ` : ''}
                <div class="mt-2">
                    <div class="flex gap-2">
                        <button onclick="toggleUnitTestOutput('${test.id}')" class="aero-button-info py-1 px-3 rounded text-xs">View Detailed Log</button>
                        <button onclick="downloadUnitTestLog('${test.id}')" class="aero-button-gray py-1 px-3 rounded text-xs">Download Log</button>
                    </div>
                    <div id="output-${test.id}" class="hidden mt-2 unit-test-log-viewer">
                        <pre>${formatLogForDisplay(test.last_run_output)}</pre>
                    </div>
                </div>
            </div>
        ` : ''}
    `;
    
    return card;
}

function formatLogForDisplay(logText) {
    if(!logText) return '<span class="text-gray-500 italic">No output recorded.</span>';
    
    return logText
        .replace(/\[INFO\]/g, '<span class="unit-test-log-info">[INFO]</span>')
        .replace(/\[ERROR\]/g, '<span class="unit-test-log-error">[ERROR]</span>')
        .replace(/\[PASS\]/g, '<span class="unit-test-log-success">[PASS]</span>')
        .replace(/\[FAIL\]/g, '<span class="unit-test-log-error">[FAIL]</span>')
        .replace(/\[WARN\]/g, '<span class="unit-test-log-warn">[WARN]</span>')
        .replace(/^\[(.*?)\]/gm, '<span class="unit-test-log-time">[$1]</span>');
}

function downloadUnitTestLog(testId) {
    const test = getUnitTest(testId);
    if (!test) return;

    const logContent = `UNIT TEST EXECUTION LOG
----------------------------------------
Test Name: ${test.name}
Status: ${test.status}
Date: ${test.last_run_time}
Duration: ${test.execution_time_ms}ms
Assertions Passed: ${test.assertions_passed}
Assertions Failed: ${test.assertions_failed}
----------------------------------------

EXECUTION OUTPUT:
${test.last_run_output || '(No output)'}

ERROR LOG:
${test.last_run_error || '(No errors)'}
`;

    const blob = new Blob([logContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `unit_test_${test.name.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
}

function getStatusBadge(status) {
    const badges = {
        'PASS': '<span class="aero-badge-success text-xs">✓ PASS</span>',
        'FAIL': '<span class="aero-badge-error text-xs">✗ FAIL</span>',
        'SKIPPED': '<span class="aero-badge-info text-xs">⊘ SKIPPED</span>',
        'NOT_RUN': '<span class="px-2 py-1 rounded text-xs" style="background: linear-gradient(180deg, #E0E0E0 0%, #BDBDBD 100%); color: #424242;">● NOT RUN</span>'
    };
    return badges[status] || badges['NOT_RUN'];
}

function toggleUnitTestOutput(testId) {
    const outputDiv = document.getElementById(`output-${testId}`);
    if (outputDiv) {
        outputDiv.classList.toggle('hidden');
    }
}

function updateUnitTestStatistics() {
    try {
        const statsContainer = document.getElementById('unit-test-statistics');
        if (!statsContainer) return;
        
        const total = unitTests.length;
        const passed = unitTests.filter(t => t.status === 'PASS').length;
        const failed = unitTests.filter(t => t.status === 'FAIL').length;
        const notRun = unitTests.filter(t => t.status === 'NOT_RUN').length;
        const skipped = unitTests.filter(t => t.status === 'SKIPPED').length;
        
        const passRate = total > 0 ? Math.round((passed / (total - notRun - skipped)) * 100) : 0;
        
        statsContainer.innerHTML = `
            <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div class="text-center">
                    <div class="text-2xl font-bold aero-text-primary">${total}</div>
                    <div class="text-sm aero-text-muted">Total Tests</div>
                </div>
                <div class="text-center">
                    <div class="text-2xl font-bold aero-text-success">${passed}</div>
                    <div class="text-sm aero-text-muted">Passed</div>
                </div>
                <div class="text-center">
                    <div class="text-2xl font-bold aero-text-danger">${failed}</div>
                    <div class="text-sm aero-text-muted">Failed</div>
                </div>
                <div class="text-center">
                    <div class="text-2xl font-bold" style="color: #424242;">${notRun}</div>
                    <div class="text-sm aero-text-muted">Not Run</div>
                </div>
                <div class="text-center">
                    <div class="text-2xl font-bold aero-text-primary">${isNaN(passRate) ? 0 : passRate}%</div>
                    <div class="text-sm aero-text-muted">Pass Rate</div>
                </div>
            </div>
        `;
        
    } catch (error) {
        console.error('Error updating statistics:', error);
    }
}

// ============================================
// FILTERING FUNCTIONS
// ============================================

function filterBySuite(suiteId) {
    currentUnitTestFilter.suiteId = suiteId;
    renderUnitTestsList();
    renderUnitTestSuitesList();
}

function filterUnitTests() {
    const searchEl = document.getElementById('unit-test-search');
    const statusEl = document.getElementById('unit-test-status-filter');
    const frameworkEl = document.getElementById('unit-test-framework-filter');

    if(searchEl) currentUnitTestFilter.searchText = searchEl.value.toLowerCase();
    if(statusEl) currentUnitTestFilter.statusFilter = statusEl.value;
    if(frameworkEl) currentUnitTestFilter.frameworkFilter = frameworkEl.value;
    renderUnitTestsList();
}

function getFilteredUnitTests() {
    let filtered = [...unitTests];
    
    // Filter by suite
    if (currentUnitTestFilter.suiteId === 'unlinked') {
        filtered = filtered.filter(test => !test.suite_id);
    } else if (currentUnitTestFilter.suiteId) {
        filtered = filtered.filter(test => test.suite_id === currentUnitTestFilter.suiteId);
    }
    
    // Filter by search text
    if (currentUnitTestFilter.searchText) {
        filtered = filtered.filter(test => 
            test.name.toLowerCase().includes(currentUnitTestFilter.searchText) ||
            (test.description && test.description.toLowerCase().includes(currentUnitTestFilter.searchText)) ||
            (test.tags && test.tags.some(tag => tag.toLowerCase().includes(currentUnitTestFilter.searchText)))
        );
    }
    
    // Filter by status
    if (currentUnitTestFilter.statusFilter) {
        filtered = filtered.filter(test => test.status === currentUnitTestFilter.statusFilter);
    }
    
    // Filter by framework
    if (currentUnitTestFilter.frameworkFilter) {
        filtered = filtered.filter(test => test.test_framework === currentUnitTestFilter.frameworkFilter);
    }
    
    return filtered;
}

// ============================================
// TEST EXECUTION ENGINE
// ============================================

async function runUnitTest(testId) {
    try {
        const test = getUnitTest(testId);
        if (!test) {
            showMessage('Unit test not found', 'error');
            return;
        }
        
        showMessage(`Running test: ${test.name}...`, 'info');
        
        const startTime = performance.now();
        let result;
        
        // Determine execution method based on framework
        if (test.test_framework === 'pytest' || test.test_framework === 'unittest') {
            result = await executePythonUnitTest(test);
        } else if (test.test_framework === 'jest' || test.test_framework === 'custom') {
            result = await executeJavaScriptUnitTest(test);
        } else {
            result = await executeJavaScriptUnitTest(test); // Default to JS
        }
        
        const endTime = performance.now();
        const executionTime = Math.round(endTime - startTime);
        
        // Update test with results
        const updates = {
            status: result.status,
            last_run_time: new Date().toISOString(),
            last_run_output: result.output || '',
            last_run_error: result.error || '',
            assertions_passed: result.assertions_passed || 0,
            assertions_failed: result.assertions_failed || 0,
            execution_time_ms: executionTime
        };
        
        updateUnitTest(testId, updates);
        
        // Re-render
        renderUnitTestsList();
        updateUnitTestStatistics();
        
        // Show result message
        if (result.status === 'PASS') {
            showMessage(`Test passed: ${test.name}`, 'success');
        } else {
            showMessage(`Test failed: ${test.name}`, 'error');
        }
        
    } catch (error) {
        console.error('Error running unit test:', error);
        showMessage('Failed to run unit test', 'error');
        
        // Update test with error
        updateUnitTest(testId, {
            status: 'FAIL',
            last_run_time: new Date().toISOString(),
            last_run_error: error.message || 'Unknown error',
            last_run_output: ''
        });
        
        renderUnitTestsList();
        updateUnitTestStatistics();
    }
}

// Helper to get formatted timestamp
function getTimestamp() {
    return new Date().toLocaleTimeString('en-US', { hour12: false });
}

// Helper to indent code
function indentCode(code, spaces = 4) {
    if (!code) return '';
    return code.split('\n').map(line => ' '.repeat(spaces) + line).join('\n');
}

async function executePythonUnitTest(unitTest) {
    try {
        // Initialize Pyodide if not already loaded
        // Assumes initializePyodide exists globally from script.js
        if (typeof window.initializePyodide !== 'function') {
             throw new Error("Python engine (Pyodide) not initialized.");
        }
        const pyodide = await window.initializePyodide();
        
        // Redirect stdout to capture logs
        await pyodide.runPythonAsync(`
import sys
from io import StringIO
sys.stdout = StringIO()
        `);

        // CRITICAL FIX: We MUST indent the user's code so it fits inside the try: block.
        // If we don't indent, Python thinks the try block ended and throws SyntaxError.
        
        const setupCodeIndented = indentCode(unitTest.setup_code);
        const testCodeIndented = indentCode(unitTest.test_code);
        const teardownCodeIndented = indentCode(unitTest.teardown_code);

        // Use string concatenation instead of nested f-strings for the title
        const fullCode = `
print("[INFO] Starting Python Unit Test: " + ${JSON.stringify(unitTest.name)})
try:
    # Setup
    print("[INFO] Running Setup...")
${setupCodeIndented}
    
    # Test Code
    print("[INFO] Running Test Code...")
${testCodeIndented}
    
    # Teardown
    print("[INFO] Running Teardown...")
${teardownCodeIndented}
    
    print("[PASS] Test Execution Completed Successfully")
except AssertionError as e:
    print(f"[FAIL] Assertion Failed: {str(e)}")
    raise e
except Exception as e:
    print(f"[ERROR] Execution Error: {str(e)}")
    raise e
`;
        
        // Execute the code
        let status = "PASS";
        let errorMsg = "";
        let assertionsFailed = 0;
        let assertionsPassed = (unitTest.test_code.match(/assert /g) || []).length;

        try {
            await pyodide.runPythonAsync(fullCode);
        } catch(e) {
            status = "FAIL";
            errorMsg = e.message;
            // If it failed, we assume at least one assertion failed if any exist, or 1 execution error
            assertionsFailed = 1; 
            assertionsPassed = Math.max(0, assertionsPassed - 1); 
        }

        // Retrieve stdout
        const output = await pyodide.runPythonAsync("sys.stdout.getvalue()");
        
        // Post-process output to add timestamps to lines that don't have them (simple approximation)
        const timestampedOutput = output.split('\n').map(line => {
            if(line.trim() === '') return line;
            return `[${getTimestamp()}] ${line}`;
        }).join('\n');

        return {
            status: status,
            output: timestampedOutput,
            error: errorMsg,
            assertions_passed: assertionsPassed,
            assertions_failed: assertionsFailed
        };
        
    } catch (error) {
        return {
            status: 'FAIL',
            error: error.message || 'Test execution critical failure',
            output: `[${getTimestamp()}] [CRITICAL] ${error.message}`,
            assertions_passed: 0,
            assertions_failed: 1
        };
    }
}

async function executeJavaScriptUnitTest(unitTest) {
    try {
        let passed = 0;
        let failed = 0;
        const outputs = [];
        
        const log = (level, msg) => {
            outputs.push(`[${getTimestamp()}] [${level}] ${msg}`);
        };

        log("INFO", `Starting JS Unit Test: ${unitTest.name}`);
        
        // Create a simple test framework
        const expect = (actual) => ({
            toBe: (expected) => {
                if (actual === expected) {
                    passed++;
                    log("PASS", `Assertion passed: ${actual} === ${expected}`);
                    return true;
                } else {
                    failed++;
                    log("FAIL", `Assertion failed: Expected ${expected}, got ${actual}`);
                    throw new Error(`Expected ${expected}, got ${actual}`);
                }
            },
            toEqual: (expected) => {
                if (JSON.stringify(actual) === JSON.stringify(expected)) {
                    passed++;
                    log("PASS", `Assertion passed: Objects equal`);
                    return true;
                } else {
                    failed++;
                    log("FAIL", `Assertion failed: Objects not equal`);
                    throw new Error(`Objects not equal`);
                }
            },
            toBeTruthy: () => {
                if (actual) {
                    passed++;
                    log("PASS", `Assertion passed: Value is truthy`);
                    return true;
                } else {
                    failed++;
                    log("FAIL", `Assertion failed: Value is not truthy`);
                    throw new Error(`Value is not truthy`);
                }
            },
            toBeFalsy: () => {
                if (!actual) {
                    passed++;
                    log("PASS", `Assertion passed: Value is falsy`);
                    return true;
                } else {
                    failed++;
                    log("FAIL", `Assertion failed: Value is not falsy`);
                    throw new Error(`Value is not falsy`);
                }
            },
            toContain: (expected) => {
                if (Array.isArray(actual) && actual.includes(expected)) {
                    passed++;
                    log("PASS", `Assertion passed: Array contains ${expected}`);
                    return true;
                } else {
                    failed++;
                    log("FAIL", `Assertion failed: Array does not contain ${expected}`);
                    throw new Error(`Array does not contain ${expected}`);
                }
            }
        });
        
        const assert = (condition, message = 'Assertion failed') => {
            if (condition) {
                passed++;
                log("PASS", `Assertion passed: ${message}`);
            } else {
                failed++;
                log("FAIL", `Assertion failed: ${message}`);
                throw new Error(message);
            }
        };
        
        // Create test context
        const testContext = {
            expect,
            assert,
            console: {
                log: (...args) => log("INFO", args.join(' ')),
                error: (...args) => log("ERROR", args.join(' ')),
                warn: (...args) => log("WARN", args.join(' '))
            }
        };
        
        // Execute setup
        if (unitTest.setup_code) {
            log("INFO", "Running Setup...");
            const setupFunc = new Function('testContext', `
                with(testContext) {
                    ${unitTest.setup_code}
                }
            `);
            setupFunc(testContext);
        }
        
        // Execute test
        log("INFO", "Running Test Code...");
        const testFunc = new Function('testContext', `
            with(testContext) {
                ${unitTest.test_code}
            }
        `);
        testFunc(testContext);
        
        // Execute teardown
        if (unitTest.teardown_code) {
            log("INFO", "Running Teardown...");
            const teardownFunc = new Function('testContext', `
                with(testContext) {
                    ${unitTest.teardown_code}
                }
            `);
            teardownFunc(testContext);
        }
        
        log("INFO", "Test Completed.");
        
        return {
            status: failed === 0 ? 'PASS' : 'FAIL',
            output: outputs.join('\n'),
            assertions_passed: passed,
            assertions_failed: failed
        };
        
    } catch (error) {
        return {
            status: 'FAIL',
            error: error.message || 'Test execution failed',
            output: `[${getTimestamp()}] [CRITICAL] ${error.stack || error.message}`,
            assertions_passed: 0,
            assertions_failed: 1
        };
    }
}

async function runAllVisibleUnitTests() {
    try {
        const filteredTests = getFilteredUnitTests();
        
        if (filteredTests.length === 0) {
            showMessage('No tests to run', 'error');
            return;
        }
        
        showMessage(`Running ${filteredTests.length} tests...`, 'info');
        
        let completed = 0;
        let passed = 0;
        let failed = 0;
        
        for (const test of filteredTests) {
            try {
                await runUnitTest(test.id);
                
                // Check result
                const updatedTest = getUnitTest(test.id);
                if (updatedTest.status === 'PASS') {
                    passed++;
                } else if (updatedTest.status === 'FAIL') {
                    failed++;
                }
                
                completed++;
                
                // Small delay to prevent UI freezing
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                console.error(`Error running test ${test.name}:`, error);
                failed++;
                completed++;
            }
        }
        
        // Show summary
        showMessage(`Tests completed: ${passed} passed, ${failed} failed`, 
            failed === 0 ? 'success' : 'error');
        
    } catch (error) {
        console.error('Error running all tests:', error);
        showMessage('Failed to run tests', 'error');
    }
}

async function runAllUnitTestsForSuite(suiteId) {
    try {
        const tests = getUnitTestsForSuite(suiteId);
        
        if (tests.length === 0) {
            showMessage('No unit tests linked to this suite', 'error');
            return;
        }
        
        showMessage(`Running ${tests.length} tests for suite...`, 'info');
        
        let passed = 0;
        let failed = 0;
        
        for (const test of tests) {
            await runUnitTest(test.id);
            
            const updatedTest = getUnitTest(test.id);
            if (updatedTest.status === 'PASS') passed++;
            if (updatedTest.status === 'FAIL') failed++;
            
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        showMessage(`Suite tests completed: ${passed} passed, ${failed} failed`, 
            failed === 0 ? 'success' : 'error');
        
        return { passed, failed, total: tests.length };
        
    } catch (error) {
        console.error('Error running suite tests:', error);
        showMessage('Failed to run suite tests', 'error');
        return null;
    }
}

// ============================================
// DELETE CONFIRMATION
// ============================================

function confirmDeleteUnitTest(testId) {
    const test = getUnitTest(testId);
    if (!test) {
        showMessage('Unit test not found', 'error');
        return;
    }
    
    if (confirm(`Are you sure you want to delete the unit test "${test.name}"?`)) {
        deleteUnitTest(testId);
        renderUnitTestsList();
        updateUnitTestStatistics();
        renderUnitTestSuitesList();
    }
}

// ============================================
// IMPORT/EXPORT FUNCTIONS
// ============================================

function exportUnitTests(testIds = null) {
    try {
        let testsToExport;
        
        if (testIds && testIds.length > 0) {
            testsToExport = unitTests.filter(test => testIds.includes(test.id));
        } else {
            // Export all visible/filtered tests
            testsToExport = getFilteredUnitTests();
        }
        
        if (testsToExport.length === 0) {
            showMessage('No unit tests to export', 'error');
            return;
        }
        
        const exportData = {
            version: '1.0',
            export_date: new Date().toISOString(),
            unit_tests: testsToExport
        };
        
        const jsonString = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `unit-tests-export-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showMessage(`Exported ${testsToExport.length} unit tests`, 'success');
        
    } catch (error) {
        console.error('Error exporting unit tests:', error);
        showMessage('Failed to export unit tests', 'error');
    }
}

function importUnitTestsFromFile() {
    try {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        
        input.onchange = async (e) => {
            try {
                const file = e.target.files[0];
                if (!file) return;
                
                const text = await file.text();
                const data = JSON.parse(text);
                
                importUnitTests(data);
                
            } catch (error) {
                console.error('Error reading import file:', error);
                showMessage('Failed to import unit tests - Invalid JSON file', 'error');
            }
        };
        
        input.click();
        
    } catch (error) {
        console.error('Error importing unit tests:', error);
        showMessage('Failed to import unit tests', 'error');
    }
}

function importUnitTests(data) {
    try {
        // Validate data structure
        if (!data || !data.unit_tests || !Array.isArray(data.unit_tests)) {
            showMessage('Invalid import data format', 'error');
            return;
        }
        
        let imported = 0;
        let skipped = 0;
        
        data.unit_tests.forEach(test => {
            // Generate new ID to avoid conflicts
            const newTest = {
                ...test,
                id: `unittest-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                dateCreated: new Date().toISOString(),
                dateModified: new Date().toISOString(),
                status: 'NOT_RUN', // Reset status
                last_run_time: null,
                last_run_output: '',
                last_run_error: '',
                assertions_passed: 0,
                assertions_failed: 0,
                execution_time_ms: 0
            };
            
            unitTests.push(newTest);
            imported++;
        });
        
        // Save to storage
        saveUnitTestsToStorage();
        
        // Re-render
        renderUnitTestsList();
        updateUnitTestStatistics();
        renderUnitTestSuitesList();
        
        showMessage(`Imported ${imported} unit tests`, 'success');
        
    } catch (error) {
        console.error('Error importing unit tests:', error);
        showMessage('Failed to import unit tests', 'error');
    }
}

// ============================================
// MONACO EDITOR INITIALIZATION
// ============================================

async function initializeUnitTestMonacoEditors() {
    // Only initialize once
    if (unitTestEditors.setup && unitTestEditors.test && unitTestEditors.teardown) {
        return;
    }
    
    try {
        // Use the existing Monaco loader from the app
        if (typeof loadMonacoEditor === 'function') {
            await loadMonacoEditor();
        }
        
        // Wait for Monaco to be available
        if (typeof monaco === 'undefined') {
            setTimeout(initializeUnitTestMonacoEditors, 500);
            return;
        }
        
        // Setup Code Editor
        const setupContainer = document.getElementById('unit-test-setup-editor');
        if (setupContainer && !unitTestEditors.setup) {
            unitTestEditors.setup = monaco.editor.create(setupContainer, {
                value: '',
                language: 'python',
                theme: 'aero-theme',
                minimap: { enabled: false },
                lineNumbers: 'on',
                automaticLayout: true,
                scrollBeyondLastLine: false,
                fontSize: 14
            });
        }
        
        // Test Code Editor
        const testContainer = document.getElementById('unit-test-code-editor');
        if (testContainer && !unitTestEditors.test) {
            unitTestEditors.test = monaco.editor.create(testContainer, {
                value: '',
                language: 'python',
                theme: 'aero-theme',
                minimap: { enabled: false },
                lineNumbers: 'on',
                automaticLayout: true,
                scrollBeyondLastLine: false,
                fontSize: 14
            });
        }
        
        // Teardown Code Editor
        const teardownContainer = document.getElementById('unit-test-teardown-editor');
        if (teardownContainer && !unitTestEditors.teardown) {
            unitTestEditors.teardown = monaco.editor.create(teardownContainer, {
                value: '',
                language: 'python',
                theme: 'aero-theme',
                minimap: { enabled: false },
                lineNumbers: 'on',
                automaticLayout: true,
                scrollBeyondLastLine: false,
                fontSize: 14
            });
        }
        
        // Update language when framework changes
        const frameworkSelect = document.getElementById('unit-test-framework');
        if (frameworkSelect && !frameworkSelect.dataset.listenerAdded) {
            frameworkSelect.dataset.listenerAdded = 'true';
            frameworkSelect.addEventListener('change', (e) => {
                const framework = e.target.value;
                let language = 'python';
                
                if (framework === 'jest' || framework === 'custom') {
                    language = 'javascript';
                } else if (framework === 'junit') {
                    language = 'java';
                } else if (framework === 'nunit') {
                    language = 'csharp';
                }
                
                if (unitTestEditors.setup) {
                    monaco.editor.setModelLanguage(unitTestEditors.setup.getModel(), language);
                }
                if (unitTestEditors.test) {
                    monaco.editor.setModelLanguage(unitTestEditors.test.getModel(), language);
                }
                if (unitTestEditors.teardown) {
                    monaco.editor.setModelLanguage(unitTestEditors.teardown.getModel(), language);
                }
            });
        }
        
        console.log('Unit test Monaco editors initialized successfully');
        
    } catch (error) {
        console.error('Error initializing Monaco editors for unit tests:', error);
    }
}

// ============================================
// INTEGRATION HELPERS
// ============================================

function linkUnitTestToSuite(testId, suiteId) {
    return updateUnitTest(testId, { suite_id: suiteId });
}

function calculateTestCoverage(suiteId) {
    const tests = getUnitTestsForSuite(suiteId);
    const total = tests.length;
    const passed = tests.filter(t => t.status === 'PASS').length;
    const failed = tests.filter(t => t.status === 'FAIL').length;
    const notRun = tests.filter(t => t.status === 'NOT_RUN').length;
    
    const coverage = total > 0 ? Math.round((passed / (total - notRun)) * 100) : 0;
    
    return {
        total,
        passed,
        failed,
        notRun,
        coverage: isNaN(coverage) ? 0 : coverage
    };
}

function generateTestReport(results) {
    const report = {
        timestamp: new Date().toISOString(),
        summary: {
            total: results.length,
            passed: results.filter(r => r.status === 'PASS').length,
            failed: results.filter(r => r.status === 'FAIL').length,
            skipped: results.filter(r => r.status === 'SKIPPED').length
        },
        results: results
    };
    
    return report;
}

// ============================================
// CLEANUP FUNCTIONS
// ============================================

function cleanupOrphanedUnitTests() {
    // Remove tests linked to deleted suites
    if(window.testSuites) {
        const suiteIds = window.testSuites.map(s => s.id);
        const orphaned = unitTests.filter(test => 
            test.suite_id && !suiteIds.includes(test.suite_id)
        );
        
        if (orphaned.length > 0) {
            console.log(`Found ${orphaned.length} orphaned unit tests`);
            // Optionally: Either delete them or unlink them
            orphaned.forEach(test => {
                updateUnitTest(test.id, { suite_id: null });
            });
        }
    }
}

// ============================================
// INITIALIZATION ON LOAD
// ============================================

// Initialize when document is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeUnitTestingSystem);
} else {
    initializeUnitTestingSystem();
}

// EXPORT FUNCTIONS TO WINDOW (Crucial to prevent ReferenceErrors in HTML)
window.initializeUnitTestingSystem = initializeUnitTestingSystem;
window.openUnitTestingModal = openUnitTestingModal;
window.closeUnitTestingModal = closeUnitTestingModal;
window.createNewUnitTest = createNewUnitTest;
window.importUnitTestsFromFile = importUnitTestsFromFile;
window.exportUnitTests = exportUnitTests;
window.runAllVisibleUnitTests = runAllVisibleUnitTests;
window.filterUnitTests = filterUnitTests;
window.openUnitTestEditor = openUnitTestEditor;
window.closeUnitTestEditor = closeUnitTestEditor;
window.saveUnitTestFromForm = saveUnitTestFromForm;
window.runUnitTest = runUnitTest;
window.confirmDeleteUnitTest = confirmDeleteUnitTest;
window.toggleUnitTestOutput = toggleUnitTestOutput;
window.downloadUnitTestLog = downloadUnitTestLog;
