class TestHistoryManager {
  constructor() {
    this.STORAGE_KEY = 'test_execution_history';
    this.MAX_HISTORY_ENTRIES = 1000; // Keep last 1000 executions
    this.MAX_TOTAL_STORAGE_BYTES = 4 * 1024 * 1024;
    this.MIN_HISTORY_ENTRIES = 25;
  }

  _getStorageManager() {
    if (typeof window !== 'undefined' && window.storageManager) {
      return window.storageManager;
    }
    return null;
  }

  _getExecutionHistoryPolicy() {
    const storageManager = this._getStorageManager();
    if (!storageManager || typeof storageManager.loadStoragePreferences !== 'function') {
      return null;
    }

    const prefs = storageManager.loadStoragePreferences();
    if (prefs.mode === 'unlimited') {
      return { enabled: false, unlimited: true };
    }

    const policies = typeof storageManager.resolveRetentionPolicies === 'function'
      ? storageManager.resolveRetentionPolicies(prefs)
      : null;

    return policies?.execution_history || null;
  }

  // Record a test execution
  recordExecution(suiteId, suiteName, result) {
    const history = this.getHistory();

    const record = {
      id: this._generateId(),
      suiteId,
      suiteName,
      timestamp: new Date().toISOString(),
      status: result.status, // 'PASSED', 'FAILED', 'ERROR'
      executionTime: result.executionTime || 0, // milliseconds
      errorMessage: result.errorMessage || null,
      iterationCount: result.iterationCount || 1, // for data-driven tests
      passedIterations: result.passedIterations || (result.status === 'PASSED' ? 1 : 0),
      failedIterations: result.failedIterations || (result.status === 'FAILED' ? 1 : 0)
    };

    history.push(record);

    const trimmedHistory = this._enforceHistoryLimits(this._applyConfiguredRetention(history));
    this._persistHistory(trimmedHistory);
    return record.id;
  }

  // Get all history
  getHistory() {
    const data = localStorage.getItem(this.STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  }

  // Get history for specific suite
  getSuiteHistory(suiteId, limit = 50) {
    return this.getHistory()
      .filter(r => r.suiteId === suiteId)
      .slice(-limit);
  }

  // Get recent history
  getRecentHistory(days = 7) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return this.getHistory().filter(r => new Date(r.timestamp) >= cutoff);
  }

  // Calculate statistics
  calculateStatistics(history = null) {
    const data = history || this.getHistory();

    if (data.length === 0) {
      return {
        totalExecutions: 0,
        totalPassed: 0,
        totalFailed: 0,
        passRate: 0,
        failRate: 0,
        averageExecutionTime: 0,
        totalExecutionTime: 0
      };
    }

    const totalExecutions = data.length;
    const totalPassed = data.filter(r => r.status === 'PASSED').length;
    const totalFailed = data.filter(r => r.status === 'FAILED' || r.status === 'ERROR').length;
    const totalExecutionTime = data.reduce((sum, r) => sum + (r.executionTime || 0), 0);

    return {
      totalExecutions,
      totalPassed,
      totalFailed,
      passRate: (totalPassed / totalExecutions * 100).toFixed(1),
      failRate: (totalFailed / totalExecutions * 100).toFixed(1),
      averageExecutionTime: Math.round(totalExecutionTime / totalExecutions),
      totalExecutionTime
    };
  }

  // Detect flaky tests (tests that sometimes pass, sometimes fail)
  detectFlakyTests(threshold = 0.3) {
    const suiteStats = new Map();
    const history = this.getHistory();

    // Group by suite
    history.forEach(record => {
      if (!suiteStats.has(record.suiteId)) {
        suiteStats.set(record.suiteId, {
          suiteId: record.suiteId,
          suiteName: record.suiteName,
          executions: [],
          passed: 0,
          failed: 0
        });
      }

      const stats = suiteStats.get(record.suiteId);
      stats.executions.push(record);
      if (record.status === 'PASSED') stats.passed++;
      else stats.failed++;
    });

    // Find flaky tests (have both passes and failures, and failure rate is above threshold)
    const flakyTests = [];
    suiteStats.forEach(stats => {
      if (stats.executions.length >= 5 && stats.passed > 0 && stats.failed > 0) {
        const failRate = stats.failed / stats.executions.length;
        if (failRate >= threshold && failRate <= (1 - threshold)) {
          flakyTests.push({
            ...stats,
            flakinessScore: Math.min(failRate, 1 - failRate) * 2, // 0-1 scale
            recentExecutions: stats.executions.slice(-10)
          });
        }
      }
    });

    // Sort by flakiness score (most flaky first)
    return flakyTests.sort((a, b) => b.flakinessScore - a.flakinessScore);
  }

  // Get execution trends over time
  getExecutionTrends(days = 7) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const recentHistory = this.getHistory().filter(r => new Date(r.timestamp) >= cutoff);

    // Group by day
    const dailyStats = new Map();

    recentHistory.forEach(record => {
      const date = new Date(record.timestamp).toISOString().split('T')[0];

      if (!dailyStats.has(date)) {
        dailyStats.set(date, {
          date,
          passed: 0,
          failed: 0,
          total: 0,
          totalTime: 0
        });
      }

      const stats = dailyStats.get(date);
      stats.total++;
      stats.totalTime += record.executionTime || 0;
      if (record.status === 'PASSED') stats.passed++;
      else stats.failed++;
    });

