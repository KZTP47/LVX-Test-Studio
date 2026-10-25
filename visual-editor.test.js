/**
 * Unit Tests for VisualEditor
 * Tests state isolation when switching between pipelines
 *
 * Run with: npm test
 * Or run directly in browser console by loading visual-editor.js first
 */

// Simple test framework
const TestRunner = {
    passed: 0,
    failed: 0,
    results: [],

    test: require('node:test'),

    assertEqual(actual, expected, message = '') {
        if (actual !== expected) {
            throw new Error(`${message} Expected ${expected}, got ${actual}`);
        }
    },

    assertDeepEqual(actual, expected, message = '') {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(`${message} Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
    },

    summary() { return true; }
};

// Mock DOM environment for Node.js testing
function createMockDOM() {
    const createMockElement = () => ({
        innerHTML: '',
        innerText: '',
        textContent: '',
        style: {},
        dataset: {},
        classList: {
            add: function () { },
            remove: function () { }
        },
        children: [],
        appendChild: function (child) {
            this.children.push(child);
            return this;
        },
        removeChild: function () { },
        querySelector: function () { return createMockElement(); },
        querySelectorAll: function () { return []; },
        setAttribute: function () { },
        getAttribute: function () { return ''; },
        addEventListener: function () { },
        removeEventListener: function () { },
        getBoundingClientRect: function () { return { left: 0, top: 0, width: 100, height: 100 }; },
        remove: function () { }
    });

    if (typeof document === 'undefined') {
        global.document = {
            getElementById: function () { return createMockElement(); },
            createElement: function (tag) {
                const el = createMockElement();
                el.tagName = tag.toUpperCase();
                return el;
            },
            createElementNS: function (ns, tag) {
                const el = createMockElement();
                el.tagName = tag.toUpperCase();
                return el;
            }
        };
    }
}

// ============================================================
// TEST CASES
// ============================================================

function runTests() {
    console.log('\n=== VisualEditor Unit Tests ===\n');
    createMockDOM();

    // Test 1: clear() resets nodes and edges
    TestRunner.test('clear() should reset nodes to empty array', () => {
        const editor = new VisualEditor('test-container');
        editor.nodes = [{ id: 'node1' }, { id: 'node2' }];
        editor.edges = [{ id: 'edge1' }];

        editor.clear();

        TestRunner.assertEqual(editor.nodes.length, 0, 'Nodes array');
        TestRunner.assertEqual(editor.edges.length, 0, 'Edges array');
    });

    // Test 2: clear() resets selection state
    TestRunner.test('clear() should reset selectedNode and activeConnection', () => {
        const editor = new VisualEditor('test-container');
        editor.selectedNode = { id: 'selected' };
        editor.activeConnection = { source: 'node1' };

        editor.clear();

        TestRunner.assertEqual(editor.selectedNode, null, 'selectedNode');
        TestRunner.assertEqual(editor.activeConnection, null, 'activeConnection');
    });

    // Test 3: init() clears state
    TestRunner.test('init() should clear existing state', () => {
        const editor = new VisualEditor('test-container');
        editor.nodes = [{ id: 'old-node' }];
        editor.edges = [{ id: 'old-edge' }];

        editor.init();

        TestRunner.assertEqual(editor.nodes.length, 0, 'Nodes should be cleared');
        TestRunner.assertEqual(editor.edges.length, 0, 'Edges should be cleared');
    });

    // Test 4: loadGraph() properly sets nodes and edges
    TestRunner.test('loadGraph() should set nodes and edges from graph data', () => {
        const editor = new VisualEditor('test-container');
        editor.init(); // Must init first to set up DOM layers
        const graphData = {
            nodes: [
                { id: 'A', data: { name: 'Node A' }, position: { x: 0, y: 0 } },
                { id: 'B', data: { name: 'Node B' }, position: { x: 100, y: 0 } }
            ],
            edges: [
                { id: 'edge-A-B', source: 'A', target: 'B' }
            ]
        };

        editor.loadGraph(graphData);

        TestRunner.assertEqual(editor.nodes.length, 2, 'Nodes count');
        TestRunner.assertEqual(editor.edges.length, 1, 'Edges count');
        TestRunner.assertEqual(editor.nodes[0].id, 'A', 'First node ID');
    });

    // Test 5: Pipeline isolation - switching between pipelines
    TestRunner.test('Switching pipelines should not retain previous state', () => {
        const editor = new VisualEditor('test-container');
        editor.init(); // Initialize first

        // Simulate loading Pipeline 1
        const pipeline1 = {
            nodes: [{ id: 'P1-A', data: { name: 'Pipeline 1 Node' }, position: { x: 0, y: 0 } }],
            edges: []
        };
        editor.loadGraph(pipeline1);
        TestRunner.assertEqual(editor.nodes[0].id, 'P1-A', 'Pipeline 1 loaded');

        // Simulate switching to Pipeline 2 (init clears, then load new)
        editor.init();
        const pipeline2 = {
            nodes: [
                { id: 'P2-X', data: { name: 'Pipeline 2 Node X' }, position: { x: 0, y: 0 } },
                { id: 'P2-Y', data: { name: 'Pipeline 2 Node Y' }, position: { x: 100, y: 0 } }
            ],
            edges: [{ id: 'edge-XY', source: 'P2-X', target: 'P2-Y' }]
        };
        editor.loadGraph(pipeline2);

        // Verify Pipeline 1 data is NOT present
        TestRunner.assertEqual(editor.nodes.length, 2, 'Pipeline 2 has 2 nodes');
        TestRunner.assertEqual(editor.nodes[0].id, 'P2-X', 'First node is from Pipeline 2');

        // Verify no contamination
        const hasP1Node = editor.nodes.some(n => n.id === 'P1-A');
        TestRunner.assertEqual(hasP1Node, false, 'Pipeline 1 node should not be present');
    });

    // Test 6: New pipeline gets empty canvas
    TestRunner.test('Opening new pipeline should have empty nodes and edges', () => {
        const editor = new VisualEditor('test-container');

        // Simulate having edited a previous pipeline
        editor.nodes = [{ id: 'old' }];
        editor.edges = [{ id: 'old-edge' }];

        // Simulate opening new pipeline (init clears)
        editor.init();

        TestRunner.assertEqual(editor.nodes.length, 0, 'Nodes empty for new pipeline');
        TestRunner.assertEqual(editor.edges.length, 0, 'Edges empty for new pipeline');
    });

    // Test 7: getGraph() returns current state
    TestRunner.test('getGraph() should return current nodes and edges', () => {
        const editor = new VisualEditor('test-container');
        editor.nodes = [{ id: 'test-node' }];
        editor.edges = [{ id: 'test-edge' }];

        const graph = editor.getGraph();

        TestRunner.assertEqual(graph.nodes.length, 1, 'Graph nodes');
        TestRunner.assertEqual(graph.edges.length, 1, 'Graph edges');
        TestRunner.assertEqual(graph.nodes[0].id, 'test-node', 'Node ID matches');
    });

    // Test 8: loadGraph handles empty/missing data gracefully
    TestRunner.test('loadGraph() should handle missing nodes/edges gracefully', () => {
        const editor = new VisualEditor('test-container');
        editor.init(); // Must init first to set up DOM layers

        editor.loadGraph({});

        TestRunner.assertDeepEqual(editor.nodes, [], 'Nodes defaults to empty array');
        TestRunner.assertDeepEqual(editor.edges, [], 'Edges defaults to empty array');
    });

    // Test 9: Unit Test Runner Node Logic
    TestRunner.test('Unit Test Runner node should be configurable', () => {
        const editor = new VisualEditor('test-container');
        editor.init();

        // Simulate adding via drop (manual add)
        editor.addNode({
            id: 'test-unit-node',
            type: 'unit-test-runner',
            data: { name: '🧪 Unit Test', command: 'npm test' },
            position: { x: 0, y: 0 }
        });

        TestRunner.assertEqual(editor.nodes.length, 1, 'Node added');
        TestRunner.assertEqual(editor.nodes[0].type, 'unit-test-runner', 'Node type correct');

        // Verify Render (Config button should be present)
        const nodeEl = editor.nodeLayer.children[0];
        const configBtn = nodeEl.querySelector('.ve-node-config-btn');
        // In mock DOM, querySelector returns an element if we implemented it, or null?
        // The mock DOM implementation in this file is simple.
        // nodeEl.innerHTML will contain the button HTML string.

        const hasConfigBtn = nodeEl.innerHTML.includes('ve-node-config-btn');
        TestRunner.assertEqual(hasConfigBtn, true, 'Config button rendered');

        // Test Config Update
        // Simulate changing command
        const node = editor.nodes[0];
        node.data.command = 'pytest';
        editor.render();

        TestRunner.assertEqual(editor.nodes[0].data.command, 'pytest', 'Command updated');
    });

    // Summary
    return TestRunner.summary();
}

// Export for different environments
if (typeof module !== 'undefined' && module.exports) {
    // Node.js environment - need to load VisualEditor
    const fs = require('fs');
    const path = require('path');

    global.window = global;
    createMockDOM();
    require('./icons.js');

    // Load VisualEditor source
    const visualEditorPath = path.join(__dirname, 'visual-editor.js');
    const visualEditorCode = fs.readFileSync(visualEditorPath, 'utf8');

    // Execute in context (simple eval for testing)
    eval(visualEditorCode.replace('window.VisualEditor', 'global.VisualEditor').replace('window.visualEditor', '// global.visualEditor'));

    // Run tests
    runTests();

} else if (typeof window !== 'undefined') {
    // Browser environment
    window.runVisualEditorTests = runTests;
    console.log('Tests loaded. Call runVisualEditorTests() to run.');
}
