/**
 * ============================================
 * COLLABORATION UI MANAGEMENT FUNCTIONS
 * ============================================
 */

// ============================================
// MODAL MANAGEMENT
// ============================================

function openCollaborationModal() {
    updateCurrentUserDisplay();
    updateSharingBackendStatus();
    populateCollaborationSelectors();
    document.getElementById('collaboration-modal').classList.remove('hidden');

    // Load data for active tab
    const activeTab = document.querySelector('[id^="collab-tab-"].border-blue-500')?.id.replace('collab-tab-', '') || 'share';
    if (activeTab === 'share') {
        refreshBackendSharesIfConfigured();
    }
}

function closeCollaborationModal() {
    document.getElementById('collaboration-modal').classList.add('hidden');
}

function switchCollabTab(tab) {
    const tabs = ['share', 'import', 'comments', 'versions', 'team'];

    tabs.forEach(t => {
        const tabBtn = document.getElementById(`collab-tab-${t}`);
        const panel = document.getElementById(`collab-panel-${t}`);

        if (tabBtn && panel) {
            if (t === tab) {
                tabBtn.className = 'py-3 px-4 font-semibold whitespace-nowrap aero-text-primary border-b-2 border-blue-500 transition';
                panel.classList.remove('hidden');
            } else {
                tabBtn.className = 'py-3 px-4 font-semibold whitespace-nowrap aero-text-muted transition hover:aero-text-secondary';
                panel.classList.add('hidden');
            }
        }
    });

    // Load data when switching to specific tabs
    if (tab === 'comments') loadSuiteComments();
    if (tab === 'versions') loadVersionHistory();
    if (tab === 'team') renderTeamMembers();
    if (tab === 'share') refreshBackendSharesIfConfigured();
}

// ============================================
// USER MANAGEMENT
// ============================================

function updateCurrentUserDisplay() {
    const user = window.collaborationManager.getCurrentUser();
    const displayElement = document.getElementById('current-user-display');
    const avatarElement = document.getElementById('user-avatar');

    if (displayElement) displayElement.textContent = user;
    if (avatarElement) avatarElement.textContent = user.charAt(0).toUpperCase();
}

function changeUsername() {
    const currentName = window.collaborationManager.getCurrentUser();

    window.showInputModal('Enter your name:', currentName, (newName) => {
        if (newName && newName.trim() && newName !== currentName) {
            try {
                window.collaborationManager.setCurrentUser(newName.trim());
                updateCurrentUserDisplay();
                if (typeof window.showMessage === 'function') {
                    window.showMessage('✅ Username updated to: ' + newName, 'success');
                }
            } catch (error) {
                if (typeof window.showMessage === 'function') {
                    window.showMessage('❌ ' + error.message, 'error');
                }
            }
        }
    });
}

// ============================================
// SHARING BACKEND CONFIGURATION
// ============================================

function openSharingBackendConfig() {
    const config = window.collaborationManager.getBackendConfig();

    if (config) {
        document.getElementById('sharing-backend-url').value = config.backendUrl || '';
        document.getElementById('sharing-api-key').value = config.apiKey || '';
    } else {
        document.getElementById('sharing-backend-url').value = '';
        document.getElementById('sharing-api-key').value = '';
    }

    document.getElementById('sharing-backend-modal').classList.remove('hidden');
}

function closeSharingBackendConfig() {
    document.getElementById('sharing-backend-modal').classList.add('hidden');
}

function saveSharingBackendConfig(event) {
    if (event) event.preventDefault();

    const backendUrl = document.getElementById('sharing-backend-url').value.trim();
    const apiKey = document.getElementById('sharing-api-key').value.trim();

    if (!backendUrl || !apiKey) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('⚠️ Please enter both backend URL and API key', 'warning');
        }
        return;
    }

    try {
        window.collaborationManager.saveBackendConfig({
            backendUrl,
            apiKey,
            enabled: true
        });

        if (typeof window.showMessage === 'function') {
            window.showMessage('✅ Sharing backend configured successfully!', 'success');
        }
        closeSharingBackendConfig();
        updateSharingBackendStatus();

    } catch (error) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('❌ Failed to save: ' + error.message, 'error');
        }
    }
}

