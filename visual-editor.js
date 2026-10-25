/** Complete Machina visual authoring; executable actions are delegated to native Studio services. */
function renderNodeIcon(key, size = 16) {
 const names={'git':'branch','terminal':'code','zap':'bolt','clipboard-check':'check','code-review':'eye','message-circle':'file','rocket':'upload','web-audit':'globe','minimize':'minus'};
 const name=String(key||'network').replace(/^svg:/,'');
 return window.LVXIcons?.svg(names[name]||name)||'';
}
class VisualEditor {
    constructor(containerId) {
        this.containerId = containerId;
        this.nodes = [];
        this.edges = [];
        this.scale = 1;
        this.panning = { x: 0, y: 0 };
        this.graphOrigin = { x: 0, y: 0 };
        this.graphOriginInitialized = false;
        this.viewportSize = { width: 0, height: 0 };
        this.activeTool = 'select';
        this.isPanning = false;
        this.panStart = null;
        this.dragOffset = { x: 0, y: 0 };
        this.selectedNode = null;
        this.selectedNodeId = null;
        this.dragStartPosition = null;
        this.activeConnection = null; // { sourceNodeId, currentX, currentY }
        this.historyStack = [];
        this.redoStack = [];
        this.historyLimit = 100;

        // DOM Elements
        this.container = null;
        this.canvas = null;
        this.viewport = null;
        this.svgLayer = null;
        this.nodeLayer = null;

        // Callbacks
        this.onSave = null;
        this.availableSuites = []; // Populate with test suites to drag in
    }

    /**
     * Clears all nodes and edges, resetting the editor state.
     * Call this before loading a new pipeline to ensure isolation.
     */
    clear() {
        this.nodes = [];
        this.edges = [];
        this.graphMetadata = {};
        this.selectedNode = null;
        this.selectedNodeId = null;
        this.dragStartPosition = null;
        this.activeConnection = null;
        this.historyStack = [];
        this.redoStack = [];
    }

    init() {
        this.container = document.getElementById(this.containerId);
        if (!this.container) throw new Error(`Container ${this.containerId} not found`);

        // Reset state to ensure clean slate for new/different pipeline
        this.clear();
        this.scale = 1;
        this.panning = { x: 0, y: 0 };
        this.graphOrigin = { x: 0, y: 0 };
        this.graphOriginInitialized = false;
        this.viewportSize = { width: 0, height: 0 };
        this.activeTool = 'select';
        this.isPanning = false;
        this.panStart = null;
        this.dragOffset = { x: 0, y: 0 };

        this.container.innerHTML = '';
        this.container.classList.add('visual-editor-container');

        // Create Top Action Bar for creating new tests
        this._renderTopActionBar();

        // Create Layers
        this.canvas = document.createElement('div');
        this.canvas.className = 've-canvas';

        this.viewport = document.createElement('div');
        this.viewport.className = 've-viewport';

        // SVG Layer for lines (z-index: 0)
        this.svgLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        this.svgLayer.classList.add('ve-svg-layer');
        this.svgLayer.style.pointerEvents = 'auto';

        // Node Layer (z-index: 1)
        this.nodeLayer = document.createElement('div');
        this.nodeLayer.className = 've-node-layer';
        this.nodeLayer.style.pointerEvents = 'none';

        this.viewport.appendChild(this.svgLayer);
        this.viewport.appendChild(this.nodeLayer);
        this.canvas.appendChild(this.viewport);
        this.container.appendChild(this.canvas);

        // Sidebar for Tools (Optional, can be external)
        this._renderToolbar();
        this._applyViewportTransform();

        // Event Listeners
        this._bindEvents();
        this._resetHistory();
    }

    // Top action bar for creating new tests directly from graph view
    _renderTopActionBar() {
        const actionBar = document.createElement('div');
        actionBar.className = 've-top-action-bar';
        // Changed to floating panel style to avoid overlap and match sidebar design
        actionBar.style.cssText = 'position: absolute; top: 20px; left: 290px; width: fit-content; display: flex; gap: 10px; padding: 10px; background: rgba(255, 255, 255, 0.9); backdrop-filter: blur(10px); border: 1px solid #fff; border-radius: 8px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1); z-index: 30; pointer-events: auto; justify-content: flex-start; align-items: center;';

        actionBar.innerHTML = `
            <button id="ve-create-visual-test-btn" class="aero-button-primary py-2 px-4 rounded-lg shadow-lg transition duration-200" style="font-size: 0.9rem;">
                 Create Visual Web Test
            </button>
            <button id="ve-add-test-suite-btn" class="aero-button-success py-2 px-4 rounded-lg shadow-lg transition duration-200" style="font-size: 0.9rem;">
                 Add New Test Suite
            </button>
        `;

        this.container.appendChild(actionBar);

        // Bind button events
        const visualTestBtn = actionBar.querySelector('#ve-create-visual-test-btn');
        if (visualTestBtn) {
            visualTestBtn.onclick = (e) => {
                e.preventDefault();
                console.log("Create Visual Web Test clicked from graph view");
                if (this.onCreateVisualTest) this.onCreateVisualTest();
            };
        }

        const addSuiteBtn = actionBar.querySelector('#ve-add-test-suite-btn');
        if (addSuiteBtn) {
            addSuiteBtn.onclick = (e) => {
                e.preventDefault();
                console.log("Add New Test Suite clicked from graph view");
                if (this.onAddTestSuite) this.onAddTestSuite();
            };
        }
    }

    // Calculate position for a new node (standalone, to the right of existing nodes)
    _calculateNewNodePosition() {
        if (this.nodes.length === 0) {
            return { x: 180, y: 100 };
        }

        // Find the rightmost node
        let maxX = 0;
        let avgY = 0;
        this.nodes.forEach(node => {
            // Check both root x/y (legacy/flat) and position.x/y (nested)
            const x = node.position ? node.position.x : (node.x || 0);
            const y = node.position ? node.position.y : (node.y || 0);

            if (x > maxX) maxX = x;
            avgY += y;
        });
        avgY = avgY / this.nodes.length;

        // Place new node 350px to the right of rightmost node (increased spacing)
        return { x: maxX + 350, y: Math.max(100, avgY) };
    }

    // Add a test suite as a new node in the graph
    addTestNode(suite) {
        if (!suite || !suite.id) {
            console.error("Cannot add test node: invalid suite", suite);
            return;
        }

        const pos = this._calculateNewNodePosition();
        const newNode = {
            id: 'node_' + Date.now() + '_' + Math.random().toString(36).slice(2,8),
            type: 'test-suite',
            // data.name is required by render()
            data: {
                name: suite.name,
                suiteId: suite.id
            },
            position: {
                x: pos.x,
                y: pos.y
            }
        };

        // Ensure nodes array exists
        if (!this.nodes) this.nodes = [];
        if(!this.historyStack.length)this._resetHistory();
        this.nodes.push(newNode);
        this.selectedNodeId = newNode.id;

        try {
            this.render();
            this._commitHistoryState();

            console.log(`Added test node for suite: ${suite.name} at position (${pos.x}, ${pos.y})`);
            if (window.showMessage) {
                window.showMessage(`Added "${suite.name}" to graph`, 'success');
            }
        } catch (e) {
            console.error("Error rendering graph after adding node:", e);
        }

        return newNode;
    }

    loadGraph(graphData = {}) {
        const copy=JSON.parse(JSON.stringify(graphData));
        this.graphMetadata={...copy};delete this.graphMetadata.nodes;delete this.graphMetadata.edges;
        this.nodes=(copy.nodes||[]).map((node,index)=>({...node,type:String(node.type||node.data?.type||'test-suite').replace(/_/g,'-'),data:node.data||{},position:node.position||{x:node.x||100+index*350,y:node.y||100}}));
        this.edges=(copy.edges||[]).map((edge,index)=>({...edge,id:edge.id||'imported-edge-'+index}));
        this.selectedNodeId=null;this.graphOriginInitialized=false;this.render();this._resetHistory();
    }

    getGraph() { return JSON.parse(JSON.stringify({...this.graphMetadata,nodes:this.nodes,edges:this.edges})); }

    _cloneGraphState() {
        return JSON.parse(JSON.stringify({
            nodes: this.nodes || [],
            edges: this.edges || [],
            selectedNodeId: this.selectedNodeId || null
        }));
    }

    _restoreGraphState(state) {
        const restored = state || { nodes: [], edges: [], selectedNodeId: null };
        this.nodes = JSON.parse(JSON.stringify(restored.nodes || []));
        this.edges = JSON.parse(JSON.stringify(restored.edges || []));
        this.selectedNode = null;
        this.dragStartPosition = null;
        this.activeConnection = null;
        this.selectedNodeId = restored.selectedNodeId || null;
        this.render();
    }

    _resetHistory() {
        this.historyStack = [this._cloneGraphState()];
        this.redoStack = [];
    }

    _commitHistoryState() {
        const snapshot = this._cloneGraphState();
        const lastSnapshot = this.historyStack[this.historyStack.length - 1];
        if (JSON.stringify(lastSnapshot) === JSON.stringify(snapshot)) {
            return;
        }

        this.historyStack.push(snapshot);
        if (this.historyStack.length > this.historyLimit) {
            this.historyStack.shift();
        }
        this.redoStack = [];
    }

    undo() {
        if (this.historyStack.length <= 1) {
            return false;
        }

        const currentSnapshot = this.historyStack.pop();
        this.redoStack.push(currentSnapshot);
        this._restoreGraphState(this.historyStack[this.historyStack.length - 1]);
        return true;
    }

    redo() {
        if (this.redoStack.length === 0) {
            return false;
        }

        const nextSnapshot = this.redoStack.pop();
        this.historyStack.push(JSON.parse(JSON.stringify(nextSnapshot)));
        this._restoreGraphState(nextSnapshot);
        return true;
    }

    deleteSelectedNode() {
        if (!this.selectedNodeId) {
            return false;
        }

        this.deleteNode(this.selectedNodeId);
        return true;
    }

    _showEditorMessage(message, type = 'info') {
        if (typeof window !== 'undefined' && typeof window.showMessage === 'function') {
            window.showMessage(message, type);
            return;
        }

        console.warn(`[VisualEditor] ${message}`);
    }

