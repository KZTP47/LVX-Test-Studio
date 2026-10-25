/**
 * Environment Manager
 * Handles multiple environments (dev, staging, prod) with different configurations
 */

class EnvironmentManager {
  constructor() {
    this.STORAGE_KEY = 'test_environments';
    this.ACTIVE_ENV_KEY = 'active_environment';
  }

  // Save an environment
  _mutateEnvironments(mutate){
    const commit=async()=>{const values=this.getAllEnvironments(),result=mutate(values);const safe=await window.LVXCredentials.protect(values,'Environment variables');localStorage.setItem(this.STORAGE_KEY,JSON.stringify(safe));return result;};
    if(window.LVXCredentials){const pending=(this._credentialWrites||Promise.resolve()).then(commit);this._credentialWrites=pending.catch(()=>{});return pending;}
    const values=this.getAllEnvironments(),result=mutate(values);localStorage.setItem(this.STORAGE_KEY,JSON.stringify(values));return result;
  }

  saveEnvironment(env) {
    env.id = env.id || this._generateId();
    env.created = env.created || new Date().toISOString();
    env.modified = new Date().toISOString();

    return this._mutateEnvironments(environments=>{const index=environments.findIndex(e=>e.id===env.id);if(index>=0)environments[index]=env;else environments.push(env);return env.id;});
  }

  // Get all environments
  getAllEnvironments() {
    const data = localStorage.getItem(this.STORAGE_KEY);
    const envs = data ? JSON.parse(data) : [];

    // Ensure at least one default environment exists
    if (envs.length === 0) {
      const defaultEnv = this._createDefaultEnvironment();
      envs.push(defaultEnv);
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(envs));
    }

    return envs;
  }

  // Get environment by ID
  getEnvironment(id) {
    return this.getAllEnvironments().find(e => e.id === id);
  }

  // Delete environment
  deleteEnvironment(id) {
    const saved = this._mutateEnvironments(environments => {
      const index = environments.findIndex(env => env.id === id);
      if (index >= 0) environments.splice(index, 1);
      return environments[0]?.id || null;
    });
    const finish = nextId => {
      if (localStorage.getItem(this.ACTIVE_ENV_KEY) === id) {
        if (nextId) this.setActiveEnvironment(nextId);
        else localStorage.removeItem(this.ACTIVE_ENV_KEY);
      }
      return true;
    };
    return saved && typeof saved.then === 'function' ? saved.then(finish) : finish(saved);
  }

  // Get active environment ID
  getActiveEnvironmentId() {
    return localStorage.getItem(this.ACTIVE_ENV_KEY) || this.getAllEnvironments()[0]?.id;
  }

  // Set active environment
  setActiveEnvironment(id) {
    localStorage.setItem(this.ACTIVE_ENV_KEY, id);
    this._notifyEnvironmentChange(id);
  }

  // Get active environment
  getActiveEnvironment() {
    const id = this.getActiveEnvironmentId();
    return this.getEnvironment(id) || this.getAllEnvironments()[0];
  }

  // Replace environment variables in text
  getExecutionParameters(environmentId=null){
    const env=environmentId?this.getEnvironment(environmentId):this.getActiveEnvironment();
    const parameters={},parameterSchema={};
    for(const [key,entry]of Object.entries(env?.variables||{})){
      const value=entry&&typeof entry==='object'&&'value'in entry?entry.value:entry;
      const secret=!!(entry&&typeof entry==='object'&&(entry.secret||entry.isSecret))||/^(?:api[_-]?(?:key|token)|password|passwd|token|secret|auth(?:orization|Header)?|access[_-]?token|client[_-]?secret)$/i.test(key)||!!window.LVXCredentials?.isReference(value);
      if(secret){if(!window.LVXCredentials?.isReference(value))throw new Error(`Save environment credential ${key} securely before running.`);parameters[key]={secretRef:value};parameterSchema[key]={secret:true,required:true};}
      else {parameters[key]=value;parameterSchema[key]={type:value===null?'any':Array.isArray(value)?'array':typeof value};}
    }
    return {parameters,parameterSchema};
  }

  replaceEnvironmentVariables(text, environmentId = null) {
    if (!text) return text;

    const env = environmentId ? this.getEnvironment(environmentId) : this.getActiveEnvironment();
    if (!env || !env.variables) return text;

    let result = text;
    Object.entries(env.variables).forEach(([key, value]) => {
      const actual=value&&typeof value==='object'&&'value' in value?value.value:value;
      if(result.includes('${env.'+key+'}')&&(window.LVXCredentials?.isReference(actual)||value&&typeof value==='object'&&(value.secret||value.isSecret)||/^(?:api[_-]?(?:key|token)|password|passwd|token|secret|auth(?:orization|Header)?)$/i.test(key)))throw new Error(`Secret environment variable ${key} cannot be inserted into source. Use the credential parameter parameters.${key} (Python: parameters['${key}']).`);
      result = result.split('${env.' + key + '}').join(String(actual ?? ''));
    });

    return result;
  }

  // Create default environment
  _createDefaultEnvironment() {
    return {
      id: this._generateId(),
      name: 'Development',
      description: 'Local development environment',
      variables: {
        BASE_URL: 'http://localhost:3000',
        API_URL: 'http://localhost:3000/api',
        TIMEOUT: '5000'
      },
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };
  }

  // Notify listeners of environment change
  _notifyEnvironmentChange(envId) {
    window.dispatchEvent(new CustomEvent('environmentChanged', { detail: { envId } }));
  }

  _generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}

