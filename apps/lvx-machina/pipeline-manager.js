
/**
 * PIPELINE MANAGER
 * Orchestrates the chaining of test suites into automated workflows.
 * Supports multiple scripts per step (stage).
 */

let pipelines = [];
let currentEditingPipeline = null;
let pipelineStages = []; // Renamed from 'steps' to 'stages' for internal clarity
let selectedStageIndex = null;

function getPipelineStorageApi() {
    if (typeof window !== 'undefined' && window.secureConfig) {
        return window.secureConfig;
    }

    return {
        loadConfig: (storageKey, defaultValue = null) => {
            try {
                const raw = localStorage.getItem(storageKey);
                return raw ? JSON.parse(raw) : defaultValue;
            } catch (error) {
                return defaultValue;
            }
        },
        saveConfig: (storageKey, value) => {
            localStorage.setItem(storageKey, JSON.stringify(value));
            return true;
        }
    };
}

function initializePipelineManager() {
    loadPipelines();
    renderPipelinesList();
    console.log("Pipeline Manager Initialized");
}

function loadPipelines() {
    try {
        pipelines = getPipelineStorageApi().loadConfig('lvx_pipelines', []) || [];
    } catch (e) {
        console.error("Error loading pipelines", e);
        pipelines = [];
    }
}

function savePipelines() {
    getPipelineStorageApi().saveConfig('lvx_pipelines', pipelines);
}

function renderPipelinesList() {
    const container = document.getElementById('pipelines-list');
    if (!container) return;

    container.innerHTML = '';

    if (pipelines.length === 0) {
        container.innerHTML = `
            <div class="text-center p-4">
                <p class="text-xs aero-text-muted mb-2">No pipelines yet.</p>
                <div class="flex gap-2 justify-center">
                    <button onclick="openPipelineEditor()" class="aero-button-success text-xs py-1 px-2 rounded">
                        + New Linear Pipeline
                    </button>
                    <button onclick="openVisualPipelineEditor()" class="aero-button-purple text-xs py-1 px-2 rounded">
                        + New Graph Pipeline
                    </button>
                </div>
            </div>`;
        return;
    }

    // Header Actions
    if (!document.getElementById('pipeline-header-actions')) {
        const headerMsg = document.createElement('div');
        headerMsg.id = 'pipeline-header-actions';
        headerMsg.className = 'flex justify-end gap-2 mb-2 px-2';
        headerMsg.innerHTML = `
            <button onclick="openVisualPipelineEditor()" class="text-xs text-purple-600 hover:text-purple-800" title="New Graph Pipeline">+ Graph</button>
         `;
        container.parentNode.insertBefore(headerMsg, container);
    }

    pipelines.forEach(pipeline => {
        const div = document.createElement('div');
        div.className = 'aero-button p-2 rounded text-sm flex justify-between items-center mb-1 hover:shadow';
        div.innerHTML = `
            <div class="truncate font-semibold flex-1 cursor-pointer" onclick="runPipeline('${pipeline.id}')">
                <span class="text-xs text-purple-600 mr-1">${pipeline.type === 'graph' ? '🕸️' : '⚡'}</span>${escapeHtml(pipeline.name)}
            </div>
            <div class="flex gap-1">
                <button onclick="editPipeline('${pipeline.id}')" class="text-blue-600 hover:text-blue-800 px-1" title="Edit">✎</button>
                <button onclick="deletePipeline('${pipeline.id}')" class="text-red-600 hover:text-red-800 px-1" title="Delete">×</button>
            </div>
        `;
        container.appendChild(div);
    });
}

// --- PIPELINE EDITOR ---

function openPipelineEditor() {
    currentEditingPipeline = null;
    pipelineStages = [];
    selectedStageIndex = null;

    document.getElementById('pipeline-name').value = '';
    document.getElementById('pipeline-id').value = '';
    document.getElementById('pipeline-description').value = '';

    renderPipelineStages();
    populateAvailableSuites();

    document.getElementById('pipeline-editor-modal').classList.remove('hidden');
}

function editPipeline(id) {
    const pipeline = pipelines.find(p => p.id === id);
    if (!pipeline) return;

    if (pipeline.type === 'graph') {
        openVisualPipelineEditor(id);
        return;
    }

    currentEditingPipeline = pipeline;
    // Deep copy stages to avoid mutating original during edit cancel
    pipelineStages = JSON.parse(JSON.stringify(pipeline.stages || []));

    // Migration for old single-step format if necessary
    if (pipelineStages.length > 0 && !pipelineStages[0].actions) {
        pipelineStages = pipelineStages.map(oldStep => ({
            id: oldStep.id,
            name: oldStep.suiteName || "Legacy Step",
            onSuccess: oldStep.onSuccess,
            onFailure: oldStep.onFailure,
            actions: [{ suiteId: oldStep.suiteId, suiteName: oldStep.suiteName }]
        }));
    }

    selectedStageIndex = pipelineStages.length > 0 ? 0 : null;

    document.getElementById('pipeline-name').value = pipeline.name;
    document.getElementById('pipeline-id').value = pipeline.id;
    document.getElementById('pipeline-description').value = pipeline.description || '';

    renderPipelineStages();
    populateAvailableSuites();

    document.getElementById('pipeline-editor-modal').classList.remove('hidden');
}

function closePipelineEditor() {
    document.getElementById('pipeline-editor-modal').classList.add('hidden');
}

function populateAvailableSuites() {
    const container = document.getElementById('pipeline-available-suites');
    container.innerHTML = '';

    if (!window.testSuites || window.testSuites.length === 0) {
        container.innerHTML = `
            <div class="text-center p-4 bg-yellow-50 rounded border border-yellow-200">
                <p class="text-xs text-yellow-700 mb-2">No Test Suites found.</p>
                <button onclick="closePipelineEditor(); openAddSuiteModal()" class="aero-button-success text-xs py-1 px-2 rounded">
                    + Create your first Test Suite
                </button>
            </div>
        `;
        return;
    }

    window.testSuites.forEach(suite => {
        const div = document.createElement('div');
        div.className = 'aero-card p-2 cursor-pointer hover:bg-blue-50 transition flex items-center gap-2 draggable-suite';
        div.setAttribute('draggable', 'true');

        // Add click handler as alternative to drag
        div.onclick = () => addActionToSelectedStage(suite);

        div.innerHTML = `
            <div class="w-2 h-2 rounded-full bg-blue-400"></div>
            <div class="text-sm font-medium truncate flex-1">${escapeHtml(suite.name)}</div>
            <div class="text-xs text-gray-400 uppercase">${suite.language.substring(0, 3)}</div>
            <button class="text-xs bg-blue-100 text-blue-600 px-1 rounded hover:bg-blue-200" title="Add to active stage">+</button>
        `;
        container.appendChild(div);
    });
}

function addNewStageToPipeline() {
    const stage = {
        id: 'stage_' + Date.now(),
        name: `Stage ${pipelineStages.length + 1}`,
        onSuccess: 'next',
        onFailure: 'stop',
        actions: [] // Array of suites to run
    };
    pipelineStages.push(stage);
    selectedStageIndex = pipelineStages.length - 1;
    renderPipelineStages();
}

function addActionToSelectedStage(suite) {
    if (selectedStageIndex === null) {
        // If no stage selected, create one
        addNewStageToPipeline();
    }

    const stage = pipelineStages[selectedStageIndex];
    stage.actions.push({
        id: 'action_' + Date.now(),
        suiteId: suite.id,
        suiteName: suite.name
    });
    renderPipelineStages();
}

function removeStage(index) {
    pipelineStages.splice(index, 1);
    if (selectedStageIndex === index) selectedStageIndex = null;
    if (selectedStageIndex > index) selectedStageIndex--;
    renderPipelineStages();
}

function removeAction(stageIndex, actionIndex) {
    pipelineStages[stageIndex].actions.splice(actionIndex, 1);
    renderPipelineStages();
}

function selectStage(index) {
    selectedStageIndex = index;
    renderPipelineStages();
}

function updateStageLogic(index, type, value) {
    pipelineStages[index][type] = value;
}

function updateStageName(index, value) {
    pipelineStages[index].name = value;
}

function moveStage(index, direction) {
    if (direction === 'up' && index > 0) {
        [pipelineStages[index], pipelineStages[index - 1]] = [pipelineStages[index - 1], pipelineStages[index]];
        if (selectedStageIndex === index) selectedStageIndex--;
        else if (selectedStageIndex === index - 1) selectedStageIndex++;
    } else if (direction === 'down' && index < pipelineStages.length - 1) {
        [pipelineStages[index], pipelineStages[index + 1]] = [pipelineStages[index + 1], pipelineStages[index]];
        if (selectedStageIndex === index) selectedStageIndex++;
        else if (selectedStageIndex === index + 1) selectedStageIndex--;
    }
    renderPipelineStages();
}

function renderPipelineStages() {
    const container = document.getElementById('pipeline-stages-container');
    const emptyMsg = document.getElementById('pipeline-empty-msg');

    container.innerHTML = '';

    if (pipelineStages.length === 0) {
        emptyMsg.classList.remove('hidden');
        return;
    }
    emptyMsg.classList.add('hidden');

    pipelineStages.forEach((stage, index) => {
        const isSelected = index === selectedStageIndex;
        const div = document.createElement('div');
        div.className = `pipeline-step bg-white p-4 rounded shadow border-l-4 relative transition-all ${isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-300 opacity-90'}`;
        div.onclick = (e) => {
            if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
                selectStage(index);
            }
        };

        // Build Actions HTML
        let actionsHtml = '';
        if (stage.actions.length === 0) {
            actionsHtml = '<div class="text-xs text-gray-400 italic p-2 border border-dashed border-gray-300 rounded text-center">No scripts added. Click items on left to add.</div>';
        } else {
            stage.actions.forEach((action, aIndex) => {
                actionsHtml += `
                    <div class="flex justify-between items-center bg-gray-50 p-2 rounded border border-gray-200 mb-1 text-sm">
                        <span class="truncate flex-1">📄 ${escapeHtml(action.suiteName)}</span>
                        <button onclick="removeAction(${index}, ${aIndex})" class="text-red-400 hover:text-red-600 font-bold px-2">×</button>
                    </div>
                `;
            });
        }

        div.innerHTML = `
            <div class="absolute top-2 right-2 flex gap-1">
                <button onclick="moveStage(${index}, 'up')" class="text-gray-400 hover:text-blue-600" ${index === 0 ? 'disabled' : ''}>▲</button>
                <button onclick="moveStage(${index}, 'down')" class="text-gray-400 hover:text-blue-600" ${index === pipelineStages.length - 1 ? 'disabled' : ''}>▼</button>
                <button onclick="removeStage(${index})" class="text-red-400 hover:text-red-600 ml-2">🗑</button>
            </div>
            
            <div class="mb-3 pr-16">
                <input type="text" value="${escapeHtml(stage.name)}" 
                    onchange="updateStageName(${index}, this.value)"
                    class="font-bold text-lg bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none w-full"
                    placeholder="Stage Name">
            </div>

            <div class="mb-3">
                <h5 class="text-xs font-bold text-gray-500 uppercase mb-1">Scripts / Test Suites</h5>
                <div class="space-y-1 max-h-32 overflow-y-auto">
                    ${actionsHtml}
                </div>
            </div>

            <div class="flex gap-4 mt-3 text-xs border-t pt-2">
                <div class="flex-1">
                    <label class="block text-green-600 font-medium mb-1">On Success</label>
                    <select class="w-full border rounded p-1 bg-green-50" onchange="updateStageLogic(${index}, 'onSuccess', this.value)">
                        <option value="next" ${stage.onSuccess === 'next' ? 'selected' : ''}>Run Next Stage</option>
                        <option value="stop" ${stage.onSuccess === 'stop' ? 'selected' : ''}>Stop Pipeline</option>
                    </select>
                </div>
                <div class="flex-1">
                    <label class="block text-red-600 font-medium mb-1">On Failure</label>
                    <select class="w-full border rounded p-1 bg-red-50" onchange="updateStageLogic(${index}, 'onFailure', this.value)">
                        <option value="stop" ${stage.onFailure === 'stop' ? 'selected' : ''}>Stop Pipeline</option>
                        <option value="next" ${stage.onFailure === 'next' ? 'selected' : ''}>Continue Anyway</option>
                    </select>
                </div>
            </div>
            ${index < pipelineStages.length - 1 ?
                '<div class="absolute -bottom-8 left-1/2 transform -translate-x-1/2 text-gray-400 text-xl">↓</div>' : ''}
        `;
        container.appendChild(div);
    });
}

function savePipeline() {
    const name = document.getElementById('pipeline-name').value;
    const desc = document.getElementById('pipeline-description').value;

    if (!name) {
        alert("Pipeline name is required");
        return;
    }
    if (pipelineStages.length === 0) {
        alert("Pipeline must have at least one stage");
        return;
    }

    // Validate empty stages
    const emptyStage = pipelineStages.find(s => s.actions.length === 0);
    if (emptyStage) {
        alert(`Stage "${emptyStage.name}" has no scripts. Please add scripts or remove the stage.`);
        return;
    }

    const pipeline = {
        id: currentEditingPipeline ? currentEditingPipeline.id : 'pipe_' + Date.now(),
        name: name,
        description: desc,
        stages: pipelineStages,
        lastRun: null,
        lastStatus: 'NEVER_RUN'
    };

    if (currentEditingPipeline) {
        const idx = pipelines.findIndex(p => p.id === pipeline.id);
        if (idx !== -1) pipelines[idx] = pipeline;
    } else {
        pipelines.push(pipeline);
    }

    savePipelines();
    renderPipelinesList();
    closePipelineEditor();
    window.showMessage("Pipeline saved successfully", 'success');
}

function deletePipeline(id) {
    if (confirm("Delete this pipeline?")) {
        pipelines = pipelines.filter(p => p.id !== id);
        savePipelines();
        renderPipelinesList();
    }
}

// --- PIPELINE RUNNER (ADVANCED) ---

async function runPipeline(id) {
    const pipeline = pipelines.find(p => p.id === id);
    if (!pipeline) return;

    if (pipeline.type === 'graph') {
        runGraphPipeline(pipeline);
        return;
    }

    const modal = document.getElementById('pipeline-run-modal');
    const title = document.getElementById('run-pipeline-name');
    const stepsContainer = document.getElementById('pipeline-execution-steps');
    const consoleOutput = document.getElementById('pipeline-console-output');
    const statusBadge = document.getElementById('pipeline-overall-status');

    title.textContent = pipeline.name;
    stepsContainer.innerHTML = '';
    consoleOutput.innerHTML = `<span class="text-gray-400">Initializing execution of pipeline: ${pipeline.name}...</span><br>`;
    statusBadge.className = "px-3 py-1 rounded-full text-sm font-bold bg-blue-100 text-blue-600";
    statusBadge.innerText = "RUNNING";
    setPipelineRunMonitorState({
        title: pipeline.name,
        status: 'RUNNING'
    });

    // Render Pipeline Structure in Runner Modal
    pipeline.stages.forEach((stage, sIdx) => {
        const stageDiv = document.createElement('div');
        stageDiv.id = `exec-stage-${sIdx}`;
        stageDiv.className = 'mb-4';

        let jobsHtml = '';
        stage.actions.forEach((action, aIdx) => {
            jobsHtml += `
                <div id="exec-stage-${sIdx}-action-${aIdx}" class="ml-4 mt-2 p-2 bg-white border border-gray-200 rounded flex justify-between items-center text-sm">
                    <div class="flex items-center gap-2">
                        <span class="text-gray-400 text-xs">Job ${aIdx + 1}</span>
                        <span class="font-medium">${escapeHtml(action.suiteName)}</span>
                    </div>
                    <span class="status-text text-xs text-gray-500">WAITING</span>
                </div>
            `;
        });

        stageDiv.innerHTML = `
            <div class="p-3 bg-gray-100 rounded border border-gray-300 flex justify-between items-center stage-header">
                <div class="font-bold text-gray-700">Step ${sIdx + 1}: ${escapeHtml(stage.name)}</div>
                <div class="stage-status text-xs px-2 py-1 rounded bg-gray-200 text-gray-600">PENDING</div>
            </div>
            <div class="jobs-container border-l-2 border-gray-200 ml-3 pl-0">
                ${jobsHtml}
            </div>
        `;
        stepsContainer.appendChild(stageDiv);
    });

    modal.classList.remove('hidden');

    // Execution Loop
    let overallStatus = 'SUCCESS';

    for (let i = 0; i < pipeline.stages.length; i++) {
        const stage = pipeline.stages[i];
        const stageEl = document.getElementById(`exec-stage-${i}`);
        const stageHeader = stageEl.querySelector('.stage-header');
        const stageBadge = stageEl.querySelector('.stage-status');

        // Update Stage UI to Running
        stageHeader.className = 'p-3 bg-blue-50 border border-blue-300 rounded flex justify-between items-center shadow stage-header transition-all';
        stageBadge.className = 'stage-status text-xs px-2 py-1 rounded bg-blue-500 text-white';
        stageBadge.innerHTML = 'RUNNING <span class="spinner w-3 h-3 border-white ml-1"></span>';

        consoleOutput.innerHTML += `<br><span class="text-blue-400 font-bold">>>> Executing Stage ${i + 1}: ${stage.name}</span><br>`;
        consoleOutput.scrollTop = consoleOutput.scrollHeight;

        stageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

        let stageSuccess = true;

        // Run all actions in this stage sequentially (Local JS is single threaded anyway)
        for (let j = 0; j < stage.actions.length; j++) {
            const action = stage.actions[j];
            const actionEl = document.getElementById(`exec-stage-${i}-action-${j}`);
            const actionStatus = actionEl.querySelector('.status-text');

            actionEl.className = "ml-4 mt-2 p-2 bg-blue-50 border border-blue-200 rounded flex justify-between items-center text-sm shadow-sm";
            actionStatus.className = "status-text text-xs text-blue-600 font-bold";
            actionStatus.innerText = "RUNNING...";

            consoleOutput.innerHTML += `<span class="text-gray-300 ml-4">- Running job: ${action.suiteName}...</span>`;

            try {
                // Use window.runTestSuite for local execution
                const result = await window.runTestSuite(action.suiteId, true); // true = silent mode

                if (result.status === 'SUCCESS') {
                    actionEl.className = "ml-4 mt-2 p-2 bg-green-50 border border-green-200 rounded flex justify-between items-center text-sm";
                    actionStatus.className = "status-text text-xs text-green-600 font-bold";
                    actionStatus.innerText = "✓ PASS";
                    consoleOutput.innerHTML += ` <span class="text-green-400">PASS</span><br>`;
                } else if (result.status === 'PENDING') {
                    // Handle Visual Web Runner Hand-off
                    actionEl.className = "ml-4 mt-2 p-2 bg-purple-50 border border-purple-200 rounded flex justify-between items-center text-sm";
                    actionStatus.innerText = "↗ VISUAL RUNNER";
                    consoleOutput.innerHTML += ` <span class="text-purple-400">Opened Visual Runner</span><br>`;
                    // We don't fail the pipeline for visual runner, but we can't track it fully here
                } else {
                    actionEl.className = "ml-4 mt-2 p-2 bg-red-50 border border-red-200 rounded flex justify-between items-center text-sm";
                    actionStatus.className = "status-text text-xs text-red-600 font-bold";
                    actionStatus.innerText = "✗ FAIL";
                    consoleOutput.innerHTML += ` <span class="text-red-500">FAIL</span><br>`;
                    consoleOutput.innerHTML += `<span class="text-red-300 text-xs ml-6">${result.log.substring(0, 200)}...</span><br>`;
                    stageSuccess = false;
                }

            } catch (err) {
                console.error(err);
                actionEl.className = "ml-4 mt-2 p-2 bg-red-100 border border-red-300 rounded flex justify-between items-center text-sm";
                actionStatus.innerText = "ERROR";
                consoleOutput.innerHTML += ` <span class="text-red-600">ERROR: ${err.message}</span><br>`;
                stageSuccess = false;
            }
            consoleOutput.scrollTop = consoleOutput.scrollHeight;
        }

        // Evaluate Stage Result
        if (stageSuccess) {
            stageHeader.className = 'p-3 bg-green-50 border border-green-300 rounded flex justify-between items-center stage-header';
            stageBadge.className = 'stage-status text-xs px-2 py-1 rounded bg-green-500 text-white';
            stageBadge.innerText = 'COMPLETED';

            if (stage.onSuccess === 'stop') {
                consoleOutput.innerHTML += `<br><span class="text-yellow-400">INFO: Logic [Success -> Stop] triggered. Stopping pipeline.</span><br>`;
                break;
            }
        } else {
            stageHeader.className = 'p-3 bg-red-50 border border-red-300 rounded flex justify-between items-center stage-header';
            stageBadge.className = 'stage-status text-xs px-2 py-1 rounded bg-red-500 text-white';
            stageBadge.innerText = 'FAILED';

            if (stage.onFailure === 'stop') {
                consoleOutput.innerHTML += `<br><span class="text-red-500 font-bold">CRITICAL: Stage Failed. Logic [Failure -> Stop] triggered. Aborting pipeline.</span><br>`;
                overallStatus = 'FAILURE';
                break;
            } else {
                consoleOutput.innerHTML += `<br><span class="text-yellow-400">WARNING: Stage Failed. Logic [Failure -> Next] triggered. Continuing...</span><br>`;
                overallStatus = 'WARNING';
            }
        }
    }

    consoleOutput.innerHTML += `<br><span class="text-white font-bold border-t border-gray-600 pt-2 block">Pipeline Execution Finished. Final Status: ${overallStatus}</span>`;
    consoleOutput.scrollTop = consoleOutput.scrollHeight;

    // Final Status Badge Update
    if (overallStatus === 'SUCCESS') {
        statusBadge.className = "px-3 py-1 rounded-full text-sm font-bold bg-green-100 text-green-600";
        statusBadge.innerText = "SUCCESS";
        setPipelineRunMonitorState({ status: 'SUCCESS' });
    } else if (overallStatus === 'WARNING') {
        statusBadge.className = "px-3 py-1 rounded-full text-sm font-bold bg-yellow-100 text-yellow-600";
        statusBadge.innerText = "WARNINGS";
        setPipelineRunMonitorState({ status: 'WARNINGS' });
    } else {
        statusBadge.className = "px-3 py-1 rounded-full text-sm font-bold bg-red-100 text-red-600";
        statusBadge.innerText = "FAILURE";
        setPipelineRunMonitorState({ status: 'FAILURE' });
    }

    // Update Pipeline Metadata
    pipeline.lastRun = new Date().toISOString();
    pipeline.lastStatus = overallStatus;
    savePipelines();
}

