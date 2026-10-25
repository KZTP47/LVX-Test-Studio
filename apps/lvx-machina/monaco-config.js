// ============================================
// MONACO EDITOR CONFIGURATION
// Enhanced code editor for LVX-Machina
// ============================================

let monacoEditorInstance = null;
let monacoLoaded = false;
let monacoConfigured = false;
let monacoLoadPromise = null;
let monacoEditorContainerId = null;

/**
 * Initialize Monaco Editor loader and configure AMD
 */
function loadMonacoEditor() {
    // If Monaco is already loaded, resolve immediately
    if (monacoLoaded && typeof monaco !== 'undefined') {
        return Promise.resolve();
    }

    if (monacoLoadPromise) {
        return monacoLoadPromise;
    }

    monacoLoadPromise = new Promise((resolve, reject) => {
        // Only configure require.config once to prevent duplicate module warnings
        if (!monacoConfigured) {
            monacoConfigured = true;
            require.config({
                paths: {
                    'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs'
                }
            });
        }

        require(['vs/editor/editor.main'], function () {
            monacoLoaded = true;
            console.log('Monaco Editor loaded successfully');

            // Register Robot Framework language
            registerRobotFrameworkLanguage();

            // Register custom Aero theme
            registerAeroTheme();

            // Setup auto-completion providers
            setupAutoCompletion();

            resolve();
        }, function (err) {
            console.error('Failed to load Monaco Editor:', err);
            monacoLoadPromise = null;
            reject(err);
        });
    });

    return monacoLoadPromise;
}

function prewarmMonacoEditor() {
    return loadMonacoEditor().catch((error) => {
        console.warn('Monaco prewarm failed:', error);
        return null;
    });
}

/**
 * Register Robot Framework as a custom language
 */
function registerRobotFrameworkLanguage() {
    monaco.languages.register({ id: 'robotframework' });

    // Define syntax highlighting rules
    monaco.languages.setMonarchTokensProvider('robotframework', {
        tokenizer: {
            root: [
                // Comments
                [/#.*$/, 'comment'],

                // Section headers
                [/\*\*\*\s*(Settings|Variables|Test Cases|Keywords|Tasks)\s*\*\*\*/, 'keyword.section'],

                // Built-in keywords
                [/\b(Click Element|Input Text|Wait For Element|Element Should Be Visible|Element Should Contain|Page Should Contain|Element Should Exist|Get Text|Get Value|Select From List|Check Checkbox|Uncheck Checkbox|Go To|Sleep|Log|Should Be Equal|Should Contain|Should Not Be Empty|Set Variable|Run Keyword If|Run Keywords|Wait Until Element Is Visible|Wait Until Page Contains|Execute JavaScript|Scroll Element Into View|Get Element Count|Open Browser|Close Browser|Maximize Browser Window|Set Selenium Speed|Capture Page Screenshot)\b/, 'keyword.control'],

                // Robot Framework library imports
                [/\b(Library|Resource|Variables|Suite Setup|Suite Teardown|Test Setup|Test Teardown|Force Tags|Default Tags|Test Template|Test Timeout|Documentation)\b/, 'keyword.directive'],

                // String literals
                [/"([^"\\]|\\.)*$/, 'string.invalid'],
                [/"/, 'string', '@string_double'],
                [/'([^'\\]|\\.)*$/, 'string.invalid'],
                [/'/, 'string', '@string_single'],

                // Variables
                [/\$\{[^}]+\}/, 'variable'],
                [/@\{[^}]+\}/, 'variable.list'],
                [/&\{[^}]+\}/, 'variable.dict'],
                [/%\{[^}]+\}/, 'variable.env'],

                // Numbers
                [/\b\d+\b/, 'number'],

                // Test case names and keyword definitions
                [/^[A-Z][A-Za-z0-9 _-]+$/, 'type.identifier']
            ],

            string_double: [
                [/[^\\"]+/, 'string'],
                [/\\./, 'string.escape'],
                [/"/, 'string', '@pop']
            ],

            string_single: [
                [/[^\\']+/, 'string'],
                [/\\./, 'string.escape'],
                [/'/, 'string', '@pop']
            ]
        }
    });

    // Define language configuration
    monaco.languages.setLanguageConfiguration('robotframework', {
        comments: {
            lineComment: '#'
        },
        brackets: [
            ['{', '}'],
            ['[', ']'],
            ['(', ')']
        ],
        autoClosingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '(', close: ')' },
            { open: '"', close: '"' },
            { open: "'", close: "'" }
        ],
        surroundingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '(', close: ')' },
            { open: '"', close: '"' },
            { open: "'", close: "'" }
        ],
        indentationRules: {
            increaseIndentPattern: /^.*\*\*\*.*\*\*\*.*$/,
            decreaseIndentPattern: /^$/
        }
    });
}

