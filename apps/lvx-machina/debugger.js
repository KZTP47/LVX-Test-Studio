class TestDebugger {
  constructor() {
    this.isActive = false;
    this.isPaused = false;
    this.currentStepIndex = -1;
    this.steps = [];
    this.breakpoints = new Set();
    this.variables = new Map();
    this.stepCallback = null;
    this.pauseResolve = null;
    this.lastError = null;
  }

  // Initialize debug session
  startDebugSession(steps, onStepExecuted) {
    this.isActive = true;
    this.isPaused = false;
    this.currentStepIndex = -1;
    this.steps = steps;
    this.stepCallback = onStepExecuted;
    this.variables.clear();
    this.lastError = null;

    console.log('🐛 Debug session started with', steps.length, 'steps');
  }

  // Stop debug session
  stopDebugSession() {
    this.isActive = false;
    this.isPaused = false;
    this.currentStepIndex = -1;
    this.steps = [];
    this.stepCallback = null;
    this.lastError = null;

    if (this.pauseResolve) {
      this.pauseResolve();
      this.pauseResolve = null;
    }

    console.log('🐛 Debug session stopped');
  }

  // Execute next step
  async executeNextStep() {
    if (!this.isActive) return null;

    this.currentStepIndex++;

    if (this.currentStepIndex >= this.steps.length) {
      console.log('🐛 All steps executed');
      return null;
    }

    const step = this.steps[this.currentStepIndex];

    // Check if breakpoint
    if (this.breakpoints.has(this.currentStepIndex)) {
      console.log('🔴 Breakpoint hit at step', this.currentStepIndex);
      await this.pause();
    }

    // Update UI
    if (this.stepCallback) {
      this.stepCallback(this.currentStepIndex, step, 'executing');
    }

    return step;
  }

  // Pause execution
  async pause() {
    if (this.isPaused) return;

    this.isPaused = true;
    console.log('⏸️ Execution paused');

    // Wait for resume
    await new Promise(resolve => {
      this.pauseResolve = resolve;
    });

    this.isPaused = false;
    console.log('▶️ Execution resumed');
  }

  // Resume execution
  resume() {
    if (!this.isPaused || !this.pauseResolve) return;

    this.pauseResolve();
    this.pauseResolve = null;
  }

  // Step over (execute current step and pause)
  async stepOver() {
    this.resume();
    // Execution will pause after current step completes
    await new Promise(resolve => setTimeout(resolve, 100));
    await this.pause();
  }

  // Set variable value
  setVariable(name, value) {
    this.variables.set(name, value);
    console.log('🔧 Variable set:', name, '=', value);
  }

  // Get variable value
  getVariable(name) {
    return this.variables.get(name);
  }

  // Get all variables
  getAllVariables() {
    return Object.fromEntries(this.variables);
  }

  // Toggle breakpoint
  toggleBreakpoint(stepIndex) {
    if (this.breakpoints.has(stepIndex)) {
      this.breakpoints.delete(stepIndex);
      console.log('🔴 Breakpoint removed at step', stepIndex);
      return false;
    } else {
      this.breakpoints.add(stepIndex);
      console.log('🔴 Breakpoint set at step', stepIndex);
      return true;
    }
  }

  // Clear all breakpoints
  clearBreakpoints() {
    this.breakpoints.clear();
    console.log('🔴 All breakpoints cleared');
  }

  // Check if at breakpoint
  isAtBreakpoint(stepIndex) {
    return this.breakpoints.has(stepIndex);
  }

  // Get current step
  getCurrentStep() {
    return this.steps[this.currentStepIndex];
  }

  // Get current step index
  getCurrentStepIndex() {
    return this.currentStepIndex;
  }

  // Skip to step
  skipToStep(stepIndex) {
    if (stepIndex >= 0 && stepIndex < this.steps.length) {
      this.currentStepIndex = stepIndex - 1; // Will increment on next executeNextStep
      console.log('⏩ Skipped to step', stepIndex);
    }
  }

  // Capture error details
  captureError(error, stepIndex, step) {
    const errorInfo = {
      message: error.message,
      stack: error.stack,
      stepIndex,
      stepName: step.name,
      stepParams: step.params,
      timestamp: new Date().toISOString(),
      variables: this.getAllVariables()
    };

    this.lastError = errorInfo;
    return errorInfo;
  }

  // Get last error
  getLastError() {
    return this.lastError;
  }
}

// --- Debug UI Functions ---

function updateDebugUI(stepIndex, step, status) {
  const stepNumEl = document.getElementById('debug-step-number');
  const totalStepsEl = document.getElementById('debug-total-steps');
  const currentStepEl = document.getElementById('debug-current-step');

  if (stepNumEl) stepNumEl.textContent = stepIndex + 1;
  if (totalStepsEl) totalStepsEl.textContent = window.testDebugger.steps.length;
  if (currentStepEl) currentStepEl.textContent = step ? step.name : 'Not started';

  // Highlight current step in canvas
  if (window.vwt_renderCanvas) window.vwt_renderCanvas();
}