// Export
window.EnvironmentManager = EnvironmentManager;
window.environmentManager = new EnvironmentManager();

// ============================================
// UI Logic
// ============================================

// UI state
let selectedEnvironmentId = null;
let editingEnvironmentId = null;
let environmentVariables = [];
function escapeEnvironmentValue(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}

// Initialize environment display
function initializeEnvironmentDisplay() {
  const activeEnv = window.environmentManager.getActiveEnvironment();
  updateEnvironmentDisplay(activeEnv);
}

function updateEnvironmentDisplay(env) {
  const display = document.getElementById('current-env-display');
  if (display && env) {
    display.textContent = env.name;
  }
}

// Open/Close Environment Manager
function openEnvironmentManager() {
  renderEnvironmentsList();
  document.getElementById('environment-manager-modal').classList.remove('hidden');
}

function closeEnvironmentManager() {
  document.getElementById('environment-manager-modal').classList.add('hidden');
}

// Render environments list
function renderEnvironmentsList() {
  const container = document.getElementById('environments-list');
  const environments = window.environmentManager.getAllEnvironments();
  const activeId = window.environmentManager.getActiveEnvironmentId();

  container.innerHTML = environments.map(env => {
    const isActive = env.id === activeId;
    const isSelected = env.id === selectedEnvironmentId;

    return `
      <div class='${isSelected ? "aero-button-primary" : "aero-button"} p-3 rounded-lg cursor-pointer relative'
        onclick='selectEnvironmentForView("${env.id}")'>
        ${isActive ? `<span class="absolute top-1 right-1 text-green-500 text-xs">${window.LVXIcons?.svg('check','Active environment')||'Active'}</span>` : ''}
        <div class='font-semibold text-sm'>${env.name}</div>
        <div class='text-xs aero-text-muted'>${Object.keys(env.variables || {}).length} variables</div>
        ${isActive ? '<div class="text-xs text-green-600 font-semibold mt-1">ACTIVE</div>' : ''}
      </div>
    `;
  }).join('');
}

