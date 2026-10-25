class DataManager {
    constructor() {
        this.STORAGE_KEY = 'test_data_sets';
        this.dataSets = this._loadLegacyDataSetsSync();
        this.readyPromise = this._loadDataSetsFromStorage();
    }

    _getStorageManager() {
        return window.storageManager && window.storageManager.STORES ? window.storageManager : null;
    }

    _loadLegacyDataSetsSync() {
        try {
            const data = localStorage.getItem(this.STORAGE_KEY);
            return data ? JSON.parse(data) : [];
        } catch (error) {
            console.warn('Failed to load legacy data sets:', error);
            return [];
        }
    }

    async _loadDataSetsFromStorage() {
        const storageManager = this._getStorageManager();
        if (!storageManager) {
            return this.dataSets;
        }

        try {
            const records = await storageManager.getAll(storageManager.STORES.datasets);
            if (Array.isArray(records) && records.length > 0) {
                this.dataSets = records;
                if (typeof renderDataSetsList === 'function') {
                    renderDataSetsList();
                }
            }
            localStorage.removeItem(this.STORAGE_KEY);
        } catch (error) {
            console.warn('Failed to load data sets from IndexedDB:', error);
        }

        return this.dataSets;
    }

    async _persistAllDataSets() {
        const storageManager = this._getStorageManager();
        if (!storageManager) {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.dataSets));
            return true;
        }

        try {
            await storageManager.replaceAll(storageManager.STORES.datasets, this.dataSets);
            localStorage.removeItem(this.STORAGE_KEY);
            return true;
        } catch (error) {
            console.error('Failed to persist data sets to IndexedDB:', error);
            return false;
        }
    }

    // Save a data set
    saveDataSet(dataSet) {
        dataSet.id = dataSet.id || this._generateId();
        dataSet.created = dataSet.created || new Date().toISOString();
        dataSet.modified = new Date().toISOString();
        this.dataSets.push(dataSet);
        this._persistAllDataSets();
        return dataSet.id;
    }

    // Get all data sets
    getAllDataSets() {
        return this.dataSets.slice();
    }

    // Get data set by ID
    getDataSet(id) {
        return this.getAllDataSets().find(ds => ds.id === id);
    }

    // Update data set
    updateDataSet(id, updates) {
        const index = this.dataSets.findIndex(ds => ds.id === id);
        if (index !== -1) {
            this.dataSets[index] = { ...this.dataSets[index], ...updates, modified: new Date().toISOString() };
            this._persistAllDataSets();
        }
    }

    // Delete data set
    deleteDataSet(id) {
        this.dataSets = this.dataSets.filter(ds => ds.id !== id);
        this._persistAllDataSets();
    }

    inferFileType(fileName) {
        const lowerName = String(fileName || '').toLowerCase();
        if (lowerName.endsWith('.csv')) return 'csv';
        if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) return 'excel';
        if (lowerName.endsWith('.json')) return 'json';
        if (lowerName.endsWith('.txt')) return 'text';
        return 'text';
    }

    async loadDataFromFile(file) {
        if (!file) {
            throw new Error('No file was selected');
        }

        const fileType = this.inferFileType(file.name || '');
        let parsed;

        if (fileType === 'excel') {
            parsed = await this.parseExcel(file);
        } else {
            const textContent = await this._readFileAsText(file);
            if (fileType === 'csv') {
                parsed = this.parseCSV(textContent);
            } else if (fileType === 'json') {
                parsed = this.parseJSONData(textContent);
            } else {
                parsed = this.parseTextData(textContent, file.name || '');
            }
        }

        return {
            fileName: file.name || '',
            fileType,
            headers: parsed.headers,
            data: parsed.data
        };
    }

    parseJSONData(jsonContent) {
        let parsed;
        try {
            parsed = JSON.parse(jsonContent);
        } catch (error) {
            throw new Error(`JSON is not valid: ${error.message}`);
        }

        let rows;
        if (Array.isArray(parsed)) {
            rows = parsed;
        } else if (parsed && Array.isArray(parsed.data)) {
            rows = parsed.data;
        } else if (parsed && Array.isArray(parsed.rows)) {
            rows = parsed.rows;
        } else if (parsed && typeof parsed === 'object') {
            rows = [parsed];
        } else {
            throw new Error('JSON must contain an object, an array of objects, or a data/rows array');
        }

        return this._normalizeStructuredRows(rows);
    }

    parseTextData(textContent, fileName = '') {
        const normalizedText = String(textContent || '').replace(/\r\n/g, '\n').trim();
        if (!normalizedText) {
            return { headers: ['text'], data: [] };
        }

        const lines = normalizedText.split('\n').filter(line => line.trim() !== '');
        const looksLikeCsv = lines.length >= 2 && lines[0].includes(',');
        if (looksLikeCsv) {
            try {
                return this.parseCSV(normalizedText);
            } catch (error) {
                // Fall back to line-based text data below.
            }
        }

        return {
            headers: ['text'],
            data: lines.map(line => ({ text: line }))
        };
    }

    // Parse CSV content
    parseCSV(csvContent) {
        const lines = csvContent.trim().split('\n');
        if (lines.length < 2) {
            throw new Error('CSV must have at least a header row and one data row');
        }

        // Parse header
        const headers = this._parseCSVLine(lines[0]);

        // Parse data rows
        const data = [];
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '') continue;
            const values = this._parseCSVLine(lines[i]);
            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index] || '';
            });
            data.push(row);
        }

        return { headers, data };
    }

    // Parse a single CSV line (handles quoted values)
    _parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];

            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());

        return result;
    }

    _normalizeStructuredRows(rows) {
        if (!Array.isArray(rows) || rows.length === 0) {
            return { headers: [], data: [] };
        }

        const normalizedRows = rows.map((row, rowIndex) => {
            if (row && typeof row === 'object' && !Array.isArray(row)) {
                return row;
            }

            if (Array.isArray(row)) {
                const converted = {};
                row.forEach((value, columnIndex) => {
                    converted[`column_${columnIndex + 1}`] = value;
                });
                return converted;
            }

            return { value: row == null ? '' : String(row) };
        });

        const headerSet = new Set();
        normalizedRows.forEach(row => {
            Object.keys(row).forEach(key => headerSet.add(String(key)));
        });

        const headers = Array.from(headerSet);
        const data = normalizedRows.map(row => {
            const normalizedRow = {};
            headers.forEach(header => {
                const value = row[header];
                normalizedRow[header] = value == null ? '' : String(value);
            });
            return normalizedRow;
        });

        return { headers, data };
    }

    async _readFileAsText(file) {
        if (file && typeof file.text === 'function') {
            return file.text();
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve(String(event?.target?.result || ''));
            reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
            reader.readAsText(file);
        });
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
            const regex = new RegExp(`\\$\\{${key}\\}`, 'g');
            result = result.replace(regex, dataRow[key]);
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