function updateDebugStatus(status) {
  const statusEl = document.getElementById('debug-status');
  if (!statusEl) return;

  const badges = {
    'Ready': 'info',
    'Running': 'success',
    'Paused': 'warning',
    'Completed': 'success',
    'Error': 'error',
    'Stopped': 'danger'
  };

  const badgeType = badges[status] || 'info';
  statusEl.innerHTML = `<span class='aero-badge-${badgeType}'>${status}</span>`;
}

function updateDebugBreakpointsList() {
  const container = document.getElementById('debug-breakpoints-list');
  if (!container) return;

  const breakpoints = Array.from(window.testDebugger.breakpoints);

  if (breakpoints.length === 0) {
    container.innerHTML = '<div class="aero-text-muted">No breakpoints set</div>';
    return;
  }

  container.innerHTML = breakpoints.sort((a, b) => a - b).map(index => {
    const step = window.testDebugger.steps[index];
    return `
      <div class='flex justify-between items-center p-1 aero-button rounded text-xs mb-1'>
        <span>Step ${index + 1}: ${step?.name || 'Unknown'}</span>
        <button onclick='toggleStepBreakpoint(${index})' class='text-red-500 hover:text-red-700'>×</button>
      </div>
    `;
  }).join('');
}

function updateDebugVariablesList() {
  const container = document.getElementById('debug-variables-list');
  if (!container) return;

  const variables = window.testDebugger.getAllVariables();
  const entries = Object.entries(variables);

  if (entries.length === 0) {
    container.innerHTML = '<div class="aero-text-muted">No variables captured</div>';
    return;
  }

  container.innerHTML = entries.map(([key, value]) => `
    <div class='p-1 aero-button rounded mb-1'>
      <div class='font-mono font-semibold text-xs'>${key}</div>
      <div class='aero-text-muted break-all text-xs'>${String(value).substring(0, 50)}${String(value).length > 50 ? '...' : ''}</div>
    </div>
  `).join('');
}

function displayDebugError(errorInfo) {
  const panel = document.getElementById('debug-error-panel');
  const message = document.getElementById('debug-error-message');
  const stack = document.getElementById('debug-error-stack');

  if (!panel || !message || !stack) return;

  panel.classList.remove('hidden');
  message.textContent = `Step ${errorInfo.stepIndex + 1} (${errorInfo.stepName}): ${errorInfo.message}`;
  stack.textContent = errorInfo.stack || 'No stack trace available';

  // Log error details
  console.error('Test Error:', errorInfo);
}

// --- Debug Control Functions ---

function debugStepOver() {
  window.testDebugger.resume();
  updateDebugStatus('Running');

  // Will auto-pause after step completes (handled in runTestInDebugMode)
}

function debugResume() {
  window.testDebugger.resume();
  updateDebugStatus('Running');

  // Disable resume, enable pause
  const resumeBtn = document.getElementById('debug-resume-btn');
  const pauseBtn = document.getElementById('debug-pause-btn');
  if (resumeBtn) resumeBtn.disabled = true;
  if (pauseBtn) pauseBtn.disabled = false;
}

function debugPause() {
  window.testDebugger.pause();
  updateDebugStatus('Paused');

  // Enable resume, disable pause
  const resumeBtn = document.getElementById('debug-resume-btn');
  const pauseBtn = document.getElementById('debug-pause-btn');
  if (resumeBtn) resumeBtn.disabled = false;
  if (pauseBtn) pauseBtn.disabled = true;
}

function debugStop() {
  if (confirm('Stop debugging? This will terminate the current test execution.')) {
    window.testDebugger.stopDebugSession();
    updateDebugStatus('Stopped');

    // Disable all debug controls
    const stepBtn = document.getElementById('debug-step-btn');
    const resumeBtn = document.getElementById('debug-resume-btn');
    const pauseBtn = document.getElementById('debug-pause-btn');

    if (stepBtn) stepBtn.disabled = true;
    if (resumeBtn) resumeBtn.disabled = true;
    if (pauseBtn) pauseBtn.disabled = true;

    // Clear debug display
    const currentStepEl = document.getElementById('debug-current-step');
    const stepNumEl = document.getElementById('debug-step-number');

    if (currentStepEl) currentStepEl.textContent = 'Not started';
    if (stepNumEl) stepNumEl.textContent = '0';

    if (window.showMessage) window.showMessage('Debug session stopped', 'info');
  }
}

// Keyboard shortcuts for debugging
document.addEventListener('keydown', function (e) {
  if (!window.testDebugger || !window.testDebugger.isActive) return;

  if (e.key === 'F10') {
    e.preventDefault();
    debugStepOver();
  } else if (e.key === 'F5') {
    e.preventDefault();
    debugResume();
  }
});

// Export
window.TestDebugger = TestDebugger;
window.testDebugger = new TestDebugger();

window.updateDebugUI = updateDebugUI;
window.updateDebugStatus = updateDebugStatus;
window.updateDebugBreakpointsList = updateDebugBreakpointsList;
window.updateDebugVariablesList = updateDebugVariablesList;
window.displayDebugError = displayDebugError;
window.debugStepOver = debugStepOver;
window.debugResume = debugResume;
window.debugPause = debugPause;
window.debugStop = debugStop;
