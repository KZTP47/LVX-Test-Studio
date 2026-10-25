// ============================================
// VERSION CONTROL SYSTEM
// ============================================

class VersionControl {
  constructor() {
    this.MAX_VERSIONS_PER_SUITE = 50;
    this.pending = Promise.resolve();
  }

  saveVersion(suiteId, suiteSnapshot, changeDescription = 'Auto-save') {
    const task = this.pending.then(() => this._saveVersion(suiteId, suiteSnapshot, changeDescription));
    this.pending = task.catch(() => {});
    return task;
  }

  async _saveVersion(suiteId, suiteSnapshot, changeDescription) {
    const backend = await this._backend();
    if (backend) return await backend.saveVersion(suiteId, suiteSnapshot, changeDescription);
    const versions = await this.getVersionHistory(suiteId);
    const newVersion = {
      versionId: this._generateId(),
      timestamp: new Date().toISOString(),
      suiteSnapshot: JSON.parse(JSON.stringify(suiteSnapshot)),
      changeDescription,
      changedBy: 'user'
    };

    if (versions.length > 0) {
      newVersion.diff = this._calculateDiff(
        versions[versions.length - 1].suiteSnapshot,
        suiteSnapshot
      );
    } else {
      newVersion.diff = { modified: [] };
    }

    versions.push(newVersion);

    if (versions.length > this.MAX_VERSIONS_PER_SUITE) {
      versions.shift();
    }

    localStorage.setItem(`suite_versions_${suiteId}`, JSON.stringify(versions));
    return newVersion.versionId;
  }

  async _backend() {
    if(window.currentStorage?.beginEdit && window.electronAPI?.studioOps) {
      const invoke=async(action,payload={})=>{
        const status=await window.electronAPI.studioOps.invoke('workspace','status');
        return window.electronAPI.studioOps.invoke('workspace',action,{...payload,workspaceRoot:status.workspaceRoot});
      };
      const records=async suiteId=>(await invoke('list',{collection:'versions'})).records.filter(record=>record.value.suiteId===suiteId);
      return {
        async saveVersion(suiteId,suiteSnapshot,changeDescription){
          const versionId=crypto.randomUUID();
          await invoke('transact',{records:[{collection:'versions',id:versionId,value:{suiteId,versionId,timestamp:new Date().toISOString(),suiteSnapshot:JSON.parse(JSON.stringify(suiteSnapshot)),changeDescription,changedBy:'local-user'},expectedRevision:null}]});
          return versionId;
        },
        async getVersionHistory(suiteId){return (await records(suiteId)).map(record=>record.value).sort((a,b)=>a.timestamp.localeCompare(b.timestamp));},
        async deleteVersionHistory(suiteId){const changes=(await records(suiteId)).map(record=>({collection:'versions',id:record.id,expectedRevision:record.revision,delete:true}));if(changes.length)await invoke('transact',{records:changes});}
      };
    }
    const backend = window.indexedDBVersionControl;
    if (backend?.ready) await backend.ready;
    return backend || null;
  }

  async getVersionHistory(suiteId) {
    const backend = await this._backend();
    if (backend) return await backend.getVersionHistory(suiteId);
    const data = localStorage.getItem(`suite_versions_${suiteId}`);
    return data ? JSON.parse(data) : [];
  }

  async restoreVersion(suiteId, versionId) {
    const versions = await this.getVersionHistory(suiteId);
    const version = versions.find(v => v.versionId === versionId);
    return version ? JSON.parse(JSON.stringify(version.suiteSnapshot)) : null;
  }

  _calculateDiff(oldSuite, newSuite) {
    const diff = { modified: [] };

    if (oldSuite.name !== newSuite.name) {
      diff.modified.push({ field: 'name', old: oldSuite.name, new: newSuite.name });
    }
    if (oldSuite.code !== newSuite.code) {
      diff.modified.push({ field: 'code', old: oldSuite.code, new: newSuite.code });
    }
    if (oldSuite.description !== newSuite.description) {
      diff.modified.push({ field: 'description', old: oldSuite.description, new: newSuite.description });
    }
    if (oldSuite.language !== newSuite.language) {
      diff.modified.push({ field: 'language', old: oldSuite.language, new: newSuite.language });
    }
    if (oldSuite.expected_output !== newSuite.expected_output) {
      diff.modified.push({ field: 'expected_output', old: oldSuite.expected_output, new: newSuite.expected_output });
    }

    return diff;
  }