// Select environment for viewing
function selectEnvironmentForView(envId) {
  selectedEnvironmentId = envId;
  const env = window.environmentManager.getEnvironment(envId);

  if (!env) return;

  const activeId = window.environmentManager.getActiveEnvironmentId();
  const isActive = env.id === activeId;
  const environments = window.environmentManager.getAllEnvironments();

  const container = document.getElementById('environment-details');
  container.innerHTML = `
    <div class='mb-4'>
      <div class='flex justify-between items-center'>
        <h3 class='text-lg font-bold aero-text-primary'>${env.name}</h3>
        <div class='flex gap-2'>
          ${!isActive ? `
            <button onclick='setActiveEnvironment("${env.id}")'
              class='aero-button-success text-sm py-1 px-3 rounded'>
               Set Active
            </button>
          ` : '<span class="aero-badge-success">ACTIVE</span>'}
          <button onclick='editEnvironment("${env.id}")'
            class='aero-button-warning text-sm py-1 px-3 rounded'>
            ${window.LVXIcons?.svg("edit") || ''} Edit
          </button>
          <button onclick='duplicateEnvironment("${env.id}")'
            class='aero-button-info text-sm py-1 px-3 rounded'>
            ${window.LVXIcons?.svg("file") || ''} Duplicate
          </button>
          ${environments.length > 1 ? `
            <button onclick='deleteEnvironmentWithConfirm("${env.id}")'
              class='aero-button-danger text-sm py-1 px-3 rounded'>
              ${window.LVXIcons?.svg("trash") || ''} Delete
            </button>
          ` : ''}
        </div>
      </div>
      <p class='text-sm aero-text-muted mt-1'>${env.description || 'No description'}</p>
      <p class='text-xs aero-text-muted mt-1'>
        Created: ${new Date(env.created).toLocaleString()} |
        Modified: ${new Date(env.modified).toLocaleString()}
      </p>
    </div>

    <div class='mb-4'>
      <h4 class='font-semibold aero-text-secondary mb-2'>Environment Variables (${Object.keys(env.variables).length})</h4>
      <div class='aero-input p-3 rounded-lg space-y-2'>
        ${Object.entries(env.variables).map(([key, value]) => `
          <div class='flex justify-between items-center p-2 aero-glass-panel rounded'>
            <div class='flex-1'>
              <div class='font-mono text-sm font-semibold'>\${env.${key}}</div>
              <div class='text-xs aero-text-muted break-all'>${escapeEnvironmentValue(value && typeof value === 'object' && (value.secret || value.isSecret) || window.LVXCredentials?.isReference(value) ? 'Stored securely — use parameters.' + key : value)}</div>
            </div>
            <button onclick='copyToClipboard("\${env.${key}}")'
              class='aero-button text-xs py-1 px-2 rounded ml-2' title='Copy variable syntax'>
              ${window.LVXIcons?.svg("file") || ''}
            </button>
          </div>
        `).join('')}
      </div>
    </div>

    <div class='aero-glass-panel p-3 rounded-lg'>
      <h4 class='font-semibold aero-text-secondary mb-2'>Usage Example</h4>
      <div class='aero-input p-2 rounded font-mono text-xs'>
        <div class='mb-2'># Python</div>
        <div>driver.get("\${env.BASE_URL}")</div>
        <div class='mt-2'># Robot Framework</div>
        <div>Go To    \${env.BASE_URL}</div>
      </div>
    </div>
  `;

  renderEnvironmentsList(); // Refresh to show selection
}

// Set active environment
function setActiveEnvironment(envId) {
  window.environmentManager.setActiveEnvironment(envId);
  const env = window.environmentManager.getEnvironment(envId);
  updateEnvironmentDisplay(env);
  renderEnvironmentsList();
  selectEnvironmentForView(envId);
  if (window.showMessage) window.showMessage(`Active environment: ${env.name}`, 'success');
}

// Delete environment
async function deleteEnvironmentWithConfirm(envId) {
  const env = window.environmentManager.getEnvironment(envId);
  if (!env) return;

  if (confirm(`Delete environment "${env.name}"?\n\nTests using environment variables from this environment may fail.`)) {
    await window.environmentManager.deleteEnvironment(envId);
    selectedEnvironmentId = null;
    renderEnvironmentsList();
    document.getElementById('environment-details').innerHTML = '<p class="aero-text-muted">Select an environment to view details</p>';
    if (window.showMessage) window.showMessage('Environment deleted', 'success');
  }
}

// Duplicate environment
async function duplicateEnvironment(envId) {
  const env = window.environmentManager.getEnvironment(envId);
  if (!env) return;

  const newEnv = {
    name: env.name + ' (Copy)',
    description: env.description,
    variables: { ...env.variables }
  };

  const newId = await window.environmentManager.saveEnvironment(newEnv);
  renderEnvironmentsList();
  selectEnvironmentForView(newId);
  if (window.showMessage) window.showMessage('Environment duplicated', 'success');
}

// Copy to clipboard
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    if (window.showMessage) window.showMessage('Copied to clipboard', 'success');
  }).catch(() => {
    if (window.showMessage) window.showMessage('Failed to copy', 'error');
  });
}

// ============================================
// Create/Edit Logic
// ============================================

// Open create environment modal
function openCreateEnvironmentModal() {
  editingEnvironmentId = null;
  document.getElementById('env-modal-title').textContent = 'Create Environment';
  document.getElementById('env-name').value = '';
  document.getElementById('env-description').value = '';

  // Set default variables
  environmentVariables = [
    { key: 'BASE_URL', value: 'https://example.com' },
    { key: 'API_URL', value: 'https://api.example.com' }
  ];

  renderEnvironmentVariables();
  document.getElementById('create-environment-modal').classList.remove('hidden');
}

function closeCreateEnvironmentModal() {
  document.getElementById('create-environment-modal').classList.add('hidden');
}

