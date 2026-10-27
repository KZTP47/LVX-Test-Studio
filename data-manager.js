class DataManager {
    constructor() {
        this.STORAGE_KEY = 'test_data_sets';
    }

    // Save a data set
    saveDataSet(dataSet) {
        const dataSets = this.getAllDataSets();
        dataSet.id = dataSet.id || this._generateId();
        dataSet.created = dataSet.created || new Date().toISOString();
        dataSet.modified = new Date().toISOString();
        dataSets.push(dataSet);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(dataSets));
        return dataSet.id;
    }

    // Get all data sets
    getAllDataSets() {
        const data = localStorage.getItem(this.STORAGE_KEY);
        return data ? JSON.parse(data) : [];
    }

    // Get data set by ID
    getDataSet(id) {
        return this.getAllDataSets().find(ds => ds.id === id);
    }

    // Update data set
    updateDataSet(id, updates) {
        const dataSets = this.getAllDataSets();
        const index = dataSets.findIndex(ds => ds.id === id);
        if (index !== -1) {
            dataSets[index] = { ...dataSets[index], ...updates, modified: new Date().toISOString() };
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(dataSets));
        }
    }

    // Delete data set
    deleteDataSet(id) {
        const dataSets = this.getAllDataSets().filter(ds => ds.id !== id);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(dataSets));
    }

    // Parse complete logical records, preserving whitespace and newlines inside quotes.
    parseCSV(csvContent) {
        const records = [];
        let row = [], value = '', quoted = false, closed = false;
        const text = String(csvContent).replace(/^\uFEFF/, '');
        const field = () => { row.push(value); value = ''; closed = false; };
        const record = () => { field(); records.push(row); row = []; };
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (quoted) {
                if (c === '"' && text[i + 1] === '"') { value += '"'; i++; }
                else if (c === '"') { quoted = false; closed = true; }
                else value += c;
            } else if (c === ',') field();
            else if (c === '\n' || c === '\r') {
                if (c === '\r' && text[i + 1] === '\n') i++;
                record();
            } else if (c === '"' && value === '' && !closed) quoted = true;
            else {
                if (closed || c === '"') throw new Error('Malformed CSV quoted field');
                value += c;
            }
        }
        if (quoted) throw new Error('Unterminated CSV quoted field');
        if (value !== '' || row.length || closed) record();
        if (records.length < 2) throw new Error('CSV must have a header and at least one data row');
        const headers = records.shift();
        if (headers.some(h => !h.trim()) || new Set(headers).size !== headers.length) {
            throw new Error('CSV headers must be nonempty and unique');
        }
        const data = records.map((values, index) => {
            if (values.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${values.length} fields; expected ${headers.length}`);
            return Object.fromEntries(headers.map((h, i) => [h, values[i]]));
        });
        if (!data.length) throw new Error('CSV must have at least one data row');
        return { headers, data };
    }

    serializeCSV(headers, data) {
        const escape = value => {
            const text = value == null ? '' : String(value);
            return text === '' || /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
        };
        return [headers.map(escape).join(','), ...data.map(row => headers.map(h => escape(row[h])).join(','))].join('\n');
    }

    // Desktop validation streams files directly from the selected workspace. These
    // helpers also let existing dataset screens use the same typed contracts.
    async typedAction(action, payload) {
        if (!window.electronAPI?.studioOps?.invoke) throw new Error('Typed dataset tools need the desktop app and a selected workspace.');
        return window.electronAPI.studioOps.invoke('workspace', action, payload);
    }

    validateTypedDataSet(id, schema) {
        const dataset = this.getDataSet(id);
        if (!dataset) throw new Error('Data set was not found.');
        return this.typedAction('validateDataset', { rows: dataset.data, schema });
    }

    generateTypedDataSet(schema, count, seed) {
        return this.typedAction('generateDataset', { schema, count, seed });
    }

    maskTypedDataSet(id, columns, seed) {
        const dataset = this.getDataSet(id);
        if (!dataset) throw new Error('Data set was not found.');
        // Returns a separate masked copy. Private source data is never overwritten
        // by merely previewing the masking operation.
        return this.typedAction('maskDataset', { rows: dataset.data, columns, seed });
    }

    async parseCSVFile(file, { maxRows = 0 } = {}) {
        if (!Number.isSafeInteger(maxRows) || maxRows < 0) throw new Error('Row budget must be a nonnegative safe integer; 0 means all rows.');
        if (typeof file.stream !== 'function') {
            const parsed = this.parseCSV(await file.text());
            if (maxRows && parsed.data.length > maxRows) throw new Error('This CSV is too large for the editor. Use streaming workspace validation.');
            return parsed;
        }
        const reader = file.stream().getReader();
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let headers, row = [], field = '', state = 'plain', skipLF = false, first = true, touched = false;
        const data = [];
        const push = () => {
            row.push(field); field = ''; state = 'plain';
        };
        const record = () => {
            push();
            if (!headers) {
                headers = row;
                if (headers.some(h => !h.trim()) || new Set(headers).size !== headers.length) throw new Error('CSV headers must be nonempty and unique');
            } else {
                if (row.length !== headers.length) throw new Error(`CSV row ${data.length + 2} has ${row.length} fields; expected ${headers.length}`);
                if (maxRows && data.length >= maxRows) throw new Error('This CSV is too large for the editor. Use streaming workspace validation.');
                data.push(Object.fromEntries(headers.map((name, i) => [name, row[i]])));
            }
            row = []; touched = false;
        };
        const consume = text => {
            for (const c of text) {
                if (first) { first = false; if (c === '\uFEFF') continue; }
                if (skipLF) { skipLF = false; if (c === '\n') continue; }
                touched = true;
                if (state === 'quoted') { if (c === '"') state = 'closed'; else field += c; }
                else if (state === 'closed' && c === '"') { field += '"'; state = 'quoted'; }
                else if (c === ',') push();
                else if (c === '\r' || c === '\n') { record(); if (c === '\r') skipLF = true; }
                else if (state === 'closed') throw new Error('Malformed CSV quoted field');
                else if (c === '"') { if (field !== '') throw new Error('Malformed CSV quoted field'); state = 'quoted'; }
                else field += c;
            }
        };
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                consume(decoder.decode(value, { stream: true }));
            }
            consume(decoder.decode());
            if (state === 'quoted') throw new Error('Unterminated CSV quoted field');
            if (touched || row.length || field !== '' || state === 'closed') record();
            if (!headers || !data.length) throw new Error('CSV must have a header and at least one data row');
            return { headers, data };
        } catch (error) { await reader.cancel().catch(() => {}); throw error; }
        finally { reader.releaseLock(); }
    }

    // Parse Excel file (using SheetJS library)
    async parseExcel(file) {
        // This will use SheetJS library loaded via CDN
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const excelData = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(excelData, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

                    if (jsonData.length < 2) {
                        throw new Error('Excel must have at least a header row and one data row');
                    }

                    const headers = jsonData[0];
                    const sheetData = jsonData.slice(1).filter(row => row.length > 0).map(row => {
                        const obj = {};
                        headers.forEach((header, index) => {
                            obj[header] = row[index] !== undefined ? String(row[index]) : '';
                        });
                        return obj;
                    });

                    resolve({ headers, data: sheetData });
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }

    // Generate test data using faker patterns
    generateFakerData(pattern, count) {
        // Patterns like: {{firstName}}, {{email}}, {{number:1:100}}
        if (!Number.isSafeInteger(count) || count < 1) throw new Error('Row count must be a positive safe integer.');
        const data = [];
        for (let i = 0; i < count; i++) {
            const row = { index: i + 1 };

            // Parse pattern and generate values
            const matches = pattern.match(/\{\{(\w+)(?::([^}]+))?\}\}/g);
            if (matches) {
                matches.forEach(match => {
                    const [, type, params] = match.match(/\{\{(\w+)(?::([^}]+))?\}\}/) || [];
                    const value = this._generateFakerValue(type, params);
                    row[type] = value;
                });
            }

            data.push(row);
        }

        return data;
    }

    _generateFakerValue(type, params) {
        // Simple faker implementation
        const fakerFunctions = {
            firstName: () => ['John', 'Jane', 'Alice', 'Bob', 'Charlie', 'Diana'][Math.floor(Math.random() * 6)],
            lastName: () => ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia'][Math.floor(Math.random() * 6)],
            email: () => `user${Math.floor(Math.random() * 10000)}@example.com`,
            phone: () => `555-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`,
            number: (params) => {
                const [min, max] = params ? params.split(':').map(Number) : [1, 100];
                return Math.floor(Math.random() * (max - min + 1)) + min;
            },
            text: () => ['Lorem ipsum', 'Test data', 'Sample text', 'Example'][Math.floor(Math.random() * 4)],
            boolean: () => Math.random() > 0.5 ? 'true' : 'false',
            date: () => new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        };

        return fakerFunctions[type] ? fakerFunctions[type](params) : type;
    }

    // Replace variables in text with data row values
    replaceVariables(text, dataRow) {
        if (!dataRow) return text;

        let result = text;
        Object.keys(dataRow).forEach(key => {
            result = result.split('${' + key + '}').join(String(dataRow[key] ?? ''));
        });

        return result;
    }

    _generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }
}

// Export
window.DataManager = DataManager;
window.dataManager = new DataManager();

function dataHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function dataArgument(value) { return dataHTML(JSON.stringify(String(value))); }

// UI state
let currentUploadedData = null;
let dataUploadGeneration = 0;
let selectedDataSetId = null;

// Open/Close Data Set Manager
function openDataSetManager() {
    renderDataSetsList();
    document.getElementById('data-set-manager-modal').classList.remove('hidden');
}

function closeDataSetManager() {
    document.getElementById('data-set-manager-modal').classList.add('hidden');
    // Refresh data set dropdown in editor
    updateDataSetDropdown();
}

// Render data sets list
function renderDataSetsList() {
    const container = document.getElementById('data-sets-list');
    const dataSets = window.dataManager.getAllDataSets();

    if (dataSets.length === 0) {
        container.innerHTML = '<p class="aero-text-muted text-sm">No data sets yet. Create one to get started.</p>';
        return;
    }

    container.innerHTML = dataSets.map(ds => {
        const isSelected = ds.id === selectedDataSetId;
        return `
      <div class='${isSelected ? "aero-button-primary" : "aero-button"} p-3 rounded-lg cursor-pointer'
        onclick='selectDataSetForView(${dataArgument(ds.id)})'>
        <div class='flex justify-between items-start mb-1'>
          <div class='font-semibold text-sm'>${dataHTML(ds.name)}</div>
          <button onclick='event.stopPropagation(); deleteDataSetWithConfirm(${dataArgument(ds.id)})' aria-label='Delete data set'
            class='text-red-500 hover:text-red-700 text-xs'>
            ${window.LVXIcons?.svg('trash') || 'Delete'}
          </button>
        </div>
        <div class='text-xs aero-text-muted'>
          ${ds.data.length} rows × ${ds.headers.length} columns
        </div>
        <div class='text-xs aero-text-muted'>
          ${new Date(ds.modified).toLocaleString()}
        </div>
      </div>
    `;
    }).join('');
}

// Select data set for viewing
function selectDataSetForView(dataSetId, page = 0) {
    selectedDataSetId = dataSetId;
    const dataSet = window.dataManager.getDataSet(dataSetId);

    if (!dataSet) return;
    const pageSize = 200, pages = Math.max(1, Math.ceil(dataSet.data.length / pageSize));
    page = Number.isSafeInteger(page) ? Math.max(0, Math.min(page, pages - 1)) : 0;
    const rowStart = page * pageSize;

    const container = document.getElementById('data-set-details');
    container.innerHTML = `
    <div class='mb-4'>
      <h3 class='text-lg font-bold aero-text-primary'>${dataHTML(dataSet.name)}</h3>
      <p class='text-sm aero-text-muted'>
        Created: ${new Date(dataSet.created).toLocaleString()} |
        Modified: ${new Date(dataSet.modified).toLocaleString()}
      </p>
    </div>

    <div class='mb-4'>
      <div class='flex justify-between items-center mb-2'>
        <h4 class='font-semibold aero-text-secondary'>Data (${dataSet.data.length} rows)</h4>
        <div class='flex gap-2'>
          <button onclick='exportDataSet(${dataArgument(dataSetId)})'
            class='aero-button-info text-sm py-1 px-3 rounded'>
            ${window.LVXIcons?.svg('download') || ''} Export CSV
          </button>
          <button onclick='editDataSet(${dataArgument(dataSetId)})'
            class='aero-button-warning text-sm py-1 px-3 rounded'>
            ${window.LVXIcons?.svg('edit') || ''} Edit
          </button>
        </div>
      </div>
      <div class='aero-input p-3 rounded-lg overflow-auto' style='max-height: 400px;'>
        <table class='w-full text-sm border-collapse'>
          <thead>
            <tr class='border-b aero-divider'>
              <th class='text-left p-2 font-semibold aero-text-primary'>#</th>
              ${dataSet.headers.map(h => `<th class='text-left p-2 font-semibold aero-text-primary'>${dataHTML(h)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${dataSet.data.slice(rowStart, rowStart + pageSize).map((row, index) => `
              <tr class='border-b aero-divider hover:bg-blue-50'>
                <td class='p-2 aero-text-muted'>${rowStart + index + 1}</td>
                ${dataSet.headers.map(h => `<td class='p-2'>${dataHTML(row[h])}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class='flex gap-2 items-center mt-2'>
          <button class='aero-button-secondary' onclick='selectDataSetForView(${dataArgument(dataSetId)}, ${page - 1})' ${page === 0 ? 'disabled' : ''}>Previous rows</button>
          <span>Page ${page + 1} of ${pages}; all ${dataSet.data.length} rows are available.</span>
          <button class='aero-button-secondary' onclick='selectDataSetForView(${dataArgument(dataSetId)}, ${page + 1})' ${page + 1 >= pages ? 'disabled' : ''}>Next rows</button>
        </div>
      </div>
    </div>

    <div class='aero-glass-panel p-3 rounded-lg'>
      <h4 class='font-semibold aero-text-secondary mb-2'>Column Variables</h4>
      <p class='text-sm aero-text-muted mb-2'>Use these in your test code:</p>
      <div class='flex flex-wrap gap-2'>
        ${dataSet.headers.map(h => `
          <code class='aero-badge-info text-xs'>\${${dataHTML(h)}}</code>
        `).join('')}
      </div>
    </div>
  `;

    renderDataSetsList(); // Refresh to show selection
}

// Delete data set
function deleteDataSetWithConfirm(dataSetId) {
    const dataSet = window.dataManager.getDataSet(dataSetId);
    if (!dataSet) return;

    if (confirm(`Delete data set "${dataSet.name}"?\n\nThis will NOT affect tests using this data set, but they will no longer be able to load the data.`)) {
        window.dataManager.deleteDataSet(dataSetId);
        selectedDataSetId = null;
        renderDataSetsList();
        document.getElementById('data-set-details').innerHTML = '<p class="aero-text-muted">Select a data set to view details</p>';
        window.showMessage('Data set deleted', 'success');
    }
}

// Export data set as CSV
function exportDataSet(dataSetId) {
    const dataSet = window.dataManager.getDataSet(dataSetId);
    if (!dataSet) return;

    const csv = window.dataManager.serializeCSV(dataSet.headers, dataSet.data);

    // Download
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${dataSet.name.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// Edit data set (open in manual entry mode)
function editDataSet(dataSetId) {
    const dataSet = window.dataManager.getDataSet(dataSetId);
    if (!dataSet) return;

    // Open create modal in manual mode
    openCreateDataSetModal();
    switchDataCreationTab('manual');

    // Populate with existing data
    document.getElementById('data-set-name-manual').value = dataSet.name;

    const csv = window.dataManager.serializeCSV(dataSet.headers, dataSet.data);

    document.getElementById('manual-csv-input').value = csv;

    // Store ID for update
    window._editingDataSetId = dataSetId;
}

// Open/Close Create Data Set Modal
function openCreateDataSetModal() {
    document.getElementById('create-data-set-modal').classList.remove('hidden');
    switchDataCreationTab('upload');
    // Reset form
    document.getElementById('data-set-name-upload').value = '';
    document.getElementById('data-file-input').value = '';
    document.getElementById('upload-preview').classList.add('hidden');
    document.getElementById('save-uploaded-data-btn').disabled = true;
    currentUploadedData = null;
    dataUploadGeneration++;
    window._editingDataSetId = null;
}

function closeCreateDataSetModal() {
    document.getElementById('create-data-set-modal').classList.add('hidden');
}

// Switch between creation tabs
function switchDataCreationTab(tab) {
    ['upload', 'manual', 'generate'].forEach(t => {
        document.getElementById(`data-creation-${t}`).classList.toggle('hidden', t !== tab);
        document.getElementById(`data-tab-${t}`).className =
            t === tab
                ? 'py-2 px-4 font-semibold aero-text-primary border-b-2 border-blue-500'
                : 'py-2 px-4 font-semibold aero-text-muted';
    });
}

// Handle file upload
async function handleDataFileUpload(event) {
    const uploadGeneration = ++dataUploadGeneration;
    currentUploadedData = null;
    document.getElementById('upload-preview').classList.add('hidden');
    document.getElementById('save-uploaded-data-btn').disabled = true;
    const file = event.target.files[0];
    if (!file) return;

    try {
        window.showMessage('Processing file...', 'info');

        let parsedData;
        const fileName = file.name.toLowerCase();

        if (fileName.endsWith('.csv')) {
            // Parse CSV
            parsedData = await window.dataManager.parseCSVFile(file);
        } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
            // Parse Excel
            parsedData = await window.dataManager.parseExcel(file);
        } else {
            throw new Error('Unsupported file format');
        }

        if (uploadGeneration !== dataUploadGeneration) return;
        currentUploadedData = parsedData;

        // Auto-fill name if empty
        if (!document.getElementById('data-set-name-upload').value) {
            document.getElementById('data-set-name-upload').value = file.name.replace(/\.[^/.]+$/, '');
        }

        // Show preview
        renderUploadPreview(parsedData);
        document.getElementById('save-uploaded-data-btn').disabled = false;

        window.showMessage(`Loaded ${parsedData.data.length} rows`, 'success');
    } catch (error) {
        if (uploadGeneration !== dataUploadGeneration) return;
        window.showMessage('Error parsing file: ' + error.message, 'error');
        console.error(error);
    }
}

function renderUploadPreview(parsedData) {
    const container = document.getElementById('upload-preview-table');
    const previewRows = parsedData.data.slice(0, 5); // Show first 5 rows

    container.innerHTML = `
    <thead>
      <tr class='border-b aero-divider'>
        ${parsedData.headers.map(h => `<th class='text-left p-2 font-semibold'>${dataHTML(h)}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${previewRows.map(row => `
        <tr class='border-b aero-divider'>
          ${parsedData.headers.map(h => `<td class='p-2'>${dataHTML(row[h])}</td>`).join('')}
        </tr>
      `).join('')}
    </tbody>
  `;

    document.getElementById('upload-preview').classList.remove('hidden');
}

// Save uploaded data set
function saveUploadedDataSet() {
    const name = document.getElementById('data-set-name-upload').value.trim();
    if (!name) {
        window.showMessage('Please enter a name for the data set', 'warning');
        return;
    }

    if (!currentUploadedData) {
        window.showMessage('No data to save', 'error');
        return;
    }

    const dataSet = {
        name,
        headers: currentUploadedData.headers,
        data: currentUploadedData.data,
        source: 'upload'
    };

    window.dataManager.saveDataSet(dataSet);
    window.showMessage('Data set saved successfully', 'success');

    closeCreateDataSetModal();
    renderDataSetsList();
}

// Save manual data set
function saveManualDataSet() {
    const name = document.getElementById('data-set-name-manual').value.trim();
    const csvText = document.getElementById('manual-csv-input').value;

    if (!name) {
        window.showMessage('Please enter a name for the data set', 'warning');
        return;
    }

    if (!csvText) {
        window.showMessage('Please enter CSV data', 'warning');
        return;
    }

    try {
        const parsedData = window.dataManager.parseCSV(csvText);

        const dataSet = {
            name,
            headers: parsedData.headers,
            data: parsedData.data,
            source: 'manual'
        };

        if (window._editingDataSetId) {
            // Update existing
            window.dataManager.updateDataSet(window._editingDataSetId, dataSet);
            window.showMessage('Data set updated successfully', 'success');
        } else {
            // Create new
            window.dataManager.saveDataSet(dataSet);
            window.showMessage('Data set saved successfully', 'success');
        }

        closeCreateDataSetModal();
        renderDataSetsList();
    } catch (error) {
        window.showMessage('Error parsing CSV: ' + error.message, 'error');
    }
}

// Generate and save data set
function generateAndSaveDataSet() {
    const name = document.getElementById('data-set-name-generate').value.trim();
    const rowCount = parseInt(document.getElementById('generate-row-count').value);
    const pattern = document.getElementById('generate-pattern').value.trim();

    if (!name) {
        window.showMessage('Please enter a name for the data set', 'warning');
        return;
    }

    if (!pattern) {
        window.showMessage('Please enter a data pattern', 'warning');
        return;
    }

    if (!Number.isSafeInteger(rowCount) || rowCount < 1) {
        window.showMessage('Row count must be a positive safe integer', 'warning');
        return;
    }

    try {
        // Parse pattern to get headers
        const matches = pattern.match(/\{\{(\w+)(?::([^}]+))?\}\}/g);
        if (!matches) {
            throw new Error('No valid patterns found. Use {{patternName}} syntax.');
        }

        const headers = matches.map(m => {
            const [, type] = m.match(/\{\{(\w+)(?::([^}]+))?\}\}/) || [];
            return type;
        });

        // Generate data
        const data = window.dataManager.generateFakerData(pattern, rowCount);

        const dataSet = {
            name,
            headers,
            data,
            source: 'generated'
        };

        window.dataManager.saveDataSet(dataSet);
        window.showMessage(`Generated data set with ${rowCount} rows`, 'success');

        closeCreateDataSetModal();
        renderDataSetsList();
    } catch (error) {
        window.showMessage('Error generating data: ' + error.message, 'error');
    }
}

// Export functions
window.openDataSetManager = openDataSetManager;
window.closeDataSetManager = closeDataSetManager;
window.selectDataSetForView = selectDataSetForView;
window.deleteDataSetWithConfirm = deleteDataSetWithConfirm;
window.exportDataSet = exportDataSet;
window.editDataSet = editDataSet;
window.openCreateDataSetModal = openCreateDataSetModal;
window.closeCreateDataSetModal = closeCreateDataSetModal;
window.switchDataCreationTab = switchDataCreationTab;
window.handleDataFileUpload = handleDataFileUpload;
window.saveUploadedDataSet = saveUploadedDataSet;
window.saveManualDataSet = saveManualDataSet;
window.generateAndSaveDataSet = generateAndSaveDataSet;
