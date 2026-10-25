/**
 * CI/CD Integration Manager
 * Manages backend configuration for CI/CD pipeline integration
 */

class CICDConfiguration {
  constructor() {
    this.STORAGE_KEY = 'cicd_backend_config';
  }

  _getStorageApi() {
    if (typeof window !== 'undefined' && window.secureConfig) {
      return window.secureConfig;
    }

    return {
      saveConfig: (storageKey, value) => {
        localStorage.setItem(storageKey, JSON.stringify(value));
        return true;
      },
      loadConfig: (storageKey, defaultValue = null) => {
        const raw = localStorage.getItem(storageKey);
        return raw ? JSON.parse(raw) : defaultValue;
      },
      clearConfig: (storageKey) => localStorage.removeItem(storageKey)
    };
  }

  // Save user's backend configuration
  saveBackendConfig(config) {
    const safeConfig = {
      backendUrl: config.backendUrl?.trim(),
      apiKey: config.apiKey?.trim(),
      enabled: config.enabled !== false,
      description: config.description || '',
      configured: new Date().toISOString()
    };

    // Validate URL format
    if (safeConfig.backendUrl && !this._isValidUrl(safeConfig.backendUrl)) {
      throw new Error('Invalid backend URL format');
    }

    this._getStorageApi().saveConfig(this.STORAGE_KEY, safeConfig);
    return true;
  }

  // Get backend configuration
  getBackendConfig() {
    return this._getStorageApi().loadConfig(this.STORAGE_KEY, null);
  }

  // Check if backend is configured
  isConfigured() {
    const config = this.getBackendConfig();
    return !!(config && config.backendUrl && config.apiKey && config.enabled);
  }

  // Clear configuration
  clearBackendConfig() {
    this._getStorageApi().clearConfig(this.STORAGE_KEY);
  }

  // Toggle enabled/disabled
  toggleEnabled() {
    const config = this.getBackendConfig();
    if (!config) return false;

    config.enabled = !config.enabled;
    this._getStorageApi().saveConfig(this.STORAGE_KEY, config);
    return config.enabled;
  }

  // Test connection to user's backend
  async testConnection() {
    const config = this.getBackendConfig();
    if (!config || !config.backendUrl || !config.apiKey) {
      throw new Error('Backend not configured. Please enter your backend URL and API key.');
    }

    try {
      const response = await fetch(`${config.backendUrl}/health`, {
        method: 'GET',
        headers: {
          'X-API-Key': config.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });

      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        success: true,
        message: 'Connected successfully!',
        backendInfo: data
      };
    } catch (error) {
      if (error.name === 'TypeError') {
        throw new Error('Cannot connect to backend. Check URL and CORS settings.');
      }
      throw new Error(`Connection failed: ${error.message}`);
    }
  }

