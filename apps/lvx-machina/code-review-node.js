/**
 * Code Review & Iteration Node — Interactive Modal
 *
 * This file implements the full-screen review/generation modal with:
 * - Monaco editor for source code (left panel)
 * - Monaco diff editor for showing AI suggestions (bottom panel)
 * - Live preview iframe for HTML/CSS/JS (right panel)
 * - Prompt input bar
 * - Accept / Retry / Iterate / Reject buttons
 * - History dot-bar for navigating past suggestions
 * - Deploy button to hand off to push-deploy node
 */

// State object for tracking the review session
// {
//   currentCode: string,
//   history: Array<{ prompt, originalCode, suggestedCode, timestamp, status }>,
//   currentIndex: number,
//   language: string,
//   mode: 'review' | 'generate'
// }

const activeCodeReviewSessions = new Map();

function escapeCodeReviewHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function updateCodeReviewMinimizeBarVisibility() {
  const container = document.getElementById('minimize-bar-items-container');
  const bar = document.getElementById('minimize-bar');
  if (!container || !bar) return;

  if (container.children.length === 0) {
    bar.classList.add('hidden');
    document.body.style.paddingBottom = '0';
  } else {
    bar.classList.remove('hidden');
    document.body.style.paddingBottom = '4rem';
  }
}

function removeCodeReviewMinimizeItem(sessionId) {
  const item = document.getElementById(`minimized-code-review-${sessionId}`);
  if (item) item.remove();
  updateCodeReviewMinimizeBarVisibility();
}

function ensureCodeReviewMinimizeItem(sessionId) {
  const session = activeCodeReviewSessions.get(sessionId);
  if (!session) return;

  const container = document.getElementById('minimize-bar-items-container');
  if (!container) return;

  let item = document.getElementById(`minimized-code-review-${sessionId}`);
  if (!item) {
    item = document.createElement('div');
    item.className = 'minimized-test-item';
    item.id = `minimized-code-review-${sessionId}`;
    item.onclick = (event) => {
      if (event.target.closest('.close-btn')) return;
      window.restoreCodeReviewSession(sessionId);
    };
    item.innerHTML = `
      <span class="font-semibold">${escapeCodeReviewHtml(session.displayName)}</span>
      <button class="close-btn" title="Close Editor" onclick="event.stopPropagation(); window.closeCodeReviewSession('${sessionId}')">
        &times;
      </button>
    `;
    container.appendChild(item);
  }

  updateCodeReviewMinimizeBarVisibility();
}

window.minimizeCodeReviewSession = function (sessionId) {
  const session = activeCodeReviewSessions.get(sessionId);
  if (!session) return;

  ensureCodeReviewMinimizeItem(sessionId);
  session.modal.classList.add('hidden');
  session.isMinimized = true;
};

window.restoreCodeReviewSession = function (sessionId) {
  const session = activeCodeReviewSessions.get(sessionId);
  if (!session) return;

  session.modal.classList.remove('hidden');
  session.isMinimized = false;
};

window.closeCodeReviewSession = function (sessionId) {
  const session = activeCodeReviewSessions.get(sessionId);
  if (!session) return;
  session.finish({ status: 'cancelled' });
};