const activePipelineRunMonitor = {
    title: 'Pipeline Runner',
    status: 'INITIALIZING'
};

function updatePipelineRunMonitorVisibility() {
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

function updatePipelineRunMinimizeItem() {
    const item = document.getElementById('minimized-pipeline-runner');
    if (!item) return;

    const label = item.querySelector('.pipeline-runner-label');
    const status = item.querySelector('.pipeline-runner-status');
    const spinner = item.querySelector('.spinner');
    if (label) label.textContent = activePipelineRunMonitor.title || 'Pipeline Runner';
    if (status) status.textContent = activePipelineRunMonitor.status || 'RUNNING';

    item.classList.remove('status-success', 'status-failure');
    if (spinner) spinner.style.display = 'inline-block';

    const normalizedStatus = String(activePipelineRunMonitor.status || '').toUpperCase();
    if (normalizedStatus === 'SUCCESS') {
        item.classList.add('status-success');
        if (spinner) spinner.style.display = 'none';
    } else if (normalizedStatus === 'FAILURE' || normalizedStatus === 'ERROR') {
        item.classList.add('status-failure');
        if (spinner) spinner.style.display = 'none';
    } else if (normalizedStatus === 'WARNINGS') {
        if (spinner) spinner.style.display = 'none';
    }
}

function ensurePipelineRunMinimizeItem() {
    const container = document.getElementById('minimize-bar-items-container');
    if (!container) return;

    let item = document.getElementById('minimized-pipeline-runner');
    if (!item) {
        item = document.createElement('div');
        item.className = 'minimized-test-item';
        item.id = 'minimized-pipeline-runner';
        item.onclick = (event) => {
            if (event.target.closest('.close-btn')) return;
            restorePipelineRunModal();
        };
        item.innerHTML = `
            <div class="spinner mr-2"></div>
            <div class="flex flex-col leading-tight">
                <span class="font-semibold pipeline-runner-label"></span>
                <span class="text-[10px] opacity-80 pipeline-runner-status"></span>
            </div>
            <button class="close-btn" title="Close Runner" onclick="event.stopPropagation(); closePipelineRunModal()">
                &times;
            </button>
        `;
        container.appendChild(item);
    }

    updatePipelineRunMinimizeItem();
    updatePipelineRunMonitorVisibility();
}

function setPipelineRunMonitorState(nextState = {}) {
    if (typeof nextState.title === 'string' && nextState.title.trim()) {
        activePipelineRunMonitor.title = nextState.title.trim();
    }
    if (typeof nextState.status === 'string' && nextState.status.trim()) {
        activePipelineRunMonitor.status = nextState.status.trim();
    }
    updatePipelineRunMinimizeItem();
}

function minimizePipelineRunModal() {
    const modal = document.getElementById('pipeline-run-modal');
    if (!modal) return;
    ensurePipelineRunMinimizeItem();
    modal.classList.add('hidden');
}

function restorePipelineRunModal() {
    const modal = document.getElementById('pipeline-run-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
}

function closePipelineRunModal() {
    const modal = document.getElementById('pipeline-run-modal');
    if (modal) modal.classList.add('hidden');

    const item = document.getElementById('minimized-pipeline-runner');
    if (item) item.remove();
    updatePipelineRunMonitorVisibility();
}

function normalizeGraphNodeType(type) {
    if (!type) return 'test-suite';
    if (type === 'security_scan') return 'security-scan';
    if (type === 'security_gate') return 'security-gate';
    return type;
}

function isGraphFailureStatus(status) {
    const normalizedStatus = String(status || '').toUpperCase();
    return normalizedStatus === 'FAILURE' || normalizedStatus === 'FAILED' || normalizedStatus === 'ERROR';
}

function buildGraphIndex(pipeline) {
    const nodes = pipeline.nodes || [];
    const edges = pipeline.edges || [];
    const nodeById = new Map(nodes.map(node => [node.id, node]));
    const outgoing = new Map();
    const incoming = new Map();

    nodes.forEach(node => {
        outgoing.set(node.id, []);
        incoming.set(node.id, []);
    });

    edges.forEach(edge => {
        if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
        if (!incoming.has(edge.target)) incoming.set(edge.target, []);
        outgoing.get(edge.source).push(edge.target);
        incoming.get(edge.target).push(edge.source);
    });

    return { nodes, edges, nodeById, outgoing, incoming };
}

function getAILogSummaryProviderLabel(provider) {
    const labels = {
        openai: 'OpenAI',
        anthropic: 'Anthropic (Claude)',
        google: 'Google (Gemini)',
        custom: 'Custom (OpenAI-compatible)'
    };
    return labels[provider] || provider || 'AI';
}

function extractAIUnitTestSummary(logText) {
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

function buildAIUnitTestNodeResult(result, options = {}) {
    const stdout = typeof result?.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result?.stderr === 'string' ? result.stderr : '';
    const combinedOutput = [stdout, stderr].filter(Boolean).join('\n').trim();
    const testSummary = extractAIUnitTestSummary(combinedOutput);
    const exitCode = typeof result?.exitCode === 'number' ? result.exitCode : null;
    const status = exitCode === 0 ? 'SUCCESS' : 'FAILURE';
    const message = exitCode === 0
        ? 'AI Tests Passed'
        : `AI Tests Failed (exit ${exitCode})`;

    return {
        status,
        message,
        output: combinedOutput || stdout || stderr,
        log: combinedOutput,
        stdout,
        stderr,
        exitCode,
        testSummary,
        testFile: options.testFilename || null,
        workingDirectory: options.cwd || null,
        generatedCode: options.generatedCode || '',
        sourceFilesUsed: Array.isArray(options.sourceFilesUsed) ? options.sourceFilesUsed : [],
        generationMode: options.generationMode || 'manual',
        testMode: options.testMode || 'module-unit',
        artifacts: {
            log: combinedOutput,
            output: combinedOutput || stdout || stderr,
            stdout,
            stderr,
            exitCode,
            testSummary,
            testFile: options.testFilename || null,
            workingDirectory: options.cwd || null,
            repoPath: options.cwd || null,
            generatedTestCode: options.generatedCode || '',
            sourceFilesUsed: Array.isArray(options.sourceFilesUsed) ? options.sourceFilesUsed : [],
            generationMode: options.generationMode || 'manual',
            testMode: options.testMode || 'module-unit',
            deployRequested: Boolean(options.deployRequested) && status === 'SUCCESS'
        }
    };
}

const DEFAULT_AI_UNIT_TEST_SOURCE_EXTENSIONS = [
    'html', 'css', 'scss', 'sass', 'less',
    'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
    'vue', 'svelte',
    'py', 'java', 'cs', 'go', 'rb', 'php', 'c', 'cpp', 'h', 'rs', 'swift', 'kt', 'scala',
    'json'
];

function getAIUnitTestAutomationMode(config = {}) {
    const mode = String(config.automationMode || '').trim().toLowerCase();
    return ['manual', 'assisted', 'automated'].includes(mode) ? mode : 'manual';
}

function getAIUnitTestSourceStrategy(config = {}) {
    const strategy = String(config.sourceStrategy || '').trim().toLowerCase();
    return ['saved-selection', 'auto-scan', 'prompt-only'].includes(strategy) ? strategy : 'saved-selection';
}

function getAIUnitTestGenerationFallback(config = {}) {
    const fallback = String(config.generationFallback || '').trim().toLowerCase();
    return fallback === 'use-saved' ? 'use-saved' : 'fail';
}

function getAIUnitTestSourceExtensions(config = {}) {
    const parsed = String(config.sourceExtensions || '')
        .split(',')
        .map(ext => ext.trim().replace(/^\./, '').toLowerCase())
        .filter(Boolean);

    return parsed.length > 0 ? parsed : DEFAULT_AI_UNIT_TEST_SOURCE_EXTENSIONS;
}

function getAIUnitTestTestMode(config = {}) {
    const mode = String(config.testMode || '').trim().toLowerCase();
    return ['auto', 'module-unit', 'static-site'].includes(mode) ? mode : 'auto';
}

function detectAIUnitTestResolvedMode(config = {}, sourceFiles = []) {
    const configuredMode = getAIUnitTestTestMode(config);
    if (configuredMode === 'module-unit' || configuredMode === 'static-site') {
        return configuredMode;
    }

    const normalizedPaths = sourceFiles
        .map(file => String(file || '').replace(/\\/g, '/').toLowerCase())
        .filter(Boolean);

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

function normalizeRepoRelativePath(filePath, repoPath = '') {
    return String(filePath || '')
        .replace(String(repoPath || ''), '')
        .replace(/^[\\/]+/, '')
        .replace(/\\/g, '/');
}

function prioritizeAIUnitTestSourceFiles(files, repoPath = '') {
    const extensionPriority = new Map([
        ['html', 0],
        ['js', 1],
        ['jsx', 2],
        ['ts', 3],
        ['tsx', 4],
        ['css', 5],
        ['scss', 6],
        ['sass', 7],
        ['vue', 8],
        ['svelte', 9],
        ['json', 10]
    ]);
    const filenamePriority = ['index.', 'main.', 'app.', 'script.', 'styles.'];

    return [...files].sort((left, right) => {
        const leftRelative = normalizeRepoRelativePath(left, repoPath).toLowerCase();
        const rightRelative = normalizeRepoRelativePath(right, repoPath).toLowerCase();
        const leftExt = leftRelative.split('.').pop() || '';
        const rightExt = rightRelative.split('.').pop() || '';
        const leftExtRank = extensionPriority.has(leftExt) ? extensionPriority.get(leftExt) : 100;
        const rightExtRank = extensionPriority.has(rightExt) ? extensionPriority.get(rightExt) : 100;

        if (leftExtRank !== rightExtRank) {
            return leftExtRank - rightExtRank;
        }

        const leftNameRank = filenamePriority.findIndex(prefix => leftRelative.includes(prefix));
        const rightNameRank = filenamePriority.findIndex(prefix => rightRelative.includes(prefix));
        const normalizedLeftNameRank = leftNameRank === -1 ? 100 : leftNameRank;
        const normalizedRightNameRank = rightNameRank === -1 ? 100 : rightNameRank;

        if (normalizedLeftNameRank !== normalizedRightNameRank) {
            return normalizedLeftNameRank - normalizedRightNameRank;
        }

        if (leftRelative.length !== rightRelative.length) {
            return leftRelative.length - rightRelative.length;
        }

        return leftRelative.localeCompare(rightRelative);
    });
}

async function buildAIUnitTestSourceContext(config = {}, repoPath = '') {
    const strategy = getAIUnitTestSourceStrategy(config);
    const warnings = [];

    if (strategy === 'prompt-only') {
        return {
            sourceCodeContext: '',
            sourceFilesUsed: [],
            warnings
        };
    }

    if (!repoPath) {
        warnings.push('No repository path was available, so test generation proceeded without source files.');
        return {
            sourceCodeContext: '',
            sourceFilesUsed: [],
            warnings
        };
    }

    if (!window.electronAPI?.fileOps?.listFiles || !window.electronAPI?.fileOps?.readFile) {
        throw new Error('File operations are not available for AI test generation.');
    }

    const allFiles = await window.electronAPI.fileOps.listFiles(repoPath);
    const sourceExtensions = new Set(getAIUnitTestSourceExtensions(config));
    const filteredFiles = allFiles.filter(filePath => {
        const extension = String(filePath).split('.').pop()?.toLowerCase() || '';
        return sourceExtensions.has(extension);
    });

    let candidateFiles = filteredFiles;
    const selectedFiles = Array.isArray(config.selectedSourceFiles)
        ? config.selectedSourceFiles.map(filePath => String(filePath).replace(/\\/g, '/'))
        : [];

    if (strategy === 'saved-selection') {
        if (selectedFiles.length > 0) {
            const selectedSet = new Set(selectedFiles);
            candidateFiles = filteredFiles.filter(filePath => selectedSet.has(normalizeRepoRelativePath(filePath, repoPath)));
        } else {
            warnings.push('No saved source files were configured, so test generation proceeded from instructions only. Choose the auto-scan source strategy if you want runtime repo access without manually saving a file list.');
            candidateFiles = [];
        }
    }

    const maxSourceFiles = Math.max(1, parseInt(config.maxSourceFiles, 10) || 12);
    const maxSourceChars = Math.max(2000, parseInt(config.maxSourceChars, 10) || 60000);
    const prioritizedFiles = prioritizeAIUnitTestSourceFiles(candidateFiles, repoPath).slice(0, maxSourceFiles);
    const sourceFileChunks = [];
    const sourceFilesUsed = [];
    let consumedCharacters = 0;
    let truncated = false;

    for (const filePath of prioritizedFiles) {
        const fileContent = await window.electronAPI.fileOps.readFile(filePath);
        const relativePath = normalizeRepoRelativePath(filePath, repoPath);
        const nextChunk = `\n=== FILE: ${relativePath} ===\n${fileContent}\n`;

        if (sourceFileChunks.length > 0 && consumedCharacters + nextChunk.length > maxSourceChars) {
            truncated = true;
            break;
        }

        sourceFileChunks.push(nextChunk);
        sourceFilesUsed.push(relativePath);
        consumedCharacters += nextChunk.length;
    }

    if (candidateFiles.length > prioritizedFiles.length || truncated) {
        warnings.push(`Source context was limited to ${sourceFilesUsed.length} file(s) and about ${consumedCharacters} characters to keep the AI prompt manageable.`);
    }

    if (sourceFilesUsed.length === 0 && strategy !== 'prompt-only') {
        warnings.push('No matching source files were included in the AI prompt.');
    }

    return {
        sourceCodeContext: sourceFileChunks.length > 0
            ? '\n\n--- SOURCE CODE FROM REPOSITORY ---\n' + sourceFileChunks.join('') + '\n--- END OF SOURCE CODE ---\n'
            : '',
        sourceFilesUsed,
        warnings
    };
}

function buildAIUnitTestSystemPrompt(testFilename, options = {}) {
    const resolvedMode = options.testMode || 'module-unit';
    if (resolvedMode === 'static-site') {
        return `You are an expert web QA engineer. Generate a COMPLETE, RUNNABLE Node.js smoke-test file for a static website source tree.

CRITICAL RULES:
1. Use ONLY built-in Node.js modules such as "assert", "fs", and "path". Do NOT use Jest, Mocha, Vitest, Playwright, Puppeteer, jsdom, or any external dependency.
2. The test file must run with "node ${testFilename}" directly from the repo root.
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
   DO NOT use Jest, Mocha, Vitest, or any external testing framework. The test file must be runnable with "node ${testFilename}" directly.
2. Structure your test file like this:
   - require('assert') at the top
   - require/import the source module(s) using CORRECT RELATIVE PATHS (the test file will be in the repo root)
   - Define test functions, each wrapped in try/catch that prints PASS or FAIL
   - At the bottom, run all tests and print a summary (X passed, Y failed)
3. Generate tests covering HAPPY PATH, GOLDEN PATH, EDGE CASES, and NEGATIVE PATH scenarios.
4. Each test must have a clear, descriptive name.
5. The code must be a COMPLETE, RUNNABLE file. Do not use markdown fences. Output ONLY valid code.
6. The test file name will be: ${testFilename}
7. Add a short comment header summarizing the test coverage.
8. If source code files are provided, target the actual functions, classes, exports, and logic in those files. Do not invent modules.
9. If no source code is provided, generate tests from the user's instructions only and say so in a comment.
10. Output ONLY the test code. No explanations, no markdown, no fences.`;
}

async function generateAIUnitTestCode(config = {}, repoPath = '') {
    if (!window.electronAPI?.aiOps?.generate) {
        throw new Error('AI operations are not available for AI Unit Test generation.');
    }

    const instructions = String(config.instructions || '').trim();
    if (!instructions) {
        throw new Error('Instructions are required for automated AI Unit Test generation.');
    }

    const apiKey = String(config.apiKey || '').trim();
    if (!apiKey) {
        throw new Error('API key is required for automated AI Unit Test generation.');
    }

    const testFilename = String(config.testFilename || 'ai-generated-test.js').trim() || 'ai-generated-test.js';
    const sourceContext = await buildAIUnitTestSourceContext(config, repoPath);
    const resolvedMode = detectAIUnitTestResolvedMode(config, sourceContext.sourceFilesUsed);
    const aiResult = await window.electronAPI.aiOps.generate({
        provider: config.provider || 'openai',
        model: config.model || '',
        apiKey,
        prompt: instructions + sourceContext.sourceCodeContext,
        systemPrompt: buildAIUnitTestSystemPrompt(testFilename, { testMode: resolvedMode }),
        customEndpoint: config.customEndpoint || '',
        maxTokens: parseInt(config.maxTokens, 10) || 16384
    });

    const generatedCode = stripMarkdownCodeFences(aiResult?.generatedText || aiResult?.text || aiResult);
    if (!generatedCode.trim()) {
        throw new Error('The AI returned an empty test file.');
    }

    return {
        generatedCode,
        sourceFilesUsed: sourceContext.sourceFilesUsed,
        warnings: sourceContext.warnings,
        resolvedMode
    };
}

function persistAIUnitTestGeneratedCode(node, generatedCode, metadata = {}) {
    node.data.generatedCode = generatedCode;
    node.data.lastGeneratedAt = new Date().toISOString();
    node.data.lastSourceFilesUsed = Array.isArray(metadata.sourceFilesUsed) ? metadata.sourceFilesUsed : [];
    node.data.lastGenerationMode = metadata.generationMode || getAIUnitTestAutomationMode(node.data);
    node.data.lastResolvedTestMode = metadata.resolvedMode || detectAIUnitTestResolvedMode(node.data, node.data.lastSourceFilesUsed);

    if (window.visualEditor?.render) window.visualEditor.render();
    if (window.visualEditor?._commitHistoryState) window.visualEditor._commitHistoryState();
}

function buildFallbackAILogSummaryContext(upstreamNodes, resultsByNodeId = {}) {
    const sourceNames = [];
    const sections = [];

    upstreamNodes.forEach(sourceNode => {
        if (!sourceNode) return;

        sourceNames.push(sourceNode.data?.name || sourceNode.id);
        const result = resultsByNodeId[sourceNode.id] || sourceNode.data?.lastResult || {};
        sections.push(JSON.stringify({
            node: sourceNode.data?.name || sourceNode.id,
            type: sourceNode.type,
            status: result.status || null,
            message: result.message || null,
            log: result.log || null,
            output: result.output || null,
            stderr: result.stderr || null,
            stdout: result.stdout || null,
            testSummary: result.testSummary || null,
            securityResults: result.securityResults || null
        }, null, 2));
    });

    return {
        sourceCount: sourceNames.length,
        sourceNames,
        logText: sections.join('\n\n====================\n\n')
    };
}

function normalizeAILogSummaryScope(scope) {
    const normalized = String(scope || '').trim().toLowerCase();
    if (normalized === 'direct-upstream' || normalized === 'upstream-chain' || normalized === 'full-runner-log') {
        return normalized;
    }
    return 'full-runner-log';
}

function collectUpstreamSummaryNodes(nodeId, graphIndex, scope = 'full-runner-log') {
    const normalizedScope = normalizeAILogSummaryScope(scope);
    const directNodes = (graphIndex?.incoming?.get(nodeId) || [])
        .map(sourceNodeId => graphIndex.nodeById.get(sourceNodeId))
        .filter(Boolean);

    if (normalizedScope === 'direct-upstream') {
        return directNodes;
    }

    const visited = new Set();
    const orderedNodeIds = [];
    const queue = [...(graphIndex?.incoming?.get(nodeId) || [])];

    while (queue.length > 0) {
        const currentId = queue.shift();
        if (visited.has(currentId)) continue;
        visited.add(currentId);
        orderedNodeIds.push(currentId);

        const nextIds = graphIndex?.incoming?.get(currentId) || [];
        nextIds.forEach(nextId => {
            if (!visited.has(nextId)) {
                queue.push(nextId);
            }
        });
    }

    return orderedNodeIds
        .map(sourceNodeId => graphIndex.nodeById.get(sourceNodeId))
        .filter(Boolean);
}

function buildFullRunnerLogSummaryContext(resultsByNodeId = {}, runnerLogText = '', graphIndex = null) {
    const entries = Object.entries(resultsByNodeId || {});
    const sourceNames = entries.map(([nodeId]) => graphIndex?.nodeById?.get(nodeId)?.data?.name || nodeId);
    const serializedResults = entries.map(([nodeId, result]) => JSON.stringify({
        node: graphIndex?.nodeById?.get(nodeId)?.data?.name || nodeId,
        nodeId,
        status: result?.status || null,
        message: result?.message || null,
        log: result?.log || null,
        output: result?.output || null,
        stderr: result?.stderr || null,
        stdout: result?.stdout || null,
        testSummary: result?.testSummary || null,
        securityResults: result?.securityResults || null,
        artifacts: result?.artifacts || null
    }, null, 2));

    const sections = [];
    if (String(runnerLogText || '').trim()) {
        sections.push(String(runnerLogText).trim());
    }
    if (serializedResults.length > 0) {
        sections.push(serializedResults.join('\n\n====================\n\n'));
    }

    return {
        sourceCount: sourceNames.length,
        sourceNames: sourceNames.length > 0 ? sourceNames : ['Full runner log'],
        logText: sections.join('\n\n====================\n\n').trim()
    };
}

function getAILogSummaryContext(node, upstreamNodes, resultsByNodeId = {}) {
    if (window.visualEditor && typeof window.visualEditor._buildAILogSummaryContext === 'function') {
        return window.visualEditor._buildAILogSummaryContext(node, upstreamNodes, resultsByNodeId);
    }

    return buildFallbackAILogSummaryContext(upstreamNodes, resultsByNodeId);
}

function getAILogSummarySystemPrompt() {
    if (window.visualEditor && typeof window.visualEditor._getAILogSummarySystemPrompt === 'function') {
        return window.visualEditor._getAILogSummarySystemPrompt();
    }

    return 'Summarize the execution logs, explain failures clearly, and suggest fixes. Do not invent missing details.';
}

function buildAILogSummaryPrompt(node, logContext) {
    if (window.visualEditor && typeof window.visualEditor._buildAILogSummaryPrompt === 'function') {
        return window.visualEditor._buildAILogSummaryPrompt(node, logContext);
    }

    const instructions = node?.data?.instructions || 'Summarize the execution logs and explain failures.';
    return `${instructions}\n\n${logContext.logText}`;
}

function showAILogSummaryOutput(node, summaryText, options = {}) {
    if (window.visualEditor && typeof window.visualEditor.showAILogSummaryOutput === 'function') {
        window.visualEditor.showAILogSummaryOutput(node, summaryText, options);
    }
}

function getFirstNonEmptyString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
            return value;
        }
    }
    return '';
}

function stripMarkdownCodeFences(text) {
    if (typeof text !== 'string') {
        return text == null ? '' : String(text);
    }

    return text
        .replace(/^```[a-zA-Z0-9_-]*\s*/, '')
        .replace(/\s*```$/, '')
        .trim();
}

function getCodeLanguageExtension(language) {
    switch (String(language || '').toLowerCase()) {
        case 'html':
            return 'html';
        case 'css':
            return 'css';
        case 'javascript':
        case 'js':
            return 'js';
        case 'typescript':
        case 'ts':
            return 'ts';
        case 'python':
        case 'py':
            return 'py';
        case 'java':
            return 'java';
        case 'go':
            return 'go';
        case 'rust':
        case 'rs':
            return 'rs';
        case 'json':
            return 'json';
        default:
            return 'txt';
    }
}

function getDefaultGeneratedFilename(language) {
    switch (String(language || '').toLowerCase()) {
        case 'html':
            return 'index.html';
        case 'css':
            return 'styles.css';
        case 'javascript':
        case 'js':
            return 'script.js';
        case 'typescript':
        case 'ts':
            return 'script.ts';
        case 'python':
        case 'py':
            return 'main.py';
        case 'java':
            return 'Main.java';
        case 'go':
            return 'main.go';
        case 'rust':
        case 'rs':
            return 'main.rs';
        case 'json':
            return 'data.json';
        default:
            return `output.${getCodeLanguageExtension(language)}`;
    }
}

function isAbsoluteFilePath(filePath) {
    if (typeof filePath !== 'string' || !filePath) return false;
    return /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\') || filePath.startsWith('/');
}

function joinFilePath(baseDir, filePath) {
    if (!filePath) return baseDir || '';
    if (!baseDir || isAbsoluteFilePath(filePath)) return filePath;

    const separator = baseDir.includes('\\') ? '\\' : '/';
    const normalizedBase = String(baseDir).replace(/[\\/]+$/, '');
    const normalizedPath = String(filePath)
        .replace(/^[\\/]+/, '')
        .replace(/[\\/]+/g, separator);

    return `${normalizedBase}${separator}${normalizedPath}`;
}

function buildCodeReviewSystemPrompt(mode, language) {
    if (mode === 'review') {
        return `You are a code reviewer. The user will give you ${language} code and describe changes they want. Return ONLY the complete modified code. No markdown fences. No explanations. Just the raw code.`;
    }

    return `You are a code generator. Generate ${language} code based on the user's description. Return ONLY the complete code. No markdown fences. No explanations. Just the raw code.`;
}

async function requestAutomatedCodeReview(config, prompt, currentCode) {
    if (!window.electronAPI?.aiOps?.generate) {
        throw new Error('AI generation API is not available.');
    }

    const mode = config.mode || 'review';
    const language = config.language || 'html';
    const systemPrompt = buildCodeReviewSystemPrompt(mode, language);
    const baseCode = typeof currentCode === 'string' ? currentCode : '';
    const promptText = typeof prompt === 'string' ? prompt.trim() : '';

    const userPrompt = mode === 'review' || baseCode.trim()
        ? `${promptText}\n\nHere is the current code:\n${baseCode}`
        : promptText;

    const response = await window.electronAPI.aiOps.generate({
        provider: config.provider || 'google',
        model: config.model || 'gemini-2.0-flash',
        apiKey: config.apiKey || '',
        systemPrompt,
        prompt: userPrompt,
        maxTokens: 8192
    });

    return stripMarkdownCodeFences(response?.generatedText || response?.text || response);
}

function resolveCodeReviewSource(node, inputs = {}) {
    return getFirstNonEmptyString(
        inputs.finalCode,
        inputs.lastGeneratedCode,
        inputs.sourceCode,
        node?.data?.lastGeneratedCode,
        node?.data?.sourceCode
    );
}

function buildCodeReviewHistoryEntry(prompt, originalCode, suggestedCode, status = 'accepted', automated = false) {
    return {
        prompt,
        originalCode,
        suggestedCode,
        timestamp: new Date().toISOString(),
        status,
        automated
    };
}

async function persistCodeReviewResult(node, result, options = {}) {
    const finalCode = typeof result?.finalCode === 'string' ? result.finalCode : '';
    const history = Array.isArray(result?.history) ? result.history : [];
    const prompt = typeof result?.prompt === 'string' ? result.prompt : '';
    const language = result?.language || node?.data?.language || 'html';

    node.data.sourceCode = finalCode;
    node.data.lastGeneratedCode = finalCode;
    node.data.language = language;
    node.data.history = history;
    node.data.lastPrompt = prompt;
    node.data.lastGeneratedAt = new Date().toISOString();

    const configuredOutputPath = typeof node?.data?.outputPath === 'string' ? node.data.outputPath.trim() : '';
    if (!configuredOutputPath || !window.electronAPI?.fileOps?.writeFile) {
        if (window.visualEditor?.render) window.visualEditor.render();
        if (window.visualEditor?._commitHistoryState) window.visualEditor._commitHistoryState();
        return { savedFilePath: '', configuredOutputPath };
    }

    const resolvedPath = joinFilePath(options.baseDir || '', configuredOutputPath);
    await window.electronAPI.fileOps.writeFile(resolvedPath, finalCode);
    if (window.visualEditor?.render) window.visualEditor.render();
    if (window.visualEditor?._commitHistoryState) window.visualEditor._commitHistoryState();
    return { savedFilePath: resolvedPath, configuredOutputPath };
}

function collectDownstreamDeployNodes(nodeId, graphIndex) {
    const visited = new Set();
    const queue = [...(graphIndex?.outgoing?.get(nodeId) || [])];
    const deployNodes = [];

    while (queue.length > 0) {
        const currentId = queue.shift();
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        const currentNode = graphIndex?.nodeById?.get(currentId);
        if (!currentNode) continue;

        const currentType = normalizeGraphNodeType(currentNode?.type || currentNode?.data?.type);
        if (currentType === 'push-deploy' || currentType === 'deployment') {
            deployNodes.push(currentNode);
        }

        const nextIds = graphIndex?.outgoing?.get(currentId) || [];
        nextIds.forEach(nextId => {
            if (!visited.has(nextId)) {
                queue.push(nextId);
            }
        });
    }

    return deployNodes;
}

function getParentDirectory(filePath) {
    const normalizedPath = String(filePath || '').replace(/[\\/]+$/, '');
    const lastSeparatorIndex = Math.max(normalizedPath.lastIndexOf('/'), normalizedPath.lastIndexOf('\\'));
    return lastSeparatorIndex >= 0 ? normalizedPath.slice(0, lastSeparatorIndex) : '';
}

function toFileUrl(filePath) {
    const normalizedPath = String(filePath || '').replace(/\\/g, '/');
    if (/^[A-Za-z]:\//.test(normalizedPath)) {
        return `file:///${encodeURI(normalizedPath)}`;
    }
    return `file://${encodeURI(normalizedPath)}`;
}

function parseWebsiteUXRouteList(value) {
    const routes = String(value || '')
        .split(/\r?\n|,/)
        .map(route => route.trim())
        .filter(Boolean);

    if (routes.length === 0) {
        return ['/'];
    }

    return Array.from(new Set(routes));
}

function parseWebsiteUXScenarioDefinitions(rawValue) {
    const trimmed = String(rawValue || '').trim();
    if (!trimmed) {
        return { scenarios: [], error: '' };
    }

    try {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed)) {
            return { scenarios: [], error: 'Custom path scenarios must be a JSON array.' };
        }

        const scenarios = parsed.map((scenario, index) => ({
            name: String(scenario?.name || `Scenario ${index + 1}`),
            category: String(scenario?.category || 'custom'),
            path: String(scenario?.path || '/'),
            description: String(scenario?.description || ''),
            actions: Array.isArray(scenario?.actions) ? scenario.actions : []
        }));

        return { scenarios, error: '' };
    } catch (error) {
        return { scenarios: [], error: `Custom path scenarios JSON is invalid: ${error.message}` };
    }
}