// UI state
let currentUploadedData = null;
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
        onclick='selectDataSetForView("${ds.id}")'>
        <div class='flex justify-between items-start mb-1'>
          <div class='font-semibold text-sm'>${ds.name}</div>
          <button onclick='event.stopPropagation(); deleteDataSetWithConfirm("${ds.id}")' 
            class='text-red-500 hover:text-red-700 text-xs'>
            🗑️
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
function selectDataSetForView(dataSetId) {
    selectedDataSetId = dataSetId;
    const dataSet = window.dataManager.getDataSet(dataSetId);

    if (!dataSet) return;

    const container = document.getElementById('data-set-details');
    container.innerHTML = `
    <div class='mb-4'>
      <h3 class='text-lg font-bold aero-text-primary'>${dataSet.name}</h3>
      <p class='text-sm aero-text-muted'>
        Created: ${new Date(dataSet.created).toLocaleString()} | 
        Modified: ${new Date(dataSet.modified).toLocaleString()}
      </p>
    </div>
    
    <div class='mb-4'>
      <div class='flex justify-between items-center mb-2'>
        <h4 class='font-semibold aero-text-secondary'>Data (${dataSet.data.length} rows)</h4>
        <div class='flex gap-2'>
          <button onclick='exportDataSet("${dataSetId}")' 
            class='aero-button-info text-sm py-1 px-3 rounded'>
            💾 Export CSV
          </button>
          <button onclick='editDataSet("${dataSetId}")' 
            class='aero-button-warning text-sm py-1 px-3 rounded'>
            ✏️ Edit
          </button>
        </div>
      </div>
      <div class='aero-input p-3 rounded-lg overflow-auto' style='max-height: 400px;'>
        <table class='w-full text-sm border-collapse'>
          <thead>
            <tr class='border-b aero-divider'>
              <th class='text-left p-2 font-semibold aero-text-primary'>#</th>
              ${dataSet.headers.map(h => `<th class='text-left p-2 font-semibold aero-text-primary'>${h}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${dataSet.data.map((row, index) => `
              <tr class='border-b aero-divider hover:bg-blue-50'>
                <td class='p-2 aero-text-muted'>${index + 1}</td>
                ${dataSet.headers.map(h => `<td class='p-2'>${row[h] || ''}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    
    <div class='aero-glass-panel p-3 rounded-lg'>
      <h4 class='font-semibold aero-text-secondary mb-2'>Column Variables</h4>
      <p class='text-sm aero-text-muted mb-2'>Use these in your test code:</p>
      <div class='flex flex-wrap gap-2'>
        ${dataSet.headers.map(h => `
          <code class='aero-badge-info text-xs'>\${${h}}</code>
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

    // Generate CSV
    let csv = dataSet.headers.join(',') + '\n';
    csv += dataSet.data.map(row =>
        dataSet.headers.map(h => {
            let value = row[h] || '';
            // Escape quotes and wrap in quotes if contains comma
            if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                value = '"' + value.replace(/"/g, '""') + '"';
            }
            return value;
        }).join(',')
    ).join('\n');

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

    // Convert to CSV
    let csv = dataSet.headers.join(',') + '\n';
    csv += dataSet.data.map(row =>
        dataSet.headers.map(h => row[h] || '').join(',')
    ).join('\n');

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
    const file = event.target.files[0];
    if (!file) return;

    try {
        window.showMessage('Processing file...', 'info');

        let parsedData;
        const fileName = file.name.toLowerCase();

        if (fileName.endsWith('.csv')) {
            // Parse CSV
            const text = await file.text();
            parsedData = window.dataManager.parseCSV(text);
        } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
            // Parse Excel
            parsedData = await window.dataManager.parseExcel(file);
        } else {
            throw new Error('Unsupported file format');
        }

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
        ${parsedData.headers.map(h => `<th class='text-left p-2 font-semibold'>${h}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${previewRows.map(row => `
        <tr class='border-b aero-divider'>
          ${parsedData.headers.map(h => `<td class='p-2'>${row[h] || ''}</td>`).join('')}
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
    const csvText = document.getElementById('manual-csv-input').value.trim();

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

    if (rowCount < 1 || rowCount > 1000) {
        window.showMessage('Row count must be between 1 and 1000', 'warning');
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
