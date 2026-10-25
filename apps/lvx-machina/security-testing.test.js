/**
 * LVX-Machina Security Testing - Unit Tests
 * Tests for SecurityTestManager and all scanner classes
 */

// ============================================
// TEST FRAMEWORK
// ============================================

const TestRunner = {
    tests: [],
    passed: 0,
    failed: 0,

    register(name, testFn) {
        this.tests.push({ name, testFn });
    },

    async run() {
        console.log('\n🔒 SECURITY TESTING MODULE - UNIT TESTS\n');
        console.log('='.repeat(60));

        this.passed = 0;
        this.failed = 0;

        for (const test of this.tests) {
            try {
                await test.testFn();
                console.log(`✅ PASS: ${test.name}`);
                this.passed++;
            } catch (error) {
                console.log(`❌ FAIL: ${test.name}`);
                console.log(`   Error: ${error.message}`);
                this.failed++;
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log(`📊 Results: ${this.passed} passed, ${this.failed} failed, ${this.tests.length} total`);
        console.log('='.repeat(60) + '\n');

        return this.failed === 0;
    }
};

function assert(condition, message = 'Assertion failed') {
    if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message = '') {
    if (actual !== expected) {
        throw new Error(`${message} Expected: ${expected}, Got: ${actual}`);
    }
}

function assertGreater(actual, expected, message = '') {
    if (actual <= expected) {
        throw new Error(`${message} Expected ${actual} > ${expected}`);
    }
}

function assertContains(array, item, message = '') {
    if (!array.includes(item)) {
        throw new Error(`${message} Array does not contain expected item`);
    }
}

// ============================================
// MOCK window AND localStorage
// ============================================

// Mock window object for Node.js
global.window = {};

const mockStorage = {};
global.localStorage = {
    getItem: (key) => mockStorage[key] || null,
    setItem: (key, value) => { mockStorage[key] = value; },
    removeItem: (key) => { delete mockStorage[key]; },
    clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); }
};

// ============================================
// LOAD SECURITY MODULE
// ============================================

// We need to mock fetch for dependency scanner tests
global.fetch = async (url, options) => {
    // Mock OSV API response
    if (url.includes('api.osv.dev')) {
        return {
            ok: true,
            json: async () => ({ vulns: [] })
        };
    }
    return { ok: false };
};

// Load the security testing module
require('./security-testing.js');

// Make classes available globally for tests
const SASTScanner = window.SASTScanner;
const SecretsScanner = window.SecretsScanner;
const DependencyScanner = window.DependencyScanner;
const HeadersScanner = window.HeadersScanner;
const XSSScanner = window.XSSScanner;
const SecurityTestManager = window.SecurityTestManager;

// ============================================
// SAST SCANNER TESTS
// ============================================

TestRunner.register('SAST: Detects eval() usage in JavaScript', () => {
    const scanner = new SASTScanner();
    const code = `
        const userInput = getData();
        const result = eval(userInput);
        console.log(result);
    `;
    const results = scanner.scan(code, 'javascript');
    assert(results.some(r => r.ruleId === 'JS001'), 'Should detect eval()');
    assert(results.some(r => r.severity === 'HIGH'), 'eval should be HIGH severity');
});

TestRunner.register('SAST: Detects innerHTML assignment', () => {
    const scanner = new SASTScanner();
    const code = `element.innerHTML = userInput;`;
    const results = scanner.scan(code, 'javascript');
    assert(results.some(r => r.ruleId === 'JS002'), 'Should detect innerHTML');
});

TestRunner.register('SAST: Detects document.write', () => {
    const scanner = new SASTScanner();
    const code = `document.write('<script>alert(1)</script>');`;
    const results = scanner.scan(code, 'javascript');
    assert(results.some(r => r.ruleId === 'JS003'), 'Should detect document.write');
});

