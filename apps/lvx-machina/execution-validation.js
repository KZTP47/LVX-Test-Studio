(function (globalScope) {
    function normalizeExecutionText(value) {
        return String(value ?? '')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .trimEnd();
    }

    function getSuiteValidationSource(suite) {
        return String(suite?.expected_output ?? '').trim();
    }

    function looksLikePythonValidationCode(source) {
        const trimmed = String(source ?? '').trim();
        if (!trimmed) return false;

        if (trimmed.includes('\n')) return true;

        return (
            /(^|\s)assert\s+/.test(trimmed) ||
            /\bassert_output_equals\s*\(/.test(trimmed) ||
            /(^|\s)(raise|import|from|def|class)\s+/.test(trimmed) ||
            /\b(TEST_OUTPUT|TEST_STDOUT|TEST_STDERR|ARTIFACTS)\b/.test(trimmed) ||
            /==|!=|<=|>=/.test(trimmed)
        );
    }

    function getSuiteValidationMode(language, source) {
        const trimmed = String(source ?? '').trim();
        if (!trimmed) return 'none';
        if (language === 'python' && looksLikePythonValidationCode(trimmed)) {
            return 'python-assertions';
        }
        return 'expected-output';
    }

    function buildOutputMismatchMessage(expected, actual) {
        return [
            'Validation failed: actual output did not match the expected output.',
            '',
            '[EXPECTED]',
            String(expected ?? ''),
            '',
            '[ACTUAL]',
            String(actual ?? '')
        ].join('\n');
    }

    const api = {
        normalizeExecutionText,
        getSuiteValidationSource,
        looksLikePythonValidationCode,
        getSuiteValidationMode,
        buildOutputMismatchMessage
    };

    globalScope.ExecutionValidation = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
