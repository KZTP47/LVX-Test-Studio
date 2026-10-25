/**
 * LVX-Machina Security Testing UI
 * UI helper functions for the Security Testing Center
 */

// ============================================
// STATE
// ============================================

let currentSecurityResults = null;
let lastScanResults = null;

// ============================================
// MODAL CONTROL
// ============================================

function openSecurityModal() {
    const modal = document.getElementById('security-modal');
    if (modal) {
        modal.classList.remove('hidden');
        updateSecurityStats();
        loadSecurityHistory();
        loadSecurityPolicy();
    }
}

function closeSecurityModal() {
    const modal = document.getElementById('security-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// ============================================
// TAB SWITCHING
// ============================================

function switchSecurityTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.security-tab-content').forEach(tab => {
        tab.classList.add('hidden');
    });

    // Show selected tab
    const selectedTab = document.getElementById(`security-tab-${tabName}`);
    if (selectedTab) {
        selectedTab.classList.remove('hidden');
    }

    // Update button states
    document.querySelectorAll('.security-tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === tabName) {
            btn.classList.add('active');
        }
    });

    // Refresh data for specific tabs
    if (tabName === 'history') {
        loadSecurityHistory();
    } else if (tabName === 'policy') {
        loadSecurityPolicy();
    }
}

// ============================================
// SCANNING FUNCTIONS
// ============================================

async function runSecurityCodeScan() {
    const codeInput = document.getElementById('security-code-input');
    const language = document.getElementById('security-scan-language').value;

    if (!codeInput || !codeInput.value.trim()) {
        showSecurityNotification('Please enter code to scan', 'warning');
        return;
    }

    // Get selected scan types
    const scanTypes = [];
    if (document.getElementById('scan-type-sast')?.checked) scanTypes.push('sast');
    if (document.getElementById('scan-type-secrets')?.checked) scanTypes.push('secrets');
    if (document.getElementById('scan-type-xss')?.checked) scanTypes.push('xss');

    if (scanTypes.length === 0) {
        showSecurityNotification('Please select at least one scan type', 'warning');
        return;
    }

    // Update status
    updateSecurityStatus('Scanning...', 'warning');

    try {
        const results = await window.securityManager.runCodeScan(codeInput.value, {
            language: language,
            scanTypes: scanTypes,
            name: `Manual Scan (${language})`
        });

        lastScanResults = results;
        displayScanResults(results);
        updateSecurityStats();

        // Switch to results tab
        switchSecurityTab('results');

        // Send integration notifications if policy failed or critical issues found
        if (window.integrationsManager && (!results.policyPassed || results.summary.critical > 0)) {
            try {
                await window.integrationsManager.sendSecurityNotification(results);
                console.log('Security notifications sent to integrations');
            } catch (notifyError) {
                console.warn('Failed to send security notifications:', notifyError);
            }
        }

        // Show notification
        if (results.summary.total === 0) {
            showSecurityNotification('✅ No vulnerabilities found!', 'success');
            updateSecurityStatus('Passed', 'success');
        } else if (!results.policyPassed) {
            showSecurityNotification(`❌ Found ${results.summary.total} vulnerabilities - Policy Failed`, 'error');
            updateSecurityStatus('Failed', 'error');
        } else {
            showSecurityNotification(`⚠️ Found ${results.summary.total} vulnerabilities`, 'warning');
            updateSecurityStatus('Warnings', 'warning');
        }
    } catch (error) {
        console.error('Scan error:', error);
        showSecurityNotification(`Scan failed: ${error.message}`, 'error');
        updateSecurityStatus('Error', 'error');
    }
}

async function runQuickSecurityScan() {
    // Get currently selected suite if available
    if (window._currentSuiteId && window.testStorage) {
        const suite = window.testStorage.getSuiteById(window._currentSuiteId);
        if (suite && suite.code) {
            document.getElementById('security-code-input').value = suite.code;

            // Auto-detect language
            const languageSelect = document.getElementById('security-scan-language');
            if (suite.language) {
                languageSelect.value = suite.language.toLowerCase();
            }

            await runSecurityCodeScan();
            return;
        }
    }

    // Otherwise scan the code in the input
    await runSecurityCodeScan();
}