TestRunner.register('SAST: Detects hardcoded password', () => {
    const scanner = new SASTScanner();
    const code = `const password = "supersecret123";`;
    const results = scanner.scan(code, 'javascript');
    assert(results.some(r => r.ruleId === 'JS005'), 'Should detect hardcoded password');
    assert(results.some(r => r.severity === 'CRITICAL'), 'Should be CRITICAL severity');
});

TestRunner.register('SAST: Detects command injection in JavaScript', () => {
    const scanner = new SASTScanner();
    const code = 'exec(`rm -rf ${userInput}`)';
    const results = scanner.scan(code, 'javascript');
    assert(results.some(r => r.ruleId === 'JS007'), 'Should detect command injection');
});

TestRunner.register('SAST: Detects exec() in Python', () => {
    const scanner = new SASTScanner();
    const code = `
        user_code = get_input()
        exec(user_code)
    `;
    const results = scanner.scan(code, 'python');
    assert(results.some(r => r.ruleId === 'PY001'), 'Should detect Python exec()');
});

TestRunner.register('SAST: Detects shell injection in Python', () => {
    const scanner = new SASTScanner();
    const code = `subprocess.call(cmd, shell=True)`;
    const results = scanner.scan(code, 'python');
    assert(results.some(r => r.ruleId === 'PY005'), 'Should detect shell=True');
});

TestRunner.register('SAST: Returns line numbers correctly', () => {
    const scanner = new SASTScanner();
    const code = `line1\nline2\neval(x)\nline4`;
    const results = scanner.scan(code, 'javascript');
    const evalResult = results.find(r => r.ruleId === 'JS001');
    assert(evalResult, 'Should find eval');
    assertEqual(evalResult.line, 3, 'eval should be on line 3');
});

TestRunner.register('SAST: Clean code returns no results', () => {
    const scanner = new SASTScanner();
    const code = `
        function add(a, b) {
            return a + b;
        }
        console.log(add(1, 2));
    `;
    const results = scanner.scan(code, 'javascript');
    assertEqual(results.length, 0, 'Clean code should have no vulnerabilities');
});

// ============================================
// SECRETS SCANNER TESTS
// ============================================

TestRunner.register('Secrets: Detects AWS Access Key', () => {
    const scanner = new SecretsScanner();
    const code = `const awsKey = "AKIAIOSFODNN7EXAMPLE";`;
    const results = scanner.scan(code);
    assert(results.some(r => r.type === 'AWS Access Key ID'), 'Should detect AWS key');
    assert(results.some(r => r.severity === 'CRITICAL'), 'AWS key should be CRITICAL');
});

TestRunner.register('Secrets: Detects GitHub Token', () => {
    const scanner = new SecretsScanner();
    const code = `const token = "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890";`;
    const results = scanner.scan(code);
    assert(results.some(r => r.type === 'GitHub Token'), 'Should detect GitHub token');
});

TestRunner.register('Secrets: Detects Slack Token', () => {
    const scanner = new SecretsScanner();
    const code = `const slack = "${['xoxb', '123456789012', '1234567890123', 'abcdefghijklmnop'].join('-')}";`;
    const results = scanner.scan(code);
    assert(results.some(r => r.type === 'Slack Token'), 'Should detect Slack token');
});

TestRunner.register('Secrets: Detects Private Key header', () => {
    const scanner = new SecretsScanner();
    const code = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA...`;
    const results = scanner.scan(code);
    assert(results.some(r => r.type === 'Private Key'), 'Should detect private key');
});

TestRunner.register('Secrets: Detects JWT Token', () => {
    const scanner = new SecretsScanner();
    const code = `const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";`;
    const results = scanner.scan(code);
    assert(results.some(r => r.type === 'JWT Token'), 'Should detect JWT');
});

TestRunner.register('Secrets: Detects Database Connection String', () => {
    const scanner = new SecretsScanner();
    const code = `const db = "mongodb://admin:password123@mongodb.example.com:27017/mydb";`;
    const results = scanner.scan(code);
    assert(results.some(r => r.type === 'Database Connection String'), 'Should detect DB connection string');
});