async function testSharingBackendConnection() {
    const backendUrl = document.getElementById('sharing-backend-url').value.trim();
    const apiKey = document.getElementById('sharing-api-key').value.trim();

    if (!backendUrl || !apiKey) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('⚠️ Please enter backend URL and API key first', 'warning');
        }
        return;
    }

    const spinner = document.getElementById('test-backend-spinner');
    if (spinner) spinner.classList.remove('hidden');

    const originalConfig = window.collaborationManager.getBackendConfig();

    try {
        window.collaborationManager.saveBackendConfig({ backendUrl, apiKey, enabled: true });

        if (typeof window.showMessage === 'function') {
            window.showMessage('⏳ Testing connection...', 'info');
        }

        const result = await window.collaborationManager.testBackendConnection();

        if (typeof window.showMessage === 'function') {
            window.showMessage(
                `✅ ${result.message}\n\nBackend: ${result.backendInfo?.name || 'Connected'}`,
                'success'
            );
        }

    } catch (error) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('❌ Connection failed: ' + error.message, 'error');
        }

        if (originalConfig) {
            window.collaborationManager.saveBackendConfig(originalConfig);
        } else {
            window.collaborationManager.clearBackendConfig();
        }
    } finally {
        if (spinner) spinner.classList.add('hidden');
    }
}

function clearSharingBackendConfig() {
    if (confirm('Clear sharing backend configuration?\n\nYou will only be able to use file-based sharing.')) {
        window.collaborationManager.clearBackendConfig();
        document.getElementById('sharing-backend-url').value = '';
        document.getElementById('sharing-api-key').value = '';
        if (typeof window.showMessage === 'function') {
            window.showMessage('🗑️ Backend configuration cleared', 'info');
        }
        updateSharingBackendStatus();
    }
}

function toggleSharingApiKeyVisibility() {
    const input = document.getElementById('sharing-api-key');
    input.type = input.type === 'password' ? 'text' : 'password';
}

function updateSharingBackendStatus() {
    const isConfigured = window.collaborationManager.isBackendConfigured();
    const badge = document.getElementById('share-backend-badge');
    const statusText = document.getElementById('share-backend-status-text');
    const linkSection = document.getElementById('link-sharing-section');
    const sharesSection = document.getElementById('backend-shares-section');

    if (isConfigured) {
        const config = window.collaborationManager.getBackendConfig();

        if (badge) {
            badge.className = 'aero-badge-success text-xs';
            badge.textContent = 'Enabled';
        }

        if (statusText) {
            statusText.textContent = `Connected to: ${config.backendUrl}`;
        }

        if (linkSection) linkSection.classList.remove('hidden');
        if (sharesSection) sharesSection.classList.remove('hidden');

    } else {
        if (badge) {
            badge.className = 'aero-badge-error text-xs';
            badge.textContent = 'Disabled';
        }

        if (statusText) {
            statusText.textContent = 'Not configured - Only file-based sharing available';
        }

        if (linkSection) linkSection.classList.add('hidden');
        if (sharesSection) sharesSection.classList.add('hidden');
    }
}

// ============================================
// POPULATE SELECTORS
// ============================================

function populateCollaborationSelectors() {
    const suites = window.testSuites || [];

    const selectors = [
        'file-export-suite-selector',
        'link-share-suite-selector',
        'comment-suite-selector',
        'version-suite-selector'
    ];

    selectors.forEach(selectorId => {
        const selector = document.getElementById(selectorId);
        if (selector) {
            const currentValue = selector.value;
            const options = suites.map(suite =>
                `<option value='${suite.id}'>${suite.name}</option>`
            ).join('');

            selector.innerHTML = '<option value="">-- Select a test suite --</option>' + options;

            if (currentValue && suites.some(s => s.id === currentValue)) {
                selector.value = currentValue;
            }
        }
    });
}

// ============================================
// FILE-BASED SHARING
// ============================================

