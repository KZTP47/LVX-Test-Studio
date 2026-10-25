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

function test(name, fn) {
    try {
        fn();
        console.log(`PASS ${name}`);
    } catch (error) {
        console.error(`FAIL ${name}: ${error.message}`);
        process.exit(1);
    }
}

delete require.cache[require.resolve('./mock-runtime.js')];
const runtime = require('./mock-runtime.js');

test('resolveTemplateVariables should replace built-ins and context variables', () => {
    const variableCache = {};
    const resolved = runtime.resolveTemplateVariables(
        'User={{test_username}} ID={{random_id}} Again={{random_id}} UUID={{uuid}} Num={{random_number:2-4}}',
        { test_username: 'alice' },
        {
            randomFn: () => 0,
            uuidFactory: () => 'uuid-demo',
            variableCache
        }
    );

    assertEqual(
        resolved,
        'User=alice ID=100000 Again=100000 UUID=uuid-demo Num=2',
        'Template variables should resolve deterministically'
    );
});

test('buildSuiteExecutionPlan should turn setup steps into base context variables', () => {
    const suite = {
        mock_builder: {
            mocks: [
                {
                    id: 'login-response',
                    template: '{"user":"{{random_name}}","token":"{{random_token}}"}'
                }
            ],
            setupSteps: [
                {
                    action: 'create-test-data',
                    mockId: 'login-response',
                    variableName: 'test_login_payload'
                },
                {
                    action: 'set-environment',
                    envName: 'test_environment',
                    envValue: 'demo-{{test_username}}'
                },
                {
                    action: 'wait',
                    delayMs: 150
                }
            ],
            teardownSteps: [
                {
                    action: 'wait',
                    delayMs: 75
                }
            ]
        }
    };

    const plan = runtime.buildSuiteExecutionPlan(suite, { test_username: 'alice' }, {
        randomFn: () => 0,
        variableCache: {}
    });

    assertEqual(plan.beforeDelayMs, 150, 'Setup wait should contribute to before-delay');
    assertEqual(plan.afterDelayMs, 75, 'Teardown wait should contribute to after-delay');
    assertEqual(plan.baseContextVariables.test_environment, 'demo-alice', 'Environment variables should resolve against input context');
    assert(typeof plan.baseContextVariables.test_login_payload === 'object', 'Mock payload should be materialized as an object');
    assertEqual(plan.baseContextVariables.test_login_payload.user, 'Alex Carter', 'Mock payload should resolve built-in variables');
});

test('buildSuiteExecutionPlan should produce per-row iterations from file data', () => {
    const suite = {
        mock_builder: {
            fileData: {
                usageMode: 'per-row',
                headers: ['username', 'email'],
                rows: [
                    { username: 'alice', email: 'alice@example.test' },
                    { username: 'bob', email: 'bob@example.test' }
                ],
                columnMappings: {
                    username: 'test_username',
                    email: 'test_email'
                }
            }
        }
    };

    const plan = runtime.buildSuiteExecutionPlan(suite, { test_seed: 'demo' });

    assert(plan.hasFileIterations, 'Per-row file data should create iterations');
    assertEqual(plan.iterations.length, 2, 'Two file rows should create two iterations');
    assertEqual(plan.iterations[0].contextVariables.test_seed, 'demo', 'Base input variables should be preserved');
    assertEqual(plan.iterations[0].contextVariables.test_username, 'alice', 'Mapped file variables should be present');
    assertEqual(plan.iterations[1].contextVariables.test_email, 'bob@example.test', 'Second row variables should be present');
});

test('buildSuiteExecutionPlan should produce a single file_rows iteration for usageMode all', () => {
    const suite = {
        mock_builder: {
            fileData: {
                usageMode: 'all',
                headers: ['username'],
                rows: [
                    { username: 'alice' },
                    { username: 'bob' }
                ],
                columnMappings: {
                    username: 'test_username'
                }
            }
        }
    };

    const plan = runtime.buildSuiteExecutionPlan(suite, {});

    assertEqual(plan.iterations.length, 1, 'All-rows mode should create one iteration');
    assert(Array.isArray(plan.iterations[0].contextVariables.file_rows), 'file_rows should be an array');
    assertEqual(plan.iterations[0].contextVariables.file_rows.length, 2, 'All rows should be present in file_rows');
    assertEqual(plan.iterations[0].contextVariables.file_row_count, 2, 'file_row_count should reflect the row count');
});

test('parseSelectedRowIndexes should parse user selections as zero-based indexes', () => {
    const indexes = runtime.parseSelectedRowIndexes('1, 3, 5', 5);
    assertEqual(indexes.length, 3, 'Three row indexes should be parsed');
    assertEqual(indexes[0], 0, 'Row 1 should become index 0');
    assertEqual(indexes[1], 2, 'Row 3 should become index 2');
    assertEqual(indexes[2], 4, 'Row 5 should become index 4');
});