    _isInteractiveElement(target) {
        const tagName = String(target?.tagName || '').toUpperCase();
        if (['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(tagName)) {
            return true;
        }

        const className = typeof target?.className === 'string'
            ? target.className
            : String(target?.getAttribute?.('class') || '');

        return className.includes('ve-port')
            || className.includes('ve-node-config-btn')
            || className.includes('ve-node-run-btn')
            || className.includes('ve-delete-node');
    }

    _nodeProducesLogs(node) {
        if (this._isSuiteBackedNode(node)) return true;
        return ['security-scan','security-gate','git-repo','unit-test-runner','ai-unit-test','website-ux-auto-tester','start-runner','wait-delay','api-performance','api-contract','code-review','push-deploy','log-collector','ai-log-summary'].includes(node?.type);
    }

    _canFeedSecurityScan(node) {
        if (this._isSuiteBackedNode(node)) return true;
        return ['git-repo','start-runner','code-review','ai-unit-test'].includes(node?.type);
    }

    _pathExists(startNodeId, targetNodeId) {
        const visited = new Set();
        const queue = [startNodeId];

        while (queue.length > 0) {
            const currentNodeId = queue.shift();
            if (currentNodeId === targetNodeId) {
                return true;
            }
            if (visited.has(currentNodeId)) {
                continue;
            }

            visited.add(currentNodeId);
            this.edges
                .filter(edge => edge.source === currentNodeId)
                .forEach(edge => queue.push(edge.target));
        }

        return false;
    }

    _validateConnection(sourceNode, targetNode) {
        if (!sourceNode || !targetNode) {
            return { valid: false, message: 'Both source and target nodes are required.' };
        }

        if (sourceNode.id === targetNode.id) {
            return { valid: false, message: 'A node cannot connect to itself.' };
        }

        if (this.edges.some(edge => edge.source === sourceNode.id && edge.target === targetNode.id)) {
            return { valid: false, message: 'Those nodes are already connected.' };
        }

        if (this._pathExists(targetNode.id, sourceNode.id)) {
            return { valid: false, message: 'That connection would create a cycle in the graph.' };
        }

        if (targetNode.type === 'security-gate' && sourceNode.type !== 'security-scan') {
            return { valid: false, message: 'Security Gate nodes can only receive input from Security Scan nodes.' };
        }

        if (targetNode.type === 'security-scan' && !this._canFeedSecurityScan(sourceNode)) {
            return { valid: false, message: 'Security Scan needs a test suite, repository, runner, or generated code as input.' };
        }

        if (targetNode.type === 'ai-log-summary' && !this._nodeProducesLogs(sourceNode)) {
            return { valid: false, message: 'AI Log Summary nodes can only connect to nodes that produce execution logs.' };
        }

        return { valid: true };
    }

    _buildExecutionSubgraph(targetNodeId, options = {}) {
        const targetNode = this.nodes.find(node => node.id === targetNodeId);
        if (!targetNode) {
            return { nodes: [], edges: [] };
        }

        const excludedTypes = new Set(options.excludeTypes || []);
        const includedNodeIds = new Set();
        const queue = [targetNodeId];

        while (queue.length > 0) {
            const currentNodeId = queue.shift();
            if (includedNodeIds.has(currentNodeId)) continue;

            const currentNode = this.nodes.find(node => node.id === currentNodeId);
            if (!currentNode) continue;

            const currentNodeType = currentNode.type || currentNode.data?.type || '';
            if (currentNodeId !== targetNodeId && excludedTypes.has(currentNodeType)) {
                continue;
            }

            includedNodeIds.add(currentNodeId);

            this.edges
                .filter(edge => edge.target === currentNodeId)
                .forEach(edge => {
                    if (!includedNodeIds.has(edge.source)) {
                        queue.push(edge.source);
                    }
                });
        }

        return {
            nodes: this.nodes.filter(node => includedNodeIds.has(node.id)),
            edges: this.edges.filter(edge => includedNodeIds.has(edge.source) && includedNodeIds.has(edge.target))
        };
    }

    _escapeHTML(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _getNodeDisplayName(node) {
        return node?.data?.name || node?.name || node?.id || 'Unnamed Node';
    }

    _isSuiteBackedNode(node) {
        return Boolean(node?.data?.suiteId);
    }

    _getNodeConfigHandlerName(node) {
        if (this._isSuiteBackedNode(node)) return 'showSuiteNodeConfig';

        const nodeType = typeof node === 'string' ? node : node?.type;
        if (nodeType === 'git-repo') return 'showGitNodeConfig';
        if (nodeType === 'unit-test-runner') return 'showUnitTestConfig';
        if (nodeType === 'ai-unit-test') return 'showAIUnitTestConfig';
        if (nodeType === 'ai-log-summary') return 'showAILogSummaryConfig';
        if (nodeType === 'website-ux-auto-tester') return 'showWebsiteUXAutoTesterConfig';
        if (nodeType === 'start-runner') return 'showStartRunnerConfig';
        if (nodeType === 'wait-delay') return 'showWaitDelayConfig';
        if (nodeType === 'log-collector') return 'showLogCollectorConfig';
        if (nodeType === 'api-performance') return 'showAPIPerformanceConfig';
        if (nodeType === 'api-contract') return 'showAPIContractConfig';
        if (nodeType === 'code-review') return 'showCodeReviewConfig';
        if (nodeType === 'push-deploy') return 'showPushDeployConfig';
        return 'showSecurityNodeConfig';
    }

    _getAIProviderOptions(selectedProvider = 'google') {
        const labels = {
            openai: 'OpenAI',
            anthropic: 'Anthropic (Claude)',
            google: 'Google (Gemini)',
            custom: 'Custom (OpenAI-compatible)'
        };

        return ['openai', 'anthropic', 'google', 'custom']
            .map(provider => `<option value="${provider}" ${selectedProvider === provider ? 'selected' : ''}>${labels[provider]}</option>`)
            .join('');
    }

    _getDefaultAILogSummaryInstructions() {
        return 'Summarize the test results. Explain what passed, what failed, and suggest fixes. Use simple language.';
    }

    _getPrimaryUpstreamNode(nodeId) {
        const incomingEdge = this.edges.find(edge => edge.target === nodeId);
        if (!incomingEdge) return null;
        return this.nodes.find(node => node.id === incomingEdge.source) || null;
    }

    _getDirectUpstreamNodes(nodeId) {
        return this.edges
            .filter(edge => edge.target === nodeId)
            .map(edge => this.nodes.find(node => node.id === edge.source))
            .filter(Boolean);
    }

    _getAILogSummarySystemPrompt() {
        return `You are an AI assistant that analyzes test execution logs for the LVX-Machina automated test manager.

Your job is to help users understand their test results in simple, clear language.

For each log you analyze, provide:

## Summary
A 2-3 sentence overview of what happened.

## Results Breakdown
- Total tests run
- Passed
- Failed
- Errors

## What Went Wrong (if anything)
For each failure/error, explain:
1. WHAT failed
2. WHY it failed
3. HOW TO FIX it

## What Went Right
Briefly note what passed and why that matters.

## Recommendations
Call out patterns like flaky tests, missing assertions, unclear error handling, or environment issues.

Keep the tone direct and practical. Do not invent details that are not supported by the logs. If the logs are incomplete, say so clearly.`;
    }

    _stringifyAILogSummaryValue(value, maxLength = 12000) {
        if (value == null) return '';

        let text = '';
        if (typeof value === 'string') {
            text = value;
        } else {
            try {
                text = JSON.stringify(value, null, 2);
            } catch (error) {
                text = String(value);
            }
        }

        if (text.length > maxLength) {
            return `${text.slice(0, maxLength)}\n...[truncated]`;
        }

        return text;
    }

    _extractAIUnitTestSummary(logText) {
        const normalizedLog = typeof logText === 'string' ? logText : '';
        if (!normalizedLog.trim()) {
            return null;
        }

        const summaryMatch = normalizedLog.match(/Total:\s*(\d+)\s*tests?,\s*(\d+)\s*passed,\s*(\d+)\s*failed/i);
        if (!summaryMatch) {
            return null;
        }

        return {
            total: parseInt(summaryMatch[1], 10),
            passed: parseInt(summaryMatch[2], 10),
            failed: parseInt(summaryMatch[3], 10)
        };
    }

    _resolveAILogSummaryTestSummary(sourceResult, suite) {
        if (sourceResult?.testSummary) {
            return sourceResult.testSummary;
        }

        const candidateLogs = [
            sourceResult?.log,
            sourceResult?.output,
            sourceResult?.stdout,
            sourceResult?.stderr,
            suite?.last_run_log
        ];

        for (const candidate of candidateLogs) {
            const summary = this._extractAIUnitTestSummary(candidate);
            if (summary) {
                return summary;
            }
        }

        return null;
    }

    _buildAILogSummaryContext(node, sourceNodes, resultsByNodeId = {}) {
        const sections = [];
        const sourceNames = [];

        sourceNodes.forEach(sourceNode => {
            if (!sourceNode) return;

            const sourceName = this._getNodeDisplayName(sourceNode);
            const sourceType = sourceNode.type || sourceNode.data?.type || 'unknown';
            const sourceResult = resultsByNodeId[sourceNode.id] || sourceNode.data?.lastResult || null;
            const suite = sourceNode.data?.suiteId && Array.isArray(window.testSuites)
                ? window.testSuites.find(candidate => candidate.id === sourceNode.data.suiteId)
                : null;

            const sectionParts = [
                `NODE: ${sourceName}`,
                `TYPE: ${sourceType}`
            ];

            if (sourceResult?.status) {
                sectionParts.push(`STATUS: ${sourceResult.status}`);
            } else if (suite?.last_run_status) {
                sectionParts.push(`STATUS: ${suite.last_run_status}`);
            }

            if (sourceResult?.message) {
                sectionParts.push(`MESSAGE: ${sourceResult.message}`);
            }

            const testSummary = this._resolveAILogSummaryTestSummary(sourceResult, suite);
            if (testSummary) {
                sectionParts.push(`TEST SUMMARY:\nTotal: ${testSummary.total}\nPassed: ${testSummary.passed}\nFailed: ${testSummary.failed}`);
            }

            if (sourceResult?.log) {
                sectionParts.push(`LOG:\n${this._stringifyAILogSummaryValue(sourceResult.log)}`);
            } else if (suite?.last_run_log) {
                sectionParts.push(`LOG:\n${this._stringifyAILogSummaryValue(suite.last_run_log)}`);
            }

            if (sourceResult?.output) {
                sectionParts.push(`OUTPUT:\n${this._stringifyAILogSummaryValue(sourceResult.output)}`);
            }

            if (sourceResult?.stdout) {
                sectionParts.push(`STDOUT:\n${this._stringifyAILogSummaryValue(sourceResult.stdout)}`);
            }

            if (sourceResult?.stderr) {
                sectionParts.push(`STDERR:\n${this._stringifyAILogSummaryValue(sourceResult.stderr)}`);
            }

            if (sourceResult?.securityResults) {
                sectionParts.push(`SECURITY RESULTS:\n${this._stringifyAILogSummaryValue(sourceResult.securityResults, 8000)}`);
            }

            if (sourceResult?.artifacts) {
                sectionParts.push(`ARTIFACTS:\n${this._stringifyAILogSummaryValue(sourceResult.artifacts, 4000)}`);
            }

            sections.push(sectionParts.join('\n\n'));
            sourceNames.push(sourceName);
        });

        return {
            sourceCount: sourceNames.length,
            sourceNames,
            logText: sections.join('\n\n====================\n\n')
        };
    }

    _buildAILogSummaryPrompt(node, logContext) {
        const instructions = node?.data?.instructions || this._getDefaultAILogSummaryInstructions();
        const sourcesLine = logContext.sourceNames.length > 0
            ? `Connected source nodes: ${logContext.sourceNames.join(', ')}`
            : 'Connected source nodes: none';

        return `${instructions}

${sourcesLine}

Analyze the following execution data and explain what happened:

${logContext.logText}`;
    }

    _sanitizeAILogSummaryFileSegment(value, fallback = 'ai-log-summary') {
        const sanitized = String(value || '')
            .trim()
            .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .toLowerCase();

        return sanitized || fallback;
    }

    _isLikelyDirectoryPath(pathValue) {
        const normalized = String(pathValue || '').trim();
        if (!normalized) return false;
        if (/[\\/]$/.test(normalized)) return true;

        const lastSegment = normalized.split(/[\\/]/).pop() || '';
        if (!lastSegment) return true;

        return !/\.[A-Za-z0-9]{1,10}$/.test(lastSegment);
    }

    _joinPath(basePath, childName) {
        const normalizedBase = String(basePath || '').replace(/[\\/]+$/, '');
        if (!normalizedBase) return childName;

        const separator = normalizedBase.includes('\\') || !normalizedBase.includes('/') ? '\\' : '/';
        return `${normalizedBase}${separator}${childName}`;
    }

    _buildAILogSummaryDefaultFileName(node, options = {}) {
        const nodeName = this._sanitizeAILogSummaryFileSegment(node?.data?.name || 'AI Log Summary');
        const generatedAt = options.generatedAt || node?.data?.lastSummaryAt || new Date().toISOString();
        const timestamp = String(generatedAt)
            .replace(/:/g, '-')
            .replace(/\.\d{3}Z$/, 'Z')
            .replace(/[^\dA-Za-z_-]+/g, '-');

        return `${nodeName || 'ai-log-summary'}-${timestamp}.md`;
    }

    _buildAILogSummaryFileContent(node, summaryText, options = {}) {
        const generatedAt = options.generatedAt || node?.data?.lastSummaryAt || new Date().toISOString();
        const sourceNames = Array.isArray(options.sourceNames) && options.sourceNames.length > 0
            ? options.sourceNames.join(', ')
            : 'No connected source node';
        const providerLabel = options.providerLabel || 'AI';
        const model = node?.data?.model ? `\nModel: ${node.data.model}` : '';

        return `# AI Log Summary

Generated: ${generatedAt}
Node: ${node?.data?.name || 'AI Log Summary'}
Provider: ${providerLabel}${model}
Source nodes: ${sourceNames}

Disclaimer: This summary was generated by AI. Verify important conclusions against the raw execution output.

---

${summaryText || 'No summary generated.'}
`;
    }

    async saveAILogSummaryToFile(node, summaryText, options = {}) {
        const content=this._buildAILogSummaryFileContent(node,summaryText,options);
        const filename=this._buildAILogSummaryDefaultFileName(node,options);
        const blob=new Blob([content],{type:'text/markdown;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
        link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        return {success:true,filePath:filename,content};
    }

    showAILogSummaryOutput(node, summaryText, options = {}) {
        const existingModal = document.getElementById('ve-ai-log-summary-output-modal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.id = 've-ai-log-summary-output-modal';
        modal.className = 'mg-dialog fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-[10001]';

        const sourceNames = Array.isArray(options.sourceNames) && options.sourceNames.length > 0
            ? options.sourceNames.join(', ')
            : 'No connected source node';
        const saveStatusText = options.saveError
            ? `Auto-save failed: ${options.saveError}`
            : (options.savedPath ? `Saved to: ${options.savedPath}` : 'Not saved yet');

        modal.innerHTML = `
            <div class="aero-modal p-6 rounded-xl max-w-4xl w-full flex flex-col max-h-[92vh]" style="background: var(--mg-surface, #ffffff); border: 1px solid rgba(251, 146, 60, 0.45); color: var(--mg-text, #17263b);">
                <div class="flex items-start justify-between gap-4 mb-4">
                    <div>
                        <h3 class="text-2xl font-bold">AI Log Summary</h3>
                        <p class="text-sm mt-1" style="color: rgba(255,255,255,0.72);">Source node(s): ${this._escapeHTML(sourceNames)}</p>
                    </div>
                    <span class="text-xs px-3 py-1 rounded-full" style="background: rgba(251, 146, 60, 0.2); color: #fdba74;">${this._escapeHTML(options.providerLabel || 'AI')}</span>
                </div>

                <div class="rounded-xl p-4 mb-4 text-sm" style="background: rgba(251, 146, 60, 0.14); border: 1px solid rgba(251, 146, 60, 0.3); color: #fed7aa;">
                    <strong>Disclaimer:</strong> This summary was generated by AI. It can misunderstand incomplete logs, so verify important conclusions against the raw execution output.
                </div>

                <div class="flex-1 overflow-y-auto rounded-xl p-4 font-mono text-sm whitespace-pre-wrap" style="background: rgba(15, 23, 42, 0.72); border: 1px solid rgba(255,255,255,0.08); color: #e5e7eb;">${this._escapeHTML(summaryText || 'No summary generated.')}</div>

                <div id="cfg-ai-log-output-status" class="text-xs mt-3" style="color: ${options.saveError ? '#fca5a5' : 'rgba(255,255,255,0.72)'};">${this._escapeHTML(saveStatusText)}</div>

                <div class="flex gap-2 justify-end mt-5">
                    <button id="cfg-ai-log-output-minimize" class="aero-button-info p-2 rounded-lg" title="Minimize">
                        ${window.LVXIcons?.svg("minus")||''}
                    </button>
                    <button id="cfg-ai-log-output-save" class="py-2 px-4 rounded-lg font-semibold" style="background: var(--mg-surface, #ffffff); color: var(--mg-text, #17263b); border: none; cursor: pointer;">Save Summary</button>
                    <button id="cfg-ai-log-output-close" class="aero-button-gray py-2 px-4 rounded-lg">Close</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        const saveBtn = modal.querySelector('#cfg-ai-log-output-save');
        const statusEl = modal.querySelector('#cfg-ai-log-output-status');

        modal.querySelector('#cfg-ai-log-output-minimize').onclick = () => {
            if (window.minimizeAILogSummary) {
                window.minimizeAILogSummary(node, summaryText, options);
            } else {
                modal.classList.add('hidden');
                document.body.classList.remove('modal-open');
            }
        };

        modal.querySelector('#cfg-ai-log-output-close').onclick = () => {
            if (window.closeAILogSummary) {
                window.closeAILogSummary(node.id);
            } else {
                modal.remove();
                document.body.classList.remove('modal-open');
            }
        };
        if (saveBtn) {
            saveBtn.onclick = async () => {
                if (statusEl) {
                    statusEl.textContent = 'Saving summary...';
                    statusEl.style.color = 'rgba(255,255,255,0.72)';
                }
                saveBtn.disabled = true;
                saveBtn.style.opacity = '0.7';
                try {
                    const result = await this.saveAILogSummaryToFile(node, summaryText, {
                        ...options,
                        allowPicker: true
                    });
                    if (statusEl) {
                        if (result?.success) {
                            statusEl.textContent = `Saved to: ${result.filePath}`;
                            statusEl.style.color = '#86efac';
                        } else if (result?.canceled) {
                            statusEl.textContent = 'Save cancelled.';
                            statusEl.style.color = 'rgba(255,255,255,0.72)';
                        } else {
                            statusEl.textContent = result?.error || 'Failed to save summary.';
                            statusEl.style.color = '#fca5a5';
                        }
                    }
                } catch (error) {
                    if (statusEl) {
                        statusEl.textContent = error.message || 'Failed to save summary.';
                        statusEl.style.color = '#fca5a5';
                    }
                    if (window.showToast) window.showToast(error.message || 'Failed to save summary.', 'error');
                } finally {
                    saveBtn.disabled = false;
                    saveBtn.style.opacity = '1';
                }
            };
        }
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
    }

    _getGraphMetrics() {
        const nodeWidth = 300;
        const nodeHeight = 80;
        const fallbackMetrics = {
            minX: 0,
            minY: 0,
            maxX: nodeWidth,
            maxY: nodeHeight
        };

        if (!Array.isArray(this.nodes) || this.nodes.length === 0) {
            return fallbackMetrics;
        }

        return this.nodes.reduce((metrics, node) => {
            const x = Number(node?.position?.x ?? 0);
            const y = Number(node?.position?.y ?? 0);

            return {
                minX: Math.min(metrics.minX, x),
                minY: Math.min(metrics.minY, y),
                maxX: Math.max(metrics.maxX, x + nodeWidth),
                maxY: Math.max(metrics.maxY, y + nodeHeight)
            };
        }, { ...fallbackMetrics });
    }

    _initializeGraphOrigin() {
        if (this.graphOriginInitialized) return;

        const padding = 120;
        const metrics = this._getGraphMetrics();

        this.graphOrigin = {
            x: metrics.minX < padding ? padding - metrics.minX : 0,
            y: metrics.minY < padding ? padding - metrics.minY : 0
        };
        this.graphOriginInitialized = true;
    }

    _expandGraphOriginForMetrics(metrics) {
        if (!this.graphOriginInitialized) return;

        const padding = 120;
        const requiredOriginX = metrics.minX < padding ? padding - metrics.minX : 0;
        const requiredOriginY = metrics.minY < padding ? padding - metrics.minY : 0;

        if (requiredOriginX > this.graphOrigin.x) {
            const deltaX = requiredOriginX - this.graphOrigin.x;
            this.graphOrigin.x = requiredOriginX;
            this.panning.x -= deltaX * this.scale;
        }

        if (requiredOriginY > this.graphOrigin.y) {
            const deltaY = requiredOriginY - this.graphOrigin.y;
            this.graphOrigin.y = requiredOriginY;
            this.panning.y -= deltaY * this.scale;
        }
    }

    _updateViewportLayout() {
        if (!this.canvas || !this.viewport || !this.svgLayer || !this.nodeLayer) return;

        const padding = 120;
        const metrics = this._getGraphMetrics();
        this._initializeGraphOrigin();
        this._expandGraphOriginForMetrics(metrics);
        const canvasWidth = this.canvas.clientWidth || 2000;
        const canvasHeight = this.canvas.clientHeight || 1200;
        const width = Math.max(canvasWidth, metrics.maxX + this.graphOrigin.x + padding);
        const height = Math.max(canvasHeight, metrics.maxY + this.graphOrigin.y + padding);
        this.viewportSize = { width, height };

        this.viewport.style.width = `${width}px`;
        this.viewport.style.height = `${height}px`;
        this.svgLayer.style.width = `${width}px`;
        this.svgLayer.style.height = `${height}px`;
        this.nodeLayer.style.width = `${width}px`;
        this.nodeLayer.style.height = `${height}px`;
    }

    _graphToViewportPoint(position = { x: 0, y: 0 }) {
        return {
            x: (position.x || 0) + this.graphOrigin.x,
            y: (position.y || 0) + this.graphOrigin.y
        };
    }

    _clientToViewportPoint(clientX, clientY) {
        const rect = this.canvas?.getBoundingClientRect?.() || { left: 0, top: 0 };
        return {
            x: (clientX - rect.left - this.panning.x) / this.scale,
            y: (clientY - rect.top - this.panning.y) / this.scale
        };
    }

    _clientToGraphPoint(clientX, clientY) {
        const viewportPoint = this._clientToViewportPoint(clientX, clientY);
        return {
            x: viewportPoint.x - this.graphOrigin.x,
            y: viewportPoint.y - this.graphOrigin.y
        };
    }

    _setCanvasCursor() {
        if (!this.canvas) return;

        if (this.isPanning) {
            this.canvas.style.cursor = 'grabbing';
        } else if (this.activeTool === 'pan') {
            this.canvas.style.cursor = 'grab';
        } else {
            this.canvas.style.cursor = 'default';
        }
    }

    _syncToolButtons() {
        if (!this.container?.querySelectorAll) return;

        const toolButtons = this.container.querySelectorAll('[data-ve-tool]');
        toolButtons.forEach(button => {
            if (!button?.classList) return;
            if (button.dataset?.veTool === this.activeTool) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
    }

    _applyViewportTransform() {
        if (this.viewport) {
            this.viewport.style.transform = `translate(${this.panning.x}px, ${this.panning.y}px) scale(${this.scale})`;
        }

        const zoomLabel = this.container?.querySelector?.('#ve-zoom-level');
        if (zoomLabel) {
            zoomLabel.textContent = `${Math.round(this.scale * 100)}%`;
        }

        this._setCanvasCursor();
        this._syncToolButtons();
    }

    _setActiveTool(tool) {
        this.activeTool = tool === 'pan' ? 'pan' : 'select';
        this._applyViewportTransform();
        this.render();
    }

    _startPan(e) {
        e.preventDefault();
        this.isPanning = true;
        this.panStart = {
            x: e.clientX - this.panning.x,
            y: e.clientY - this.panning.y
        };
        this._setCanvasCursor();
    }

    _resetView() {
        this.scale = 1;
        this.panning = { x: 0, y: 0 };
        this._applyViewportTransform();
    }

    _getDownstreamNodeIds(startNodeId) {
        const visited = new Set();
        const queue = this.edges
            .filter(edge => edge.source === startNodeId)
            .map(edge => edge.target);

        while (queue.length > 0) {
            const currentId = queue.shift();
            if (visited.has(currentId)) continue;

            visited.add(currentId);

            this.edges
                .filter(edge => edge.source === currentId)
                .forEach(edge => {
                    if (!visited.has(edge.target)) {
                        queue.push(edge.target);
                    }
                });
        }

        return visited;
    }

    _getDirectlyConnectedNodes(startNodeId) {
        return this.edges
            .filter(edge => edge.source === startNodeId)
            .map(edge => this.nodes.find(node => node.id === edge.target))
            .filter(Boolean);
    }

    _getDownstreamNodes(startNodeId) {
        const downstreamNodes = [];
        const visited = new Set();
        const queue = this.edges
            .filter(edge => edge.source === startNodeId)
            .map(edge => edge.target);

        while (queue.length > 0) {
            const currentId = queue.shift();
            if (visited.has(currentId)) continue;

            visited.add(currentId);

            const node = this.nodes.find(candidate => candidate.id === currentId);
            if (node) {
                downstreamNodes.push(node);
            }

            this.edges
                .filter(edge => edge.source === currentId)
                .forEach(edge => {
                    if (!visited.has(edge.target)) {
                        queue.push(edge.target);
                    }
                });
        }

        return downstreamNodes;
    }

    _getStartRunnerRetryState(startNodeId, config = {}) {
        const retryCandidateNodes = this._getDirectlyConnectedNodes(startNodeId);
        const validNodeIds = new Set(retryCandidateNodes.map(node => node.id));
        const savedRetryTargets = Array.isArray(config.retryTargets) ? config.retryTargets : [];
        const disabledRetryNodeIds = new Set(
            (Array.isArray(config.disabledRetryNodeIds) ? config.disabledRetryNodeIds : [])
                .filter(nodeId => validNodeIds.has(nodeId))
        );
        const retryAttemptsByNodeId = new Map();

        savedRetryTargets.forEach(row => {
            if (!row || !validNodeIds.has(row.nodeId)) return;
            const parsedAttempts = parseInt(row.attempts, 10);
            retryAttemptsByNodeId.set(row.nodeId, parsedAttempts > 0 ? parsedAttempts : 1);
        });

        const retryRows = retryCandidateNodes
            .filter(node => !disabledRetryNodeIds.has(node.id))
            .map(node => ({
                nodeId: node.id,
                attempts: retryAttemptsByNodeId.get(node.id) || 1
            }));

        return {
            retryCandidateNodes,
            retryRows
        };
    }

    _buildGraphIndex() {
        const nodeById = new Map();
        const outgoing = new Map();

        this.nodes.forEach(node => {
            nodeById.set(node.id, node);
            outgoing.set(node.id, []);
        });

        this.edges.forEach(edge => {
            if (!outgoing.has(edge.source)) {
                outgoing.set(edge.source, []);
            }
            outgoing.get(edge.source).push(edge.target);
        });

        return { nodeById, outgoing };
    }

    _getRunnerStopNodeId(runnerNodeId, stopNodeOverrides = {}) {
        if (Object.prototype.hasOwnProperty.call(stopNodeOverrides, runnerNodeId)) {
            return stopNodeOverrides[runnerNodeId] || '';
        }

        const runnerNode = this.nodes.find(candidate => candidate.id === runnerNodeId);
        return runnerNode?.data?.stopNodeId || '';
    }

    _buildRunnerScope(graphIndex, runnerNodeId, runnerIds, stopNodeOverrides = {}, scopeCache = new Map()) {
        if (scopeCache.has(runnerNodeId)) {
            return scopeCache.get(runnerNodeId);
        }

        const scopedIds = new Set([runnerNodeId]);
        scopeCache.set(runnerNodeId,scopedIds);
        const visited = new Set([runnerNodeId]);
        const stopNodeId = this._getRunnerStopNodeId(runnerNodeId, stopNodeOverrides);

        const traverse = (currentId) => {
            const nextIds = graphIndex.outgoing.get(currentId) || [];

            nextIds.forEach(nextId => {
                scopedIds.add(nextId);

                if (nextId === stopNodeId) {
                    return;
                }

                if (runnerIds.has(nextId) && nextId !== runnerNodeId) {
                    const nestedScope = this._buildRunnerScope(graphIndex, nextId, runnerIds, stopNodeOverrides, scopeCache);
                    nestedScope.forEach(nodeId => scopedIds.add(nodeId));
                    return;
                }

                if (!visited.has(nextId)) {
                    visited.add(nextId);
                    traverse(nextId);
                }
            });
        };

        traverse(runnerNodeId);
        scopeCache.set(runnerNodeId, scopedIds);
        return scopedIds;
    }

    _buildStartRunnerSubtree(rootRunnerId, startNodeId, stopNodeOverrides = {}) {
        if (!rootRunnerId || !startNodeId) return null;

        const graphIndex = this._buildGraphIndex();
        const runnerIds = new Set(
            this.nodes
                .filter(node => node.type === 'start-runner')
                .map(node => node.id)
        );

        if (!graphIndex.nodeById.has(startNodeId) || !runnerIds.has(rootRunnerId)) {
            return null;
        }

        const scopeCache = new Map();
        const rootScope = this._buildRunnerScope(graphIndex, rootRunnerId, runnerIds, stopNodeOverrides, scopeCache);

        if (!rootScope.has(startNodeId)) {
            return null;
        }

        const buildTree = (currentId, activeRunnerId, pathIds = new Set()) => {
            const node = graphIndex.nodeById.get(currentId);
            if (!node) return null;

            const stopNodeId = this._getRunnerStopNodeId(activeRunnerId, stopNodeOverrides);
            const nextPathIds = new Set(pathIds);
            nextPathIds.add(currentId);

            const treeNode = {
                id: currentId,
                label: this._getNodeDisplayName(node),
                type: node.type,
                isRunner: runnerIds.has(currentId),
                isStopBoundary: Boolean(stopNodeId) && currentId === stopNodeId,
                isCycle: false,
                children: []
            };

            if (treeNode.isStopBoundary) {
                return treeNode;
            }

            const nextIds = (graphIndex.outgoing.get(currentId) || [])
                .filter(nextId => rootScope.has(nextId));

            nextIds.forEach(nextId => {
                const nextNode = graphIndex.nodeById.get(nextId);
                if (!nextNode) return;

                if (nextPathIds.has(nextId)) {
                    treeNode.children.push({
                        id: nextId,
                        label: this._getNodeDisplayName(nextNode),
                        type: nextNode.type,
                        isRunner: runnerIds.has(nextId),
                        isStopBoundary: false,
                        isCycle: true,
                        children: []
                    });
                    return;
                }

                const childActiveRunnerId = runnerIds.has(nextId) ? nextId : activeRunnerId;
                const childTree = buildTree(nextId, childActiveRunnerId, nextPathIds);
                if (childTree) {
                    treeNode.children.push(childTree);
                }
            });

            return treeNode;
        };

        return buildTree(startNodeId, runnerIds.has(startNodeId) ? startNodeId : rootRunnerId);
    }

    _renderStartRunnerSubtree(treeNode, depth = 0) {
        if (!treeNode) {
            return '<div class="text-xs" style="color: rgba(5, 46, 22, 0.78);">No downstream nodes available for this selection.</div>';
        }

        const badges = [];
        if (treeNode.isRunner) {
            badges.push('<span style="display:inline-block; padding:2px 8px; border-radius:999px; background: rgba(8, 47, 73, 0.18); border: 1px solid rgba(8, 47, 73, 0.28); color: #0c4a6e; font-size: 11px; font-weight: 700;">runner</span>');
        }
        if (treeNode.isStopBoundary) {
            badges.push('<span style="display:inline-block; padding:2px 8px; border-radius:999px; background: rgba(120, 53, 15, 0.18); border: 1px solid rgba(120, 53, 15, 0.28); color: #9a3412; font-size: 11px; font-weight: 700;">stop</span>');
        }
        if (treeNode.isCycle) {
            badges.push('<span style="display:inline-block; padding:2px 8px; border-radius:999px; background: rgba(127, 29, 29, 0.16); border: 1px solid rgba(127, 29, 29, 0.28); color: #991b1b; font-size: 11px; font-weight: 700;">cycle</span>');
        }

        const childrenHtml = treeNode.children.length > 0
            ? `<div style="margin-left: 16px; margin-top: 8px; padding-left: 12px; border-left: 2px solid rgba(20, 83, 45, 0.22);">
                    ${treeNode.children.map(childNode => this._renderStartRunnerSubtree(childNode, depth + 1)).join('')}
               </div>`
            : (depth === 0
                ? '<div class="text-xs mt-2" style="color: rgba(5, 46, 22, 0.78);">No further connected nodes after this point.</div>'
                : '');

        return `
            <div style="margin-top: ${depth === 0 ? '0' : '8px'};">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,0.44); border: 1px solid rgba(20, 83, 45, 0.25);">
                    <span style="font-size: 13px; font-weight: 700; color: #052e16;">${this._escapeHTML(treeNode.label)}</span>
                    ${badges.join('')}
                </div>
                ${childrenHtml}
            </div>
        `;
    }

    _renderToolbar() {
        const toolbar = document.createElement('div');
        toolbar.className = 've-toolbar aero-glass-panel';
        toolbar.innerHTML = `
            <div class="ve-toolbar-header">Available Suites</div>
            <div id="ve-suite-list" class="ve-suite-list"></div>
            <div class="ve-toolbar-btn-group">
                <button id="ve-save-btn" class="aero-button-success" title="Save to current graph">${window.LVXIcons?.svg("save")||''} Save</button>
                <button id="ve-saveas-btn" class="aero-button-info" style="margin-left:5px;" title="Save as new graph">${window.LVXIcons?.svg("file")||''} Save As</button>
                <button id="ve-run-btn" class="aero-button-primary" style="margin-left:5px;">${window.LVXIcons?.svg("play")||''}Run</button>
                <button id="ve-close-btn" class="aero-button-gray">${window.LVXIcons?.svg("close")||''}Close</button>
            </div>
            <div class="ve-toolbar-section" style="margin-top:15px;">
                <div class="ve-toolbar-header" style="font-size:0.9rem;"> Security Nodes</div>
                <div id="ve-security-nodes" class="ve-suite-list" style="max-height:90px; min-height:auto;">
                    <div class="ve-palette-item aero-card" draggable="true" data-type="security-scan"
                         style="background: linear-gradient(180deg, #fecaca 0%, #fca5a5 100%); cursor:grab;">${window.LVXIcons?.svg("shield")||''}
                         Security Scan
                    </div>
                    <div class="ve-palette-item aero-card" draggable="true" data-type="security-gate"
                         style="background: linear-gradient(180deg, #fef08a 0%, #fde047 100%); cursor:grab;">${window.LVXIcons?.svg("shield")||''}
                         Security Gate
                    </div>
                </div>
            </div>
            <div class="ve-toolbar-section" style="margin-top:15px;">
                <div class="ve-toolbar-header" style="font-size:0.9rem;"> Integrations</div>
                <div id="ve-integration-nodes" class="ve-suite-list" style="max-height:190px; min-height:auto;">
                    <div class="ve-palette-item aero-card" draggable="true" data-type="git-repo"
                         style="background: linear-gradient(180deg, #fdba74 0%, #fb923c 100%); cursor:grab;">${window.LVXIcons?.svg("branch")||''}
                         Git Repo
                    </div>
                    <div class="ve-palette-item aero-card" draggable="true" data-type="unit-test-runner"
                         style="background: linear-gradient(180deg, #ddd6fe 0%, #c4b5fd 100%); cursor:grab;">${window.LVXIcons?.svg("test")||''}
                         Unit Test
                    </div>
                    <div class="ve-palette-item aero-card" draggable="true" data-type="ai-unit-test"
                         style="background: linear-gradient(180deg, #a5f3fc 0%, #06b6d4 100%); cursor:grab;">${window.LVXIcons?.svg("robot")||''}
                         AI Unit Test
                    </div>
                    <div class="ve-palette-item aero-card" draggable="true" data-type="ai-log-summary"
                         style="background: linear-gradient(180deg, #fdba74 0%, #c084fc 100%); color: #4a044e; cursor:grab;">${window.LVXIcons?.svg("file")||''}
                         AI Log Summary
                    </div>
                    <div class="ve-palette-item aero-card" draggable="true" data-type="log-collector"
                         style="background: linear-gradient(180deg, #94a3b8 0%, #475569 100%); color: white; cursor:grab;">${window.LVXIcons?.svg("archive")||''}
                         <span class="ve-task-label">Log Collector & Zip</span>
                    </div>
                    <div class="ve-palette-item aero-card" draggable="true" data-type="start-runner"
                         style="background: linear-gradient(180deg, #bef264 0%, #65a30d 100%); color: #1a2e05; cursor:grab;">${window.LVXIcons?.svg("play")||''}
                         Start Runner Node
                    </div>
                    <div class="ve-palette-item aero-card" draggable="true" data-type="wait-delay"
                         style="background: linear-gradient(180deg, #dbeafe 0%, #60a5fa 100%); color: #0f172a; cursor:grab;">${window.LVXIcons?.svg("clock")||''}
                        Wait / Delay
                    </div>
                </div>
            </div>
            <div class="ve-toolbar-section" style="margin-top:15px;">
                <div class="ve-toolbar-header" style="font-size:0.9rem;"> Automation & Deployment</div>
                <div id="ve-automation-nodes" class="ve-suite-list" style="max-height:190px; min-height:auto;">
                    <div class="ve-palette-item aero-card" draggable="true" data-type="api-performance"
                         style="background: linear-gradient(180deg, #fdba74 0%, #f97316 100%); color: white; cursor:grab;">${window.LVXIcons?.svg("activity")||''}
                         API Performance
                    </div>
                    <div class="ve-palette-item aero-card" draggable="true" data-type="api-contract"
                         style="background: linear-gradient(180deg, #67e8f9 0%, #06b6d4 100%); color: #083344; cursor:grab;">${window.LVXIcons?.svg("code")||''}
                         API Contract
                    </div>
                    <div class="ve-palette-item aero-card" draggable="true" data-type="code-review"
                         style="background: linear-gradient(180deg, #f9a8d4 0%, #d946ef 100%); color: white; cursor:grab;">${window.LVXIcons?.svg("eye")||''}
                         AI Code Review
                    </div>
                    <div class="ve-palette-item aero-card" draggable="true" data-type="website-ux-auto-tester"
                         style="background: linear-gradient(180deg, #93c5fd 0%, #0ea5e9 100%); color: #082f49; cursor:grab;">${window.LVXIcons?.svg("globe")||''}
                        Website UX Auto Tester
                    </div>
                    <div class="ve-palette-item aero-card" draggable="true" data-type="push-deploy"
                         style="background: linear-gradient(180deg, #fca5a5 0%, #ef4444 100%); color: white; cursor:grab;">${window.LVXIcons?.svg("upload")||''}
                         Push & Deploy
                    </div>
                </div>
            </div>
        `;
        this.container.appendChild(toolbar);

        const existingZoomControls = this.container.querySelector('#ve-viewport-controls');
        if (existingZoomControls?.remove) {
            existingZoomControls.remove();
        }

        const zoomControls = document.createElement('div');
        zoomControls.id = 've-viewport-controls';
        zoomControls.className = 've-zoom-controls';
        zoomControls.innerHTML = `
            <button type="button" data-ve-tool="select" title="Select and move nodes">${window.LVXIcons?.svg("select")||''} Select</button>
            <button type="button" data-ve-tool="pan" title="Hand tool">${window.LVXIcons?.svg("hand")||''} Pan</button>
            <button type="button" id="ve-zoom-in-btn" title="Zoom in">${window.LVXIcons?.svg("plus")||''}</button>
            <button type="button" id="ve-zoom-out-btn" title="Zoom out">${window.LVXIcons?.svg("minus")||''}</button>
            <button type="button" id="ve-reset-view-btn" title="Reset view">${window.LVXIcons?.svg("refresh")||''} Reset</button>
            <div id="ve-zoom-level" class="ve-zoom-level">100%</div>
        `;
        this.container.appendChild(zoomControls);

        // Bind Save (to current graph)
        const saveBtn = toolbar.querySelector('#ve-save-btn');
        if (saveBtn) {
            saveBtn.onclick = (e) => {
                e.preventDefault();
                console.log("Save clicked");
                if (this.onSave) this.onSave(this.getGraph());
            };
        }

        // Bind Save As (new graph)
        const saveAsBtn = toolbar.querySelector('#ve-saveas-btn');
        if (saveAsBtn) {
            saveAsBtn.onclick = (e) => {
                e.preventDefault();
                console.log("Save As clicked");
                if (this.onSaveAs) this.onSaveAs(this.getGraph());
            };
        }

        const runBtn = toolbar.querySelector('#ve-run-btn');
        if (runBtn) {
            runBtn.onclick = (e) => {
                e.preventDefault();
                console.log("Run clicked");
                if (this.onRun) this.onRun(this.getGraph());
            };
        }

        const closeBtn = toolbar.querySelector('#ve-close-btn');
        if (closeBtn) {
            closeBtn.onclick = (e) => {
                e.preventDefault();
                this.container.innerHTML = '';
                this.container.classList.add('hidden');
                this.onClose?.();
            };
        }

        const selectToolBtn = zoomControls.querySelector('[data-ve-tool="select"]');
        if (selectToolBtn) {
            selectToolBtn.onclick = (e) => {
                e.preventDefault();
                this._setActiveTool('select');
            };
        }

        const panToolBtn = zoomControls.querySelector('[data-ve-tool="pan"]');
        if (panToolBtn) {
            panToolBtn.onclick = (e) => {
                e.preventDefault();
                this._setActiveTool('pan');
            };
        }

        const zoomInBtn = zoomControls.querySelector('#ve-zoom-in-btn');
        if (zoomInBtn) {
            zoomInBtn.onclick = (e) => {
                e.preventDefault();
                this.zoom(0.1);
            };
        }

        const zoomOutBtn = zoomControls.querySelector('#ve-zoom-out-btn');
        if (zoomOutBtn) {
            zoomOutBtn.onclick = (e) => {
                e.preventDefault();
                this.zoom(-0.1);
            };
        }

        const resetViewBtn = zoomControls.querySelector('#ve-reset-view-btn');
        if (resetViewBtn) {
            resetViewBtn.onclick = (e) => {
                e.preventDefault();
                this._resetView();
            };
        }

        const bindPaletteDrag = (selector) => {
            const paletteNodes = toolbar.querySelectorAll(`${selector} [draggable="true"]`);
            paletteNodes.forEach(node => {
                node.ondragstart = (e) => {
                    const nodeType = node.dataset.type;
                    e.dataTransfer.setData('application/json', JSON.stringify({
                        type: nodeType,
                        name: node.textContent.trim()
                    }));
                };
            });
        };

        bindPaletteDrag('#ve-security-nodes');
        bindPaletteDrag('#ve-integration-nodes');
        bindPaletteDrag('#ve-automation-nodes');

        this._applyViewportTransform();
    }

    setAvailableSuites(suites) {
        this.availableSuites = JSON.parse(JSON.stringify(suites||[]));
        const list = document.getElementById('ve-suite-list');
        if (!list) return;

        list.innerHTML = '';
        this.availableSuites.forEach(suite => {
            const item = document.createElement('div');
            item.className = 've-palette-item aero-card';
            item.draggable = true;
            item.innerText = suite.name;
            item.dataset.suiteId = suite.id;
            item.tabIndex=0;item.setAttribute?.('role','button');
            item.onclick=()=>this.addTestNode(suite);
            item.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();this.addTestNode(suite);}};

            item.ondragstart = (e) => {
                e.dataTransfer.setData('application/json', JSON.stringify({
                    type: 'suite',
                    id: suite.id,
                    name: suite.name
                }));
            };

            list.appendChild(item);
        });
    }

    _bindEvents() {
        // Drag Over / Drop on Canvas
        this.canvas.ondragover = (e) => e.preventDefault();
        this.canvas.ondrop = (e) => this._handleDrop(e);
        this.canvas.onmousedown = (e) => {
            if (this.activeTool === 'pan' || e.button === 1) {
                this._startPan(e);
            }
        };
        this.canvas.onwheel = (e) => {
            e.preventDefault();
            this.zoom(e.deltaY < 0 ? 0.1 : -0.1, {
                clientX: e.clientX,
                clientY: e.clientY
            });
        };

        // Mouse Move for dragging nodes or connections
        this.container.onmousemove = (e) => this._handleMouseMove(e);
        this.container.onmouseup = (e) => this._handleMouseUp(e);
    }

    _handleDrop(e) {
        e.preventDefault();
        const raw = e.dataTransfer.getData('application/json');
        if (!raw) return;

        let data;try{data=JSON.parse(raw);}catch{this._showEditorMessage('This item is not valid graph data.','error');return;}
        const point = this._clientToGraphPoint(e.clientX, e.clientY);
        const x = point.x;
        const y = point.y;

        let nodeData = null;

        if (data.type === 'suite') {
            this.addNode({
                id: 'node_' + Date.now() + '_' + Math.random().toString(36).slice(2,8),
                type: 'test-suite',
                data: { suiteId: data.id, name: data.name },
                position: { x, y }
            });
            return;
        } else if (data.type === 'security-scan') {
            nodeData = {
                type: 'security-scan',
                data: {
                    name: ' Security Scan',
                    scanTypes: ['sast', 'secrets'],
                    failOn: 'critical'
                }
            };
        } else if (data.type === 'security-gate') {
            nodeData = {
                type: 'security-gate',
                data: {
                    name: ' Security Gate',
                    maxCritical: 0,
                }
            };
        } else if (data.type === 'git-repo') {
            nodeData = {
                type: 'git-repo',
                data: {
                    name: ' Git Repo',
                    repoUrl: '',
                    branch: 'main',
                    auth: '',
                    branchMissingPolicy: 'fail',
                    branchBase: 'main'
                }
            };
        } else if (data.type === 'unit-test-runner') {
            nodeData = {
                type: 'unit-test-runner',
                data: {
                    name: ' Unit Test',
                    command: 'npm test',
                    cwd: ''
                }
            };
        } else if (data.type === 'ai-unit-test') {
            nodeData = {
                type: 'ai-unit-test',
                data: {
                    name: ' AI Unit Test',
                    automationMode: 'manual',
                    testMode: 'auto',
                    sourceStrategy: 'saved-selection',
                    sourceExtensions: 'html,css,js,jsx,ts,tsx,mjs,cjs,vue,svelte,py,java,cs,go,rb,php,c,cpp,h,rs,swift,kt,scala,json',
                    maxSourceFiles: 12,
                    maxSourceChars: 60000,
                    generationFallback: 'fail',
                    selectedSourceFiles: [],
                    provider: 'openai',
                    model: '',
                    apiKey: '',
                    customEndpoint: '',
                    instructions: '',
                    testFilename: 'ai-generated-test.js',
                    generatedCode: '',
                    command: 'node ai-generated-test.js',
                    cwd: '',
                    lastGeneratedAt: null
                }
            };
        } else if (data.type === 'ai-log-summary') {
            nodeData = {
                type: 'ai-log-summary',
                data: {
                    name: ' AI Log Summary',
                    summaryScope: 'full-runner-log',
                    provider: 'google',
                    model: '',
                    apiKey: '',
                    customEndpoint: '',
                    maxTokens: 16384,
                    instructions: this._getDefaultAILogSummaryInstructions(),
                    savePath: '',
                    lastSummaryAt: null,
                    lastSummary: ''
                }
            };
        } else if (data.type === 'log-collector') {
            nodeData = {
                type: 'log-collector',
                data: {
                    name: ' Log Collector & Zip',
                    zipName: 'pipeline-logs.zip',
                    collectionMode: 'connected'
                }
            };
        } else if (data.type === 'start-runner') {
            nodeData = {
                type: 'start-runner',
                data: {
                    name: ' Start Runner Node',
                    retryTargets: [],
                    downloadLogs: false,
                    logPath: '',
                    stopNodeId: ''
                }
            };
        } else if (data.type === 'wait-delay') {
            nodeData = {
                type: 'wait-delay',
                data: {
                    name: 'Wait / Delay',
                    delayMs: 5000,
                    note: ''
                }
            };
        } else if (data.type === 'api-performance') {
            nodeData = {
                type: 'api-performance',
                data: {
                    name: ' API Performance',
                    url: '',
                    method: 'GET',
                    duration: 30,
                    connections: 10
                }
            };
        } else if (data.type === 'api-contract') {
            nodeData = {
                type: 'api-contract',
                data: {
                    name: ' API Contract',
                    url: '',
                    method: 'GET',
                    schema: '{}'
                }
            };
        } else if (data.type === 'code-review') {
            nodeData = {
                type: 'code-review',
                data: {
                    name: ' AI Code Review',
                    provider: 'google',
                    mode: 'review',
                    executionMode: 'interactive',
                    instructions: '',
                    sourceCode: '',
                    outputPath: '',
                    lastGeneratedCode: '',
                    history: []
                }
            };
        } else if (data.type === 'website-ux-auto-tester') {
            nodeData = {
                type: 'website-ux-auto-tester',
                data: {
                    name: 'Website UX Auto Tester',
                    sourceMode: 'auto',
                    entryFilePath: 'index.html',
                    websiteUrl: '',
                    routePaths: '/',
                    customScenarios: '',
                    autoExplore: true,
                    maxAutoInteractions: 8,
                    waitAfterActionMs: 500,
                    viewportWidth: 1440,
                    viewportHeight: 900,
                    continueOnFailure: true,
                    failOnConsoleErrors: true,
                    failOnPageErrors: true,
                    reportPath: '',
                    lastUXReport: '',
                    lastUXReportAt: null
                }
            };
        } else if (data.type === 'push-deploy') {
            nodeData = {
                type: 'push-deploy',
                data: {
                    name: ' Push & Deploy',
                    target: 'production',
                    trigger: 'git-push',
                    repoUrl: '',
                    branch: 'main',
                    branchMissingPolicy: 'fail',
                    branchBase: 'main',
                    authToken: '',
                    targetFilePath: 'index.html',
                    commitMessage: 'Deploy from LVX-Machina {date}',
                    command: ''
                }
            };
        }

        if (nodeData) {
            this.addNode({
                id: 'node_' + Date.now() + '_' + Math.random().toString(36).slice(2,8),
                type: nodeData.type,
                data: nodeData.data,
                position: { x, y }
            });
        }
    }

    addNode(node) {
        if(!this.historyStack.length)this._resetHistory();
        this.nodes.push(node);
        this.selectedNodeId = node.id;
        this.render();
        this._commitHistoryState();
    }

    render() {
        if(!this.nodeLayer||!this.svgLayer)return;
        this._updateViewportLayout();this._applyViewportTransform();
        this.nodeLayer.innerHTML='';this.svgLayer.innerHTML='';
        const icons={'security-scan':'shield','security-gate':'shield','git-repo':'branch','unit-test-runner':'test','ai-unit-test':'robot','ai-log-summary':'file','log-collector':'archive','start-runner':'play','wait-delay':'clock','api-performance':'activity','api-contract':'code','code-review':'eye','website-ux-auto-tester':'globe','push-deploy':'upload'};
        for(const node of this.nodes){
            node.position=node.position||{x:node.x||0,y:node.y||0};node.data=node.data||{};
            const point=this._graphToViewportPoint(node.position),el=document.createElement('div');
            el.className='ve-node aero-card'+(node.id===this.selectedNodeId?' ve-node-selected':'');el.dataset.id=node.id;el.dataset.nodeType=node.type;
            Object.assign(el.style,{left:point.x+'px',top:point.y+'px',pointerEvents:'auto',cursor:this.activeTool==='pan'?'grab':'move'});
            el.innerHTML=`<div class="ve-node-header"><span class="node-icon">${window.LVXIcons?.svg(icons[node.type]||'test')||''}</span><strong title="${this._escapeHTML(this._getNodeDisplayName(node))}">${this._escapeHTML(this._getNodeDisplayName(node))}</strong><button type="button" class="ve-node-config-btn" title="Configure node">${window.LVXIcons?.svg('settings')||''}</button><button type="button" class="ve-node-run-btn" title="Run this node with dependencies">${window.LVXIcons?.svg('play')||''}</button><button type="button" class="ve-delete-node" title="Delete node">${window.LVXIcons?.svg('trash')||''}</button></div><div class="ve-node-description">${this._escapeHTML(node.type)}</div><div class="ve-ports"><button type="button" aria-label="Input connection" class="ve-port ve-input-port"></button><button type="button" aria-label="Output connection" class="ve-port ve-output-port"></button></div>`;
            el.querySelector('.ve-node-config-btn').onclick=e=>{e.stopPropagation();this[this._getNodeConfigHandlerName(node)](node.id);};
            el.querySelector('.ve-node-run-btn').onclick=e=>{e.stopPropagation();Promise.resolve(this.runNode(node.id)).catch(error=>this._showEditorMessage(error.message,'error'));};
            el.querySelector('.ve-delete-node').onclick=e=>{e.stopPropagation();this.deleteNode(node.id);};
            el.onmousedown=e=>this._startNodeDrag(e,node);
            el.onclick=e=>{if(!this._isInteractiveElement(e.target)){this.selectedNodeId=node.id;this.render();}};
            el.querySelector('.ve-output-port').onmousedown=e=>{e.stopPropagation();this._startConnection(e,node);};
            el.querySelector('.ve-input-port').onmouseup=e=>{e.stopPropagation();this._finishConnection(e,node);};
            const output=el.querySelector('.ve-output-port'),input=el.querySelector('.ve-input-port');
            output.setAttribute('aria-label','Connect from '+this._getNodeDisplayName(node));
            input.setAttribute('aria-label','Connect to '+this._getNodeDisplayName(node));
            output.setAttribute('aria-pressed',String(this.keyboardConnectionSource===node.id));
            output.onclick=e=>{if(e.detail!==0)return;e.stopPropagation();this.keyboardConnectionSource=this.keyboardConnectionSource===node.id?null:node.id;for(const port of this.nodeLayer.querySelectorAll('.ve-output-port'))port.setAttribute('aria-pressed',String(port.closest('.ve-node').dataset.id===this.keyboardConnectionSource));this._showEditorMessage(this.keyboardConnectionSource?'Choose an input connection to finish. Press Escape to cancel.':'Connection cancelled.','info');};
            output.onkeydown=e=>{if(e.key==='Escape'){e.stopPropagation();this.keyboardConnectionSource=null;output.setAttribute('aria-pressed','false');}};
            input.onkeydown=e=>{if(e.key==='Escape'){e.stopPropagation();this.keyboardConnectionSource=null;for(const port of this.nodeLayer.querySelectorAll('.ve-output-port'))port.setAttribute('aria-pressed','false');}};
            input.onclick=e=>{if(e.detail!==0)return;e.stopPropagation();const source=this.nodes.find(n=>n.id===this.keyboardConnectionSource);if(!source){this._showEditorMessage('Activate an output connection first, then an input connection.','info');return;}this.keyboardConnectionSource=null;for(const port of this.nodeLayer.querySelectorAll('.ve-output-port'))port.setAttribute('aria-pressed','false');this.activeConnection?.tempLine?.remove();this.activeConnection={source};this._finishConnection(e,node);Array.from(this.nodeLayer.children).find(el=>el.dataset.id===node.id)?.querySelector('.ve-input-port')?.focus();};
            this.nodeLayer.appendChild(el);
        }
        for(const edge of this.edges)this._drawEdge(edge);
    }

    _drawEdge(edge) {
        const sourceNode = this.nodes.find(n => n.id === edge.source);
        const targetNode = this.nodes.find(n => n.id === edge.target);
        if (!sourceNode || !targetNode) return;

        const sourcePoint = this._graphToViewportPoint(sourceNode.position);
        const targetPoint = this._graphToViewportPoint(targetNode.position);

        // Simple bezier
        const portPoint=(node,selector,fallback)=>{const element=Array.from(this.nodeLayer?.children||[]).find(element=>element.dataset.id===node.id);const rect=element?.querySelector(selector)?.getBoundingClientRect();return rect?this._clientToViewportPoint(rect.left+rect.width/2,rect.top+rect.height/2):fallback;};
        const sourceAnchor=portPoint(sourceNode,'.ve-output-port',{x:sourcePoint.x+300,y:sourcePoint.y+40});
        const targetAnchor=portPoint(targetNode,'.ve-input-port',{x:targetPoint.x,y:targetPoint.y+40});
        const sx=sourceAnchor.x,sy=sourceAnchor.y,tx=targetAnchor.x,ty=targetAnchor.y;

        const controlOffset = Math.abs(tx - sx) * 0.5;
        const d = `M ${sx} ${sy} C ${sx + controlOffset} ${sy}, ${tx - controlOffset} ${ty}, ${tx} ${ty}`;

        // Create a wider invisible path for easier clicking/hovering
        const hitPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        hitPath.setAttribute("d", d);
        hitPath.setAttribute("stroke", "transparent");
        hitPath.setAttribute("stroke-width", "20"); // Thick hit area
        hitPath.setAttribute("fill", "none");
        hitPath.style.cursor = 'pointer';
        hitPath.style.pointerEvents = 'stroke'; // FORCE interaction despite parent none

        // Visual path
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        path.setAttribute("stroke", "#5e6ad2");
        path.setAttribute("stroke-width", "3");
        path.setAttribute("fill", "none");
        path.style.pointerEvents = "none";

        // Calculate Midpoint for Delete Button
        const midX = (sx + tx) / 2;
        const midY = (sy + ty) / 2;

        // Delete Button Group
        const deleteGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        deleteGroup.style.cursor = "pointer";
        deleteGroup.style.pointerEvents = "all"; // Ensure clickable
        deleteGroup.setAttribute('role','button');deleteGroup.setAttribute('tabindex','0');
        deleteGroup.setAttribute('aria-label','Delete connection from '+this._getNodeDisplayName(sourceNode)+' to '+this._getNodeDisplayName(targetNode));

        const deleteHitCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        deleteHitCircle.setAttribute("cx", midX);
        deleteHitCircle.setAttribute("cy", midY);
        deleteHitCircle.setAttribute("r", "18");
        deleteHitCircle.setAttribute("fill", "transparent");
        deleteHitCircle.style.pointerEvents = "all";

        // Simple Red Circle
        const btnCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        btnCircle.setAttribute("cx", midX);
        btnCircle.setAttribute("cy", midY);
        btnCircle.setAttribute("r", "10");
        btnCircle.setAttribute("fill", "#dc3545"); // Stronger red
        btnCircle.setAttribute("stroke", "white");
        btnCircle.setAttribute("stroke-width", "2");

        // 'X' Icon
        const iconHolder=document.createElement('div');iconHolder.innerHTML=window.LVXIcons?.svg('close')||'';
        const btnText=iconHolder.firstElementChild||document.createElementNS('http://www.w3.org/2000/svg','svg');
        btnText.setAttribute('x',midX-6);btnText.setAttribute('y',midY-6);btnText.setAttribute('width','12');btnText.setAttribute('height','12');btnText.style.color='white';
        btnText.style.pointerEvents = "none"; // Pass to group

        deleteGroup.appendChild(deleteHitCircle);
        deleteGroup.appendChild(btnCircle);
        deleteGroup.appendChild(btnText);

        const onDelete = (e) => {
            e.stopPropagation();
            if (confirm('Delete this connection?')) {
                this.edges = this.edges.filter(ed => ed !== edge);
                this.render();
                this._commitHistoryState();
            }
        };

        deleteGroup.onclick = onDelete;
        deleteGroup.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onDelete(e);this.nodeLayer.querySelector('.ve-node-config-btn')?.focus();}};
        deleteGroup.onmousedown = (e) => e.stopPropagation();
        hitPath.ondblclick = onDelete; // Double click connection to delete as well

        // Hover Effect
        const highlight = () => {
            path.setAttribute("stroke", "#dc3545");
            btnCircle.setAttribute("r", "12"); // Scale up slightly
        };
        const reset = () => {
            path.setAttribute("stroke", "#5e6ad2");
            btnCircle.setAttribute("r", "10");
        };

        hitPath.onmouseover = highlight;
        hitPath.onmouseout = reset;
        deleteGroup.onmouseover = highlight;
        deleteGroup.onmouseout = reset;
        deleteGroup.onfocus = highlight;deleteGroup.onblur = reset;

        this.svgLayer.appendChild(path);
        this.svgLayer.appendChild(hitPath);
        this.svgLayer.appendChild(deleteGroup);
    }

    _startNodeDrag(e, node) {
        if (this._isInteractiveElement(e.target)) return;
        if (this.activeTool === 'pan' || e.button === 1) {
            this._startPan(e);
            return;
        }

        const point = this._clientToGraphPoint(e.clientX, e.clientY);
        this.selectedNodeId = node.id;
        this.selectedNode = node;
        this.dragStartPosition = { x: node.position.x, y: node.position.y };
        this.dragOffset = {
            x: point.x - node.position.x,
            y: point.y - node.position.y
        };
        e.preventDefault();
    }

    _handleMouseMove(e) {
        if (this.selectedNode) {
            // Move Node
            const point = this._clientToGraphPoint(e.clientX, e.clientY);
            this.selectedNode.position.x = point.x - this.dragOffset.x;
            this.selectedNode.position.y = point.y - this.dragOffset.y;
            this.render(); // Re-render edges
        } else if (this.isPanning && this.panStart) {
            this.panning.x = e.clientX - this.panStart.x;
            this.panning.y = e.clientY - this.panStart.y;
            this._applyViewportTransform();
        } else if (this.activeConnection) {
            // Draw Temp Line
            const graphPoint = this._clientToGraphPoint(e.clientX, e.clientY);
            const viewportPoint = this._graphToViewportPoint(graphPoint);
            const mx = viewportPoint.x;
            const my = viewportPoint.y;

            const sx = this.activeConnection.startX;
            const sy = this.activeConnection.startY;

            // Draw Bezier to mouse
            const controlOffset = Math.abs(mx - sx) * 0.5;
            const d = `M ${sx} ${sy} C ${sx + controlOffset} ${sy}, ${mx - controlOffset} ${my}, ${mx} ${my}`;

            if (this.activeConnection.tempLine) {
                this.activeConnection.tempLine.setAttribute("d", d);
            }
        }
    }

    _handleMouseUp(e) {
        const draggedNode = this.selectedNode;
        const dragStartPosition = this.dragStartPosition;
        this.selectedNode = null;
        this.dragStartPosition = null;
        this.isPanning = false;
        this.panStart = null;
        this._setCanvasCursor();
        if (
            draggedNode &&
            dragStartPosition &&
            (draggedNode.position.x !== dragStartPosition.x || draggedNode.position.y !== dragStartPosition.y)
        ) {
            this._commitHistoryState();
        }
        if (this.activeConnection) {
            // Cancel connection if dropped on nothing
            if (this.activeConnection.tempLine) {
                this.activeConnection.tempLine.remove();
            }
            this.activeConnection = null;
        }
    }

    _startConnection(e, node) {
        if (this.activeTool === 'pan' || e.button === 1) {
            this._startPan(e);
            return;
        }

        const viewportPoint = this._graphToViewportPoint(node.position);
        // Calculate start position (Right port)
        // Since node position is top-left, we approximated width=300 in CSS
        // Let's get exact position if possible, but for now rely on node position assumption
        const element=Array.from(this.nodeLayer?.children||[]).find(element=>element.dataset.id===node.id),rect=element?.querySelector('.ve-output-port')?.getBoundingClientRect();
        const anchor=rect?this._clientToViewportPoint(rect.left+rect.width/2,rect.top+rect.height/2):{x:viewportPoint.x+300,y:viewportPoint.y+40};
        const startX=anchor.x,startY=anchor.y;

        // Create temp SVG line
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("stroke", "#5e6ad2");
        path.setAttribute("stroke-width", "3");
        path.setAttribute("stroke-dasharray", "5,5"); // Dashed for temp
        path.setAttribute("fill", "none");
        path.setAttribute("opacity", "0.6");
        path.style.pointerEvents = "none";

        this.svgLayer.appendChild(path);

        this.activeConnection = {
            source: node,
            startX: startX,
            startY: startY,
            tempLine: path
        };
    }

    _finishConnection(e, targetNode) {
        if (!this.activeConnection) return;
        const sourceNode = this.activeConnection.source;

        // Cleanup temp line
        if (this.activeConnection.tempLine) {
            this.activeConnection.tempLine.remove();
        }
        this.activeConnection = null;

        const validation = this._validateConnection(sourceNode, targetNode);
        if (!validation.valid) {
            this._showEditorMessage(validation.message, 'error');
            return;
        }

        // create edge
        this.edges.push({
            id: 'edge_' + Date.now() + '_' + Math.random().toString(36).slice(2,8),
            source: sourceNode.id,
            target: targetNode.id
        });

        this.render();
        this._commitHistoryState();
    }

    deleteNode(id) {
        this.nodes = this.nodes.filter(n => n.id !== id);
        this.edges = this.edges.filter(e => e.source !== id && e.target !== id);
        if (this.selectedNodeId === id) {
            this.selectedNodeId = null;
        }
        this.render();
        this._commitHistoryState();
    }

    async runNode(id) {
        const node = this.nodes.find(n => n.id === id);
        if (!node) return {status:'ERROR',message:'Node not found.'};
        if (window.LVXMachinaGraph) return window.LVXMachinaGraph.runWorkflow(this.getGraph(),node.type==='start-runner'?{runnerId:id}:{selectedNodeId:id},this);
        // Compatibility for the older standalone suite/unit adapters when no Studio bridge is loaded.
        if(node.type==='unit-test-runner' && window.runUnitTestNode){
            const upstream=this._buildExecutionSubgraph(id).nodes;
            const repoPath=upstream.find(n=>n.id!==id&&n.data?.clonedPath)?.data.clonedPath;
            return window.runUnitTestNode(node,{repoPath});
        }
        if(this._isSuiteBackedNode(node)&&window.runTestSuite)return window.runTestSuite(node.data.suiteId);
        throw new Error('Open the desktop Studio execution service to run this node.');
    }

    async _runSecurityScanNode(node) { return this.runNode(node.id); }

    showSecurityNodeConfig(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        // Remove existing config modal if any
        const existingModal = document.getElementById('ve-security-config-modal');
        if (existingModal) existingModal.remove();

        // Create modal
        const modal = document.createElement('div');
        modal.id = 've-security-config-modal';
        modal.className='mg-dialog';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.6); z-index: 10000;
            display: flex; align-items: center; justify-content: center;
        `;

        let configHTML;
        if (node.type === 'security-scan') {
            // Security Scan configuration
            const config = node.data.config || {};
            configHTML = `
                <div class="aero-modal p-6 rounded-xl max-w-md w-full" style="background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);">
                    <h3 class="text-xl font-bold text-slate-900 mb-4"> Security Scan Configuration</h3>

                    <div class="mb-4">
                        <label class="block text-sm text-slate-800 mb-2">Scan Mode</label>
                        <select id="cfg-scan-mode" class="w-full aero-input p-2 rounded-lg" onchange="document.getElementById('cfg-target-wrapper').style.display = this.value === 'code' ? 'none' : 'block'; document.getElementById('cfg-lang-wrapper').style.display = this.value === 'code' ? 'block' : 'none';">
                            <option value="code" ${!config.scanType || config.scanType === 'code' ? 'selected' : ''}>Code Analysis (SAST)</option>
                            <option value="docker_container" ${config.scanType === 'docker_container' ? 'selected' : ''}>Docker Container</option>
                            <option value="docker_image" ${config.scanType === 'docker_image' ? 'selected' : ''}>Docker Image</option>
                            <option value="k8s_yaml" ${config.scanType === 'k8s_yaml' ? 'selected' : ''}>Kubernetes Manifest</option>
                            <option value="network_port" ${config.scanType === 'network_port' ? 'selected' : ''}>Network Port</option>
                        </select>
                    </div>

                    <div id="cfg-lang-wrapper" class="mb-4" style="display: ${!config.scanType || config.scanType === 'code' ? 'block' : 'none'}">
                        <label class="block text-sm text-slate-800 mb-2">Scan Types</label>
                        <div class="space-y-2 mb-3">
                            <label class="flex items-center gap-2">
                                <input type="checkbox" id="cfg-sast" ${config.sast !== false ? 'checked' : ''}>
                                <span class="text-sm text-slate-800">SAST (Code Analysis)</span>
                            </label>
                            <label class="flex items-center gap-2">
                                <input type="checkbox" id="cfg-secrets" ${config.secrets !== false ? 'checked' : ''}>
                                <span class="text-sm text-slate-800">Secrets Detection</span>
                            </label>
                            <label class="flex items-center gap-2">
                                <input type="checkbox" id="cfg-xss" ${config.xss || false ? 'checked' : ''}>
                                <span class="text-sm text-slate-800">XSS Patterns</span>
                            </label>
                        </div>

                        <label class="block text-sm text-slate-800 mb-2">Target Language</label>
                        <select id="cfg-language" class="w-full aero-input p-2 rounded-lg">
                            <option value="javascript" ${config.language === 'javascript' ? 'selected' : ''}>JavaScript</option>
                            <option value="python" ${config.language === 'python' ? 'selected' : ''}>Python</option>
                        </select>
                    </div>

                    <div id="cfg-target-wrapper" class="mb-4" style="display: ${config.scanType && config.scanType !== 'code' ? 'block' : 'none'}">
                        <label class="block text-sm text-slate-800 mb-2">Target (ID/Name/Path/IP:Port)</label>
                        <input type="text" id="cfg-target" value="${this._escapeHTML(config.target || '')}" class="w-full aero-input p-2 rounded-lg" placeholder="e.g. my-container-id or localhost:8080">
                    </div>

                    <div class="mb-6">
                        <label class="flex items-center gap-2">
                            <input type="checkbox" id="cfg-notify" ${config.notify ? 'checked' : ''}>
                            <span class="text-sm text-slate-800">Send notifications on completion</span>
                        </label>
                    </div>

                    <div class="flex gap-2 justify-end">
                        <button id="cfg-cancel" class="aero-button-gray py-2 px-4 rounded-lg">Cancel</button>
                        <button id="cfg-save" class="aero-button-success py-2 px-4 rounded-lg">Save</button>
                    </div>
                </div>
            `;
        } else if (node.type === 'security-gate') {
            // Security Gate configuration
            const config = node.data.config || {};
            configHTML = `
                <div class="aero-modal p-6 rounded-xl max-w-md w-full" style="background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);">
                    <h3 class="text-xl font-bold aero-text-primary mb-4"> Security Gate Configuration</h3>
                    <p class="text-sm aero-text-muted mb-4">Pipeline will fail if vulnerabilities exceed these thresholds:</p>

                    <div class="space-y-4 mb-6">
                        <div>
                            <label class="block text-sm aero-text-secondary mb-1">Max Critical Vulnerabilities</label>
                            <input type="number" id="cfg-max-critical" min="0" value="${this._escapeHTML(config.maxCritical ?? 0)}"
                                class="w-full aero-input p-2 rounded-lg">
                        </div>
                        <div>
                            <label class="block text-sm aero-text-secondary mb-1">Max High Vulnerabilities</label>
                            <input type="number" id="cfg-max-high" min="0" value="${this._escapeHTML(config.maxHigh ?? 5)}"
                                class="w-full aero-input p-2 rounded-lg">
                        </div>
                        <div>
                            <label class="block text-sm aero-text-secondary mb-1">Max Medium Vulnerabilities</label>
                            <input type="number" id="cfg-max-medium" min="0" value="${this._escapeHTML(config.maxMedium ?? 20)}"
                                class="w-full aero-input p-2 rounded-lg">
                        </div>
                    </div>

                    <div class="flex gap-2 justify-end">
                        <button id="cfg-cancel" class="aero-button-gray py-2 px-4 rounded-lg">Cancel</button>
                        <button id="cfg-save" class="aero-button-success py-2 px-4 rounded-lg">Save</button>
                    </div>
                </div>
            `;
        }

        modal.innerHTML = configHTML;
        document.body.appendChild(modal);

        // Event handlers
        const cancelBtn = modal.querySelector('#cfg-cancel');
        cancelBtn.onclick = () => modal.remove();

        const saveBtn = modal.querySelector('#cfg-save');
        saveBtn.onclick = () => {
            // Gather values
            if (node.type === 'security-scan') {
                const scanType = modal.querySelector('#cfg-scan-mode').value;
                node.data = {
                    ...node.data,
                    config: {
                        ...node.data.config,
                        scanType: scanType,
                        // Code options
                        sast: modal.querySelector('#cfg-sast').checked,
                        secrets: modal.querySelector('#cfg-secrets').checked,
                        xss: modal.querySelector('#cfg-xss').checked,
                        language: modal.querySelector('#cfg-language').value,
                        // Infra options
                        target: modal.querySelector('#cfg-target').value,
                        // Shared
                        notify: modal.querySelector('#cfg-notify').checked
                    }
                };

                // Construct display name based on config
                if (scanType === 'code') node.data.name = ' Security Scan (Code)';
                else if (scanType.includes('docker')) node.data.name = ' ' + scanType;
                else if (scanType.includes('k8s')) node.data.name = ' K8s Scan';
                else if (scanType.includes('network')) node.data.name = ' Net Scan';

            } else if (node.type === 'security-gate') {
                node.data.config = {
                    ...node.data.config,
                    maxCritical: parseInt(modal.querySelector('#cfg-max-critical').value),
                    maxHigh: parseInt(modal.querySelector('#cfg-max-high').value),
                    maxMedium: parseInt(modal.querySelector('#cfg-max-medium').value)
                };
            }

            this.render(); // Re-render to show updated name
            this._commitHistoryState();
            modal.remove();

            // Show confirmation
            if (window.showToast) {
                window.showToast('Configuration saved', 'success');
            }
        };

        // Close on backdrop click
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
    }

    async showGitNodeConfig(nodeId) {
        console.log('showGitNodeConfig called for:', nodeId);
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const modal = document.createElement('div');
        modal.className = 'mg-dialog fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[10000]';

        const config = node.data;

        let contentHTML = '';


            contentHTML = `
                <h3 class="text-xl font-bold text-slate-900 mb-4"> Git Repository Configuration</h3>

                <div class="space-y-4 mb-6">
                    <div>
                        <label class="block text-sm text-slate-800 mb-1">Repository URL</label>
                        <input type="text" id="cfg-repo-url" value="${this._escapeHTML(config.repoUrl || '')}"
                            placeholder="https://github.com/user/repo.git"
                            class="w-full aero-input p-2 rounded-lg">
                    </div>
                    <div>
                        <label class="block text-sm text-slate-800 mb-1">Branch</label>
                        <input type="text" id="cfg-branch" value="${this._escapeHTML(config.branch || 'main')}"
                            placeholder="main"
                            class="w-full aero-input p-2 rounded-lg">
                    </div>
                    <div>
                        <label class="block text-sm text-slate-800 mb-1">Authentication (Optional)</label>
                        <input type="password" id="cfg-auth" value="${this._secretDisplay(config.auth)}" placeholder="Personal Access Token (for private repos)"
                            class="w-full aero-input p-2 rounded-lg">
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm text-slate-800 mb-1">If branch is missing</label>
                            <select id="cfg-branch-policy" class="w-full aero-input p-2 rounded-lg">
                                <option value="fail" ${(config.branchMissingPolicy || 'fail') === 'fail' ? 'selected' : ''}>Fail the node</option>
                                <option value="create" ${config.branchMissingPolicy === 'create' ? 'selected' : ''}>Create branch from base</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm text-slate-800 mb-1">Base branch when creating</label>
                            <input type="text" id="cfg-branch-base" value="${this._escapeHTML(config.branchBase || 'main')}"
                                placeholder="main"
                                class="w-full aero-input p-2 rounded-lg">
                        </div>
                    </div>
                    <p class="text-xs text-slate-600 -mt-2">Use "Create branch from base" when the target branch may not exist yet. Creating a remote branch requires push access.</p>
                </div>

                <div class="flex gap-2 justify-end">
                    <button id="cfg-cancel" class="aero-button-gray py-2 px-4 rounded-lg">Cancel</button>
                    <button id="cfg-save" class="aero-button-success py-2 px-4 rounded-lg">Save</button>
                </div>
            `;

        modal.innerHTML = `
            <div class="aero-modal p-6 rounded-xl max-w-md w-full" style="background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);">
                ${contentHTML}
            </div>
        `;
        document.body.appendChild(modal);

            modal.querySelector('#cfg-cancel').onclick = () => modal.remove();
            modal.querySelector('#cfg-save').onclick = () => {
                let rawUrl = modal.querySelector('#cfg-repo-url').value.trim();

                // Smart Fix: Handle GitHub file/tree links and extract branch
                // Matches: github.com/user/repo/(blob|tree)/branch/...
                if (rawUrl.includes('github.com')) {
                    const match = rawUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/(blob|tree)\/([^\/]+)/);
                    if (match) {
                        // match[1]=user, [2]=repo, [3]=type, [4]=branch
                        const cleanRepoUrl = `https://github.com/${match[1]}/${match[2]}`;
                        const detectedBranch = match[4];

                        console.log(`Auto-corrected Git URL: ${rawUrl} -> ${cleanRepoUrl}`);

                        rawUrl = cleanRepoUrl;

                        // Auto-fill branch if user hasn't typed a custom one (or is default 'main')
                        const branchInput = modal.querySelector('#cfg-branch');
                        if (branchInput && (branchInput.value === 'main' || branchInput.value === '')) {
                            branchInput.value = detectedBranch;
                            if (window.showToast) window.showToast(` Detected branch: ${detectedBranch}`, 'info');
                        }

                        if (window.showToast) window.showToast(' Auto-corrected URL to Repository Root', 'info');
                    }
                }

                node.data.repoUrl = rawUrl;
                node.data.branch = modal.querySelector('#cfg-branch').value;
                node.data.auth = modal.querySelector('#cfg-auth').value.trim() || node.data.auth || '';
                node.data.branchMissingPolicy = modal.querySelector('#cfg-branch-policy').value || 'fail';
                node.data.branchBase = modal.querySelector('#cfg-branch-base').value.trim() || 'main';
                node.data.name = ` ${node.data.repoUrl.split('/').pop() || 'Git Repo'}`;

                this.render();
                this._commitHistoryState();
                modal.remove();
                if (window.showToast) window.showToast('Git config saved', 'success');
            };

        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
    }

    async _runGitNode(node) { return this.runNode(node.id); }

    showUnitTestConfig(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const modal = document.createElement('div');
        modal.className = 'mg-dialog fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[10000]';

        const config = node.data;

        modal.innerHTML = `
            <div class="aero-modal p-6 rounded-xl max-w-2xl w-full flex flex-col max-h-[90vh]" style="background: linear-gradient(180deg, #2e1065 0%, #170736 100%); border: 1px solid rgba(139, 92, 246, 0.5);">
                <h3 class="text-xl font-bold text-slate-900 mb-4"> Unit Test Injection</h3>

                <div class="space-y-4 mb-6 flex-1 overflow-y-auto">
                    <!-- Filename -->
                    <div>
                        <label class="block text-sm text-slate-800 mb-1">Test Filename (to inject)</label>
                        <input type="text" id="cfg-filename" value="${this._escapeHTML(config.testFilename || 'custom-test.js')}"
                            placeholder="e.g. custom-test.js"
                            class="w-full aero-input p-2 rounded-lg font-mono text-sm" style="background: rgba(255,255,255,0.1); color: white; border-color: rgba(255,255,255,0.2);">
                    </div>

                    <!-- Code Editor -->
                    <div class="flex-1 flex flex-col">
                        <label class="block text-sm text-slate-800 mb-1">Test Code</label>
                        <textarea id="cfg-code" class="w-full h-64 aero-input p-3 rounded-lg font-mono text-sm"
                            style="background: #0f172a; color: #a5b4fc; border-color: rgba(139, 92, 246, 0.3);"
                            placeholder="// Write your test code here\n// It will be saved to the repo folder before running the command.\n\nconst fs = require('fs');\nconsole.log('Running test...');">${this._escapeHTML(config.testCode || '')}</textarea>
                    </div>

                    <!-- Command -->
                    <div>
                        <label class="block text-sm text-slate-800 mb-1">Execution Command</label>
                        <input type="text" id="cfg-command" value="${this._escapeHTML(config.command || 'node custom-test.js')}"
                            placeholder="e.g. node custom-test.js"
                            class="w-full aero-input p-2 rounded-lg font-mono text-sm" style="background: rgba(255,255,255,0.1); color: white; border-color: rgba(255,255,255,0.2);">
                        <p class="text-xs text-slate-600 mt-1">This command is executed in the repo root after injecting the file.</p>
                    </div>
                </div>

                <div class="flex gap-2 justify-end mt-auto pt-4 border-t border-gray-700">
                    <button id="cfg-cancel" class="aero-button-gray py-2 px-4 rounded-lg">Cancel</button>
                    <button id="cfg-save" class="aero-button-success py-2 px-4 rounded-lg">Save Configuration</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };

        modal.querySelector('#cfg-cancel').onclick = () => modal.remove();
        modal.querySelector('#cfg-save').onclick = () => {
            const filename = modal.querySelector('#cfg-filename').value.trim();
            const code = modal.querySelector('#cfg-code').value;
            const cmd = modal.querySelector('#cfg-command').value.trim();

            node.data.testFilename = filename;
            node.data.testCode = code;
            node.data.command = cmd;

            node.data.name = ` ${filename}`; // Update node label to show filename

            this.render();
            this._commitHistoryState();
            modal.remove();
            if (window.showToast) window.showToast('Test injection config saved', 'success');
        };
    }

    showSuiteNodeConfig(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        const suiteId = node?.data?.suiteId;
        if (!suiteId) return;

        if (typeof window.editSuite === 'function') {
            window.editSuite(suiteId);
            return;
        }

        if (typeof window.showMessage === 'function') {
            window.showMessage('Unable to open suite editor from graph view.', 'error');
        }
    }

    showStartRunnerConfig(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const downstreamNodes = this._getDownstreamNodes(nodeId);
        const config = node.data || {};
        const retryState = this._getStartRunnerRetryState(nodeId, config);
        const retryCandidateNodes = retryState.retryCandidateNodes;
        let retryRows = retryState.retryRows.map(row => ({
            ...row,
            showSubtree: false
        }));

        const modal = document.createElement('div');
        modal.className = 'mg-dialog fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[10000]';
        modal.innerHTML = `
            <div class="aero-modal p-6 rounded-xl w-[95vw] max-w-5xl flex flex-col max-h-[92vh]" style="background: linear-gradient(180deg, #14532d 0%, #166534 12%, #84cc16 100%); border: 2px solid rgba(20, 83, 45, 0.9); color: #111827;">
                <h3 class="text-2xl font-bold mb-3" style="color: #052e16;">Start Runner Node - Configuration Window</h3>
                <p class="text-sm mb-5" style="color: rgba(5, 46, 22, 0.88);">Choose which connected graph nodes should retry on failure, where logs should be saved, and where this runner should stop.</p>

                <div class="flex-1 overflow-y-auto space-y-6 pr-2">
                    <section>
                        <div class="flex items-center justify-between mb-3 gap-4">
                            <div>
                                <h4 class="text-lg font-semibold" style="color: #052e16;">Jobs to retry running upon fail</h4>
                                <p class="text-xs" style="color: rgba(5, 46, 22, 0.78);">Retries are applied only to the nodes connected directly after this runner.</p>
                            </div>
                            <button id="cfg-runner-add-retry" class="aero-button-success py-2 px-4 rounded-lg" ${retryCandidateNodes.length === 0 ? 'disabled' : ''}>Add Another</button>
                        </div>

                        <div id="cfg-runner-no-downstream" class="rounded-lg p-3 text-sm" style="display:${retryCandidateNodes.length === 0 ? 'block' : 'none'}; background: rgba(255,255,255,0.3); border: 1px solid rgba(20, 83, 45, 0.35); color: #14532d;">
                            Connect one or more nodes directly after this Start Runner Node to configure retries.
                        </div>

                        <div id="cfg-runner-retry-rows" class="space-y-3"></div>
                    </section>

                    <section class="space-y-4">
                        <div>
                            <label class="block text-sm font-semibold mb-2" style="color: #052e16;">Download Logs</label>
                            <select id="cfg-runner-download-logs" class="w-full aero-input p-3 rounded-lg" style="background: rgba(255,255,255,0.82); color: #111827; border-color: rgba(20, 83, 45, 0.4);">
                                <option value="no" ${config.downloadLogs ? '' : 'selected'}>No</option>
                                <option value="yes" ${config.downloadLogs ? 'selected' : ''}>Yes</option>
                            </select>
                        </div>

                        <div id="cfg-runner-log-path-group">
                            <label class="block text-sm font-semibold mb-2" style="color: #052e16;">Destination to save logs to</label>
                            <input type="text" id="cfg-runner-log-path" value="${this._escapeHTML(config.logPath || '')}" placeholder="logs/runner.log or logs/" class="w-full aero-input p-3 rounded-lg font-mono text-sm" style="background: rgba(255,255,255,0.82); color: #111827; border-color: rgba(20, 83, 45, 0.4);">
                            <p class="text-xs mt-2" style="color: rgba(5, 46, 22, 0.78);">Paths stay inside the selected workspace. A folder receives a separate log file for each run.</p>

                            <div class="mt-3 flex flex-wrap gap-4">
                                <label class="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" id="cfg-runner-save-node-logs" ${config.saveIndividualNodeLogs ? 'checked' : ''} class="w-4 h-4 transition-all">
                                    <span class="text-xs font-semibold" style="color: #052e16;">Save individual logs for each node</span>
                                </label>
                                <label class="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" id="cfg-runner-capture-ai" ${config.captureAIContext ? 'checked' : ''} class="w-4 h-4 transition-all">
                                    <span class="text-xs font-semibold" style="color: #052e16;">Capture AI log summaries in master log</span>
                                </label>
                            </div>
                        </div>

                        <div>
                            <label class="block text-sm font-semibold mb-2" style="color: #052e16;">The final node where the runner stops upon completing</label>
                            <select id="cfg-runner-stop-node" class="w-full aero-input p-3 rounded-lg" style="background: rgba(255,255,255,0.82); color: #111827; border-color: rgba(20, 83, 45, 0.4);">
                                <option value="">Run the entire downstream tree</option>
                                ${downstreamNodes.map(targetNode => `<option value="${this._escapeHTML(targetNode.id)}" ${config.stopNodeId === targetNode.id ? 'selected' : ''}>${this._escapeHTML(targetNode.data?.name || targetNode.id)}</option>`).join('')}
                            </select>
                        </div>
                    </section>
                </div>

                <div class="flex gap-2 justify-end mt-6 pt-4 border-t" style="border-color: rgba(20, 83, 45, 0.35);">
                    <button id="cfg-runner-cancel" class="aero-button-gray py-2 px-4 rounded-lg">Cancel</button>
                    <button id="cfg-runner-save" class="aero-button-success py-2 px-4 rounded-lg">Save</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const rowsContainer = modal.querySelector('#cfg-runner-retry-rows');
        const addRetryBtn = modal.querySelector('#cfg-runner-add-retry');
        const downloadLogsSelect = modal.querySelector('#cfg-runner-download-logs');
        const logPathGroup = modal.querySelector('#cfg-runner-log-path-group');
        const stopNodeSelect = modal.querySelector('#cfg-runner-stop-node');

        const getAvailableRetryNodes = (selectedNodeId = '') => {
            const occupiedNodeIds = new Set(
                retryRows
                    .map(row => row.nodeId)
                    .filter(nodeId => nodeId && nodeId !== selectedNodeId)
            );

            return retryCandidateNodes.filter(targetNode => targetNode.id === selectedNodeId || !occupiedNodeIds.has(targetNode.id));
        };

        const buildRetryNodeOptions = (selectedNodeId = '') => {
            const placeholder = '<option value="">Select connected node</option>';
            const options = getAvailableRetryNodes(selectedNodeId).map(targetNode => {
                const selected = targetNode.id === selectedNodeId ? 'selected' : '';
                return `<option value="${this._escapeHTML(targetNode.id)}" ${selected}>${this._escapeHTML(targetNode.data?.name || targetNode.id)}</option>`;
            });
            return [placeholder, ...options].join('');
        };

        const syncAddRetryButtonState = () => {
            if (!addRetryBtn) return;

            const hasAvailableNodes = retryCandidateNodes.some(targetNode =>
                !retryRows.some(row => row.nodeId === targetNode.id)
            );

            addRetryBtn.disabled = !hasAvailableNodes;
        };

        const syncLogPathVisibility = () => {
            const enabled = downloadLogsSelect.value === 'yes';
            logPathGroup.style.opacity = enabled ? '1' : '0.55';
            const logPathInput = modal.querySelector('#cfg-runner-log-path');
            if (logPathInput) {
                logPathInput.disabled = !enabled;
            }
        };

        const renderRetryRows = () => {
            const stopNodeOverrides = {
                [nodeId]: stopNodeSelect?.value || ''
            };

            rowsContainer.innerHTML = retryRows.map((row, index) => `
                <div class="cfg-runner-retry-row rounded-lg p-3" data-index="${index}" style="background: rgba(255,255,255,0.28); border: 1px solid rgba(20, 83, 45, 0.3);">
                    <div class="grid grid-cols-[minmax(0,1fr)_180px_52px] gap-3 items-center">
                        <div>
                            <label class="block text-xs font-semibold mb-1" style="color: #052e16;">Downstream node</label>
                            <select class="cfg-runner-retry-node w-full aero-input p-2 rounded-lg" style="background: rgba(255,255,255,0.86); color: #111827; border-color: rgba(20, 83, 45, 0.35);">
                                ${buildRetryNodeOptions(row.nodeId)}
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-semibold mb-1" style="color: #052e16;">Retry attempts</label>
                            <input type="number" min="1" max="20" value="${this._escapeHTML(row.attempts || 1)}" class="cfg-runner-retry-attempts w-full aero-input p-2 rounded-lg text-sm font-mono" style="background: rgba(255,255,255,0.86); color: #111827; border-color: rgba(20, 83, 45, 0.35);">
                        </div>
                        <button type="button" class="cfg-runner-remove-retry rounded-full w-10 h-10 font-bold" data-index="${index}" style="background: #ea580c; color: white; border: 2px solid rgba(124, 45, 18, 0.75);">X</button>
                    </div>

                    <div style="margin-top: 10px;">
                        <button type="button" class="cfg-runner-toggle-subtree py-2 px-3 rounded-lg font-semibold text-sm" data-index="${index}" style="background: linear-gradient(180deg, #67e8f9 0%, #22d3ee 100%); color: #042f2e; border: 1px solid rgba(8, 145, 178, 0.55); min-width: 180px;">
                            ${row.showSubtree ? '&#8722; Hide sub-tree' : '&#43; Show sub-tree'}
                        </button>
                        <div class="cfg-runner-subtree-panel" style="display:${row.showSubtree ? 'block' : 'none'}; margin-top: 10px; padding: 12px; border-radius: 12px; background: rgba(255,255,255,0.2); border: 1px solid rgba(20, 83, 45, 0.2);">
                            ${row.showSubtree
                                ? this._renderStartRunnerSubtree(this._buildStartRunnerSubtree(nodeId, row.nodeId, stopNodeOverrides))
                                : ''}
                        </div>
                    </div>
                </div>
            `).join('');

            rowsContainer.querySelectorAll('.cfg-runner-remove-retry').forEach(button => {
                button.onclick = () => {
                    const index = parseInt(button.dataset.index, 10);
                    retryRows.splice(index, 1);
                    renderRetryRows();
                };
            });

            rowsContainer.querySelectorAll('.cfg-runner-retry-node').forEach(selectEl => {
                selectEl.onchange = () => {
                    const rowEl = selectEl.closest('.cfg-runner-retry-row');
                    const index = rowEl ? parseInt(rowEl.dataset.index, 10) : -1;
                    if (index < 0 || index >= retryRows.length) return;

                    retryRows[index].nodeId = selectEl.value || '';
                    renderRetryRows();
                };
            });

            rowsContainer.querySelectorAll('.cfg-runner-retry-attempts').forEach(inputEl => {
                inputEl.oninput = () => {
                    const rowEl = inputEl.closest('.cfg-runner-retry-row');
                    const index = rowEl ? parseInt(rowEl.dataset.index, 10) : -1;
                    if (index < 0 || index >= retryRows.length) return;

                    const attemptsValue = parseInt(inputEl.value, 10);
                    retryRows[index].attempts = Number.isFinite(attemptsValue) && attemptsValue > 0 ? attemptsValue : 1;
                };
            });

            rowsContainer.querySelectorAll('.cfg-runner-toggle-subtree').forEach(button => {
                button.onclick = () => {
                    const index = parseInt(button.dataset.index, 10);
                    if (!Number.isInteger(index) || index < 0 || index >= retryRows.length) return;

                    retryRows[index].showSubtree = !retryRows[index].showSubtree;
                    renderRetryRows();
                };
            });

            syncAddRetryButtonState();
        };

        renderRetryRows();
        syncLogPathVisibility();

        if (addRetryBtn) {
            addRetryBtn.onclick = () => {
                const nextAvailableNode = retryCandidateNodes.find(targetNode =>
                    !retryRows.some(row => row.nodeId === targetNode.id)
                );

                if (!nextAvailableNode) return;

                retryRows.push({ nodeId: nextAvailableNode.id, attempts: 1, showSubtree: false });
                renderRetryRows();
            };
        }

        downloadLogsSelect.onchange = syncLogPathVisibility;
        if (stopNodeSelect) {
            stopNodeSelect.onchange = () => renderRetryRows();
        }

        modal.querySelector('#cfg-runner-cancel').onclick = () => modal.remove();
        modal.querySelector('#cfg-runner-save').onclick = () => {
            const parsedRetryTargets = Array.from(rowsContainer.querySelectorAll('.cfg-runner-retry-row')).map(rowEl => {
                const nodeIdValue = rowEl.querySelector('.cfg-runner-retry-node')?.value || '';
                const attemptsValue = parseInt(rowEl.querySelector('.cfg-runner-retry-attempts')?.value, 10);
                return {
                    nodeId: nodeIdValue,
                    attempts: Number.isFinite(attemptsValue) && attemptsValue > 0 ? attemptsValue : 1
                };
            }).filter(row => row.nodeId);

            node.data.retryTargets = parsedRetryTargets;
            node.data.disabledRetryNodeIds = retryCandidateNodes
                .filter(targetNode => !parsedRetryTargets.some(row => row.nodeId === targetNode.id))
                .map(targetNode => targetNode.id);
            node.data.downloadLogs = downloadLogsSelect.value === 'yes';
            node.data.logPath = modal.querySelector('#cfg-runner-log-path').value.trim();
            node.data.saveIndividualNodeLogs = modal.querySelector('#cfg-runner-save-node-logs').checked;
            node.data.captureAIContext = modal.querySelector('#cfg-runner-capture-ai').checked;
            node.data.stopNodeId = modal.querySelector('#cfg-runner-stop-node').value || '';
            node.data.name = 'Start Runner Node';

            this.render();
            this._commitHistoryState();
            modal.remove();
            if (window.showToast) window.showToast('Start Runner Node config saved', 'success');
        };

        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
    }

    showAILogSummaryConfig(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const config = node.data || {};
        const providerOptions = this._getAIProviderOptions(config.provider || 'google');
        const upstreamNode = this._getPrimaryUpstreamNode(nodeId);
        const upstreamLabel = upstreamNode
            ? this._escapeHTML(this._getNodeDisplayName(upstreamNode))
            : 'No upstream node connected yet';

        const modal = document.createElement('div');
        modal.className = 'mg-dialog fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[10000]';
        modal.innerHTML = `
            <div class="aero-modal p-6 rounded-xl max-w-3xl w-full flex flex-col max-h-[92vh]" style="background: linear-gradient(180deg, #4c1d95 0%, #7c3aed 24%, #fb923c 100%); border: 1px solid rgba(216, 180, 254, 0.65); color: white;">
                <h3 class="text-2xl font-bold mb-4">AI Assisted Log Summary</h3>

                <div class="rounded-lg p-3 mb-5 text-sm" style="background: rgba(15, 23, 42, 0.22); border: 1px solid rgba(255,255,255,0.2);">
                    <div class="font-semibold mb-1">Connected upstream node</div>
                    <div>${upstreamLabel}</div>
                    <div class="mt-2 text-xs" style="opacity: 0.9;">Choose whether to summarize the node directly before this one, the full upstream chain, or the entire runner log. AI summaries can be wrong and should be verified.</div>
                </div>

                <div class="space-y-4 mb-6 flex-1 overflow-y-auto pr-2">
                    <div>
                        <label class="block text-sm mb-1">Name of node</label>
                        <input type="text" id="cfg-ai-log-name" value="${this._escapeHTML(config.name || 'AI Log Summary')}"
                            class="w-full aero-input p-2 rounded-lg"
                            style="background: rgba(255,255,255,0.12); color: white; border-color: rgba(255,255,255,0.25);">
                    </div>

                    <div>
                        <label class="block text-sm mb-1">AI Model</label>
                        <select id="cfg-ai-log-provider" class="w-full aero-input p-2 rounded-lg"
                            style="background: rgba(255,255,255,0.12); color: white; border-color: rgba(255,255,255,0.25);">
                            ${providerOptions}
                        </select>
                        <p class="text-xs mt-1" style="color: rgba(255,255,255,0.82);">Options: OpenAI, Anthropic (Claude), Google (Gemini), Custom (OpenAI-compatible)</p>
                    </div>

                    <div>
                        <label class="block text-sm mb-1">Summary scope</label>
                        <select id="cfg-ai-log-scope" class="w-full aero-input p-2 rounded-lg"
                            style="background: rgba(255,255,255,0.12); color: white; border-color: rgba(255,255,255,0.25);">
                            <option value="full-runner-log" ${(config.summaryScope || 'full-runner-log') === 'full-runner-log' ? 'selected' : ''}>Full runner log</option>
                            <option value="upstream-chain" ${config.summaryScope === 'upstream-chain' ? 'selected' : ''}>All upstream nodes in this chain</option>
                            <option value="direct-upstream" ${config.summaryScope === 'direct-upstream' ? 'selected' : ''}>Only the directly connected previous node</option>
                        </select>
                        <p class="text-xs mt-1" style="color: rgba(255,255,255,0.82);">Use full runner log if you want one final summary of the entire automation run.</p>
                    </div>

                    <div>
                        <label class="block text-sm mb-1">Model name (optional)</label>
                        <input type="text" id="cfg-ai-log-model" value="${this._escapeHTML(config.model || '')}"
                            placeholder="e.g. gpt-4o, claude-sonnet-4-20250514, gemini-2.5-flash"
                            class="w-full aero-input p-2 rounded-lg font-mono text-sm"
                            style="background: rgba(255,255,255,0.12); color: white; border-color: rgba(255,255,255,0.25);">
                    </div>

                    <div id="cfg-ai-log-endpoint-group" style="display: ${(config.provider || 'google') === 'custom' ? 'block' : 'none'};">
                        <label class="block text-sm mb-1">Custom API endpoint</label>
                        <input type="text" id="cfg-ai-log-endpoint" value="${this._escapeHTML(config.customEndpoint || '')}"
                            placeholder="https://your-api.example.com/v1/chat/completions"
                            class="w-full aero-input p-2 rounded-lg font-mono text-sm"
                            style="background: rgba(255,255,255,0.12); color: white; border-color: rgba(255,255,255,0.25);">
                    </div>

                    <div>
                        <label class="block text-sm mb-1">Max tokens (output limit)</label>
                        <input type="number" id="cfg-ai-log-max-tokens" value="${this._escapeHTML(config.maxTokens ?? 16384)}"
                            min="1024" max="65536" step="1024"
                            class="w-full aero-input p-2 rounded-lg font-mono text-sm"
                            style="background: rgba(255,255,255,0.12); color: white; border-color: rgba(255,255,255,0.25);">
                        <p class="text-xs mt-1" style="color: rgba(255,255,255,0.82);">Higher values = longer analysis but more API cost.</p>
                    </div>

                    <div>
                        <label class="block text-sm mb-1">API Key</label>
                        <input type="password" id="cfg-ai-log-apikey" value="${this._secretDisplay(config.apiKey)}"
                            placeholder="sk-..."
                            class="w-full aero-input p-2 rounded-lg font-mono text-sm"
                            style="background: rgba(255,255,255,0.12); color: white; border-color: rgba(255,255,255,0.25);">
                        <p class="text-xs mt-1" style="color: rgba(255,255,255,0.82);">Saved pipeline data encrypts API keys with OS secure storage when available.</p>
                    </div>

                    <div>
                        <label class="block text-sm mb-1">Instructions given to AI</label>
                        <textarea id="cfg-ai-log-instructions" class="w-full h-36 aero-input p-3 rounded-lg text-sm"
                            style="background: rgba(15, 23, 42, 0.42); color: #fde68a; border-color: rgba(255,255,255,0.18);"
                            placeholder="Summarize the test results. Explain what passed, what failed, and suggest fixes.">${this._escapeHTML(config.instructions || this._getDefaultAILogSummaryInstructions())}</textarea>
                    </div>

                    <div>
                        <label class="block text-sm mb-1">Where to save log files and artifacts</label>
                        <input type="text" id="cfg-ai-log-save-path" value="${this._escapeHTML(config.savePath || '')}"
                            placeholder="logs/summary.md"
                            class="w-full aero-input p-2 rounded-lg font-mono text-sm"
                            style="background: rgba(255,255,255,0.12); color: white; border-color: rgba(255,255,255,0.25);">
                    </div>
                </div>

                <div class="flex gap-2 justify-end mt-auto pt-4 border-t" style="border-color: rgba(255,255,255,0.18);">
                    <button id="cfg-ai-log-cancel" class="aero-button-gray py-2 px-4 rounded-lg">Cancel</button>
                    <button id="cfg-ai-log-save" class="py-2 px-4 rounded-lg font-semibold" style="background: linear-gradient(180deg, #fb923c, #c2410c); color: white; border: none; cursor: pointer;"><span class="mg-action-label">Save</span></button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const providerSelect = modal.querySelector('#cfg-ai-log-provider');
        const endpointGroup = modal.querySelector('#cfg-ai-log-endpoint-group');
        if (providerSelect && endpointGroup) {
            providerSelect.onchange = () => {
                endpointGroup.style.display = providerSelect.value === 'custom' ? 'block' : 'none';
            };
        }

        modal.querySelector('#cfg-ai-log-cancel').onclick = () => modal.remove();
        modal.querySelector('#cfg-ai-log-save').onclick = () => {
            node.data = {
                ...node.data,
                name: modal.querySelector('#cfg-ai-log-name').value.trim() || 'AI Log Summary',
                summaryScope: modal.querySelector('#cfg-ai-log-scope').value || 'full-runner-log',
                provider: modal.querySelector('#cfg-ai-log-provider').value,
                model: modal.querySelector('#cfg-ai-log-model').value.trim(),
                apiKey: modal.querySelector('#cfg-ai-log-apikey').value.trim() || config.apiKey || '',
                customEndpoint: modal.querySelector('#cfg-ai-log-endpoint').value.trim(),
                maxTokens: parseInt(modal.querySelector('#cfg-ai-log-max-tokens').value, 10) || 16384,
                instructions: modal.querySelector('#cfg-ai-log-instructions').value.trim() || this._getDefaultAILogSummaryInstructions(),
                savePath: modal.querySelector('#cfg-ai-log-save-path').value.trim()
            };

            this.render();
            this._commitHistoryState();
            modal.remove();
            if (window.showToast) window.showToast('AI Log Summary config saved', 'success');
        };

        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
    }

    _getConnectedGitRepoContext(targetNodeId) {
        const incomingEdges = this.edges.filter(e => e.target === targetNodeId);
        let connectedGitNode = null;

        for (const edge of incomingEdges) {
            const sourceNode = this.nodes.find(n => n.id === edge.source);
            if (!sourceNode || sourceNode.type !== 'git-repo') continue;

            const repoPath = sourceNode.data?.clonedPath
                || sourceNode.data?.lastClonedPath
                || sourceNode.data?.lastResult?.artifacts?.repoPath
                || sourceNode.data?.lastResult?.repoPath
                || '';

            if (repoPath) {
                return { node: sourceNode, repoPath };
            }

            if (!connectedGitNode) {
                connectedGitNode = sourceNode;
            }
        }

        return connectedGitNode ? { node: connectedGitNode, repoPath: '' } : null;
    }

    _detectAIUnitTestMode(config = {}, sourceFiles = []) {
        const configuredMode = String(config.testMode || 'auto').trim().toLowerCase();
        if (configuredMode === 'module-unit' || configuredMode === 'static-site') {
            return configuredMode;
        }

        const normalizedPaths = sourceFiles
            .map(file => typeof file === 'string' ? file : (file?.relativePath || file?.path || ''))
            .filter(Boolean)
            .map(filePath => String(filePath).replace(/\\/g, '/').toLowerCase());

        const hasHtml = normalizedPaths.some(filePath => filePath.endsWith('.html'));
        const hasFrontendAssets = normalizedPaths.some(filePath => /\.(html|css|scss|sass|less|svg|png|jpe?g|gif|webp)$/i.test(filePath));
        const hasBackendLikeFiles = normalizedPaths.some(filePath => /\.(py|java|cs|go|rb|php|c|cpp|h|rs|swift|kt|scala)$/i.test(filePath));
        const instructions = String(config.instructions || '').toLowerCase();
        const websiteIntent = /\b(website|webpage|web page|landing page|homepage|html|css|frontend|front-end|ui)\b/.test(instructions);

        if (hasHtml) return 'static-site';
        if (hasFrontendAssets && !hasBackendLikeFiles) return 'static-site';
        if (websiteIntent && normalizedPaths.length === 0) return 'static-site';
        return 'module-unit';
    }

    _buildAIUnitTestSystemPrompt(filename, options = {}) {
        const resolvedMode = options.testMode || 'module-unit';
        if (resolvedMode === 'static-site') {
            return `You are an expert web QA engineer. Generate a COMPLETE, RUNNABLE Node.js smoke-test file for a static website source tree.

CRITICAL RULES:
1. Use ONLY built-in Node.js modules such as "assert", "fs", and "path". Do NOT use Jest, Mocha, Vitest, Playwright, Puppeteer, jsdom, or any external dependency.
2. The test file must run with "node ${filename}" directly from the repo root.
3. Read the actual site files from disk. Prefer validating files like index.html, HTML partials, CSS files, JSON config, and any static JS bundles by inspecting their text content.
4. DO NOT assume browser globals like document/window exist. These are file-based smoke tests, not browser E2E tests.
5. If the source includes importable Node/CommonJS modules, you may require them. Otherwise, test the site via fs/path and string or regex assertions.
6. Verify concrete site qualities from the provided source and instructions:
   - required titles, headings, sections, nav items, buttons, and copy
   - expected asset/script/style references
   - expected branding/colors/tokens/classes when visible in source
   - basic structural integrity so the generated site is not obviously broken
7. Each test must have a clear descriptive name. Print PASS/FAIL per test and a final summary. Exit with code 1 when any test fails.
8. The file must be a COMPLETE runnable script. Do not output markdown fences or explanations. Output ONLY valid code.`;
        }

        return `You are an expert test engineer. Generate comprehensive unit test code based on the user's instructions and the provided source code.

CRITICAL RULES:
1. Generate STANDALONE Node.js tests using ONLY the built-in "assert" module (require('assert') or require('node:assert')).
   DO NOT use Jest, Mocha, Vitest, or any external testing framework. The test file must be runnable with "node ${filename}" directly.
2. Structure your test file like this:
   - require('assert') at the top
   - require/import the source module(s) using CORRECT RELATIVE PATHS (the test file will be in the repo root)
   - Define test functions, each wrapped in try/catch that prints PASS or FAIL
   - At the bottom, run all tests and print a summary (X passed, Y failed)
3. Generate tests covering HAPPY PATH, GOLDEN PATH, EDGE CASES, and NEGATIVE PATH scenarios.
4. Each test must have a clear, descriptive name.
5. The code must be a COMPLETE, RUNNABLE file. Do not use markdown fences. Output ONLY valid code.
6. The test file name will be: ${filename}
7. Add a short comment header summarizing the test coverage.
8. If source code files are provided, target the actual functions, classes, exports, and logic in those files. Do not invent modules.
9. If no source code is provided, generate tests from the user's instructions only and say so in a comment.
10. Output ONLY the test code. No explanations, no markdown, no fences.`;
    }

    showAIUnitTestConfig(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const modal = document.createElement('div');
        modal.className = 'mg-dialog fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[10000]';

        const config = node.data;
        const connectedGitRepo = this._getConnectedGitRepoContext(nodeId);
        const connectedRepoPath = connectedGitRepo?.repoPath || '';
        const initialSourceStatus = Array.isArray(config.selectedSourceFiles) && config.selectedSourceFiles.length > 0
            ? `Saved runtime selection: ${config.selectedSourceFiles.length} file(s). Click "Load files from repo" to refresh it.`
            : connectedRepoPath
                ? `Connected repo clone ready at ${connectedRepoPath}. Click "Load files from repo" to choose source files.`
                : connectedGitRepo
                    ? 'A Git Repo node is connected, but it has not produced a local clone path yet. Run the graph or the Git Repo node first, then reload here.'
                    : 'Click "Load files from repo" to scan the connected Git Repo node for source files.';

        // Determine which provider options to show as selected
        const providerOptions = ['openai', 'anthropic', 'google', 'custom'].map(p => {
            const labels = { openai: 'OpenAI', anthropic: 'Anthropic (Claude)', google: 'Google (Gemini)', custom: 'Custom (OpenAI-compatible)' };
            return `<option value="${p}" ${config.provider === p ? 'selected' : ''} style="color: black; background: white;">${labels[p]}</option>`;
        }).join('');

        modal.innerHTML = `
            <div class="aero-modal p-6 rounded-xl max-w-2xl w-full flex flex-col max-h-[90vh]" style="background: linear-gradient(180deg, #083344 0%, #042f2e 100%); border: 1px solid rgba(6, 182, 212, 0.5);">
                <h3 class="text-xl font-bold text-slate-900 mb-4"> AI powered unit tester</h3>

                <div class="space-y-4 mb-6 flex-1 overflow-y-auto" style="padding-right: 8px;">
                    <!-- Test Filename -->
                    <div>
                        <label class="block text-sm text-slate-800 mb-1">Test file name (to inject)</label>
                        <input type="text" id="cfg-ai-filename" value="${this._escapeHTML(config.testFilename || 'ai-generated-test.js')}"
                            placeholder="e.g. ai-generated-test.js"
                            class="w-full aero-input p-2 rounded-lg font-mono text-sm" style="background: rgba(255,255,255,0.1); color: white; border-color: rgba(255,255,255,0.2);">
                    </div>

                    <div class="grid grid-cols-3 gap-4">
                        <div>
                            <label class="block text-sm text-slate-800 mb-1">Execution workflow</label>
                            <select id="cfg-ai-automation-mode" class="w-full aero-input p-2 rounded-lg text-sm" style="background: rgba(255,255,255,0.1); color: white; border-color: rgba(255,255,255,0.2);">
                                <option value="manual" ${config.automationMode !== 'assisted' && config.automationMode !== 'automated' ? 'selected' : ''} style="color: black; background: white;">Manual only</option>
                                <option value="assisted" ${config.automationMode === 'assisted' ? 'selected' : ''} style="color: black; background: white;">Assisted automation</option>
                                <option value="automated" ${config.automationMode === 'automated' ? 'selected' : ''} style="color: black; background: white;">Fully automated</option>
                            </select>
                            <p class="text-xs text-slate-600 mt-1">Manual keeps the old behavior. Assisted reuses saved tests and auto-generates only if needed. Automated regenerates tests on every run.</p>
                        </div>
                        <div>
                            <label class="block text-sm text-slate-800 mb-1">Repo source strategy</label>
                            <select id="cfg-ai-source-strategy" class="w-full aero-input p-2 rounded-lg text-sm" style="background: rgba(255,255,255,0.1); color: white; border-color: rgba(255,255,255,0.2);">
                                <option value="saved-selection" ${config.sourceStrategy !== 'auto-scan' && config.sourceStrategy !== 'prompt-only' ? 'selected' : ''} style="color: black; background: white;">Use saved file selection</option>
                                <option value="auto-scan" ${config.sourceStrategy === 'auto-scan' ? 'selected' : ''} style="color: black; background: white;">Auto-scan repo at runtime</option>
                                <option value="prompt-only" ${config.sourceStrategy === 'prompt-only' ? 'selected' : ''} style="color: black; background: white;">Prompt only</option>
                            </select>
                            <p class="text-xs text-slate-600 mt-1">Choose whether runtime generation uses the files you selected here, scans the cloned repo automatically, or ignores repo files entirely.</p>
                        </div>
                        <div>
                            <label class="block text-sm text-slate-800 mb-1">Test generation style</label>
                            <select id="cfg-ai-test-mode" class="w-full aero-input p-2 rounded-lg text-sm" style="background: rgba(255,255,255,0.1); color: white; border-color: rgba(255,255,255,0.2);">
                                <option value="auto" ${config.testMode !== 'module-unit' && config.testMode !== 'static-site' ? 'selected' : ''} style="color: black; background: white;">Auto-detect</option>
                                <option value="module-unit" ${config.testMode === 'module-unit' ? 'selected' : ''} style="color: black; background: white;">Code/module unit tests</option>
                                <option value="static-site" ${config.testMode === 'static-site' ? 'selected' : ''} style="color: black; background: white;">Static website smoke tests</option>
                            </select>
                            <p class="text-xs text-slate-600 mt-1">Auto-detect treats HTML-heavy repos as websites. Static site mode reads files from disk instead of assuming importable modules.</p>
                        </div>
                    </div>

                    <!-- AI Provider -->
                    <div>
                        <label class="block text-sm text-slate-800 mb-1">AI model</label>
                        <select id="cfg-ai-provider" class="w-full aero-input p-2 rounded-lg text-sm" style="background: rgba(255,255,255,0.1); color: white; border-color: rgba(255,255,255,0.2);">
                            ${providerOptions}
                        </select>
                    </div>

                    <!-- Model Name -->
                    <div id="cfg-ai-model-group">
                        <label class="block text-sm text-slate-800 mb-1">Model name <span class="text-slate-600">(optional -- defaults will be used if empty)</span></label>
                        <input type="text" id="cfg-ai-model" value="${this._escapeHTML(config.model || '')}"
                            placeholder="e.g. gpt-4o, claude-sonnet-4-20250514, gemini-2.5-flash"
                            class="w-full aero-input p-2 rounded-lg font-mono text-sm" style="background: rgba(255,255,255,0.1); color: white; border-color: rgba(255,255,255,0.2);">
                    </div>

                    <!-- Custom Endpoint (only visible when provider=custom) -->
                    <div id="cfg-ai-endpoint-group" style="display: ${config.provider === 'custom' ? 'block' : 'none'};">
                        <label class="block text-sm text-slate-800 mb-1">Custom API endpoint</label>
                        <input type="text" id="cfg-ai-endpoint" value="${this._escapeHTML(config.customEndpoint || '')}"
                            placeholder="https://your-api.example.com/v1/chat/completions"
                            class="w-full aero-input p-2 rounded-lg font-mono text-sm" style="background: rgba(255,255,255,0.1); color: white; border-color: rgba(255,255,255,0.2);">
                    </div>

                    <!-- Max Tokens -->
                    <div>
                        <label class="block text-sm text-slate-800 mb-1">Max tokens (output limit)</label>
                        <input type="number" id="cfg-ai-max-tokens" value="${this._escapeHTML(config.maxTokens ?? 16384)}"
                            min="1024" max="65536" step="1024"
                            placeholder="16384"
                            class="w-full aero-input p-2 rounded-lg font-mono text-sm" style="background: rgba(255,255,255,0.1); color: white; border-color: rgba(255,255,255,0.2);">
                        <p class="text-xs text-slate-600 mt-1">Higher values = longer tests but more API cost. If tests get cut off mid-code, increase this.</p>
                    </div>

                    <!-- API Key -->
                    <div>
                        <label class="block text-sm text-slate-800 mb-1">API Key</label>
                        <input type="password" id="cfg-ai-apikey" value="${this._secretDisplay(config.apiKey)}"
                            placeholder="sk-..."
                            class="w-full aero-input p-2 rounded-lg font-mono text-sm" style="background: rgba(255,255,255,0.1); color: white; border-color: rgba(255,255,255,0.2);">
                    </div>

                    <!-- Source Code from Git Repo -->
                    <div>
                        <label class="block text-sm text-slate-800 mb-1">Source code from connected Git Repo</label>
                        <div id="cfg-ai-source-area" class="rounded-lg p-3" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); min-height: 60px;">
                            <div id="cfg-ai-source-status" class="text-xs text-slate-600 mb-2">
                                ${initialSourceStatus}
                            </div>
                            <button id="cfg-ai-load-files" class="py-1 px-3 rounded text-xs font-semibold"
                                style="background: rgba(6, 182, 212, 0.3); color: #a5f3fc; border: 1px solid rgba(6, 182, 212, 0.4); cursor: pointer;">
                                Load files from repo
                            </button>
                            <div id="cfg-ai-file-list" class="mt-2" style="max-height: 150px; overflow-y: auto;"></div>
                            <p class="text-xs text-gray-500 mt-1">Selected files will be included in the AI prompt so it can generate tests based on your actual source code.</p>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm text-slate-800 mb-1">Source file extensions</label>
                            <input type="text" id="cfg-ai-source-exts" value="${this._escapeHTML(config.sourceExtensions || 'html,css,js,jsx,ts,tsx,mjs,cjs,vue,svelte,py,java,cs,go,rb,php,c,cpp,h,rs,swift,kt,scala,json')}"
                                placeholder="html,css,js,ts,py"
                                class="w-full aero-input p-2 rounded-lg font-mono text-sm" style="background: rgba(255,255,255,0.1); color: white; border-color: rgba(255,255,255,0.2);">
                        </div>
                        <div>
                            <label class="block text-sm text-slate-800 mb-1">On auto-generation failure</label>
                            <select id="cfg-ai-fallback" class="w-full aero-input p-2 rounded-lg text-sm" style="background: rgba(255,255,255,0.1); color: white; border-color: rgba(255,255,255,0.2);">
                                <option value="fail" ${config.generationFallback !== 'use-saved' ? 'selected' : ''} style="color: black; background: white;">Fail the node</option>
                                <option value="use-saved" ${config.generationFallback === 'use-saved' ? 'selected' : ''} style="color: black; background: white;">Use saved tests instead</option>
                            </select>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm text-slate-800 mb-1">Max source files</label>
                            <input type="number" id="cfg-ai-max-files" value="${this._escapeHTML(config.maxSourceFiles || 12)}"
                                min="1" max="100" step="1"
                                class="w-full aero-input p-2 rounded-lg font-mono text-sm" style="background: rgba(255,255,255,0.1); color: white; border-color: rgba(255,255,255,0.2);">
                        </div>
                        <div>
                            <label class="block text-sm text-slate-800 mb-1">Max source characters</label>
                            <input type="number" id="cfg-ai-max-chars" value="${this._escapeHTML(config.maxSourceChars || 60000)}"
                                min="2000" max="500000" step="1000"
                                class="w-full aero-input p-2 rounded-lg font-mono text-sm" style="background: rgba(255,255,255,0.1); color: white; border-color: rgba(255,255,255,0.2);">
                        </div>
                    </div>

                    <!-- Instructions -->
                    <div>
                        <label class="block text-sm text-slate-800 mb-1">Instructions given to AI</label>
                        <textarea id="cfg-ai-instructions" class="w-full h-32 aero-input p-3 rounded-lg text-sm"
                            style="background: rgba(255,255,255,0.08); color: #a5f3fc; border-color: rgba(6, 182, 212, 0.3);"
                            placeholder="Describe what you want to test. For example:\n\n- Test the login function in auth.js\n- Cover edge cases like empty passwords, SQL injection attempts\n- Use Jest as the testing framework\n- Mock the database connection">${this._escapeHTML(config.instructions || '')}</textarea>
                    </div>

                    <!-- Generate Button -->
                    <div class="flex items-center gap-3">
                        <button id="cfg-ai-generate" class="py-2 px-4 rounded-lg font-semibold text-sm"
                            style="background: linear-gradient(180deg, #06b6d4, #0891b2); color: white; border: none; cursor: pointer;">
                            Generate Tests with AI
                        </button>
                        <span id="cfg-ai-status" class="text-xs text-slate-600"></span>
                    </div>

                    <!-- Generated Code Display -->
                    <div>
                        <label class="block text-sm text-slate-800 mb-1">Unit-Test Code generated</label>
                        <textarea id="cfg-ai-code" class="w-full h-64 aero-input p-3 rounded-lg font-mono text-sm"
                            style="background: #0f172a; color: #67e8f9; border-color: rgba(6, 182, 212, 0.3);"
                            placeholder="AI-generated test code will appear here after clicking 'Generate Tests with AI'.\nYou can also manually edit the code.">${this._escapeHTML(config.generatedCode || '')}</textarea>
                    </div>

                    <!-- Execution Command -->
                    <div>
                        <label class="block text-sm text-slate-800 mb-1">Execution command</label>
                        <input type="text" id="cfg-ai-command" value="${this._escapeHTML(config.command || 'node ai-generated-test.js')}"
                            placeholder="e.g. node ai-generated-test.js, npx jest ai-generated-test.js"
                            class="w-full aero-input p-2 rounded-lg font-mono text-sm" style="background: rgba(255,255,255,0.1); color: white; border-color: rgba(255,255,255,0.2);">
                        <p class="text-xs text-slate-600 mt-1">This command runs in the repo root after injecting the test file.</p>
                    </div>
                </div>

                <div class="flex gap-2 justify-end mt-auto pt-4 border-t border-gray-700">
                    <button id="cfg-ai-cancel" class="aero-button-gray py-2 px-4 rounded-lg">Cancel</button>
                    <button id="cfg-ai-save" class="py-2 px-4 rounded-lg font-semibold" style="background: linear-gradient(180deg, #06b6d4, #0891b2); color: white; border: none; cursor: pointer;">Save</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Show/hide custom endpoint field based on provider selection
        const providerSelect = modal.querySelector('#cfg-ai-provider');
        const endpointGroup = modal.querySelector('#cfg-ai-endpoint-group');
        providerSelect.addEventListener('change', () => {
            endpointGroup.style.display = providerSelect.value === 'custom' ? 'block' : 'none';
        });

        // -- Source file loading logic --
        // This tracks which files the user has loaded/selected from the connected Git Repo
        let loadedSourceFiles = []; // Array of { path: string, content: string, selected: boolean }
        const savedSelectedFiles = new Set(Array.isArray(config.selectedSourceFiles) ? config.selectedSourceFiles : []);
        const normalizeRelativeRepoPath = (filePath, repoPath) => filePath
            .replace(repoPath || '', '')
            .replace(/^[\\/]/, '')
            .replace(/\\/g, '/');

        // Helper: find connected Git Repo node
        const findConnectedGitRepo = () => this._getConnectedGitRepoContext(nodeId);

        // Load files button handler
        modal.querySelector('#cfg-ai-load-files').onclick = async () => {
            const statusEl = modal.querySelector('#cfg-ai-source-status');
            const fileListEl = modal.querySelector('#cfg-ai-file-list');
            const loadBtn = modal.querySelector('#cfg-ai-load-files');

            const gitRepoInfo = findConnectedGitRepo();
            if (!gitRepoInfo) {
                statusEl.textContent = 'ERROR: No directly connected Git Repo node was found. Connect a Git Repo node upstream first.';
                statusEl.style.color = '#f87171';
                return;
            }
            if (!gitRepoInfo.repoPath) {
                statusEl.textContent = 'ERROR: A Git Repo node is connected, but no local clone path is available yet. Run the graph or the Git Repo node first.';
                statusEl.style.color = '#f87171';
                return;
            }

            const repoPath = gitRepoInfo.repoPath;
            loadBtn.disabled = true;
            loadBtn.textContent = 'Scanning...';
            statusEl.textContent = `Scanning ${repoPath}...`;
            statusEl.style.color = '#a5f3fc';

            try {
                // Use electronAPI to list all source files in the cloned repo
                // List common source file extensions
                const sourceResponse = await window.LVXMachinaGraph.invoke('sourceFiles',{path:repoPath,extensions:modal.querySelector('#cfg-ai-source-exts').value,maxFiles:500});
                const allFiles = (sourceResponse.files||sourceResponse).map(file=>typeof file==='string'?file:file.path);
                const sourceExtensions = String(modal.querySelector('#cfg-ai-source-exts').value || '')
                    .split(',')
                    .map(ext => ext.trim().replace(/^\./, '').toLowerCase())
                    .filter(Boolean);

                // Filter to likely source code files (not binaries, not node_modules, not .git)
                const sourceFiles = allFiles.filter(f => {
                    const ext = f.split('.').pop().toLowerCase();
                    return sourceExtensions.includes(ext);
                });

                if (sourceFiles.length === 0) {
                    statusEl.textContent = 'WARNING: No source code files found in the repo.';
                    statusEl.style.color = '#fbbf24';
                    loadBtn.disabled = false;
                    loadBtn.textContent = 'Load files from repo';
                    return;
                }

                statusEl.textContent = `Found ${sourceFiles.length} source file(s). Select the ones you want the AI to analyze:`;
                statusEl.style.color = '#4ade80';

                // Render checkbox list of files
                // Show paths relative to repo root for readability
                fileListEl.innerHTML = sourceFiles.map((filePath, index) => {
                    const relativePath = normalizeRelativeRepoPath(filePath, repoPath);
                    const isChecked = savedSelectedFiles.size === 0 || savedSelectedFiles.has(relativePath);
                    return `
                        <label class="flex items-center gap-2 py-1 px-2 rounded hover:bg-white/5 cursor-pointer text-xs text-slate-800" style="display:flex;">
                            <input type="checkbox" class="cfg-ai-file-cb" data-index="${index}" data-path="${this._escapeHTML(filePath)}" ${isChecked ? 'checked' : ''}>
                            <span class="font-mono">${this._escapeHTML(relativePath)}</span>
                        </label>
                    `;
                }).join('');

                // Store file paths for later reading
                loadedSourceFiles = sourceFiles.map(f => {
                    const relativePath = normalizeRelativeRepoPath(f, repoPath);
                    return {
                        path: f,
                        relativePath,
                        selected: savedSelectedFiles.size === 0 || savedSelectedFiles.has(relativePath),
                        content: (sourceResponse.files||sourceResponse).find(file=>typeof file==='object'&&file.path===f)?.content??null
                    };
                });

            } catch (err) {
                console.error('File scanning error:', err);
                statusEl.textContent = `ERROR: Error scanning repo: ${err.message}`;
                statusEl.style.color = '#f87171';
            } finally {
                loadBtn.disabled = false;
                loadBtn.textContent = 'Reload files from repo';
            }
        };

        // Generate button handler
        modal.querySelector('#cfg-ai-generate').onclick = async () => {
            const provider = modal.querySelector('#cfg-ai-provider').value;
            const model = modal.querySelector('#cfg-ai-model').value.trim();
            const apiKey = modal.querySelector('#cfg-ai-apikey').value.trim();
            const instructions = modal.querySelector('#cfg-ai-instructions').value.trim();
            const filename = modal.querySelector('#cfg-ai-filename').value.trim();
            const customEndpoint = modal.querySelector('#cfg-ai-endpoint').value.trim();
            const sourceStrategy = modal.querySelector('#cfg-ai-source-strategy').value;
            const statusEl = modal.querySelector('#cfg-ai-status');
            const codeEl = modal.querySelector('#cfg-ai-code');
            const generateBtn = modal.querySelector('#cfg-ai-generate');

            if (!apiKey && !config.apiKey?.secretRef && !window.LVXMachinaGraph) {
                statusEl.textContent = 'ERROR: API Key is required';
                statusEl.style.color = '#f87171';
                return;
            }
            if (!instructions) {
                statusEl.textContent = 'ERROR: Instructions are required';
                statusEl.style.color = '#f87171';
                return;
            }

            // -- Read selected source files from the repo --
            // Update selection state from checkboxes
            const checkboxes = modal.querySelectorAll('.cfg-ai-file-cb');
            checkboxes.forEach(cb => {
                const idx = parseInt(cb.dataset.index);
                if (loadedSourceFiles[idx]) {
                    loadedSourceFiles[idx].selected = cb.checked;
                }
            });

            const selectedFiles = loadedSourceFiles.filter(f => f.selected);
            let sourceCodeContext = modal.querySelector('[data-extra="sourceCode"]')?.value || '';

            // Warn user if no source files are loaded — AI will hallucinate
            if (selectedFiles.length === 0 && sourceStrategy !== 'prompt-only') {
                const proceed = confirm(
                    'WARNING: No source files loaded!\n\n' +
                    'Without source code, the AI will generate generic/hypothetical tests that probably won\'t work.\n\n' +
                    'Click "Cancel" to go back and click "Load files from repo" first.\n' +
                    'Click "OK" to generate anyway (not recommended).'
                );
                if (!proceed) {
                    return;
                }
            }

            if (selectedFiles.length > 0 && sourceStrategy !== 'prompt-only') {
                statusEl.textContent = `Reading ${selectedFiles.length} source file(s)...`;
                statusEl.style.color = '#a5f3fc';

                try {
                    // Read each selected file's content via Electron API
                    for (const file of selectedFiles) {
                        if (!file.content) {
                            const response=await window.LVXMachinaGraph.invoke('sourceFiles',{path:findConnectedGitRepo().repoPath,files:[file.path],maxFiles:500,maxSourceChars:2000000,includeContent:true});
                            const sourceFile=(response.files||response).find(source=>source.path===file.path);
                            if(!sourceFile||typeof sourceFile.content!=='string')throw new Error('The selected source could not be read.');
                            file.content=sourceFile.content;
                        }
                    }

                    // Build the source code context block for the AI prompt
                    const gitRepoInfo = findConnectedGitRepo();
                    const repoPath = gitRepoInfo ? gitRepoInfo.repoPath : '';

                    sourceCodeContext = '\n\n--- SOURCE CODE FROM REPOSITORY ---\n' +
                        selectedFiles.map(f => {
                            const relativePath = f.relativePath || normalizeRelativeRepoPath(f.path, repoPath);
                            return `\n=== FILE: ${relativePath} ===\n${f.content}\n`;
                        }).join('') +
                        '\n--- END OF SOURCE CODE ---\n';
                } catch (err) {
                    console.error('Error reading source files:', err);
                    statusEl.textContent = `ERROR: Could not read source files: ${err.message}`;
                    statusEl.style.color = '#fbbf24';
                    return;
                }
            }

            const resolvedTestMode = this._detectAIUnitTestMode({
                ...config,
                instructions,
                testMode: modal.querySelector('#cfg-ai-test-mode').value
            }, selectedFiles);

            // Build the system prompt for test generation
            const systemPrompt = this._buildAIUnitTestSystemPrompt(filename, { testMode: resolvedTestMode });

            // Build the user prompt -- include source code context if available
            const userPrompt = instructions + sourceCodeContext;

            // Disable button, show loading
            generateBtn.disabled = true;
            generateBtn.textContent = 'Generating...';
            statusEl.textContent = 'Calling AI API...';
            statusEl.style.color = '#a5f3fc';

            try {
                // Check if electronAPI is available (running in Electron)
                if (window.LVXMachinaGraph) {
                    const maxTokens = parseInt(modal.querySelector('#cfg-ai-max-tokens').value) || 16384;
                    const result = await window.LVXMachinaGraph.generatePreview({...node,data:{...config,provider,model,apiKey:apiKey||config.apiKey,instructions:userPrompt,systemPrompt,customEndpoint,maxTokens,testMode:resolvedTestMode,maxSourceFiles:Number(modal.querySelector('#cfg-ai-max-files').value),maxSourceChars:Number(modal.querySelector('#cfg-ai-max-chars').value),sourceExtensions:modal.querySelector('#cfg-ai-source-exts').value,testFilename:filename,sourceCode:sourceCodeContext,sourceStrategy:sourceCodeContext?'inline':'prompt-only'}});
                    if (result.success && result.generatedText) {
                        // Strip markdown code fences if the AI included them despite instructions
                        let code = result.generatedText;
                        code = code.replace(/^```[\w]*\n?/gm, '').replace(/\n?```$/gm, '').trim();
                        codeEl.value = code;
                        statusEl.textContent = `Generated successfully at ${new Date().toLocaleTimeString()}`;
                        statusEl.style.color = '#4ade80';
                    } else {
                        statusEl.textContent = 'ERROR: No code was generated';
                        statusEl.style.color = '#f87171';
                    }
                } else {
                    // Fallback for browser-only testing (non-Electron)
                    // Use fetch directly (will hit CORS issues but useful for development)
                    statusEl.textContent = 'ERROR: AI operations require the Electron desktop app';
                    statusEl.style.color = '#f87171';
                }
            } catch (err) {
                console.error('AI Generation Error:', err);
                statusEl.textContent = `ERROR: ${err.message || err}`;
                statusEl.style.color = '#f87171';
            } finally {
                generateBtn.disabled = false;
                generateBtn.textContent = 'Generate Tests with AI';
            }
        };

        // Close modal on backdrop click
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };

        // Cancel button
        modal.querySelector('#cfg-ai-cancel').onclick = () => modal.remove();

        // Save button
        modal.querySelector('#cfg-ai-save').onclick = () => {
            const filename = modal.querySelector('#cfg-ai-filename').value.trim();
            const checkboxes = modal.querySelectorAll('.cfg-ai-file-cb');
            checkboxes.forEach(cb => {
                const idx = parseInt(cb.dataset.index, 10);
                if (loadedSourceFiles[idx]) {
                    loadedSourceFiles[idx].selected = cb.checked;
                }
            });

            node.data.testFilename = filename;
            node.data.automationMode = modal.querySelector('#cfg-ai-automation-mode').value;
            node.data.testMode = modal.querySelector('#cfg-ai-test-mode').value;
            node.data.sourceStrategy = modal.querySelector('#cfg-ai-source-strategy').value;
            node.data.sourceExtensions = modal.querySelector('#cfg-ai-source-exts').value.trim();
            node.data.maxSourceFiles = parseInt(modal.querySelector('#cfg-ai-max-files').value, 10) || 12;
            node.data.maxSourceChars = parseInt(modal.querySelector('#cfg-ai-max-chars').value, 10) || 60000;
            node.data.generationFallback = modal.querySelector('#cfg-ai-fallback').value;
            node.data.selectedSourceFiles = loadedSourceFiles.length > 0
                ? loadedSourceFiles.filter(file => file.selected).map(file => file.relativePath || file.path)
                : (Array.isArray(config.selectedSourceFiles) ? [...config.selectedSourceFiles] : []);
            node.data.provider = modal.querySelector('#cfg-ai-provider').value;
            node.data.model = modal.querySelector('#cfg-ai-model').value.trim();
            node.data.apiKey = modal.querySelector('#cfg-ai-apikey').value.trim() || node.data.apiKey || '';
            node.data.customEndpoint = modal.querySelector('#cfg-ai-endpoint').value.trim();
            node.data.instructions = modal.querySelector('#cfg-ai-instructions').value;
            node.data.generatedCode = modal.querySelector('#cfg-ai-code').value;
            node.data.command = modal.querySelector('#cfg-ai-command').value.trim();
            node.data.maxTokens = parseInt(modal.querySelector('#cfg-ai-max-tokens').value) || 16384;

            node.data.name = ` AI: ${filename}`;

            this.render();
            this._commitHistoryState();
            modal.remove();
            if (window.showToast) window.showToast('AI Unit Test config saved', 'success');
        };
    }

    async _runAIUnitTestNode(node) { return this.runNode(node.id); }

    _getReadableNodeModalStyles(scopeClass = 've-readable-node-modal') {
        return `
            <style>
                .${scopeClass} input,
                .${scopeClass} select,
                .${scopeClass} textarea {
                    color: #0f172a !important;
                    background: rgba(255, 255, 255, 0.97) !important;
                    border: 1px solid rgba(255, 255, 255, 0.58) !important;
                    box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.08);
                }

                .${scopeClass} input::placeholder,
                .${scopeClass} textarea::placeholder {
                    color: #526277 !important;
                    opacity: 1 !important;
                }

                .${scopeClass} select option {
                    color: #0f172a;
                    background: #ffffff;
                }

                .${scopeClass} input:focus,
                .${scopeClass} select:focus,
                .${scopeClass} textarea:focus {
                    outline: none;
                    border-color: rgba(255, 255, 255, 0.85) !important;
                    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.18);
                }
            </style>
        `;
    }

    showLogCollectorConfig(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;
        const config = node.data || {};
        const modal = document.createElement('div');
        modal.className = 'mg-dialog fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[10000]';
        modal.innerHTML = `
            ${this._getReadableNodeModalStyles()}
            <div class="aero-modal ve-readable-node-modal p-6 rounded-xl max-w-xl w-full flex flex-col" style="background: linear-gradient(180deg, #334155 0%, #0f172a 100%); border: 1px solid rgba(148, 163, 184, 0.5); color: white;">
                <h3 class="text-xl font-bold mb-4"> Log Collector & Zip</h3>
                <div class="space-y-4 mb-6">
                    <div>
                        <label class="block text-sm mb-1">Archive name (.zip)</label>
                        <input type="text" id="cfg-zip-name" value="${this._escapeHTML(config.zipName || config.archiveName || 'pipeline-logs.zip')}" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                    </div>
                    <div>
                        <label class="block text-sm mb-1">Collection Mode</label>
                        <select id="cfg-collect-mode" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                            <option value="connected" ${config.collectionMode === 'connected' ? 'selected' : ''}>Only nodes connected to this collector</option>
                            <option value="upstream" ${config.collectionMode === 'upstream' ? 'selected' : ''}>All upstream nodes (connected chain)</option>
                            <option value="full" ${config.collectionMode === 'full' ? 'selected' : ''}>Full pipeline execution log</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-sm mb-1">Save location (optional)</label>
                        <input type="text" id="cfg-zip-path" value="${this._escapeHTML(config.savePath || '')}" placeholder="logs/ or empty for .lvx/logs" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                    </div>
                </div>
                <div class="flex gap-2 justify-end">
                    <button id="cfg-zip-cancel" class="aero-button-gray py-2 px-4 rounded-lg">Cancel</button>
                    <button id="cfg-zip-save" class="py-2 px-4 rounded-lg font-semibold bg-blue-600 hover:bg-blue-500">Save</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector('#cfg-zip-cancel').onclick = () => modal.remove();
        modal.querySelector('#cfg-zip-save').onclick = () => {
            node.data.zipName = modal.querySelector('#cfg-zip-name').value.trim();
            if(Object.hasOwn(node.data,'archiveName'))node.data.archiveName=node.data.zipName;
            node.data.collectionMode = modal.querySelector('#cfg-collect-mode').value;
            node.data.savePath = modal.querySelector('#cfg-zip-path').value.trim();
            node.data.name = ` Zip: ${node.data.zipName}`;
            this.render();
            this._commitHistoryState();
            modal.remove();
        };
    }

    showAPIPerformanceConfig(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;
        const config = node.data || {};
        const modal = document.createElement('div');
        modal.className = 'mg-dialog fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[10000]';
        modal.innerHTML = `
            ${this._getReadableNodeModalStyles()}
            <div class="aero-modal ve-readable-node-modal p-6 rounded-xl max-w-2xl w-full flex flex-col" style="background: linear-gradient(180deg, #7c2d12 0%, #431407 100%); border: 1px solid rgba(251, 146, 60, 0.5); color: white;">
                <h3 class="text-xl font-bold mb-4"> API Performance Test</h3>
                <div class="grid grid-cols-2 gap-4 mb-6">
                    <div class="col-span-2">
                        <label class="block text-sm mb-1">Target URL</label>
                        <input type="text" id="cfg-perf-url" value="${this._escapeHTML(config.url || '')}" placeholder="https://api.example.com/v1/resource" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900 font-mono">
                    </div>
                    <div>
                        <label class="block text-sm mb-1">Method</label>
                        <select id="cfg-perf-method" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                            <option value="GET" ${config.method === 'GET' ? 'selected' : ''}>GET</option>
                            <option value="POST" ${config.method === 'POST' ? 'selected' : ''}>POST</option>
                            <option value="PUT" ${config.method === 'PUT' ? 'selected' : ''}>PUT</option>
                            <option value="PATCH" ${config.method === 'PATCH' ? 'selected' : ''}>PATCH</option>
                            <option value="DELETE" ${config.method === 'DELETE' ? 'selected' : ''}>DELETE</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-sm mb-1">Duration (seconds)</label>
                        <input type="number" id="cfg-perf-duration" min="0.01" max="300" step="0.01" value="${this._escapeHTML(config.duration || 30)}" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                    </div>
                    <div>
                        <label class="block text-sm mb-1">Concurrent Connections</label>
                        <input type="number" id="cfg-perf-connections" min="1" max="64" value="${this._escapeHTML(config.connections || 10)}" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                    </div>
                    <div>
                        <label class="block text-sm mb-1">Pass condition (Max latency ms)</label>
                        <input type="number" id="cfg-perf-latency" min="0" max="120000" value="${this._escapeHTML(config.maxLatency || 500)}" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                    </div>
                </div>
                <div class="flex gap-2 justify-end">
                    <button id="cfg-perf-cancel" class="aero-button-gray py-2 px-4 rounded-lg">Cancel</button>
                    <button id="cfg-perf-save" class="py-2 px-4 rounded-lg font-semibold bg-orange-600 hover:bg-orange-500">Save</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector('#cfg-perf-cancel').onclick = () => modal.remove();
        modal.querySelector('#cfg-perf-save').onclick = () => {
            node.data.url = modal.querySelector('#cfg-perf-url').value.trim();
            node.data.method = modal.querySelector('#cfg-perf-method').value;
            node.data.duration = Number(modal.querySelector('#cfg-perf-duration').value);
            node.data.connections = parseInt(modal.querySelector('#cfg-perf-connections').value, 10);
            node.data.maxLatency = parseInt(modal.querySelector('#cfg-perf-latency').value, 10);
            node.data.name = ` Perf: ${node.data.method} ${new URL(node.data.url || 'http://localhost').pathname}`;
            this.render();
            this._commitHistoryState();
            modal.remove();
        };
    }

    showAPIContractConfig(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;
        const config = node.data || {};
        const modal = document.createElement('div');
        modal.className = 'mg-dialog fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[10000]';
        modal.innerHTML = `
            ${this._getReadableNodeModalStyles()}
            <div class="aero-modal ve-readable-node-modal p-6 rounded-xl max-w-3xl w-full flex flex-col max-h-[90vh]" style="background: linear-gradient(180deg, #083344 0%, #042f2e 100%); border: 1px solid rgba(6, 182, 212, 0.5); color: white;">
                <h3 class="text-xl font-bold mb-4"> API Contract & Schema Test</h3>
                <div class="space-y-4 mb-6 flex-1 overflow-auto">
                    <div>
                        <label class="block text-sm mb-1">Target URL</label>
                        <input type="text" id="cfg-contract-url" value="${this._escapeHTML(config.url || '')}" placeholder="https://api.example.com/v1/auth" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900 font-mono">
                    </div>
                    <div class="grid grid-cols-3 gap-4">
                        <div>
                            <label class="block text-sm mb-1">Method</label>
                            <select id="cfg-contract-method" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                                <option value="GET" ${config.method === 'GET' ? 'selected' : ''}>GET</option>
                                <option value="POST" ${config.method === 'POST' ? 'selected' : ''}>POST</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm mb-1">Expected Status</label>
                            <input type="number" id="cfg-contract-status" min="100" max="599" value="${this._escapeHTML(config.expectedStatus || 200)}" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm mb-1">Expected JSON Schema</label>
                        <textarea id="cfg-contract-schema" class="w-full h-64 aero-input p-3 rounded-lg bg-slate-50 border-slate-300 text-cyan-300 font-mono text-xs">${this._escapeHTML(config.schema || '{}')}</textarea>
                        <p class="text-[10px] opacity-70 mt-1">Enter JSON Schema, for example {&quot;type&quot;:&quot;object&quot;,&quot;required&quot;:[&quot;healthy&quot;],&quot;properties&quot;:{&quot;healthy&quot;:{&quot;type&quot;:&quot;boolean&quot;}}}. Supported rules include type, required, properties, items and additionalProperties. An example response is not a schema.</p>
                    </div>
                </div>
                <div class="flex gap-2 justify-end">
                    <button id="cfg-contract-cancel" class="aero-button-gray py-2 px-4 rounded-lg">Cancel</button>
                    <button id="cfg-contract-save" class="py-2 px-4 rounded-lg font-semibold bg-cyan-600 hover:bg-cyan-500">Save</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector('#cfg-contract-cancel').onclick = () => modal.remove();
        modal.querySelector('#cfg-contract-save').onclick = () => {
            node.data.url = modal.querySelector('#cfg-contract-url').value.trim();
            node.data.method = modal.querySelector('#cfg-contract-method').value;
            node.data.expectedStatus = parseInt(modal.querySelector('#cfg-contract-status').value, 10);
            node.data.schema = modal.querySelector('#cfg-contract-schema').value;
            node.data.name = ` Contract: ${node.data.method} ${new URL(node.data.url || 'http://localhost').pathname}`;
            this.render();
            this._commitHistoryState();
            modal.remove();
        };
    }

    showCodeReviewConfig(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;
        const config = node.data || {};
        const providerOptions = this._getAIProviderOptions(config.provider || 'google');
        const modal = document.createElement('div');
        modal.className = 'mg-dialog fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[10000]';
        modal.innerHTML = `
            ${this._getReadableNodeModalStyles()}
            <div class="aero-modal ve-readable-node-modal p-6 rounded-xl max-w-3xl w-full flex flex-col max-h-[90vh]" style="background: linear-gradient(180deg, #701a75 0%, #4a044e 100%); border: 1px solid rgba(232, 121, 249, 0.5); color: white;">
                <h3 class="text-xl font-bold mb-4"> AI Code Review & Feedback</h3>
                <div class="space-y-4 mb-6 flex-1 overflow-auto">
                    <div class="grid grid-cols-3 gap-4">
                        <div>
                            <label class="block text-sm mb-1">Mode</label>
                            <select id="cfg-review-mode" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                                <option value="review" ${config.mode === 'review' ? 'selected' : ''}>Review existing code</option>
                                <option value="generate" ${config.mode === 'generate' ? 'selected' : ''}>Generate from scratch</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm mb-1">Workflow</label>
                            <select id="cfg-review-execution" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                                <option value="interactive" ${config.executionMode !== 'automated' ? 'selected' : ''}>Interactive editor</option>
                                <option value="automated" ${config.executionMode === 'automated' ? 'selected' : ''}>Automated in pipeline</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm mb-1">Language</label>
                            <select id="cfg-review-lang" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                                <option value="html" ${config.language === 'html' ? 'selected' : ''}>HTML</option>
                                <option value="css" ${config.language === 'css' ? 'selected' : ''}>CSS</option>
                                <option value="javascript" ${config.language === 'javascript' ? 'selected' : ''}>JavaScript</option>
                                <option value="python" ${config.language === 'python' ? 'selected' : ''}>Python</option>
                                <option value="java" ${config.language === 'java' ? 'selected' : ''}>Java</option>
                                <option value="go" ${config.language === 'go' ? 'selected' : ''}>Go</option>
                                <option value="rust" ${config.language === 'rust' ? 'selected' : ''}>Rust</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm mb-1">Automation Instructions</label>
                        <textarea id="cfg-review-instructions" class="w-full h-28 aero-input p-3 rounded-lg bg-slate-50 border-slate-300 text-slate-800 font-mono text-xs" placeholder="Describe the website, redesign, or code changes this node should generate automatically.">${this._escapeHTML(config.instructions || '')}</textarea>
                        <p class="text-xs text-fuchsia-100/80 mt-1">Used as the node prompt during automated graph runs and prefilled when opening the interactive editor.</p>
                    </div>
                    <div>
                        <label class="block text-sm mb-1">AI Provider</label>
                        <select id="cfg-review-provider" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                            ${providerOptions}
                        </select>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm mb-1">Model Name</label>
                            <input type="text" id="cfg-review-model" value="${this._escapeHTML(config.model || '')}" placeholder="e.g. gemini-2.0-flash" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                        </div>
                        <div>
                            <label class="block text-sm mb-1">API Key</label>
                            <input type="password" id="cfg-review-key" value="${this._secretDisplay(config.apiKey)}" placeholder="Leave empty to use saved key" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm mb-1">Source Code (skipped if generating)</label>
                        <textarea id="cfg-review-source" class="w-full h-48 aero-input p-3 rounded-lg bg-slate-50 border-slate-300 text-slate-700 font-mono text-xs" placeholder="Paste source code or attach a file node in pipeline.">${this._escapeHTML(config.sourceCode || '')}</textarea>
                    </div>
                    <div>
                        <label class="block text-sm mb-1">Save Generated Code To File (optional)</label>
                        <input type="text" id="cfg-review-output" value="${this._escapeHTML(config.outputPath || '')}" placeholder="e.g. generated/index.html" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900 font-mono text-sm">
                        <p class="text-xs text-fuchsia-100/80 mt-1">When set, the node writes the accepted/generated code to disk during graph execution.</p>
                    </div>
                </div>
                <div class="flex gap-2 justify-end">
                    <button id="cfg-review-cancel" class="aero-button-gray py-2 px-4 rounded-lg">Cancel</button>
                    <button id="cfg-review-save" class="py-2 px-4 rounded-lg font-semibold bg-purple-600 hover:bg-purple-500">Save</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector('#cfg-review-cancel').onclick = () => modal.remove();
        modal.querySelector('#cfg-review-save').onclick = () => {
            node.data.provider = modal.querySelector('#cfg-review-provider').value;
            node.data.mode = modal.querySelector('#cfg-review-mode').value;
            node.data.executionMode = modal.querySelector('#cfg-review-execution').value;
            node.data.language = modal.querySelector('#cfg-review-lang').value;
            node.data.model = modal.querySelector('#cfg-review-model').value.trim();
            node.data.apiKey = modal.querySelector('#cfg-review-key').value.trim() || node.data.apiKey || '';
            node.data.instructions = modal.querySelector('#cfg-review-instructions').value.trim();
            node.data.sourceCode = modal.querySelector('#cfg-review-source').value;
            node.data.outputPath = modal.querySelector('#cfg-review-output').value.trim();
            node.data.name = 'AI Code Review';
            node.data.name = ` Code Review`;
            this.render();
            this._commitHistoryState();
            modal.remove();
        };
    }

    showWebsiteUXAutoTesterConfig(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const config = node.data || {};
        const upstreamNodes = this._getDirectUpstreamNodes(nodeId);
        const upstreamLabel = upstreamNodes.length > 0
            ? upstreamNodes.map(upstreamNode => `${this._getNodeDisplayName(upstreamNode)} (${upstreamNode.type})`).join(', ')
            : 'No direct upstream node detected yet. Connect a Website Iteration, Git Repo, or live site source.';

        const modal = document.createElement('div');
        modal.className = 'mg-dialog fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[10000]';
        modal.innerHTML = `
            ${this._getReadableNodeModalStyles()}
            <div class="aero-modal ve-readable-node-modal p-6 rounded-xl max-w-4xl w-full flex flex-col max-h-[90vh]" style="background: linear-gradient(180deg, #0f3b66 0%, #082f49 100%); border: 1px solid rgba(96, 165, 250, 0.5); color: white;">
                <h3 class="text-xl font-bold mb-4">Website UX Auto Tester</h3>
                <div class="space-y-4 mb-6 flex-1 overflow-auto">
                    <div class="rounded-lg p-3 text-sm" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);">
                        <div class="font-semibold mb-1">Detected upstream source</div>
                        <div class="text-sky-100/85">${this._escapeHTML(upstreamLabel)}</div>
                        <div class="text-xs text-sky-100/70 mt-2">Auto mode prefers freshly generated website output from the connected Website Iteration node, then a cloned repo entry file, then a configured live URL. If you choose "Upstream generated website/code", the live URL field is ignored.</div>
                    </div>
                    <div class="grid grid-cols-3 gap-4">
                        <div>
                            <label class="block text-sm mb-1">Website source mode</label>
                            <select id="cfg-ux-source-mode" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                                <option value="auto" ${config.sourceMode !== 'upstream-output' && config.sourceMode !== 'repo-file' && config.sourceMode !== 'live-url' ? 'selected' : ''}>Auto detect</option>
                                <option value="upstream-output" ${config.sourceMode === 'upstream-output' ? 'selected' : ''}>Upstream generated website/code</option>
                                <option value="repo-file" ${config.sourceMode === 'repo-file' ? 'selected' : ''}>Cloned repo entry file</option>
                                <option value="live-url" ${config.sourceMode === 'live-url' ? 'selected' : ''}>Live URL</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm mb-1">Entry file path</label>
                            <input type="text" id="cfg-ux-entry-file" value="${this._escapeHTML(config.entryFilePath || 'index.html')}" placeholder="index.html" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900 font-mono text-sm">
                        </div>
                        <div>
                            <label class="block text-sm mb-1">Live website URL</label>
                            <input type="text" id="cfg-ux-live-url" value="${this._escapeHTML(config.websiteUrl || config.url || config.targetUrl || '')}" placeholder="https://example.com" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900 font-mono text-sm">
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm mb-1">Auto-audit route list</label>
                            <textarea id="cfg-ux-route-paths" class="w-full h-28 aero-input p-3 rounded-lg bg-slate-50 border-slate-300 text-slate-800 font-mono text-xs" placeholder="/&#10;/pricing&#10;/contact">${this._escapeHTML(config.routePaths || '/')}</textarea>
                            <p class="text-xs text-sky-100/75 mt-1">One route per line. These routes will be opened and audited for visible links, buttons, and broken UX behavior.</p>
                        </div>
                        <div>
                            <label class="block text-sm mb-1">Custom path scenarios (JSON)</label>
                            <textarea id="cfg-ux-scenarios" class="w-full h-28 aero-input p-3 rounded-lg bg-slate-50 border-slate-300 text-slate-800 font-mono text-xs" placeholder='[{"name":"Happy path - primary CTA","category":"happy","path":"/","actions":[{"type":"click","text":"Explore"},{"type":"assertVisible","selector":"#services"}]}]'>${this._escapeHTML(config.customScenarios || '')}</textarea>
                            <p class="text-xs text-sky-100/75 mt-1">Use this for happy, golden, and negative path coverage. Supported actions: <code>click</code>, <code>fill</code>, <code>press</code>, <code>wait</code>, <code>assertText</code>, <code>assertVisible</code>, <code>assertNotVisible</code>, <code>assertUrlIncludes</code>, <code>assertUrlNotIncludes</code>, <code>assertCountAtLeast</code>.</p>
                        </div>
                    </div>
                    <div class="grid grid-cols-4 gap-4">
                        <div>
                            <label class="block text-sm mb-1">Auto-audit visible controls</label>
                            <select id="cfg-ux-auto-explore" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                                <option value="true" ${config.autoExplore !== false ? 'selected' : ''}>Yes</option>
                                <option value="false" ${config.autoExplore === false ? 'selected' : ''}>No</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm mb-1">Max auto interactions</label>
                            <input type="number" id="cfg-ux-max-actions" value="${this._escapeHTML(config.maxAutoInteractions ?? 8)}" min="1" max="50" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900 font-mono text-sm">
                        </div>
                        <div>
                            <label class="block text-sm mb-1">Wait after action (ms)</label>
                            <input type="number" id="cfg-ux-wait-ms" value="${this._escapeHTML(config.waitAfterActionMs ?? 500)}" min="100" max="10000" step="50" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900 font-mono text-sm">
                        </div>
                        <div>
                            <label class="block text-sm mb-1">Continue after failure</label>
                            <select id="cfg-ux-continue" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                                <option value="true" ${config.continueOnFailure !== false ? 'selected' : ''}>Yes, collect full report</option>
                                <option value="false" ${config.continueOnFailure === false ? 'selected' : ''}>Stop on first broken flow</option>
                            </select>
                        </div>
                    </div>
                    <div class="grid grid-cols-4 gap-4">
                        <div>
                            <label class="block text-sm mb-1">Viewport width</label>
                            <input type="number" id="cfg-ux-width" value="${this._escapeHTML(config.viewportWidth ?? 1440)}" min="320" max="3840" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900 font-mono text-sm">
                        </div>
                        <div>
                            <label class="block text-sm mb-1">Viewport height</label>
                            <input type="number" id="cfg-ux-height" value="${this._escapeHTML(config.viewportHeight ?? 900)}" min="320" max="2160" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900 font-mono text-sm">
                        </div>
                        <div>
                            <label class="block text-sm mb-1">Fail on console errors</label>
                            <select id="cfg-ux-console-errors" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                                <option value="true" ${config.failOnConsoleErrors !== false ? 'selected' : ''}>Yes</option>
                                <option value="false" ${config.failOnConsoleErrors === false ? 'selected' : ''}>No</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm mb-1">Fail on page errors</label>
                            <select id="cfg-ux-page-errors" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                                <option value="true" ${config.failOnPageErrors !== false ? 'selected' : ''}>Yes</option>
                                <option value="false" ${config.failOnPageErrors === false ? 'selected' : ''}>No</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm mb-1">Save report to file (optional)</label>
                        <input type="text" id="cfg-ux-report-path" value="${this._escapeHTML(config.reportPath || '')}" placeholder="reports/website-ux-report.md" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900 font-mono text-sm">
                        <p class="text-xs text-sky-100/75 mt-1">Relative paths are saved in the cloned repo when one is available, otherwise next to the tested website output file.</p>
                    </div>
                    <div>
                        <label class="block text-sm mb-1">Last generated report</label>
                        <textarea readonly class="w-full h-40 aero-input p-3 rounded-lg bg-slate-50 border-white/15 text-sky-100 font-mono text-xs">${this._escapeHTML(config.lastUXReport || '')}</textarea>
                    </div>
                </div>
                <div class="flex gap-2 justify-end">
                    <button id="cfg-ux-cancel" class="aero-button-gray py-2 px-4 rounded-lg">Cancel</button>
                    <button id="cfg-ux-save" class="py-2 px-4 rounded-lg font-semibold bg-sky-600 hover:bg-sky-500">Save</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector('#cfg-ux-cancel').onclick = () => modal.remove();
        modal.querySelector('#cfg-ux-save').onclick = () => {
            const scenarioText = modal.querySelector('#cfg-ux-scenarios').value.trim();
            if (scenarioText) {
                try {
                    const parsed = JSON.parse(scenarioText);
                    if (!Array.isArray(parsed)) {
                        throw new Error('Custom path scenarios must be a JSON array.');
                    }
                } catch (error) {
                    if (window.showToast) {
                        window.showToast(`Website UX scenarios are invalid JSON: ${error.message}`, 'error');
                    } else {
                        alert(`Website UX scenarios are invalid JSON: ${error.message}`);
                    }
                    return;
                }
            }

            node.data.sourceMode = modal.querySelector('#cfg-ux-source-mode').value;
            node.data.entryFilePath = modal.querySelector('#cfg-ux-entry-file').value.trim() || 'index.html';
            node.data.websiteUrl = modal.querySelector('#cfg-ux-live-url').value.trim();
            node.data.routePaths = modal.querySelector('#cfg-ux-route-paths').value || '/';
            node.data.customScenarios = scenarioText;
            node.data.autoExplore = modal.querySelector('#cfg-ux-auto-explore').value === 'true';
            node.data.maxAutoInteractions = Math.max(1, parseInt(modal.querySelector('#cfg-ux-max-actions').value, 10) || 8);
            node.data.waitAfterActionMs = Math.max(100, parseInt(modal.querySelector('#cfg-ux-wait-ms').value, 10) || 500);
            node.data.viewportWidth = Math.max(320, parseInt(modal.querySelector('#cfg-ux-width').value, 10) || 1440);
            node.data.viewportHeight = Math.max(320, parseInt(modal.querySelector('#cfg-ux-height').value, 10) || 900);
            node.data.continueOnFailure = modal.querySelector('#cfg-ux-continue').value === 'true';
            node.data.failOnConsoleErrors = modal.querySelector('#cfg-ux-console-errors').value === 'true';
            node.data.failOnPageErrors = modal.querySelector('#cfg-ux-page-errors').value === 'true';
            node.data.reportPath = modal.querySelector('#cfg-ux-report-path').value.trim();
            node.data.name = 'Website UX Auto Tester';

            this.render();
            this._commitHistoryState();
            modal.remove();
            if (window.showToast) window.showToast('Website UX Auto Tester config saved', 'success');
        };
    }

    showPushDeployConfig(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;
        const config = node.data || {};
        const modal = document.createElement('div');
        modal.className = 'mg-dialog fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[10000]';
        modal.innerHTML = `
            ${this._getReadableNodeModalStyles()}
            <div class="aero-modal ve-readable-node-modal p-6 rounded-xl max-w-xl w-full flex flex-col" style="background: linear-gradient(180deg, #7f1d1d 0%, #450a0a 100%); border: 1px solid rgba(248, 113, 113, 0.5); color: white;">
                <h3 class="text-xl font-bold mb-4"> Push & Deploy</h3>
                <div class="space-y-4 mb-6">
                    <div>
                        <label class="block text-sm mb-1">Deployment Target</label>
                        <select id="cfg-deploy-target" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                            <option value="production" ${config.target === 'production' ? 'selected' : ''}>Production</option>
                            <option value="staging" ${config.target === 'staging' ? 'selected' : ''}>Staging / Pre-release</option>
                            <option value="qa" ${config.target === 'qa' ? 'selected' : ''}>QA Environment</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-sm mb-1">Trigger Action</label>
                        <select id="cfg-deploy-trigger" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                            <option value="git-push" ${config.trigger === 'git-push' ? 'selected' : ''}>Git Push to remote</option>
                            <option value="webhook" ${config.trigger === 'webhook' ? 'selected' : ''}>Call Webhook API</option>
                            <option value="custom" ${config.trigger === 'custom' ? 'selected' : ''}>Custom Shell Command</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-sm mb-1">Repository URL</label>
                        <input type="text" id="cfg-deploy-repo" value="${this._escapeHTML(config.repoUrl || '')}" placeholder="https://github.com/user/repo.git" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900 font-mono text-sm">
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm mb-1">Branch</label>
                            <input type="text" id="cfg-deploy-branch" value="${this._escapeHTML(config.branch || 'main')}" placeholder="main" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900 font-mono text-sm">
                        </div>
                        <div>
                            <label class="block text-sm mb-1">Repo File Path</label>
                            <input type="text" id="cfg-deploy-file" value="${this._escapeHTML(config.targetFilePath || 'index.html')}" placeholder="index.html" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900 font-mono text-sm">
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm mb-1">If branch is missing</label>
                            <select id="cfg-deploy-branch-policy" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                                <option value="fail" ${(config.branchMissingPolicy || 'fail') === 'fail' ? 'selected' : ''}>Fail deployment</option>
                                <option value="create" ${config.branchMissingPolicy === 'create' ? 'selected' : ''}>Create branch from base</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm mb-1">Base branch when creating</label>
                            <input type="text" id="cfg-deploy-branch-base" value="${this._escapeHTML(config.branchBase || 'main')}" placeholder="main" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900 font-mono text-sm">
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm mb-1">Commit Message</label>
                        <input type="text" id="cfg-deploy-message" value="${this._escapeHTML(config.commitMessage || 'Deploy from LVX-Machina {date}')}" placeholder="Deploy from LVX-Machina {date}" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                    </div>
                    <div>
                        <label class="block text-sm mb-1">GitHub Token / Access Token (optional)</label>
                        <input type="password" id="cfg-deploy-token" value="${this._secretDisplay(config.authToken)}" placeholder="Used for authenticated git push" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                    </div>
                    <div id="cfg-deploy-cmd-group">
                        <label class="block text-sm mb-1">Webhook URL / Custom Command</label>
                        <input type="text" id="cfg-deploy-cmd" value="${this._escapeHTML(config.command || '')}" placeholder="https://deploy-hook.example.com or npm run deploy" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900 font-mono">
                    </div>
                </div>
                <div class="flex gap-2 justify-end">
                    <button id="cfg-deploy-cancel" class="aero-button-gray py-2 px-4 rounded-lg">Cancel</button>
                    <button id="cfg-deploy-save" class="py-2 px-4 rounded-lg font-semibold bg-red-600 hover:bg-red-500">Save</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector('#cfg-deploy-cancel').onclick = () => modal.remove();
        modal.querySelector('#cfg-deploy-save').onclick = () => {
            node.data.target = modal.querySelector('#cfg-deploy-target').value;
            node.data.trigger = modal.querySelector('#cfg-deploy-trigger').value;
            node.data.repoUrl = modal.querySelector('#cfg-deploy-repo').value.trim();
            node.data.branch = modal.querySelector('#cfg-deploy-branch').value.trim() || 'main';
            node.data.branchMissingPolicy = modal.querySelector('#cfg-deploy-branch-policy').value || 'fail';
            node.data.branchBase = modal.querySelector('#cfg-deploy-branch-base').value.trim() || 'main';
            node.data.targetFilePath = modal.querySelector('#cfg-deploy-file').value.trim() || 'index.html';
            node.data.commitMessage = modal.querySelector('#cfg-deploy-message').value.trim() || 'Deploy from LVX-Machina {date}';
            node.data.authToken = modal.querySelector('#cfg-deploy-token').value.trim() || node.data.authToken || '';
            node.data.command = modal.querySelector('#cfg-deploy-cmd').value.trim();
            node.data.name = ` Deploy: ${node.data.target}`;
            this.render();
            this._commitHistoryState();
            modal.remove();
        };
    }

    showWaitDelayConfig(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const config = node.data || {};
        const modal = document.createElement('div');
        modal.className = 'mg-dialog fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[10000]';
        modal.innerHTML = `
            ${this._getReadableNodeModalStyles()}
            <div class="aero-modal ve-readable-node-modal p-6 rounded-xl max-w-lg w-full flex flex-col" style="background: linear-gradient(180deg, #1e3a8a 0%, #1d4ed8 100%); border: 1px solid rgba(147, 197, 253, 0.65); color: white;">
                <h3 class="text-xl font-bold mb-4">Wait / Delay</h3>
                <div class="space-y-4 mb-6">
                    <div>
                        <label class="block text-sm mb-1">Delay in milliseconds</label>
                        <input type="number" min="0" max="86400000" step="1" id="cfg-wait-delay-ms" value="${Number.isFinite(Number(config.delayMs)) ? Number(config.delayMs) : 5000}" class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900 font-mono text-sm">
                        <p class="text-xs text-blue-100 mt-1">1000 = 1 second, 5000 = 5 seconds, 60000 = 1 minute.</p>
                    </div>
                    <div>
                        <label class="block text-sm mb-1">Optional note</label>
                        <input type="text" id="cfg-wait-note" value="${this._escapeHTML(config.note || '')}" placeholder="Wait for branch propagation, CDN cache, GitHub Pages, webhooks..." class="w-full aero-input p-2 rounded-lg bg-white border-slate-300 text-slate-900">
                    </div>
                </div>
                <div class="flex gap-2 justify-end">
                    <button id="cfg-wait-cancel" class="aero-button-gray py-2 px-4 rounded-lg">Cancel</button>
                    <button id="cfg-wait-save" class="py-2 px-4 rounded-lg font-semibold bg-blue-500 hover:bg-blue-400">Save</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector('#cfg-wait-cancel').onclick = () => modal.remove();
        modal.querySelector('#cfg-wait-save').onclick = () => {
            const delayMs = Math.max(0, parseInt(modal.querySelector('#cfg-wait-delay-ms').value, 10) || 0);
            const note = modal.querySelector('#cfg-wait-note').value.trim();
            node.data.delayMs = delayMs;
            node.data.note = note;
            node.data.name = note ? `Wait: ${note}` : `Wait ${delayMs} ms`;
            this.render();
            this._commitHistoryState();
            modal.remove();
            if (window.showToast) window.showToast('Wait / Delay config saved', 'success');
        };
    }

    zoom(delta, options = {}) {
        const minScale = 0.35;
        const maxScale = 2.5;
        const nextScale = Math.min(maxScale, Math.max(minScale, Number((this.scale + delta).toFixed(2))));
        if (nextScale === this.scale) return;

        const rect = this.canvas?.getBoundingClientRect?.() || { left: 0, top: 0, width: 0, height: 0 };
        const focusX = typeof options.clientX === 'number' ? options.clientX : rect.left + (rect.width / 2);
        const focusY = typeof options.clientY === 'number' ? options.clientY : rect.top + (rect.height / 2);
        const canvasX = focusX - rect.left;
        const canvasY = focusY - rect.top;
        const viewportX = (canvasX - this.panning.x) / this.scale;
        const viewportY = (canvasY - this.panning.y) / this.scale;

        this.scale = nextScale;
        this.panning.x = canvasX - (viewportX * this.scale);
        this.panning.y = canvasY - (viewportY * this.scale);
        this._applyViewportTransform();
    }
    _secretDisplay(value) { return typeof value==='string'?this._escapeHTML(value):''; }

}

window.VisualEditor = VisualEditor;
window.visualEditor = new VisualEditor('visual-editor-root'); // Default