TestRunner.register('Secrets: Masks secret values correctly', () => {
    const scanner = new SecretsScanner();
    const code = `const key = "AKIAIOSFODNN7EXAMPLE";`;
    const results = scanner.scan(code);
    const awsResult = results.find(r => r.type === 'AWS Access Key ID');
    assert(awsResult, 'Should find AWS key');
    assert(awsResult.match.includes('...'), 'Secret should be masked');
    assert(!awsResult.match.includes('AKIAIOSFODNN7EXAMPLE'), 'Full secret should not be visible');
});

TestRunner.register('Secrets: No false positives on clean code', () => {
    const scanner = new SecretsScanner();
    const code = `
        const user = getUser();
        const config = loadConfig();
        console.log('Hello World');
    `;
    const results = scanner.scan(code);
    assertEqual(results.length, 0, 'Clean code should have no secrets detected');
});

// ============================================
// XSS SCANNER TESTS
// ============================================

TestRunner.register('XSS: Detects innerHTML with user input in code', () => {
    const scanner = new XSSScanner();
    const code = `element.innerHTML = request.query.input;`;
    const results = scanner.scanCode(code);
    assert(results.length > 0, 'Should detect XSS pattern');
});

// ============================================
// SECURITY MANAGER TESTS
// ============================================

TestRunner.register('SecurityManager: Initializes with all scanners', () => {
    const manager = new SecurityTestManager();
    assert(manager.scanners.has('sast'), 'Should have SAST scanner');
    assert(manager.scanners.has('secrets'), 'Should have secrets scanner');
    assert(manager.scanners.has('dependencies'), 'Should have dependencies scanner');
    assert(manager.scanners.has('headers'), 'Should have headers scanner');
    assert(manager.scanners.has('xss'), 'Should have XSS scanner');
});

TestRunner.register('SecurityManager: runCodeScan returns proper structure', async () => {
    const manager = new SecurityTestManager();
    const result = await manager.runCodeScan('eval(x)', { language: 'javascript' });

    assert(result.id, 'Should have ID');
    assert(result.timestamp, 'Should have timestamp');
    assert(result.vulnerabilities, 'Should have vulnerabilities array');
    assert(result.summary, 'Should have summary');
    assert('critical' in result.summary, 'Summary should have critical count');
    assert('high' in result.summary, 'Summary should have high count');
    assert('medium' in result.summary, 'Summary should have medium count');
    assert('low' in result.summary, 'Summary should have low count');
    assert('total' in result.summary, 'Summary should have total count');
});

TestRunner.register('SecurityManager: Calculates summary correctly', async () => {
    const manager = new SecurityTestManager();
    const code = `
        const password = "secret123";
        eval(userInput);
        element.innerHTML = data;
    `;
    const result = await manager.runCodeScan(code, { language: 'javascript' });

    assertEqual(result.summary.total, result.vulnerabilities.length, 'Total should match vulnerabilities count');
    assertGreater(result.summary.total, 0, 'Should find vulnerabilities');
});

TestRunner.register('SecurityManager: Policy compliance check works', () => {
    const manager = new SecurityTestManager();

    // Test passing case
    const passingResult = manager.checkPolicyCompliance({ critical: 0, high: 0, medium: 5, low: 10 });
    assert(passingResult, 'Should pass with no critical/high');

    // Test failing case
    const failingResult = manager.checkPolicyCompliance({ critical: 1, high: 0, medium: 0, low: 0 });
    assert(!failingResult, 'Should fail with critical vulnerability');
});

TestRunner.register('SecurityManager: Saves and loads policy', () => {
    const manager = new SecurityTestManager();

    const newPolicy = {
        failOn: 'high',
        maxCritical: 0,
        maxHigh: 2,
        maxMedium: 10,
        maxLow: 25
    };

    manager.savePolicy(newPolicy);

    assertEqual(manager.policy.failOn, 'high', 'Policy failOn should be updated');
    assertEqual(manager.policy.maxHigh, 2, 'Policy maxHigh should be updated');
});