async function resolveWebsiteUXSourceDescriptor(config = {}, inputs = {}) {
    const sourceMode = String(config.sourceMode || 'auto').trim().toLowerCase();
    const websiteUrl = getFirstNonEmptyString(config.websiteUrl, inputs.websiteUrl, inputs.deployedUrl, '');
    const repoPath = getFirstNonEmptyString(inputs.repoPath, inputs.workingDirectory, '');
    const savedFilePath = getFirstNonEmptyString(inputs.savedFilePath, '');
    const finalCode = getFirstNonEmptyString(inputs.finalCode, inputs.lastGeneratedCode, inputs.sourceCode, '');
    const entryFilePath = String(config.entryFilePath || inputs.savedOutputRelativePath || 'index.html').trim() || 'index.html';

    const buildCandidates = () => {
        const candidates = [];

        if (savedFilePath) {
            candidates.push({
                id: 'upstream-output',
                kind: 'file',
                filePath: savedFilePath,
                entryUrl: toFileUrl(savedFilePath),
                label: savedFilePath
            });
        }

        if (repoPath) {
            const resolvedRepoFilePath = joinFilePath(repoPath, entryFilePath);
            candidates.push({
                id: 'repo-file',
                kind: 'file',
                repoPath,
                filePath: resolvedRepoFilePath,
                entryUrl: toFileUrl(resolvedRepoFilePath),
                label: resolvedRepoFilePath
            });
        }

        if (finalCode) {
            candidates.push({
                id: 'inline-html',
                kind: 'inline-html',
                html: finalCode,
                label: 'Inline generated HTML'
            });
        }

        if (websiteUrl) {
            candidates.push({
                id: 'live-url',
                kind: 'url',
                entryUrl: websiteUrl,
                label: websiteUrl
            });
        }

        return candidates;
    };

    const verifyCandidate = async (candidate) => {
        if (!candidate || candidate.kind !== 'file' || !window.electronAPI?.fileOps?.readFile) {
            return candidate;
        }

        await window.electronAPI.fileOps.readFile(candidate.filePath);
        return candidate;
    };

    const candidates = buildCandidates();
    if (sourceMode === 'auto') {
        for (const candidate of candidates) {
            try {
                return await verifyCandidate(candidate);
            } catch (error) {
                continue;
            }
        }

        throw new Error('No website source was available. Connect a Website Iteration or Git Repo node upstream, save generated output to a file, or provide a live URL.');
    }

    if (sourceMode === 'upstream-output') {
        if (savedFilePath) {
            return verifyCandidate({
                id: 'upstream-output',
                kind: 'file',
                filePath: savedFilePath,
                entryUrl: toFileUrl(savedFilePath),
                label: savedFilePath
            });
        }
        if (finalCode) {
            return {
                id: 'upstream-output',
                kind: 'inline-html',
                html: finalCode,
                label: 'Inline generated HTML'
            };
        }
        throw new Error('Upstream output mode requires generated website code or a saved output file from the connected Website Iteration node.');
    }

    const requestedCandidate = candidates.find(candidate => candidate.id === sourceMode);
    if (!requestedCandidate) {
        if (sourceMode === 'repo-file') {
            throw new Error('Repo file mode requires an upstream Git Repo node or repo path artifact.');
        }
        if (sourceMode === 'live-url') {
            throw new Error('Live URL mode requires a website URL in the node configuration.');
        }
        throw new Error(`Unsupported website UX source mode: ${sourceMode}`);
    }

    return verifyCandidate(requestedCandidate);
}

function buildWebsiteUXAutoTestScript(plan) {
    const serializedPlan = JSON.stringify(plan);
    return `
const { chromium } = require('playwright');

(async () => {
  const plan = ${serializedPlan};
  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      kind: plan.source.kind,
      label: plan.source.label || '',
      mode: plan.source.mode || ''
    },
    viewport: plan.viewport,
    pathAudits: [],
    customScenarios: [],
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    warnings: [],
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      warnings: 0
    }
  };

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: plan.viewport });
  const runtimeEvents = {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: []
  };
  const clickableSelector = 'a[href], button, [role="button"], input[type="button"], input[type="submit"]';

  page.on('console', msg => {
    if (msg.type() === 'error') {
      runtimeEvents.consoleErrors.push({
        text: msg.text(),
        at: new Date().toISOString()
      });
    }
  });

  page.on('pageerror', error => {
    runtimeEvents.pageErrors.push({
      message: String(error && error.message ? error.message : error),
      at: new Date().toISOString()
    });
  });

  page.on('requestfailed', request => {
    const failure = request.failure ? request.failure() : null;
    runtimeEvents.requestFailures.push({
      url: request.url(),
      errorText: failure && failure.errorText ? failure.errorText : 'unknown',
      at: new Date().toISOString()
    });
  });

  function buildInlineUrl(html) {
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  }

  const entryUrl = plan.source.kind === 'inline-html'
    ? buildInlineUrl(plan.source.html || '')
    : plan.source.entryUrl;

  function snapshotEventCounts() {
    return {
      consoleErrors: runtimeEvents.consoleErrors.length,
      pageErrors: runtimeEvents.pageErrors.length,
      requestFailures: runtimeEvents.requestFailures.length
    };
  }

  function getNewEvents(before) {
    return {
      consoleErrors: runtimeEvents.consoleErrors.slice(before.consoleErrors),
      pageErrors: runtimeEvents.pageErrors.slice(before.pageErrors),
      requestFailures: runtimeEvents.requestFailures.slice(before.requestFailures)
    };
  }

  function resolveTargetUrl(routePath) {
    const normalizedRoute = String(routePath || '').trim();
    if (!normalizedRoute || normalizedRoute === '/') {
      return entryUrl;
    }

    if (plan.source.kind === 'inline-html') {
      report.warnings.push('Inline HTML source can only be tested as a single page. Additional route paths were treated as the root page.');
      return entryUrl;
    }

    if (plan.source.kind === 'file') {
      return new URL(normalizedRoute.replace(/^\\/+/, ''), entryUrl).toString();
    }

    return new URL(normalizedRoute, entryUrl).toString();
  }

  async function gotoRoute(routePath) {
    const targetUrl = resolveTargetUrl(routePath);
    const response = await page.goto(targetUrl, { waitUntil: 'load' });
    await page.waitForTimeout(plan.waitAfterActionMs);
    return {
      targetUrl,
      responseStatus: response ? response.status() : null,
      title: await page.title()
    };
  }

  async function discoverVisibleInteractions(limit) {
    return page.evaluate(({ selector, limit }) => {
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.visibility !== 'hidden'
          && style.display !== 'none';
      };

      return Array.from(document.querySelectorAll(selector))
        .map((element, domIndex) => {
          const text = normalize(element.innerText || element.textContent || '');
          const ariaLabel = normalize(element.getAttribute('aria-label') || element.getAttribute('title') || '');
          const href = element.getAttribute('href') || '';
          const id = element.getAttribute('id') || '';
          const label = text || ariaLabel || href || (element.tagName.toLowerCase() + ' #' + domIndex);
          return {
            domIndex,
            tag: element.tagName.toLowerCase(),
            text,
            ariaLabel,
            href,
            id,
            disabled: Boolean(element.disabled),
            visible: isVisible(element),
            label
          };
        })
        .filter(candidate => candidate.visible)
        .slice(0, limit);
    }, { selector: clickableSelector, limit });
  }

  async function resolveLocator(action) {
    if (action.selector) {
      return page.locator(action.selector).first();
    }
    if (action.text) {
      return page.getByText(String(action.text), { exact: false }).first();
    }
    throw new Error('Action requires either "selector" or "text".');
  }

  async function executeScenarioAction(action) {
    const normalizedType = String(action.type || '').trim().toLowerCase();

    if (normalizedType === 'click') {
      const locator = await resolveLocator(action);
      await locator.click({ timeout: 5000 });
      return 'Clicked target';
    }

    if (normalizedType === 'fill') {
      if (!action.selector) throw new Error('Fill actions require a selector.');
      await page.locator(action.selector).first().fill(String(action.value || ''));
      return 'Filled input';
    }

    if (normalizedType === 'press') {
      if (!action.selector) throw new Error('Press actions require a selector.');
      await page.locator(action.selector).first().press(String(action.key || 'Enter'));
      return 'Pressed key';
    }

    if (normalizedType === 'wait') {
      await page.waitForTimeout(Math.max(0, Number(action.ms) || plan.waitAfterActionMs));
      return 'Waited';
    }

    if (normalizedType === 'asserttext') {
      if (!action.selector) throw new Error('assertText actions require a selector.');
      const textContent = await page.locator(action.selector).first().textContent();
      if (!String(textContent || '').includes(String(action.text || ''))) {
        throw new Error('Expected text was not found.');
      }
      return 'Text assertion passed';
    }

    if (normalizedType === 'assertvisible') {
      if (!action.selector) throw new Error('assertVisible actions require a selector.');
      const isVisible = await page.locator(action.selector).first().isVisible();
      if (!isVisible) {
        throw new Error('Expected element to be visible.');
      }
      return 'Visibility assertion passed';
    }

    if (normalizedType === 'assertnotvisible') {
      if (!action.selector) throw new Error('assertNotVisible actions require a selector.');
      const isVisible = await page.locator(action.selector).first().isVisible().catch(() => false);
      if (isVisible) {
        throw new Error('Expected element to remain hidden.');
      }
      return 'Hidden-state assertion passed';
    }

    if (normalizedType === 'asserturlincludes') {
      if (!page.url().includes(String(action.value || ''))) {
        throw new Error('Current URL does not include the expected value.');
      }
      return 'URL assertion passed';
    }

    if (normalizedType === 'asserturlnotincludes') {
      if (page.url().includes(String(action.value || ''))) {
        throw new Error('Current URL unexpectedly included the blocked value.');
      }
      return 'Negative URL assertion passed';
    }

    if (normalizedType === 'assertcountatleast') {
      if (!action.selector) throw new Error('assertCountAtLeast actions require a selector.');
      const count = await page.locator(action.selector).count();
      if (count < Math.max(1, Number(action.value) || 1)) {
        throw new Error('Expected more matching elements.');
      }
      return 'Count assertion passed';
    }

    throw new Error('Unsupported action type: ' + normalizedType);
  }

  function finalizeScenarioStatus(scenario, newEvents) {
    scenario.consoleErrors = newEvents.consoleErrors;
    scenario.pageErrors = newEvents.pageErrors;
    scenario.requestFailures = newEvents.requestFailures;

    if (plan.failOnConsoleErrors && newEvents.consoleErrors.length > 0) {
      scenario.status = 'failed';
    }
    if (plan.failOnPageErrors && newEvents.pageErrors.length > 0) {
      scenario.status = 'failed';
    }
    if (scenario.status !== 'failed' && scenario.actions.some(action => action.status === 'warning')) {
      scenario.status = 'warning';
    }
  }

  async function runAutomaticPathAudit(routePath) {
    const scenario = {
      name: 'Automatic UX audit: ' + routePath,
      category: 'auto',
      path: routePath,
      status: 'passed',
      actions: [],
      discovered: []
    };
    const beforeEvents = snapshotEventCounts();

    try {
      const navigation = await gotoRoute(routePath);
      scenario.navigation = navigation;
      if (navigation.responseStatus && navigation.responseStatus >= 400) {
        scenario.status = 'failed';
        scenario.actions.push({
          label: 'Initial navigation',
          status: 'failed',
          message: 'Route returned HTTP ' + navigation.responseStatus
        });
      }

      const candidates = await discoverVisibleInteractions(plan.maxAutoInteractions);
      scenario.discovered = candidates.map(candidate => ({
        label: candidate.label,
        tag: candidate.tag,
        href: candidate.href || ''
      }));

      for (const candidate of candidates) {
        const action = {
          label: candidate.label,
          status: 'passed',
          message: ''
        };

        if (candidate.disabled) {
          action.status = 'warning';
          action.message = 'Element is disabled.';
          scenario.actions.push(action);
          continue;
        }

        if (/^(mailto:|tel:|javascript:)/i.test(String(candidate.href || ''))) {
          action.status = 'warning';
          action.message = 'Skipped special protocol interaction.';
          scenario.actions.push(action);
          continue;
        }

        try {
          await gotoRoute(routePath);
          const locator = page.locator(clickableSelector).nth(candidate.domIndex);
          await locator.scrollIntoViewIfNeeded().catch(() => {});
          await locator.click({ timeout: 5000 });
          await page.waitForTimeout(plan.waitAfterActionMs);
          action.message = page.url() !== navigation.targetUrl
            ? 'Interaction changed the current URL.'
            : 'Interaction completed without throwing an error.';
          action.afterUrl = page.url();
        } catch (error) {
          action.status = 'failed';
          action.message = error.message;
          scenario.status = 'failed';
          if (!plan.continueOnFailure) {
            scenario.actions.push(action);
            break;
          }
        }

        scenario.actions.push(action);
      }
    } catch (error) {
      scenario.status = 'failed';
      scenario.actions.push({
        label: 'Initial navigation',
        status: 'failed',
        message: error.message
      });
    }

    finalizeScenarioStatus(scenario, getNewEvents(beforeEvents));
    return scenario;
  }

  async function runCustomScenario(definition, index) {
    const scenario = {
      name: definition.name || ('Scenario ' + (index + 1)),
      category: definition.category || 'custom',
      path: definition.path || '/',
      description: definition.description || '',
      status: 'passed',
      actions: []
    };
    const beforeEvents = snapshotEventCounts();

    try {
      const navigation = await gotoRoute(scenario.path);
      scenario.navigation = navigation;
      if (navigation.responseStatus && navigation.responseStatus >= 400) {
        scenario.status = 'failed';
        scenario.actions.push({
          label: 'Initial navigation',
          status: 'failed',
          message: 'Route returned HTTP ' + navigation.responseStatus
        });
      }

      for (const rawAction of definition.actions || []) {
        const actionLabel = rawAction.label || rawAction.selector || rawAction.text || rawAction.type || 'action';
        const actionResult = {
          label: actionLabel,
          type: rawAction.type || 'unknown',
          status: 'passed',
          message: ''
        };

        try {
          actionResult.message = await executeScenarioAction(rawAction);
          await page.waitForTimeout(Math.max(0, Number(rawAction.waitAfterMs) || plan.waitAfterActionMs));
        } catch (error) {
          actionResult.status = 'failed';
          actionResult.message = error.message;
          scenario.status = 'failed';
          scenario.actions.push(actionResult);
          if (!plan.continueOnFailure) {
            break;
          }
          continue;
        }

        scenario.actions.push(actionResult);
      }
    } catch (error) {
      scenario.status = 'failed';
      scenario.actions.push({
        label: 'Scenario setup',
        status: 'failed',
        message: error.message
      });
    }

    finalizeScenarioStatus(scenario, getNewEvents(beforeEvents));
    return scenario;
  }

  if (plan.autoExplore) {
    for (const routePath of plan.routePaths) {
      report.pathAudits.push(await runAutomaticPathAudit(routePath));
      if (!plan.continueOnFailure && report.pathAudits.some(scenario => scenario.status === 'failed')) {
        break;
      }
    }
  } else {
    report.warnings.push('Automatic interaction discovery was disabled. Only custom scenarios were executed.');
  }

  if (plan.continueOnFailure || report.pathAudits.every(scenario => scenario.status !== 'failed')) {
    for (let index = 0; index < plan.customScenarios.length; index += 1) {
      report.customScenarios.push(await runCustomScenario(plan.customScenarios[index], index));
      if (!plan.continueOnFailure && report.customScenarios.some(scenario => scenario.status === 'failed')) {
        break;
      }
    }
  }

  report.consoleErrors = runtimeEvents.consoleErrors;
  report.pageErrors = runtimeEvents.pageErrors;
  report.requestFailures = runtimeEvents.requestFailures;

  const allScenarios = report.pathAudits.concat(report.customScenarios);
  report.summary.total = allScenarios.length;
  report.summary.passed = allScenarios.filter(scenario => scenario.status === 'passed').length;
  report.summary.failed = allScenarios.filter(scenario => scenario.status === 'failed').length;
  report.summary.warnings = allScenarios.filter(scenario => scenario.status === 'warning').length;

  await browser.close();

  console.log('__LVX_UX_REPORT_START__');
  console.log(JSON.stringify(report));
  console.log('__LVX_UX_REPORT_END__');

  if (report.summary.failed > 0) {
    process.exit(1);
  }
})().catch(async (error) => {
  console.error(error && error.stack ? error.stack : String(error));
  const failureReport = {
    generatedAt: new Date().toISOString(),
    fatalError: String(error && error.message ? error.message : error),
    summary: {
      total: 0,
      passed: 0,
      failed: 1,
      warnings: 0
    }
  };
  console.log('__LVX_UX_REPORT_START__');
  console.log(JSON.stringify(failureReport));
  console.log('__LVX_UX_REPORT_END__');
  process.exit(1);
});
`;
}