function exportTestSuiteAsFile() {
    const suiteId = document.getElementById('file-export-suite-selector').value;
    if (!suiteId) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('⚠️ Please select a test suite', 'warning');
        }
        return;
    }

    const suite = window.testSuites.find(s => s.id === suiteId);
    if (!suite) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('❌ Test suite not found', 'error');
        }
        return;
    }

    const includeHistory = document.getElementById('export-include-history').checked;

    try {
        const result = window.collaborationManager.exportForTeam(suite, includeHistory);

        const url = URL.createObjectURL(result.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (typeof window.showMessage === 'function') {
            window.showMessage(
                `✅ Test suite exported successfully!\n\nFile: ${result.filename}\nSize: ${(result.size / 1024).toFixed(2)} KB`,
                'success'
            );
        }

    } catch (error) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('❌ Export failed: ' + error.message, 'error');
        }
    }
}

function exportAllSuites() {
    const suites = window.testSuites || [];

    if (suites.length === 0) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('⚠️ No test suites to export', 'warning');
        }
        return;
    }

    try {
        const exportData = {
            version: '1.0',
            format: 'lvx-machina-bulk-export',
            exportedAt: new Date().toISOString(),
            exportedBy: window.collaborationManager.getCurrentUser(),
            suites: suites.map(suite => window.collaborationManager._sanitizeSuiteForSharing(suite)),
            count: suites.length
        };

        const jsonString = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const filename = `all_test_suites_${new Date().toISOString().split('T')[0]}.json`;

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (typeof window.showMessage === 'function') {
            window.showMessage(`✅ Exported ${suites.length} test suites!\n\nFile: ${filename}`, 'success');
        }

    } catch (error) {
        if (typeof window.showMessage === 'function') {
            window.showMessage('❌ Export failed: ' + error.message, 'error');
        }
    }
}

function handleImportFile(input) {
    const file = input.files[0];
    if (!file) return;

    const preview = document.getElementById('import-file-preview');
    const fileName = document.getElementById('import-file-name');
    if (preview && fileName) {
        fileName.textContent = `${file.name} (${(file.size / 1024).toFixed(2)} KB)`;
        preview.classList.remove('hidden');
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const result = window.collaborationManager.importFromTeamExport(e.target.result);

            window.testSuites.push(result.suite);
            if (typeof saveTestSuites === 'function') saveTestSuites();
            if (typeof renderSuites === 'function') renderSuites();

            if (typeof window.showMessage === 'function') {
                window.showMessage(
                    `✅ Successfully imported: ${result.suite.name}\n\nExported by: ${result.metadata.exportedBy || 'Unknown'}`,
                    'success'
                );
            }

            closeCollaborationModal();

            input.value = '';
            if (preview) preview.classList.add('hidden');

        } catch (error) {
            if (typeof window.showMessage === 'function') {
                window.showMessage('❌ Import failed: ' + error.message, 'error');
            }
        }
    };

    reader.onerror = function () {
        if (typeof window.showMessage === 'function') {
            window.showMessage('❌ Failed to read file', 'error');
        }
    };

    reader.readAsText(file);
}

// Import remaining functions in next file due to size...

// Export for global access
window.openCollaborationModal = openCollaborationModal;
window.closeCollaborationModal = closeCollaborationModal;
window.switchCollabTab = switchCollabTab;
window.changeUsername = changeUsername;
window.openSharingBackendConfig = openSharingBackendConfig;
window.closeSharingBackendConfig = closeSharingBackendConfig;
window.saveSharingBackendConfig = saveSharingBackendConfig;
window.testSharingBackendConnection = testSharingBackendConnection;
window.clearSharingBackendConfig = clearSharingBackendConfig;
window.toggleSharingApiKeyVisibility = toggleSharingApiKeyVisibility;
window.exportTestSuiteAsFile = exportTestSuiteAsFile;
window.exportAllSuites = exportAllSuites;
window.handleImportFile = handleImportFile;

console.log('✅ Collaboration UI functions (Part 1) loaded');