    // Convert to array and sort by date
    return Array.from(dailyStats.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  // Get slowest tests
  getSlowestTests(limit = 10) {
    const history = this.getHistory();

    // Group by suite and calculate average execution time
    const suiteAvgTimes = new Map();

    history.forEach(record => {
      if (!suiteAvgTimes.has(record.suiteId)) {
        suiteAvgTimes.set(record.suiteId, {
          suiteId: record.suiteId,
          suiteName: record.suiteName,
          executions: [],
          totalTime: 0
        });
      }

      const stats = suiteAvgTimes.get(record.suiteId);
      stats.executions.push(record);
      stats.totalTime += record.executionTime || 0;
    });

    // Calculate averages
    const avgTimes = Array.from(suiteAvgTimes.values()).map(stats => ({
      suiteId: stats.suiteId,
      suiteName: stats.suiteName,
      averageTime: Math.round(stats.totalTime / stats.executions.length),
      executionCount: stats.executions.length,
      slowestTime: Math.max(...stats.executions.map(e => e.executionTime || 0))
    }));

    // Sort by average time
    return avgTimes.sort((a, b) => b.averageTime - a.averageTime).slice(0, limit);
  }

  // Get most frequently run tests
  getMostRunTests(limit = 10) {
    const history = this.getHistory();
    const suiteRunCounts = new Map();

    history.forEach(record => {
      if (!suiteRunCounts.has(record.suiteId)) {
        suiteRunCounts.set(record.suiteId, {
          suiteId: record.suiteId,
          suiteName: record.suiteName,
          runCount: 0,
          lastRun: record.timestamp
        });
      }

      const stats = suiteRunCounts.get(record.suiteId);
      stats.runCount++;
      if (new Date(record.timestamp) > new Date(stats.lastRun)) {
        stats.lastRun = record.timestamp;
      }
    });

    return Array.from(suiteRunCounts.values())
      .sort((a, b) => b.runCount - a.runCount)
      .slice(0, limit);
  }

  // Clear old history
  clearOldHistory(days = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const history = this.getHistory().filter(r => new Date(r.timestamp) >= cutoff);
    this._persistHistory(history);

    return history.length;
  }

  // Export history
  exportHistory() {
    return this.getHistory();
  }

  runConfiguredCleanup() {
    const before = this.getHistory();
    const after = this._enforceHistoryLimits(this._applyConfiguredRetention(before));
    this._persistHistory(after);

    return {
      deletedCount: Math.max(0, before.length - after.length),
      remainingCount: after.length
    };
  }

  getStorageDiagnostics() {
    const history = this.getHistory();
    const bytes = this._estimateSerializedSize(history);
    const policy = this._getExecutionHistoryPolicy();

    return {
      entries: history.length,
      bytes,
      policy
    };
  }

  _generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  _estimateSerializedSize(value) {
    const serialized = JSON.stringify(value);
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(serialized).length;
    }

    if (typeof Buffer !== 'undefined') {
      return Buffer.byteLength(serialized, 'utf8');
    }

    return serialized.length * 2;
  }

  _estimateNonHistoryStorageBytes() {
    let total = 0;

    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key || key === this.STORAGE_KEY) continue;

      const value = localStorage.getItem(key) || '';
      total += this._estimateSerializedSize({ [key]: value });
    }

    return total;
  }

  _applyConfiguredRetention(history) {
    const policy = this._getExecutionHistoryPolicy();
    if (!policy || !policy.enabled) {
      return Array.isArray(history) ? [...history] : [];
    }

    let retained = Array.isArray(history) ? [...history] : [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - policy.maxAgeDays);
    retained = retained.filter(record => new Date(record.timestamp) >= cutoff);

    if (retained.length > policy.maxEntries) {
      retained = retained.slice(retained.length - policy.maxEntries);
    }

    return retained;
  }

  _enforceHistoryLimits(history) {
    const trimmedHistory = Array.isArray(history) ? [...history] : [];

    if (trimmedHistory.length > this.MAX_HISTORY_ENTRIES) {
      trimmedHistory.splice(0, trimmedHistory.length - this.MAX_HISTORY_ENTRIES);
    }

    const nonHistoryBytes = this._estimateNonHistoryStorageBytes();
    while (
      trimmedHistory.length > this.MIN_HISTORY_ENTRIES &&
      nonHistoryBytes + this._estimateSerializedSize(trimmedHistory) > this.MAX_TOTAL_STORAGE_BYTES
    ) {
      trimmedHistory.shift();
    }

    return trimmedHistory;
  }

  _persistHistory(history) {
    const fallbackHistory = Array.isArray(history) ? [...history] : [];

    while (fallbackHistory.length > 0) {
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(fallbackHistory));

        if (fallbackHistory.length !== history.length && typeof window !== 'undefined' && typeof window.showMessage === 'function') {
          window.showMessage(
            `Execution history was trimmed to ${fallbackHistory.length} entries to stay within browser storage limits.`,
            'warning'
          );
        }
        return;
      } catch (error) {
        if (error?.name !== 'QuotaExceededError' && error?.name !== 'NS_ERROR_DOM_QUOTA_REACHED') {
          throw error;
        }

        if (fallbackHistory.length <= this.MIN_HISTORY_ENTRIES) {
          break;
        }

        fallbackHistory.splice(0, Math.max(1, Math.ceil(fallbackHistory.length * 0.1)));
      }
    }

    throw new Error('Unable to save execution history within localStorage limits.');
  }
}

// Export
window.TestHistoryManager = TestHistoryManager;
window.testHistoryManager = new TestHistoryManager();

// ============================================
// DASHBOARD UI LOGIC
// ============================================

let trendChart = null;
let distributionChart = null;
let suiteHistoryChart = null;

// Open dashboard
function openReportingDashboard() {
  document.getElementById('reporting-dashboard-modal').classList.remove('hidden');
  if (document.getElementById('dashboard-storage-tab')?.classList.contains('active')) {
    refreshStorageDashboard();
  } else if (document.getElementById('dashboard-security-tab')?.classList.contains('active')) {
    refreshSecurityDashboard();
  } else {
    refreshDashboard();
  }
}

function closeDashboard() {
  document.getElementById('reporting-dashboard-modal').classList.add('hidden');

  // Destroy charts to prevent memory leaks
  if (trendChart) {
    trendChart.destroy();
    trendChart = null;
  }
  if (distributionChart) {
    distributionChart.destroy();
    distributionChart = null;
  }
}

// Refresh all dashboard data
function refreshDashboard() {
  const timeframe = document.getElementById('dashboard-timeframe').value;
  const days = timeframe === 'all' ? null : parseInt(timeframe);

  const history = days ? window.testHistoryManager.getRecentHistory(days) : window.testHistoryManager.getHistory();

  renderSummaryStatistics(history);
  renderTrendChart(days || 30);
  renderDistributionChart(history);
  renderFlakyTests();
  renderSlowestTests();
  renderMostRunTests();
  renderRecentExecutions(history.slice(-20).reverse());
}

// Render summary statistics
function renderSummaryStatistics(history) {
  const stats = window.testHistoryManager.calculateStatistics(history);

  document.getElementById('stat-total').textContent = stats.totalExecutions;
  document.getElementById('stat-pass-rate').textContent = stats.passRate + '%';
  document.getElementById('stat-avg-time').textContent = stats.averageExecutionTime + 'ms';
  document.getElementById('stat-total-time').textContent = (stats.totalExecutionTime / 1000).toFixed(1) + 's';

  // Color pass rate based on value
  const passRateElement = document.getElementById('stat-pass-rate');
  if (parseFloat(stats.passRate) >= 90) {
    passRateElement.className = 'text-3xl font-bold text-green-600';
  } else if (parseFloat(stats.passRate) >= 70) {
    passRateElement.className = 'text-3xl font-bold text-yellow-600';
  } else {
    passRateElement.className = 'text-3xl font-bold text-red-600';
  }
}