function parseWebsiteUXReport(logText) {
    const normalizedLog = typeof logText === 'string' ? logText : '';
    const match = normalizedLog.match(/__LVX_UX_REPORT_START__\s*([\s\S]*?)\s*__LVX_UX_REPORT_END__/);
    if (!match) {
        return null;
    }

    try {
        return JSON.parse(match[1]);
    } catch (error) {
        return null;
    }
}

function formatWebsiteUXReport(node, report = {}, runtime = {}) {
    const lines = [];
    const nodeName = node?.data?.name || 'Website UX Auto Tester';
    const sourceLabel = runtime.sourceLabel || report?.source?.label || 'Unknown source';
    const pathAudits = Array.isArray(report?.pathAudits) ? report.pathAudits : [];
    const customScenarios = Array.isArray(report?.customScenarios) ? report.customScenarios : [];
    const allScenarios = pathAudits.concat(customScenarios);

    lines.push(`# Website UX Auto Tester Report`);
    lines.push('');
    lines.push(`Node: ${nodeName}`);
    lines.push(`Generated: ${report?.generatedAt || new Date().toISOString()}`);
    lines.push(`Source: ${sourceLabel}`);
    lines.push(`Viewport: ${runtime.viewportWidth || report?.viewport?.width || 1440}x${runtime.viewportHeight || report?.viewport?.height || 900}`);
    lines.push('');
    lines.push(`## Summary`);
    lines.push(`- Scenarios run: ${report?.summary?.total ?? allScenarios.length}`);
    lines.push(`- Passed: ${report?.summary?.passed ?? 0}`);
    lines.push(`- Failed: ${report?.summary?.failed ?? 0}`);
    lines.push(`- Warnings: ${report?.summary?.warnings ?? 0}`);
    lines.push(`- Console errors captured: ${Array.isArray(report?.consoleErrors) ? report.consoleErrors.length : 0}`);
    lines.push(`- Page errors captured: ${Array.isArray(report?.pageErrors) ? report.pageErrors.length : 0}`);
    lines.push(`- Request failures captured: ${Array.isArray(report?.requestFailures) ? report.requestFailures.length : 0}`);
    lines.push('');

    if (Array.isArray(report?.warnings) && report.warnings.length > 0) {
        lines.push(`## Warnings`);
        report.warnings.forEach(warning => {
            lines.push(`- ${warning}`);
        });
        lines.push('');
    }

    allScenarios.forEach((scenario, index) => {
        lines.push(`## Scenario ${index + 1}: ${scenario.name || 'Unnamed Scenario'}`);
        lines.push(`- Category: ${scenario.category || 'custom'}`);
        lines.push(`- Path: ${scenario.path || '/'}`);
        lines.push(`- Status: ${scenario.status || 'unknown'}`);
        if (scenario.navigation?.targetUrl) {
            lines.push(`- Target URL: ${scenario.navigation.targetUrl}`);
        }
        if (scenario.navigation?.responseStatus) {
            lines.push(`- Response status: ${scenario.navigation.responseStatus}`);
        }
        if (scenario.navigation?.title) {
            lines.push(`- Page title: ${scenario.navigation.title}`);
        }

        if (Array.isArray(scenario.discovered) && scenario.discovered.length > 0) {
            lines.push(`- Discovered interactions:`);
            scenario.discovered.forEach(candidate => {
                lines.push(`  - ${candidate.label}${candidate.href ? ` (${candidate.href})` : ''}`);
            });
        }

        if (Array.isArray(scenario.actions) && scenario.actions.length > 0) {
            lines.push(`- Actions:`);
            scenario.actions.forEach(action => {
                lines.push(`  - [${action.status || 'unknown'}] ${action.label || action.type || 'action'}: ${action.message || ''}`.trim());
            });
        }

        if (Array.isArray(scenario.consoleErrors) && scenario.consoleErrors.length > 0) {
            lines.push(`- Console errors:`);
            scenario.consoleErrors.forEach(error => {
                lines.push(`  - ${error.text || error.message || JSON.stringify(error)}`);
            });
        }

        if (Array.isArray(scenario.pageErrors) && scenario.pageErrors.length > 0) {
            lines.push(`- Page errors:`);
            scenario.pageErrors.forEach(error => {
                lines.push(`  - ${error.message || JSON.stringify(error)}`);
            });
        }

        if (Array.isArray(scenario.requestFailures) && scenario.requestFailures.length > 0) {
            lines.push(`- Request failures:`);
            scenario.requestFailures.forEach(error => {
                lines.push(`  - ${error.url || 'request'} :: ${error.errorText || 'unknown error'}`);
            });
        }

        lines.push('');
    });

    return lines.join('\n').trim();
}

async function persistWebsiteUXReport(node, reportText, runtime = {}) {
    node.data.lastUXReport = reportText;
    node.data.lastUXReportAt = new Date().toISOString();
    node.data.lastUXSource = runtime.sourceLabel || '';

    const configuredPath = String(node?.data?.reportPath || '').trim();
    if (!configuredPath || !window.electronAPI?.fileOps?.writeFile) {
        if (window.visualEditor?.render) window.visualEditor.render();
        if (window.visualEditor?._commitHistoryState) window.visualEditor._commitHistoryState();
        return '';
    }

    const baseDir = getFirstNonEmptyString(
        runtime.repoPath,
        getParentDirectory(runtime.sourceFilePath),
        ''
    );
    const resolvedPath = joinFilePath(baseDir, configuredPath);
    await window.electronAPI.fileOps.writeFile(resolvedPath, reportText);

    if (window.visualEditor?.render) window.visualEditor.render();
    if (window.visualEditor?._commitHistoryState) window.visualEditor._commitHistoryState();
    return resolvedPath;
}

function resolveDeployCodeArtifact(inputs = {}, node = null) {
    const finalCode = getFirstNonEmptyString(
        inputs.finalCode,
        inputs.lastGeneratedCode,
        inputs.sourceCode,
        node?.data?.lastGeneratedCode,
        node?.data?.sourceCode
    );
    const language = getFirstNonEmptyString(
        inputs.language,
        node?.data?.language,
        'html'
    );

    return {
        finalCode,
        language,
        prompt: getFirstNonEmptyString(inputs.prompt, node?.data?.lastPrompt),
        savedOutputRelativePath: getFirstNonEmptyString(inputs.savedOutputRelativePath, node?.data?.outputPath)
    };
}

async function executePushDeployNode(node, inputs = {}, options = {}) {
    const logs = [];
    const inheritedDeployedNodeIds = Array.isArray(inputs.deployedNodeIds) ? inputs.deployedNodeIds : [];
    const deployedNodeIds = new Set(inheritedDeployedNodeIds);
    const pushLog = typeof options.log === 'function'
        ? (message) => {
            logs.push(message);
            options.log(message);
        }
        : (message) => logs.push(message);

    if (deployedNodeIds.has(node.id)) {
        pushLog('Deployment already executed earlier in this run; skipping duplicate step.');
        return {
            status: 'SUCCESS',
            message: 'Deployment already completed',
            artifacts: {
                logs,
                deployedNodeIds: Array.from(deployedNodeIds)
            }
        };
    }

    const trigger = node.data.trigger || 'git-push';
    const repoUrl = (node.data.repoUrl || '').trim();
    const branch = (node.data.branch || 'main').trim() || 'main';
    const branchMissingPolicy = (node.data.branchMissingPolicy || 'fail').trim() || 'fail';
    const branchBase = (node.data.branchBase || 'main').trim() || 'main';
    const token = (node.data.authToken || node.data.token || '').trim();
    const commitMessageTemplate = node.data.commitMessage || 'Deploy from LVX-Machina {date}';
    const commitMessage = commitMessageTemplate.replace('{date}', new Date().toISOString());
    const commandOrUrl = (node.data.command || node.data.customCommand || '').trim();

    try {
        if (trigger === 'git-push') {
            const artifact = resolveDeployCodeArtifact(inputs, node);
            const existingRepoPath = getFirstNonEmptyString(inputs.repoPath, inputs.workingDirectory, '');
            if (!artifact.finalCode) {
                throw new Error('No generated code was available to deploy.');
            }
            if (!repoUrl && !existingRepoPath) {
                throw new Error('Repository URL is required for Git push deployment.');
            }
            if (!window.electronAPI?.gitCommitAndPush || !window.electronAPI?.fileOps?.writeFile) {
                throw new Error('Git deployment APIs are not available.');
            }

            let workingDir = existingRepoPath;
            let tempDir = '';
            let tempDirCleanupPath = '';
            let branchCreatedForDeploy = false;
            let branchBaseUsedForDeploy = branchBase;

            if (!workingDir) {
                if (!window.electronAPI?.gitCloneToTemp) {
                    throw new Error('Git clone API is not available.');
                }

                pushLog(`Cloning ${repoUrl} (${branch})...`);
                const tempCloneResult = await window.electronAPI.gitCloneToTemp({
                    url: repoUrl,
                    branch,
                    auth: { type: 'token', token },
                    branchMissingPolicy,
                    branchBase
                });
                tempDir = typeof tempCloneResult === 'string' ? tempCloneResult : tempCloneResult?.path;
                tempDirCleanupPath = typeof tempCloneResult === 'object' ? (tempCloneResult.cleanupPath || tempDir) : tempDir;
                workingDir = tempDir;
                branchCreatedForDeploy = Boolean(tempCloneResult?.branchCreated);
                branchBaseUsedForDeploy = tempCloneResult?.baseBranchUsed || branchBase;
                if (tempCloneResult?.branchCreated) {
                    pushLog(`Branch ${branch} did not exist. Created a working branch from ${branchBaseUsedForDeploy}.`);
                }
            } else {
                pushLog(`Using upstream repository checkout: ${workingDir}`);
            }

            try {
                const relativeTargetPath = (node.data.targetFilePath || artifact.savedOutputRelativePath || getDefaultGeneratedFilename(artifact.language)).trim();
                const absoluteTargetPath = joinFilePath(workingDir, relativeTargetPath);

                await window.electronAPI.fileOps.writeFile(absoluteTargetPath, artifact.finalCode);
                pushLog(`Wrote generated code to ${relativeTargetPath}`);

                const pushResult = await window.electronAPI.gitCommitAndPush({
                    dir: workingDir,
                    message: commitMessage,
                    branch,
                    auth: { type: 'token', token },
                    remoteUrl: repoUrl
                });

                deployedNodeIds.add(node.id);

                if (pushResult.pushed) {
                    pushLog(`Pushed changes to ${branch}`);
                } else {
                    pushLog(pushResult.reason || 'No changes to push');
                }

                return {
                    status: 'SUCCESS',
                    message: pushResult.pushed ? `Deployed to ${repoUrl}` : (pushResult.reason || 'No changes to deploy'),
                    artifacts: {
                        logs,
                        repoUrl,
                        branch,
                        branchMissingPolicy,
                        branchBase,
                        branchCreated: branchCreatedForDeploy,
                        branchBaseUsed: branchBaseUsedForDeploy,
                        targetFilePath: relativeTargetPath,
                        finalCode: artifact.finalCode,
                        language: artifact.language,
                        deployedNodeIds: Array.from(deployedNodeIds)
                    }
                };
            } finally {
                if ((tempDirCleanupPath || tempDir) && window.electronAPI?.removeTempDirectory) {
                    await window.electronAPI.removeTempDirectory(tempDirCleanupPath || tempDir);
                }
            }
        }

        if (trigger === 'webhook') {
            if (!commandOrUrl) {
                throw new Error('Webhook URL is required for webhook deployment.');
            }

            pushLog(`Triggering webhook: ${commandOrUrl}`);
            const response = await fetch(commandOrUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trigger: 'lvx-machina',
                    timestamp: Date.now(),
                    target: node.data.target || 'production'
                })
            });

            deployedNodeIds.add(node.id);
            pushLog(`Webhook responded with status ${response.status}`);

            return {
                status: response.ok ? 'SUCCESS' : 'FAILURE',
                message: `Webhook responded with status ${response.status}`,
                artifacts: {
                    logs,
                    deployedNodeIds: Array.from(deployedNodeIds)
                }
            };
        }

        if (trigger === 'custom') {
            if (!commandOrUrl) {
                throw new Error('Custom command is required for custom deployment.');
            }
            if (!window.electronAPI?.runShellCommand) {
                throw new Error('Shell execution API is not available.');
            }

            pushLog(`Running deploy command: ${commandOrUrl}`);
            const output = await window.electronAPI.runShellCommand({ command: commandOrUrl });
            deployedNodeIds.add(node.id);
            pushLog('Custom deploy command completed');

            return {
                status: 'SUCCESS',
                message: 'Custom deploy command completed',
                artifacts: {
                    logs,
                    commandOutput: output,
                    deployedNodeIds: Array.from(deployedNodeIds)
                }
            };
        }

        throw new Error(`Unsupported deploy trigger: ${trigger}`);
    } catch (error) {
        pushLog(`ERROR: ${error.message}`);
        return {
            status: 'FAILURE',
            message: `Deploy failed: ${error.message}`,
            artifacts: {
                logs,
                error: error.message
            }
        };
    }
}

function collectReachableNodeIds(startNodeId, adjacency) {
    const visited = new Set([startNodeId]);
    const queue = [startNodeId];

    while (queue.length > 0) {
        const currentId = queue.shift();
        const neighbors = adjacency.get(currentId) || [];

        neighbors.forEach(nextId => {
            if (!visited.has(nextId)) {
                visited.add(nextId);
                queue.push(nextId);
            }
        });
    }

    return visited;
}