  async deleteVersionHistory(suiteId) {
    await this.pending;
    const backend = await this._backend();
    if (backend) return await backend.deleteVersionHistory(suiteId);
    localStorage.removeItem(`suite_versions_${suiteId}`);
  }

  _generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}

window.VersionControl = VersionControl;
window.versionControl = new VersionControl();

let currentViewingSuiteId = null;
let selectedVersionId = null;
let comparisonVersionIds = [];
let isComparisonMode = false;

async function openVersionHistory(event, suiteId) {
  event?.stopPropagation();
  currentViewingSuiteId = suiteId;
  selectedVersionId = null;
  comparisonVersionIds = [];
  isComparisonMode = false;

  // Safely get suite name
  let suiteName = 'Unknown';
  if (window.testSuites && Array.isArray(window.testSuites)) {
    const suite = window.testSuites.find(s => s.id === suiteId);
    if (suite) {
      suiteName = suite.name;
    }
  }

  const nameElement = document.getElementById('version-history-suite-name');
  if (nameElement) {
    nameElement.textContent = suiteName;
  }

  const versions = await window.versionControl.getVersionHistory(suiteId);
  renderVersionsList(versions);

  const previewElement = document.getElementById('version-preview');
  if (previewElement) {
    previewElement.textContent = 'Select a version to preview';
  }

  const restoreBtn = document.getElementById('restore-btn');
  if (restoreBtn) {
    restoreBtn.disabled = true;
  }

  const compareBtn = document.getElementById('compare-btn');
  if (compareBtn) {
    compareBtn.disabled = false;
    compareBtn.textContent = 'Compare';
  }

  const modal = document.getElementById('version-history-modal');
  if (modal) {
    modal.classList.remove('hidden');
  }
}

