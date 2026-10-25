(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    root.mockRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
    function createFallbackUuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
            const random = Math.floor(Math.random() * 16);
            const value = char === 'x' ? random : ((random & 0x3) | 0x8);
            return value.toString(16);
        });
    }

    function getBuiltInValue(token, options = {}) {
        const cache = options.variableCache || null;
        if (cache && Object.prototype.hasOwnProperty.call(cache, token)) {
            return cache[token];
        }

        const randomFn = typeof options.randomFn === 'function' ? options.randomFn : Math.random;
        const uuidFactory = typeof options.uuidFactory === 'function'
            ? options.uuidFactory
            : () => (root.crypto && typeof root.crypto.randomUUID === 'function' ? root.crypto.randomUUID() : createFallbackUuid());

        let value;
        switch (token) {
            case 'random_id':
                value = String(Math.floor(randomFn() * 900000) + 100000);
                break;
            case 'random_email':
                value = `user${Math.floor(randomFn() * 100000)}@example.test`;
                break;
            case 'random_name':
                value = ['Alex Carter', 'Jamie Chen', 'Morgan Lee', 'Taylor Singh'][Math.floor(randomFn() * 4)];
                break;
            case 'timestamp':
                value = new Date().toISOString();
                break;
            case 'uuid':
                value = uuidFactory();
                break;
            case 'random_token':
                value = `tok_${Math.floor(randomFn() * 1e12).toString(36)}`;
                break;
            default:
                if (token.startsWith('random_number:')) {
                    const range = token.split(':')[1] || '';
                    const [rawMin, rawMax] = range.split('-');
                    const min = Number.parseInt(rawMin, 10);
                    const max = Number.parseInt(rawMax, 10);
                    if (Number.isFinite(min) && Number.isFinite(max) && max >= min) {
                        value = String(Math.floor(randomFn() * (max - min + 1)) + min);
                    }
                }
                break;
        }

        if (cache && value !== undefined) {
            cache[token] = value;
        }

        return value;
    }

    function serializeVariableValue(value) {
        if (value == null) return '';
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        try {
            return JSON.stringify(value);
        } catch (error) {
            return String(value);
        }
    }

    function resolveTemplateVariables(text, context = {}, options = {}) {
        return String(text || '').replace(/\{\{([^}]+)\}\}/g, (match, rawToken) => {
            const token = String(rawToken || '').trim();
            if (!token) return match;

            if (Object.prototype.hasOwnProperty.call(context, token)) {
                return serializeVariableValue(context[token]);
            }

            const builtInValue = getBuiltInValue(token, options);
            if (builtInValue !== undefined) {
                return serializeVariableValue(builtInValue);
            }

            return options.preserveUnknown === false ? '' : match;
        });
    }

    function buildMockValue(template, context = {}, options = {}) {
        const resolvedTemplate = resolveTemplateVariables(template, context, options);
        const trimmed = resolvedTemplate.trim();
        if (!trimmed) return '';

        if (
            (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))
        ) {
            try {
                return JSON.parse(resolvedTemplate);
            } catch (error) {
                return resolvedTemplate;
            }
        }

        return resolvedTemplate;
    }

    function flattenInputContext(inputs) {
        const flattened = {};
        if (inputs && typeof inputs === 'object') {
            Object.keys(inputs).forEach((key) => {
                if (key === 'artifacts') return;
                flattened[key] = inputs[key];
            });

            if (inputs.artifacts && typeof inputs.artifacts === 'object') {
                Object.keys(inputs.artifacts).forEach((key) => {
                    flattened[key] = inputs.artifacts[key];
                });
            }
        }
        return flattened;
    }

    function sanitizeVariableName(value) {
        const sanitized = String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .replace(/_+/g, '_');

        if (!sanitized) return 'test_value';
        return sanitized.startsWith('test_') ? sanitized : `test_${sanitized}`;
    }

    function parseSelectedRowIndexes(input, maxRows) {
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

    function getFileRowsForExecution(fileData, options = {}) {
        const rows = Array.isArray(fileData?.rows) ? fileData.rows : [];
        const usageMode = fileData?.usageMode || 'per-row';

        if (usageMode === 'selected') {
            const selectedIndexes = parseSelectedRowIndexes(fileData?.selectedRows, rows.length);
            return selectedIndexes.map(index => rows[index]).filter(Boolean);
        }

        if (usageMode === 'sample') {
            const sampleSize = Number.parseInt(fileData?.sampleSize, 10);
            if (!Number.isFinite(sampleSize) || sampleSize <= 0) {
                return rows;
            }

            const shuffled = rows.slice();
            const randomFn = typeof options.randomFn === 'function' ? options.randomFn : Math.random;
            for (let index = shuffled.length - 1; index > 0; index -= 1) {
                const swapIndex = Math.floor(randomFn() * (index + 1));
                const current = shuffled[index];
                shuffled[index] = shuffled[swapIndex];
                shuffled[swapIndex] = current;
            }
            return shuffled.slice(0, sampleSize);
        }

        return rows;
    }

    function mapFileRowVariables(fileData, row) {
        const mappings = fileData?.columnMappings && typeof fileData.columnMappings === 'object'
            ? fileData.columnMappings
            : {};
        const mapped = {};

        Object.keys(mappings).forEach((header) => {
            const variableName = String(mappings[header] || '').trim() || sanitizeVariableName(header);
            mapped[variableName] = row?.[header] == null ? '' : row[header];
        });

        return mapped;
    }

    function buildFileIterations(fileData, options = {}) {
        const headers = Array.isArray(fileData?.headers) ? fileData.headers : [];
        const rows = getFileRowsForExecution(fileData, options);
        if (!headers.length || !rows.length) {
            return [];
        }

        if ((fileData?.usageMode || 'per-row') === 'all') {
            const allRows = rows.map(row => mapFileRowVariables(fileData, row));
            return [{
                label: 'All Rows',
                rowNumber: 1,
                variables: {
                    file_rows: allRows,
                    file_row_count: allRows.length
                }
            }];
        }

        return rows.map((row, index) => {
            const mappedVariables = mapFileRowVariables(fileData, row);
            return {
                label: `Row ${index + 1}`,
                rowNumber: index + 1,
                variables: {
                    ...mappedVariables,
                    file_row: mappedVariables,
                    file_row_index: index,
                    file_row_number: index + 1
                }
            };
        });
    }

    function buildSuiteExecutionPlan(suite, inputs = {}, options = {}) {
        const mockBuilder = suite?.mock_builder && typeof suite.mock_builder === 'object'
            ? suite.mock_builder
            : {};
        const mocks = Array.isArray(mockBuilder.mocks) ? mockBuilder.mocks : [];
        const baseContextVariables = {
            ...flattenInputContext(inputs)
        };
        const cache = {};
        const resolutionOptions = {
            ...options,
            variableCache: cache
        };

        const setupSteps = Array.isArray(mockBuilder.setupSteps) ? mockBuilder.setupSteps : [];
        const teardownSteps = Array.isArray(mockBuilder.teardownSteps) ? mockBuilder.teardownSteps : [];

        let beforeDelayMs = 0;
        let afterDelayMs = 0;

        setupSteps.forEach((step) => {
            if (!step || typeof step !== 'object') return;

            if (step.action === 'create-test-data' && step.variableName) {
                const mock = mocks.find(candidate => candidate.id === step.mockId);
                if (mock && typeof mock.template === 'string') {
                    baseContextVariables[step.variableName] = buildMockValue(mock.template, baseContextVariables, resolutionOptions);
                }
            } else if (step.action === 'set-environment' && step.envName) {
                baseContextVariables[step.envName] = resolveTemplateVariables(step.envValue || '', baseContextVariables, resolutionOptions);
            } else if (step.action === 'wait') {
                const delay = Number.parseInt(step.delayMs, 10);
                if (Number.isFinite(delay) && delay > 0) {
                    beforeDelayMs += delay;
                }
            }
        });

        teardownSteps.forEach((step) => {
            if (!step || typeof step !== 'object') return;
            if (step.action === 'wait') {
                const delay = Number.parseInt(step.delayMs, 10);
                if (Number.isFinite(delay) && delay > 0) {
                    afterDelayMs += delay;
                }
            }
        });

        const fileIterations = buildFileIterations(mockBuilder.fileData, resolutionOptions).map((iteration) => ({
            ...iteration,
            contextVariables: {
                ...baseContextVariables,
                ...iteration.variables
            }
        }));

        return {
            baseContextVariables,
            beforeDelayMs,
            afterDelayMs,
            iterations: fileIterations,
            hasFileIterations: fileIterations.length > 0
        };
    }

    function delay(ms) {
        const numeric = Number(ms) || 0;
        if (numeric <= 0) {
            return Promise.resolve();
        }
        return new Promise(resolve => setTimeout(resolve, numeric));
    }

    return {
        buildSuiteExecutionPlan,
        buildMockValue,
        buildFileIterations,
        delay,
        flattenInputContext,
        getBuiltInValue,
        mapFileRowVariables,
        parseSelectedRowIndexes,
        resolveTemplateVariables,
        sanitizeVariableName,
        serializeVariableValue
    };
});