function buildRunnerExecutionPlan(pipeline, requestedRunnerId = null) {
    const graphIndex = buildGraphIndex(pipeline);
    const runnerNodes = graphIndex.nodes.filter(node => normalizeGraphNodeType(node.type) === 'start-runner');

    if (runnerNodes.length === 0) {
        return null;
    }

    const selectedRunners = requestedRunnerId
        ? runnerNodes.filter(node => node.id === requestedRunnerId)
        : runnerNodes;

    if (selectedRunners.length === 0) {
        return null;
    }

    const allowedNodeIds = new Set();
    const allowedEdgeKeys = new Set();
    const runnerAssignments = new Map();
    const runnerIds = new Set(runnerNodes.map(node => node.id));
    const runnerById = new Map();
    const runnerScope = new Map();
    const distanceMemo = new Map();

    const edgeKey = (sourceId, targetId) => `${sourceId}-->${targetId}`;

    const computeRunnerScope = (runnerNodeId) => {
        if (runnerScope.has(runnerNodeId)) {
            return runnerScope.get(runnerNodeId);
        }

        const runnerNode = graphIndex.nodeById.get(runnerNodeId);
        const stopNodeId = runnerNode?.data?.stopNodeId || '';
        const scopedIds = new Set([runnerNodeId]);
        const scopedEdges = new Set();
        const visited = new Set([runnerNodeId]);

        const traverse = (currentId) => {
            const nextIds = graphIndex.outgoing.get(currentId) || [];

            nextIds.forEach(nextId => {
                scopedIds.add(nextId);
                scopedEdges.add(edgeKey(currentId, nextId));

                if (nextId === stopNodeId) {
                    return;
                }

                if (runnerIds.has(nextId) && nextId !== runnerNodeId) {
                    const nestedScope = computeRunnerScope(nextId);
                    nestedScope.nodeIds.forEach(nodeId => scopedIds.add(nodeId));
                    nestedScope.edgeIds.forEach(edgeId => scopedEdges.add(edgeId));
                    return;
                }

                if (!visited.has(nextId)) {
                    visited.add(nextId);
                    traverse(nextId);
                }
            });
        };

        traverse(runnerNodeId);

        const scope = { nodeIds: scopedIds, edgeIds: scopedEdges };
        runnerScope.set(runnerNodeId, scope);
        return scope;
    };

    const collectPlanForRunner = (runnerNodeId) => {
        const scope = computeRunnerScope(runnerNodeId);
        scope.nodeIds.forEach(nodeId => {
            allowedNodeIds.add(nodeId);
            if (runnerIds.has(nodeId)) {
                runnerById.set(nodeId, graphIndex.nodeById.get(nodeId));
            }
        });
        scope.edgeIds.forEach(edgeId => allowedEdgeKeys.add(edgeId));
    };

    const getRunnerDistances = (runnerNodeId) => {
        if (distanceMemo.has(runnerNodeId)) {
            return distanceMemo.get(runnerNodeId);
        }

        const scope = computeRunnerScope(runnerNodeId);
        const distances = new Map([[runnerNodeId, 0]]);
        const queue = [runnerNodeId];

        while (queue.length > 0) {
            const currentId = queue.shift();
            const currentDistance = distances.get(currentId) || 0;
            const nextIds = graphIndex.outgoing.get(currentId) || [];

            nextIds.forEach(nextId => {
                if (!scope.nodeIds.has(nextId) || distances.has(nextId)) {
                    return;
                }

                distances.set(nextId, currentDistance + 1);
                queue.push(nextId);
            });
        }

        distanceMemo.set(runnerNodeId, distances);
        return distances;
    };

    selectedRunners.forEach(runnerNode => {
        collectPlanForRunner(runnerNode.id);
    });

    runnerById.forEach((runnerNode, runnerNodeId) => {
        runnerAssignments.set(runnerNodeId, runnerNodeId);
    });

    allowedNodeIds.forEach(nodeId => {
        if (runnerIds.has(nodeId)) {
            return;
        }

        let bestRunnerId = null;
        let bestDistance = Number.POSITIVE_INFINITY;

        runnerById.forEach((runnerNode, runnerNodeId) => {
            const scope = runnerScope.get(runnerNodeId);
            if (!scope?.nodeIds.has(nodeId)) {
                return;
            }

            const distances = getRunnerDistances(runnerNodeId);
            const distance = distances.get(nodeId);
            if (!Number.isFinite(distance)) {
                return;
            }

            if (distance < bestDistance) {
                bestDistance = distance;
                bestRunnerId = runnerNodeId;
            }
        });

        if (bestRunnerId) {
            runnerAssignments.set(nodeId, bestRunnerId);
        }
    });

    return {
        runnerById,
        runnerAssignments,
        runnerScope,
        filteredPipeline: {
            ...pipeline,
            nodes: graphIndex.nodes.filter(node => allowedNodeIds.has(node.id)),
            edges: graphIndex.edges.filter(edge => allowedEdgeKeys.has(edgeKey(edge.source, edge.target)))
        }
    };
}

function getRunnerRetryAttempts(runnerNode, nodeId) {
    const retryTargets = Array.isArray(runnerNode?.data?.retryTargets) ? runnerNode.data.retryTargets : [];
    const targetConfig = retryTargets.find(target => target && target.nodeId === nodeId);
    const attempts = parseInt(targetConfig?.attempts, 10);
    return Number.isFinite(attempts) && attempts > 0 ? attempts : 0;
}