// Render trend chart
function renderTrendChart(days) {
  const trends = window.testHistoryManager.getExecutionTrends(days);

  const ctx = document.getElementById('trend-chart');
  if (!ctx) return;

  // Destroy existing chart
  if (trendChart) {
    trendChart.destroy();
  }

  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: trends.map(t => new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
      datasets: [
        {
          label: 'Passed',
          data: trends.map(t => t.passed),
          borderColor: '#4CAF50',
          backgroundColor: 'rgba(76, 175, 80, 0.1)',
          tension: 0.3
        },
        {
          label: 'Failed',
          data: trends.map(t => t.failed),
          borderColor: '#F44336',
          backgroundColor: 'rgba(244, 67, 54, 0.1)',
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top'
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            stepSize: 1
          }
        }
      }
    }
  });
}

// Render distribution chart
function renderDistributionChart(history) {
  const stats = window.testHistoryManager.calculateStatistics(history);

  const ctx = document.getElementById('distribution-chart');
  if (!ctx) return;

  // Destroy existing chart
  if (distributionChart) {
    distributionChart.destroy();
  }

  distributionChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Passed', 'Failed'],
      datasets: [{
        data: [stats.totalPassed, stats.totalFailed],
        backgroundColor: ['#4CAF50', '#F44336'],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom'
        }
      }
    }
  });
}

