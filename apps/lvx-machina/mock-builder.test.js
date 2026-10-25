function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message} Expected ${expected}, got ${actual}`);
    }
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function createMockElement() {
    return {
        innerHTML: '',
        textContent: '',
        style: {},
        children: [],
        dataset: {},
        classList: {
            add() { },
            remove() { }
        },
        appendChild(child) {
            this.children.push(child);
            return child;
        },
        querySelector() {
            return createMockElement();
        },
        querySelectorAll() {
            return [];
        }
    };
}

function setupDom() {
    const elements = {
        'mock-builder-modal': createMockElement(),
        'mock-builder-tab-bar': createMockElement(),
        'mock-builder-content': createMockElement(),
        'mock-builder-status': createMockElement()
    };

    global.document = {
        getElementById(id) {
            return elements[id] || createMockElement();
        }
    };
    global.window = global;
    global.showMessage = () => { };
}

function test(name, fn) {
    try {
        fn();
        console.log(`PASS ${name}`);
    } catch (error) {
        console.error(`FAIL ${name}: ${error.message}`);
        process.exit(1);
    }
}

setupDom();
delete require.cache[require.resolve('./mock-builder.js')];
require('./mock-builder.js');

test('MockBuilder should provide a default state shape', () => {
    const builder = new global.MockBuilder();
    const state = builder.getDefaultState();

    assert(Array.isArray(state.mocks), 'Mocks should be an array');
    assert(Array.isArray(state.setupSteps), 'Setup steps should be an array');
    assert(Array.isArray(state.teardownSteps), 'Teardown steps should be an array');
    assertEqual(state.fileData.usageMode, 'per-row', 'Default usage mode should be per-row');
});

test('MockBuilder save should emit normalized state through onSave', () => {
    const builder = new global.MockBuilder();
    let savedState = null;

    builder.open({
        state: {
            mocks: [{ name: 'Login Response', type: 'api-response' }]
        },
        onSave: (state) => {
            savedState = state;
        }
    });
    builder.save();

    assert(savedState !== null, 'onSave should be called');
    assertEqual(savedState.mocks.length, 1, 'One mock should be saved');
    assert(typeof savedState.mocks[0].template === 'string' && savedState.mocks[0].template.length > 0, 'Saved mock should be normalized with a template');
});

test('MockBuilder should expose built-in preview variables', () => {
    const builder = new global.MockBuilder();
    const variables = builder.getAvailableVariables();

    assert(Array.isArray(variables) && variables.length >= 6, 'Built-in variables should exist');
    assert(variables.some(variable => variable.token === 'random_id'), 'random_id should be available');
    assert(variables.some(variable => variable.token === 'random_number:1-100'), 'random_number range should be available');
});

test('MockBuilder should render a deterministic live preview for built-in variables', () => {
    const builder = new global.MockBuilder();
    const preview = builder.buildMockPreview('{"id":"{{random_id}}","email":"{{random_email}}","token":"{{random_token}}"}');

    assert(preview.includes('"1042"'), 'random_id should resolve in preview');
    assert(preview.includes('alex.carter@example.test'), 'random_email should resolve in preview');
    assert(preview.includes('tok_demo_9f3d2a7b1c'), 'random_token should resolve in preview');
});

test('MockBuilder should append variables into a selected mock template', () => {
    const builder = new global.MockBuilder();
    builder.state = builder.normalizeState({
        mocks: [
            {
                name: 'User Input',
                type: 'user-input',
                template: '{"username":"{{random_name}}"}'
            }
        ]
    });

    builder.insertVariableIntoMock(0, 'uuid');

    assert(builder.state.mocks[0].template.includes('{{uuid}}'), 'Selected variable should be inserted into the template');
});

test('MockBuilder should create sensible default setup and teardown steps', () => {
    const builder = new global.MockBuilder();
    const setupStep = builder.createDefaultStep('setup');
    const teardownStep = builder.createDefaultStep('teardown');

    assertEqual(setupStep.action, 'create-test-data', 'Setup should default to creating test data');
    assertEqual(teardownStep.action, 'clear-test-data', 'Teardown should default to clearing test data');
    assertEqual(setupStep.language, 'python', 'Run-code defaults should still use python');
    assertEqual(teardownStep.resetAll, true, 'Teardown reset defaults should be enabled');
});

test('MockBuilder should preserve richer setup fields during normalization', () => {
    const builder = new global.MockBuilder();
    const normalized = builder.normalizeState({
        setupSteps: [
            {
                action: 'create-test-data',
                mockId: 'mock_login',
                variableName: 'test_user',
                notes: 'Used before login tests'
            }
        ]
    });

    assertEqual(normalized.setupSteps.length, 1, 'One setup step should be preserved');
    assertEqual(normalized.setupSteps[0].mockId, 'mock_login', 'Mock selection should be preserved');
    assertEqual(normalized.setupSteps[0].variableName, 'test_user', 'Variable name should be preserved');
    assertEqual(normalized.setupSteps[0].target, 'test_user', 'Legacy target should stay in sync');
});

test('MockBuilder should render setup cards with mock and variable fields', () => {
    const builder = new global.MockBuilder();

    builder.open({
        activeTab: 'steps',
        state: {
            mocks: [
                {
                    id: 'mock_login',
                    name: 'user_login_response',
                    type: 'api-response'
                }
            ],
            setupSteps: [
                {
                    action: 'create-test-data',
                    mockId: 'mock_login',
                    variableName: 'test_user'
                }
            ]
        }
    });

    assert(builder.content.innerHTML.includes('Use mock'), 'Setup card should show the mock selector');
    assert(builder.content.innerHTML.includes('Save as variable'), 'Setup card should show the variable field');
    assert(builder.content.innerHTML.includes('user_login_response'), 'Available mocks should appear in the selector');
});

test('MockBuilder should render teardown reset-environment guidance', () => {
    const builder = new global.MockBuilder();

    builder.open({
        activeTab: 'steps',
        state: {
            teardownSteps: [
                {
                    action: 'reset-environment',
                    resetAll: true
                }
            ]
        }
    });

    assert(builder.content.innerHTML.includes('Reset all variables set in setup'), 'Teardown reset card should explain the reset-all option');
});

test('MockBuilder should normalize file data with default column mappings', () => {
    const builder = new global.MockBuilder();
    const normalized = builder.normalizeState({
        fileData: {
            fileName: 'users_test_data.csv',
            fileType: 'csv',
            headers: ['username', 'email'],
            rows: [
                { username: 'alice', email: 'a@b.com' }
            ]
        }
    });

    assertEqual(normalized.fileData.columnMappings.username, 'test_username', 'Username column should get a default variable mapping');
    assertEqual(normalized.fileData.columnMappings.email, 'test_email', 'Email column should get a default variable mapping');
});

test('MockBuilder should render file preview and mapping fields', () => {
    const builder = new global.MockBuilder();

    builder.open({
        activeTab: 'files',
        state: {
            fileData: {
                fileName: 'users_test_data.csv',
                fileType: 'csv',
                usageMode: 'per-row',
                headers: ['username', 'email', 'role'],
                rows: [
                    { username: 'alice', email: 'a@b.com', role: 'admin' },
                    { username: 'bob', email: 'b@b.com', role: 'user' }
                ],
                columnMappings: {
                    username: 'test_username',
                    email: 'test_email',
                    role: 'test_role'
                }
            }
        }
    });

    assert(builder.content.innerHTML.includes('Preview (first 5 rows)'), 'File tab should show the preview section');
    assert(builder.content.innerHTML.includes('users_test_data.csv'), 'Loaded file name should be shown');
    assert(builder.content.innerHTML.includes('Column Mapping'), 'Column mapping section should be rendered');
    assert(builder.content.innerHTML.includes('test_username'), 'Mapped variable names should be visible');
    assert(builder.content.innerHTML.includes('{{test_role}}'), 'Mapped variables should be listed for test usage');
});