/**
 * Register Windows Vista Aero-themed editor
 */
function registerAeroTheme() {
    monaco.editor.defineTheme('aero-theme', {
        base: 'vs',
        inherit: true,
        rules: [
            { token: 'comment', foreground: '546E7A', fontStyle: 'italic' },
            { token: 'keyword.section', foreground: '1565C0', fontStyle: 'bold' },
            { token: 'keyword.control', foreground: '0277BD', fontStyle: 'bold' },
            { token: 'keyword.directive', foreground: '00ACC1' },
            { token: 'string', foreground: '43A047' },
            { token: 'number', foreground: 'F57C00' },
            { token: 'variable', foreground: '8E24AA' },
            { token: 'variable.list', foreground: 'AB47BC' },
            { token: 'variable.dict', foreground: 'BA68C8' },
            { token: 'type.identifier', foreground: '1E88E5', fontStyle: 'bold' }
        ],
        colors: {
            'editor.background': '#FFFFFF',
            'editor.foreground': '#003366',
            'editor.lineHighlightBackground': '#E3F2FD',
            'editor.selectionBackground': '#BBDEFB',
            'editor.inactiveSelectionBackground': '#E3F2FD',
            'editorCursor.foreground': '#1565C0',
            'editorWhitespace.foreground': '#B8D4E8',
            'editorLineNumber.foreground': '#90CAF9',
            'editorLineNumber.activeForeground': '#1565C0',
            'editor.selectionHighlightBackground': '#C5E7FF',
            'editorIndentGuide.background': '#E3F2FD',
            'editorIndentGuide.activeBackground': '#90CAF9'
        }
    });
}

/**
 * Helper to get environment variable suggestions
 */
function getEnvironmentVariableSuggestions(range) {
    if (!window.environmentManager) return [];
    const env = window.environmentManager.getActiveEnvironment();
    if (!env || !env.variables) return [];

    return Object.keys(env.variables).map(key => ({
        label: '${env.' + key + '}',
        kind: monaco.languages.CompletionItemKind.Variable,
        insertText: '${env.' + key + '}',
        detail: `Environment Variable (${env.name})`,
        documentation: `Value: ${env.variables[key]}`,
        range: range
    }));
}

/**
 * Setup auto-completion for all supported languages
 */