// Edit environment
function editEnvironment(envId) {
  const env = window.environmentManager.getEnvironment(envId);
  if (!env) return;

  editingEnvironmentId = envId;
  document.getElementById('env-modal-title').textContent = 'Edit Environment';
  document.getElementById('env-name').value = env.name;
  document.getElementById('env-description').value = env.description || '';

  // Load variables
  environmentVariables = Object.entries(env.variables).map(([key,value])=>({key,value:value&&typeof value==='object'&&'value' in value?value.value:value,secret:!!(value&&typeof value==='object'&&value.secret)||!!window.LVXCredentials?.isReference(value)}));

  renderEnvironmentVariables();
  document.getElementById('create-environment-modal').classList.remove('hidden');
}

// Render environment variables in form
function renderEnvironmentVariables() {
  const container = document.getElementById('env-variables-list');

  if (environmentVariables.length === 0) {
    container.innerHTML = '<p class="text-sm aero-text-muted">No variables yet. Click "+ Add Variable" to add one.</p>';
    return;
  }

  container.innerHTML = environmentVariables.map((variable, index) => `
    <div class='flex gap-2 items-center'>
      <input type='text'
        value='${escapeEnvironmentValue(variable.key)}'
        onchange='updateVariableKey(${index}, this.value)'
        class='flex-1 aero-input p-2 rounded-lg font-mono text-sm'
        placeholder='VARIABLE_NAME'>
      <input type='${variable.secret?'password':'text'}'
        value='${escapeEnvironmentValue(variable.value)}'
        onchange='updateVariableValue(${index}, this.value)'
        class='flex-1 aero-input p-2 rounded-lg text-sm'
        placeholder='value'>
      <label class='text-xs whitespace-nowrap'><input type='checkbox' ${variable.secret?'checked':''} onchange='updateVariableSecret(${index},this.checked)'> Secret</label>
      <button type='button' onclick='removeEnvironmentVariable(${index})'
        class='aero-button-danger py-2 px-3 rounded text-sm'>
        ×
      </button>
    </div>
  `).join('');
}

// Add environment variable
function addEnvironmentVariable() {
  environmentVariables.push({ key: '', value: '' });
  renderEnvironmentVariables();
}

// Remove environment variable
function removeEnvironmentVariable(index) {
  environmentVariables.splice(index, 1);
  renderEnvironmentVariables();
}

// Update variable key
function updateVariableKey(index, key) {
  environmentVariables[index].key = key.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  renderEnvironmentVariables();
}

// Update variable value
function updateVariableValue(index, value) {
  environmentVariables[index].value = value;
}
function updateVariableSecret(index,secret){environmentVariables[index].secret=secret;renderEnvironmentVariables();}

// Save environment
async function saveEnvironment(event) {
  event.preventDefault();

  const name = document.getElementById('env-name').value.trim();
  const description = document.getElementById('env-description').value.trim();

  if (!name) {
    if (window.showMessage) window.showMessage('Please enter a name', 'warning');
    return;
  }

  // Convert variables array to object
  const variables = {};
  environmentVariables.forEach(v => {
    if (v.key && v.key.trim()) {
      variables[v.key.trim()] = v.secret?{value:v.value,secret:true}:v.value;
    }
  });

  const env = {
    name,
    description,
    variables
  };

  if (editingEnvironmentId) {
    env.id = editingEnvironmentId;
    env.created = window.environmentManager.getEnvironment(editingEnvironmentId).created;
  }

  const envId = await window.environmentManager.saveEnvironment(env);
  if (window.showMessage) window.showMessage(editingEnvironmentId ? 'Environment updated' : 'Environment created', 'success');

  closeCreateEnvironmentModal();
  renderEnvironmentsList();
  selectEnvironmentForView(envId);
}

// Export functions
window.openEnvironmentManager = openEnvironmentManager;
window.closeEnvironmentManager = closeEnvironmentManager;
window.selectEnvironmentForView = selectEnvironmentForView;
window.setActiveEnvironment = setActiveEnvironment;
window.deleteEnvironmentWithConfirm = deleteEnvironmentWithConfirm;
window.duplicateEnvironment = duplicateEnvironment;
window.copyToClipboard = copyToClipboard;
window.initializeEnvironmentDisplay = initializeEnvironmentDisplay;
window.openCreateEnvironmentModal = openCreateEnvironmentModal;
window.closeCreateEnvironmentModal = closeCreateEnvironmentModal;
window.editEnvironment = editEnvironment;
window.addEnvironmentVariable = addEnvironmentVariable;
window.removeEnvironmentVariable = removeEnvironmentVariable;
window.updateVariableKey = updateVariableKey;
window.updateVariableValue = updateVariableValue;
window.updateVariableSecret = updateVariableSecret;
window.saveEnvironment = saveEnvironment;
window.updateEnvironmentDisplay = updateEnvironmentDisplay;