function openCodeReviewModal(nodeConfig, pipelineContext, onComplete) {
  const sessionId = `code_review_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const state = {
    currentCode: nodeConfig.lastGeneratedCode || nodeConfig.sourceCode || '',
    history: Array.isArray(nodeConfig.history) ? [...nodeConfig.history] : [],
    currentIndex: Array.isArray(nodeConfig.history) && nodeConfig.history.length > 0 ? nodeConfig.history.length - 1 : -1,
    language: nodeConfig.language || 'html',
    mode: nodeConfig.mode || 'review'
  };
  let finished = false;
  let autoSendTriggered = false;

  // --- BUILD MODAL DOM ---
  const modal = document.createElement('div');
  modal.id = 'code-review-modal';
  modal.className = 'fixed inset-0 z-[9999] flex flex-col bg-gray-900';
  modal.innerHTML = `
    <!-- Title Bar -->
    <div class="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
      <div class="flex items-center gap-2">
        <span class="text-white font-semibold">Code Review & Iteration</span>
        <span id="cr-mode-badge" class="px-2 py-0.5 text-xs rounded ${state.mode === 'review' ? 'bg-blue-600' : 'bg-green-600'} text-white">
          ${state.mode === 'review' ? 'REVIEW MODE' : 'GENERATE MODE'}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <button id="cr-deploy-btn" class="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded">Deploy</button>
        <button id="cr-done-btn" class="px-3 py-1 bg-green-600 hover:bg-green-500 text-white text-sm rounded">Done</button>
        <button id="cr-minimize-btn" class="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white text-sm rounded" title="Minimize">_</button>
        <button id="cr-close-btn" class="px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white text-sm rounded">X</button>
      </div>
    </div>

    <!-- Main Content Area -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Left: Source Code Editor -->
      <div class="flex flex-col w-1/2 border-r border-gray-700">
        <div class="px-3 py-1 bg-gray-800 text-gray-400 text-xs font-mono">SOURCE CODE</div>
        <div id="cr-source-editor" class="flex-1"></div>
      </div>

      <!-- Right: Live Preview -->
      <div class="flex flex-col w-1/2">
        <div class="px-3 py-1 bg-gray-800 text-gray-400 text-xs font-mono">LIVE PREVIEW</div>
        <iframe id="cr-preview-iframe" class="flex-1 bg-white" sandbox="allow-scripts allow-same-origin"></iframe>
        <!-- Fallback for non-web languages -->
        <div id="cr-preview-text" class="flex-1 bg-gray-950 text-gray-300 p-4 font-mono text-sm overflow-auto hidden"></div>
      </div>
    </div>

    <!-- Prompt Bar -->
    <div class="flex items-center gap-2 px-4 py-2 bg-gray-800 border-t border-gray-700">
      <span class="text-gray-400 text-sm">${state.mode === 'review' ? 'Describe changes:' : 'Describe what to build:'}</span>
      <input id="cr-prompt-input" type="text" class="flex-1 px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm" placeholder="${state.mode === 'review' ? 'e.g. Make the header sticky and add a dark mode toggle...' : 'e.g. A responsive landing page with hero section and pricing cards...'}">
      <button id="cr-send-btn" class="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded font-semibold">Send to AI</button>
    </div>

    <!-- Diff View -->
    <div class="flex flex-col h-64 border-t border-gray-700">
      <div class="px-3 py-1 bg-gray-800 text-gray-400 text-xs font-mono flex items-center justify-between">
        <span id="cr-diff-label">SUGGESTION (none yet)</span>
        <div id="cr-action-buttons" class="flex gap-2 hidden">
          <button id="cr-accept-btn" class="px-3 py-1 bg-green-600 hover:bg-green-500 text-white text-xs rounded">Accept</button>
          <button id="cr-retry-btn" class="px-3 py-1 bg-yellow-600 hover:bg-yellow-500 text-white text-xs rounded">Retry</button>
          <button id="cr-iterate-btn" class="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded">Iterate</button>
          <button id="cr-reject-btn" class="px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded">Reject</button>
        </div>
      </div>
      <div id="cr-diff-view" class="flex-1"></div>
    </div>

    <!-- History Bar -->
    <div class="flex items-center gap-1 px-4 py-2 bg-gray-850 border-t border-gray-700 overflow-x-auto">
      <span class="text-gray-500 text-xs mr-2">HISTORY:</span>
      <div id="cr-history-bar" class="flex items-center gap-1"></div>
    </div>

    <!-- Loading Overlay -->
    <div id="cr-loading" class="absolute top-14 left-0 right-0 flex justify-center pointer-events-none hidden z-40">
      <div class="px-5 py-2 rounded-full border border-sky-400/40 bg-gray-900/85 shadow-[0_0_20px_rgba(56,189,248,0.18)] animate-pulse">
        <div class="text-sm font-semibold bg-gradient-to-r from-sky-200 via-cyan-300 to-sky-100 bg-clip-text text-transparent tracking-wide">
          Waiting for AI response...
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  const promptInput = document.getElementById('cr-prompt-input');
  const sendButton = document.getElementById('cr-send-btn');
  if (nodeConfig.instructions) {
    promptInput.value = nodeConfig.instructions;
  }
  const displayName = nodeConfig.name || (state.mode === 'review' ? 'Code Review & Iteration' : 'Website Iteration');

  const finish = (result) => {
    if (finished) return;
    finished = true;
    onComplete(result);
    cleanup();
  };

  activeCodeReviewSessions.set(sessionId, {
    id: sessionId,
    displayName,
    modal,
    isMinimized: false,
    finish
  });

  // --- INITIALIZE MONACO EDITORS ---
  // Source editor (editable)
  const sourceEditor = monaco.editor.create(document.getElementById('cr-source-editor'), {
    value: state.currentCode,
    language: state.language,
    theme: 'vs-dark',
    minimap: { enabled: false },
    fontSize: 13,
    wordWrap: 'on'
  });

  // Diff editor (read-only, shows original vs suggested)
  const diffEditor = monaco.editor.createDiffEditor(document.getElementById('cr-diff-view'), {
    theme: 'vs-dark',
    readOnly: true,
    minimap: { enabled: false },
    fontSize: 12,
    renderSideBySide: true
  });

  // --- LIVE PREVIEW ---
  function updatePreview(code) {
    const iframe = document.getElementById('cr-preview-iframe');
    const textPreview = document.getElementById('cr-preview-text');

    if (['html', 'css', 'javascript'].includes(state.language)) {
      iframe.classList.remove('hidden');
      textPreview.classList.add('hidden');

      let previewContent = code;
      if (state.language === 'css') {
        previewContent = `<html><head><style>${code}</style></head><body><p>CSS Preview</p></body></html>`;
      } else if (state.language === 'javascript') {
        previewContent = `<html><body><script>${code}<\/script><pre id="out"></pre></body></html>`;
      }
      iframe.srcdoc = previewContent;
    } else {
      iframe.classList.add('hidden');
      textPreview.classList.remove('hidden');
      textPreview.textContent = code;
    }
  }

  // Initialize preview with current code
  updatePreview(state.currentCode);

  // --- AI REQUEST ---
  async function requestAISuggestion(prompt, currentCode) {
    const systemPrompt = state.mode === 'review'
      ? `You are a code reviewer. The user will give you ${state.language} code and describe changes they want. Return ONLY the complete modified code. No markdown fences. No explanations. Just the raw code.`
      : `You are a code generator. Generate ${state.language} code based on the user's description. Return ONLY the complete code. No markdown fences. No explanations. Just the raw code.`;

    let userPrompt;
    if (state.mode === 'review' || currentCode.trim()) {
      userPrompt = `${prompt}\n\nHere is the current code:\n${currentCode}`;
    } else {
      userPrompt = prompt;
    }

    const response = await window.electronAPI.aiOps.generate({
      provider: nodeConfig.provider || 'google',
      model: nodeConfig.model || 'gemini-2.0-flash',
      apiKey: nodeConfig.apiKey,
      systemPrompt: systemPrompt,
      prompt: userPrompt,
      maxTokens: 8192
    });

    // Strip markdown code fences if AI included them despite instructions
    let text = response?.text || response?.generatedText || response;
    if (typeof text === 'string') {
      text = text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
    }
    return text;
  }

  // --- HISTORY BAR ---
  function updateHistoryBar() {
    const bar = document.getElementById('cr-history-bar');
    bar.innerHTML = state.history.map((entry, i) => {
      const isActive = i === state.currentIndex;
      const statusColors = {
        pending: 'bg-yellow-500',
        accepted: 'bg-green-500',
        rejected: 'bg-red-500',
        iterated: 'bg-blue-500'
      };
      const color = statusColors[entry.status] || 'bg-gray-500';
      return `<button class="px-2 py-1 text-xs rounded ${isActive ? 'ring-2 ring-white' : ''} ${color} text-white hover:opacity-80"
                      onclick="window._crNavigateHistory(${i})"
                      title="${entry.prompt.substring(0, 80)}">#${i + 1}</button>`;
    }).join('');
  }

  // --- SHOW DIFF ---
  function showDiff(originalCode, suggestedCode) {
    diffEditor.setModel({
      original: monaco.editor.createModel(originalCode, state.language),
      modified: monaco.editor.createModel(suggestedCode, state.language)
    });
    document.getElementById('cr-diff-label').textContent = `SUGGESTION #${state.currentIndex + 1}`;
    document.getElementById('cr-action-buttons').classList.remove('hidden');
  }

  // --- BUTTON HANDLERS ---

  async function generateSuggestion(prompt, baseCode) {
    if (!prompt) return;

    document.getElementById('cr-loading').classList.remove('hidden');

    try {
      const suggestion = await requestAISuggestion(prompt, baseCode);

      state.history.push({
        prompt,
        originalCode: baseCode,
        suggestedCode: suggestion,
        timestamp: new Date().toISOString(),
        status: 'pending'
      });
      state.currentIndex = state.history.length - 1;

      showDiff(baseCode, suggestion);
      updatePreview(suggestion);
      updateHistoryBar();
    } catch (err) {
      const errorMessage = err?.message || String(err);
      alert('AI request failed: ' + errorMessage);
    } finally {
      document.getElementById('cr-loading').classList.add('hidden');
    }
  }

  // SEND
  sendButton.onclick = async () => {
    state.currentCode = sourceEditor.getValue();
    const prompt = promptInput.value.trim();
    await generateSuggestion(prompt, state.currentCode);
  };

  // Also allow Enter key to send
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendButton.click();
    }
  });

  // ACCEPT — apply suggestion as the new source code
  document.getElementById('cr-accept-btn').onclick = () => {
    const entry = state.history[state.currentIndex];
    if (!entry) return;
    entry.status = 'accepted';
    state.currentCode = entry.suggestedCode;
    sourceEditor.setValue(state.currentCode);
    updatePreview(state.currentCode);
    updateHistoryBar();
    promptInput.value = '';
  };

  // RETRY — same prompt, new AI generation
  document.getElementById('cr-retry-btn').onclick = async () => {
    const entry = state.history[state.currentIndex];
    if (!entry) return;
    entry.status = 'rejected';
    updateHistoryBar();
    promptInput.value = entry.prompt;
    await generateSuggestion(entry.prompt, entry.originalCode);
  };

  // ITERATE — accept current suggestion, then continue editing
  document.getElementById('cr-iterate-btn').onclick = async () => {
    const entry = state.history[state.currentIndex];
    if (!entry) return;
    entry.status = 'iterated';
    state.currentCode = entry.suggestedCode;
    sourceEditor.setValue(state.currentCode);
    updatePreview(state.currentCode);
    updateHistoryBar();
    const nextPrompt = promptInput.value.trim();
    if (nextPrompt) {
      await generateSuggestion(nextPrompt, state.currentCode);
      return;
    }
    promptInput.value = '';
    promptInput.focus();
  };

  // REJECT — discard suggestion, keep current code
  document.getElementById('cr-reject-btn').onclick = () => {
    const entry = state.history[state.currentIndex];
    if (!entry) return;
    entry.status = 'rejected';
    updatePreview(state.currentCode);
    updateHistoryBar();
  };

  // HISTORY NAVIGATION (exposed globally for onclick)
  window._crNavigateHistory = (index) => {
    state.currentIndex = index;
    const entry = state.history[index];
    showDiff(entry.originalCode, entry.suggestedCode);
    updatePreview(entry.suggestedCode);
    updateHistoryBar();
  };

  // DEPLOY — hand off final code
  document.getElementById('cr-deploy-btn').onclick = () => {
    state.currentCode = sourceEditor.getValue();
    finish({
      status: 'completed',
      finalCode: state.currentCode,
      language: state.language,
      history: state.history,
      prompt: promptInput.value.trim(),
      action: 'deploy'
    });
  };

  // DONE — finish without deploy
  document.getElementById('cr-done-btn').onclick = () => {
    state.currentCode = sourceEditor.getValue();
    finish({
      status: 'completed',
      finalCode: state.currentCode,
      language: state.language,
      history: state.history,
      prompt: promptInput.value.trim(),
      action: 'done'
    });
  };

  document.getElementById('cr-minimize-btn').onclick = () => {
    window.minimizeCodeReviewSession(sessionId);
  };

  // CLOSE — cancel
  document.getElementById('cr-close-btn').onclick = () => {
    finish({ status: 'cancelled' });
  };

  function cleanup() {
    activeCodeReviewSessions.delete(sessionId);
    removeCodeReviewMinimizeItem(sessionId);
    sourceEditor.dispose();
    diffEditor.dispose();
    delete window._crNavigateHistory;
    modal.remove();
  }

  if (nodeConfig.autoSendOnOpen && promptInput.value.trim()) {
    setTimeout(() => {
      if (finished || autoSendTriggered || !activeCodeReviewSessions.has(sessionId)) return;
      autoSendTriggered = true;
      sendButton.click();
    }, Math.max(0, parseInt(nodeConfig.autoSendDelayMs, 10) || 75));
  }
}

// Export for use in pipeline-manager.js
window.openCodeReviewModal = openCodeReviewModal;
