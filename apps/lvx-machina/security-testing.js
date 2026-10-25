/**
 * LVX-Machina Security Testing Module
 * DevSecOps security scanning capabilities including SAST, DAST, secrets detection, and dependency scanning
 */

// Docker and K8s scanners moved to Backend (main.js)
// Stubs for frontend reference if needed.

// const url = require('url'); // Removed for browser compatibility

// ============================================
// SECURITY RULES & PATTERNS
// ============================================

const SAST_RULES = {
    javascript: [
        { id: 'JS001', name: 'eval() Usage', severity: 'HIGH', pattern: /\beval\s*\(/g, description: 'eval() can execute arbitrary code and is a security risk', recommendation: 'Use JSON.parse() for data or Function constructor with caution' },
        { id: 'JS002', name: 'innerHTML Assignment', severity: 'MEDIUM', pattern: /\.innerHTML\s*=/g, description: 'Direct innerHTML assignment can lead to XSS', recommendation: 'Use textContent or sanitize HTML before insertion' },
        { id: 'JS003', name: 'document.write', severity: 'MEDIUM', pattern: /document\.write\s*\(/g, description: 'document.write can overwrite page content and enable XSS', recommendation: 'Use DOM manipulation methods instead' },
        { id: 'JS004', name: 'Unsafe Regex', severity: 'LOW', pattern: /new\s+RegExp\s*\([^)]*\+/g, description: 'Dynamic regex construction can lead to ReDoS attacks', recommendation: 'Use static regex patterns or validate input' },
        { id: 'JS005', name: 'Hardcoded Password', severity: 'CRITICAL', pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{3,}['"]/gi, description: 'Hardcoded passwords expose credentials', recommendation: 'Use environment variables or secure secrets management' },
        { id: 'JS006', name: 'SQL Injection Risk', severity: 'HIGH', pattern: /`[^`]*\$\{[^}]+\}[^`]*(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)/gi, description: 'String interpolation in SQL queries can lead to injection', recommendation: 'Use parameterized queries or prepared statements' },
        { id: 'JS007', name: 'Command Injection', severity: 'CRITICAL', pattern: /(?:exec|spawn|execSync)\s*\(\s*(?:`[^`]*\$|[^)]*\+)/g, description: 'Dynamic command construction can lead to command injection', recommendation: 'Validate and sanitize all inputs, use allowlists' },
        { id: 'JS008', name: 'Prototype Pollution', severity: 'HIGH', pattern: /__proto__|constructor\s*\[|Object\.assign\s*\([^,]+,\s*(?:req|user|input)/g, description: 'Prototype pollution can modify object behavior', recommendation: 'Use Object.create(null) or validate property names' },
        { id: 'JS009', name: 'Insecure Randomness', severity: 'MEDIUM', pattern: /Math\.random\s*\(\)/g, description: 'Math.random() is not cryptographically secure', recommendation: 'Use crypto.getRandomValues() for security-sensitive operations' },
        { id: 'JS010', name: 'Dangerous Function Constructor', severity: 'HIGH', pattern: /new\s+Function\s*\(/g, description: 'Function constructor can execute arbitrary code like eval()', recommendation: 'Avoid dynamic code generation' },
        { id: 'JS011', name: 'Unvalidated Redirect', severity: 'MEDIUM', pattern: /(?:location|window\.location)\s*=\s*(?:req|params|query|input)/g, description: 'Unvalidated redirects can lead to phishing attacks', recommendation: 'Validate redirect URLs against an allowlist' },
        { id: 'JS012', name: 'Sensitive Data in localStorage', severity: 'MEDIUM', pattern: /localStorage\.setItem\s*\([^)]*(?:password|token|secret|key|credential)/gi, description: 'Storing sensitive data in localStorage is insecure', recommendation: 'Use secure httpOnly cookies or session storage with encryption' }
    ],
    python: [
        { id: 'PY001', name: 'exec() Usage', severity: 'HIGH', pattern: /\bexec\s*\(/g, description: 'exec() can execute arbitrary Python code', recommendation: 'Avoid exec() or use ast.literal_eval() for data' },
        { id: 'PY002', name: 'eval() Usage', severity: 'HIGH', pattern: /\beval\s*\(/g, description: 'eval() can execute arbitrary expressions', recommendation: 'Use ast.literal_eval() for safe evaluation' },
        { id: 'PY003', name: 'pickle Deserialization', severity: 'HIGH', pattern: /pickle\.(?:load|loads)\s*\(/g, description: 'Pickle can execute arbitrary code during deserialization', recommendation: 'Use JSON or other safe serialization formats' },
        { id: 'PY004', name: 'SQL String Formatting', severity: 'HIGH', pattern: /(?:execute|executemany)\s*\(\s*(?:f['"]|['"].*%)/g, description: 'String formatting in SQL queries can lead to injection', recommendation: 'Use parameterized queries with placeholders' },
        { id: 'PY005', name: 'Shell Injection', severity: 'CRITICAL', pattern: /subprocess\.(?:call|run|Popen)[^)]*shell\s*=\s*True/g, description: 'shell=True with user input enables command injection', recommendation: 'Use shell=False and pass arguments as a list' },
        { id: 'PY006', name: 'Hardcoded Secret', severity: 'CRITICAL', pattern: /(?:api_key|secret|password|token)\s*=\s*['"][^'"]{8,}['"]/gi, description: 'Hardcoded secrets expose credentials', recommendation: 'Use environment variables or secrets management' },
        { id: 'PY007', name: 'Insecure Deserialization', severity: 'HIGH', pattern: /yaml\.(?:load|unsafe_load)\s*\(/g, description: 'Unsafe YAML loading can execute arbitrary code', recommendation: 'Use yaml.safe_load() instead' },
        { id: 'PY008', name: 'Weak Cryptography', severity: 'MEDIUM', pattern: /(?:MD5|SHA1)\s*\(|hashlib\.(?:md5|sha1)/g, description: 'MD5 and SHA1 are cryptographically weak', recommendation: 'Use SHA-256 or stronger hash functions' },
        { id: 'PY009', name: 'Debug Mode in Production', severity: 'MEDIUM', pattern: /DEBUG\s*=\s*True|app\.run\s*\([^)]*debug\s*=\s*True/g, description: 'Debug mode exposes sensitive information', recommendation: 'Disable debug mode in production' },
        { id: 'PY010', name: 'Insecure SSL', severity: 'HIGH', pattern: /verify\s*=\s*False|ssl\._create_unverified_context/g, description: 'Disabling SSL verification enables MITM attacks', recommendation: 'Always verify SSL certificates' }
    ],
    robot: [
        { id: 'RF001', name: 'Hardcoded Credentials', severity: 'CRITICAL', pattern: /(?:password|secret|token)\s+[^\$\{][^\s]+/gi, description: 'Hardcoded credentials in test files', recommendation: 'Use variables from secure sources' },
        { id: 'RF002', name: 'Insecure HTTP', severity: 'MEDIUM', pattern: /http:\/\/(?!localhost|127\.0\.0\.1)/g, description: 'Using insecure HTTP instead of HTTPS', recommendation: 'Use HTTPS for all external connections' }
    ]
};

const SECRET_PATTERNS = [
    { name: 'AWS Access Key ID', pattern: /\b(AKIA[0-9A-Z]{16})\b/g, severity: 'CRITICAL', description: 'AWS Access Key detected' },
    { name: 'AWS Secret Access Key', pattern: /(?:aws_secret_access_key|aws_secret_key)\s*[:=]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/gi, severity: 'CRITICAL', description: 'AWS Secret Key detected' },
    { name: 'GitHub Token', pattern: /\b(gh[ps]_[A-Za-z0-9_]{36,})\b/g, severity: 'CRITICAL', description: 'GitHub Personal Access Token detected' },
    { name: 'GitHub OAuth', pattern: /\b(gho_[A-Za-z0-9_]{36,})\b/g, severity: 'CRITICAL', description: 'GitHub OAuth Token detected' },
    { name: 'Slack Token', pattern: /\b(xox[baprs]-[0-9A-Za-z-]{10,})\b/g, severity: 'HIGH', description: 'Slack API Token detected' },
    { name: 'Slack Webhook', pattern: /(https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9\/]+)/g, severity: 'HIGH', description: 'Slack Webhook URL detected' },
    { name: 'Private Key', pattern: /(-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----)/g, severity: 'CRITICAL', description: 'Private key detected' },
    { name: 'Generic API Key', pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?([A-Za-z0-9_-]{20,})['"]?/gi, severity: 'HIGH', description: 'Generic API key pattern detected' },
    { name: 'Generic Secret', pattern: /(?:secret|password|passwd|pwd|token)\s*[:=]\s*['"]([^'"]{8,})['"](?!\s*\))/gi, severity: 'HIGH', description: 'Generic secret pattern detected' },
    { name: 'JWT Token', pattern: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, severity: 'HIGH', description: 'JWT token detected' },
    { name: 'Database Connection String', pattern: /((?:mongodb|postgres|mysql|redis):\/\/[^:]+:[^@]+@[^\s'"]+)/gi, severity: 'CRITICAL', description: 'Database connection string with credentials' },
    { name: 'Google API Key', pattern: /\b(AIza[0-9A-Za-z_-]{35})\b/g, severity: 'HIGH', description: 'Google API key detected' },
    { name: 'Stripe API Key', pattern: /\b(sk_live_[0-9a-zA-Z]{24,})\b/g, severity: 'CRITICAL', description: 'Stripe live API key detected' },
    { name: 'Stripe Test Key', pattern: /\b(sk_test_[0-9a-zA-Z]{24,})\b/g, severity: 'MEDIUM', description: 'Stripe test API key detected' },
    { name: 'SendGrid API Key', pattern: /\b(SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})\b/g, severity: 'HIGH', description: 'SendGrid API key detected' },
    { name: 'Twilio API Key', pattern: /\b(SK[a-f0-9]{32})\b/g, severity: 'HIGH', description: 'Twilio API key detected' },
    { name: 'npm Token', pattern: /\b(npm_[A-Za-z0-9]{36})\b/g, severity: 'HIGH', description: 'npm access token detected' },
    { name: 'Discord Webhook', pattern: /(https:\/\/discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+)/g, severity: 'HIGH', description: 'Discord webhook URL detected' },
    { name: 'Basic Auth Header', pattern: /Authorization:\s*Basic\s+([A-Za-z0-9+/=]{10,})/gi, severity: 'HIGH', description: 'Basic authentication header detected' }
];

const SECURITY_HEADERS = {
    'Content-Security-Policy': { severity: 'HIGH', required: true, description: 'Prevents XSS and data injection attacks', recommendation: "Add a strict CSP header" },
    'X-Frame-Options': { severity: 'MEDIUM', required: true, description: 'Prevents clickjacking attacks', recommendation: "Add X-Frame-Options: DENY or SAMEORIGIN" },
    'X-Content-Type-Options': { severity: 'LOW', required: true, description: 'Prevents MIME type sniffing', recommendation: "Add X-Content-Type-Options: nosniff" },
    'Strict-Transport-Security': { severity: 'HIGH', required: false, description: 'Enforces HTTPS connections', recommendation: "Add HSTS header with max-age >= 31536000" },
    'X-XSS-Protection': { severity: 'LOW', required: false, description: 'Legacy XSS protection', recommendation: "Add X-XSS-Protection: 1; mode=block" },
    'Referrer-Policy': { severity: 'LOW', required: false, description: 'Controls referrer information', recommendation: "Add Referrer-Policy: strict-origin-when-cross-origin" },
    'Permissions-Policy': { severity: 'MEDIUM', required: false, description: 'Controls browser features', recommendation: "Add Permissions-Policy to restrict features" }
};

// ============================================
// SCANNER CLASSES
// ============================================

/**
 * Static Application Security Testing Scanner
 */
class SASTScanner {
    constructor() {
        this.name = 'sast';
        // Shallow copy arrays to allow extension, preserving RegExp objects
        this.rules = {};
        for (const [lang, rules] of Object.entries(SAST_RULES)) {
            this.rules[lang] = [...rules];
        }
    }

    addCustomRules(newRules) {
        for (const [lang, rules] of Object.entries(newRules)) {
            if (!this.rules[lang]) {
                this.rules[lang] = [];
            }
            // Avoid duplicates by ID
            const existingIds = new Set(this.rules[lang].map(r => r.id));
            const uniqueRules = rules.filter(r => !existingIds.has(r.id));
            this.rules[lang].push(...uniqueRules);
        }
    }

    scan(code, language = 'javascript') {
        const results = [];
        const rules = this.rules[language] || this.rules.javascript;

        for (const rule of rules) {
            // Ensure pattern is regex
            if (typeof rule.pattern === 'string') {
                try { rule.pattern = new RegExp(rule.pattern, 'g'); } catch (e) { }
            }

            const matches = code.matchAll(rule.pattern);
            for (const match of matches) {
                const lineNumber = this._getLineNumber(code, match.index);
                results.push({
                    scanner: this.name,
                    ruleId: rule.id,
                    ruleName: rule.name,
                    severity: rule.severity,
                    description: rule.description,
                    recommendation: rule.recommendation,
                    line: lineNumber,
                    column: match.index - code.lastIndexOf('\n', match.index),
                    match: match[0].substring(0, 100),
                    language: language
                });
            }
        }

        return results;
    }

    _getLineNumber(code, index) {
        return code.substring(0, index).split('\n').length;
    }
}

/**
 * Secrets Detection Scanner
 */
class SecretsScanner {
    constructor() {
        this.name = 'secrets';
        this.patterns = SECRET_PATTERNS;
    }

    scan(code) {
        const results = [];

        for (const pattern of this.patterns) {
            // Reset regex lastIndex
            pattern.pattern.lastIndex = 0;
            const matches = code.matchAll(pattern.pattern);

            for (const match of matches) {
                const lineNumber = this._getLineNumber(code, match.index);
                const secretValue = match[1] || match[0];

                results.push({
                    scanner: this.name,
                    type: pattern.name,
                    severity: pattern.severity,
                    description: pattern.description,
                    line: lineNumber,
                    match: this._maskSecret(secretValue),
                    recommendation: 'Remove hardcoded secret and use environment variables or a secrets manager'
                });
            }
        }

        return results;
    }

    _getLineNumber(code, index) {
        return code.substring(0, index).split('\n').length;
    }

    _maskSecret(secret) {
        if (secret.length <= 8) return '***';
        return secret.substring(0, 4) + '...' + secret.substring(secret.length - 4);
    }
}

/**
 * Dependency Vulnerability Scanner
 */
class DependencyScanner {
    constructor() {
        this.name = 'dependencies';
        this.cache = new Map();
        this.CACHE_DURATION = 3600000; // 1 hour
    }

    async scan(packageJsonContent) {
        const results = [];

        try {
            const pkg = JSON.parse(packageJsonContent);
            const allDeps = {
                ...pkg.dependencies,
                ...pkg.devDependencies
            };

            for (const [name, version] of Object.entries(allDeps)) {
                const vulns = await this.checkVulnerabilities(name, version);
                results.push(...vulns);
            }
        } catch (e) {
            results.push({
                scanner: this.name,
                type: 'parse_error',
                severity: 'LOW',
                description: `Failed to parse package.json: ${e.message}`,
                recommendation: 'Ensure package.json is valid JSON'
            });
        }

        return results;
    }

    async checkVulnerabilities(packageName, version) {
        const cacheKey = `${packageName}@${version}`;
        const cached = this.cache.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
            return cached.data;
        }

        const cleanVersion = version.replace(/^[\^~>=<]/, '').split(' ')[0];
        const results = [];

        try {
            // Use OSV (Open Source Vulnerabilities) API - free, no auth required
            const response = await fetch('https://api.osv.dev/v1/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    package: { name: packageName, ecosystem: 'npm' },
                    version: cleanVersion
                })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.vulns && data.vulns.length > 0) {
                    for (const vuln of data.vulns) {
                        results.push({
                            scanner: this.name,
                            package: packageName,
                            version: cleanVersion,
                            vulnId: vuln.id,
                            severity: this._mapSeverity(vuln.severity || vuln.database_specific?.severity),
                            description: vuln.summary || vuln.details?.substring(0, 200),
                            recommendation: `Update ${packageName} to a patched version`,
                            references: vuln.references?.slice(0, 3).map(r => r.url) || []
                        });
                    }
                }
            }
        } catch (e) {
            // Network error - don't fail the scan
            console.warn(`Failed to check ${packageName}: ${e.message}`);
        }

        this.cache.set(cacheKey, { data: results, timestamp: Date.now() });
        return results;
    }

    _mapSeverity(severity) {
        if (!severity) return 'MEDIUM';
        const s = severity.toUpperCase();
        if (s.includes('CRITICAL')) return 'CRITICAL';
        if (s.includes('HIGH')) return 'HIGH';
        if (s.includes('MODERATE') || s.includes('MEDIUM')) return 'MEDIUM';
        return 'LOW';
    }
}

/**
 * HTTP Security Headers Scanner
 */
class HeadersScanner {
    constructor() {
        this.name = 'headers';
        this.headers = SECURITY_HEADERS;
    }

    async scan(url) {
        const results = [];

        try {
            const response = await fetch(url, { method: 'HEAD', mode: 'cors' });

            for (const [header, config] of Object.entries(this.headers)) {
                const value = response.headers.get(header);

                if (!value && config.required) {
                    results.push({
                        scanner: this.name,
                        header: header,
                        severity: config.severity,
                        status: 'MISSING',
                        description: `Missing security header: ${header}`,
                        recommendation: config.recommendation
                    });
                } else if (value) {
                    // Check for weak configurations
                    const weakness = this._checkWeakConfig(header, value);
                    if (weakness) {
                        results.push({
                            scanner: this.name,
                            header: header,
                            severity: 'LOW',
                            status: 'WEAK',
                            currentValue: value,
                            description: weakness,
                            recommendation: config.recommendation
                        });
                    }
                }
            }
        } catch (e) {
            results.push({
                scanner: this.name,
                severity: 'LOW',
                description: `Unable to fetch headers: ${e.message}`,
                recommendation: 'Ensure the URL is accessible and allows CORS'
            });
        }

        return results;
    }

    scanFromDocument(doc) {
        const results = [];

        // Check for meta CSP
        const cspMeta = doc.querySelector('meta[http-equiv="Content-Security-Policy"]');
        if (!cspMeta) {
            results.push({
                scanner: this.name,
                header: 'Content-Security-Policy',
                severity: 'HIGH',
                status: 'MISSING',
                description: 'No Content-Security-Policy meta tag found',
                recommendation: 'Add CSP header or meta tag to prevent XSS attacks'
            });
        }

        return results;
    }

    _checkWeakConfig(header, value) {
        if (header === 'Content-Security-Policy') {
            if (value.includes("'unsafe-inline'") && value.includes("'unsafe-eval'")) {
                return 'CSP allows unsafe-inline and unsafe-eval which weakens protection';
            }
            if (value.includes('*') && !value.includes('*.')) {
                return 'CSP uses wildcard which allows any source';
            }
        }
        if (header === 'Strict-Transport-Security') {
            const maxAge = parseInt(value.match(/max-age=(\d+)/)?.[1] || '0');
            if (maxAge < 31536000) {
                return 'HSTS max-age should be at least 1 year (31536000 seconds)';
            }
        }
        return null;
    }
}

/**
 * XSS Vulnerability Scanner
 */
class XSSScanner {
    constructor() {
        this.name = 'xss';
        this.payloads = [
            '<script>alert(1)</script>',
            '"><img src=x onerror=alert(1)>',
            "'-alert(1)-'",
            '<svg onload=alert(1)>',
            'javascript:alert(1)'
        ];
    }

    scanDOM(doc) {
        const results = [];

        // Check for dangerous patterns in inline scripts
        const scripts = doc.querySelectorAll('script:not([src])');
        scripts.forEach((script, index) => {
            const content = script.textContent;

            // Check for document.write
            if (/document\.write\s*\(/.test(content)) {
                results.push({
                    scanner: this.name,
                    type: 'dom-xss',
                    severity: 'MEDIUM',
                    element: `script[${index}]`,
                    description: 'document.write() usage detected - potential DOM XSS',
                    recommendation: 'Use safe DOM manipulation methods'
                });
            }

            // Check for innerHTML with user input
            if (/\.innerHTML\s*=.*(?:location|document\.URL|document\.referrer)/i.test(content)) {
                results.push({
                    scanner: this.name,
                    type: 'dom-xss',
                    severity: 'HIGH',
                    element: `script[${index}]`,
                    description: 'innerHTML assignment with URL/referrer data - DOM XSS vulnerability',
                    recommendation: 'Sanitize user input before DOM insertion'
                });
            }
        });

        // Check for inline event handlers
        const dangerousAttrs = ['onclick', 'onerror', 'onload', 'onmouseover', 'onfocus', 'onblur'];
        dangerousAttrs.forEach(attr => {
            const elements = doc.querySelectorAll(`[${attr}]`);
            if (elements.length > 0) {
                results.push({
                    scanner: this.name,
                    type: 'inline-handler',
                    severity: 'LOW',
                    count: elements.length,
                    attribute: attr,
                    description: `${elements.length} inline ${attr} handler(s) found`,
                    recommendation: 'Use addEventListener instead of inline handlers'
                });
            }
        });

        // Check for javascript: URLs
        const jsLinks = doc.querySelectorAll('a[href^="javascript:"]');
        if (jsLinks.length > 0) {
            results.push({
                scanner: this.name,
                type: 'javascript-url',
                severity: 'MEDIUM',
                count: jsLinks.length,
                description: `${jsLinks.length} javascript: URL(s) found`,
                recommendation: 'Avoid javascript: URLs, use event handlers instead'
            });
        }

        return results;
    }

    scanCode(code) {
        const results = [];

        // Check for reflected XSS patterns
        const patterns = [
            { pattern: /\.innerHTML\s*=\s*(?:req|request|params|query|input|data)/gi, desc: 'innerHTML with user input' },
            { pattern: /document\.write\s*\([^)]*(?:req|request|params|query|input|data)/gi, desc: 'document.write with user input' },
            { pattern: /\$\([^)]+\)\.html\s*\([^)]*(?:req|request|params|query|input|data)/gi, desc: 'jQuery .html() with user input' }
        ];

        for (const { pattern, desc } of patterns) {
            const matches = code.matchAll(pattern);
            for (const match of matches) {
                results.push({
                    scanner: this.name,
                    type: 'reflected-xss',
                    severity: 'HIGH',
                    line: code.substring(0, match.index).split('\n').length,
                    match: match[0].substring(0, 80),
                    description: desc,
                    recommendation: 'Sanitize all user input before DOM insertion'
                });
            }
        }

        return results;
    }
}

// ============================================
// INFRASTRUCTURE SCANNERS
// ============================================

/**
 * Docker Security Scanner
 */
class DockerScanner {
    constructor() { console.log('DockerScanner initialized (stub)'); }
    async scanContainer() { return { summary: { total: 0 }, vulnerabilities: [], policyPassed: true }; }
    async scanImage() { return { summary: { total: 0 }, vulnerabilities: [], policyPassed: true }; }
}

class K8sScanner {
    constructor() { console.log('K8sScanner initialized (stub)'); }
    scanYaml() { return { summary: { total: 0 }, vulnerabilities: [], policyPassed: true }; }
}

class NetworkScanner {
    constructor() { console.log('NetworkScanner initialized (stub)'); }
    async scanPort() { return { summary: { total: 0 }, vulnerabilities: [], policyPassed: true }; }
    async scanEndpoint() { return []; }
}

// ============================================
// SECURITY TEST MANAGER
// ============================================

class SecurityTestManager {
    constructor() {
        this.STORAGE_KEY = 'security_scan_results';
        this.POLICY_KEY = 'security_policy';
        this.HISTORY_KEY = 'security_scan_history';
        this.MAX_HISTORY = 100;
        this.scanHistory = this._loadLegacyHistorySync();
        this.scanResults = new Map();

        // Initialize scanners
        this.scanners = new Map();
        this.registerScanner('sast', new SASTScanner());
        this.registerScanner('secrets', new SecretsScanner());
        this.registerScanner('dependencies', new DependencyScanner());
        this.registerScanner('headers', new HeadersScanner());
        this.registerScanner('xss', new XSSScanner());
        this.registerScanner('docker', new DockerScanner());
        this.registerScanner('kubernetes', new K8sScanner());
        this.registerScanner('network', new NetworkScanner());

        // Load stored policy
        this.policy = this.loadPolicy();
        this.readyPromise = this._loadSecurityScanState();
    }

    _getStorageManager() {
        return window.storageManager && window.storageManager.STORES ? window.storageManager : null;
    }

    _cloneValue(value) {
        return JSON.parse(JSON.stringify(value));
    }

    _loadLegacyHistorySync() {
        try {
            const stored = localStorage.getItem(this.HISTORY_KEY);
            const history = stored ? JSON.parse(stored) : [];
            return Array.isArray(history) ? history.slice(0, this.MAX_HISTORY) : [];
        } catch (error) {
            console.warn('Failed to load legacy security scan history:', error);
            return [];
        }
    }

    async _loadSecurityScanState() {
        const storageManager = this._getStorageManager();
        if (!storageManager) {
            return this.scanHistory;
        }

        try {
            const records = await storageManager.getAll(storageManager.STORES.securityScans);
            const sorted = Array.isArray(records)
                ? records.slice().sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
                : [];

            this.scanResults = new Map(sorted.map(record => [record.id, this._cloneValue(record)]));
            this.scanHistory = sorted.slice(0, this.MAX_HISTORY).map(record => ({
                id: record.id,
                name: record.name,
                type: record.type,
                timestamp: record.timestamp,
                summary: record.summary,
                policyPassed: record.policyPassed,
                duration: record.duration
            }));

            localStorage.removeItem(this.HISTORY_KEY);
            localStorage.removeItem(this.STORAGE_KEY);
            if (typeof window.loadSecurityHistory === 'function') {
                window.loadSecurityHistory();
            }
            if (typeof window.updateSecurityStats === 'function') {
                window.updateSecurityStats();
            }
        } catch (error) {
            console.warn('Failed to load security scans from IndexedDB:', error);
        }

        return this.scanHistory;
    }

    async _persistSecurityScan(result) {
        const storageManager = this._getStorageManager();
        if (!storageManager) {
            localStorage.setItem(this.HISTORY_KEY, JSON.stringify(this.scanHistory));
            return;
        }

        try {
            await storageManager.put(storageManager.STORES.securityScans, this._cloneValue(result));
            localStorage.removeItem(this.HISTORY_KEY);
            localStorage.removeItem(this.STORAGE_KEY);
        } catch (error) {
            console.error('Failed to persist security scan to IndexedDB:', error);
        }
    }

    async _clearPersistedSecurityScans() {
        const storageManager = this._getStorageManager();
        if (!storageManager) {
            localStorage.removeItem(this.HISTORY_KEY);
            localStorage.removeItem(this.STORAGE_KEY);
            return;
        }

        try {
            await storageManager.clear(storageManager.STORES.securityScans);
            localStorage.removeItem(this.HISTORY_KEY);
            localStorage.removeItem(this.STORAGE_KEY);
        } catch (error) {
            console.error('Failed to clear security scans from IndexedDB:', error);
        }
    }

    registerScanner(name, scanner) {
        this.scanners.set(name, scanner);
    }

    /**
     * Load custom SAST rules
     * @param {object} rules - Dictionary of rules by language
     */
    loadCustomRules(rules) {
        const sast = this.scanners.get('sast');
        if (sast && sast.addCustomRules) {
            sast.addCustomRules(rules);
            console.log('Loaded custom SAST rules');
        }
    }

    /**
     * Run security scan on code
     * @param {string} code - Code to scan
     * @param {object} options - Scan options
     * @returns {object} Scan results
     */
    async runCodeScan(code, options = {}) {
        if (this.readyPromise) {
            await this.readyPromise;
        }

        const {
            language = 'javascript',
            scanTypes = ['sast', 'secrets'],
            name = 'Code Scan'
        } = options;

        const startTime = Date.now();
        const results = {
            id: this._generateId(),
            name: name,
            type: 'code',
            timestamp: new Date().toISOString(),
            language: language,
            vulnerabilities: [],
            summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 }
        };

        // Run SAST
        if (scanTypes.includes('sast')) {
            const sastScanner = this.scanners.get('sast');
            const sastResults = sastScanner.scan(code, language);
            results.vulnerabilities.push(...sastResults);
        }

        // Run Secrets scan
        if (scanTypes.includes('secrets')) {
            const secretsScanner = this.scanners.get('secrets');
            const secretsResults = secretsScanner.scan(code);
            results.vulnerabilities.push(...secretsResults);
        }

        // Run XSS code scan
        if (scanTypes.includes('xss')) {
            const xssScanner = this.scanners.get('xss');
            const xssResults = xssScanner.scanCode(code);
            results.vulnerabilities.push(...xssResults);
        }

        // Calculate summary
        results.vulnerabilities.forEach(v => {
            results.summary[v.severity.toLowerCase()]++;
            results.summary.total++;
        });

        results.duration = Date.now() - startTime;
        results.policyPassed = this.checkPolicyCompliance(results.summary);

        // Save to history
        this._saveToHistory(results);

        return results;
    }

    /**
     * Run dependency scan on package.json content
     */
    async runDependencyScan(packageJsonContent, options = {}) {
        if (this.readyPromise) {
            await this.readyPromise;
        }

        const startTime = Date.now();
        const results = {
            id: this._generateId(),
            name: options.name || 'Dependency Scan',
            type: 'dependencies',
            timestamp: new Date().toISOString(),
            vulnerabilities: [],
            summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 }
        };

        const depScanner = this.scanners.get('dependencies');
        const vulns = await depScanner.scan(packageJsonContent);
        results.vulnerabilities = vulns;

        // Calculate summary
        results.vulnerabilities.forEach(v => {
            if (v.severity) {
                results.summary[v.severity.toLowerCase()]++;
                results.summary.total++;
            }
        });

        results.duration = Date.now() - startTime;
        results.policyPassed = this.checkPolicyCompliance(results.summary);

        this._saveToHistory(results);
        return results;
    }

    /**
     * Run DAST scan on URL or document
     */
    async runDynamicScan(target, options = {}) {
        if (this.readyPromise) {
            await this.readyPromise;
        }

        const startTime = Date.now();
        const results = {
            id: this._generateId(),
            name: options.name || 'Dynamic Scan',
            type: 'dynamic',
            timestamp: new Date().toISOString(),
            target: typeof target === 'string' ? target : 'document',
            vulnerabilities: [],
            summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 }
        };

        const scanTypes = options.scanTypes || ['headers', 'xss'];

        // Headers scan
        if (scanTypes.includes('headers')) {
            const headersScanner = this.scanners.get('headers');
            if (typeof target === 'string') {
                const headerResults = await headersScanner.scan(target);
                results.vulnerabilities.push(...headerResults);
            } else if (target.querySelector) {
                const headerResults = headersScanner.scanFromDocument(target);
                results.vulnerabilities.push(...headerResults);
            }
        }

        // XSS DOM scan
        if (scanTypes.includes('xss') && target.querySelector) {
            const xssScanner = this.scanners.get('xss');
            const xssResults = xssScanner.scanDOM(target);
            results.vulnerabilities.push(...xssResults);
        }

        // Calculate summary
        results.vulnerabilities.forEach(v => {
            if (v.severity) {
                results.summary[v.severity.toLowerCase()]++;
                results.summary.total++;
            }
        });

        results.duration = Date.now() - startTime;
        results.policyPassed = this.checkPolicyCompliance(results.summary);

        this._saveToHistory(results);
        return results;
    }

    /**
     * Run all scans on a test suite
     */
    async runFullScan(suite, options = {}) {
        if (this.readyPromise) {
            await this.readyPromise;
        }

        const results = {
            id: this._generateId(),
            name: `Full Scan: ${suite.name}`,
            type: 'full',
            timestamp: new Date().toISOString(),
            suiteId: suite.id,
            scans: [],
            vulnerabilities: [],
            summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 }
        };

        // Scan code
        if (suite.code) {
            const codeResults = await this.runCodeScan(suite.code, {
                language: suite.language,
                name: 'Code Analysis'
            });
            results.scans.push(codeResults);
            results.vulnerabilities.push(...codeResults.vulnerabilities);
        }

        // Aggregate summary
        results.vulnerabilities.forEach(v => {
            if (v.severity) {
                results.summary[v.severity.toLowerCase()]++;
            }
        });
        results.summary.total = results.vulnerabilities.length;
        results.policyPassed = this.checkPolicyCompliance(results.summary);

        this._saveToHistory(results);
        return results;
    }

    /**
     * Run Infrastructure Scan (Docker/K8s/Network)
     */
    async runInfrastructureScan(target, type, options = {}) {
        if (this.readyPromise) {
            await this.readyPromise;
        }

        const startTime = Date.now();
        const results = {
            id: this._generateId(),
            name: options.name || `${type} Scan`,
            type: 'infrastructure',
            subtype: type,
            timestamp: new Date().toISOString(),
            target: target,
            vulnerabilities: [],
            summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 }
        };

        if (type === 'docker_container') {
            const scanner = this.scanners.get('docker');
            const vulns = await scanner.scanContainer(target);
            if (vulns.error) results.error = vulns.error;
            else results.vulnerabilities = vulns;
        } else if (type === 'docker_image') {
            const scanner = this.scanners.get('docker');
            const vulns = await scanner.scanImage(target);
            if (vulns.error) results.error = vulns.error;
            else results.vulnerabilities = vulns;
        } else if (type === 'k8s_yaml') {
            const scanner = this.scanners.get('kubernetes');
            results.vulnerabilities = scanner.scanYaml(target);
        } else if (type === 'network_port') {
            const scanner = this.scanners.get('network');
            const [host, port] = target.split(':');
            const vuln = await scanner.scanPort(host, parseInt(port));
            if (vuln) results.vulnerabilities.push(vuln);
        }

        // Summarize
        results.vulnerabilities.forEach(v => {
            if (v.severity) {
                results.summary[v.severity.toLowerCase()]++;
                results.summary.total++;
            }
        });

        results.duration = Date.now() - startTime;
        results.policyPassed = this.checkPolicyCompliance(results.summary);
        this._saveToHistory(results);
        return results;
    }

    // ============================================
    // POLICY MANAGEMENT
    // ============================================

    loadPolicy() {
        try {
            const stored = localStorage.getItem(this.POLICY_KEY);
            return stored ? JSON.parse(stored) : this.getDefaultPolicy();
        } catch (e) {
            return this.getDefaultPolicy();
        }
    }

    getDefaultPolicy() {
        return {
            failOn: 'critical', // critical, high, medium, low
            maxCritical: 0,
            maxHigh: 5,
            maxMedium: 20,
            maxLow: 50,
            blockPipeline: true,
            notifyOnFailure: true
        };
    }

    savePolicy(policy) {
        this.policy = { ...this.getDefaultPolicy(), ...policy };
        localStorage.setItem(this.POLICY_KEY, JSON.stringify(this.policy));
    }

    checkPolicyCompliance(summary) {
        const policy = this.policy;

        if (summary.critical > policy.maxCritical) return false;
        if (policy.failOn === 'critical') return summary.critical === 0;

        if (summary.high > policy.maxHigh) return false;
        if (policy.failOn === 'high') return summary.critical === 0 && summary.high === 0;

        if (summary.medium > policy.maxMedium) return false;
        if (policy.failOn === 'medium') return summary.critical === 0 && summary.high === 0 && summary.medium === 0;

        if (summary.low > policy.maxLow) return false;

        return true;
    }

    // ============================================
    // HISTORY MANAGEMENT
    // ============================================

    _saveToHistory(result) {
        try {
            const historyEntry = {
                id: result.id,
                name: result.name,
                type: result.type,
                timestamp: result.timestamp,
                summary: result.summary,
                policyPassed: result.policyPassed,
                duration: result.duration
            };

            this.scanResults.set(result.id, this._cloneValue(result));
            this.scanHistory = [historyEntry, ...this.scanHistory.filter(item => item.id !== result.id)];

            // Keep only MAX_HISTORY entries
            this.scanHistory = this.scanHistory.slice(0, this.MAX_HISTORY);
            this._persistSecurityScan(result);
        } catch (e) {
            console.error('Failed to save scan history:', e);
        }
    }

    getHistory(limit = 50) {
        try {
            return this.scanHistory.slice(0, limit);
        } catch (e) {
            return [];
        }
    }

    getStatistics() {
        const history = this.getHistory(100);
        const stats = {
            totalScans: history.length,
            passedScans: history.filter(h => h.policyPassed).length,
            failedScans: history.filter(h => !h.policyPassed).length,
            totalVulnerabilities: { critical: 0, high: 0, medium: 0, low: 0 },
            averageDuration: 0,
            scansByType: {}
        };

        let totalDuration = 0;
        history.forEach(h => {
            // Sum vulnerabilities
            if (h.summary) {
                stats.totalVulnerabilities.critical += h.summary.critical || 0;
                stats.totalVulnerabilities.high += h.summary.high || 0;
                stats.totalVulnerabilities.medium += h.summary.medium || 0;
                stats.totalVulnerabilities.low += h.summary.low || 0;
            }

            // Sum duration
            totalDuration += h.duration || 0;

            // Count by type
            stats.scansByType[h.type] = (stats.scansByType[h.type] || 0) + 1;
        });

        stats.averageDuration = history.length > 0 ? Math.round(totalDuration / history.length) : 0;

        return stats;
    }

    clearHistory() {
        this.scanHistory = [];
        this.scanResults = new Map();
        this._clearPersistedSecurityScans();
    }

    // ============================================
    // UTILITIES
    // ============================================

    _generateId() {
        return 'scan_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    getSeverityColor(severity) {
        const colors = {
            'CRITICAL': '#dc2626',
            'HIGH': '#f97316',
            'MEDIUM': '#eab308',
            'LOW': '#22c55e'
        };
        return colors[severity] || '#6b7280';
    }

    getSeverityIcon(severity) {
        const icons = {
            'CRITICAL': '🔴',
            'HIGH': '🟠',
            'MEDIUM': '🟡',
            'LOW': '🟢'
        };
        return icons[severity] || '⚪';
    }

    formatVulnerability(vuln) {
        return {
            ...vuln,
            icon: this.getSeverityIcon(vuln.severity),
            color: this.getSeverityColor(vuln.severity)
        };
    }
}

// ============================================
// EXPORTS
// ============================================

// Export classes
window.SecurityTestManager = SecurityTestManager;
window.SASTScanner = SASTScanner;
window.SecretsScanner = SecretsScanner;
window.DependencyScanner = DependencyScanner;
window.HeadersScanner = HeadersScanner;
window.XSSScanner = XSSScanner;

// Export singleton instance
window.securityManager = new SecurityTestManager();

// Export constants for UI
window.SAST_RULES = SAST_RULES;
window.SECRET_PATTERNS = SECRET_PATTERNS;
window.SECURITY_HEADERS = SECURITY_HEADERS;

console.log('🔒 Security Testing Module loaded');