function setupAutoCompletion() {
    // Robot Framework Auto-Completion
    monaco.languages.registerCompletionItemProvider('robotframework', {
        provideCompletionItems: (model, position) => {
            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn
            };

            const suggestions = [];

            // Section headers
            const sections = ['Settings', 'Variables', 'Test Cases', 'Keywords', 'Tasks'];
            sections.forEach(section => {
                suggestions.push({
                    label: `*** ${section} ***`,
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: `*** ${section} ***\n`,
                    documentation: `${section} section`,
                    range: range
                });
            });

            // BrowserLibrary keywords
            const browserKeywords = [
                {
                    label: 'Click Element',
                    insertText: 'Click Element ${1:selector}',
                    detail: 'Click an element identified by CSS selector',
                    documentation: 'Clicks an element on the page.\n\nExample:\n Click Element #submit-button'
                },
                {
                    label: 'Input Text',
                    insertText: 'Input Text ${1:selector} ${2:text}',
                    detail: 'Input text into an element',
                    documentation: 'Types text into an input field.\n\nExample:\n Input Text input[name="username"] john_doe'
                },
                {
                    label: 'Element Should Be Visible',
                    insertText: 'Element Should Be Visible ${1:selector}',
                    detail: 'Verify element is visible',
                    documentation: 'Verifies that an element is visible on the page.\n\nExample:\n Element Should Be Visible #welcome-message'
                },
                {
                    label: 'Element Should Contain',
                    insertText: 'Element Should Contain ${1:selector} ${2:expected_text}',
                    detail: 'Verify element contains text',
                    documentation: 'Verifies an element contains specific text.\n\nExample:\n Element Should Contain h1 Welcome'
                },
                {
                    label: 'Page Should Contain',
                    insertText: 'Page Should Contain ${1:text}',
                    detail: 'Verify page contains text',
                    documentation: 'Verifies that text exists anywhere on the page.\n\nExample:\n Page Should Contain Success'
                },
                {
                    label: 'Element Should Exist',
                    insertText: 'Element Should Exist ${1:selector}',
                    detail: 'Verify element exists',
                    documentation: 'Verifies that an element exists on the page.\n\nExample:\n Element Should Exist #footer'
                },
                {
                    label: 'Wait For Element',
                    insertText: 'Wait For Element ${1:selector} timeout=${2:5}',
                    detail: 'Wait for element to appear',
                    documentation: 'Waits for an element to appear on the page.\n\nExample:\n Wait For Element #results timeout=10'
                },
                {
                    label: 'Get Text',
                    insertText: '${1:variable}= Get Text ${2:selector}',
                    detail: 'Get text from element',
                    documentation: 'Gets the text content of an element.\n\nExample:\n ${text}= Get Text h1'
                },
                {
                    label: 'Get Value',
                    insertText: '${1:variable}= Get Value ${2:selector}',
                    detail: 'Get value from input element',
                    documentation: 'Gets the value of an input element.\n\nExample:\n ${value}= Get Value input[name="username"]'
                },
                {
                    label: 'Select From List',
                    insertText: 'Select From List ${1:selector} ${2:value}',
                    detail: 'Select option from dropdown',
                    documentation: 'Selects an option from a dropdown list.\n\nExample:\n Select From List #country USA'
                },
                {
                    label: 'Check Checkbox',
                    insertText: 'Check Checkbox ${1:selector}',
                    detail: 'Check a checkbox',
                    documentation: 'Checks a checkbox.\n\nExample:\n Check Checkbox #terms-and-conditions'
                },
                {
                    label: 'Uncheck Checkbox',
                    insertText: 'Uncheck Checkbox ${1:selector}',
                    detail: 'Uncheck a checkbox',
                    documentation: 'Unchecks a checkbox.\n\nExample:\n Uncheck Checkbox #newsletter'
                },
                {
                    label: 'Execute JavaScript',
                    insertText: 'Execute JavaScript ${1:script}',
                    detail: 'Execute JavaScript code',
                    documentation: 'Executes JavaScript code in the browser.\n\nExample:\n Execute JavaScript window.scrollTo(0, 0)'
                },
                {
                    label: 'Get Element Count',
                    insertText: '${1:count}= Get Element Count ${2:selector}',
                    detail: 'Count matching elements',
                    documentation: 'Gets the count of elements matching a selector.\n\nExample:\n ${count}= Get Element Count .item'
                }
            ];

            browserKeywords.forEach(kw => {
                suggestions.push({
                    label: kw.label,
                    kind: monaco.languages.CompletionItemKind.Function,
                    insertText: kw.insertText,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: kw.detail,
                    documentation: kw.documentation,
                    range: range
                });
            });

            // Common Robot Framework keywords
            const commonKeywords = [
                {
                    label: 'Log',
                    insertText: 'Log ${1:message}',
                    detail: 'Log a message',
                    documentation: 'Logs a message to the console.'
                },
                {
                    label: 'Sleep',
                    insertText: 'Sleep ${1:time}',
                    detail: 'Pause execution',
                    documentation: 'Pauses test execution.\n\nExample:\n Sleep 2s'
                },
                {
                    label: 'Should Be Equal',
                    insertText: 'Should Be Equal ${1:first} ${2:second}',
                    detail: 'Assert equality',
                    documentation: 'Fails if values are not equal.'
                },
                {
                    label: 'Should Contain',
                    insertText: 'Should Contain ${1:container} ${2:item}',
                    detail: 'Assert contains',
                    documentation: 'Fails if container does not contain item.'
                },
                {
                    label: 'Set Variable',
                    insertText: '${1:variable}= Set Variable ${2:value}',
                    detail: 'Set a variable',
                    documentation: 'Sets a variable to a value.'
                }
            ];

            commonKeywords.forEach(kw => {
                suggestions.push({
                    label: kw.label,
                    kind: monaco.languages.CompletionItemKind.Function,
                    insertText: kw.insertText,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: kw.detail,
                    documentation: kw.documentation,
                    range: range
                });
            });

            // Test case template snippet
            suggestions.push({
                label: 'test',
                kind: monaco.languages.CompletionItemKind.Snippet,
                insertText: [
                    '${1:Test Case Name}',
                    ' [Documentation] ${2:Description}',
                    ' ${3:# Add test steps here}',
                    ''
                ].join('\n'),
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                detail: 'Test case template',
                documentation: 'Creates a new test case structure',
                range: range
            });

            // Library import snippet
            suggestions.push({
                label: 'Library',
                kind: monaco.languages.CompletionItemKind.Snippet,
                insertText: 'Library ${1:BrowserLibrary}',
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                detail: 'Import library',
                documentation: 'Imports a Robot Framework library',
                range: range
            });

            // Environment variables
            const envSuggestions = getEnvironmentVariableSuggestions(range);
            suggestions.push(...envSuggestions);

            return { suggestions: suggestions };
        }
    });

    // Python Auto-Completion
    monaco.languages.registerCompletionItemProvider('python', {
        provideCompletionItems: (model, position) => {
            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn
            };

            const suggestions = [];

            // Robot Framework imports for Python
            const robotImports = [
                {
                    label: 'from robot.api.deco import keyword',
                    insertText: 'from robot.api.deco import keyword',
                    detail: 'Import Robot Framework keyword decorator',
                    documentation: 'Allows you to create custom Robot Framework keywords in Python.'
                },
                {
                    label: 'import robot.api.logger',
                    insertText: 'import robot.api.logger as logger',
                    detail: 'Import Robot Framework logger',
                    documentation: 'Provides logging functionality for Robot Framework.'
                }
            ];

            robotImports.forEach(imp => {
                suggestions.push({
                    label: imp.label,
                    kind: monaco.languages.CompletionItemKind.Module,
                    insertText: imp.insertText,
                    detail: imp.detail,
                    documentation: imp.documentation,
                    range: range
                });
            });

            // Common Python patterns
            const pythonSnippets = [
                {
                    label: 'def_function',
                    insertText: [
                        'def ${1:function_name}(${2:parameters}):',
                        ' """${3:Description}"""',
                        ' ${4:pass}'
                    ].join('\n'),
                    detail: 'Function definition',
                    documentation: 'Creates a Python function'
                },
                {
                    label: 'if_statement',
                    insertText: [
                        'if ${1:condition}:',
                        ' ${2:pass}'
                    ].join('\n'),
                    detail: 'If statement',
                    documentation: 'Creates an if statement'
                },
                {
                    label: 'for_loop',
                    insertText: [
                        'for ${1:item} in ${2:iterable}:',
                        ' ${3:pass}'
                    ].join('\n'),
                    detail: 'For loop',
                    documentation: 'Creates a for loop'
                }
            ];

            pythonSnippets.forEach(snip => {
                suggestions.push({
                    label: snip.label,
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    insertText: snip.insertText,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: snip.detail,
                    documentation: snip.documentation,
                    range: range
                });
            });

            return { suggestions: suggestions };
        }
    });

    // Java Auto-Completion
    monaco.languages.registerCompletionItemProvider('java', {
        provideCompletionItems: (model, position) => {
            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn
            };

            const suggestions = [];

            // Common Java patterns
            const javaSnippets = [
                {
                    label: 'main',
                    insertText: [
                        'public static void main(String[] args) {',
                        ' ${1:// Your code here}',
                        '}'
                    ].join('\n'),
                    detail: 'Main method',
                    documentation: 'Creates a main method'
                },
                {
                    label: 'sysout',
                    insertText: 'System.out.println(${1:message});',
                    detail: 'Print statement',
                    documentation: 'Prints to console'
                }
            ];

            javaSnippets.forEach(snip => {
                suggestions.push({
                    label: snip.label,
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    insertText: snip.insertText,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: snip.detail,
                    documentation: snip.documentation,
                    range: range
                });
            });

            return { suggestions: suggestions };
        }
    });

    // C# Auto-Completion
    monaco.languages.registerCompletionItemProvider('csharp', {
        provideCompletionItems: (model, position) => {
            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn
            };

            const suggestions = [];

            // Common C# patterns
            const csharpSnippets = [
                {
                    label: 'cw',
                    insertText: 'Console.WriteLine(${1:message});',
                    detail: 'Console.WriteLine',
                    documentation: 'Writes to console'
                },
                {
                    label: 'prop',
                    insertText: 'public ${1:int} ${2:MyProperty} { get; set; }',
                    detail: 'Auto property',
                    documentation: 'Creates an auto-implemented property'
                }
            ];

            csharpSnippets.forEach(snip => {
                suggestions.push({
                    label: snip.label,
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    insertText: snip.insertText,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: snip.detail,
                    documentation: snip.documentation,
                    range: range
                });
            });

            return { suggestions: suggestions };
        }
    });
}