TestRunner.register('SecurityManager: History is saved', async () => {
    localStorage.clear();
    const manager = new SecurityTestManager();

    await manager.runCodeScan('eval(x)', { name: 'Test Scan 1' });
    await manager.runCodeScan('const x = 1;', { name: 'Test Scan 2' });

    const history = manager.getHistory();
    assertGreater(history.length, 0, 'History should have entries');
});

TestRunner.register('SecurityManager: Statistics calculation works', async () => {
    localStorage.clear();
    const manager = new SecurityTestManager();

    await manager.runCodeScan('eval(x)', {});
    await manager.runCodeScan('const good = 1;', {});

    const stats = manager.getStatistics();

    assert('totalScans' in stats, 'Stats should have totalScans');
    assert('passedScans' in stats, 'Stats should have passedScans');
    assert('failedScans' in stats, 'Stats should have failedScans');
    assert('totalVulnerabilities' in stats, 'Stats should have totalVulnerabilities');
});

TestRunner.register('SecurityManager: Generates valid scan IDs', () => {
    const manager = new SecurityTestManager();
    const id = manager._generateId();

    assert(id.startsWith('scan_'), 'ID should start with scan_');
    assert(id.length > 10, 'ID should be reasonably long');
});

TestRunner.register('SecurityManager: Severity helpers return correct values', () => {
    const manager = new SecurityTestManager();

    assertEqual(manager.getSeverityIcon('CRITICAL'), '🔴', 'Critical icon');
    assertEqual(manager.getSeverityIcon('HIGH'), '🟠', 'High icon');
    assertEqual(manager.getSeverityIcon('MEDIUM'), '🟡', 'Medium icon');
    assertEqual(manager.getSeverityIcon('LOW'), '🟢', 'Low icon');

    assert(manager.getSeverityColor('CRITICAL').includes('dc2626'), 'Critical color');
    assert(manager.getSeverityColor('HIGH').includes('f97316'), 'High color');
});

// ============================================
// DEPENDENCY SCANNER TESTS
// ============================================

TestRunner.register('DependencyScanner: Parses package.json correctly', async () => {
    const scanner = new DependencyScanner();
    const packageJson = JSON.stringify({
        name: 'test-app',
        dependencies: {
            'lodash': '^4.17.0',
            'express': '~4.18.0'
        }
    });

    // This test mainly ensures no errors occur during parsing
    const results = await scanner.scan(packageJson);
    assert(Array.isArray(results), 'Should return array');
});

TestRunner.register('DependencyScanner: Handles invalid JSON', async () => {
    const scanner = new DependencyScanner();
    const results = await scanner.scan('not valid json');

    assert(results.length > 0, 'Should return parse error');
    assert(results[0].type === 'parse_error', 'Should be parse error type');
});

// ============================================
// INTEGRATION TESTS
// ============================================

TestRunner.register('Integration: Full scan combines SAST and secrets', async () => {
    const manager = new SecurityTestManager();
    const code = `
        const apiKey = "AKIAIOSFODNN7EXAMPLE";
        eval(userInput);
    `;

    const result = await manager.runCodeScan(code, {
        scanTypes: ['sast', 'secrets']
    });

    const hasSAST = result.vulnerabilities.some(v => v.scanner === 'sast');
    const hasSecrets = result.vulnerabilities.some(v => v.scanner === 'secrets');

    assert(hasSAST, 'Should have SAST results');
    assert(hasSecrets, 'Should have secrets results');
});

TestRunner.register('Integration: Clean code passes policy', async () => {
    const manager = new SecurityTestManager();
    const result = await manager.runCodeScan(`
        function safeAdd(a, b) {
            return a + b;
        }
    `);

    assert(result.policyPassed, 'Clean code should pass policy');
    assertEqual(result.summary.total, 0, 'Should have no vulnerabilities');
});

// ============================================
// RUN TESTS
// ============================================

TestRunner.run().then(success => {
    process.exit(success ? 0 : 1);
});
