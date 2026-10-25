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

    test(name, fn) {
        try {
            fn();
            this.passed++;
            this.results.push({ name, status: 'PASS' });
            console.log(`✓ ${name}`);
        } catch (e) {
            this.failed++;
            this.results.push({ name, status: 'FAIL', error: e.message });
            console.error(`✗ ${name}: ${e.message}`);
        }
    },

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

    summary() {
        console.log(`\n========================================`);
        console.log(`Tests: ${this.passed + this.failed} | Passed: ${this.passed} | Failed: ${this.failed}`);
        console.log(`========================================\n`);
        return this.failed === 0;
    }
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
            },
            body: createMockElement()
        };
    }

    if (typeof window === 'undefined') {
        global.window = global;
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

    // Test 10: Start Runner node appears in toolbar palette
    TestRunner.test('Start Runner node should appear in the integration palette', () => {
        const editor = new VisualEditor('test-container');
        editor.init();

        const toolbarContainsRunner = editor.container.children.some(child =>
            typeof child.innerHTML === 'string' && child.innerHTML.includes('data-type="start-runner"')
        );

        TestRunner.assertEqual(toolbarContainsRunner, true, 'Start Runner palette item rendered');
    });

    // Test 11: Start Runner node renders with config button
    TestRunner.test('Start Runner node should be configurable', () => {
        const editor = new VisualEditor('test-container');
        editor.init();

        editor.addNode({
            id: 'start-runner-node',
            type: 'start-runner',
            data: { name: 'Start Runner Node', retryTargets: [] },
            position: { x: 0, y: 0 }
        });

        const nodeEl = editor.nodeLayer.children[0];
        const hasConfigBtn = nodeEl.innerHTML.includes('ve-node-config-btn');

        TestRunner.assertEqual(hasConfigBtn, true, 'Config button rendered');
        TestRunner.assertEqual(editor.nodes[0].type, 'start-runner', 'Node type correct');
    });

    // Test 12: Start Runner should follow graph connections for retry targets
    TestRunner.test('Start Runner retry choices should come from directly connected graph nodes', () => {
        const editor = new VisualEditor('test-container');
        editor.nodes = [
            { id: 'runner', type: 'start-runner', data: { name: 'Start Runner Node' }, position: { x: 0, y: 0 } },
            { id: 'test-1', type: 'suite', data: { name: 'TEST1' }, position: { x: 0, y: 0 } },
            { id: 'test-2', type: 'suite', data: { name: 'TEST2' }, position: { x: 0, y: 0 } },
            { id: 'scan-1', type: 'security-scan', data: { name: 'Security Scan' }, position: { x: 0, y: 0 } },
            { id: 'gate-1', type: 'security-gate', data: { name: 'Security Gate' }, position: { x: 0, y: 0 } }
        ];
        editor.edges = [
            { id: 'edge-1', source: 'runner', target: 'test-1' },
            { id: 'edge-2', source: 'runner', target: 'test-2' },
            { id: 'edge-3', source: 'test-1', target: 'scan-1' },
            { id: 'edge-4', source: 'scan-1', target: 'gate-1' }
        ];

        const retryNodeNames = editor._getDirectlyConnectedNodes('runner').map(node => node.data.name);
        const downstreamNodeNames = editor._getDownstreamNodes('runner').map(node => node.data.name);

        TestRunner.assertDeepEqual(retryNodeNames, ['TEST1', 'TEST2'], 'Retry targets should be the directly connected graph nodes');
        TestRunner.assertDeepEqual(downstreamNodeNames, ['TEST1', 'TEST2', 'Security Scan', 'Security Gate'], 'Downstream traversal should keep graph order for stop-node choices');
    });

    // Test 13: Start Runner retry config should open with every immediate downstream node
    TestRunner.test('Start Runner retry state should include all immediate downstream nodes', () => {
        const editor = new VisualEditor('test-container');
        editor.nodes = [
            { id: 'runner-parent', type: 'start-runner', data: { name: 'Parent Runner' }, position: { x: 0, y: 0 } },
            { id: 'runner-child-a', type: 'start-runner', data: { name: 'Child Runner A' }, position: { x: 0, y: 0 } },
            { id: 'runner-child-b', type: 'start-runner', data: { name: 'Child Runner B' }, position: { x: 0, y: 0 } },
            { id: 'suite-jenny', type: 'suite', data: { name: 'Jenny <3' }, position: { x: 0, y: 0 } },
            { id: 'scan-later', type: 'security-scan', data: { name: 'Later Scan' }, position: { x: 0, y: 0 } }
        ];
        editor.edges = [
            { id: 'edge-1', source: 'runner-parent', target: 'runner-child-a' },
            { id: 'edge-2', source: 'runner-parent', target: 'runner-child-b' },
            { id: 'edge-3', source: 'runner-parent', target: 'suite-jenny' },
            { id: 'edge-4', source: 'runner-child-a', target: 'scan-later' }
        ];

        const retryState = editor._getStartRunnerRetryState('runner-parent', {
            retryTargets: [{ nodeId: 'suite-jenny', attempts: 3 }]
        });

        TestRunner.assertDeepEqual(
            retryState.retryCandidateNodes.map(node => node.data.name),
            ['Child Runner A', 'Child Runner B', 'Jenny <3'],
            'Immediate downstream graph nodes should all be detected'
        );
        TestRunner.assertDeepEqual(
            retryState.retryRows,
            [
                { nodeId: 'runner-child-a', attempts: 1 },
                { nodeId: 'runner-child-b', attempts: 1 },
                { nodeId: 'suite-jenny', attempts: 3 }
            ],
            'Retry rows should be seeded for every immediate downstream node'
        );
    });

    // Test 14: Start Runner subtree should expand nested runners and honor stop nodes
    TestRunner.test('Start Runner subtree should expand nested runners until the configured stop node', () => {
        const editor = new VisualEditor('test-container');
        editor.nodes = [
            { id: 'runner-root', type: 'start-runner', data: { name: 'Root Runner' }, position: { x: 0, y: 0 } },
            { id: 'runner-nested', type: 'start-runner', data: { name: 'Nested Runner', stopNodeId: 'nested-stop' }, position: { x: 0, y: 0 } },
            { id: 'nested-test', type: 'suite', data: { name: 'Nested Test' }, position: { x: 0, y: 0 } },
            { id: 'nested-stop', type: 'suite', data: { name: 'Nested Stop' }, position: { x: 0, y: 0 } },
            { id: 'after-stop', type: 'suite', data: { name: 'After Stop' }, position: { x: 0, y: 0 } }
        ];
        editor.edges = [
            { id: 'edge-1', source: 'runner-root', target: 'runner-nested' },
            { id: 'edge-2', source: 'runner-nested', target: 'nested-test' },
            { id: 'edge-3', source: 'nested-test', target: 'nested-stop' },
            { id: 'edge-4', source: 'nested-stop', target: 'after-stop' }
        ];

        const subtree = editor._buildStartRunnerSubtree('runner-root', 'runner-nested');
        const summarizeTree = (treeNode) => ({
            label: treeNode.label,
            isStopBoundary: treeNode.isStopBoundary,
            children: treeNode.children.map(summarizeTree)
        });

        TestRunner.assertDeepEqual(
            summarizeTree(subtree),
            {
                label: 'Nested Runner',
                isStopBoundary: false,
                children: [
                    {
                        label: 'Nested Test',
                        isStopBoundary: false,
                        children: [
                            {
                                label: 'Nested Stop',
                                isStopBoundary: true,
                                children: []
                            }
                        ]
                    }
                ]
            },
            'Sub-tree should include nested runner descendants and stop at the nested stop node'
        );
    });

    // Test 15: Zoom should update viewport scale and transform
    TestRunner.test('zoom() should update the graph viewport transform', () => {
        const editor = new VisualEditor('test-container');
        editor.init();

        editor.zoom(0.5, { clientX: 50, clientY: 50 });

        TestRunner.assertEqual(editor.scale, 1.5, 'Scale updated');
        TestRunner.assertEqual(
            editor.viewport.style.transform.includes('scale(1.5)'),
            true,
            'Viewport transform should include the new scale'
        );
    });

    // Test 16: Hand tool should pan the graph viewport
    TestRunner.test('Hand tool should pan the graph viewport without moving nodes', () => {
        const editor = new VisualEditor('test-container');
        editor.init();

        editor._setActiveTool('pan');
        editor._startPan({ preventDefault() { }, clientX: 20, clientY: 30 });
        editor._handleMouseMove({ clientX: 55, clientY: 80 });
        editor._handleMouseUp({});

        TestRunner.assertDeepEqual(editor.panning, { x: 35, y: 50 }, 'Panning should follow mouse drag');
        TestRunner.assertEqual(editor.isPanning, false, 'Pan mode should stop on mouse up');
        TestRunner.assertEqual(
            editor.viewport.style.transform.includes('translate(35px, 50px)'),
            true,
            'Viewport transform should include the pan translation'
        );
    });

    // Test 17: Dragging a node left should expand the graph origin without changing screen-space position
    TestRunner.test('Graph origin should expand for far-left nodes without changing the visual drag position', () => {
        const editor = new VisualEditor('test-container');
        editor.init();
        editor.nodes = [
            { id: 'left-node', type: 'suite', data: { name: 'Left Node' }, position: { x: 200, y: 100 } },
            { id: 'right-node', type: 'suite', data: { name: 'Right Node' }, position: { x: 700, y: 100 } }
        ];

        editor.render();
        const originBeforeMove = { ...editor.graphOrigin };
        const panningBeforeMove = { ...editor.panning };
        const screenXBeforeMove = (editor.nodes[0].position.x + editor.graphOrigin.x) * editor.scale + editor.panning.x;
        const moveDelta = -150 - 200;

        editor.nodes[0].position.x = -150;
        editor.render();

        const screenXAfterMove = (editor.nodes[0].position.x + editor.graphOrigin.x) * editor.scale + editor.panning.x;

        TestRunner.assertEqual(editor.graphOrigin.x > originBeforeMove.x, true, 'Graph origin should expand when a node moves further left');
        TestRunner.assertEqual(editor.panning.x < panningBeforeMove.x, true, 'Panning should compensate for the expanded origin');
        TestRunner.assertEqual(screenXAfterMove - screenXBeforeMove, moveDelta, 'Expanded origin should preserve linear drag movement');
    });

    // Test 18: Edge controls should remain clickable
    TestRunner.test('Graph layers should leave edge delete controls clickable', () => {
        const editor = new VisualEditor('test-container');
        editor.init();
        editor.nodes = [
            { id: 'source-node', type: 'suite', data: { name: 'Source' }, position: { x: 0, y: 0 } },
            { id: 'target-node', type: 'suite', data: { name: 'Target' }, position: { x: 300, y: 0 } }
        ];
        editor.edges = [
            { id: 'edge-1', source: 'source-node', target: 'target-node' }
        ];
        editor.render();

        TestRunner.assertEqual(editor.svgLayer.style.pointerEvents, 'auto', 'SVG layer should allow edge interactions');
        TestRunner.assertEqual(editor.nodeLayer.style.pointerEvents, 'none', 'Node layer should let clicks pass through empty space');
        TestRunner.assertEqual(editor.svgLayer.children.length, 3, 'Each edge should render a path, hit path, and delete group');
        TestRunner.assertEqual(editor.svgLayer.children[2].children.length, 3, 'Delete group should include an expanded hit target');
    });

    // Test 19: Ordinary suite-backed nodes should be configurable from graph view
    TestRunner.test('Suite-backed nodes should render a config button', () => {
        const editor = new VisualEditor('test-container');
        editor.init();

        editor.addNode({
            id: 'suite-node',
            type: 'job',
            data: { suiteId: 'suite-123', name: 'P-Tester' },
            position: { x: 0, y: 0 }
        });

        const nodeEl = editor.nodeLayer.children[0];
        const hasConfigBtn = nodeEl.innerHTML.includes('ve-node-config-btn');
        const usesSuiteHandler = nodeEl.innerHTML.includes("showSuiteNodeConfig('suite-node')");

        TestRunner.assertEqual(hasConfigBtn, true, 'Suite-backed node should render config button');
        TestRunner.assertEqual(usesSuiteHandler, true, 'Suite-backed node config button should open the suite editor');
    });

    // Test 20: Special graph nodes should execute through the graph runner with upstream dependencies
    TestRunner.test('Special graph node run buttons should execute an upstream subgraph', () => {
        const editor = new VisualEditor('test-container');
        editor.nodes = [
            { id: 'runner', type: 'start-runner', data: { name: 'Runner' }, position: { x: 0, y: 0 } },
            { id: 'repo', type: 'git-repo', data: { name: 'Git Repo' }, position: { x: 0, y: 0 } },
            { id: 'unit', type: 'unit-test-runner', data: { name: 'Unit Test' }, position: { x: 0, y: 0 } }
        ];
        editor.edges = [
            { id: 'edge-1', source: 'runner', target: 'repo' },
            { id: 'edge-2', source: 'repo', target: 'unit' }
        ];

        let capturedPipeline = null;
        global.runGraphPipeline = (pipeline) => {
            capturedPipeline = pipeline;
        };

        editor.runNode('unit');

        TestRunner.assertEqual(Boolean(capturedPipeline), true, 'Graph runner should be invoked');
        TestRunner.assertDeepEqual(
            capturedPipeline.nodes.map(node => node.id),
            ['repo', 'unit'],
            'Subgraph should include the selected node and its non-runner upstream dependencies'
        );
        TestRunner.assertDeepEqual(
            capturedPipeline.edges.map(edge => edge.id),
            ['edge-2'],
            'Subgraph should only include edges within the selected execution scope'
        );
    });

    // Test 21: AI Log Summary should appear in the integration palette
    TestRunner.test('AI Log Summary node should appear in the integration palette', () => {
        const editor = new VisualEditor('test-container');
        editor.init();

        const toolbarContainsNode = editor.container.children.some(child =>
            typeof child.innerHTML === 'string' && child.innerHTML.includes('data-type="ai-log-summary"')
        );

        TestRunner.assertEqual(toolbarContainsNode, true, 'AI Log Summary palette item rendered');
    });

    // Test 22: Dropping AI Log Summary should create the node with defaults
    TestRunner.test('AI Log Summary drop should create a configured node', () => {
        const editor = new VisualEditor('test-container');
        editor.init();

        editor._handleDrop({
            preventDefault() { },
            clientX: 150,
            clientY: 200,
            dataTransfer: {
                getData() {
                    return JSON.stringify({
                        type: 'ai-log-summary',
                        name: 'AI Log Summary'
                    });
                }
            }
        });

        TestRunner.assertEqual(editor.nodes.length, 1, 'Node added');
        TestRunner.assertEqual(editor.nodes[0].type, 'ai-log-summary', 'Node type correct');
        TestRunner.assertEqual(editor.nodes[0].data.provider, 'google', 'Default provider set');
        TestRunner.assertEqual(editor.nodes[0].data.maxTokens, 16384, 'Default token limit set');
        TestRunner.assertEqual(editor.nodes[0].data.summaryScope, 'full-runner-log', 'Default summary scope should capture the full runner log');
    });

    // Test 23: AI Log Summary should render a config button and build its modal
    TestRunner.test('AI Log Summary node should render config UI', () => {
        const editor = new VisualEditor('test-container');
        editor.init();
        document.body.children = [];

        editor.addNode({
            id: 'ai-log-node',
            type: 'ai-log-summary',
            data: {
                name: 'My Log Analyzer',
                provider: 'google',
                instructions: 'Summarize the logs'
            },
            position: { x: 0, y: 0 }
        });

        const nodeEl = editor.nodeLayer.children[0];
        const hasConfigBtn = nodeEl.innerHTML.includes('ve-node-config-btn');
        const usesAILogHandler = nodeEl.innerHTML.includes("showAILogSummaryConfig('ai-log-node')");

        editor.showAILogSummaryConfig('ai-log-node');
        const modal = document.body.children[document.body.children.length - 1];

        TestRunner.assertEqual(hasConfigBtn, true, 'Config button rendered');
        TestRunner.assertEqual(usesAILogHandler, true, 'Config button should open AI Log Summary config');
        TestRunner.assertEqual(modal.innerHTML.includes('AI Assisted Log Summary'), true, 'Modal title rendered');
        TestRunner.assertEqual(modal.innerHTML.includes('cfg-ai-log-provider'), true, 'Provider selector rendered');
        TestRunner.assertEqual(modal.innerHTML.includes('cfg-ai-log-scope'), true, 'Summary scope selector rendered');
        TestRunner.assertEqual(modal.innerHTML.includes('cfg-ai-log-save-path'), true, 'Save path input rendered');
    });

    // Test 24: AI Log Summary run should execute through the graph runner
    TestRunner.test('AI Log Summary run should execute an upstream subgraph', () => {
        const editor = new VisualEditor('test-container');
        editor.nodes = [
            { id: 'suite-node', type: 'job', data: { suiteId: 'suite-1', name: 'P-Tester' }, position: { x: 0, y: 0 } },
            { id: 'ai-log-node', type: 'ai-log-summary', data: { name: 'AI Log Summary' }, position: { x: 0, y: 0 } }
        ];
        editor.edges = [
            { id: 'edge-1', source: 'suite-node', target: 'ai-log-node' }
        ];

        let capturedPipeline = null;
        global.runGraphPipeline = (pipeline) => {
            capturedPipeline = pipeline;
        };

        editor.runNode('ai-log-node');

        TestRunner.assertEqual(Boolean(capturedPipeline), true, 'Graph runner should be invoked');
        TestRunner.assertDeepEqual(
            capturedPipeline.nodes.map(node => node.id),
            ['suite-node', 'ai-log-node'],
            'Subgraph should include the upstream node and the AI log summary node'
        );
    });

    // Test 25: AI Log Summary context should include upstream suite logs
    TestRunner.test('AI Log Summary context should collect suite log details', () => {
        const editor = new VisualEditor('test-container');
        global.testSuites = [
            {
                id: 'suite-1',
                name: 'P-Tester',
                last_run_status: 'SUCCESS',
                last_run_log: 'PRINT'
            }
        ];

        const logContext = editor._buildAILogSummaryContext(
            { id: 'ai-log-node', type: 'ai-log-summary', data: { name: 'AI Log Summary' } },
            [
                { id: 'suite-node', type: 'job', data: { suiteId: 'suite-1', name: 'P-Tester' } }
            ],
            {}
        );

        TestRunner.assertEqual(logContext.sourceCount, 1, 'One upstream source should be included');
        TestRunner.assertEqual(logContext.logText.includes('STATUS: SUCCESS'), true, 'Suite status should be included');
        TestRunner.assertEqual(logContext.logText.includes('LOG:\nPRINT'), true, 'Suite log should be included');
    });

    // Test 26: AI Log Summary context should preserve AI unit test totals from execution logs
    TestRunner.test('AI Log Summary context should include parsed AI unit test totals', () => {
        const editor = new VisualEditor('test-container');
        const aiTestLog = [
            'PASS calc/localTest1',
            'PASS calc/localTest2',
            'Total: 18 tests, 16 passed, 2 failed',
            'Failed tests: node ai-generated-test.js'
        ].join('\n');

        const logContext = editor._buildAILogSummaryContext(
            { id: 'ai-log-node', type: 'ai-log-summary', data: { name: 'AI Log Summary' } },
            [
                { id: 'ai-unit-node', type: 'ai-unit-test', data: { name: 'AI: ai-generated-test.js' } }
            ],
            {
                'ai-unit-node': {
                    status: 'FAILURE',
                    message: 'AI Tests Failed (exit 1)',
                    log: aiTestLog,
                    output: aiTestLog,
                    stdout: aiTestLog,
                    stderr: 'Failed tests: node ai-generated-test.js'
                }
            }
        );

        TestRunner.assertEqual(logContext.logText.includes('TEST SUMMARY:'), true, 'Parsed AI test summary should be included');
        TestRunner.assertEqual(logContext.logText.includes('Total: 18'), true, 'Total test count should be included');
        TestRunner.assertEqual(logContext.logText.includes('Passed: 16'), true, 'Passed test count should be included');
        TestRunner.assertEqual(logContext.logText.includes('Failed: 2'), true, 'Failed test count should be included');
    });

    // Test 27: AI Log Summary output panel should render disclaimer and content
    TestRunner.test('AI Log Summary output panel should render the disclaimer and summary text', () => {
        const editor = new VisualEditor('test-container');
        document.body.children = [];

        editor.showAILogSummaryOutput(
            { id: 'ai-log-node', data: { name: 'AI Log Summary' } },
            'Summary body here',
            {
                sourceNames: ['P-Tester'],
                providerLabel: 'Google (Gemini)'
            }
        );

        const modal = document.body.children[document.body.children.length - 1];
        TestRunner.assertEqual(modal.innerHTML.includes('Disclaimer'), true, 'Disclaimer should be visible');
        TestRunner.assertEqual(modal.innerHTML.includes('Summary body here'), true, 'Summary content should be rendered');
    });

    // Test 28: Undo/redo should restore graph snapshots
    TestRunner.test('undo() and redo() should restore graph state snapshots', () => {
        const editor = new VisualEditor('test-container');
        editor.init();

        editor.addNode({
            id: 'node-a',
            type: 'job',
            data: { name: 'Suite A', suiteId: 'suite-a' },
            position: { x: 0, y: 0 }
        });
        editor.addNode({
            id: 'node-b',
            type: 'job',
            data: { name: 'Suite B', suiteId: 'suite-b' },
            position: { x: 120, y: 0 }
        });

        TestRunner.assertEqual(editor.nodes.length, 2, 'Two nodes should exist before undo');

        const undoWorked = editor.undo();
        TestRunner.assertEqual(undoWorked, true, 'Undo should return true');
        TestRunner.assertEqual(editor.nodes.length, 1, 'Undo should remove the last snapshot change');
        TestRunner.assertEqual(editor.nodes[0].id, 'node-a', 'Undo should restore the earlier graph snapshot');

        const redoWorked = editor.redo();
        TestRunner.assertEqual(redoWorked, true, 'Redo should return true');
        TestRunner.assertEqual(editor.nodes.length, 2, 'Redo should restore the removed node');
        TestRunner.assertEqual(editor.nodes[1].id, 'node-b', 'Redo should restore the second node');
    });

    // Test 28: Connection validation should enforce graph rules
    TestRunner.test('Connection validation should enforce graph-specific rules', () => {
        const editor = new VisualEditor('test-container');
        editor.nodes = [
            { id: 'suite-node', type: 'job', data: { name: 'Suite', suiteId: 'suite-1' }, position: { x: 0, y: 0 } },
            { id: 'scan-node', type: 'security-scan', data: { name: 'Scan' }, position: { x: 100, y: 0 } },
            { id: 'gate-node', type: 'security-gate', data: { name: 'Gate' }, position: { x: 200, y: 0 } },
            { id: 'runner-a', type: 'start-runner', data: { name: 'Runner A' }, position: { x: 0, y: 100 } },
            { id: 'runner-b', type: 'start-runner', data: { name: 'Runner B' }, position: { x: 100, y: 100 } },
            { id: 'summary-node', type: 'ai-log-summary', data: { name: 'Summary' }, position: { x: 300, y: 0 } }
        ];
        editor.edges = [];

        const suiteToGate = editor._validateConnection(editor.nodes[0], editor.nodes[2]);
        const scanToGate = editor._validateConnection(editor.nodes[1], editor.nodes[2]);
        const runnerToRunner = editor._validateConnection(editor.nodes[3], editor.nodes[4]);
        const gateToSummary = editor._validateConnection(editor.nodes[2], editor.nodes[5]);

        TestRunner.assertEqual(suiteToGate.valid, false, 'Security Gate should reject non-scan parents');
        TestRunner.assertEqual(scanToGate.valid, true, 'Security Scan should be allowed to feed Security Gate');
        TestRunner.assertEqual(runnerToRunner.valid, true, 'Start Runner should still allow another Start Runner');
        TestRunner.assertEqual(gateToSummary.valid, false, 'AI Log Summary should reject nodes that do not produce logs');
    });

    // Test 30: Integrations palette should not duplicate or corrupt Git Repo / Unit Test cards
    TestRunner.test('Integrations palette should render one Git Repo item and one Unit Test item', () => {
        const editor = new VisualEditor('test-container');
        editor.init();

        const toolbarHtml = editor.container.children
            .map(child => (typeof child.innerHTML === 'string' ? child.innerHTML : ''))
            .join('\n');
        const gitRepoMatches = toolbarHtml.match(/data-type="git-repo"/g) || [];
        const unitTestMatches = toolbarHtml.match(/data-type="unit-test-runner"/g) || [];

        TestRunner.assertEqual(gitRepoMatches.length, 1, 'Git Repo should appear once in the integrations palette');
        TestRunner.assertEqual(unitTestMatches.length, 1, 'Unit Test should appear once in the integrations palette');
    });

    // Test 31: Automation palette should render the new node types
    TestRunner.test('Automation palette should include API, website, deploy, and delay nodes', () => {
        const editor = new VisualEditor('test-container');
        editor.init();

        const toolbarHtml = editor.container.children
            .map(child => (typeof child.innerHTML === 'string' ? child.innerHTML : ''))
            .join('\n');

        TestRunner.assertEqual(toolbarHtml.includes('data-type="api-performance"'), true, 'API Performance should be in the palette');
        TestRunner.assertEqual(toolbarHtml.includes('data-type="api-contract"'), true, 'API Contract should be in the palette');
        TestRunner.assertEqual(toolbarHtml.includes('data-type="code-review"'), true, 'AI Code Review should be in the palette');
        TestRunner.assertEqual(toolbarHtml.includes('data-type="website-ux-auto-tester"'), true, 'Website UX Auto Tester should be in the palette');
        TestRunner.assertEqual(toolbarHtml.includes('data-type="push-deploy"'), true, 'Push & Deploy should be in the palette');
        TestRunner.assertEqual(toolbarHtml.includes('data-type="wait-delay"'), true, 'Wait / Delay should be in the palette');
    });

    // Test 32: Automation node drops should create configured nodes with sane defaults
    TestRunner.test('Automation node drops should create API, code review, and wait nodes with expected defaults', () => {
        const editor = new VisualEditor('test-container');
        editor.init();

        editor._handleDrop({
            preventDefault() { },
            clientX: 0,
            clientY: 0,
            dataTransfer: {
                getData() {
                    return JSON.stringify({
                        type: 'api-performance',
                        name: 'API Performance'
                    });
                }
            }
        });

        editor._handleDrop({
            preventDefault() { },
            clientX: 40,
            clientY: 40,
            dataTransfer: {
                getData() {
                    return JSON.stringify({
                        type: 'code-review',
                        name: 'AI Code Review'
                    });
                }
            }
        });

        editor._handleDrop({
            preventDefault() { },
            clientX: 80,
            clientY: 80,
            dataTransfer: {
                getData() {
                    return JSON.stringify({
                        type: 'wait-delay',
                        name: 'Wait / Delay'
                    });
                }
            }
        });

        TestRunner.assertEqual(editor.nodes.length, 3, 'Three automation nodes should be created');
        TestRunner.assertEqual(editor.nodes[0].type, 'api-performance', 'API Performance node type should be created');
        TestRunner.assertEqual(editor.nodes[1].type, 'code-review', 'Code Review node type should be created');
        TestRunner.assertEqual(editor.nodes[1].data.mode, 'review', 'Code Review should default to review mode');
        TestRunner.assertEqual(editor.nodes[2].type, 'wait-delay', 'Wait / Delay node type should be created');
        TestRunner.assertEqual(editor.nodes[2].data.delayMs, 5000, 'Wait / Delay should default to 5 seconds');
    });

    // Test 33: New automation modals should use the readable form theme
    TestRunner.test('Code Review config modal should include readable form styling', () => {
        const editor = new VisualEditor('test-container');
        editor.init();

        editor.addNode({
            id: 'review-node',
            type: 'code-review',
            data: {
                name: 'AI Code Review',
                mode: 'review',
                language: 'javascript'
            },
            position: { x: 0, y: 0 }
        });

        editor.showCodeReviewConfig('review-node');
        const modal = editor.container.children[editor.container.children.length - 1];

        TestRunner.assertEqual(modal.innerHTML.includes('ve-readable-node-modal'), true, 'Readable modal class should be present');
        TestRunner.assertEqual(modal.innerHTML.includes('input::placeholder'), true, 'Readable placeholder styling should be present');
    });

    // Test 34: Automation nodes should run through the graph runner instead of falling back to suite execution
    TestRunner.test('Automation node run should execute a graph subgraph', () => {
        const editor = new VisualEditor('test-container');
        editor.nodes = [
            { id: 'api-node', type: 'api-performance', data: { name: 'API Performance' }, position: { x: 0, y: 0 } }
        ];
        editor.edges = [];

        let capturedPipeline = null;
        global.runGraphPipeline = (pipeline) => {
            capturedPipeline = pipeline;
        };
        global.runTestSuite = () => {
            throw new Error('runTestSuite should not be used for automation nodes');
        };

        editor.runNode('api-node');

        TestRunner.assertEqual(Boolean(capturedPipeline), true, 'Graph runner should be invoked for automation nodes');
        TestRunner.assertDeepEqual(
            capturedPipeline.nodes.map(node => node.id),
            ['api-node'],
            'Automation node subgraph should include the requested node'
        );
    });

    // Test 35: AI Unit Test node should expose configurable automation controls
    TestRunner.test('AI Unit Test config should preserve manual defaults and expose automation settings', () => {
        const editor = new VisualEditor('test-container');
        editor.init();

        editor._handleDrop({
            preventDefault() { },
            clientX: 20,
            clientY: 20,
            dataTransfer: {
                getData() {
                    return JSON.stringify({
                        type: 'ai-unit-test',
                        name: 'AI Unit Test'
                    });
                }
            }
        });

        const node = editor.nodes[0];
        TestRunner.assertEqual(node.type, 'ai-unit-test', 'AI Unit Test node type should be created');
        TestRunner.assertEqual(node.data.automationMode, 'manual', 'AI Unit Test should default to manual mode');
        TestRunner.assertEqual(node.data.testMode, 'auto', 'AI Unit Test should default to auto-detect test mode');
        TestRunner.assertEqual(node.data.sourceStrategy, 'saved-selection', 'AI Unit Test should default to saved source selection');
        TestRunner.assertEqual(Array.isArray(node.data.selectedSourceFiles), true, 'AI Unit Test should track selected source files');

        editor.showAIUnitTestConfig(node.id);
        const modal = document.body.children[document.body.children.length - 1];

        TestRunner.assertEqual(modal.innerHTML.includes('Execution workflow'), true, 'Automation workflow selector should be visible');
        TestRunner.assertEqual(modal.innerHTML.includes('Repo source strategy'), true, 'Source strategy selector should be visible');
        TestRunner.assertEqual(modal.innerHTML.includes('Test generation style'), true, 'Test generation mode selector should be visible');
        TestRunner.assertEqual(modal.innerHTML.includes('On auto-generation failure'), true, 'Fallback behavior selector should be visible');
    });

    // Test 36: AI Unit Test modal should recognize repo paths produced by connected Git Repo nodes
    TestRunner.test('AI Unit Test config should surface a connected cloned repo path', () => {
        const editor = new VisualEditor('test-container');
        editor.init();
        editor.nodes = [
            {
                id: 'git-node',
                type: 'git-repo',
                data: {
                    name: 'Git Repo',
                    lastClonedPath: 'C:/temp/lvx-repo'
                },
                position: { x: 0, y: 0 }
            },
            {
                id: 'ai-node',
                type: 'ai-unit-test',
                data: {
                    name: 'AI Unit Test',
                    testFilename: 'ai-generated-test.js',
                    automationMode: 'assisted',
                    testMode: 'auto',
                    sourceStrategy: 'saved-selection',
                    selectedSourceFiles: []
                },
                position: { x: 100, y: 0 }
            }
        ];
        editor.edges = [{ id: 'git-ai', source: 'git-node', target: 'ai-node' }];

        editor.showAIUnitTestConfig('ai-node');
        const modal = document.body.children[document.body.children.length - 1];

        TestRunner.assertEqual(modal.innerHTML.includes('Connected repo clone ready at C:/temp/lvx-repo'), true, 'Connected repo clone path should be shown in the source status');
    });

    TestRunner.test('Website UX Auto Tester node should expose source and scenario controls', () => {
        const editor = new VisualEditor('test-container');
        editor.init();

        editor._handleDrop({
            preventDefault() { },
            clientX: 20,
            clientY: 20,
            dataTransfer: {
                getData() {
                    return JSON.stringify({
                        type: 'website-ux-auto-tester',
                        name: 'Website UX Auto Tester'
                    });
                }
            }
        });

        const node = editor.nodes[0];
        TestRunner.assertEqual(node.type, 'website-ux-auto-tester', 'Website UX Auto Tester node type should be created');
        TestRunner.assertEqual(node.data.sourceMode, 'auto', 'Website UX Auto Tester should default to auto source mode');
        TestRunner.assertEqual(node.data.autoExplore, true, 'Website UX Auto Tester should default to automatic exploration');
        TestRunner.assertEqual(node.data.continueOnFailure, true, 'Website UX Auto Tester should default to collecting a full report');

        editor.showWebsiteUXAutoTesterConfig(node.id);
        const modal = editor.container.children[editor.container.children.length - 1];

        TestRunner.assertEqual(modal.innerHTML.includes('Website source mode'), true, 'Website source mode selector should be visible');
        TestRunner.assertEqual(modal.innerHTML.includes('Auto-audit route list'), true, 'Route list control should be visible');
        TestRunner.assertEqual(modal.innerHTML.includes('Custom path scenarios (JSON)'), true, 'Custom scenario JSON control should be visible');
        TestRunner.assertEqual(modal.innerHTML.includes('Auto-audit visible controls'), true, 'Automatic exploration toggle should be visible');
        TestRunner.assertEqual(modal.innerHTML.includes('freshly generated website output'), true, 'Auto-detect helper text should explain upstream-first source selection');
    });

    TestRunner.test('Website UX Auto Tester should run through the graph runner', () => {
        const editor = new VisualEditor('test-container');
        editor.nodes = [
            { id: 'ux-node', type: 'website-ux-auto-tester', data: { name: 'Website UX Auto Tester' }, position: { x: 0, y: 0 } }
        ];
        editor.edges = [];

        let capturedPipeline = null;
        global.runGraphPipeline = (pipeline) => {
            capturedPipeline = pipeline;
        };
        global.runTestSuite = () => {
            throw new Error('runTestSuite should not be used for Website UX Auto Tester nodes');
        };

        editor.runNode('ux-node');

        TestRunner.assertEqual(Boolean(capturedPipeline), true, 'Graph runner should be invoked for Website UX Auto Tester nodes');
        TestRunner.assertDeepEqual(
            capturedPipeline.nodes.map(node => node.id),
            ['ux-node'],
            'Website UX Auto Tester subgraph should include the requested node'
        );
    });

    TestRunner.test('Git Repo and Push & Deploy should default to failing on missing branches', () => {
        const editor = new VisualEditor('test-container');
        editor.init();

        editor._handleDrop({
            preventDefault() { },
            clientX: 10,
            clientY: 10,
            dataTransfer: {
                getData() {
                    return JSON.stringify({ type: 'git-repo', name: 'Git Repo' });
                }
            }
        });

        editor._handleDrop({
            preventDefault() { },
            clientX: 20,
            clientY: 20,
            dataTransfer: {
                getData() {
                    return JSON.stringify({ type: 'push-deploy', name: 'Push & Deploy' });
                }
            }
        });

        TestRunner.assertEqual(editor.nodes[0].data.branchMissingPolicy, 'fail', 'Git Repo should default to failing on missing branches');
        TestRunner.assertEqual(editor.nodes[0].data.branchBase, 'main', 'Git Repo should default branch creation base to main');
        TestRunner.assertEqual(editor.nodes[1].data.branchMissingPolicy, 'fail', 'Push & Deploy should default to failing on missing branches');
        TestRunner.assertEqual(editor.nodes[1].data.branchBase, 'main', 'Push & Deploy should default branch creation base to main');
    });

    TestRunner.test('Push & Deploy config should expose branch creation controls', () => {
        const editor = new VisualEditor('test-container');
        editor.init();
        editor.nodes = [
            {
                id: 'deploy-node',
                type: 'push-deploy',
                data: { name: 'Push & Deploy', branch: 'main' },
                position: { x: 0, y: 0 }
            }
        ];
        editor.edges = [];

        editor.showPushDeployConfig('deploy-node');
        const modal = editor.container.children[editor.container.children.length - 1];

        TestRunner.assertEqual(modal.innerHTML.includes('cfg-deploy-branch-policy'), true, 'Deploy config should include branch-missing policy');
        TestRunner.assertEqual(modal.innerHTML.includes('cfg-deploy-branch-base'), true, 'Deploy config should include branch creation base');
    });

    // Summary
    return TestRunner.summary();
}

// Export for different environments
if (typeof module !== 'undefined' && module.exports) {
    // Node.js environment - need to load VisualEditor
    const fs = require('fs');
    const path = require('path');

    // Load VisualEditor source
    const visualEditorPath = path.join(__dirname, 'visual-editor.js');
    const visualEditorCode = fs.readFileSync(visualEditorPath, 'utf8');

    // Execute in context (simple eval for testing)
    eval(visualEditorCode.replace('window.VisualEditor', 'global.VisualEditor').replace('window.visualEditor', '// global.visualEditor'));

    // Run tests
    const success = runTests();
    process.exit(success ? 0 : 1);
} else if (typeof window !== 'undefined') {
    // Browser environment
    window.runVisualEditorTests = runTests;
    console.log('Tests loaded. Call runVisualEditorTests() to run.');
}