function sanitizeLogFileName(name) {
    const fallbackName = String(name || 'start-runner-log');
    const sanitized = fallbackName
        .replace(/[<>:"/\\|?*]+/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return sanitized || 'start-runner-log';
}

function buildLogFilePath(basePath, runnerName) {
    const trimmedPath = String(basePath || '').trim();
    if (!trimmedPath) return '';

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultFileName = `${sanitizeLogFileName(runnerName)}-${timestamp}.log`;

    if (/\.(log|txt)$/i.test(trimmedPath)) {
        return trimmedPath;
    }

    const separator = trimmedPath.includes('\\') ? '\\' : '/';
    return trimmedPath.replace(/[\\/]+$/, '') + separator + defaultFileName;
}

async function writeRunnerLogs(runnerNodes, logText, allNodeResults = {}, runnerAssignments = null) {
    if (!window.electronAPI?.fileOps?.writeFile) {
        return { savedPaths: [], errors: [] };
    }

    const storagePreferences = window.storageManager?.loadStoragePreferences
        ? window.storageManager.loadStoragePreferences()
        : null;
    const savedPaths = [];
    const errors = [];

    for (const runnerNode of runnerNodes) {
        if (!runnerNode?.data?.downloadLogs || !runnerNode.data.logPath) {
            continue;
        }

        const basePath = runnerNode.data.logPath;
        const runnerName = runnerNode.data.name || 'Start Runner';

        // 1. MASTER LOG
        const masterPath = buildLogFilePath(basePath, runnerName);
        if (masterPath) {
            try {
                await window.electronAPI.fileOps.writeFile(masterPath, logText, {
                    rotateLogs: true,
                    storagePreferences
                });
                savedPaths.push(masterPath);
            } catch (error) {
                console.error('Failed to write master runner log:', error);
                errors.push({ runnerId: runnerNode.id, message: `Master Log: ${error.message}` });
            }
        }

        // 2. INDIVIDUAL LOGS (Feature 3)
        if (runnerNode.data.saveIndividualNodeLogs && runnerAssignments) {
            // Find ALL nodes assigned to THIS runner
            const runnerId = runnerNode.id;
            const assignedNodeIds = [];
            runnerAssignments.forEach((assignedRunnerId, nodeId) => {
                if (assignedRunnerId === runnerId) assignedNodeIds.push(nodeId);
            });

            if (assignedNodeIds.length > 0) {
                for (const nodeId of assignedNodeIds) {
                    const result = allNodeResults[nodeId];
                    if (!result || !result.log) continue;

                    // Build a unique path per node
                    const nodeName = result.name || nodeId;
                    const sanitizedNodeName = sanitizeLogFileName(nodeName);
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    
                    // We need a path. If basePath is a directory, we use it. If it's a file, we use its directory.
                    let dir = basePath;
                    if (basePath.endsWith('.log') || basePath.includes('.')) { // likely a file
                        dir = basePath.substring(0, Math.max(basePath.lastIndexOf('/'), basePath.lastIndexOf('\\')));
                    }
                    
                    const nodePath = `${dir}/${sanitizedNodeName}_${timestamp}.log`;

                    try {
                        await window.electronAPI.fileOps.writeFile(nodePath, result.log, {
                            rotateLogs: false, // Don't rotate individual ones unless specified
                            storagePreferences
                        });
                        savedPaths.push(nodePath);
                    } catch (error) {
                        console.error(`Failed to write individual log for node ${nodeId}:`, error);
                        errors.push({ runnerId: runnerNode.id, message: `Node ${nodeName}: ${error.message}` });
                    }
                }
            }
        }
    }

    return { savedPaths, errors };
}


// --- GRAPH PIPELINE LOGIC ---

function openVisualPipelineEditor(pipelineId = null) {
    const root = document.getElementById('visual-editor-root');
    root.classList.remove('hidden');

    // Ensure Visual Editor is initialized
    if (!window.visualEditor) {
        window.visualEditor = new window.VisualEditor('visual-editor-root');
    }
    window.visualEditor.init();

    // Populate Available Suites
    if (window.testSuites) {
        window.visualEditor.setAvailableSuites(window.testSuites);
    }

    if (pipelineId) {
        const pipeline = pipelines.find(p => p.id === pipelineId);
        if (pipeline && pipeline.type === 'graph') {
            window.visualEditor.loadGraph({ nodes: pipeline.nodes || [], edges: pipeline.edges || [] });
            window._editingGraphPipelineId = pipelineId;
        } else {
            // Pipeline exists but is not a graph type - show empty canvas
            window.visualEditor.render();
            window._editingGraphPipelineId = null;
        }
    } else {
        // New pipeline - ensure empty canvas is rendered
        window.visualEditor.render();
        window._editingGraphPipelineId = null;
    }

    // Hook Save (to current graph) - saves directly if editing, prompts if new
    window.visualEditor.onSave = (graphData) => {
        const existingId = window._editingGraphPipelineId;

        if (existingId) {
            // Editing existing pipeline - save directly without prompting for name
            const existingPipeline = pipelines.find(p => p.id === existingId);
            const pipeline = {
                id: existingId,
                name: existingPipeline ? existingPipeline.name : 'Graph Pipeline',
                type: 'graph',
                nodes: graphData.nodes,
                edges: graphData.edges,
                lastRun: existingPipeline ? existingPipeline.lastRun : null,
                lastStatus: existingPipeline ? existingPipeline.lastStatus : 'NEVER_RUN'
            };

            const idx = pipelines.findIndex(p => p.id === existingId);
            if (idx !== -1) pipelines[idx] = pipeline;

            savePipelines();
            renderPipelinesList();
            root.classList.add('hidden');
            window.showMessage("Graph Pipeline Saved", "success");
        } else {
            // New pipeline - prompt for name
            window.showInputModal("Enter Pipeline Name", "My Graph Pipeline", (name) => {
                if (!name) return;

                const id = 'pipe_graph_' + Date.now();
                const pipeline = {
                    id: id,
                    name: name,
                    type: 'graph',
                    nodes: graphData.nodes,
                    edges: graphData.edges,
                    lastRun: null,
                    lastStatus: 'NEVER_RUN'
                };

                pipelines.push(pipeline);
                window._editingGraphPipelineId = id; // Set as current editing

                savePipelines();
                renderPipelinesList();
                root.classList.add('hidden');
                window.showMessage("Graph Pipeline Created", "success");
            });
        }
    };

    // Hook Save As (always creates new graph with new name)
    window.visualEditor.onSaveAs = (graphData) => {
        window.showInputModal("Enter Name for New Pipeline", "My Graph Pipeline Copy", (name) => {
            if (!name) return;

            const id = 'pipe_graph_' + Date.now();
            const pipeline = {
                id: id,
                name: name,
                type: 'graph',
                nodes: graphData.nodes,
                edges: graphData.edges,
                lastRun: null,
                lastStatus: 'NEVER_RUN'
            };

            pipelines.push(pipeline);
            window._editingGraphPipelineId = id; // Now editing this new pipeline

            savePipelines();
            renderPipelinesList();
            root.classList.add('hidden');
            window.showMessage("Graph Pipeline Saved as New", "success");
        });
    };

    // Hook Close (Already handled by inner UI, but ensure sync)

    // Hook Run
    window.visualEditor.onRun = (graphData) => {
        const executeRun = (id, name) => {
            const pipeline = {
                id: id,
                name: name,
                type: 'graph',
                nodes: graphData.nodes,
                edges: graphData.edges,
                lastRun: null,
                lastStatus: 'NEVER_RUN'
            };

            // Update or Push
            const idx = pipelines.findIndex(p => p.id === id);
            if (idx !== -1) pipelines[idx] = pipeline;
            else pipelines.push(pipeline);

            savePipelines();
            renderPipelinesList();

            // Hide editor and run
            root.classList.add('hidden');
            runGraphPipeline(pipeline);
        };

        // Check if existing
        let id = window._editingGraphPipelineId;

        if (!id) {
            window.showInputModal("Enter Pipeline Name to Run", "My Graph Pipeline", (name) => {
                if (!name) return;
                id = 'pipe_graph_' + Date.now();
                executeRun(id, name);
            });
        } else {
            const existing = pipelines.find(p => p.id === id);
            const name = existing ? existing.name : "Graph Pipeline";
            executeRun(id, name);
        }
    };

    // Hook Create Visual Web Test button - opens the Visual Web Tester modal
    window.visualEditor.onCreateVisualTest = () => {
        // Set flag to indicate graph view is active for adding node after save
        window._graphViewActiveForNewTest = true;

        if (typeof openVisualWebTester === 'function') {
            openVisualWebTester();
        } else {
            window.showMessage("Visual Web Tester not available", "error");
        }
    };

    // Hook Add New Test Suite button - opens the Add Suite modal
    window.visualEditor.onAddTestSuite = () => {
        // Set flag to indicate graph view is active for adding node after save
        window._graphViewActiveForNewTest = true;

        if (typeof openAddSuiteModal === 'function') {
            openAddSuiteModal();
        } else {
            window.showMessage("Add Suite modal not available", "error");
        }
    };
}

async function runGraphPipeline(pipeline, options = {}) {
    const modal = document.getElementById('pipeline-run-modal');
    const title = document.getElementById('run-pipeline-name');
    const stepsContainer = document.getElementById('pipeline-execution-steps');
    const consoleOutput = document.getElementById('pipeline-console-output');
    const statusBadge = document.getElementById('pipeline-overall-status');
    let graphResult = null;

    const requestedRunnerId = options.startNodeId || null;
    const runnerPlan = buildRunnerExecutionPlan(pipeline, requestedRunnerId);
    const activeRunnerNodes = runnerPlan ? Array.from(runnerPlan.runnerById.values()) : [];
    const effectivePipeline = runnerPlan ? runnerPlan.filteredPipeline : pipeline;
    const pipelineForExecution = {
        ...effectivePipeline,
        nodes: (effectivePipeline.nodes || []).map(node => {
            const assignedRunnerId = runnerPlan?.runnerAssignments.get(node.id) || null;
            const assignedRunner = assignedRunnerId ? runnerPlan.runnerById.get(assignedRunnerId) : null;
            return {
                ...node,
                executionPolicy: {
                    ...(node.executionPolicy || {}),
                    retryAttempts: assignedRunner ? getRunnerRetryAttempts(assignedRunner, node.id) : 0,
                    controllingRunnerId: assignedRunnerId
                }
            };
        })
    };
    const executionGraphIndex = buildGraphIndex(pipelineForExecution);

    if (requestedRunnerId && activeRunnerNodes.length === 0) {
        throw new Error('Selected Start Runner Node was not found in this graph.');
    }

    title.textContent = activeRunnerNodes.length === 1 && requestedRunnerId
        ? `${pipeline.name} • ${activeRunnerNodes[0].data?.name || 'Start Runner'}`
        : pipeline.name;
    stepsContainer.innerHTML = '<div class="text-gray-500 italic p-4">Graph view execution requires console monitoring. Detailed step UI is currently simplified for graphs.</div>';

    // Initialize Log Capture
    window.currentPipelineExecutionLog = `=== GRAPH PIPELINE EXECUTION LOG ===\nPipeline: ${pipeline.name}\nStarted: ${new Date().toISOString()}\n\n`;

    consoleOutput.innerHTML = `<span class="text-blue-400">>>> Initializing Graph Engine for: ${pipeline.name}</span><br>`;
    window.currentPipelineExecutionLog += `>>> Initializing Graph Engine for: ${pipeline.name}\n`;

    if (activeRunnerNodes.length > 0) {
        const runnerNames = activeRunnerNodes.map(node => node.data?.name || 'Start Runner').join(', ');
        consoleOutput.innerHTML += `<span class="text-lime-400">>>> Start Runner scope active: ${runnerNames}</span><br>`;
        window.currentPipelineExecutionLog += `>>> Start Runner scope active: ${runnerNames}\n`;
    }

    statusBadge.className = "px-3 py-1 rounded-full text-sm font-bold bg-blue-100 text-blue-600";
    statusBadge.innerText = "RUNNING";
    setPipelineRunMonitorState({
        title: title.textContent || pipeline.name,
        status: 'RUNNING'
    });
    modal.classList.remove('hidden');

    try {
        const engine = new window.GraphEngine();

        const result = await engine.execute(pipelineForExecution, async (node, inputs, context) => {
            consoleOutput.innerHTML += `<span class="text-gray-300">Running Node: ${node.data.name}...</span><br>`;
            window.currentPipelineExecutionLog += `Running Node: ${node.data.name}...\n`;

            // Handle special node types
            const nodeType = normalizeGraphNodeType(node.type || node.data.type || 'test-suite');

            if (nodeType === 'start-runner') {
                consoleOutput.innerHTML += `<span class="text-lime-400">  ▶ Start Runner engaged</span><br>`;
                window.currentPipelineExecutionLog += `  ▶ Start Runner engaged\n`;
                return { status: 'SUCCESS', message: 'Start Runner ready' };
            }

            if (nodeType === 'wait-delay') {
                const delayMs = Math.max(0, parseInt(node.data?.delayMs, 10) || 0);
                const note = String(node.data?.note || '').trim();
                const waitLabel = note ? `${delayMs} ms (${escapeHtml(note)})` : `${delayMs} ms`;
                consoleOutput.innerHTML += `<span class="text-sky-300">  Waiting ${waitLabel}...</span><br>`;
                window.currentPipelineExecutionLog += `  Waiting ${delayMs} ms${note ? ` (${note})` : ''}...\n`;
                await new Promise(resolve => setTimeout(resolve, delayMs));
                consoleOutput.innerHTML += `<span class="text-green-400">  Done waiting</span><br>`;
                window.currentPipelineExecutionLog += `  Done waiting\n`;
                return {
                    status: 'SUCCESS',
                    message: note ? `Waited ${delayMs} ms for ${note}` : `Waited ${delayMs} ms`,
                    artifacts: {
                        delayMs,
                        waitNote: note
                    }
                };
            }

            // Git Repo node
            if (nodeType === 'git-repo') {
                consoleOutput.innerHTML += `<span class="text-orange-400">  📦 Cloning Git Repository...</span><br>`;
                window.currentPipelineExecutionLog += `  📦 Cloning Git Repository...\n`;

                let repoUrl = node.data.repoUrl;
                const branch = node.data.branch || 'main';
                const auth = node.data.auth;
                const branchMissingPolicy = node.data.branchMissingPolicy || 'fail';
                const branchBase = node.data.branchBase || 'main';

                // Runtime Sanitization: Strip /tree/ or /blob/ and branch segments if still present
                if (repoUrl && repoUrl.includes('github.com')) {
                    const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/(blob|tree)\/([^\/]+)/);
                    if (match) {
                        const cleanUrl = `https://github.com/${match[1]}/${match[2]}`;
                        console.log(`[Runtime] Auto-corrected Git URL: ${repoUrl} -> ${cleanUrl}`);
                        repoUrl = cleanUrl;
                    }
                }

                if (!repoUrl) {
                    return { status: 'FAILURE', message: 'No Repository URL configured' };
                }

                if (inputs.deployRequested === false && inputs.deploySkipped === true) {
                    const skipMessage = 'Upstream deployment was skipped, so the repository clone step was skipped too.';
                    consoleOutput.innerHTML += `<span class="text-yellow-300">  ! ${skipMessage}</span><br>`;
                    window.currentPipelineExecutionLog += `  ! ${skipMessage}\n`;
                    return {
                        status: 'SKIPPED',
                        message: skipMessage,
                        artifacts: {
                            repoPath: '',
                            source: 'git',
                            deployRequested: false
                        }
                    };
                }

                try {
                    const result = await window.electronAPI.gitOps.clone({
                        url: repoUrl,
                        branch,
                        auth,
                        branchMissingPolicy,
                        branchBase
                    });
                    node.data.clonedPath = result.path;
                    node.data.lastClonedPath = result.path;
                    if (result.branchCreated) {
                        consoleOutput.innerHTML += `<span class="text-amber-300">  ! Branch ${escapeHtml(branch)} was created from ${escapeHtml(result.baseBranchUsed || branchBase)}</span><br>`;
                        window.currentPipelineExecutionLog += `  ! Branch ${branch} was created from ${result.baseBranchUsed || branchBase}\n`;
                    }
                    consoleOutput.innerHTML += `<span class="text-green-400">  ✓ Cloned to ${result.path}</span><br>`;
                    window.currentPipelineExecutionLog += `  ✓ Cloned to ${result.path}\n`;

                    return {
                        status: 'SUCCESS',
                        message: `Cloned ${repoUrl}`,
                        artifacts: {
                            repoPath: result.path,
                            source: 'git',
                            repoUrl,
                            branch,
                            branchCreated: Boolean(result.branchCreated),
                            branchBaseUsed: result.baseBranchUsed || branchBase
                        }
                    };
                } catch (err) {
                    consoleOutput.innerHTML += `<span class="text-red-400">  ✗ Clone Failed: ${err.message}</span><br>`;
                    return { status: 'FAILURE', message: `Clone Failed: ${err.message}` };
                }
            }

            // Unit Test Runner node
            if (nodeType === 'unit-test-runner') {
                consoleOutput.innerHTML += `<span class="text-purple-400">  🧪 Running Unit Tests...</span><br>`;
                window.currentPipelineExecutionLog += `  🧪 Running Unit Tests...\n`;

                const repoPath = inputs?.repoPath || inputs?.artifacts?.repoPath;
                if (!repoPath) {
                    const msg = 'No repository path found. Ensure a Git Repo node is connected upstream.';
                    consoleOutput.innerHTML += `<span class="text-red-400">  ✗ ${msg}</span><br>`;
                    return { status: 'FAILURE', message: msg };
                }

                const cmd = node.data.command || 'npm test';

                // INJECT TEST CODE IF PRESENT
                if (node.data.testCode && node.data.testFilename) {
                    consoleOutput.innerHTML += `<span class="text-blue-300">  💾 Injecting test file: ${node.data.testFilename}...</span><br>`;
                    window.currentPipelineExecutionLog += `  💾 Injecting test file: ${node.data.testFilename}...\n`;

                    try {
                        const filePathsToInject = node.data.testFilename.includes('/') || node.data.testFilename.includes('\\')
                            ? node.data.testFilename
                            : node.data.testFilename; // Should handle path joining in backend if needed, but for now assuming root

                        // We need to join repoPath + filename safely. 
                        // Since we can't import 'path' module here easily in browser context without require, 
                        // we'll let the backend handle the full path construction or do simple string concat if OS specific separator known.
                        // Better approach: Pass repoPath and filename separately to a new fileOps function? 
                        // Or just concat with '/' since Windows handles mixed separators usually fine in Node/Electron.

                        const fullPath = repoPath + (repoPath.endsWith('\\') || repoPath.endsWith('/') ? '' : (repoPath.includes('\\') ? '\\' : '/')) + node.data.testFilename;

                        await window.electronAPI.fileOps.writeFile(fullPath, node.data.testCode);
                    } catch (injectErr) {
                        consoleOutput.innerHTML += `<span class="text-red-400">  ❌ Injection Failed: ${injectErr.message}</span><br>`;
                        return { status: 'FAILURE', message: `Injection Failed: ${injectErr.message}` };
                    }
                }

                consoleOutput.innerHTML += `<span class="text-gray-300">  > ${cmd}</span><br>`;
                window.currentPipelineExecutionLog += `  > ${cmd}\n`;

                try {
                    // Check if sysOps exists (backward compatibility)
                    if (!window.electronAPI.sysOps) {
                        throw new Error("System Operations API not available. Restart application.");
                    }

                    const result = await window.electronAPI.sysOps.runCommand(repoPath, cmd);

                    // Display output
                    const outputLog = (result.stdout + "\n" + result.stderr).trim();
                    const outputHtml = outputLog.replace(/\n/g, '<br>').replace(/\s/g, '&nbsp;');
                    consoleOutput.innerHTML += `<div class="text-xs text-gray-400 font-mono p-2 bg-gray-900 rounded my-2 max-h-60 overflow-auto whitespace-nowrap">${outputHtml}</div>`;
                    window.currentPipelineExecutionLog += outputLog + "\n";

                    if (result.exitCode === 0) {
                        consoleOutput.innerHTML += `<span class="text-green-400">  ✅ Tests Passed</span><br>`;
                        return { status: 'SUCCESS', message: 'Tests Passed', output: result.stdout };
                    } else {
                        consoleOutput.innerHTML += `<span class="text-red-400">  ❌ Tests Failed (Exit Code: ${result.exitCode})</span><br>`;
                        return { status: 'FAILURE', message: 'Tests Failed', output: result.stderr };
                    }
                } catch (err) {
                    consoleOutput.innerHTML += `<span class="text-red-400">  ❌ Execution Error: ${err.message}</span><br>`;
                    return { status: 'FAILURE', message: err.message };
                }
            }

            // AI Unit Test node
            if (nodeType === 'ai-unit-test') {
                consoleOutput.innerHTML += `<span class="text-cyan-400">  🤖 Running AI-Generated Tests...</span><br>`;
                window.currentPipelineExecutionLog += `  🤖 Running AI-Generated Tests...\n`;

                const config = node.data || {};
                const automationMode = getAIUnitTestAutomationMode(config);
                const generationFallback = getAIUnitTestGenerationFallback(config);
                const repoPath = inputs?.repoPath || inputs?.artifacts?.repoPath;
                const cwd = repoPath || config.cwd;
                let generatedCode = typeof config.generatedCode === 'string' ? config.generatedCode : '';
                let sourceFilesUsed = Array.isArray(config.lastSourceFilesUsed) ? [...config.lastSourceFilesUsed] : [];
                let resolvedTestMode = detectAIUnitTestResolvedMode(config, sourceFilesUsed);
                const shouldGenerate = automationMode === 'automated'
                    || (automationMode === 'assisted' && !generatedCode.trim());

                if (shouldGenerate) {
                    consoleOutput.innerHTML += `<span class="text-blue-300">  Automation mode: ${automationMode}. Generating tests from repo context...</span><br>`;
                    window.currentPipelineExecutionLog += `  Automation mode: ${automationMode}. Generating tests from repo context...\n`;

                    try {
                        const generationResult = await generateAIUnitTestCode(config, repoPath || cwd);
                        generatedCode = generationResult.generatedCode;
                        sourceFilesUsed = Array.isArray(generationResult.sourceFilesUsed) ? generationResult.sourceFilesUsed : [];
                        resolvedTestMode = generationResult.resolvedMode || detectAIUnitTestResolvedMode(config, sourceFilesUsed);
                        config.generatedCode = generatedCode;

                        persistAIUnitTestGeneratedCode(node, generatedCode, {
                            sourceFilesUsed,
                            generationMode: automationMode,
                            resolvedMode: resolvedTestMode
                        });

                        if (generationResult.warnings?.length) {
                            generationResult.warnings.forEach(warning => {
                                consoleOutput.innerHTML += `<span class="text-amber-300">  Warning: ${warning}</span><br>`;
                                window.currentPipelineExecutionLog += `  Warning: ${warning}\n`;
                            });
                        }

                        consoleOutput.innerHTML += `<span class="text-green-400">  Generated AI test file from ${sourceFilesUsed.length} source file(s) using ${resolvedTestMode} mode.</span><br>`;
                        window.currentPipelineExecutionLog += `  Generated AI test file from ${sourceFilesUsed.length} source file(s) using ${resolvedTestMode} mode.\n`;
                    } catch (generationErr) {
                        const canUseSavedFallback = generationFallback === 'use-saved' && generatedCode.trim();
                        const fallbackNote = canUseSavedFallback
                            ? ' Falling back to previously saved test code.'
                            : '';
                        const message = `AI test generation failed: ${generationErr.message}.${fallbackNote}`;
                        consoleOutput.innerHTML += `<span class="text-red-400">  ${message}</span><br>`;
                        window.currentPipelineExecutionLog += `  ${message}\n`;

                        if (!canUseSavedFallback) {
                            config.generatedCode = '';
                        }
                    }
                } else {
                    config.generatedCode = generatedCode;
                    resolvedTestMode = detectAIUnitTestResolvedMode(config, sourceFilesUsed);
                }

                // Validate: must have generated code
                if (!config.generatedCode || config.generatedCode.trim() === '') {
                    const msg = automationMode === 'manual'
                        ? 'No test code is available. Generate tests in the node config first or switch the node to Assisted/Automated.'
                        : 'No test code is available after generation. Adjust the automation settings or save fallback test code.';
                    consoleOutput.innerHTML += `<span class="text-red-400">  ✗ ${msg}</span><br>`;
                    return { status: 'FAILURE', message: msg };
                }

                // Determine working directory from upstream repo or artifacts
                if (!cwd) {
                    const msg = 'No working directory. Connect a Git Repo node upstream or set CWD in config.';
                    consoleOutput.innerHTML += `<span class="text-red-400">  ✗ ${msg}</span><br>`;
                    return { status: 'FAILURE', message: msg };
                }

                // Inject test file
                const testFilename = config.testFilename || 'ai-generated-test.js';
                consoleOutput.innerHTML += `<span class="text-blue-300">  💾 Injecting test file: ${testFilename}...</span><br>`;
                window.currentPipelineExecutionLog += `  💾 Injecting test file: ${testFilename}...\n`;

                try {
                    const fullPath = cwd.replace(/\\/g, '/') + '/' + testFilename;
                    await window.electronAPI.fileOps.writeFile(fullPath, generatedCode);
                } catch (injectErr) {
                    consoleOutput.innerHTML += `<span class="text-red-400">  ❌ Injection Failed: ${injectErr.message}</span><br>`;
                    return { status: 'FAILURE', message: `Injection Failed: ${injectErr.message}` };
                }

                // Execute test command
                const cmd = config.command || `node ${testFilename}`;
                consoleOutput.innerHTML += `<span class="text-gray-300">  > ${cmd}</span><br>`;
                window.currentPipelineExecutionLog += `  > ${cmd}\n`;

                try {
                    const result = await window.electronAPI.sysOps.runCommand(cwd, cmd);

                    // Display output
                    const outputLog = (result.stdout + "\n" + result.stderr).trim();
                    const outputHtml = outputLog.replace(/\n/g, '<br>').replace(/\s/g, '&nbsp;');
                    consoleOutput.innerHTML += `<div class="text-xs text-gray-400 font-mono p-2 bg-gray-900 rounded my-2 max-h-60 overflow-auto whitespace-nowrap">${outputHtml}</div>`;
                    window.currentPipelineExecutionLog += outputLog + "\n";

                    if (result.exitCode === 0) {
                        consoleOutput.innerHTML += `<span class="text-green-400">  ✅ AI Tests Passed</span><br>`;
                        return buildAIUnitTestNodeResult(result, {
                            testFilename,
                            cwd,
                            generatedCode,
                            sourceFilesUsed,
                            generationMode: shouldGenerate ? automationMode : 'manual',
                            testMode: resolvedTestMode,
                            deployRequested: inputs.deployRequested !== false
                        });
                    } else {
                        consoleOutput.innerHTML += `<span class="text-red-400">  ❌ AI Tests Failed (Exit Code: ${result.exitCode})</span><br>`;
                        return buildAIUnitTestNodeResult(result, {
                            testFilename,
                            cwd,
                            generatedCode,
                            sourceFilesUsed,
                            generationMode: shouldGenerate ? automationMode : 'manual',
                            testMode: resolvedTestMode,
                            deployRequested: inputs.deployRequested !== false
                        });
                    }
                } catch (err) {
                    consoleOutput.innerHTML += `<span class="text-red-400">  ❌ Execution Error: ${err.message}</span><br>`;
                    return { status: 'FAILURE', message: err.message };
                }
            }

            // Security Scan node
            if (nodeType === 'website-ux-auto-tester') {
                consoleOutput.innerHTML += `<span class="text-sky-300">  Website UX auto tester is auditing the generated site...</span><br>`;
                window.currentPipelineExecutionLog += `  Website UX auto tester is auditing the generated site...\n`;

                if (!window.electronAPI?.runPlaywrightTest) {
                    return { status: 'FAILURE', message: 'Playwright execution is only available in the Electron desktop app.' };
                }

                const config = node.data || {};
                const parsedScenarios = parseWebsiteUXScenarioDefinitions(config.customScenarios);
                if (parsedScenarios.error) {
                    consoleOutput.innerHTML += `<span class="text-red-400">  ${escapeHtml(parsedScenarios.error)}</span><br>`;
                    return { status: 'FAILURE', message: parsedScenarios.error };
                }

                let sourceDescriptor;
                try {
                    sourceDescriptor = await resolveWebsiteUXSourceDescriptor(config, inputs);
                } catch (error) {
                    consoleOutput.innerHTML += `<span class="text-red-400">  ${escapeHtml(error.message)}</span><br>`;
                    return { status: 'FAILURE', message: error.message };
                }

                const routePaths = parseWebsiteUXRouteList(config.routePaths);
                const plan = {
                    source: {
                        mode: config.sourceMode || 'auto',
                        kind: sourceDescriptor.kind,
                        label: sourceDescriptor.label,
                        entryUrl: sourceDescriptor.entryUrl || '',
                        html: sourceDescriptor.html || ''
                    },
                    routePaths,
                    customScenarios: parsedScenarios.scenarios,
                    autoExplore: config.autoExplore !== false,
                    viewport: {
                        width: Math.max(320, parseInt(config.viewportWidth, 10) || 1440),
                        height: Math.max(320, parseInt(config.viewportHeight, 10) || 900)
                    },
                    maxAutoInteractions: Math.max(1, parseInt(config.maxAutoInteractions, 10) || 8),
                    waitAfterActionMs: Math.max(100, parseInt(config.waitAfterActionMs, 10) || 500),
                    continueOnFailure: config.continueOnFailure !== false,
                    failOnConsoleErrors: config.failOnConsoleErrors !== false,
                    failOnPageErrors: config.failOnPageErrors !== false
                };

                consoleOutput.innerHTML += `<span class="text-gray-300">  Source: ${escapeHtml(sourceDescriptor.label || sourceDescriptor.kind)}</span><br>`;
                consoleOutput.innerHTML += `<span class="text-gray-300">  Routes: ${escapeHtml(routePaths.join(', '))}</span><br>`;
                window.currentPipelineExecutionLog += `  Source: ${sourceDescriptor.label || sourceDescriptor.kind}\n`;
                window.currentPipelineExecutionLog += `  Routes: ${routePaths.join(', ')}\n`;

                try {
                    const runnerResult = await window.electronAPI.runPlaywrightTest(buildWebsiteUXAutoTestScript(plan));
                    const rawLogs = String(runnerResult?.logs || '').trim();
                    const reportJson = parseWebsiteUXReport(rawLogs) || {};
                    const cleanLogs = rawLogs
                        .replace(/__LVX_UX_REPORT_START__[\s\S]*?__LVX_UX_REPORT_END__/, '')
                        .trim();
                    const reportText = formatWebsiteUXReport(node, reportJson, {
                        sourceLabel: sourceDescriptor.label,
                        sourceFilePath: sourceDescriptor.filePath || '',
                        repoPath: inputs?.repoPath || inputs?.workingDirectory || '',
                        viewportWidth: plan.viewport.width,
                        viewportHeight: plan.viewport.height
                    });
                    const savedReportPath = await persistWebsiteUXReport(node, reportText, {
                        sourceLabel: sourceDescriptor.label,
                        sourceFilePath: sourceDescriptor.filePath || '',
                        repoPath: inputs?.repoPath || inputs?.workingDirectory || '',
                        viewportWidth: plan.viewport.width,
                        viewportHeight: plan.viewport.height
                    });

                    const summaryTotal = reportJson?.summary?.total ?? 0;
                    const summaryPassed = reportJson?.summary?.passed ?? 0;
                    const summaryFailed = reportJson?.summary?.failed ?? 0;
                    const summaryWarnings = reportJson?.summary?.warnings ?? 0;
                    const runStatus = runnerResult?.status === 'SUCCESS' && summaryFailed === 0 ? 'SUCCESS' : 'FAILURE';

                    consoleOutput.innerHTML += `<span class="text-${runStatus === 'SUCCESS' ? 'green' : 'red'}-400">  UX audit summary: ${summaryPassed}/${summaryTotal} passed, ${summaryFailed} failed, ${summaryWarnings} warning scenarios.</span><br>`;
                    if (savedReportPath) {
                        consoleOutput.innerHTML += `<span class="text-green-300">  Report saved to ${escapeHtml(savedReportPath)}</span><br>`;
                    }
                    if (cleanLogs) {
                        const preview = escapeHtml(cleanLogs).replace(/\n/g, '<br>');
                        consoleOutput.innerHTML += `<div class="text-xs text-gray-400 font-mono p-2 bg-gray-900 rounded my-2 max-h-48 overflow-auto">${preview}</div>`;
                    }
                    window.currentPipelineExecutionLog += `  UX audit summary: ${summaryPassed}/${summaryTotal} passed, ${summaryFailed} failed, ${summaryWarnings} warning scenarios.\n`;
                    if (savedReportPath) {
                        window.currentPipelineExecutionLog += `  Report saved to ${savedReportPath}\n`;
                    }

                    return {
                        status: runStatus,
                        message: runStatus === 'SUCCESS' ? 'Website UX audit passed' : 'Website UX audit found issues',
                        output: reportText,
                        log: cleanLogs || reportText,
                        stdout: rawLogs,
                        stderr: '',
                        artifacts: {
                            uxReport: reportText,
                            uxReportJson: reportJson,
                            uxReportPath: savedReportPath,
                            output: reportText,
                            log: cleanLogs || reportText,
                            sourceLabel: sourceDescriptor.label,
                            scenarioCount: summaryTotal,
                            failedScenarioCount: summaryFailed,
                            warningScenarioCount: summaryWarnings,
                            deployRequested: inputs.deployRequested !== false && runStatus === 'SUCCESS'
                        }
                    };
                } catch (error) {
                    consoleOutput.innerHTML += `<span class="text-red-400">  UX auto test error: ${escapeHtml(error.message)}</span><br>`;
                    return {
                        status: 'FAILURE',
                        message: `Website UX auto tester failed: ${error.message}`,
                        artifacts: {
                            deployRequested: false
                        }
                    };
                }
            }

            if (nodeType === 'ai-log-summary') {
                consoleOutput.innerHTML += `<span class="text-amber-300">  📋 Generating AI Log Summary...</span><br>`;
                window.currentPipelineExecutionLog += `  📋 Generating AI Log Summary...\n`;

                const config = node.data || {};
                const summaryScope = normalizeAILogSummaryScope(config.summaryScope);
                const provider = config.provider || 'google';
                const providerLabel = getAILogSummaryProviderLabel(provider);
                const apiKey = config.apiKey || '';
                const model = config.model || '';
                const customEndpoint = config.customEndpoint || '';
                const maxTokens = parseInt(config.maxTokens, 10) || 16384;
                const upstreamNodes = collectUpstreamSummaryNodes(node.id, executionGraphIndex, summaryScope);

                if (summaryScope !== 'full-runner-log' && upstreamNodes.length === 0) {
                    const msg = 'No upstream node connected. Connect a node before AI Log Summary so it has logs to analyze.';
                    consoleOutput.innerHTML += `<span class="text-red-400">  ✗ ${msg}</span><br>`;
                    return { status: 'FAILURE', message: msg };
                }

                if (!window.electronAPI?.aiOps?.generate) {
                    const msg = 'AI operations are not available in this environment.';
                    consoleOutput.innerHTML += `<span class="text-red-400">  ✗ ${msg}</span><br>`;
                    return { status: 'FAILURE', message: msg };
                }

                if (!apiKey) {
                    const msg = 'API key is required. Open the AI Log Summary node config and add one first.';
                    consoleOutput.innerHTML += `<span class="text-red-400">  ✗ ${msg}</span><br>`;
                    return { status: 'FAILURE', message: msg };
                }

                const logContext = summaryScope === 'full-runner-log'
                    ? buildFullRunnerLogSummaryContext(context.results || {}, window.currentPipelineExecutionLog || '', executionGraphIndex)
                    : getAILogSummaryContext(node, upstreamNodes, context.results || {});
                if (!logContext.logText || !logContext.logText.trim()) {
                    const msg = summaryScope === 'full-runner-log'
                        ? 'The runner log is empty, so there is nothing to summarize yet.'
                        : 'The connected upstream node does not have any logs or execution details to summarize yet.';
                    consoleOutput.innerHTML += `<span class="text-red-400">  ✗ ${msg}</span><br>`;
                    return { status: 'FAILURE', message: msg };
                }

                const systemPrompt = getAILogSummarySystemPrompt();
                const userPrompt = buildAILogSummaryPrompt(node, logContext);
                const sourceNamesText = logContext.sourceNames.join(', ');
                const scopeLabel = summaryScope === 'full-runner-log'
                    ? 'full runner log'
                    : (summaryScope === 'upstream-chain' ? 'upstream chain' : 'direct upstream node');

                consoleOutput.innerHTML += `<span class="text-gray-300">  > Provider: ${providerLabel}${model ? ` (${escapeHtml(model)})` : ''}</span><br>`;
                consoleOutput.innerHTML += `<span class="text-gray-300">  > Summary scope: ${escapeHtml(scopeLabel)}</span><br>`;
                consoleOutput.innerHTML += `<span class="text-gray-300">  > Source nodes: ${escapeHtml(sourceNamesText)}</span><br>`;
                window.currentPipelineExecutionLog += `  > Provider: ${providerLabel}${model ? ` (${model})` : ''}\n`;
                window.currentPipelineExecutionLog += `  > Summary scope: ${scopeLabel}\n`;
                window.currentPipelineExecutionLog += `  > Source nodes: ${sourceNamesText}\n`;

                try {
                    const aiResult = await window.electronAPI.aiOps.generate(
                        provider,
                        model,
                        apiKey,
                        userPrompt,
                        systemPrompt,
                        customEndpoint,
                        maxTokens
                    );

                    const summaryText = String(aiResult?.generatedText || '').trim();
                    if (!aiResult?.success || !summaryText) {
                        const msg = 'The AI provider returned an empty summary.';
                        consoleOutput.innerHTML += `<span class="text-red-400">  ✗ ${msg}</span><br>`;
                        return { status: 'FAILURE', message: msg };
                    }

                    node.data.lastSummary = summaryText;
                    node.data.lastSummaryAt = new Date().toISOString();

                    let savedPath = '';
                    let saveError = '';
                    if (node.data.savePath && window.visualEditor && typeof window.visualEditor.saveAILogSummaryToFile === 'function') {
                        try {
                            const saveResult = await window.visualEditor.saveAILogSummaryToFile(node, summaryText, {
                                sourceNames: logContext.sourceNames,
                                providerLabel,
                                generatedAt: node.data.lastSummaryAt,
                                allowPicker: false,
                                silent: true
                            });

                            if (saveResult?.success) {
                                savedPath = saveResult.filePath || '';
                                consoleOutput.innerHTML += `<span class="text-green-400">  ✓ Summary saved to ${escapeHtml(savedPath)}</span><br>`;
                                window.currentPipelineExecutionLog += `  ✓ Summary saved to ${savedPath}\n`;
                            } else if (saveResult?.error) {
                                saveError = saveResult.error;
                                consoleOutput.innerHTML += `<span class="text-yellow-300">  ! Summary auto-save failed: ${escapeHtml(saveError)}</span><br>`;
                                window.currentPipelineExecutionLog += `  ! Summary auto-save failed: ${saveError}\n`;
                            }
                        } catch (error) {
                            saveError = error.message || 'Failed to save summary.';
                            consoleOutput.innerHTML += `<span class="text-yellow-300">  ! Summary auto-save failed: ${escapeHtml(saveError)}</span><br>`;
                            window.currentPipelineExecutionLog += `  ! Summary auto-save failed: ${saveError}\n`;
                        }
                    }

                    showAILogSummaryOutput(node, summaryText, {
                        sourceNames: logContext.sourceNames,
                        providerLabel,
                        generatedAt: node.data.lastSummaryAt,
                        savedPath,
                        saveError
                    });

                    consoleOutput.innerHTML += `<span class="text-green-400">  ✓ AI log summary generated</span><br>`;
                    window.currentPipelineExecutionLog += `  ✓ AI log summary generated\n`;

                    // Capture AI summary in log context (Feature 3)
                    const controllingRunnerId = node.executionPolicy?.controllingRunnerId;
                    const controllingRunner = controllingRunnerId ? executionGraphIndex.nodeById.get(controllingRunnerId) : null;
                    if (controllingRunner?.data?.captureAIContext) {
                        window.currentPipelineExecutionLog += `\n--- AI GENERATED LOG SUMMARY ---\n${summaryText}\n----------------------------------\n\n`;
                    }

                    return {
                        status: 'SUCCESS',
                        message: 'AI log summary generated',
                        output: summaryText,
                        aiSummary: summaryText,
                        artifacts: {
                            aiLogSummary: summaryText,
                            aiLogSummarySources: logContext.sourceNames,
                            aiLogSummaryScope: summaryScope
                        }
                    };
                } catch (error) {
                    consoleOutput.innerHTML += `<span class="text-red-400">  ✗ AI summary failed: ${escapeHtml(error.message)}</span><br>`;
                    window.currentPipelineExecutionLog += `  ✗ AI summary failed: ${error.message}\n`;
                    return { status: 'FAILURE', message: error.message };
                }
            }

            // Log Collector & Zip node
            if (nodeType === 'log-collector') {
                const archiveName = node.data.archiveName || `pipeline-logs-${Date.now()}`;
                const savePath = node.data.savePath;
                const collectionMode = node.data.collectionMode || 'all';

                if (!savePath) {
                    return { status: 'FAILURE', message: 'No save path configured', artifacts: {} };
                }

                // Collect all logs from the pipeline execution context
                const logFiles = [];

                // 1. Master pipeline execution log
                if (window.currentPipelineExecutionLog) {
                    logFiles.push({
                        filename: 'pipeline-execution.log',
                        content: window.currentPipelineExecutionLog
                    });
                }

                // 2. Individual node logs from context
                if (context && context.results) {
                    for (const [nodeId, result] of Object.entries(context.results)) {
                        const nodeInfo = executionGraphIndex.nodeById.get(nodeId);
                        const nodeName = nodeInfo?.data?.name || nodeInfo?.data?.label || nodeId;
                        const nType = nodeInfo?.type || nodeInfo?.data?.type || 'unknown';
                        let logContent = '';

                        logContent += `Node: ${nodeName}\n`;
                        logContent += `Type: ${nType}\n`;
                        logContent += `Status: ${result.status || 'unknown'}\n`;
                        logContent += `Duration: ${result.duration || 'N/A'}ms\n`;
                        logContent += `Timestamp: ${result.timestamp || new Date().toISOString()}\n`;
                        logContent += `${'='.repeat(60)}\n\n`;

                        // Standard logs
                        if (result.logs && Array.isArray(result.logs)) {
                            logContent += `--- LOGS ---\n${result.logs.join('\n')}\n\n`;
                        }

                        // Message/output
                        if (result.message) {
                            logContent += `--- MESSAGE ---\n${result.message}\n\n`;
                        }

                        // AI responses (from AI nodes)
                        if (collectionMode === 'all' || collectionMode === 'ai-only') {
                            if (result.artifacts?.aiResponse) {
                                logContent += `--- AI RESPONSE ---\n${result.artifacts.aiResponse}\n\n`;
                            }
                            if (result.artifacts?.aiSummary) {
                                logContent += `--- AI SUMMARY ---\n${result.artifacts.aiSummary}\n\n`;
                            }
                            if (result.artifacts?.finalCode) {
                                logContent += `--- GENERATED CODE ---\n${result.artifacts.finalCode}\n\n`;
                            }
                        }

                        // Errors
                        if (result.artifacts?.error) {
                            logContent += `--- ERRORS ---\n${result.artifacts.error}\n\n`;
                        }
                        if (result.artifacts?.violations) {
                            logContent += `--- VIOLATIONS ---\n${JSON.stringify(result.artifacts.violations, null, 2)}\n\n`;
                        }

                        // Assertion results (from API test nodes)
                        if (result.artifacts?.assertions) {
                            logContent += `--- ASSERTIONS ---\n`;
                            for (const a of result.artifacts.assertions) {
                                logContent += `  ${a.passed ? 'PASS' : 'FAIL'}: ${a.message}\n`;
                            }
                            logContent += '\n';
                        }

                        // Deploy logs
                        if (result.artifacts?.logs && Array.isArray(result.artifacts.logs)) {
                            logContent += `--- DEPLOY LOGS ---\n${result.artifacts.logs.join('\n')}\n\n`;
                        }

                        const safeNodeName = nodeName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
                        logFiles.push({
                            filename: `${safeNodeName}-${nType}.log`,
                            content: logContent
                        });
                    }
                }

                if (logFiles.length === 0) {
                    return { status: 'FAILURE', message: 'No logs found to collect', artifacts: {} };
                }

                // Create zip via IPC
                const zipFileName = `${archiveName}.zip`;
                let finalZipPath = `${savePath}/${zipFileName}`;
                if (savePath.endsWith('/') || savePath.endsWith('\\')) {
                    finalZipPath = `${savePath}${zipFileName}`;
                }

                // Show in console
                consoleOutput.innerHTML += `<span class="text-blue-300">  🗜️ Archiving ${logFiles.length} logs to ${escapeHtml(zipFileName)}...</span><br>`;

                try {
                    // Use electronAPI zip handler if available
                    if (window.electronAPI?.zipFiles) {
                        await window.electronAPI.zipFiles({
                            files: logFiles,
                            outputPath: finalZipPath
                        });
                    } else {
                        // Fallback: save as individual files in a subfolder
                        const pathSep = savePath.includes('\\') ? '\\' : '/';
                        const folderPath = savePath.endsWith(pathSep) ? `${savePath}${archiveName}` : `${savePath}${pathSep}${archiveName}`;
                        for (const file of logFiles) {
                            await window.electronAPI.fileOps.writeFile(`${folderPath}${pathSep}${file.filename}`, file.content);
                        }
                        
                        consoleOutput.innerHTML += `<span class="text-green-400">  ✓ Saved ${logFiles.length} log files to folder</span><br>`;
                        return {
                            status: 'SUCCESS',
                            message: `Saved ${logFiles.length} log files to folder (zip not available)`,
                            artifacts: { path: folderPath, fileCount: logFiles.length, files: logFiles.map(f => f.filename) }
                        };
                    }

                    consoleOutput.innerHTML += `<span class="text-green-400">  ✓ Log Archive Created: ${escapeHtml(zipFileName)}</span><br>`;
                    return {
                        status: 'SUCCESS',
                        message: `Created ${zipFileName} with ${logFiles.length} files`,
                        artifacts: {
                            zipPath: finalZipPath,
                            fileCount: logFiles.length,
                            files: logFiles.map(f => f.filename),
                            totalSize: logFiles.reduce((sum, f) => sum + f.content.length, 0)
                        }
                    };
                } catch (err) {
                    consoleOutput.innerHTML += `<span class="text-red-400">  ❌ Archive Failed: ${err.message}</span><br>`;
                    return {
                        status: 'FAILURE',
                        message: `Failed to create archive: ${err.message}`,
                        artifacts: { error: err.message }
                    };
                }
            }

            // API Performance Test node
            if (nodeType === 'api-performance' || nodeType === 'api-test') {
                const url = node.data.url || node.data.endpoint;
                const method = (node.data.method || 'GET').toUpperCase();
                const headers = {};
                const timeout = node.data.maxLatency || node.data.timeout || 30000;

                if (!url) {
                    consoleOutput.innerHTML += `<span class="text-red-400">  ❌ No URL configured</span><br>`;
                    return { status: 'FAILURE', message: 'No URL configured' };
                }

                consoleOutput.innerHTML += `<span class="text-orange-400">  ⚡ Testing API: ${escapeHtml(url)}...</span><br>`;

                // Parse headers if provided as string or array
                if (node.data.headers) {
                    if (typeof node.data.headers === 'string') {
                        try {
                            Object.assign(headers, JSON.parse(node.data.headers));
                        } catch (e) { /* ignore parse error */ }
                    } else if (Array.isArray(node.data.headers)) {
                        node.data.headers.forEach(h => { if (h.key) headers[h.key] = h.value; });
                    }
                }

                // Build request body
                let body = undefined;
                if (['POST', 'PUT', 'PATCH'].includes(method) && node.data.body) {
                    body = typeof node.data.body === 'string' ? node.data.body : JSON.stringify(node.data.body);
                    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
                }

                // Auth
                if (node.data.authToken) {
                    headers['Authorization'] = `Bearer ${node.data.authToken}`;
                }

                const startTime = Date.now();
                let response, responseBody, responseHeaders, statusCode;

                try {
                    // Use electronAPI if available, else fetch
                    if (window.electronAPI && window.electronAPI.httpRequest) {
                        const result = await window.electronAPI.httpRequest({ method, url, headers, body, timeout });
                        statusCode = result.statusCode;
                        responseHeaders = result.headers || {};
                        responseBody = result.body || '';
                    } else {
                        const ctrl = new AbortController();
                        const timer = setTimeout(() => ctrl.abort(), timeout);
                        const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
                        clearTimeout(timer);
                        statusCode = res.status;
                        responseHeaders = Object.fromEntries(res.headers.entries());
                        responseBody = await res.text();
                    }
                } catch (err) {
                    consoleOutput.innerHTML += `<span class="text-red-400">  ❌ API Request Failed: ${err.message}</span><br>`;
                    return { status: 'FAILURE', message: `Request failed: ${err.message}`, artifacts: { error: err.message } };
                }

                const duration = Date.now() - startTime;

                // Parse JSON body if possible
                let jsonBody = null;
                try { jsonBody = JSON.parse(responseBody); } catch (e) { /* not JSON */ }

                // --- RUN ASSERTIONS ---
                const assertions = node.data.assertions || [];
                const assertionResults = [];

                if (assertions.length === 0) {
                    if (node.data.expectedStatus) {
                        assertions.push({ type: 'status', operator: 'equals', value: parseInt(node.data.expectedStatus) });
                    }
                    if (node.data.maxLatency) {
                        assertions.push({ type: 'response-time', operator: 'less-than', value: parseInt(node.data.maxLatency) });
                    }
                }

                for (const assertion of assertions) {
                    let passed = false;
                    let actual = null;
                    let message = '';

                    switch (assertion.type) {
                        case 'status':
                            actual = statusCode;
                            passed = window.evaluateOperator(actual, assertion.operator, assertion.value);
                            message = `Status ${statusCode} ${assertion.operator} ${assertion.value}`;
                            break;
                        case 'response-time':
                            actual = duration;
                            passed = window.evaluateOperator(actual, assertion.operator, assertion.value);
                            message = `Response time ${duration}ms ${assertion.operator} ${assertion.value}ms`;
                            break;
                        case 'header':
                            actual = responseHeaders[assertion.key?.toLowerCase()] || null;
                            passed = window.evaluateOperator(actual, assertion.operator, assertion.value);
                            message = `Header "${assertion.key}" ${assertion.operator} "${assertion.value}"`;
                            break;
                        case 'body-contains':
                            actual = responseBody;
                            passed = responseBody.includes(assertion.value);
                            message = `Body contains "${assertion.value}"`;
                            break;
                        case 'body-json':
                            if (jsonBody) {
                                actual = window.getJsonPath(jsonBody, assertion.path);
                                passed = window.evaluateOperator(actual, assertion.operator, assertion.value);
                                message = `JSONPath ${assertion.path} ${assertion.operator} ${assertion.value}`;
                            } else {
                                passed = false;
                                message = `JSONPath ${assertion.path}: response is not JSON`;
                            }
                            break;
                    }
                    assertionResults.push({ ...assertion, passed, actual, message });
                }

                // --- EXTRACT VARIABLES ---
                const extractedVars = {};
                if (node.data.extractVariables) {
                    for (const v of node.data.extractVariables) {
                        if (v.source === 'body' && jsonBody) {
                            extractedVars[v.name] = window.getJsonPath(jsonBody, v.path);
                        } else if (v.source === 'header') {
                            extractedVars[v.name] = responseHeaders[v.key?.toLowerCase()];
                        } else if (v.source === 'status') {
                            extractedVars[v.name] = statusCode;
                        }
                    }
                    if (context && context.variables) {
                        Object.assign(context.variables, extractedVars);
                    }
                }

                const allPassed = assertionResults.length === 0 || assertionResults.every(a => a.passed);
                
                assertionResults.forEach(a => {
                    consoleOutput.innerHTML += `<span class="text-${a.passed ? 'green' : 'red'}-400">  ${a.passed ? '✓' : '✗'} ${a.message}</span><br>`;
                });

                return {
                    status: allPassed ? 'SUCCESS' : 'FAILURE',
                    message: `${method} ${url} -> ${statusCode} (${duration}ms) | ${assertionResults.filter(a => a.passed).length}/${assertionResults.length} assertions passed`,
                    artifacts: {
                        statusCode,
                        duration,
                        responseHeaders,
                        responseBody: responseBody.substring(0, 5000),
                        jsonBody,
                        assertions: assertionResults,
                        extractedVariables: extractedVars
                    }
                };
            }

            // API Contract Test node
            if (nodeType === 'api-contract' || nodeType === 'contract-test') {
                const url = node.data.url || node.data.endpoint;
                const method = (node.data.method || 'GET').toUpperCase();
                const expectedStatus = parseInt(node.data.expectedStatus || '200');

                if (!url) return { status: 'FAILURE', message: 'No URL configured' };

                consoleOutput.innerHTML += `<span class="text-cyan-400">  📝 Validating API Contract: ${escapeHtml(url)}...</span><br>`;

                // Fetch the actual API response
                let responseBody, statusCode;
                try {
                    if (window.electronAPI && window.electronAPI.httpRequest) {
                        const result = await window.electronAPI.httpRequest({ method, url, headers: {}, timeout: 30000 });
                        statusCode = result.statusCode;
                        responseBody = result.body;
                    } else {
                        const res = await fetch(url, { method });
                        statusCode = res.status;
                        responseBody = await res.text();
                    }
                } catch (err) {
                    return { status: 'FAILURE', message: `Request failed: ${err.message}`, artifacts: { error: err.message } };
                }

                // Parse response as JSON
                let jsonBody;
                try {
                    jsonBody = JSON.parse(responseBody);
                } catch (e) {
                    return { status: 'FAILURE', message: `Response is not valid JSON: ${e.message}`, artifacts: { statusCode, rawBody: responseBody.substring(0, 2000) } };
                }

                // Parse the expected contract/schema
                let schema;
                try {
                    schema = typeof node.data.schema === 'string' ? JSON.parse(node.data.schema) : node.data.schema;
                } catch (e) {
                    return { status: 'FAILURE', message: `Invalid JSON Schema: ${e.message}`, artifacts: { schemaError: e.message } };
                }

                if (!schema) {
                    return { status: 'FAILURE', message: 'No valid schema provided' };
                }

                // --- VALIDATE AGAINST JSON SCHEMA ---
                const violations = [];
                const warnings = [];

                function validateSchema(data, schema, path = '$') {
                    if (!schema || typeof schema !== 'object') return;

                    // Type check
                    if (schema.type) {
                      const actualType = Array.isArray(data) ? 'array' : (data === null ? 'null' : typeof data);
                      if (actualType !== schema.type) {
                        violations.push({
                          path, message: `Expected type "${schema.type}", got "${actualType}"`,
                          expected: schema.type, actual: actualType
                        });
                        return;
                      }
                    }

                    // Required properties
                    if (schema.required && Array.isArray(schema.required)) {
                      for (const req of schema.required) {
                        if (data === null || data === undefined || !(req in data)) {
                          violations.push({ path: `${path}.${req}`, message: `Required property "${req}" is missing` });
                        }
                      }
                    }

                    // Object properties
                    if (schema.properties && typeof data === 'object' && data !== null && !Array.isArray(data)) {
                      for (const [key, propSchema] of Object.entries(schema.properties)) {
                        if (key in data) {
                          validateSchema(data[key], propSchema, `${path}.${key}`);
                        }
                      }
                      if (schema.additionalProperties === false) {
                        const allowed = new Set(Object.keys(schema.properties));
                        for (const key of Object.keys(data)) {
                          if (!allowed.has(key)) warnings.push({ path: `${path}.${key}`, message: `Unexpected extra property "${key}"` });
                        }
                      }
                    }

                    // Array items
                    if (schema.items && Array.isArray(data)) {
                      if (schema.minItems && data.length < schema.minItems) {
                        violations.push({ path, message: `Array len ${data.length} < minItems ${schema.minItems}` });
                      }
                      if (schema.maxItems && data.length > schema.maxItems) {
                        violations.push({ path, message: `Array len ${data.length} > maxItems ${schema.maxItems}` });
                      }
                      data.forEach((item, i) => validateSchema(item, schema.items, `${path}[${i}]`));
                    }
                }

                validateSchema(jsonBody, schema);

                if (statusCode !== expectedStatus) {
                    violations.unshift({ path: 'HTTP Status', message: `Expected ${expectedStatus}, got ${statusCode}` });
                }

                let totalProperties = 0, coveredProperties = 0;
                function countCoverage(data, schema, depth = 0) {
                    if (depth > 10) return;
                    if (schema.properties) {
                        for (const [key, propSchema] of Object.entries(schema.properties)) {
                            totalProperties++;
                            if (data && key in data) { coveredProperties++; countCoverage(data[key], propSchema, depth + 1); }
                        }
                    }
                }
                countCoverage(jsonBody, schema);
                const coverage = totalProperties > 0 ? Math.round((coveredProperties / totalProperties) * 100) : 100;

                consoleOutput.innerHTML += `<span class="text-${violations.length ? 'red' : 'green'}-400">  ${violations.length ? '✗' : '✓'} Contract Validated (${coverage}% coverage)</span><br>`;

                return {
                    status: violations.length === 0 ? 'SUCCESS' : 'FAILURE',
                    message: `Contract: ${violations.length} violation(s), ${warnings.length} warning(s), ${coverage}% coverage`,
                    artifacts: {
                        violations,
                        warnings,
                        coverage,
                        statusCode,
                        responseBodyPreview: JSON.stringify(jsonBody, null, 2).substring(0, 3000)
                    }
                };
            }

            // AI Code Review node
            if (nodeType === 'code-review') {
                const downstreamDeployNodes = collectDownstreamDeployNodes(node.id, executionGraphIndex);
                const hasDownstreamDeployNode = downstreamDeployNodes.length > 0;
                const config = {
                    name: node.data.name || 'AI Code Review',
                    sourceCode: resolveCodeReviewSource(node, inputs),
                    lastGeneratedCode: node.data.lastGeneratedCode || '',
                    history: Array.isArray(node.data.history) ? [...node.data.history] : [],
                    instructions: node.data.instructions || '',
                    outputPath: node.data.outputPath || '',
                    executionMode: node.data.executionMode || 'interactive',
                    language: node.data.language || inputs?.language || 'html',
                    mode: node.data.mode || 'review',
                    provider: node.data.provider || 'google',
                    model: node.data.model || 'gemini-2.0-flash',
                    apiKey: node.data.apiKey || '',
                    autoSendOnOpen: Boolean(getFirstNonEmptyString(node.data.instructions, inputs.prompt)),
                    autoSendDelayMs: 75
                };
                const baseDir = getFirstNonEmptyString(inputs.repoPath, inputs.workingDirectory, '');

                if (config.executionMode === 'automated') {
                    const prompt = getFirstNonEmptyString(node.data.instructions, inputs.prompt);
                    if (!prompt) {
                        return { status: 'FAILURE', message: 'No automation instructions configured for AI Code Review node.' };
                    }

                    consoleOutput.innerHTML += `<span class="text-fuchsia-300">  Generating code from node instructions...</span><br>`;
                    window.currentPipelineExecutionLog += `  Generating code from node instructions...\n`;

                    try {
                        const finalCode = await requestAutomatedCodeReview(config, prompt, config.sourceCode);
                        const history = [buildCodeReviewHistoryEntry(prompt, config.sourceCode, finalCode, 'accepted', true)];
                        const persisted = await persistCodeReviewResult(node, {
                            finalCode,
                            language: config.language,
                            history,
                            prompt
                        }, { baseDir });

                        if (persisted.savedFilePath) {
                            consoleOutput.innerHTML += `<span class="text-green-300">  Saved generated code to ${escapeHtml(persisted.savedFilePath)}</span><br>`;
                            window.currentPipelineExecutionLog += `  Saved generated code to ${persisted.savedFilePath}\n`;
                        }

                        return {
                            status: 'SUCCESS',
                            message: hasDownstreamDeployNode ? 'Code generated and queued for deployment' : 'Code generated',
                            artifacts: {
                                finalCode,
                                lastGeneratedCode: finalCode,
                                language: config.language,
                                history,
                                historyCount: history.length,
                                acceptedCount: history.length,
                                prompt,
                                deployRequested: hasDownstreamDeployNode,
                                sourceExecutionMode: 'automated',
                                savedFilePath: persisted.savedFilePath,
                                savedOutputRelativePath: persisted.configuredOutputPath || getDefaultGeneratedFilename(config.language)
                            }
                        };
                    } catch (error) {
                        return {
                            status: 'FAILURE',
                            message: `Automated code generation failed: ${error.message}`
                        };
                    }
                }

                return new Promise((resolve) => {
                    if (!window.openCodeReviewModal) {
                        resolve({ status: 'FAILURE', message: 'openCodeReviewModal not loaded' });
                        return;
                    }

                    const pauseMessage = 'Interactive Website Iteration opened. Pipeline is paused here until you click Done or Deploy.';
                    consoleOutput.innerHTML += `<span class="text-sky-300">  ${escapeHtml(pauseMessage)}</span><br>`;
                    window.currentPipelineExecutionLog += `  ${pauseMessage}\n`;
                    setPipelineRunMonitorState({ status: 'WAITING FOR REVIEW' });

                    window.openCodeReviewModal(config, context, async (result) => {
                        setPipelineRunMonitorState({ status: 'RUNNING' });

                        if (result.status === 'cancelled') {
                            resolve({
                                status: 'SKIPPED',
                                message: 'Code review cancelled by user',
                                artifacts: {}
                            });
                            return;
                        }

                        try {
                            const normalizedHistory = Array.isArray(result.history) ? result.history : [];
                            const finalCode = typeof result.finalCode === 'string' ? result.finalCode : config.sourceCode;
                            const language = result.language || config.language;
                            const prompt = typeof result.prompt === 'string' ? result.prompt : '';
                            const deployRequested = result.action === 'deploy' && hasDownstreamDeployNode;
                            const persisted = await persistCodeReviewResult(node, {
                                finalCode,
                                language,
                                history: normalizedHistory,
                                prompt
                            }, { baseDir });

                            if (persisted.savedFilePath) {
                                consoleOutput.innerHTML += `<span class="text-green-300">  Saved generated code to ${escapeHtml(persisted.savedFilePath)}</span><br>`;
                                window.currentPipelineExecutionLog += `  Saved generated code to ${persisted.savedFilePath}\n`;
                            }

                            const acceptedCount = normalizedHistory.filter(entry => entry.status === 'accepted' || entry.status === 'iterated').length;
                            const message = result.action === 'deploy' && !hasDownstreamDeployNode
                                ? 'Code saved, but no downstream Push & Deploy node is connected'
                                : `Code ${deployRequested ? 'ready for deployment' : 'review complete'}`;

                            resolve({
                                status: 'SUCCESS',
                                message,
                                artifacts: {
                                    finalCode,
                                    lastGeneratedCode: finalCode,
                                    language,
                                    history: normalizedHistory,
                                    historyCount: normalizedHistory.length,
                                    acceptedCount,
                                    prompt,
                                    deployRequested,
                                    sourceExecutionMode: 'interactive',
                                    savedFilePath: persisted.savedFilePath,
                                    savedOutputRelativePath: persisted.configuredOutputPath || getDefaultGeneratedFilename(language)
                                }
                            });
                        } catch (error) {
                            resolve({
                                status: 'FAILURE',
                                message: `Unable to persist AI Code Review output: ${error.message}`
                            });
                        }
                    });
                });
            }

            // Push & Deploy node
            if (nodeType === 'push-deploy' || nodeType === 'deployment') {
                const log = (msg) => {
                    consoleOutput.innerHTML += `<span class="text-rose-400">  ${escapeHtml(msg)}</span><br>`;
                    window.currentPipelineExecutionLog += `  ${msg}\n`;
                };

                if (inputs.deployRequested === false) {
                    log('Deploy not requested by upstream step; skipping deployment.');
                    return {
                        status: 'SKIPPED',
                        message: 'Deploy not requested',
                        artifacts: {
                            deploySkipped: true,
                            deployedNodeIds: Array.isArray(inputs.deployedNodeIds) ? inputs.deployedNodeIds : []
                        }
                    };
                }

                return executePushDeployNode(node, inputs, { log });
            }

            if (nodeType === 'security-scan') {
                consoleOutput.innerHTML += `<span class="text-purple-400">  🔒 Running Security Scan...</span><br>`;
                window.currentPipelineExecutionLog += `  🔒 Running Security Scan...\n`;

                if (!window.securityManager) {
                    return { status: 'FAILURE', message: 'Security manager not loaded' };
                }

                // Get code from previous node outputs or use scan config
                const scanConfig = node.data.config || {};

                // CHECK FOR INFRASTRUCTURE SCANS
                if (['docker_container', 'docker_image', 'k8s_yaml', 'network_port'].includes(scanConfig.scanType)) {
                    const target = inputs?.target || scanConfig.target;

                    if (!target && scanConfig.scanType !== 'k8s_scan_cluster') { // k8s cluster might not need specific target
                        consoleOutput.innerHTML += `<span class="text-red-400">  ✗ Missing target for ${scanConfig.scanType}</span><br>`;
                        return { status: 'FAILURE', message: 'Missing target for infrastructure scan' };
                    }

                    consoleOutput.innerHTML += `<span class="text-blue-300">  🔍 Scanning ${scanConfig.scanType}: ${target}...</span><br>`;

                    const scanResult = await window.securityManager.runInfrastructureScan(target, scanConfig.scanType, {
                        name: node.data.name
                    });

                    const vulnCount = scanResult.summary?.total || 0;
                    consoleOutput.innerHTML += `<span class="text-${vulnCount > 0 ? 'yellow' : 'green'}-400">  Found ${vulnCount} issues</span><br>`;
                    window.currentPipelineExecutionLog += `  Found ${vulnCount} issues\n`;

                    if (scanResult.error) {
                        consoleOutput.innerHTML += `<span class="text-red-400">  ✗ Error: ${scanResult.error}</span><br>`;
                    }

                    context.lastSecurityResults = scanResult;
                    return {
                        status: scanResult.policyPassed ? 'SUCCESS' : 'FAILURE',
                        message: `Infra scan: ${vulnCount} issues`,
                        securityResults: scanResult
                    };
                }

                // Default: Code Scan
                let codeToScan = inputs?.code || scanConfig.code || '';
                const upstreamNodes = (executionGraphIndex.incoming.get(node.id) || [])
                    .map(sourceNodeId => executionGraphIndex.nodeById.get(sourceNodeId))
                    .filter(Boolean);

                if (!codeToScan && upstreamNodes.length > 0) {
                    const upstreamSuiteSources = upstreamNodes
                        .map(sourceNode => {
                            const suiteId = sourceNode?.data?.suiteId;
                            if (!suiteId || !Array.isArray(window.testSuites)) return null;
                            const suite = window.testSuites.find(candidate => candidate.id === suiteId);
                            if (!suite?.code) return null;
                            return `// SUITE: ${suite.name || sourceNode.data?.name || suiteId}\n${suite.code}`;
                        })
                        .filter(Boolean);

                    if (upstreamSuiteSources.length > 0) {
                        codeToScan = upstreamSuiteSources.join('\n\n');
                        consoleOutput.innerHTML += `<span class="text-blue-300">  🧾 Using code from ${upstreamSuiteSources.length} upstream suite node(s)...</span><br>`;
                        window.currentPipelineExecutionLog += `  🧾 Using code from ${upstreamSuiteSources.length} upstream suite node(s)...\n`;
                    }
                }

                // If upstream artifact has repoPath, read files from it
                if (inputs?.repoPath || inputs?.artifacts?.repoPath) {
                    consoleOutput.innerHTML += `<span class="text-blue-300">  📂 Reading files from cloned repo...</span><br>`;
                    try {
                        const repoPath = inputs.repoPath || inputs.artifacts.repoPath;
                        // For MVP, just read top-level or src .js files? 
                        // Let's read recursively .js files
                        const filePaths = await window.electronAPI.fileOps.listFiles(repoPath, 'js');
                        consoleOutput.innerHTML += `<span class="text-gray-400">    Found ${filePaths.length} JS files.</span><br>`;

                        // Limit to preventing memory boom if huge repo
                        const limitedFiles = filePaths.slice(0, 50);
                        if (filePaths.length > 50) {
                            consoleOutput.innerHTML += `<span class="text-yellow-400">    ⚠ Scanning first 50 files only.</span><br>`;
                        }

                        for (const fp of limitedFiles) {
                            const content = await window.electronAPI.fileOps.readFile(fp);
                            codeToScan += `\n\n// FILE: ${fp.split(/[\\/]/).pop()}\n${content}`;
                        }
                    } catch (e) {
                        consoleOutput.innerHTML += `<span class="text-red-400">    Error reading repo files: ${e.message}</span><br>`;
                    }
                }

                if (!codeToScan) {
                    consoleOutput.innerHTML += `<span class="text-yellow-400">  ⚠ No code to scan</span><br>`;
                    return { status: 'SUCCESS', message: 'No code to scan', vulnerabilities: [] };
                }

                const scanResult = await window.securityManager.runCodeScan(codeToScan, {
                    language: scanConfig.language || 'javascript',
                    scanTypes: scanConfig.scanTypes || ['sast', 'secrets']
                });

                const vulnCount = scanResult.summary?.total || 0;
                consoleOutput.innerHTML += `<span class="text-${vulnCount > 0 ? 'yellow' : 'green'}-400">  Found ${vulnCount} vulnerabilities</span><br>`;
                window.currentPipelineExecutionLog += `  Found ${vulnCount} vulnerabilities\n`;

                // Send security notification if configured
                if (window.integrationsManager && scanConfig.notify) {
                    await window.integrationsManager.sendSecurityNotification(scanResult);
                }

                context.lastSecurityResults = scanResult;
                return {
                    status: scanResult.policyPassed ? 'SUCCESS' : 'FAILURE',
                    message: `Security scan: ${vulnCount} vulnerabilities`,
                    securityResults: scanResult
                };
            }

            // Security Gate node
            if (nodeType === 'security-gate') {
                consoleOutput.innerHTML += `<span class="text-orange-400">  🚧 Checking Security Gate...</span><br>`;
                window.currentPipelineExecutionLog += `  🚧 Checking Security Gate...\n`;

                const gateConfig = node.data.config || {};
                const maxCritical = gateConfig.maxCritical ?? 0;
                const maxHigh = gateConfig.maxHigh ?? 5;
                const maxMedium = gateConfig.maxMedium ?? 20;

                // Gather security results from inputs
                const securityResults = inputs?.securityResults || context?.lastSecurityResults;

                if (!securityResults) {
                    consoleOutput.innerHTML += `<span class="text-yellow-400">  ⚠ No security scan results to check</span><br>`;
                    return { status: 'SUCCESS', message: 'No security results to gate' };
                }

                const critical = securityResults.summary?.critical || 0;
                const high = securityResults.summary?.high || 0;
                const medium = securityResults.summary?.medium || 0;

                const passed = critical <= maxCritical && high <= maxHigh && medium <= maxMedium;

                if (passed) {
                    consoleOutput.innerHTML += `<span class="text-green-400">  ✓ Security gate PASSED</span><br>`;
                    window.currentPipelineExecutionLog += `  ✓ Security gate PASSED\n`;
                    return { status: 'SUCCESS', message: 'Security gate passed' };
                } else {
                    consoleOutput.innerHTML += `<span class="text-red-500">  ✗ Security gate FAILED (C:${critical}/${maxCritical}, H:${high}/${maxHigh}, M:${medium}/${maxMedium})</span><br>`;
                    window.currentPipelineExecutionLog += `  ✗ Security gate FAILED\n`;
                    return { status: 'FAILURE', message: `Security gate failed: ${critical} critical, ${high} high, ${medium} medium` };
                }
            }

            // Default: Execute as test suite
            const suiteResult = await window.runTestSuite(node.data.suiteId, true, inputs);

            if (suiteResult.status === 'SUCCESS') {
                consoleOutput.innerHTML += `<span class="text-green-400">  ✓ PASS</span><br>`;
                window.currentPipelineExecutionLog += `  ✓ PASS\n`;
            } else {
                consoleOutput.innerHTML += `<span class="text-red-500">  ✗ FAIL: ${suiteResult.message || 'Unknown error'}</span><br>`;
                window.currentPipelineExecutionLog += `  ✗ FAIL: ${suiteResult.message || 'Unknown error'}\n`;
            }

            // Append suite details to master log
            if (suiteResult.log) {
                window.currentPipelineExecutionLog += `\n--- TEST SUITE LOG: ${node.data.name} ---\n${suiteResult.log}\n-----------------------------------\n\n`;
            }

            return suiteResult;
        });

        graphResult = result;

        consoleOutput.innerHTML += `<br><span class="text-white font-bold border-t border-gray-600 pt-2 block">Graph Execution Finished. Status: ${result.status}</span>`;
        window.currentPipelineExecutionLog += `\nGraph Execution Finished. Status: ${result.status}\nDuration: ${result.duration}ms\n`;

        pipeline.lastRun = new Date().toISOString();
        pipeline.lastStatus = result.status;
        savePipelines();

        if (result.status === 'SUCCESS') {
            statusBadge.className = "px-3 py-1 rounded-full text-sm font-bold bg-green-100 text-green-600";
            statusBadge.innerText = "SUCCESS";
            setPipelineRunMonitorState({ status: 'SUCCESS' });
        } else if (result.status === 'WARNING' || result.status === 'WARNINGS') {
            statusBadge.className = "px-3 py-1 rounded-full text-sm font-bold bg-yellow-100 text-yellow-600";
            statusBadge.innerText = "WARNINGS";
            setPipelineRunMonitorState({ status: 'WARNINGS' });
        } else {
            statusBadge.className = "px-3 py-1 rounded-full text-sm font-bold bg-red-100 text-red-600";
            statusBadge.innerText = "FAILURE";
            setPipelineRunMonitorState({ status: 'FAILURE' });
        }

    } catch (e) {
        console.error(e);
        consoleOutput.innerHTML += `<span class="text-red-600 font-bold">CRITICAL ENGINE ERROR: ${e.message}</span>`;
        statusBadge.innerText = "ERROR";
        setPipelineRunMonitorState({ status: 'ERROR' });
    } finally {
        if (activeRunnerNodes.length > 0) {
            const logWriteResult = await writeRunnerLogs(activeRunnerNodes, window.currentPipelineExecutionLog, graphResult?.results || {}, runnerPlan?.runnerAssignments);

            if (logWriteResult.savedPaths.length > 0) {
                consoleOutput.innerHTML += `<br><span class="text-lime-300">Saved runner logs:</span><br>`;
                logWriteResult.savedPaths.forEach(outputPath => {
                    consoleOutput.innerHTML += `<span class="text-lime-200 text-xs">${outputPath}</span><br>`;
                    window.currentPipelineExecutionLog += `Saved runner log: ${outputPath}\n`;
                });
            }

            if (logWriteResult.errors.length > 0) {
                logWriteResult.errors.forEach(error => {
                    consoleOutput.innerHTML += `<span class="text-yellow-300 text-xs">Could not save runner log: ${error.message}</span><br>`;
                    window.currentPipelineExecutionLog += `Failed to save runner log: ${error.message}\n`;
                });
            }
        }
    }
}

// Make global
window.initializePipelineManager = initializePipelineManager;
window.openPipelineEditor = openPipelineEditor;
window.openVisualPipelineEditor = openVisualPipelineEditor; // Exported
window.editPipeline = editPipeline;
window.deletePipeline = deletePipeline;
window.runPipeline = runPipeline;
window.runGraphPipeline = runGraphPipeline;
window.closePipelineEditor = closePipelineEditor;
window.savePipeline = savePipeline;
window.closePipelineRunModal = closePipelineRunModal;
window.minimizePipelineRunModal = minimizePipelineRunModal;
window.restorePipelineRunModal = restorePipelineRunModal;
window.loadPipelines = loadPipelines;
function escapeHtml(text) { if (text == null) return ''; const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }

// ============================================
// AI LOG SUMMARY MINIMIZE LOGIC
// ============================================

const activeAISummaries = new Map();

window.minimizeAILogSummary = function (node, summaryText, options) {
    const nodeId = node.id;
    activeAISummaries.set(nodeId, { node, summaryText, options });

    const modal = document.getElementById('ve-ai-log-summary-output-modal');
    if (modal) {
        modal.classList.add('hidden');
        document.body.classList.remove('modal-open');
    }

    // Add to minimize bar
    const container = document.getElementById('minimize-bar-items-container');
    const bar = document.getElementById('minimize-bar');
    if (!container || !bar) return;

    // Check if already exists
    if (document.getElementById(`minimized-ai-summary-${nodeId}`)) return;

    const item = document.createElement('div');
    item.className = 'minimized-test-item ai-summary-item';
    item.id = `minimized-ai-summary-${nodeId}`;
    item.onclick = (e) => {
        if (e.target.closest('.close-btn')) return;
        window.restoreAILogSummary(nodeId);
    };

    const displayName = node.data?.name || 'AI Summary';

    item.innerHTML = `
        <span class="mr-2">✨</span>
        <span class="font-semibold">${escapeHtml(displayName)}</span>
        <button class="close-btn" title="Close Summary" onclick="event.stopPropagation(); window.closeAILogSummary('${nodeId}')">
            &times;
        </button>
    `;

    container.appendChild(item);
    bar.classList.remove('hidden');
    document.body.style.paddingBottom = '4rem';
};

window.restoreAILogSummary = function (nodeId) {
    const summary = activeAISummaries.get(nodeId);
    if (!summary) return;

    if (window.visualEditor && typeof window.visualEditor.showAILogSummaryOutput === 'function') {
        window.visualEditor.showAILogSummaryOutput(summary.node, summary.summaryText, summary.options);
        document.body.classList.add('modal-open');
    }
};

window.closeAILogSummary = function (nodeId) {
    activeAISummaries.delete(nodeId);
    const item = document.getElementById(`minimized-ai-summary-${nodeId}`);
    if (item) item.remove();

    const modal = document.getElementById('ve-ai-log-summary-output-modal');
    if (modal) {
        modal.remove();
        document.body.classList.remove('modal-open');
    }

    const container = document.getElementById('minimize-bar-items-container');
    if (container && container.children.length === 0) {
        document.getElementById('minimize-bar').classList.add('hidden');
        document.body.style.paddingBottom = '0';
    }
};

// Legacy exports retained...
window.addNewStageToPipeline = addNewStageToPipeline;
window.addActionToSelectedStage = addActionToSelectedStage;
window.removeStage = removeStage;
window.removeAction = removeAction;
window.selectStage = selectStage;
window.updateStageLogic = updateStageLogic;
window.updateStageName = updateStageName;
window.updateStageName = updateStageName;
window.moveStage = moveStage;

// Log Download Feature
window.downloadPipelineLog = function () {
    if (!window.currentPipelineExecutionLog) {
        alert("No log data available.");
        return;
    }
    const blob = new Blob([window.currentPipelineExecutionLog], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pipeline_log_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
};

/**
 * Evaluate a comparison operator between two values.
 * Used by API test assertions and contract test validations.
 */
window.evaluateOperator = function(actual, operator, expected) {
  switch (operator) {
    case 'equals':       return actual == expected;
    case 'not-equals':   return actual != expected;
    case 'contains':     return String(actual).includes(String(expected));
    case 'not-contains': return !String(actual).includes(String(expected));
    case 'greater-than': return Number(actual) > Number(expected);
    case 'less-than':    return Number(actual) < Number(expected);
    case 'exists':       return actual !== null && actual !== undefined;
    case 'not-exists':   return actual === null || actual === undefined;
    case 'matches':      return new RegExp(expected).test(String(actual));
    default:             return actual == expected;
  }
}

/**
 * Simple JSONPath resolver. Supports dot notation and bracket notation.
 * e.g. getJsonPath({a: {b: [1,2,3]}}, '$.a.b[1]') => 2
 */
window.getJsonPath = function(obj, path) {
  if (!path || !obj) return undefined;
  const parts = path.replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Extract owner/repo from a GitHub URL.
 * e.g. "https://github.com/owner/repo.git" -> ["owner", "repo"]
 */
window.extractOwnerRepo = function(url) {
  const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  return match ? [match[1], match[2]] : ['unknown', 'unknown'];
}

/**
 * Extract project path from a GitLab URL.
 * e.g. "https://gitlab.com/group/subgroup/project.git" -> "group/subgroup/project"
 */
window.extractGitLabProject = function(url) {
  const match = url.match(/gitlab\.com[/:](.+?)(?:\.git)?$/);
  return match ? match[1] : '';
}