async function scanCurrentSuite() {
    if (!window._currentSuiteId || !window.testStorage) {
        showSecurityNotification('No test suite selected', 'warning');
        return;
    }

    const suite = window.testStorage.getSuiteById(window._currentSuiteId);
    if (!suite) {
        showSecurityNotification('Could not find selected suite', 'error');
        return;
    }

    if (!suite.code) {
        showSecurityNotification('Selected suite has no code to scan', 'warning');
        return;
    }

    // Set the code and language
    document.getElementById('security-code-input').value = suite.code;
    const languageSelect = document.getElementById('security-scan-language');
    if (suite.language) {
        languageSelect.value = suite.language.toLowerCase();
    }

    await runSecurityCodeScan();
}

// ============================================
// RESULTS DISPLAY
// ============================================

function displayScanResults(results) {
    // Update summary cards
    document.getElementById('result-critical').textContent = results.summary.critical || 0;
    document.getElementById('result-high').textContent = results.summary.high || 0;
    document.getElementById('result-medium').textContent = results.summary.medium || 0;
    document.getElementById('result-low').textContent = results.summary.low || 0;

    // Update policy status
    const policyStatus = document.getElementById('security-policy-status');
    if (results.policyPassed) {
        policyStatus.innerHTML = `
            <div class="flex items-center gap-3">
                <span class="text-2xl">✅</span>
                <div>
                    <div class="font-semibold text-green-400">Policy Check: Passed</div>
                    <div class="text-sm aero-text-muted">Scan completed in ${results.duration}ms</div>
                </div>
            </div>
        `;
        policyStatus.className = 'mb-6 p-4 aero-glass-panel rounded-lg border-l-4 border-green-500';
    } else {
        policyStatus.innerHTML = `
            <div class="flex items-center gap-3">
                <span class="text-2xl">❌</span>
                <div>
                    <div class="font-semibold text-red-400">Policy Check: Failed</div>
                    <div class="text-sm aero-text-muted">Vulnerabilities exceed policy thresholds</div>
                </div>
            </div>
        `;
        policyStatus.className = 'mb-6 p-4 aero-glass-panel rounded-lg border-l-4 border-red-500';
    }

    // Render vulnerabilities list
    const vulnList = document.getElementById('security-vulnerabilities-list');

    if (results.vulnerabilities.length === 0) {
        vulnList.innerHTML = `
            <div class="aero-glass-panel p-6 rounded-lg text-center">
                <span class="text-4xl">🎉</span>
                <div class="mt-3 text-lg font-semibold text-green-400">No Vulnerabilities Found</div>
                <div class="text-sm aero-text-muted mt-1">Your code passed all security checks</div>
            </div>
        `;
        return;
    }

    // Sort by severity
    const severityOrder = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
    const sortedVulns = [...results.vulnerabilities].sort((a, b) =>
        (severityOrder[a.severity] || 4) - (severityOrder[b.severity] || 4)
    );

    vulnList.innerHTML = sortedVulns.map((vuln, index) => `
        <div class="aero-glass-panel p-4 rounded-lg border-l-4 ${getSeverityBorderClass(vuln.severity)}">
            <div class="flex justify-between items-start mb-2">
                <div class="flex items-center gap-2">
                    <span class="text-lg">${getSeverityIcon(vuln.severity)}</span>
                    <span class="font-semibold">${vuln.ruleName || vuln.type || 'Security Issue'}</span>
                    ${vuln.ruleId ? `<span class="text-xs px-2 py-0.5 bg-gray-700 rounded">${vuln.ruleId}</span>` : ''}
                </div>
                <span class="text-xs px-2 py-1 rounded ${getSeverityBadgeClass(vuln.severity)}">${vuln.severity}</span>
            </div>
            <p class="text-sm aero-text-muted mb-2">${vuln.description || ''}</p>
            ${vuln.line ? `<div class="text-xs aero-text-muted mb-2">📍 Line ${vuln.line}</div>` : ''}
            ${vuln.match ? `<pre class="text-xs p-2 rounded overflow-x-auto mb-2" style="background: #1e293b; color: #ffffff;"><code style="color: #ffffff;">${escapeHtml(vuln.match)}</code></pre>` : ''}
            ${vuln.recommendation ? `
                <div class="text-sm text-blue-400 mt-2">
                    <span class="font-medium">💡 Recommendation:</span> ${vuln.recommendation}
                </div>
            ` : ''}
        </div>
    `).join('');
}

function getSeverityIcon(severity) {
    const icons = {
        'CRITICAL': '🔴',
        'HIGH': '🟠',
        'MEDIUM': '🟡',
        'LOW': '🟢'
    };
    return icons[severity] || '⚪';
}

