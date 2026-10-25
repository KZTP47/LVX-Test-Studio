/**
 * CI/CD Integration Manager
 * Manages backend configuration for CI/CD pipeline integration
 */

class CICDConfiguration {
  constructor() {
    this.STORAGE_KEY = 'cicd_backend_config';
  }

  // Save user's backend configuration
  _persistConfig(config,result=true){const persist=safe=>{localStorage.setItem(this.STORAGE_KEY,JSON.stringify(safe));return result;};if(!window.LVXCredentials)return persist(config);const pending=(this._credentialWrites||Promise.resolve()).then(()=>window.LVXCredentials.protect(config,'CI connection')).then(persist);this._credentialWrites=pending.catch(()=>{});return pending;}
  _request(url,options){return window.LVXCredentials?window.LVXCredentials.request(url,options):fetch(url,options);}

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

    return this._persistConfig(safeConfig);
  }

  // Get backend configuration
  getBackendConfig() {
    const data = localStorage.getItem(this.STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  }

  // Check if backend is configured
  isConfigured() {
    const config = this.getBackendConfig();
    return !!(config && config.backendUrl && config.apiKey && config.enabled);
  }

  // Clear configuration
  clearBackendConfig() {
    const clear = () => { localStorage.removeItem(this.STORAGE_KEY); return true; };
    if (!window.LVXCredentials) return clear();
    const pending = (this._credentialWrites || Promise.resolve()).then(clear);
    this._credentialWrites = pending.catch(() => {});
    return pending;
  }

  // Toggle enabled/disabled
  toggleEnabled() {
    const config = this.getBackendConfig();
    if (!config) return false;

    config.enabled = !config.enabled;
    return this._persistConfig(config,config.enabled);
  }

  // Test connection to user's backend
  async testConnection() {
    const config = this.getBackendConfig();
    if (!config || !config.backendUrl || !config.apiKey) {
      throw new Error('Backend not configured. Please enter your backend URL and API key.');
    }

    try {
      const response = await this._request(`${config.backendUrl}/health`, {
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
      const response = await this._request(`${config.backendUrl}/tests/execute`, {
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
      const response = await this._request(`${config.backendUrl}/tests/status`, {
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
      const response = await this._request(`${config.backendUrl}/suites/sync`, {
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

  // Execution response: terminal summary with nonnegative integer total/passed/failed/errors.
  // HTTP 202 or a pending response must be resolved by the backend before CI can pass.
  _ciResultCheck() {
    return 'import json,sys; d=json.load(sys.stdin); s=d.get("summary",d); keys=("total","passed","failed","errors"); valid=isinstance(s,dict) and all(type(s.get(k)) is int and s[k]>=0 for k in keys); valid=valid and s["total"]>0 and s["total"]==s["passed"]+s["failed"]+s["errors"] and s["failed"]==0 and s["errors"]==0; valid=valid and not d.get("error") and not d.get("errors") and str(d.get("status","SUCCESS")).upper() in ("SUCCESS","PASSED","COMPLETED"); outcomes=d.get("results",[]); outcomes=list(outcomes.values()) if isinstance(outcomes,dict) else outcomes; valid=valid and isinstance(outcomes,list) and all(isinstance(r,dict) and str(r.get("status","")).upper() in ("SUCCESS","PASSED","PASS") for r in outcomes); sys.exit(0 if valid else 1)';
  }

  // Templates execute the shipped authenticated CLI and independently validate its terminal JSON.
  generateGitHubActionsWorkflow(){return `name: LVX workflow checks
on: [push, pull_request, workflow_dispatch]
permissions:
  contents: read
jobs:
  tests:
    runs-on: windows-2022
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.18.0
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: npm ci
      - name: Run authenticated workflow
        shell: pwsh
        env:
          LVX_CI_TOKEN: \${{ secrets.LVX_CI_TOKEN }}
          LVX_CI_AUTH_TOKEN: \${{ secrets.LVX_CI_TOKEN }}
        run: |
          node services/execution/cli.cjs run --workspace . --workflow lvx-workflow.json --data-dir test-results > lvx-result.json
          if ($LASTEXITCODE -ne 0) { throw 'Workflow failed' }
          Get-Content lvx-result.json -Raw | python -c '${this._ciResultCheck()}'
          if ($LASTEXITCODE -ne 0) { throw 'Incomplete test evidence' }
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: lvx-evidence
          path: |
            test-results/**
            lvx-result.json
`;}
  generateGitLabCI(){return `stages: [test]
lvx_tests:
  stage: test
  image: node:22.18.0-bookworm
  before_script:
    - apt-get update && apt-get install -y --no-install-recommends python3
    - npm ci
  script:
    - export LVX_CI_AUTH_TOKEN="$LVX_CI_TOKEN"
    - node services/execution/cli.cjs run --workspace . --workflow lvx-workflow.json --data-dir test-results > lvx-result.json
    - cat lvx-result.json | python3 -c '${this._ciResultCheck()}'
  artifacts:
    when: always
    paths: [test-results/, lvx-result.json]
`;}
  generateJenkinsPipeline(){return `pipeline {
  agent { label 'windows' }
  environment {
    LVX_CI_TOKEN = credentials('lvx-ci-token')
    LVX_CI_AUTH_TOKEN = credentials('lvx-ci-token')
  }
  stages {
    stage('Install') { steps { bat 'npm ci' } }
    stage('Verify') {
      steps {
        bat 'node services/execution/cli.cjs run --workspace . --workflow lvx-workflow.json --data-dir test-results > lvx-result.json'
        writeFile file: 'lvx-check.py', text: '''${this._ciResultCheck()}'''
        bat 'python lvx-check.py < lvx-result.json'
      }
    }
  }
  post { always { archiveArtifacts artifacts: 'test-results/**,lvx-result.json', allowEmptyArchive: false } }
}
`;}
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
      if (headerIndicator) headerIndicator.textContent = 'CI/CD ';
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
async function saveBackendConfig(event) {
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
    await window.cicdConfiguration.saveBackendConfig({
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
    await window.cicdConfiguration.saveBackendConfig({
      backendUrl,
      apiKey,
      enabled: true
    });

    if (window.showMessage) {
      window.showMessage('Testing connection...', 'info');
    }

    const result = await window.cicdConfiguration.testConnection();

    if (result.success) {
      const message = ` ${result.message}\n\nBackend: ${result.backendInfo?.name || 'Connected'}`;
      if (window.showMessage) {
        window.showMessage(message, 'success');
      } else {
        alert(message);
      }
      updateCICDStatus();
    }
  } catch (error) {
    const message = ' Connection failed: ' + error.message;
    if (window.showMessage) {
      window.showMessage(message, 'error');
    } else {
      alert(message);
    }

    // Restore original config if test failed
    if (originalConfig) {
      await window.cicdConfiguration.saveBackendConfig(originalConfig);
    } else {
      await window.cicdConfiguration.clearBackendConfig();
    }
  } finally {
    if (spinner) spinner.classList.add('hidden');
  }
}

// Clear configuration
async function clearBackendConfig() {
  if (confirm('Clear backend configuration?\n\nYou will need to reconfigure to use CI/CD features.')) {
    await window.cicdConfiguration.clearBackendConfig();
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