// Render flaky tests
function renderFlakyTests() {
  const flakyTests = window.testHistoryManager.detectFlakyTests(0.2);
  const section = document.getElementById('flaky-tests-section');
  const list = document.getElementById('flaky-tests-list');

  if (flakyTests.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');

  list.innerHTML = flakyTests.map(test => {
    const failRate = (test.failed / test.executions.length * 100).toFixed(1);
    return `
      <div class='aero-button p-3 rounded flex justify-between items-center'>
        <div>
          <div class='font-semibold'>${test.suiteName}</div>
          <div class='text-xs aero-text-muted'>
            ${test.executions.length} runs: ${test.passed} passed, ${test.failed} failed (${failRate}% fail rate)
          </div>
        </div>
        <div class='flex items-center gap-2'>
          <div class='text-2xl'>${getStabilityIcon(test.flakinessScore)}</div>
          <button onclick='openSuiteHistoryModal("${test.suiteId}")' 
            class='aero-button-info text-sm py-1 px-3 rounded'>
            View History
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function getStabilityIcon(score) {
  if (score > 0.7) return '🔴';
  if (score > 0.4) return '🟡';
  return '🟢';
}

// Render slowest tests
function renderSlowestTests() {
  const slowestTests = window.testHistoryManager.getSlowestTests(5);
  const list = document.getElementById('slowest-tests-list');

  if (slowestTests.length === 0) {
    list.innerHTML = '<p class="text-sm aero-text-muted">No execution data yet</p>';
    return;
  }

  list.innerHTML = slowestTests.map((test, index) => `
    <div class='aero-button p-2 rounded flex justify-between items-center'>
      <div class='flex items-center gap-2'>
        <span class='font-bold aero-text-muted'>#${index + 1}</span>
        <span class='text-sm'>${test.suiteName}</span>
      </div>
      <div class='text-right'>
        <div class='font-semibold'>${test.averageTime}ms</div>
        <div class='text-xs aero-text-muted'>avg of ${test.executionCount} runs</div>
      </div>
    </div>
  `).join('');
}

// Render most run tests
function renderMostRunTests() {
  const mostRunTests = window.testHistoryManager.getMostRunTests(5);
  const list = document.getElementById('most-run-tests-list');

  if (mostRunTests.length === 0) {
    list.innerHTML = '<p class="text-sm aero-text-muted">No execution data yet</p>';
    return;
  }

  list.innerHTML = mostRunTests.map((test, index) => `
    <div class='aero-button p-2 rounded flex justify-between items-center'>
      <div class='flex items-center gap-2'>
        <span class='font-bold aero-text-muted'>#${index + 1}</span>
        <span class='text-sm'>${test.suiteName}</span>
      </div>
      <div class='text-right'>
        <div class='font-semibold'>${test.runCount} runs</div>
        <div class='text-xs aero-text-muted'>${new Date(test.lastRun).toLocaleDateString()}</div>
      </div>
    </div>
  `).join('');
}

// Render recent executions table
function renderRecentExecutions(history) {
  const tbody = document.getElementById('recent-executions-body');

  if (history.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center p-4 aero-text-muted">No executions yet</td></tr>';
    return;
  }

  tbody.innerHTML = history.map(record => `
    <tr class='border-b aero-divider hover:bg-blue-50'>
      <td class='p-2'>${new Date(record.timestamp).toLocaleString()}</td>
      <td class='p-2'>${record.suiteName}</td>
      <td class='p-2'>
        <span class='aero-badge-${record.status === 'PASSED' ? 'success' : 'error'}'>
          ${record.status}
        </span>
      </td>
      <td class='p-2'>${record.executionTime}ms</td>
      <td class='p-2'>
        ${record.iterationCount > 1 ? `${record.passedIterations}/${record.iterationCount}` : '-'}
      </td>
    </tr>
  `).join('');
}

// View suite history
function viewSuiteHistory(suiteId) {
  // Close dashboard
  closeDashboard();
  openSuiteHistoryModal(suiteId);
}

// ============================================
// SUITE HISTORY MODAL
// ============================================

function openSuiteHistoryModal(suiteId) {
  const suite = window.testSuites.find(s => s.id === suiteId);
  if (!suite) return;

  document.getElementById('suite-history-name').textContent = suite.name;

  const history = window.testHistoryManager.getSuiteHistory(suiteId, 50);
  const stats = window.testHistoryManager.calculateStatistics(history);

  // Render statistics
  document.getElementById('suite-stat-total').textContent = stats.totalExecutions;
  document.getElementById('suite-stat-pass-rate').textContent = stats.passRate + '%';
  document.getElementById('suite-stat-avg-time').textContent = stats.averageExecutionTime + 'ms';

  // Render chart
  renderSuiteHistoryChart(history);

  // Render execution list
  renderSuiteHistoryList(history.slice().reverse());

  document.getElementById('suite-history-modal').classList.remove('hidden');
}

function closeSuiteHistoryModal() {
  document.getElementById('suite-history-modal').classList.add('hidden');

  if (suiteHistoryChart) {
    suiteHistoryChart.destroy();
    suiteHistoryChart = null;
  }
}

function renderSuiteHistoryChart(history) {
  const ctx = document.getElementById('suite-history-chart');
  if (!ctx) return;

  if (suiteHistoryChart) {
    suiteHistoryChart.destroy();
  }

  // Show last 20 executions
  const recentHistory = history.slice(-20);

  suiteHistoryChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: recentHistory.map((r, i) => `Run ${i + 1}`),
      datasets: [{
        label: 'Execution Time (ms)',
        data: recentHistory.map(r => r.executionTime),
        backgroundColor: recentHistory.map(r =>
          r.status === 'PASSED' ? 'rgba(76, 175, 80, 0.5)' : 'rgba(244, 67, 54, 0.5)'
        ),
        borderColor: recentHistory.map(r =>
          r.status === 'PASSED' ? '#4CAF50' : '#F44336'
        ),
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Time (ms)'
          }
        }
      }
    }
  });
}

function renderSuiteHistoryList(history) {
  const container = document.getElementById('suite-history-list');

  if (history.length === 0) {
    container.innerHTML = '<p class="text-sm aero-text-muted">No execution history yet</p>';
    return;
  }

  container.innerHTML = history.map(record => `
    <div class='aero-button p-3 rounded flex justify-between items-center'>
      <div>
        <div class='text-sm font-semibold'>${new Date(record.timestamp).toLocaleString()}</div>
        <div class='text-xs aero-text-muted'>
          Duration: ${record.executionTime}ms
          ${record.iterationCount > 1 ? ` | ${record.passedIterations}/${record.iterationCount} passed` : ''}
        </div>
        ${record.errorMessage ? `<div class='text-xs aero-text-danger mt-1'>${record.errorMessage}</div>` : ''}
      </div>
      <span class='aero-badge-${record.status === 'PASSED' ? 'success' : 'error'}'>
        ${record.status}
      </span>
    </div>
  `).join('');
}

// ============================================
// STORAGE DASHBOARD
// ============================================

function formatStorageBytes(bytes) {
  const numeric = Number(bytes) || 0;
  if (numeric < 1024) return `${numeric} B`;

  const units = ['KB', 'MB', 'GB'];
  let value = numeric / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function getStorageModeLabel(mode) {
  switch (mode) {
    case 'unlimited':
      return 'Keep everything';
    case 'custom':
      return 'Custom';
    default:
      return 'Smart cleanup';
  }
}

function setStoragePolicyInputs(prefix, policy) {
  const enabledEl = document.getElementById(`${prefix}-enabled`);
  const foreverEl = document.getElementById(`${prefix}-forever`);
  const maxEntriesEl = document.getElementById(`${prefix}-max-entries`);
  const maxAgeEl = document.getElementById(`${prefix}-max-age`);

  if (enabledEl) enabledEl.checked = policy?.enabled !== false;
  if (foreverEl) foreverEl.checked = policy?.enabled === false;
  if (maxEntriesEl) maxEntriesEl.value = policy?.maxEntries ?? '';
  if (maxAgeEl) maxAgeEl.value = policy?.maxAgeDays ?? '';
}

function getStoragePolicyInputs(prefix, fallbackPolicy) {
  const enabledEl = document.getElementById(`${prefix}-enabled`);
  const foreverEl = document.getElementById(`${prefix}-forever`);
  const maxEntriesEl = document.getElementById(`${prefix}-max-entries`);
  const maxAgeEl = document.getElementById(`${prefix}-max-age`);

  const keepForever = !!foreverEl?.checked;
  return {
    enabled: keepForever ? false : !!enabledEl?.checked,
    maxEntries: Number(maxEntriesEl?.value || fallbackPolicy.maxEntries),
    maxAgeDays: Number(maxAgeEl?.value || fallbackPolicy.maxAgeDays),
    strategy: fallbackPolicy.strategy || 'oldest-first'
  };
}

function formatLogRetentionLabel(mode, retention) {
  if (mode === 'unlimited') {
    return 'Unlimited mode (manual log cleanup only)';
  }

  if (!retention || retention.enabled === false) {
    return 'Disabled';
  }

  return `${retention.maxFiles} files / ${retention.maxAgeDays} days / ${retention.maxTotalSizeMB} MB`;
}

function setLogRetentionInputs(retention) {
  const enabledEl = document.getElementById('storage-log-retention-enabled');
  const foreverEl = document.getElementById('storage-log-retention-forever');
  const maxFilesEl = document.getElementById('storage-log-retention-max-files');
  const maxAgeEl = document.getElementById('storage-log-retention-max-age');
  const maxTotalSizeEl = document.getElementById('storage-log-retention-max-total-size');

  if (enabledEl) enabledEl.checked = retention?.enabled !== false;
  if (foreverEl) foreverEl.checked = retention?.enabled === false;
  if (maxFilesEl) maxFilesEl.value = retention?.maxFiles ?? '';
  if (maxAgeEl) maxAgeEl.value = retention?.maxAgeDays ?? '';
  if (maxTotalSizeEl) maxTotalSizeEl.value = retention?.maxTotalSizeMB ?? '';
}

function getLogRetentionInputs(fallbackRetention) {
  const keepForever = !!document.getElementById('storage-log-retention-forever')?.checked;

  return {
    enabled: keepForever ? false : !!document.getElementById('storage-log-retention-enabled')?.checked,
    maxFiles: Number(document.getElementById('storage-log-retention-max-files')?.value || fallbackRetention.maxFiles),
    maxAgeDays: Number(document.getElementById('storage-log-retention-max-age')?.value || fallbackRetention.maxAgeDays),
    maxTotalSizeMB: Number(document.getElementById('storage-log-retention-max-total-size')?.value || fallbackRetention.maxTotalSizeMB)
  };
}

function formatSessionRetentionLabel(mode, retention) {
  if (mode === 'unlimited' || retention?.keepForever || retention?.enabled === false) {
    return 'Keep everything';
  }

  return `Keep last ${retention?.maxExports || 5} export(s)`;
}

function setSessionRetentionInputs(retention) {
  const enabledEl = document.getElementById('storage-session-retention-enabled');
  const foreverEl = document.getElementById('storage-session-retention-forever');
  const maxExportsEl = document.getElementById('storage-session-retention-max-exports');

  if (enabledEl) enabledEl.checked = retention?.enabled !== false;
  if (foreverEl) foreverEl.checked = !!retention?.keepForever || retention?.enabled === false;
  if (maxExportsEl) maxExportsEl.value = retention?.maxExports ?? '';
}

function getSessionRetentionInputs(fallbackRetention) {
  const keepForever = !!document.getElementById('storage-session-retention-forever')?.checked;

  return {
    enabled: keepForever ? false : !!document.getElementById('storage-session-retention-enabled')?.checked,
    keepForever,
    maxExports: Number(document.getElementById('storage-session-retention-max-exports')?.value || fallbackRetention.maxExports)
  };
}

function escapeStorageHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderSessionExportList(sessionSummary, sessionRetention, mode) {
  const listEl = document.getElementById('storage-session-list');
  const summaryEl = document.getElementById('storage-session-summary');
  const directoryEl = document.getElementById('storage-session-directory');
  const directoryShortEl = document.getElementById('storage-session-directory-short');

  if (summaryEl) {
    summaryEl.textContent = `${sessionSummary.count} export(s) using ${formatStorageBytes(sessionSummary.totalSizeBytes || 0)}. ${formatSessionRetentionLabel(mode, sessionRetention)}.`;
  }

  if (directoryEl) {
    directoryEl.textContent = sessionSummary.directory || 'saved sessions/';
  }

  if (directoryShortEl) {
    directoryShortEl.textContent = sessionSummary.directory || 'saved sessions/';
  }

  if (!listEl) {
    return;
  }

  if (!sessionSummary.exports || sessionSummary.exports.length === 0) {
    listEl.innerHTML = "<div class='text-sm aero-text-muted'>No session exports saved yet.</div>";
    return;
  }

  listEl.innerHTML = sessionSummary.exports.map(entry => `
    <div class='aero-button p-3 rounded-lg flex items-center justify-between gap-4'>
      <div class='min-w-0'>
        <div class='font-semibold aero-text-primary truncate'>${escapeStorageHtml(entry.fileName)}</div>
        <div class='text-xs aero-text-muted truncate'>${escapeStorageHtml(entry.relativePath)}</div>
      </div>
      <div class='flex items-center gap-3 shrink-0'>
        <div class='text-xs aero-text-muted text-right'>
          <div>${formatStorageBytes(entry.sizeBytes || 0)}</div>
          <div>${new Date(entry.modifiedAt).toLocaleString()}</div>
        </div>
        <button type='button' class='aero-button-danger px-3 py-1 rounded-lg text-sm'
          data-session-export-path='${encodeURIComponent(entry.path)}'>Delete</button>
      </div>
    </div>
  `).join('');

  listEl.querySelectorAll('[data-session-export-path]').forEach(button => {
    button.addEventListener('click', () => {
      deleteSessionExportFromDashboard(decodeURIComponent(button.getAttribute('data-session-export-path') || ''));
    });
  });
}

function formatLastImportSummary(lastImportSummary) {
  if (!lastImportSummary?.timestamp) {
    return 'No legacy import has been run yet.';
  }

  const importBits = [];
  if (lastImportSummary.importedSuites) {
    importBits.push(`${lastImportSummary.importedSuites} suite(s)`);
  }
  if (lastImportSummary.importedPipelines) {
    importBits.push(`${lastImportSummary.importedPipelines} pipeline(s)`);
  }
  if (lastImportSummary.importedViews) {
    importBits.push(`${lastImportSummary.importedViews} view(s)`);
  }
  if (lastImportSummary.importedVersions) {
    importBits.push(`${lastImportSummary.importedVersions} version(s)`);
  }

  const sourceName = lastImportSummary.sourceName || 'Imported data';
  const fileInfo = lastImportSummary.importedFiles > 1
    ? `${lastImportSummary.importedFiles} file(s)`
    : sourceName;
  const skippedInfo = lastImportSummary.failedFiles || lastImportSummary.skippedFiles
    ? ` | Skipped ${lastImportSummary.skippedFiles || 0}, failed ${lastImportSummary.failedFiles || 0}`
    : '';

  return `Last import: ${importBits.join(', ') || '0 items'} from ${fileInfo} on ${new Date(lastImportSummary.timestamp).toLocaleString()}${skippedInfo}`;
}

function updateStorageSettingsVisibility() {
  const customMode = document.getElementById('storage-mode-custom')?.checked;
  const customPanel = document.getElementById('storage-custom-policies');

  if (customPanel) {
    customPanel.classList.toggle('hidden', !customMode);
  }

  document.querySelectorAll('[data-storage-policy-prefix]').forEach(section => {
    const prefix = section.getAttribute('data-storage-policy-prefix');
    const keepForever = document.getElementById(`${prefix}-forever`)?.checked;
    const enabled = document.getElementById(`${prefix}-enabled`)?.checked;
    const disableInputs = keepForever || !enabled;

    ['max-entries', 'max-age'].forEach(suffix => {
      const input = document.getElementById(`${prefix}-${suffix}`);
      if (input) {
        input.disabled = disableInputs;
      }
    });
  });

  const logKeepForever = document.getElementById('storage-log-retention-forever')?.checked;
  const logEnabled = document.getElementById('storage-log-retention-enabled')?.checked;
  const disableLogInputs = logKeepForever || !logEnabled;

  ['max-files', 'max-age', 'max-total-size'].forEach(suffix => {
    const input = document.getElementById(`storage-log-retention-${suffix}`);
    if (input) {
      input.disabled = disableLogInputs;
    }
  });

  const sessionKeepForever = document.getElementById('storage-session-retention-forever')?.checked;
  const sessionEnabled = document.getElementById('storage-session-retention-enabled')?.checked;
  const sessionMaxExports = document.getElementById('storage-session-retention-max-exports');
  if (sessionMaxExports) {
    sessionMaxExports.disabled = sessionKeepForever || !sessionEnabled;
  }
}

async function refreshStorageDashboard(cleanupSummary = null) {
  const storageManager = window.storageManager;
  if (!storageManager || typeof storageManager.ensureReady !== 'function') {
    return;
  }

  await storageManager.ensureReady();

  const preferences = storageManager.loadStoragePreferences();
  const policies = storageManager.resolveRetentionPolicies(preferences);
  const logRetention = typeof storageManager.resolveLogRetention === 'function'
    ? storageManager.resolveLogRetention(preferences)
    : preferences.logRetention;
  const sessionRetention = typeof storageManager.resolveSessionRetention === 'function'
    ? storageManager.resolveSessionRetention(preferences)
    : preferences.sessionRetention;
  const estimate = cleanupSummary?.estimate || await storageManager.getStorageEstimate();
  const versionRecords = await storageManager.getAll(storageManager.STORES.versions);
  const screenshotRecords = await storageManager.getAll(storageManager.STORES.screenshots);
  const securityScanRecords = await storageManager.getAll(storageManager.STORES.securityScans);
  let sessionSummary = { count: 0, totalSizeBytes: 0, exports: [], directory: 'saved sessions/' };
  if (window.electronAPI?.sessionExports?.getSummary) {
    try {
      sessionSummary = await window.electronAPI.sessionExports.getSummary();
    } catch (error) {
      console.warn('[StorageDashboard] Failed to load session exports:', error);
    }
  }
  const executionDiagnostics = window.testHistoryManager?.getStorageDiagnostics
    ? window.testHistoryManager.getStorageDiagnostics()
    : { entries: 0, bytes: 0 };

  const versionEntryCount = (versionRecords || []).reduce((sum, record) => {
    return sum + (Array.isArray(record?.versions) ? record.versions.length : 0);
  }, 0);

  const summary = {
    preferences,
    policies,
    estimate,
    executionHistoryEntries: executionDiagnostics.entries || 0,
    executionHistoryBytes: executionDiagnostics.bytes || 0,
    securityScanEntries: (securityScanRecords || []).length,
    screenshotEntries: (screenshotRecords || []).length,
    versionEntries: versionEntryCount,
    sessionEntries: sessionSummary.count || 0,
    sessionBytes: sessionSummary.totalSizeBytes || 0
  };

  const usagePercentEl = document.getElementById('storage-usage-percent');
  const usedBytesEl = document.getElementById('storage-used-bytes');
  const quotaBytesEl = document.getElementById('storage-quota-bytes');
  const modeEl = document.getElementById('storage-cleanup-mode-label');
  const lastCleanupEl = document.getElementById('storage-last-cleanup');
  const executionCountEl = document.getElementById('storage-count-executions');
  const securityCountEl = document.getElementById('storage-count-security');
  const screenshotsCountEl = document.getElementById('storage-count-screenshots');
  const versionsCountEl = document.getElementById('storage-count-versions');
  const sessionCountEl = document.getElementById('storage-count-sessions');
  const sessionBytesEl = document.getElementById('storage-session-bytes');
  const sessionRetentionLabelEl = document.getElementById('storage-session-retention-label');
  const warningThresholdEl = document.getElementById('storage-warning-threshold');
  const logRetentionLabelEl = document.getElementById('storage-log-retention-label');
  const summaryEl = document.getElementById('storage-cleanup-summary');
  const lastImportEl = document.getElementById('storage-last-import');
  const lastImportSummary = typeof storageManager.loadLastImportSummary === 'function'
    ? storageManager.loadLastImportSummary()
    : null;

  if (usagePercentEl) usagePercentEl.textContent = estimate?.percentUsed ? `${estimate.percentUsed}%` : 'n/a';
  if (usedBytesEl) usedBytesEl.textContent = formatStorageBytes(estimate?.used || 0);
  if (quotaBytesEl) quotaBytesEl.textContent = estimate?.quota ? formatStorageBytes(estimate.quota) : 'Unavailable';
  if (modeEl) modeEl.textContent = getStorageModeLabel(preferences.mode);
  if (lastCleanupEl) lastCleanupEl.textContent = preferences.lastCleanupDate
    ? new Date(preferences.lastCleanupDate).toLocaleString()
    : 'Never';
  if (executionCountEl) executionCountEl.textContent = String(summary.executionHistoryEntries);
  if (securityCountEl) securityCountEl.textContent = String(summary.securityScanEntries);
  if (screenshotsCountEl) screenshotsCountEl.textContent = String(summary.screenshotEntries);
  if (versionsCountEl) versionsCountEl.textContent = String(summary.versionEntries);
  if (sessionCountEl) sessionCountEl.textContent = String(summary.sessionEntries);
  if (sessionBytesEl) sessionBytesEl.textContent = formatStorageBytes(summary.sessionBytes);
  if (warningThresholdEl) warningThresholdEl.value = String(preferences.showWarningAt || 80);
  if (logRetentionLabelEl) logRetentionLabelEl.textContent = formatLogRetentionLabel(preferences.mode, logRetention);
  if (sessionRetentionLabelEl) sessionRetentionLabelEl.textContent = formatSessionRetentionLabel(preferences.mode, sessionRetention);
  if (summaryEl && !cleanupSummary) summaryEl.textContent = '';
  if (lastImportEl) lastImportEl.textContent = formatLastImportSummary(lastImportSummary);

  const modeRadio = document.getElementById(`storage-mode-${preferences.mode}`);
  if (modeRadio) modeRadio.checked = true;

  setStoragePolicyInputs('storage-policy-execution', policies.execution_history);
  setStoragePolicyInputs('storage-policy-security', policies.security_scans);
  setStoragePolicyInputs('storage-policy-screenshots', policies.screenshots);
  setStoragePolicyInputs('storage-policy-versions', policies.versions);
  setLogRetentionInputs(logRetention);
  setSessionRetentionInputs(sessionRetention);
  renderSessionExportList(sessionSummary, sessionRetention, preferences.mode);

  updateStorageSettingsVisibility();

  return summary;
}

function collectStoragePreferencesFromDashboard() {
  const storageManager = window.storageManager;
  if (!storageManager || typeof storageManager.getDefaultRetentionPolicies !== 'function') {
    throw new Error('Storage manager is not ready yet.');
  }

  const defaults = storageManager.getDefaultRetentionPolicies();
  const defaultLogRetention = typeof storageManager.getDefaultLogRetention === 'function'
    ? storageManager.getDefaultLogRetention()
    : { enabled: true, maxFiles: 50, maxAgeDays: 30, maxTotalSizeMB: 100 };
  const defaultSessionRetention = typeof storageManager.getDefaultSessionRetention === 'function'
    ? storageManager.getDefaultSessionRetention()
    : { enabled: true, keepForever: false, maxExports: 5 };
  const mode = document.getElementById('storage-mode-unlimited')?.checked
    ? 'unlimited'
    : document.getElementById('storage-mode-custom')?.checked
      ? 'custom'
      : 'smart';

  return {
    mode,
    showWarningAt: Number(document.getElementById('storage-warning-threshold')?.value || 80),
    customPolicies: {
      execution_history: getStoragePolicyInputs('storage-policy-execution', defaults.execution_history),
      security_scans: getStoragePolicyInputs('storage-policy-security', defaults.security_scans),
      screenshots: getStoragePolicyInputs('storage-policy-screenshots', defaults.screenshots),
      versions: getStoragePolicyInputs('storage-policy-versions', defaults.versions)
    },
    logRetention: getLogRetentionInputs(defaultLogRetention),
    sessionRetention: getSessionRetentionInputs(defaultSessionRetention)
  };
}

async function saveStoragePreferencesFromDashboard() {
  try {
    const storageManager = window.storageManager;
    if (!storageManager || typeof storageManager.saveStoragePreferences !== 'function') {
      throw new Error('Storage manager is not ready yet.');
    }

    const preferences = collectStoragePreferencesFromDashboard();
    storageManager.saveStoragePreferences(preferences);
    await refreshStorageDashboard();
    if (typeof window.refreshStorageStatusDisplay === 'function') {
      await window.refreshStorageStatusDisplay();
    }
    if (typeof window.showMessage === 'function') {
      window.showMessage('Storage settings saved.', 'success');
    }
  } catch (error) {
    console.error('[StorageDashboard] Failed to save storage preferences:', error);
    if (typeof window.showMessage === 'function') {
      window.showMessage(`Failed to save storage settings: ${error.message}`, 'error');
    }
  }
}

async function restoreDefaultStoragePreferences() {
  try {
    const storageManager = window.storageManager;
    if (!storageManager || typeof storageManager.saveStoragePreferences !== 'function') {
      throw new Error('Storage manager is not ready yet.');
    }

    storageManager.saveStoragePreferences(storageManager.getDefaultStoragePreferences());
    await refreshStorageDashboard();
    if (typeof window.refreshStorageStatusDisplay === 'function') {
      await window.refreshStorageStatusDisplay();
    }
    if (typeof window.showMessage === 'function') {
      window.showMessage('Storage settings restored to defaults.', 'success');
    }
  } catch (error) {
    console.error('[StorageDashboard] Failed to restore default storage preferences:', error);
    if (typeof window.showMessage === 'function') {
      window.showMessage(`Failed to restore defaults: ${error.message}`, 'error');
    }
  }
}

async function runStorageCleanupNow() {
  const summaryEl = document.getElementById('storage-cleanup-summary');

  try {
    const storageManager = window.storageManager;
    if (!storageManager || typeof storageManager.enforceRetentionPolicies !== 'function') {
      throw new Error('Storage manager is not ready yet.');
    }

    const cleanupSummary = await storageManager.enforceRetentionPolicies();
    const historyCleanup = window.testHistoryManager?.runConfiguredCleanup
      ? window.testHistoryManager.runConfiguredCleanup()
      : { deletedCount: 0, remainingCount: 0 };
    const sessionCleanup = window.electronAPI?.sessionExports?.cleanup
      ? await window.electronAPI.sessionExports.cleanup(storageManager.loadStoragePreferences())
      : { deletedCount: 0 };

    const combinedCleanupSummary = {
      ...cleanupSummary,
      sessionExports: sessionCleanup,
      deletedCount: cleanupSummary.deletedCount + historyCleanup.deletedCount + (sessionCleanup.deletedCount || 0)
    };

    await refreshStorageDashboard(combinedCleanupSummary);
    if (typeof window.refreshStorageStatusDisplay === 'function') {
      await window.refreshStorageStatusDisplay(combinedCleanupSummary);
    }

    if (summaryEl) {
      summaryEl.textContent = `Cleanup completed. Removed ${combinedCleanupSummary.deletedCount} item(s).`;
    }

    if (typeof window.showMessage === 'function') {
      window.showMessage(
        `Storage cleanup completed. Removed ${combinedCleanupSummary.deletedCount} item(s).`,
        'success'
      );
    }
  } catch (error) {
    console.error('[StorageDashboard] Failed to run storage cleanup:', error);
    if (summaryEl) {
      summaryEl.textContent = `Cleanup failed: ${error.message}`;
    }
    if (typeof window.showMessage === 'function') {
      window.showMessage(`Storage cleanup failed: ${error.message}`, 'error');
    }
  }
}

async function deleteSessionExportFromDashboard(filePath) {
  if (!filePath || !window.electronAPI?.sessionExports?.deleteExport) {
    return;
  }

  if (typeof window.confirm === 'function' && !window.confirm('Delete this saved session export?')) {
    return;
  }

  try {
    await window.electronAPI.sessionExports.deleteExport(filePath);
    await refreshStorageDashboard();
    if (typeof window.refreshStorageStatusDisplay === 'function') {
      await window.refreshStorageStatusDisplay();
    }
    if (typeof window.showMessage === 'function') {
      window.showMessage('Saved session export deleted.', 'success');
    }
  } catch (error) {
    console.error('[StorageDashboard] Failed to delete session export:', error);
    if (typeof window.showMessage === 'function') {
      window.showMessage(`Failed to delete session export: ${error.message}`, 'error');
    }
  }
}

function triggerStorageImportOldData() {
  triggerStorageImportJsonFile();
}

async function triggerStorageImportJsonFile() {
  if (typeof window.importLegacyJsonFileFromDashboard === 'function') {
    const summary = await window.importLegacyJsonFileFromDashboard();
    if (summary) {
      await refreshStorageDashboard();
      if (typeof window.refreshStorageStatusDisplay === 'function') {
        await window.refreshStorageStatusDisplay();
      }
    }
    return;
  }

  const input = document.getElementById('storage-import-json-input') || document.getElementById('main-import-file-input');
  if (input) {
    input.value = '';
    input.click();
  }
}

async function triggerStorageImportSessionFolder() {
  if (typeof window.importLegacySessionFolderFromDashboard !== 'function') {
    if (typeof window.showMessage === 'function') {
      window.showMessage('Folder import is only available in the Electron app.', 'info');
    }
    return;
  }

  const summary = await window.importLegacySessionFolderFromDashboard();
  if (summary) {
    await refreshStorageDashboard();
    if (typeof window.refreshStorageStatusDisplay === 'function') {
      await window.refreshStorageStatusDisplay();
    }
  }
}

// ============================================
// SECURITY DASHBOARD
// ============================================

let securityTrendChart = null;
let securitySeverityChart = null;

// Switch dashboard tabs
function switchDashboardTab(tab) {
  const testTab = document.getElementById('dashboard-test-tab');
  const securityTab = document.getElementById('dashboard-security-tab');
  const storageTab = document.getElementById('dashboard-storage-tab');
  const testContent = document.getElementById('dashboard-test-content');
  const securityContent = document.getElementById('dashboard-security-content');
  const storageContent = document.getElementById('dashboard-storage-content');

  if (!testContent || !securityContent || !storageContent) return;

  if (tab === 'test') {
    testTab.classList.add('active');
    securityTab.classList.remove('active');
    storageTab?.classList.remove('active');
    testContent.classList.remove('hidden');
    securityContent.classList.add('hidden');
    storageContent.classList.add('hidden');
    refreshDashboard();
  } else if (tab === 'security') {
    testTab.classList.remove('active');
    securityTab.classList.add('active');
    storageTab?.classList.remove('active');
    testContent.classList.add('hidden');
    securityContent.classList.remove('hidden');
    storageContent.classList.add('hidden');
    refreshSecurityDashboard();
  } else {
    testTab.classList.remove('active');
    securityTab.classList.remove('active');
    storageTab?.classList.add('active');
    testContent.classList.add('hidden');
    securityContent.classList.add('hidden');
    storageContent.classList.remove('hidden');
    refreshStorageDashboard();
  }
}

// Refresh security dashboard
function refreshSecurityDashboard() {
  if (!window.securityManager) {
    console.warn('Security manager not loaded');
    return;
  }

  const stats = window.securityManager.getStatistics();
  const history = window.securityManager.getHistory();

  renderSecuritySummary(stats);
  renderSecuritySeverityChart(stats);
  renderSecurityTrendChart(history);
  renderTopVulnerabilities(history);
  renderComplianceScore(stats);
}

// Render security summary cards
function renderSecuritySummary(stats) {
  const totalScans = document.getElementById('sec-stat-total-scans');
  const totalVulns = document.getElementById('sec-stat-total-vulns');
  const criticalCount = document.getElementById('sec-stat-critical');
  const passRate = document.getElementById('sec-stat-pass-rate');

  if (totalScans) totalScans.textContent = stats.totalScans;
  if (totalVulns) totalVulns.textContent = stats.totalVulnerabilities;
  if (criticalCount) criticalCount.textContent = stats.bySeverity?.critical || 0;

  if (passRate) {
    const rate = stats.totalScans > 0
      ? ((stats.passedScans / stats.totalScans) * 100).toFixed(1)
      : 0;
    passRate.textContent = rate + '%';

    // Color based on rate
    if (parseFloat(rate) >= 80) {
      passRate.className = 'text-3xl font-bold text-green-600';
    } else if (parseFloat(rate) >= 50) {
      passRate.className = 'text-3xl font-bold text-yellow-600';
    } else {
      passRate.className = 'text-3xl font-bold text-red-600';
    }
  }
}

// Render severity distribution chart
function renderSecuritySeverityChart(stats) {
  const ctx = document.getElementById('security-severity-chart');
  if (!ctx) return;

  if (securitySeverityChart) {
    securitySeverityChart.destroy();
  }

  const bySeverity = stats.bySeverity || { critical: 0, high: 0, medium: 0, low: 0 };

  securitySeverityChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Critical', 'High', 'Medium', 'Low'],
      datasets: [{
        data: [bySeverity.critical, bySeverity.high, bySeverity.medium, bySeverity.low],
        backgroundColor: ['#DC2626', '#F97316', '#EAB308', '#22C55E'],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom'
        }
      }
    }
  });
}

// Render security trend chart
function renderSecurityTrendChart(history) {
  const ctx = document.getElementById('security-trend-chart');
  if (!ctx) return;

  if (securityTrendChart) {
    securityTrendChart.destroy();
  }

  // Group by date (last 14 days)
  const dailyData = new Map();
  const now = new Date();

  // Initialize last 14 days
  for (let i = 13; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    dailyData.set(dateStr, { vulnerabilities: 0, scans: 0 });
  }

  // Aggregate history
  history.forEach(scan => {
    const dateStr = new Date(scan.timestamp).toISOString().split('T')[0];
    if (dailyData.has(dateStr)) {
      const data = dailyData.get(dateStr);
      data.scans++;
      data.vulnerabilities += scan.summary?.total || 0;
    }
  });

  const labels = Array.from(dailyData.keys()).map(d =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  );
  const vulnData = Array.from(dailyData.values()).map(d => d.vulnerabilities);
  const scanData = Array.from(dailyData.values()).map(d => d.scans);

  securityTrendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Vulnerabilities',
          data: vulnData,
          borderColor: '#DC2626',
          backgroundColor: 'rgba(220, 38, 38, 0.1)',
          tension: 0.3,
          yAxisID: 'y'
        },
        {
          label: 'Scans',
          data: scanData,
          borderColor: '#3B82F6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          tension: 0.3,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      scales: {
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          beginAtZero: true,
          title: { display: true, text: 'Vulnerabilities' }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          title: { display: true, text: 'Scans' }
        }
      }
    }
  });
}

// Render top vulnerabilities table
function renderTopVulnerabilities(history) {
  const tbody = document.getElementById('top-vulnerabilities-body');
  if (!tbody) return;

  // Aggregate all vulnerabilities from history
  const vulnCounts = new Map();

  history.forEach(scan => {
    if (scan.vulnerabilities && Array.isArray(scan.vulnerabilities)) {
      scan.vulnerabilities.forEach(vuln => {
        const key = vuln.ruleId || vuln.type;
        if (!vulnCounts.has(key)) {
          vulnCounts.set(key, {
            ruleId: key,
            title: vuln.message || vuln.title || key,
            severity: vuln.severity,
            count: 0
          });
        }
        vulnCounts.get(key).count++;
      });
    }
  });

  // Sort by count and take top 10
  const topVulns = Array.from(vulnCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  if (topVulns.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center p-4 aero-text-muted">No vulnerabilities found</td></tr>';
    return;
  }

  tbody.innerHTML = topVulns.map(vuln => `
    <tr class='border-b aero-divider hover:bg-blue-50'>
      <td class='p-2 font-mono text-sm'>${vuln.ruleId}</td>
      <td class='p-2'>${vuln.title}</td>
      <td class='p-2'>
        <span class='security-severity-badge security-severity-${vuln.severity.toLowerCase()}'>
          ${vuln.severity}
        </span>
      </td>
      <td class='p-2 font-semibold'>${vuln.count}</td>
    </tr>
  `).join('');
}

// Render compliance score widget
function renderComplianceScore(stats) {
  const scoreEl = document.getElementById('compliance-score');
  const gaugeEl = document.getElementById('compliance-gauge');

  if (!scoreEl || !gaugeEl) return;

  // Calculate compliance score based on vulnerabilities
  // Perfect score = 100, deduct points for each severity
  let score = 100;
  const bySeverity = stats.bySeverity || {};

  score -= (bySeverity.critical || 0) * 25;  // Critical: -25 each
  score -= (bySeverity.high || 0) * 10;      // High: -10 each
  score -= (bySeverity.medium || 0) * 3;     // Medium: -3 each
  score -= (bySeverity.low || 0) * 1;        // Low: -1 each

  score = Math.max(0, Math.min(100, score));

  scoreEl.textContent = Math.round(score);

  // Update gauge color
  if (score >= 80) {
    scoreEl.className = 'text-4xl font-bold text-green-600';
    gaugeEl.style.background = `conic-gradient(#22C55E ${score}%, #E5E7EB ${score}%)`;
  } else if (score >= 50) {
    scoreEl.className = 'text-4xl font-bold text-yellow-600';
    gaugeEl.style.background = `conic-gradient(#EAB308 ${score}%, #E5E7EB ${score}%)`;
  } else {
    scoreEl.className = 'text-4xl font-bold text-red-600';
    gaugeEl.style.background = `conic-gradient(#DC2626 ${score}%, #E5E7EB ${score}%)`;
  }
}

// Export functions
window.openReportingDashboard = openReportingDashboard;
window.closeDashboard = closeDashboard;
window.refreshDashboard = refreshDashboard;
window.refreshStorageDashboard = refreshStorageDashboard;
window.viewSuiteHistory = viewSuiteHistory;
window.openSuiteHistoryModal = openSuiteHistoryModal;
window.closeSuiteHistoryModal = closeSuiteHistoryModal;
window.switchDashboardTab = switchDashboardTab;
window.refreshSecurityDashboard = refreshSecurityDashboard;
window.updateStorageSettingsVisibility = updateStorageSettingsVisibility;
window.saveStoragePreferencesFromDashboard = saveStoragePreferencesFromDashboard;
window.restoreDefaultStoragePreferences = restoreDefaultStoragePreferences;
window.runStorageCleanupNow = runStorageCleanupNow;
window.deleteSessionExportFromDashboard = deleteSessionExportFromDashboard;
window.triggerStorageImportOldData = triggerStorageImportOldData;
window.triggerStorageImportJsonFile = triggerStorageImportJsonFile;
window.triggerStorageImportSessionFolder = triggerStorageImportSessionFolder;