/**
 * Main initialization function
 * @param {string} containerId - ID of the container element
 * @param {string} language - Programming language (python, java, csharp, robot, robotframework)
 * @param {string} initialValue - Initial code content
 * @returns {Promise<monaco.editor.IStandaloneCodeEditor>} - Monaco editor instance
 */
async function initializeMonaco(containerId, language, initialValue = '') {
    // Ensure Monaco is loaded
    if (!monacoLoaded) {
        await loadMonacoEditor();
    }

    // Map language aliases
    const languageMap = {
        'robot': 'robotframework',
        'python': 'python',
        'java': 'java',
        'csharp': 'csharp'
    };

    const editorLanguage = languageMap[language.toLowerCase()] || 'plaintext';

    // Get container element
    const container = document.getElementById(containerId);
    if (!container) {
        throw new Error(`Container element with id '${containerId}' not found`);
    }

    if (
        monacoEditorInstance &&
        monacoEditorContainerId === containerId &&
        typeof monacoEditorInstance.getModel === 'function'
    ) {
        const existingModel = monacoEditorInstance.getModel();
        if (existingModel) {
            monaco.editor.setModelLanguage(existingModel, editorLanguage);
            existingModel.setValue(initialValue);
            if (editorLanguage !== 'robotframework') {
                monaco.editor.setModelMarkers(existingModel, 'robotframework', []);
            }
        }
        if (editorLanguage === 'robotframework') {
            setupRobotFrameworkValidation(monacoEditorInstance);
        }
        monacoEditorInstance.layout();
        console.log(`Monaco Editor reused with language: ${editorLanguage}`);
        return monacoEditorInstance;
    }

    // Dispose of existing editor instance if it exists for another container
    if (monacoEditorInstance) {
        monacoEditorInstance.dispose();
        monacoEditorInstance = null;
        monacoEditorContainerId = null;
    }

    // Create editor instance
    monacoEditorInstance = monaco.editor.create(container, {
        value: initialValue,
        language: editorLanguage,
        theme: 'aero-theme',
        automaticLayout: true,
        minimap: {
            enabled: false
        },
        scrollBeyondLastLine: false,
        fontSize: 14,
        lineNumbers: 'on',
        roundedSelection: false,
        scrollbar: {
            vertical: 'visible',
            horizontal: 'visible',
            useShadows: false,
            verticalScrollbarSize: 14,
            horizontalScrollbarSize: 14
        },
        folding: true,
        glyphMargin: false,
        wordWrap: 'off',
        formatOnPaste: false,
        formatOnType: false,
        renderWhitespace: 'selection',
        suggestOnTriggerCharacters: true,
        acceptSuggestionOnEnter: 'on',
        tabCompletion: 'on',
        quickSuggestions: {
            other: true,
            comments: false,
            strings: true
        },
        parameterHints: {
            enabled: true
        },
        snippetSuggestions: 'top'
    });
    monacoEditorContainerId = containerId;

    // Add basic error checking for Robot Framework
    if (editorLanguage === 'robotframework') {
        setupRobotFrameworkValidation(monacoEditorInstance);
    }

    console.log(`Monaco Editor initialized with language: ${editorLanguage}`);
    return monacoEditorInstance;
}