  // Execute tests via user's backend
  async executeTests(suiteIds = []) {
    const config = this.getBackendConfig();
    if (!config || !config.enabled) {
      throw new Error('Backend not configured or disabled');
    }

    try {
      const response = await fetch(`${config.backendUrl}/tests/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.apiKey
        },
        body: JSON.stringify({
          suiteIds,
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || `Request failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Test execution via backend failed:', error);
      throw error;
    }
  }

  // Get test status from backend
  async getTestStatus() {
    const config = this.getBackendConfig();
    if (!config || !config.enabled) {
      throw new Error('Backend not configured or disabled');
    }

    try {
      const response = await fetch(`${config.backendUrl}/tests/status`, {
        method: 'GET',
        headers: {
          'X-API-Key': config.apiKey
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to get status: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to get test status:', error);
      throw error;
    }
  }

  // Sync test suite to backend
  async syncTestSuite(suite) {
    const config = this.getBackendConfig();
    if (!config || !config.enabled) {
      throw new Error('Backend not configured');
    }

    try {
      const response = await fetch(`${config.backendUrl}/suites/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.apiKey
        },
        body: JSON.stringify(suite)
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Suite sync failed:', error);
      throw error;
    }
  }

  // Validate URL format
  _isValidUrl(url) {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch (e) {
      return false;
    }
  }

  // Generate workflow files (templates for user's CI/CD)
  generateGitHubActionsWorkflow(suiteIds = []) {
    const config = this.getBackendConfig();
    const backendUrl = config?.backendUrl || 'YOUR_BACKEND_URL';

    return `name: LVX-Machina Automated Tests

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]
  schedule:
    # Run daily at 2 AM UTC
    - cron: '0 2 * * *'
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
    - name: Checkout code
      uses: actions/checkout@v4
    
    - name: Run LVX-Machina Tests
      env:
        LVX_API_KEY: \${{ secrets.LVX_API_KEY }}
        LVX_BACKEND_URL: ${backendUrl}
      run: |
        echo "🤖 Running automated tests via LVX-Machina backend..."
        
        response=\$(curl -s -w "\\n%{http_code}" \\
          -X POST \\
          -H "Content-Type: application/json" \\
          -H "X-API-Key: \$LVX_API_KEY" \\
          -d '{"suiteIds": ${JSON.stringify(suiteIds)}}' \\
          "\$LVX_BACKEND_URL/tests/execute")
        
        http_code=\$(echo "\$response" | tail -n1)
        body=\$(echo "\$response" | sed '\$d')
        
        echo "\$body"
        
        if [ "\$http_code" -ne 200 ]; then
          echo "❌ Tests failed with HTTP \$http_code"
          exit 1
        fi
        
        # Check if tests passed
        if echo "\$body" | grep -q '"passed":0'; then
          echo "❌ All tests failed"
          exit 1
        fi
        
        echo "✅ Tests completed successfully"
    
    - name: Upload test results
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: test-results
        path: test-results/
        retention-days: 30
`;
  }

  generateGitLabCI(suiteIds = []) {
    const config = this.getBackendConfig();
    const backendUrl = config?.backendUrl || 'YOUR_BACKEND_URL';

    return `stages:
  - test

variables:
  BACKEND_URL: "${backendUrl}"

lvx_machina_tests:
  stage: test
  image: curlimages/curl:latest
  script:
    - echo "🤖 Running LVX-Machina tests..."
    - |
      response=\$(curl -s -w "\\n%{http_code}" \\
        -X POST \\
        -H "Content-Type: application/json" \\
        -H "X-API-Key: \$LVX_API_KEY" \\
        -d '{"suiteIds": ${JSON.stringify(suiteIds)}}' \\
        "\$BACKEND_URL/tests/execute")
      
      http_code=\$(echo "\$response" | tail -n1)
      body=\$(echo "\$response" | sed '\$d')
      
      echo "\$body"
      
      if [ "\$http_code" -ne 200 ]; then
        echo "❌ Tests failed"
        exit 1
      fi
      
      echo "✅ Tests completed"
  only:
    - main
    - develop
  artifacts:
    reports:
      junit: test-results/*.xml
    expire_in: 30 days
`;
  }

  generateJenkinsPipeline(suiteIds = []) {
    const config = this.getBackendConfig();
    const backendUrl = config?.backendUrl || 'YOUR_BACKEND_URL';

    return `pipeline {
    agent any
    
    environment {
        LVX_API_KEY = credentials('lvx-api-key')
        BACKEND_URL = '${backendUrl}'
    }
    
    stages {
        stage('Run Tests') {
            steps {
                script {
                    echo '🤖 Running LVX-Machina tests...'
                    
                    def response = sh(
                        script: """
                            curl -s -w "\\n%{http_code}" \\
                              -X POST \\
                              -H "Content-Type: application/json" \\
                              -H "X-API-Key: \${LVX_API_KEY}" \\
                              -d '{"suiteIds": ${JSON.stringify(suiteIds)}}' \\
                              "\${BACKEND_URL}/tests/execute"
                        """,
                        returnStdout: true
                    ).trim()
                    
                    def lines = response.split('\\n')
                    def httpCode = lines[-1]
                    def body = lines[0..-2].join('\\n')
                    
                    echo body
                    
                    if (httpCode != '200') {
                        error "Tests failed with HTTP \${httpCode}"
                    }
                    
                    echo '✅ Tests completed successfully'
                }
            }
        }
    }
    
    post {
        always {
            archiveArtifacts artifacts: 'test-results/**/*', allowEmptyArchive: true
        }
        failure {
            echo '❌ Test execution failed'
        }
        success {
            echo '✅ All tests passed'
        }
    }
}
`;
  }
}

// Export
window.CICDConfiguration = CICDConfiguration;
window.cicdConfiguration = new CICDConfiguration();

// =============================================================================
// UI HELPER FUNCTIONS
// =============================================================================

// Open/Close modal
function openCICDModal() {
  loadBackendConfigToUI();
  updateCICDStatus();
  populateSuiteSelectors();
  updateWorkflowYAML();
  document.getElementById('cicd-modal').classList.remove('hidden');
}

function closeCICDModal() {
  document.getElementById('cicd-modal').classList.add('hidden');
}

// Load backend config to UI
function loadBackendConfigToUI() {
  const config = window.cicdConfiguration.getBackendConfig();

  if (config) {
    document.getElementById('cicd-backend-url').value = config.backendUrl || '';
    document.getElementById('cicd-api-key').value = config.apiKey || '';
    document.getElementById('cicd-description').value = config.description || '';
  } else {
    document.getElementById('cicd-backend-url').value = '';
    document.getElementById('cicd-api-key').value = '';
    document.getElementById('cicd-description').value = '';
  }
}

// Update CI/CD status display
function updateCICDStatus() {
  const isConfigured = window.cicdConfiguration.isConfigured();
  const statusBadge = document.getElementById('cicd-status-badge');
  const statusText = document.getElementById('cicd-status-text');
  const headerIndicator = document.getElementById('cicd-status-indicator');

  if (statusBadge && statusText) {
    if (isConfigured) {
      const config = window.cicdConfiguration.getBackendConfig();
      statusBadge.className = 'aero-badge-success';
      statusBadge.textContent = 'Configured';
      statusText.textContent = `Connected to: ${config.backendUrl}`;
      if (headerIndicator) headerIndicator.textContent = 'CI/CD ✓';
    } else {
      statusBadge.className = 'aero-badge-error';
      statusBadge.textContent = 'Not Configured';
      statusText.textContent = 'No backend configured yet';
      if (headerIndicator) headerIndicator.textContent = 'CI/CD';
    }
  }
}

// Tab switching
function switchCICDTab(tab) {
  const tabs = ['configuration', 'github-actions', 'gitlab-ci', 'jenkins', 'backend-docs'];
  tabs.forEach(t => {
    const tabBtn = document.getElementById(`cicd-tab-${t}`);
    const panel = document.getElementById(`cicd-panel-${t}`);
    if (tabBtn && panel) {
      if (t === tab) {
        tabBtn.className = 'py-2 px-4 font-semibold aero-text-primary border-b-2 border-blue-500';
        panel.classList.remove('hidden');
      } else {
        tabBtn.className = 'py-2 px-4 font-semibold aero-text-muted';
        panel.classList.add('hidden');
      }
    }
  });
}

// Save configuration
function saveBackendConfig(event) {
  if (event) event.preventDefault();

  const backendUrl = document.getElementById('cicd-backend-url').value.trim();
  const apiKey = document.getElementById('cicd-api-key').value.trim();
  const description = document.getElementById('cicd-description').value.trim();

  if (!backendUrl || !apiKey) {
    if (window.showMessage) {
      window.showMessage('Please enter both backend URL and API key', 'warning');
    } else {
      alert('Please enter both backend URL and API key');
    }
    return;
  }

  try {
    window.cicdConfiguration.saveBackendConfig({
      backendUrl,
      apiKey,
      description,
      enabled: true
    });

    if (window.showMessage) {
      window.showMessage('Backend configuration saved successfully!', 'success');
    } else {
      alert('Backend configuration saved successfully!');
    }
    updateCICDStatus();
    updateWorkflowYAML();
  } catch (error) {
    if (window.showMessage) {
      window.showMessage('Failed to save: ' + error.message, 'error');
    } else {
      alert('Failed to save: ' + error.message);
    }
  }
}

// Test connection
async function testBackendConnection() {
  const spinner = document.getElementById('test-spinner');
  if (spinner) spinner.classList.remove('hidden');

  // Save current values temporarily
  const backendUrl = document.getElementById('cicd-backend-url').value.trim();
  const apiKey = document.getElementById('cicd-api-key').value.trim();

  if (!backendUrl || !apiKey) {
    if (window.showMessage) {
      window.showMessage('Please enter backend URL and API key first', 'warning');
    } else {
      alert('Please enter backend URL and API key first');
    }
    if (spinner) spinner.classList.add('hidden');
    return;
  }

  const originalConfig = window.cicdConfiguration.getBackendConfig();

  try {
    // Temporarily save for testing
    window.cicdConfiguration.saveBackendConfig({
      backendUrl,
      apiKey,
      enabled: true
    });

    if (window.showMessage) {
      window.showMessage('Testing connection...', 'info');
    }

    const result = await window.cicdConfiguration.testConnection();

    if (result.success) {
      const message = `✅ ${result.message}\n\nBackend: ${result.backendInfo?.name || 'Connected'}`;
      if (window.showMessage) {
        window.showMessage(message, 'success');
      } else {
        alert(message);
      }
      updateCICDStatus();
    }
  } catch (error) {
    const message = '❌ Connection failed: ' + error.message;
    if (window.showMessage) {
      window.showMessage(message, 'error');
    } else {
      alert(message);
    }

    // Restore original config if test failed
    if (originalConfig) {
      window.cicdConfiguration.saveBackendConfig(originalConfig);
    } else {
      window.cicdConfiguration.clearBackendConfig();
    }
  } finally {
    if (spinner) spinner.classList.add('hidden');
  }
}

// Clear configuration  
function clearBackendConfig() {
  if (confirm('Clear backend configuration?\n\nYou will need to reconfigure to use CI/CD features.')) {
    window.cicdConfiguration.clearBackendConfig();
    loadBackendConfigToUI();
    updateCICDStatus();
    if (window.showMessage) {
      window.showMessage('Configuration cleared', 'info');
    } else {
      alert('Configuration cleared');
    }
  }
}

// Toggle API key visibility
function toggleApiKeyVisibility() {
  const input = document.getElementById('cicd-api-key');
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
}

// Populate suite selectors
function populateSuiteSelectors() {
  const suites = window.testSuites || [];
  const selector = document.getElementById('github-suite-selector');

  if (selector) {
    selector.innerHTML = suites.map(suite =>
      `<option value='${suite.id}'>${suite.name}</option>`
    ).join('');
  }
}

// Update workflow YAML
function updateWorkflowYAML() {
  const selector = document.getElementById('github-suite-selector');
  const selectedSuites = selector ? Array.from(selector.selectedOptions).map(o => o.value) : [];

  // Update GitHub Actions
  const githubYaml = window.cicdConfiguration.generateGitHubActionsWorkflow(selectedSuites);
  const githubTextarea = document.getElementById('github-workflow-yaml');
  if (githubTextarea) githubTextarea.value = githubYaml;

  // Update GitLab CI
  const gitlabYaml = window.cicdConfiguration.generateGitLabCI(selectedSuites);
  const gitlabTextarea = document.getElementById('gitlab-ci-yaml');
  if (gitlabTextarea) gitlabTextarea.value = gitlabYaml;

  // Update Jenkins
  const jenkinsPipeline = window.cicdConfiguration.generateJenkinsPipeline(selectedSuites);
  const jenkinsTextarea = document.getElementById('jenkins-pipeline');
  if (jenkinsTextarea) jenkinsTextarea.value = jenkinsPipeline;
}

// Copy workflows
function copyGitHubWorkflow() {
  const textarea = document.getElementById('github-workflow-yaml');
  if (textarea) {
    textarea.select();
    document.execCommand('copy');
    if (window.showMessage) {
      window.showMessage('GitHub Actions workflow copied to clipboard!', 'success');
    } else {
      alert('Copied to clipboard!');
    }
  }
}

function copyGitLabCI() {
  const textarea = document.getElementById('gitlab-ci-yaml');
  if (textarea) {
    textarea.select();
    document.execCommand('copy');
    if (window.showMessage) {
      window.showMessage('GitLab CI configuration copied to clipboard!', 'success');
    } else {
      alert('Copied to clipboard!');
    }
  }
}

function copyJenkinsPipeline() {
  const textarea = document.getElementById('jenkins-pipeline');
  if (textarea) {
    textarea.select();
    document.execCommand('copy');
    if (window.showMessage) {
      window.showMessage('Jenkins pipeline copied to clipboard!', 'success');
    } else {
      alert('Copied to clipboard!');
    }
  }
}

// Export all functions to window
window.openCICDModal = openCICDModal;
window.closeCICDModal = closeCICDModal;
window.switchCICDTab = switchCICDTab;
window.saveBackendConfig = saveBackendConfig;
window.testBackendConnection = testBackendConnection;
window.clearBackendConfig = clearBackendConfig;
window.toggleApiKeyVisibility = toggleApiKeyVisibility;
window.updateWorkflowYAML = updateWorkflowYAML;
window.copyGitHubWorkflow = copyGitHubWorkflow;
window.copyGitLabCI = copyGitLabCI;
window.copyJenkinsPipeline = copyJenkinsPipeline;

// Initialize status on page load
document.addEventListener('DOMContentLoaded', () => {
  updateCICDStatus();
});
