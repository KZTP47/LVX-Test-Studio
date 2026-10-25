(function (root) {
    class MockBuilder {
        constructor() {
            this.modal = null;
            this.tabBar = null;
            this.content = null;
            this.status = null;
            this.activeTab = 'mocks';
            this.state = this.getDefaultState();
            this.onSave = null;
        }

        getDefaultState() {
            return {
                mocks: [],
                setupSteps: [],
                teardownSteps: [],
                fileData: {
                    filePath: '',
                    fileName: '',
                    fileType: '',
                    usageMode: 'per-row',
                    selectedRows: '',
                    sampleSize: '',
                    headers: [],
                    rows: [],
                    columnMappings: {}
                }
            };
        }

        getAvailableVariables() {
            return [
                {
                    token: 'random_id',
                    label: '{{random_id}}',
                    description: 'Numeric ID for fake records'
                },
                {
                    token: 'random_email',
                    label: '{{random_email}}',
                    description: 'Sample email address'
                },
                {
                    token: 'random_name',
                    label: '{{random_name}}',
                    description: 'Sample full name'
                },
                {
                    token: 'timestamp',
                    label: '{{timestamp}}',
                    description: 'Current timestamp'
                },
                {
                    token: 'uuid',
                    label: '{{uuid}}',
                    description: 'Unique identifier'
                },
                {
                    token: 'random_token',
                    label: '{{random_token}}',
                    description: 'API/session token'
                },
                {
                    token: 'random_number:1-100',
                    label: '{{random_number:1-100}}',
                    description: 'Random number inside a range'
                }
            ];
        }

        getMockTypeDescription(type) {
            const descriptions = {
                'api-response': 'Use this for HTTP/API replies such as login responses, error payloads, or JSON success messages.',
                'database-record': 'Use this for fake database rows or stored records before a test runs.',
                'user-input': 'Use this for fake form input, credentials, or user-submitted values.',
                'file-content': 'Use this for fake file contents such as CSV rows, reports, or uploaded documents.',
                'custom-object': 'Use this when you want to define your own data structure from scratch.'
            };

            return descriptions[type] || descriptions['custom-object'];
        }

        normalizeState(state) {
            const nextState = state && typeof state === 'object' ? state : {};
            return {
                mocks: Array.isArray(nextState.mocks) ? nextState.mocks.map((mock, index) => ({
                    id: mock?.id || `mock_${Date.now()}_${index}`,
                    name: mock?.name || `Mock ${index + 1}`,
                    type: mock?.type || 'api-response',
                    template: typeof mock?.template === 'string' && mock.template
                        ? mock.template
                        : this.getTemplateForType(mock?.type || 'api-response')
                })) : [],
                setupSteps: this.normalizeSteps(nextState.setupSteps, 'setup'),
                teardownSteps: this.normalizeSteps(nextState.teardownSteps, 'teardown'),
                fileData: this.normalizeFileData(nextState.fileData)
            };
        }

        normalizeFileData(fileData) {
            const nextFileData = fileData && typeof fileData === 'object' ? fileData : {};
            const headers = Array.isArray(nextFileData.headers)
                ? nextFileData.headers.map(header => String(header))
                : [];
            const rows = Array.isArray(nextFileData.rows)
                ? nextFileData.rows.map(row => {
                    if (!row || typeof row !== 'object' || Array.isArray(row)) {
                        return { value: String(row ?? '') };
                    }

                    const normalizedRow = {};
                    Object.keys(row).forEach(key => {
                        normalizedRow[String(key)] = row[key] == null ? '' : String(row[key]);
                    });
                    return normalizedRow;
                })
                : [];

            return {
                filePath: nextFileData.filePath || '',
                fileName: nextFileData.fileName || '',
                fileType: nextFileData.fileType || '',
                usageMode: nextFileData.usageMode || 'per-row',
                selectedRows: nextFileData.selectedRows || '',
                sampleSize: nextFileData.sampleSize || '',
                headers,
                rows,
                columnMappings: this.buildDefaultColumnMappings(
                    headers,
                    nextFileData.columnMappings && typeof nextFileData.columnMappings === 'object'
                        ? nextFileData.columnMappings
                        : {}
                )
            };
        }

        normalizeSteps(steps, kind = 'setup') {
            return Array.isArray(steps) ? steps.map((step, index) => {
                const normalizedStep = {
                    ...this.createDefaultStep(kind),
                    ...(step && typeof step === 'object' ? step : {}),
                    id: step?.id || `step_${Date.now()}_${index}`
                };

                const action = step?.action || normalizedStep.action || (kind === 'teardown' ? 'clear-test-data' : 'create-test-data');
                return this.normalizeStepByAction({
                    ...normalizedStep,
                    action
                });
            }) : [];
        }

        createDefaultStep(kind) {
            const action = kind === 'teardown' ? 'clear-test-data' : 'create-test-data';
            return this.normalizeStepByAction({
                id: `step_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
                action,
                target: '',
                value: '',
                notes: '',
                mockId: '',
                variableName: '',
                envName: '',
                envValue: '',
                language: 'python',
                code: '',
                delayMs: kind === 'teardown' ? '250' : '0',
                resetAll: kind === 'teardown',
                customAction: ''
            });
        }

        normalizeStepByAction(step) {
            const normalized = {
                target: '',
                value: '',
                notes: '',
                mockId: '',
                variableName: '',
                envName: '',
                envValue: '',
                language: 'python',
                code: '',
                delayMs: '0',
                resetAll: false,
                customAction: '',
                ...step
            };

            if (!normalized.variableName) {
                normalized.variableName = normalized.target || '';
            }

            if (!normalized.envName && normalized.action === 'set-environment') {
                normalized.envName = normalized.target || '';
            }

            if (!normalized.envValue && normalized.action === 'set-environment') {
                normalized.envValue = normalized.value || '';
            }

            if (!normalized.code && normalized.action === 'run-code') {
                normalized.code = normalized.value || '';
            }

            if ((normalized.delayMs === '' || normalized.delayMs == null) && normalized.action === 'wait') {
                normalized.delayMs = '1000';
            }

            if (normalized.action === 'reset-environment') {
                normalized.resetAll = normalized.resetAll !== false;
            }

            if (normalized.action === 'create-test-data' || normalized.action === 'clear-test-data') {
                normalized.target = normalized.variableName || normalized.target || '';
                normalized.value = normalized.notes || normalized.value || '';
            } else if (normalized.action === 'set-environment') {
                normalized.target = normalized.envName || normalized.target || '';
                normalized.value = normalized.envValue || normalized.value || '';
            } else if (normalized.action === 'run-code') {
                normalized.value = normalized.code || normalized.value || '';
            } else if (normalized.action === 'wait') {
                normalized.value = normalized.delayMs || normalized.value || '';
            } else if (normalized.action === 'custom') {
                normalized.value = normalized.customAction || normalized.notes || normalized.value || '';
            }

            return normalized;
        }

        getStepActionOptions(kind) {
            return kind === 'teardown'
                ? [
                    ['clear-test-data', 'Clear test data'],
                    ['reset-environment', 'Reset environment'],
                    ['run-code', 'Run code snippet'],
                    ['wait', 'Wait'],
                    ['custom', 'Custom action']
                ]
                : [
                    ['create-test-data', 'Create test data'],
                    ['set-environment', 'Set environment variable'],
                    ['run-code', 'Run code snippet'],
                    ['wait', 'Wait'],
                    ['custom', 'Custom action']
                ];
        }

        getStepActionHelp(action) {
            const help = {
                'create-test-data': 'Build fake data from one of your mock objects and save it into a named variable for the test.',
                'set-environment': 'Set an environment variable before the test starts, such as API_URL or FEATURE_FLAG.',
                'run-code': 'Run a small Python or JavaScript helper snippet as part of setup or cleanup.',
                'wait': 'Pause briefly before the next step. Useful when a system needs a moment to catch up.',
                'clear-test-data': 'Remove a variable created during setup so later tests start clean.',
                'reset-environment': 'Reset environment variables after the test. You can reset all setup variables at once.',
                'custom': 'Write a note or free-form instruction for a custom step you will wire in later.'
            };

            return help[action] || 'Choose what should happen in this step.';
        }

        getMockSelectOptions(selectedMockId) {
            const mockOptions = this.state.mocks.map(mock => {
                const label = mock.name || 'Untitled mock';
                return `<option value="${this.escapeHtml(mock.id)}" ${selectedMockId === mock.id ? 'selected' : ''}>${this.escapeHtml(label)}</option>`;
            }).join('');

            return `<option value="" ${selectedMockId ? '' : 'selected'}>${this.state.mocks.length ? 'Choose a mock object' : 'No mock objects created yet'}</option>${mockOptions}`;
        }

        sanitizeVariableName(value) {
            const sanitized = String(value || '')
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_+|_+$/g, '')
                .replace(/_+/g, '_');

            if (!sanitized) {
                return 'test_value';
            }

            return sanitized.startsWith('test_') ? sanitized : `test_${sanitized}`;
        }

        buildDefaultColumnMappings(headers, existingMappings = {}) {
            const normalizedMappings = {};
            headers.forEach(header => {
                normalizedMappings[header] = String(existingMappings[header] || '').trim() || this.sanitizeVariableName(header);
            });
            return normalizedMappings;
        }

        getTemplateForType(type) {
            const templates = {
                'api-response': `{\n  "status": 200,\n  "body": {\n    "user_id": "{{random_id}}",\n    "email": "{{random_email}}",\n    "token": "{{random_token}}"\n  }\n}`,
                'database-record': `{\n  "id": "{{random_id}}",\n  "email": "{{random_email}}",\n  "name": "{{random_name}}",\n  "role": "user"\n}`,
                'user-input': `{\n  "username": "{{random_name}}",\n  "email": "{{random_email}}",\n  "password": "Test123!"\n}`,
                'file-content': `Report generated at {{timestamp}}\nResult: SUCCESS`,
                'custom-object': `{\n  "key": "value"\n}`
            };

            return templates[type] || templates['custom-object'];
        }

        init() {
            if (this.modal) return;

            this.modal = document.getElementById('mock-builder-modal');
            this.tabBar = document.getElementById('mock-builder-tab-bar');
            this.content = document.getElementById('mock-builder-content');
            this.status = document.getElementById('mock-builder-status');
        }

        open(options = {}) {
            this.init();
            this.onSave = typeof options.onSave === 'function' ? options.onSave : null;
            this.state = this.normalizeState(options.state);
            this.activeTab = options.activeTab || 'mocks';
            this.render();
            this.modal?.classList.remove('hidden');
        }

        close() {
            this.modal?.classList.add('hidden');
        }

        save() {
            const normalized = this.normalizeState(this.state);
            this.state = normalized;
            if (this.onSave) this.onSave(normalized);
            if (root.showMessage) {
                root.showMessage('Mock Builder data applied to the current test.', 'success');
            }
            this.close();
        }

        switchTab(tabId) {
            this.activeTab = tabId;
            this.render();
        }

        addMock() {
            const index = this.state.mocks.length + 1;
            this.state.mocks.push({
                id: `mock_${Date.now()}_${index}`,
                name: `Mock ${index}`,
                type: 'api-response',
                template: this.getTemplateForType('api-response')
            });
            this.render();
        }

        updateMock(index, field, value) {
            const mock = this.state.mocks[index];
            if (!mock) return;
            const previousType = mock.type;
            mock[field] = value;
            if (field === 'type' && (!mock.template || mock.template === this.getTemplateForType(previousType))) {
                mock.template = this.getTemplateForType(value);
            }
        }

        insertVariableIntoText(text, token) {
            const variableToken = token.startsWith('{{') ? token : `{{${token}}}`;
            if (!text) return variableToken;

            if (text.endsWith('\n')) {
                return `${text}${variableToken}`;
            }

            return `${text}\n${variableToken}`;
        }

        insertVariableIntoMock(index, token) {
            const mock = this.state.mocks[index];
            if (!mock) return;
            mock.template = this.insertVariableIntoText(mock.template || '', token);
            this.render();
        }

        getPreviewValueForVariable(token) {
            const normalizedToken = String(token || '').trim();
            if (!normalizedToken) return '';

            const staticSamples = {
                random_id: '1042',
                random_email: 'alex.carter@example.test',
                random_name: 'Alex Carter',
                timestamp: '2026-03-28T14:45:00Z',
                uuid: '550e8400-e29b-41d4-a716-446655440000',
                random_token: 'tok_demo_9f3d2a7b1c'
            };

            if (Object.prototype.hasOwnProperty.call(staticSamples, normalizedToken)) {
                return staticSamples[normalizedToken];
            }

            if (normalizedToken.startsWith('random_number:')) {
                const range = normalizedToken.split(':')[1] || '';
                const [rawMin, rawMax] = range.split('-');
                const min = Number.parseInt(rawMin, 10);
                const max = Number.parseInt(rawMax, 10);
                if (Number.isFinite(min) && Number.isFinite(max) && max >= min) {
                    return String(Math.floor((min + max) / 2));
                }
            }

            return null;
        }

        findTemplateVariables(template) {
            const matches = String(template || '').match(/\{\{([^}]+)\}\}/g) || [];
            const seen = new Set();

            return matches
                .map(match => match.replace(/[{}]/g, '').trim())
                .filter(token => {
                    if (!token || seen.has(token)) return false;
                    seen.add(token);
                    return true;
                });
        }

        buildMockPreview(template) {
            const replaced = String(template || '').replace(/\{\{([^}]+)\}\}/g, (match, token) => {
                const previewValue = this.getPreviewValueForVariable(token);
                return previewValue == null ? match : previewValue;
            });

            const trimmed = replaced.trim();
            if (!trimmed) return '';

            if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                try {
                    return JSON.stringify(JSON.parse(replaced), null, 2);
                } catch (error) {
                    return replaced;
                }
            }

            return replaced;
        }

        duplicateMock(index) {
            const mock = this.state.mocks[index];
            if (!mock) return;
            this.state.mocks.splice(index + 1, 0, {
                ...mock,
                id: `mock_${Date.now()}_${index + 1}`,
                name: `${mock.name} Copy`
            });
            this.render();
        }

        deleteMock(index) {
            this.state.mocks.splice(index, 1);
            this.render();
        }

        addStep(kind) {
            const collection = kind === 'teardown' ? this.state.teardownSteps : this.state.setupSteps;
            collection.push(this.createDefaultStep(kind));
            this.render();
        }

        updateStep(kind, index, field, value) {
            const collection = kind === 'teardown' ? this.state.teardownSteps : this.state.setupSteps;
            if (!collection[index]) return;
            collection[index][field] = value;

            if (field === 'action') {
                const defaults = this.createDefaultStep(kind);
                collection[index] = this.normalizeStepByAction({
                    ...defaults,
                    ...collection[index],
                    id: collection[index].id,
                    action: value
                });
            } else {
                collection[index] = this.normalizeStepByAction(collection[index]);
            }
        }

        deleteStep(kind, index) {
            const collection = kind === 'teardown' ? this.state.teardownSteps : this.state.setupSteps;
            collection.splice(index, 1);
            this.render();
        }

        updateFileData(field, value) {
            this.state.fileData[field] = value;
        }

        updateColumnMapping(header, value) {
            if (!this.state.fileData.columnMappings || typeof this.state.fileData.columnMappings !== 'object') {
                this.state.fileData.columnMappings = {};
            }
            this.state.fileData.columnMappings[header] = value;
        }

        async handleFileSelection(file) {
            try {
                if (!root.dataManager || typeof root.dataManager.loadDataFromFile !== 'function') {
                    throw new Error('Data manager is not available for file loading');
                }

                const loaded = await root.dataManager.loadDataFromFile(file);
                this.state.fileData = this.normalizeFileData({
                    ...this.state.fileData,
                    filePath: file?.name || '',
                    fileName: loaded.fileName || file?.name || '',
                    fileType: loaded.fileType || '',
                    headers: loaded.headers || [],
                    rows: loaded.data || []
                });
                this.renderFilesTab();

                if (root.showMessage) {
                    root.showMessage(`Loaded ${this.state.fileData.fileName || 'data file'} with ${this.state.fileData.rows.length} row(s).`, 'success');
                }
            } catch (error) {
                if (root.showMessage) {
                    root.showMessage(`Failed to load data file: ${error.message}`, 'error');
                }
            }
        }

        parseSelectedRowsInput(input, maxRows) {
            if (!input) return [];

            const seen = new Set();
            return String(input)
                .split(/[\s,]+/)
                .map(value => Number.parseInt(value, 10))
                .filter(number => Number.isFinite(number) && number >= 1 && number <= maxRows)
                .filter(number => {
                    if (seen.has(number)) return false;
                    seen.add(number);
                    return true;
                })
                .map(number => number - 1);
        }

        getRowsForCurrentFileUsage() {
            const rows = Array.isArray(this.state.fileData.rows) ? this.state.fileData.rows : [];
            const usageMode = this.state.fileData.usageMode || 'per-row';

            if (usageMode === 'selected') {
                const selectedIndexes = this.parseSelectedRowsInput(this.state.fileData.selectedRows, rows.length);
                return selectedIndexes.map(index => rows[index]).filter(Boolean);
            }

            if (usageMode === 'sample') {
                const sampleSize = Number.parseInt(this.state.fileData.sampleSize, 10);
                if (Number.isFinite(sampleSize) && sampleSize > 0) {
                    return rows.slice(0, sampleSize);
                }
            }

            return rows;
        }

        getPreviewRows(maxRows = 5) {
            return this.getRowsForCurrentFileUsage().slice(0, maxRows);
        }

        renderFilePreviewTable(headers, rows) {
            if (!headers.length || !rows.length) {
                return `<div class="aero-input p-4 rounded-lg text-sm aero-text-muted">Load a CSV, Excel, JSON, or TXT file to preview the first rows here.</div>`;
            }

            const headerCells = headers.map(header => `<th class="px-3 py-2 text-left text-xs font-semibold aero-text-secondary border-b border-blue-200/40">${this.escapeHtml(header)}</th>`).join('');
            const rowMarkup = rows.map((row, rowIndex) => `
                <tr>
                    <td class="px-3 py-2 text-xs border-b border-blue-100/40 aero-text-muted">${rowIndex + 1}</td>
                    ${headers.map(header => `<td class="px-3 py-2 text-xs border-b border-blue-100/40 aero-text-primary">${this.escapeHtml(row[header] || '')}</td>`).join('')}
                </tr>
            `).join('');

            return `
                <div class="overflow-auto rounded-lg border border-blue-200/40">
                    <table class="min-w-full bg-white/60">
                        <thead>
                            <tr>
                                <th class="px-3 py-2 text-left text-xs font-semibold aero-text-secondary border-b border-blue-200/40">Row</th>
                                ${headerCells}
                            </tr>
                        </thead>
                        <tbody>${rowMarkup}</tbody>
                    </table>
                </div>
            `;
        }

        renderColumnMappingRows(headers, columnMappings) {
            if (!headers.length) {
                return `<div class="text-sm aero-text-muted">Load a file first, then each detected column will appear here for variable mapping.</div>`;
            }

            return headers.map((header, index) => `
                <div class="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 items-center border border-blue-100/40 rounded-lg p-3 mb-3">
                    <div>
                        <div class="text-sm font-medium aero-text-secondary">"${this.escapeHtml(header)}" column</div>
                        <div class="text-xs aero-text-muted mt-1">Use this value from the loaded file inside your test.</div>
                    </div>
                    <div class="text-center text-sm font-semibold aero-text-muted">→</div>
                    <div>
                        <label class="block text-xs font-medium aero-text-secondary mb-1">Variable name</label>
                        <input type="text" data-file-column-map="${index}" data-file-column-name="${this.escapeHtml(header)}" value="${this.escapeHtml(columnMappings[header] || '')}" class="w-full aero-input p-2 rounded-lg" placeholder="test_username">
                    </div>
                </div>
            `).join('');
        }

        renderMappedVariableHelp(columnMappings) {
            const mappings = Object.entries(columnMappings || {}).filter(([, value]) => String(value || '').trim());
            if (!mappings.length) {
                return `<div class="text-sm aero-text-muted">No mapped variables yet.</div>`;
            }

            return `
                <div class="space-y-2">
                    ${mappings.map(([, variable]) => `
                        <div class="text-sm aero-text-secondary">
                            <span class="font-mono">{{${this.escapeHtml(variable)}}}</span>
                        </div>
                    `).join('')}
                    <div class="text-xs aero-text-muted pt-1">These variables will be available for the later variable-resolution step in your test code.</div>
                </div>
            `;
        }

        render() {
            this.renderTabs();
            if (this.activeTab === 'mocks') {
                this.renderMocksTab();
            } else if (this.activeTab === 'steps') {
                this.renderStepsTab();
            } else {
                this.renderFilesTab();
            }

            if (this.status) {
                this.status.textContent = `${this.state.mocks.length} mock(s), ${this.state.setupSteps.length} setup step(s), ${this.state.teardownSteps.length} teardown step(s).`;
            }
        }

        renderTabs() {
            if (!this.tabBar) return;

            const tabs = [
                { id: 'mocks', label: 'Fake Data for Testing' },
                { id: 'steps', label: 'Before & After Test' },
                { id: 'files', label: 'Use Data from Files' }
            ];

            this.tabBar.innerHTML = tabs.map(tab => `
                <button type="button"
                    data-tab="${tab.id}"
                    class="py-2 px-4 rounded-t-lg text-sm font-semibold ${this.activeTab === tab.id ? 'aero-button-info aero-text-primary' : 'aero-button-gray'}">
                    ${tab.label}
                </button>
            `).join('');

            this.tabBar.querySelectorAll('[data-tab]').forEach(button => {
                button.onclick = () => this.switchTab(button.dataset.tab);
            });
        }

        renderMocksTab() {
            if (!this.content) return;

            const variableChips = this.getAvailableVariables().map(variable => `
                <button type="button" class="text-xs px-2 py-1 rounded-full border border-cyan-300/60 bg-cyan-500/10 hover:bg-cyan-500/20 aero-text-secondary" title="${this.escapeHtml(variable.description)}">
                    ${this.escapeHtml(variable.label)}
                </button>
            `).join('');

            const mockCards = this.state.mocks.map((mock, index) => `
                <div class="aero-glass-panel rounded-xl p-4 border border-blue-200/50 mb-4">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                        <div>
                            <label class="block text-sm font-medium aero-text-secondary mb-1">Name</label>
                            <input type="text" data-mock-name="${index}" value="${this.escapeHtml(mock.name)}" class="w-full aero-input p-2 rounded-lg">
                        </div>
                        <div>
                            <label class="block text-sm font-medium aero-text-secondary mb-1">Type</label>
                            <select data-mock-type="${index}" class="w-full aero-input p-2 rounded-lg">
                                ${this.renderOptions(mock.type)}
                            </select>
                            <p class="text-xs aero-text-muted mt-1">${this.escapeHtml(this.getMockTypeDescription(mock.type))}</p>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium aero-text-secondary mb-1">Template</label>
                            <textarea data-mock-template="${index}" rows="10" class="w-full aero-input p-3 rounded-lg font-mono text-sm">${this.escapeHtml(mock.template)}</textarea>
                            <div class="mt-3">
                                <div class="text-xs font-semibold aero-text-secondary mb-2">Click a variable to insert it:</div>
                                <div class="flex flex-wrap gap-2">
                                    ${this.getAvailableVariables().map(variable => `
                                        <button type="button"
                                            data-mock-insert="${index}"
                                            data-variable-token="${this.escapeHtml(variable.token)}"
                                            class="text-xs px-2 py-1 rounded-full border border-cyan-300/60 bg-cyan-500/10 hover:bg-cyan-500/20 aero-text-secondary"
                                            title="${this.escapeHtml(variable.description)}">
                                            ${this.escapeHtml(variable.label)}
                                        </button>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                        <div>
                            <label class="block text-sm font-medium aero-text-secondary mb-1">Live Preview</label>
                            <div class="w-full min-h-[240px] aero-input p-3 rounded-lg font-mono text-sm whitespace-pre-wrap">${this.escapeHtml(this.buildMockPreview(mock.template) || 'Preview will appear here as you type.')}</div>
                            <div class="mt-3 text-xs aero-text-muted">
                                Variables detected: ${this.findTemplateVariables(mock.template).map(token => this.escapeHtml(`{{${token}}}`)).join(', ') || 'none'}
                            </div>
                            <div class="mt-2 text-xs aero-text-muted">Preview uses sample values so non-technical users can see what the fake data will look like before saving.</div>
                        </div>
                    </div>
                    <div class="flex flex-wrap gap-2 mt-3">
                        <button type="button" data-mock-duplicate="${index}" class="aero-button-info text-xs py-1 px-3 rounded-lg">Duplicate</button>
                        <button type="button" data-mock-delete="${index}" class="aero-button-danger text-xs py-1 px-3 rounded-lg">Delete</button>
                    </div>
                </div>
            `).join('');

            this.content.innerHTML = `
                <div class="space-y-4">
                    <div class="flex items-start justify-between gap-4">
                        <div>
                            <h3 class="text-xl font-semibold aero-text-primary">Fake Data for Testing</h3>
                            <p class="text-sm aero-text-muted mt-1">Create reusable responses, records, and user-input examples. Use variables like {{random_id}}, {{uuid}}, {{timestamp}}, and {{random_email}}.</p>
                        </div>
                        <button type="button" id="mock-builder-add-mock" class="aero-button-success py-2 px-4 rounded-lg">+ Add Mock Object</button>
                    </div>
                    <div class="aero-glass-panel rounded-xl p-4">
                        <div class="text-sm font-semibold aero-text-secondary mb-2">Available Variables</div>
                        <div class="flex flex-wrap gap-2 mb-2">${variableChips}</div>
                        <div class="text-xs aero-text-muted">Use the insert buttons inside each mock card to place these variables into your template.</div>
                    </div>
                    ${mockCards || `<div class="aero-glass-panel rounded-xl p-6 text-sm aero-text-muted">No mock objects yet. Add one to start building fake data for your tests.</div>`}
                </div>
            `;

            const addBtn = this.content.querySelector('#mock-builder-add-mock');
            if (addBtn) addBtn.onclick = () => this.addMock();

            this.content.querySelectorAll('[data-mock-name]').forEach(input => {
                input.oninput = () => this.updateMock(parseInt(input.dataset.mockName, 10), 'name', input.value);
            });
            this.content.querySelectorAll('[data-mock-type]').forEach(select => {
                select.onchange = () => {
                    this.updateMock(parseInt(select.dataset.mockType, 10), 'type', select.value);
                    this.render();
                };
            });
            this.content.querySelectorAll('[data-mock-template]').forEach(textarea => {
                textarea.oninput = () => {
                    this.updateMock(parseInt(textarea.dataset.mockTemplate, 10), 'template', textarea.value);
                    this.render();
                };
            });
            this.content.querySelectorAll('[data-mock-insert]').forEach(button => {
                button.onclick = () => this.insertVariableIntoMock(
                    parseInt(button.dataset.mockInsert, 10),
                    button.dataset.variableToken || ''
                );
            });
            this.content.querySelectorAll('[data-mock-duplicate]').forEach(button => {
                button.onclick = () => this.duplicateMock(parseInt(button.dataset.mockDuplicate, 10));
            });
            this.content.querySelectorAll('[data-mock-delete]').forEach(button => {
                button.onclick = () => this.deleteMock(parseInt(button.dataset.mockDelete, 10));
            });
        }

        renderStepsTab() {
            if (!this.content) return;

            const availableSetupActions = this.getStepActionOptions('setup').map(([, label]) => label).join(', ');
            const availableTeardownActions = this.getStepActionOptions('teardown').map(([, label]) => label).join(', ');

            this.content.innerHTML = `
                <div class="space-y-5">
                    <div class="aero-glass-panel rounded-xl p-4">
                        <h3 class="text-xl font-semibold aero-text-primary">Before & After Test</h3>
                        <p class="text-sm aero-text-muted mt-1">Guide non-technical users through what should happen before each test begins and after each test finishes.</p>
                        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4 text-sm">
                            <div class="aero-input rounded-lg p-3">
                                <div class="font-semibold aero-text-secondary mb-1">Setup actions</div>
                                <div class="aero-text-muted">${this.escapeHtml(availableSetupActions)}</div>
                            </div>
                            <div class="aero-input rounded-lg p-3">
                                <div class="font-semibold aero-text-secondary mb-1">Teardown actions</div>
                                <div class="aero-text-muted">${this.escapeHtml(availableTeardownActions)}</div>
                            </div>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <section class="aero-glass-panel rounded-xl p-4">
                        <div class="flex items-start justify-between gap-4 mb-4">
                            <div>
                                <h3 class="text-lg font-semibold aero-text-primary">What should happen BEFORE each test?</h3>
                                <p class="text-sm aero-text-muted mt-1">Setup steps run in order before the test starts.</p>
                            </div>
                            <button type="button" id="mock-builder-add-setup" class="aero-button-success text-sm py-2 px-3 rounded-lg">+ Add Setup Step</button>
                        </div>
                        ${this.renderStepCards('setup', this.state.setupSteps)}
                    </section>
                    <section class="aero-glass-panel rounded-xl p-4">
                        <div class="flex items-start justify-between gap-4 mb-4">
                            <div>
                                <h3 class="text-lg font-semibold aero-text-primary">What should happen AFTER each test?</h3>
                                <p class="text-sm aero-text-muted mt-1">Teardown steps clean up after the test finishes.</p>
                            </div>
                            <button type="button" id="mock-builder-add-teardown" class="aero-button-info text-sm py-2 px-3 rounded-lg">+ Add Teardown Step</button>
                        </div>
                        ${this.renderStepCards('teardown', this.state.teardownSteps)}
                    </section>
                    </div>
                </div>
            `;

            const addSetupBtn = this.content.querySelector('#mock-builder-add-setup');
            if (addSetupBtn) addSetupBtn.onclick = () => this.addStep('setup');
            const addTeardownBtn = this.content.querySelector('#mock-builder-add-teardown');
            if (addTeardownBtn) addTeardownBtn.onclick = () => this.addStep('teardown');

            this.bindStepEvents('setup');
            this.bindStepEvents('teardown');
        }

        renderStepCards(kind, steps) {
            if (!steps.length) {
                return `<div class="text-sm aero-text-muted">No ${kind} steps yet. Add one to guide what happens ${kind === 'setup' ? 'before' : 'after'} the test.</div>`;
            }

            return steps.map((step, index) => `
                <div class="border border-blue-200/50 rounded-xl p-4 mb-3">
                    <div class="flex items-start justify-between gap-4 mb-3">
                        <div>
                            <div class="text-xs font-semibold uppercase tracking-wide aero-text-muted">Step ${index + 1}</div>
                            <div class="text-sm aero-text-muted mt-1">${this.escapeHtml(this.getStepActionHelp(step.action))}</div>
                        </div>
                        <button type="button" data-${kind}-delete="${index}" class="aero-button-danger text-xs py-1 px-3 rounded-lg">Delete</button>
                    </div>
                    <div class="grid grid-cols-1 gap-3">
                        <div>
                            <label class="block text-sm font-medium aero-text-secondary mb-1">Action</label>
                            <select data-${kind}-action="${index}" class="w-full aero-input p-2 rounded-lg">
                                ${this.renderStepOptions(step.action, kind)}
                            </select>
                        </div>
                        ${this.renderStepFields(kind, step, index)}
                    </div>
                </div>
            `).join('');
        }

        renderStepFields(kind, step, index) {
            if (step.action === 'create-test-data') {
                return `
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label class="block text-sm font-medium aero-text-secondary mb-1">Use mock</label>
                            <select data-${kind}-mock-id="${index}" class="w-full aero-input p-2 rounded-lg">
                                ${this.getMockSelectOptions(step.mockId)}
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium aero-text-secondary mb-1">Save as variable</label>
                            <input type="text" data-${kind}-variable-name="${index}" value="${this.escapeHtml(step.variableName)}" class="w-full aero-input p-2 rounded-lg" placeholder="test_user">
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm font-medium aero-text-secondary mb-1">Notes</label>
                        <textarea data-${kind}-notes="${index}" rows="2" class="w-full aero-input p-2 rounded-lg" placeholder="Optional reminder for what this mock is used for.">${this.escapeHtml(step.notes)}</textarea>
                    </div>
                `;
            }

            if (step.action === 'set-environment') {
                return `
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label class="block text-sm font-medium aero-text-secondary mb-1">Variable name</label>
                            <input type="text" data-${kind}-env-name="${index}" value="${this.escapeHtml(step.envName)}" class="w-full aero-input p-2 rounded-lg" placeholder="API_URL">
                        </div>
                        <div>
                            <label class="block text-sm font-medium aero-text-secondary mb-1">Value</label>
                            <input type="text" data-${kind}-env-value="${index}" value="${this.escapeHtml(step.envValue)}" class="w-full aero-input p-2 rounded-lg" placeholder="https://demo.example.test">
                        </div>
                    </div>
                `;
            }

            if (step.action === 'run-code') {
                return `
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div class="md:col-span-1">
                            <label class="block text-sm font-medium aero-text-secondary mb-1">Language</label>
                            <select data-${kind}-language="${index}" class="w-full aero-input p-2 rounded-lg">
                                <option value="python" ${step.language === 'python' ? 'selected' : ''}>Python</option>
                                <option value="javascript" ${step.language === 'javascript' ? 'selected' : ''}>JavaScript</option>
                            </select>
                        </div>
                        <div class="md:col-span-2">
                            <label class="block text-sm font-medium aero-text-secondary mb-1">Code snippet</label>
                            <textarea data-${kind}-code="${index}" rows="4" class="w-full aero-input p-2 rounded-lg font-mono text-sm" placeholder="print(&quot;prepare test data&quot;)">${this.escapeHtml(step.code)}</textarea>
                        </div>
                    </div>
                `;
            }

            if (step.action === 'wait') {
                return `
                    <div>
                        <label class="block text-sm font-medium aero-text-secondary mb-1">Wait time in milliseconds</label>
                        <input type="number" data-${kind}-delay-ms="${index}" value="${this.escapeHtml(step.delayMs)}" min="0" step="50" class="w-full aero-input p-2 rounded-lg" placeholder="1000">
                    </div>
                `;
            }

            if (step.action === 'clear-test-data') {
                return `
                    <div>
                        <label class="block text-sm font-medium aero-text-secondary mb-1">Variable to clear</label>
                        <input type="text" data-${kind}-variable-name="${index}" value="${this.escapeHtml(step.variableName)}" class="w-full aero-input p-2 rounded-lg" placeholder="test_user">
                    </div>
                `;
            }

            if (step.action === 'reset-environment') {
                return `
                    <div class="aero-input rounded-lg p-3">
                        <label class="flex items-start gap-3">
                            <input type="checkbox" data-${kind}-reset-all="${index}" ${step.resetAll ? 'checked' : ''} class="mt-1">
                            <span>
                                <span class="block text-sm font-medium aero-text-secondary">Reset all variables set in setup</span>
                                <span class="block text-xs aero-text-muted mt-1">Turn this off if you only want to document the cleanup without resetting every setup variable.</span>
                            </span>
                        </label>
                    </div>
                `;
            }

            return `
                <div>
                    <label class="block text-sm font-medium aero-text-secondary mb-1">Custom action notes</label>
                    <textarea data-${kind}-custom-action="${index}" rows="4" class="w-full aero-input p-2 rounded-lg" placeholder="Describe the manual or custom action that should happen here.">${this.escapeHtml(step.customAction || step.notes || '')}</textarea>
                </div>
            `;
        }

        bindStepEvents(kind) {
            this.content.querySelectorAll(`[data-${kind}-action]`).forEach(select => {
                select.onchange = () => {
                    this.updateStep(kind, parseInt(select.dataset[`${kind}Action`], 10), 'action', select.value);
                    this.renderStepsTab();
                };
            });
            this.content.querySelectorAll(`[data-${kind}-mock-id]`).forEach(select => {
                select.onchange = () => this.updateStep(kind, parseInt(select.dataset[`${kind}MockId`], 10), 'mockId', select.value);
            });
            this.content.querySelectorAll(`[data-${kind}-variable-name]`).forEach(input => {
                input.oninput = () => this.updateStep(kind, parseInt(input.dataset[`${kind}VariableName`], 10), 'variableName', input.value);
            });
            this.content.querySelectorAll(`[data-${kind}-env-name]`).forEach(input => {
                input.oninput = () => this.updateStep(kind, parseInt(input.dataset[`${kind}EnvName`], 10), 'envName', input.value);
            });
            this.content.querySelectorAll(`[data-${kind}-env-value]`).forEach(input => {
                input.oninput = () => this.updateStep(kind, parseInt(input.dataset[`${kind}EnvValue`], 10), 'envValue', input.value);
            });
            this.content.querySelectorAll(`[data-${kind}-language]`).forEach(select => {
                select.onchange = () => this.updateStep(kind, parseInt(select.dataset[`${kind}Language`], 10), 'language', select.value);
            });
            this.content.querySelectorAll(`[data-${kind}-code]`).forEach(textarea => {
                textarea.oninput = () => this.updateStep(kind, parseInt(textarea.dataset[`${kind}Code`], 10), 'code', textarea.value);
            });
            this.content.querySelectorAll(`[data-${kind}-delay-ms]`).forEach(input => {
                input.oninput = () => this.updateStep(kind, parseInt(input.dataset[`${kind}DelayMs`], 10), 'delayMs', input.value);
            });
            this.content.querySelectorAll(`[data-${kind}-reset-all]`).forEach(input => {
                input.onchange = () => this.updateStep(kind, parseInt(input.dataset[`${kind}ResetAll`], 10), 'resetAll', !!input.checked);
            });
            this.content.querySelectorAll(`[data-${kind}-notes]`).forEach(textarea => {
                textarea.oninput = () => this.updateStep(kind, parseInt(textarea.dataset[`${kind}Notes`], 10), 'notes', textarea.value);
            });
            this.content.querySelectorAll(`[data-${kind}-custom-action]`).forEach(textarea => {
                textarea.oninput = () => this.updateStep(kind, parseInt(textarea.dataset[`${kind}CustomAction`], 10), 'customAction', textarea.value);
            });
            this.content.querySelectorAll(`[data-${kind}-delete]`).forEach(button => {
                button.onclick = () => this.deleteStep(kind, parseInt(button.dataset[`${kind}Delete`], 10));
            });
        }

        renderFilesTab() {
            if (!this.content) return;

            const fileData = this.state.fileData;
            const previewRows = this.getPreviewRows(5);
            const loadedRowCount = Array.isArray(fileData.rows) ? fileData.rows.length : 0;
            const mappedCount = Object.values(fileData.columnMappings || {}).filter(value => String(value || '').trim()).length;

            this.content.innerHTML = `
                <div class="space-y-5">
                    <div>
                        <h3 class="text-xl font-semibold aero-text-primary">Use Data from Files</h3>
                        <p class="text-sm aero-text-muted mt-1">Load a CSV, Excel, JSON, or TXT file, preview the rows, and map columns to test variables.</p>
                    </div>
                    <div class="aero-glass-panel rounded-xl p-4 space-y-4">
                        <div class="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
                            <div>
                                <label class="block text-sm font-medium aero-text-secondary mb-1">Choose file</label>
                                <input type="text" id="mock-builder-file-path" value="${this.escapeHtml(fileData.filePath || fileData.fileName || '')}" readonly class="w-full aero-input p-2 rounded-lg" placeholder="No file loaded yet">
                                <p class="text-xs aero-text-muted mt-1">Supported: CSV, Excel (.xlsx, .xls), JSON, TXT</p>
                            </div>
                            <div class="flex gap-2">
                                <input type="file" id="mock-builder-file-input" accept=".csv,.xlsx,.xls,.json,.txt" class="hidden">
                                <button type="button" id="mock-builder-browse-file" class="aero-button-info py-2 px-4 rounded-lg">Browse</button>
                            </div>
                        </div>
                        <div class="aero-input p-3 rounded-lg text-sm">
                            <div class="font-semibold aero-text-secondary">Loaded file</div>
                            <div class="aero-text-primary mt-1">${this.escapeHtml(fileData.fileName || 'No file loaded')}</div>
                            <div class="text-xs aero-text-muted mt-1">
                                ${loadedRowCount} row(s) • ${fileData.headers.length} column(s) • ${this.escapeHtml((fileData.fileType || 'unknown').toUpperCase())}
                            </div>
                        </div>
                        <div>
                            <label class="block text-sm font-medium aero-text-secondary mb-2">Preview (first 5 rows)</label>
                            ${this.renderFilePreviewTable(fileData.headers, previewRows)}
                        </div>
                        <div>
                            <label class="block text-sm font-medium aero-text-secondary mb-1">How should this data be used?</label>
                            <select id="mock-builder-usage-mode" class="w-full aero-input p-2 rounded-lg">
                                <option value="all" ${fileData.usageMode === 'all' ? 'selected' : ''}>Run once with all rows as one input</option>
                                <option value="per-row" ${fileData.usageMode === 'per-row' ? 'selected' : ''}>Run once per row</option>
                                <option value="selected" ${fileData.usageMode === 'selected' ? 'selected' : ''}>Use specific rows</option>
                                <option value="sample" ${fileData.usageMode === 'sample' ? 'selected' : ''}>Use a sample of rows</option>
                            </select>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium aero-text-secondary mb-1">Selected rows</label>
                                <input type="text" id="mock-builder-selected-rows" value="${this.escapeHtml(fileData.selectedRows || '')}" placeholder="1, 3, 5" class="w-full aero-input p-2 rounded-lg">
                                <p class="text-xs aero-text-muted mt-1">Used when “Use specific rows” is selected.</p>
                            </div>
                            <div>
                                <label class="block text-sm font-medium aero-text-secondary mb-1">Sample size</label>
                                <input type="number" id="mock-builder-sample-size" value="${this.escapeHtml(fileData.sampleSize || '')}" min="1" class="w-full aero-input p-2 rounded-lg">
                                <p class="text-xs aero-text-muted mt-1">Used when “Use a sample of rows” is selected.</p>
                            </div>
                        </div>
                        <div class="aero-glass-panel rounded-xl p-4">
                            <div class="flex items-start justify-between gap-4 mb-3">
                                <div>
                                    <h4 class="text-lg font-semibold aero-text-primary">Column Mapping</h4>
                                    <p class="text-sm aero-text-muted mt-1">Map each file column to the variable name you want to use inside the test.</p>
                                </div>
                                <div class="text-xs aero-text-muted">${mappedCount} mapped variable(s)</div>
                            </div>
                            ${this.renderColumnMappingRows(fileData.headers, fileData.columnMappings)}
                        </div>
                        <div class="aero-glass-panel rounded-xl p-4">
                            <h4 class="text-lg font-semibold aero-text-primary">Variables available to the test</h4>
                            <div class="mt-3">${this.renderMappedVariableHelp(fileData.columnMappings)}</div>
                        </div>
                    </div>
                </div>
            `;

            const filePath = this.content.querySelector('#mock-builder-file-path');
            if (filePath) filePath.oninput = () => this.updateFileData('filePath', filePath.value);

            const browseButton = this.content.querySelector('#mock-builder-browse-file');
            const fileInput = this.content.querySelector('#mock-builder-file-input');
            if (browseButton && fileInput) {
                browseButton.onclick = () => {
                    if (typeof fileInput.click === 'function') {
                        fileInput.click();
                    }
                };
                fileInput.onchange = async () => {
                    const selectedFile = fileInput.files && fileInput.files[0];
                    if (selectedFile) {
                        await this.handleFileSelection(selectedFile);
                    }
                };
            }

            const usageMode = this.content.querySelector('#mock-builder-usage-mode');
            if (usageMode) usageMode.onchange = () => {
                this.updateFileData('usageMode', usageMode.value);
                this.renderFilesTab();
            };

            const selectedRows = this.content.querySelector('#mock-builder-selected-rows');
            if (selectedRows) selectedRows.oninput = () => {
                this.updateFileData('selectedRows', selectedRows.value);
                this.renderFilesTab();
            };

            const sampleSize = this.content.querySelector('#mock-builder-sample-size');
            if (sampleSize) sampleSize.oninput = () => {
                this.updateFileData('sampleSize', sampleSize.value);
                this.renderFilesTab();
            };

            this.content.querySelectorAll('[data-file-column-map]').forEach(input => {
                input.oninput = () => {
                    const header = input.dataset.fileColumnName || '';
                    this.updateColumnMapping(header, input.value);
                    this.renderFilesTab();
                };
            });
        }

        renderOptions(selectedType) {
            const options = [
                ['api-response', 'API Response'],
                ['database-record', 'Database Record'],
                ['user-input', 'User Input'],
                ['file-content', 'File Content'],
                ['custom-object', 'Custom Object']
            ];

            return options.map(([value, label]) =>
                `<option value="${value}" ${selectedType === value ? 'selected' : ''}>${label}</option>`
            ).join('');
        }

        renderStepOptions(selectedAction, kind) {
            const options = this.getStepActionOptions(kind);

            return options.map(([value, label]) =>
                `<option value="${value}" ${selectedAction === value ? 'selected' : ''}>${label}</option>`
            ).join('');
        }

        escapeHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }
    }

    root.MockBuilder = MockBuilder;
    root.mockBuilder = new MockBuilder();
    root.closeMockBuilder = function closeMockBuilder() {
        if (root.mockBuilder) root.mockBuilder.close();
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