function getSeverityBorderClass(severity) {
    const classes = {
        'CRITICAL': 'border-red-500',
        'HIGH': 'border-orange-500',
        'MEDIUM': 'border-yellow-500',
        'LOW': 'border-green-500'
    };
    return classes[severity] || 'border-gray-500';
}

function getSeverityBadgeClass(severity) {
    const classes = {
        'CRITICAL': 'bg-red-500/30 text-red-400',
        'HIGH': 'bg-orange-500/30 text-orange-400',
        'MEDIUM': 'bg-yellow-500/30 text-yellow-400',
        'LOW': 'bg-green-500/30 text-green-400'
    };
    return classes[severity] || 'bg-gray-500/30 text-gray-400';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// HISTORY
// ============================================

function loadSecurityHistory() {
    const historyList = document.getElementById('security-history-list');
    const history = window.securityManager.getHistory(20);

    if (history.length === 0) {
        historyList.innerHTML = `
            <div class="aero-glass-panel p-6 rounded-lg text-center aero-text-muted">
                No scan history yet.
            </div>
        `;
        return;
    }

    historyList.innerHTML = history.map(entry => `
        <div class="aero-glass-panel p-4 rounded-lg flex justify-between items-center">
            <div>
                <div class="font-semibold">${entry.name}</div>
                <div class="text-sm aero-text-muted">${formatDate(entry.timestamp)}</div>
            </div>
            <div class="flex items-center gap-4">
                <div class="text-sm">
                    <span class="text-red-400">${entry.summary?.critical || 0} C</span> /
                    <span class="text-orange-400">${entry.summary?.high || 0} H</span> /
                    <span class="text-yellow-400">${entry.summary?.medium || 0} M</span> /
                    <span class="text-green-400">${entry.summary?.low || 0} L</span>
                </div>
                <span class="text-xs px-2 py-1 rounded ${entry.policyPassed ? 'bg-green-500/30 text-green-400' : 'bg-red-500/30 text-red-400'}">
                    ${entry.policyPassed ? '✓ Passed' : '✗ Failed'}
                </span>
                <span class="text-xs aero-text-muted">${entry.duration}ms</span>
            </div>
        </div>
    `).join('');
}

function clearSecurityHistory() {
    if (confirm('Are you sure you want to clear all scan history?')) {
        window.securityManager.clearHistory();
        loadSecurityHistory();
        updateSecurityStats();
        showSecurityNotification('History cleared', 'success');
    }
}

function formatDate(dateString) {
    try {
        return new Date(dateString).toLocaleString();
    } catch {
        return dateString;
    }
}

// ============================================
// POLICY
// ============================================

function loadSecurityPolicy() {
    const policy = window.securityManager.policy;

    // Set radio button
    document.querySelectorAll('input[name="policy-fail-on"]').forEach(radio => {
        radio.checked = radio.value === policy.failOn;
    });

    // Set max values
    document.getElementById('policy-max-critical').value = policy.maxCritical;
    document.getElementById('policy-max-high').value = policy.maxHigh;
    document.getElementById('policy-max-medium').value = policy.maxMedium;
    document.getElementById('policy-max-low').value = policy.maxLow;

    // Set checkboxes
    document.getElementById('policy-block-pipeline').checked = policy.blockPipeline;
    document.getElementById('policy-notify-failure').checked = policy.notifyOnFailure;
}

function saveSecurityPolicy() {
    const failOn = document.querySelector('input[name="policy-fail-on"]:checked')?.value || 'critical';

    const policy = {
        failOn: failOn,
        maxCritical: parseInt(document.getElementById('policy-max-critical').value) || 0,
        maxHigh: parseInt(document.getElementById('policy-max-high').value) || 5,
        maxMedium: parseInt(document.getElementById('policy-max-medium').value) || 20,
        maxLow: parseInt(document.getElementById('policy-max-low').value) || 50,
        blockPipeline: document.getElementById('policy-block-pipeline').checked,
        notifyOnFailure: document.getElementById('policy-notify-failure').checked
    };

    window.securityManager.savePolicy(policy);
    showSecurityNotification('Security policy saved', 'success');
}

// ============================================
// STATS
// ============================================

function updateSecurityStats() {
    const stats = window.securityManager.getStatistics();

    document.getElementById('sec-stat-total').textContent = stats.totalScans;
    document.getElementById('sec-stat-passed').textContent = stats.passedScans;
    document.getElementById('sec-stat-failed').textContent = stats.failedScans;
}

// ============================================
// UTILITIES
// ============================================

function updateSecurityStatus(text, type) {
    const badge = document.getElementById('security-status-badge');
    if (!badge) return;

    badge.textContent = text;

    const classes = {
        'success': 'bg-green-500/20 text-green-400',
        'warning': 'bg-yellow-500/20 text-yellow-400',
        'error': 'bg-red-500/20 text-red-400'
    };

    badge.className = `text-sm px-3 py-1 rounded-full ${classes[type] || classes.success}`;
}

function showSecurityNotification(message, type = 'info') {
    // Use existing notification system if available
    if (window.showToast) {
        window.showToast(message, type);
    } else if (window.showNotification) {
        window.showNotification(message, type);
    } else {
        console.log(`[Security] ${type.toUpperCase()}: ${message}`);
    }
}

function clearSecurityInput() {
    document.getElementById('security-code-input').value = '';
}

function exportSecurityResults() {
    if (!lastScanResults) {
        showSecurityNotification('No results to export', 'warning');
        return;
    }

    const exportData = {
        ...lastScanResults,
        exportedAt: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `security-scan-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showSecurityNotification('Results exported', 'success');
}

// Save security scan as a test suite
async function saveSecurityScanAsSuite() {
    if (!lastScanResults) {
        showSecurityNotification('No scan results to save', 'warning');
        return;
    }

    const codeInput = document.getElementById('security-code-input');
    const language = document.getElementById('security-scan-language')?.value || 'javascript';

    if (!codeInput || !codeInput.value.trim()) {
        showSecurityNotification('No code to save', 'warning');
        return;
    }

    // Prompt for suite name
    const defaultName = `Security Scan - ${new Date().toLocaleDateString()}`;

    // Use the custom input modal if available, otherwise prompt
    const getSuiteName = () => {
        return new Promise((resolve) => {
            if (window.showInputModal) {
                window.showInputModal('Enter Test Suite Name', defaultName, (name) => {
                    resolve(name);
                });
            } else {
                const name = prompt('Enter a name for this security test suite:', defaultName);
                resolve(name);
            }
        });
    };

    const suiteName = await getSuiteName();
    if (!suiteName) {
        showSecurityNotification('Save cancelled', 'info');
        return;
    }

    // Get selected scan types
    const scanTypes = [];
    if (document.getElementById('scan-type-sast')?.checked) scanTypes.push('sast');
    if (document.getElementById('scan-type-secrets')?.checked) scanTypes.push('secrets');
    if (document.getElementById('scan-type-xss')?.checked) scanTypes.push('xss');

    // Create suite object
    const suite = {
        name: suiteName,
        description: `Security test with ${lastScanResults.summary.total} vulnerabilities found`,
        language: 'security', // Special type for security tests
        code: codeInput.value,
        tags: ['security', language],
        securityConfig: {
            scanLanguage: language,
            scanTypes: scanTypes,
            lastScanSummary: lastScanResults.summary
        }
    };

    // Save using the test storage
    if (window.testStorage) {
        try {
            const savedId = await window.testStorage.saveSuite(suite);
            showSecurityNotification(`Saved as test suite: ${suiteName}`, 'success');

            // Refresh the suite list if function exists
            if (window.renderSuiteList) {
                window.renderSuiteList();
            }

            // Close modal
            closeSecurityModal();
        } catch (error) {
            console.error('Error saving suite:', error);
            showSecurityNotification('Failed to save suite: ' + error.message, 'error');
        }
    } else {
        showSecurityNotification('Test storage not available', 'error');
    }
}

// ============================================
// EXPORTS
// ============================================

window.openSecurityModal = openSecurityModal;
window.closeSecurityModal = closeSecurityModal;
window.switchSecurityTab = switchSecurityTab;
window.runSecurityCodeScan = runSecurityCodeScan;
window.runQuickSecurityScan = runQuickSecurityScan;
window.scanCurrentSuite = scanCurrentSuite;
window.clearSecurityInput = clearSecurityInput;
window.exportSecurityResults = exportSecurityResults;
window.saveSecurityScanAsSuite = saveSecurityScanAsSuite;
window.loadSecurityHistory = loadSecurityHistory;
window.clearSecurityHistory = clearSecurityHistory;
window.loadSecurityPolicy = loadSecurityPolicy;
window.saveSecurityPolicy = saveSecurityPolicy;
window.updateSecurityStats = updateSecurityStats;

console.log('🔒 Security UI loaded');