function closeVersionHistory() {
  const modal = document.getElementById('version-history-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
  currentViewingSuiteId = null;
  selectedVersionId = null;
  comparisonVersionIds = [];
  isComparisonMode = false;
}

function renderVersionsList(versions) {
  const container = document.getElementById('versions-list');
  if (!container) return;

  if (versions.length === 0) {
    container.innerHTML = '<p class="aero-text-muted text-sm">No version history yet</p>';
    return;
  }

  const sorted = [...versions].reverse();

  container.innerHTML = sorted.map(version => {
    const date = new Date(version.timestamp);
    const isSelected = version.versionId === selectedVersionId;
    const isInComparison = comparisonVersionIds.includes(version.versionId);

    let buttonClass = 'aero-button';
    if (isSelected && comparisonVersionIds.length === 0) {
      buttonClass = 'aero-button-primary';
    } else if (isInComparison) {
      buttonClass = 'aero-button-info';
    }

    return `
      <div class='version-item ${buttonClass} p-3 rounded-lg cursor-pointer'
        onclick='selectVersion("${version.versionId}")'>
        <div class='font-semibold text-sm'>${date.toLocaleString()}</div>
        <div class='text-xs aero-text-muted'>${escapeHtml(version.changeDescription)}</div>
        ${version.diff?.modified?.length > 0 ?
          `<div class='text-xs mt-1 aero-badge-info inline-block'>${version.diff.modified.length} changes</div>`
          : ''}
      </div>
    `;
  }).join('');
}

async function selectVersion(versionId) {
  const versions = await window.versionControl.getVersionHistory(currentViewingSuiteId);

  if (isComparisonMode) {
    if (comparisonVersionIds.includes(versionId)) {
      comparisonVersionIds = comparisonVersionIds.filter(id => id !== versionId);
    } else if (comparisonVersionIds.length < 2) {
      comparisonVersionIds.push(versionId);
    } else {
      comparisonVersionIds = [comparisonVersionIds[1], versionId];
    }

    const compareBtn = document.getElementById('compare-btn');
    if (compareBtn) {
      compareBtn.disabled = false;
      compareBtn.textContent = 'Cancel Comparison';
    }

    if (comparisonVersionIds.length === 2) {
      compareVersions();
    } else {
      const preview = document.getElementById('version-preview');
      if (preview) {
        preview.innerHTML = `
          <div class='text-center aero-text-muted'>
            <p class='mb-2'>Comparison Mode Active</p>
            <p class='text-sm'>Selected ${comparisonVersionIds.length} of 2 versions</p>
            <p class='text-xs mt-2'>Click another version to compare</p>
          </div>
        `;
      }
    }

    renderVersionsList(versions);
    return;
  }

  selectedVersionId = versionId;
  const version = versions.find(v => v.versionId === versionId);

  if (version) {
    const preview = document.getElementById('version-preview');
    if (preview) {
      preview.innerHTML = `
        <div class='mb-3'>
          <strong class='aero-text-primary'>Name:</strong> ${escapeHtml(version.suiteSnapshot.name)}
        </div>
        <div class='mb-3'>
          <strong class='aero-text-primary'>Language:</strong> ${escapeHtml(version.suiteSnapshot.language)}
        </div>
        <div class='mb-3'>
          <strong class='aero-text-primary'>Description:</strong> ${escapeHtml(version.suiteSnapshot.description || 'None')}
        </div>
        <div class='mb-3'>
          <strong class='aero-text-primary'>Code:</strong>
          <pre class='aero-input p-2 mt-1 rounded overflow-x-auto'>${escapeHtml(version.suiteSnapshot.code || '')}</pre>
        </div>
        ${version.suiteSnapshot.expected_output ? `
          <div class='mb-3'>
            <strong class='aero-text-primary'>Expected Output:</strong>
            <pre class='aero-input p-2 mt-1 rounded overflow-x-auto'>${escapeHtml(version.suiteSnapshot.expected_output)}</pre>
          </div>
        ` : ''}
      `;
    }

    const restoreBtn = document.getElementById('restore-btn');
    if (restoreBtn) {
      restoreBtn.disabled = false;
    }

    const compareBtn = document.getElementById('compare-btn');
    if (compareBtn) {
      compareBtn.disabled = false;
      compareBtn.textContent = 'Compare';
    }

    renderVersionsList(versions);
  }
}

async function restoreSelectedVersion() {
  if (!selectedVersionId || !currentViewingSuiteId) {
    if (window.showMessage) {
      window.showMessage('Please select a version to restore', 'warning');
    }
    return;
  }

  if (!confirm('Are you sure you want to restore this version? Current version will be saved in history.')) {
    return;
  }

  const restoredSuite = await window.versionControl.restoreVersion(currentViewingSuiteId, selectedVersionId);

  if (!restoredSuite) {
    if (window.showMessage) {
      window.showMessage('Failed to restore version - version not found', 'error');
    }
    return;
  }

  if (window.testSuites && window.currentStorage) {
    const currentSuite = window.testSuites.find(s => s.id === currentViewingSuiteId);
    if (currentSuite) {
      await window.versionControl.saveVersion(
        currentViewingSuiteId,
        currentSuite,
        'Auto-save before restore'
      );
    }

    try {
      await window.currentStorage.updateSuite(currentViewingSuiteId, restoredSuite);

      const index = window.testSuites.findIndex(s => s.id === currentViewingSuiteId);
      if (index !== -1) {
        window.testSuites[index] = { ...window.testSuites[index], ...restoredSuite };
      }

      closeVersionHistory();

      if (window.showMessage) {
        window.showMessage('Version restored successfully', 'success');
      }

      if (window.LVXApp?.refreshSuites) await window.LVXApp.refreshSuites();
      else if (typeof renderTestSuites === 'function') {
        renderTestSuites(window.testSuites);
      }
    } catch (error) {
      console.error('Error restoring version:', error);
      if (window.showMessage) {
        window.showMessage('Failed to restore version: ' + error.message, 'error');
      }
    }
  } else {
    if (window.showMessage) {
      window.showMessage('Failed to restore version - storage not available', 'error');
    }
  }
}

async function toggleComparisonMode() {
  const btn = document.getElementById('compare-btn');
  if (!btn) return;

  if (isComparisonMode) {
    isComparisonMode = false;
    comparisonVersionIds = [];
    selectedVersionId = null;
    btn.disabled = false;
    btn.textContent = 'Compare';
    const versions = await window.versionControl.getVersionHistory(currentViewingSuiteId);
    renderVersionsList(versions);
    const preview = document.getElementById('version-preview');
    if (preview) {
      preview.textContent = 'Select a version to preview';
    }
  } else {
    isComparisonMode = true;
    comparisonVersionIds = [];
    selectedVersionId = null;
    const restoreBtn = document.getElementById('restore-btn');
    if (restoreBtn) {
      restoreBtn.disabled = true;
    }
    const preview = document.getElementById('version-preview');
    if (preview) {
      preview.innerHTML = `
        <div class='text-center aero-text-muted'>
          <p class='mb-2'>Comparison Mode Active</p>
          <p class='text-sm'>Select 2 versions to compare</p>
        </div>
      `;
    }
    btn.disabled = false;
    btn.textContent = 'Cancel Comparison';
    const versions = await window.versionControl.getVersionHistory(currentViewingSuiteId);
    renderVersionsList(versions);
    if (window.showMessage) {
      window.showMessage('Select 2 versions to compare', 'info');
    }
  }
}

async function compareVersions() {
  if (comparisonVersionIds.length !== 2) return;

  const versions = await window.versionControl.getVersionHistory(currentViewingSuiteId);
  const v1 = versions.find(v => v.versionId === comparisonVersionIds[0]);
  const v2 = versions.find(v => v.versionId === comparisonVersionIds[1]);

  if (!v1 || !v2) return;

  const preview = document.getElementById('version-preview');
  if (!preview) return;

  preview.innerHTML = `
    <h4 class='font-bold mb-3 aero-text-primary'>Comparing Versions</h4>

    <div class='mb-4'>
      <div class='text-sm aero-text-muted mb-1'>Version 1: ${new Date(v1.timestamp).toLocaleString()}</div>
      <div class='text-sm aero-text-muted'>Version 2: ${new Date(v2.timestamp).toLocaleString()}</div>
    </div>

    ${renderFieldDiff('Name', v1.suiteSnapshot.name, v2.suiteSnapshot.name)}
    ${renderFieldDiff('Language', v1.suiteSnapshot.language, v2.suiteSnapshot.language)}
    ${renderFieldDiff('Description', v1.suiteSnapshot.description || '', v2.suiteSnapshot.description || '')}
    ${renderFieldDiff('Code', v1.suiteSnapshot.code || '', v2.suiteSnapshot.code || '')}
    ${renderFieldDiff('Expected Output', v1.suiteSnapshot.expected_output || '', v2.suiteSnapshot.expected_output || '')}
  `;
}

function renderFieldDiff(fieldName, oldValue, newValue) {
  if (oldValue === newValue) {
    return `
      <div class='mb-3'>
        <strong class='aero-text-secondary'>${fieldName}:</strong>
        <div class='aero-input p-2 mt-1 rounded'>
          ${fieldName === 'Code' || fieldName === 'Expected Output' ?
            `<pre>${escapeHtml(oldValue)}</pre>` :
            escapeHtml(oldValue)}
        </div>
      </div>
    `;
  }

  return `
    <div class='mb-3'>
      <strong class='aero-text-warning'>${fieldName}: (Changed)</strong>
      <div class='grid grid-cols-2 gap-2 mt-1'>
        <div>
          <div class='text-xs aero-text-muted mb-1'>Old:</div>
          <div class='aero-input p-2 rounded bg-red-50'>
            ${fieldName === 'Code' || fieldName === 'Expected Output' ?
              `<pre>${escapeHtml(oldValue)}</pre>` :
              escapeHtml(oldValue)}
          </div>
        </div>
        <div>
          <div class='text-xs aero-text-muted mb-1'>New:</div>
          <div class='aero-input p-2 rounded bg-green-50'>
            ${fieldName === 'Code' || fieldName === 'Expected Output' ?
              `<pre>${escapeHtml(newValue)}</pre>` :
              escapeHtml(newValue)}
          </div>
        </div>
      </div>
    </div>
  `;
}

async function exportVersionHistory() {
  if (!currentViewingSuiteId) return;

  const versions = await window.versionControl.getVersionHistory(currentViewingSuiteId);

  let suiteName = 'Unknown';
  if (window.testSuites && Array.isArray(window.testSuites)) {
    const suite = window.testSuites.find(s => s.id === currentViewingSuiteId);
    if (suite) {
      suiteName = suite.name;
    }
  }

  const exportData = {
    suiteId: currentViewingSuiteId,
    suiteName: suiteName,
    exportDate: new Date().toISOString(),
    versionCount: versions.length,
    versions: versions
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${suiteName}_version_history_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);

  if (window.showMessage) {
    window.showMessage('Version history exported', 'success');
  }
}

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

window.openVersionHistory = openVersionHistory;
window.closeVersionHistory = closeVersionHistory;
window.selectVersion = selectVersion;
window.restoreSelectedVersion = restoreSelectedVersion;
window.toggleComparisonMode = toggleComparisonMode;
window.compareVersions = compareVersions;
window.exportVersionHistory = exportVersionHistory;

// Inline UI actions must surface async storage failures instead of leaving rejected promises.
for (const action of ['openVersionHistory', 'selectVersion', 'restoreSelectedVersion', 'toggleComparisonMode', 'compareVersions', 'exportVersionHistory']) {
  const handler = window[action];
  window[action] = async (...args) => {
    try { return await handler(...args); }
    catch (error) {
      console.error('Version history action failed:', error);
      window.showMessage?.('Version history action failed: ' + error.message, 'error');
    }
  };
}