/**
 * Setup validation for Robot Framework syntax
 * @param {monaco.editor.IStandaloneCodeEditor} editor - Editor instance
 */
function setupRobotFrameworkValidation(editor) {
    if (editor.__robotValidationBound) {
        return;
    }
    editor.__robotValidationBound = true;

    let timeoutId = null;

    editor.onDidChangeModelContent(() => {
        const model = editor.getModel();
        if (!model || model.getLanguageId() !== 'robotframework') {
            return;
        }
        // Debounce validation
        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        timeoutId = setTimeout(() => {
            validateRobotFramework(editor);
        }, 500);
    });
}

/**
 * Validate Robot Framework syntax
 * @param {monaco.editor.IStandaloneCodeEditor} editor - Editor instance
 */
function validateRobotFramework(editor) {
    const model = editor.getModel();
    const markers = [];
    const lines = model.getLinesContent();

    const knownKeywords = [
        'Click Element', 'Input Text', 'Wait For Element', 'Element Should Be Visible',
        'Element Should Contain', 'Page Should Contain', 'Element Should Exist',
        'Get Text', 'Get Value', 'Select From List', 'Check Checkbox', 'Uncheck Checkbox',
        'Execute JavaScript', 'Get Element Count', 'Log', 'Sleep', 'Should Be Equal',
        'Should Contain', 'Set Variable', 'Run Keyword If', 'Run Keywords'
    ];

    lines.forEach((line, index) => {
        const lineNumber = index + 1;
        const trimmedLine = line.trim();

        // Skip empty lines and comments
        if (trimmedLine === '' || trimmedLine.startsWith('#')) {
            return;
        }

        // Check for section headers
        if (trimmedLine.startsWith('***') && trimmedLine.endsWith('***')) {
            return;
        }

        // Check for Library/Resource imports
        if (trimmedLine.startsWith('Library') || trimmedLine.startsWith('Resource')) {
            return;
        }

        // Check indentation (should be 4 spaces for steps)
        if (line.startsWith(' ') && line.length > 4) {
            const stepContent = line.substring(4);
            const parts = stepContent.split(' ');
            const keyword = parts[0].trim();

            // Check if keyword is known
            if (keyword && !knownKeywords.some(kw => keyword.startsWith(kw))) {
                // This might be a variable assignment or custom keyword
                if (!keyword.match(/^\$\{.*\}=/) && !keyword.match(/^\[.*\]/)) {
                    // Only warn, don't error (could be custom keyword)
                    markers.push({
                        severity: monaco.MarkerSeverity.Warning,
                        startLineNumber: lineNumber,
                        startColumn: 5,
                        endLineNumber: lineNumber,
                        endColumn: 5 + keyword.length,
                        message: `Unknown keyword: "${keyword}". This might be a custom keyword.`
                    });
                }
            }
        } else if (!trimmedLine.startsWith('***') && !trimmedLine.match(/^[A-Z]/) && line.length > 0 && !line.startsWith('Library') && !line.startsWith('Resource')) {
            // Lines that don't start with proper indentation and aren't section headers or imports
            markers.push({
                severity: monaco.MarkerSeverity.Error,
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: line.length + 1,
                message: 'Robot Framework steps should be indented with 4 spaces'
            });
        }
    });

    monaco.editor.setModelMarkers(model, 'robotframework', markers);
}

/**
 * Dispose of the current editor instance
 */
function disposeMonaco() {
    if (monacoEditorInstance) {
        monacoEditorInstance.dispose();
        monacoEditorInstance = null;
        monacoEditorContainerId = null;
    }
}

/**
 * Get the current editor instance
 * @returns {monaco.editor.IStandaloneCodeEditor|null}
 */
function getMonacoInstance() {
    return monacoEditorInstance;
}

// Export functions for global access
window.initializeMonaco = initializeMonaco;
window.disposeMonaco = disposeMonaco;
window.getMonacoInstance = getMonacoInstance;
window.prewarmMonacoEditor = prewarmMonacoEditor;
