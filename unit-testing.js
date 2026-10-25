
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
}

let unitCredentialWrites=Promise.resolve(),unitSaveRevision=0;
function saveUnitTestsToStorage() {
    try {
        if(window.LVXCredentials){
            const snapshot=JSON.parse(JSON.stringify(unitTests)),revision=++unitSaveRevision;
            const pending=unitCredentialWrites.then(async()=>{
                for(const item of snapshot)for(const [name,rule]of Object.entries(item.parameter_schema||{}))if(rule.secret&&item.parameters?.[name]!=null){const value=item.parameters[name];if(typeof value==='string'){const protectedValue=await window.LVXCredentials.protect({secret:true,value},'Unit parameter '+name);item.parameters[name]={secretRef:protectedValue.value};}}
                const safe=await window.LVXCredentials.protect(snapshot,'Unit test credentials');localStorage.setItem('lvx_unit_tests',JSON.stringify(safe));if(revision===unitSaveRevision)unitTests=safe;return true;
            });
            unitCredentialWrites=pending.catch(()=>{});
            return pending.catch(error=>{if(revision===unitSaveRevision)loadUnitTests();console.error('Secure unit-test save failed:',error);showMessage('Unit tests were not saved: '+error.message,'error');return false;});
        }
        localStorage.setItem('lvx_unit_tests', JSON.stringify(unitTests));
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

        // Add to array
        unitTests.push(unitTest);

        // Save to storage
        const saved=saveUnitTestsToStorage();
        const finish=ok=>{if(!ok)return null;showMessage('Unit test created successfully','success');return getUnitTest(unitTest.id);};
        return saved?.then?saved.then(finish):finish(saved);
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
        const saved=saveUnitTestsToStorage();
        const finish=ok=>{if(!ok)return false;showMessage('Unit test updated successfully','success');return true;};
        return saved?.then?saved.then(finish):finish(saved);
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
        const saved=saveUnitTestsToStorage();
        const finish=ok=>{if(!ok)return false;showMessage('Unit test deleted successfully','success');return true;};
        return saved?.then?saved.then(finish):finish(saved);
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

async function saveUnitTestFromForm() {
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
            const success = await updateUnitTest(testId, unitTest);
            if (success) {
                closeUnitTestEditor();
                renderUnitTestsList();
                updateUnitTestStatistics();
            }
        } else {
            const saved = await saveUnitTest(unitTest);
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
                    ${window.LVXIcons?.svg("play") || ''} Run
                </button>
                <button onclick="openUnitTestEditor('${test.id}')"
                    class="aero-button-primary py-1 px-3 rounded transition duration-200"
                    title="Edit Test">
                    ${window.LVXIcons?.svg("edit") || ''} Edit
                </button>
                <button onclick="confirmDeleteUnitTest('${test.id}')"
                    class="aero-button-danger py-1 px-3 rounded transition duration-200"
                    title="Delete Test">
                    ${window.LVXIcons?.svg("trash") || "Delete"}
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
        'PASS': `<span class="aero-badge-success text-xs">${window.LVXIcons?.svg("check") || ''} PASS</span>`,
        'FAIL': `<span class="aero-badge-error text-xs">${window.LVXIcons?.svg("close") || ''} FAIL</span>`,
        'SKIPPED': `<span class="aero-badge-info text-xs">${window.LVXIcons?.svg('fast')||''} SKIPPED</span>`,
        'NOT_RUN': `<span class="px-2 py-1 rounded text-xs" style="background: linear-gradient(180deg, #E0E0E0 0%, #BDBDBD 100%); color: #424242;">${window.LVXIcons?.svg("circle")||''} NOT RUN</span>`
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
                    <div class="text-2xl font-bold aero-text-muted">${notRun}</div>
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
            result = { status: 'FAIL', error: `Unsupported unit-test framework: ${test.test_framework}`, assertions_failed: 1 };
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

        await updateUnitTest(testId, updates);

        // Re-render
        renderUnitTestsList();
        updateUnitTestStatistics();

        // Show result message
        if (result.status === 'PASS') {
            showMessage(`Test passed: ${test.name}`, 'success');
        } else if(result.status==='CANCELLED') {
            showMessage(`Test cancelled: ${test.name}`,'warning');
        } else {
            showMessage(`Test failed: ${test.name}`, 'error');
        }

    } catch (error) {
        console.error('Error running unit test:', error);
        showMessage('Failed to run unit test', 'error');

        // Update test with error
        await updateUnitTest(testId, {
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

// Pyodide owns one interpreter; serialize runs to keep modules and captured output isolated.
let pythonUnitTestQueue = Promise.resolve();
function unitExecutionParameters(unitTest){
    const parameters=JSON.parse(JSON.stringify(unitTest.parameters||{})),parameterSchema=JSON.parse(JSON.stringify(unitTest.parameter_schema||{}));
    for(const [key,value]of Object.entries(parameters)){
        if(window.LVXCredentials?.isReference(value)){parameters[key]={secretRef:value};parameterSchema[key]={...(parameterSchema[key]||{}),secret:true};}
        else if(value&&typeof value==='object'&&window.LVXCredentials?.isReference(value.secretRef)){parameterSchema[key]={...(parameterSchema[key]||{}),secret:true};}
    }
    return {parameters,parameterSchema};
}

async function executeNativePythonUnitTest(unitTest) {
    const studio=window.electronAPI.studioOps,marker='LVX_UNIT_RESULT_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)+':';
    const code=buildPythonUnitTestCode(unitTest)+'\nprint('+JSON.stringify(marker)+' + json.dumps(_lvx_result))\nARTIFACTS={"unitResult": _lvx_result}\nif _lvx_result["status"] != "PASS":\n    _lvx_failure = _lvx_result.get("error") or _lvx_result.get("cleanup_error") or "Native unit tests failed"\n    if _lvx_result.get("errors") and not _lvx_result.get("assertions_failed"): raise RuntimeError(_lvx_failure)\n    raise AssertionError(_lvx_failure)\n';
    try {
        await studio.invoke('host','checkImported',{definition:unitTest});
        const start=await studio.invoke('execution','start',{engine:'python',code,timeoutMs:Number(unitTest.timeout_ms||30000),...unitExecutionParameters(unitTest),inputs:unitTest.inputs||unitTest.contextVariables||{},inputFiles:unitTest.input_files||unitTest.inputFiles||[]});
        window.LVXActiveUnitRun=start.id;let run=start;
        while(run.status==='RUNNING'||run.status==='PENDING'){await new Promise(resolve=>setTimeout(resolve,40));run=await studio.invoke('execution','getRun',{id:start.id});}
        if(run.status==='CANCELLED')return {status:'CANCELLED',run_id:run.id,error:'Run cancelled.',output:run.stdout||'',assertions_passed:0,assertions_failed:0};
        const line=(run.stdout||'').split(/\r?\n/).filter(line=>line.startsWith(marker)).pop();
        if(!line)throw new Error(run.error||run.stderr||'Native Python did not return its unit-test report.');
        const report=JSON.parse(line.slice(marker.length));
        if(run.status!=='SUCCESS'&&report.status==='PASS'){report.status='FAIL';report.error=run.error||run.stderr||run.status;report.errors=(report.errors||0)+1;}
        return {...report,run_id:run.id,native_status:run.status};
    }catch(error){return {status:'FAIL',error:error.message,output:'Native Python unit test unavailable: '+error.message,native_status:'ERROR',totalTests:0,errors:1,assertions_passed:0,assertions_failed:0};}
    finally{window.LVXActiveUnitRun=null;}
}

async function executePythonUnitTest(unitTest) {
    if(window.electronAPI?.studioOps)return executeNativePythonUnitTest(unitTest);
    if(!window.LVXPreviewPythonNotice&&typeof window.showMessage==='function'){window.LVXPreviewPythonNotice=true;window.showMessage('Browser preview cannot interrupt a blocking Python test. Use the desktop app for cancellable runs.','warning');}
    const execute = () => executePythonUnitTestIsolated(unitTest);
    const run = pythonUnitTestQueue.then(() => window.withPythonRuntime ? window.withPythonRuntime(execute) : execute());
    pythonUnitTestQueue = run.catch(() => {});
    return run;
}
function buildPythonUnitTestCode(unitTest) {
        const config = JSON.stringify({ setup: unitTest.setup_code || '', test: unitTest.test_code || '', teardown: unitTest.teardown_code || '', framework: unitTest.test_framework });
        const fullCode = `
import contextlib, io, json, types, unittest, tempfile, os
_lvx_config = json.loads(${JSON.stringify(config)})
_lvx_stream = io.StringIO()
_lvx_module = types.ModuleType('_lvx_unit_test')
_lvx_module.__dict__['__name__'] = '_lvx_unit_test'
_lvx_module.__dict__['unittest'] = unittest
_lvx_module.__dict__['parameters'] = globals().get('parameters', {})
_lvx_module.__dict__['inputs'] = globals().get('inputs', {})
_lvx_result = {'status': 'PASS', 'totalTests': 0, 'assertions_passed': 0, 'assertions_failed': 0, 'errors': 0, 'skipped': 0, 'error': '', 'cleanup_error': ''}
with contextlib.redirect_stdout(_lvx_stream), contextlib.redirect_stderr(_lvx_stream):
    try:
        exec(_lvx_config['setup'], _lvx_module.__dict__)
        if _lvx_config['framework'] == 'unittest':
            exec(_lvx_config['test'], _lvx_module.__dict__)
            _lvx_suite = unittest.defaultTestLoader.loadTestsFromModule(_lvx_module)
            _lvx_result['totalTests'] = _lvx_suite.countTestCases()
            if not _lvx_suite.countTestCases():
                raise RuntimeError('No unittest tests discovered')
            _lvx_run = unittest.TextTestRunner(stream=_lvx_stream, verbosity=2).run(_lvx_suite)
            _lvx_result['assertions_failed'] = len(_lvx_run.failures) + len(_lvx_run.unexpectedSuccesses)
            _lvx_result['errors'] = len(_lvx_run.errors)
            _lvx_result['skipped'] = len(_lvx_run.skipped)
            _lvx_result['assertions_passed'] = _lvx_run.testsRun - _lvx_result['assertions_failed'] - _lvx_result['errors'] - _lvx_result['skipped']
            if not _lvx_run.wasSuccessful() or _lvx_result['assertions_passed'] == 0:
                raise AssertionError('unittest failed or executed no passing tests')
        elif _lvx_config['framework'] == 'pytest':
            import pytest
            class _LVXPlugin:
                passed = 0
                failed = 0
                errors = 0
                total = 0
                skipped = 0
                def pytest_collection_finish(self, session): self.total = len(session.items)
                def pytest_collectreport(self, report):
                    if report.failed: self.errors += 1
                def pytest_runtest_logreport(self, report):
                    if report.failed:
                        if report.when == 'call': self.failed += 1
                        else: self.errors += 1
                    elif report.skipped: self.skipped += 1
                    elif report.when == 'call' and report.passed: self.passed += 1
            _lvx_plugin = _LVXPlugin()
            with tempfile.TemporaryDirectory(prefix='lvx_unit_') as _lvx_dir:
                _lvx_path = os.path.join(_lvx_dir, 'test_lvx.py')
                with open(_lvx_path, 'w', encoding='utf-8') as _lvx_file:
                    _lvx_file.write(_lvx_config['test'])
                _lvx_module.__dict__['__file__'] = _lvx_path
                # Inject the shared setup namespace while retaining normal pytest discovery.
                class _LVXSetupPlugin:
                    def pytest_collection_modifyitems(self, items):
                        for item in items:
                            item.module.__dict__.update({k:v for k,v in _lvx_module.__dict__.items() if not k.startswith('__')})
                _lvx_exit = pytest.main(['-q', '-p', 'no:cacheprovider', '--import-mode=importlib', '--confcutdir', _lvx_dir, _lvx_path], plugins=[_lvx_plugin, _LVXSetupPlugin()])
                _lvx_result['assertions_passed'] = _lvx_plugin.passed
                _lvx_result['assertions_failed'] = _lvx_plugin.failed
                _lvx_result['errors'] = _lvx_plugin.errors
                _lvx_result['skipped'] = _lvx_plugin.skipped
                _lvx_result['totalTests'] = _lvx_plugin.total
                if int(_lvx_exit) != 0 or _lvx_plugin.passed == 0:
                    raise AssertionError('pytest failed or executed no tests (exit ' + str(_lvx_exit) + ')')
        else:
            raise RuntimeError('Unsupported Python unit-test framework')
    except BaseException as _lvx_error:
        _lvx_result['status'] = 'FAIL'
        _lvx_result['error'] = str(_lvx_error)
        if not _lvx_result['assertions_failed'] and not _lvx_result['errors']:
            _lvx_result['errors'] += 1
    finally:
        try:
            exec(_lvx_config['teardown'], _lvx_module.__dict__)
        except BaseException as _lvx_cleanup:
            _lvx_result['cleanup_error'] = str(_lvx_cleanup)
            _lvx_result['status'] = 'FAIL'
            _lvx_result['errors'] += 1
_lvx_result['output'] = _lvx_stream.getvalue()
json.dumps(_lvx_result)
`;
    return fullCode;
}
async function executePythonUnitTestIsolated(unitTest) {
    try {
        if (typeof window.initializePyodide !== 'function') throw new Error('Python engine unavailable');
        const pyodide = await window.initializePyodide();
        if (unitTest.test_framework === 'pytest') {
            if (typeof pyodide.loadPackage !== 'function') throw new Error('pytest package loader unavailable');
            await pyodide.loadPackage('pytest');
        }
        const fullCode = buildPythonUnitTestCode(unitTest);
        return JSON.parse(await pyodide.runPythonAsync(fullCode));
    } catch (error) {
        return { status: 'FAIL', error: error.message, output: `Python test unavailable: ${error.message}`, assertions_passed: 0, assertions_failed: 1 };
    }
}

async function executeJavaScriptUnitTest(unitTest) {
    const studio = typeof window !== 'undefined' && window.electronAPI?.studioOps;
    if (studio) {
        try {
            await studio.invoke('host','checkImported',{definition:unitTest});
            const started = await studio.invoke('execution', 'start', {
                engine: unitTest.test_framework === 'jest' ? 'jest' : 'javascript',
                code: unitTest.test_code || '', setup: unitTest.setup_code || '', cleanup: unitTest.teardown_code || '',
                timeoutMs: Number(unitTest.timeout_ms || 30000),
                ...(unitTest.project_path ? { projectPath:unitTest.project_path } : {}),
                ...unitExecutionParameters(unitTest),
                ...(unitTest.fixture_id ? { fixtureId:unitTest.fixture_id } : {})
            });
            window.LVXActiveUnitRun = started.id;
            let run = started;
            while (run.status === 'RUNNING' || run.status === 'PENDING') { await new Promise(resolve => setTimeout(resolve, 50)); run = await studio.invoke('execution', 'getRun', { id: started.id }); }
            return { status: run.status === 'SUCCESS' ? 'PASS' : run.status==='CANCELLED'?'CANCELLED':'FAIL', run_id: run.id, output: [run.stdout, run.stderr].filter(Boolean).join('\n'), error: run.error || (run.status === 'SUCCESS' ? '' : run.status), assertions_passed: run.passed || 0, assertions_failed: (run.failed || 0) + (run.errors || 0) };
        } catch (error) { return { status: 'FAIL', error: error.message, output: error.message, assertions_passed: 0, assertions_failed: 1 }; }
        finally { window.LVXActiveUnitRun = null; }
    }
    // Browser preview uses an isolated Worker as the interruption boundary.
    // The branch below is also retained for small VM regression harnesses that
    // have no browser Worker implementation.
    if (!globalThis.LVXUnitWorker && typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL?.createObjectURL === 'function') {
        if (unitTest.test_framework === 'jest') return { status: 'FAIL', error: 'Jest needs the desktop project runner.', assertions_passed: 0, assertions_failed: 1 };
        const source = `self.LVXUnitWorker=true; const getTimestamp=()=>new Date().toISOString(); const execute=${executeJavaScriptUnitTest.toString()}; self.onmessage=async e=>self.postMessage(await execute(e.data));`;
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        const worker = new Worker(url);
        // Workers cannot create nested workers here; authored code runs only once.
        const timeout = Number(unitTest.timeout_ms || 30000);
        try { return await new Promise(resolve => { const timer = setTimeout(() => { worker.terminate(); resolve({ status:'FAIL',error:'Unit test timed out; worker stopped.',assertions_passed:0,assertions_failed:1 }); }, timeout); worker.onmessage=e=>{clearTimeout(timer);resolve(e.data);};worker.onerror=e=>{clearTimeout(timer);resolve({status:'FAIL',error:e.message,assertions_passed:0,assertions_failed:1});};worker.postMessage(unitTest); }); }
        finally { worker.terminate(); URL.revokeObjectURL(url); }
    }
    if (unitTest.test_framework === 'jest') return { status: 'FAIL', error: 'Jest runtime unavailable in this browser. Choose Custom for assert/expect script tests.', assertions_passed: 0, assertions_failed: 1 };
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

        const controller = new AbortController();
        testContext.signal = controller.signal;
        let primaryError = null;
        let cleanupError = null;
        testContext.recordError = error => { primaryError = error; };
        testContext.recordCleanupError = error => { cleanupError = error; };
        testContext.fixture = {};
        let testStarted = false;
        let teardownStarted = false;
        testContext.markTestStarted = () => { testStarted = true; };
        testContext.markTeardownStarted = () => { teardownStarted = true; };
        // Setup declarations share lexical scope with test and teardown. Each phase awaits
        // returned promises. Cancellation is cooperative through signal; synchronous user
        // loops cannot be preempted in the browser's main thread.
        const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
        const execute = new AsyncFunction('testContext', `
            with (testContext) {
                let cleanup = async () => {};
                try {
                    // Define the cleanup closure before setup so it retains initialized
                    // setup bindings even when a later setup statement throws.
                    cleanup = async () => { ${unitTest.teardown_code || ''} };
                    ${unitTest.setup_code || ''}
                    markTestStarted();
                    await (async () => { ${unitTest.test_code || ''} })();
                } catch (error) { recordError(error); }
                finally {
                    markTeardownStarted();
                    try { await cleanup(); }
                    catch (error) { recordCleanupError(error); }
                }
            }
        `);
        const configuredTimeout = Number(unitTest.timeout_ms ?? 30000);
        if (!Number.isFinite(configuredTimeout) || configuredTimeout <= 0) throw new Error('Test timeout must be positive');
        let timer;
        try {
            await Promise.race([execute(testContext).then(async () => {
                if (!testStarted && !primaryError) primaryError = new Error('Setup returned before the test could run. Use await in setup, or share state through fixture.');
                if (!teardownStarted) {
                    teardownStarted = true;
                    try { await new AsyncFunction('testContext', `with (testContext) { ${unitTest.teardown_code || ''} }`)(testContext); }
                    catch (error) { cleanupError = error; }
                }
            }), new Promise((_, reject) => {
                timer = setTimeout(() => { controller.abort(); reject(new Error(`Unit test timed out after ${configuredTimeout}ms; cancellation requested`)); }, configuredTimeout);
            })]);
        } catch (error) { primaryError = primaryError || error; }
        finally { clearTimeout(timer); }
        if (primaryError) log('ERROR', primaryError.message);
        if (cleanupError) log('ERROR', `Teardown failed: ${cleanupError.message}`);
        if ((primaryError || cleanupError) && failed === 0) failed = 1;

        log("INFO", "Test Completed.");

        return {
            status: failed === 0 ? 'PASS' : 'FAIL',
            output: outputs.join('\n'),
            error: primaryError?.message || cleanupError?.message || '',
            cleanup_error: cleanupError?.message || '',
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
        let cancelled = 0;

        for (const test of filteredTests) {
            try {
                await runUnitTest(test.id);

                // Check result
                const updatedTest = getUnitTest(test.id);
                if (updatedTest.status === 'PASS') {
                    passed++;
                } else if (updatedTest.status === 'FAIL') {
                    failed++;
                } else if(updatedTest.status==='CANCELLED') {
                    cancelled++;
                }

                completed++;
                if(cancelled)break;

                // Small delay to prevent UI freezing
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                console.error(`Error running test ${test.name}:`, error);
                failed++;
                completed++;
            }
        }

        // Show summary
        showMessage(`Tests ${cancelled?'cancelled':'completed'}: ${passed} passed, ${failed} failed${cancelled?`, ${cancelled} cancelled`:''}`,
            cancelled?'warning':failed===0?'success':'error');

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
        let cancelled = 0;

        for (const test of tests) {
            await runUnitTest(test.id);

            const updatedTest = getUnitTest(test.id);
            if (updatedTest.status === 'PASS') passed++;
            if (updatedTest.status === 'FAIL') failed++;
            if(updatedTest.status==='CANCELLED'){cancelled++;break;}

            await new Promise(resolve => setTimeout(resolve, 100));
        }

        showMessage(`Suite tests ${cancelled?'cancelled':'completed'}: ${passed} passed, ${failed} failed${cancelled?`, ${cancelled} cancelled`:''}`,
            cancelled?'warning':failed===0?'success':'error');

        return { passed, failed, cancelled, status:cancelled?'CANCELLED':failed?'FAILURE':'SUCCESS', total: tests.length };

    } catch (error) {
        console.error('Error running suite tests:', error);
        showMessage('Failed to run suite tests', 'error');
        return null;
    }
}

// ============================================
// DELETE CONFIRMATION
// ============================================

async function confirmDeleteUnitTest(testId) {
    const test = getUnitTest(testId);
    if (!test) {
        showMessage('Unit test not found', 'error');
        return;
    }

    if (confirm(`Are you sure you want to delete the unit test "${test.name}"?`)) {
        await deleteUnitTest(testId);
        renderUnitTestsList();
        updateUnitTestStatistics();
        renderUnitTestSuitesList();
    }
}

// ============================================
// IMPORT/EXPORT FUNCTIONS
// ============================================

async function exportUnitTests(testIds = null) {
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

        const safeExport=window.LVXCredentials?await window.LVXCredentials.protect(exportData,'Unit-test export'):exportData;
        const jsonString = JSON.stringify(safeExport, null, 2);
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

                await importUnitTests(data);

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

async function importUnitTests(data) {
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
        if(!await saveUnitTestsToStorage())return;

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
            skipped: results.filter(r => r.status === 'SKIPPED').length,
            cancelled: results.filter(r => r.status === 'CANCELLED').length
        },
        results: results
    };

    return report;
}

// ============================================
// CLEANUP FUNCTIONS
// ============================================

async function cleanupOrphanedUnitTests() {
    // Remove tests linked to deleted suites
    if(window.testSuites) {
        const suiteIds = window.testSuites.map(s => s.id);
        const orphaned = unitTests.filter(test =>
            test.suite_id && !suiteIds.includes(test.suite_id)
        );

        if (orphaned.length > 0) {
            console.log(`Found ${orphaned.length} orphaned unit tests`);
            // Optionally: Either delete them or unlink them
            for(const test of orphaned) await updateUnitTest(test.id,{suite_id:null});
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

window.addEventListener?.("lvx-credentials-migrated",()=>{loadUnitTests();if(typeof renderUnitTestsList==="function")renderUnitTestsList();});
