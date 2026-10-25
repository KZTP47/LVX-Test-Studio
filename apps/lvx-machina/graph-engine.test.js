/**
 * Unit Tests for GraphEngine
 *
 * Run with: npm test
 */

const TestRunner = {
    passed: 0,
    failed: 0,

    test(name, fn) {
        Promise.resolve()
            .then(fn)
            .then(() => {
                this.passed++;
                console.log(`✓ ${name}`);
            })
            .catch(error => {
                this.failed++;
                console.error(`✗ ${name}: ${error.message}`);
            });
    },

    assertEqual(actual, expected, message = '') {
        if (actual !== expected) {
            throw new Error(`${message} Expected ${expected}, got ${actual}`);
        }
    }
};

async function runTests() {
    console.log('\n=== GraphEngine Unit Tests ===\n');

    const graph = {
        nodes: [
            { id: 'runner', data: { name: 'Start Runner' }, executionPolicy: { retryAttempts: 0 } },
            { id: 'test-node', data: { name: 'Retry Me' }, executionPolicy: { retryAttempts: 2 } }
        ],
        edges: [{ id: 'edge-1', source: 'runner', target: 'test-node' }]
    };

    await (async () => {
        let attempts = 0;
        try {
            const engine = new GraphEngine();
            const result = await engine.execute(graph, async (node) => {
                if (node.id === 'runner') {
                    return { status: 'SUCCESS' };
                }

                attempts += 1;
                return attempts < 3
                    ? { status: 'FAILURE', message: 'Transient failure' }
                    : { status: 'SUCCESS', message: 'Recovered' };
            });

            TestRunner.assertEqual(result.status, 'SUCCESS', 'Overall status after retry recovery');
            TestRunner.assertEqual(attempts, 3, 'Retry attempts should be honored');
            TestRunner.passed++;
            console.log('✓ execute() should retry nodes based on execution policy');
        } catch (error) {
            TestRunner.failed++;
            console.error(`✗ execute() should retry nodes based on execution policy: ${error.message}`);
        }
    })();

    await (async () => {
        try {
            const engine = new GraphEngine();
            const timings = {};
            const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

            await engine.execute({
                nodes: [
                    { id: 'a', data: { name: 'A' } },
                    { id: 'b', data: { name: 'B' } },
                    { id: 'c', data: { name: 'C' } }
                ],
                edges: [
                    { id: 'edge-a-c', source: 'a', target: 'c' },
                    { id: 'edge-b-c', source: 'b', target: 'c' }
                ]
            }, async (node) => {
                timings[node.id] = timings[node.id] || {};
                timings[node.id].start = Date.now();

                if (node.id === 'c') {
                    await delay(10);
                } else {
                    await delay(60);
                }

                timings[node.id].end = Date.now();
                return { status: 'SUCCESS', artifacts: { [node.id]: true } };
            });

            if (!(timings.a.start < timings.b.end && timings.b.start < timings.a.end)) {
                throw new Error('Independent siblings did not overlap in execution');
            }

            const siblingCompletion = Math.max(timings.a.end, timings.b.end);
            if (timings.c.start < siblingCompletion) {
                throw new Error('Dependent node started before its upstream level completed');
            }

            TestRunner.passed++;
            console.log('✓ execute() should run independent nodes in parallel by level');
        } catch (error) {
            TestRunner.failed++;
            console.error(`✗ execute() should run independent nodes in parallel by level: ${error.message}`);
        }
    })();

    await (async () => {
        try {
            const engine = new GraphEngine();
            const result = await engine.execute({
                nodes: [{ id: 'node-a', data: { name: 'Node A' } }],
                edges: []
            }, async () => ({ status: 'ERROR', message: 'boom' }));

            TestRunner.assertEqual(result.status, 'FAILURE', 'ERROR results should mark graph as failed');
            TestRunner.passed++;
            console.log('✓ execute() should treat ERROR results as failures');
        } catch (error) {
            TestRunner.failed++;
            console.error(`✗ execute() should treat ERROR results as failures: ${error.message}`);
        }
    })();

    await (async () => {
        try {
            const engine = new GraphEngine();
            engine.executionLog.push('stale-entry');
            const result = await engine.execute({
                nodes: [{ id: 'node-b', data: { name: 'Node B' } }],
                edges: []
            }, async () => ({
                status: 'SUCCESS',
                artifacts: { tempFile: 'artifact-path' }
            }));

            TestRunner.assertEqual(engine.executionLog.length, 0, 'Execution log should be cleared after each run');
            TestRunner.assertEqual(result.artifacts.tempFile, 'artifact-path', 'Returned artifacts should survive cleanup');
            TestRunner.passed++;
            console.log('âœ“ execute() should clear retained execution state after finishing');
        } catch (error) {
            TestRunner.failed++;
            console.error(`âœ— execute() should clear retained execution state after finishing: ${error.message}`);
        }
    })();

    const total = TestRunner.passed + TestRunner.failed;
    console.log('\n========================================');
    console.log(`Tests: ${total} | Passed: ${TestRunner.passed} | Failed: ${TestRunner.failed}`);
    console.log('========================================\n');

    if (TestRunner.failed > 0) {
        process.exitCode = 1;
    }
}

if (typeof window === 'undefined') {
    global.window = {};
}

const fs = require('fs');
const path = require('path');
const graphEnginePath = path.join(__dirname, 'graph-engine.js');
const graphEngineCode = fs.readFileSync(graphEnginePath, 'utf8');
eval(graphEngineCode.replace('window.GraphEngine = GraphEngine;', 'global.GraphEngine = GraphEngine;'));

runTests();
