const {
    normalizeExecutionText,
    looksLikePythonValidationCode,
    getSuiteValidationMode,
    buildOutputMismatchMessage
} = require('./execution-validation.js');

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message} Expected ${expected}, got ${actual}`);
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

test('normalizeExecutionText should trim trailing newlines and normalize CRLF', () => {
    assertEqual(normalizeExecutionText('PRINT\r\n'), 'PRINT', 'Normalized output mismatch.');
});

test('looksLikePythonValidationCode should detect assertion code', () => {
    assertEqual(looksLikePythonValidationCode('assert TEST_OUTPUT.strip() == "PRINT"'), true, 'Assertion code should be detected.');
    assertEqual(looksLikePythonValidationCode('assert_output_equals("PRINT")'), true, 'Helper assertions should be detected as Python code.');
    assertEqual(looksLikePythonValidationCode('PRINT444444514545'), false, 'Plain expected output should not be treated as Python code.');
});

test('getSuiteValidationMode should keep plain text as expected output validation', () => {
    assertEqual(getSuiteValidationMode('python', 'PRINT444444514545'), 'expected-output', 'Plain text should use expected output mode.');
    assertEqual(getSuiteValidationMode('python', 'assert TEST_OUTPUT == "PRINT"'), 'python-assertions', 'Python assertions should use test-code mode.');
    assertEqual(getSuiteValidationMode('python', 'assert_output_equals("PRINT")'), 'python-assertions', 'Helper assertions should use test-code mode.');
    assertEqual(getSuiteValidationMode('robot', 'PASS'), 'expected-output', 'Non-Python validation should use expected output mode.');
});

test('buildOutputMismatchMessage should include expected and actual values', () => {
    const message = buildOutputMismatchMessage('PRINT444444514545', 'PRINT');
    assertEqual(message.includes('[EXPECTED]'), true, 'Expected section missing.');
    assertEqual(message.includes('[ACTUAL]'), true, 'Actual section missing.');
});
