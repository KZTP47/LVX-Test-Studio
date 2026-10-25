/**
 * GRAPH ENGINE
 * Handles execution of complex dependency graphs (DAGs).
 * - Topological Sort for execution order.
 * - Parallel execution for independent levels.
 * - Artifact passing via shared Context.
 */

class GraphEngine {
    constructor() {
        this.executionLog = [];
    }

    clearExecutionLog() {
        this.executionLog = [];
    }

    /**
     * Executes a graph-based pipeline.
     * @param {Object} graphPipeline - { nodes: [], edges: [] }
     * @param {Function} nodeRunner - async function(node, context) to execute a single node.
     */
    async execute(graphPipeline, nodeRunner) {
        this.clearExecutionLog();
        const { nodes, edges } = graphPipeline;
        const context = {
            artifacts: {}, // Shared data storage
            results: {},   // Execution results by node ID
            startTime: Date.now()
        };

        console.log("[GraphEngine] Starting execution...");

        // 1. Topological levels
        const executionLevels = this._getExecutionLevels(nodes, edges);
        console.log("[GraphEngine] Execution Levels:", executionLevels.map(level => level.map(n => n.data?.name || n.id)));

        // 2. Execute each independent level in parallel.
        let overallStatus = 'SUCCESS';

        for (const level of executionLevels) {
            const levelResults = await Promise.all(level.map(async (node) => {
                console.log(`[GraphEngine] Executing Node: ${node.data?.name || node.id}`);

                try {
                    const inputs = this._resolveInputs(node, edges, context);
                    const retryAttempts = Number.isFinite(node.executionPolicy?.retryAttempts)
                        ? Math.max(0, node.executionPolicy.retryAttempts)
                        : 0;

                    let result = null;
                    let attempt = 0;

                    do {
                        result = await nodeRunner(node, inputs, context);

                        if (!this._isFailureResult(result)) {
                            break;
                        }

                        attempt += 1;
                    } while (attempt <= retryAttempts);

                    return { node, result };
                } catch (error) {
                    console.error(`[GraphEngine] Node Error (${node.data?.name || node.id}):`, error);
                    return { node, error };
                }
            }));

            let shouldStop = false;

            for (const entry of levelResults) {
                if (entry.error) {
                    context.results[entry.node.id] = { status: 'ERROR', error: entry.error.message };
                    overallStatus = 'FAILURE';
                    shouldStop = true;
                    continue;
                }

                const result = entry.result || { status: 'ERROR', error: 'Node runner returned no result' };
                context.results[entry.node.id] = result;

                if (result.artifacts) {
                    Object.assign(context.artifacts, result.artifacts);
                }

                if (this._isFailureResult(result)) {
                    overallStatus = 'FAILURE';
                    if (entry.node.onFailure === 'stop') {
                        shouldStop = true;
                    }
                }
            }

            if (shouldStop) {
                break;
            }
        }

        const finalResult = {
            status: overallStatus,
            duration: Date.now() - context.startTime,
            results: { ...context.results },
            artifacts: { ...context.artifacts }
        };

        Object.keys(context.results).forEach(key => delete context.results[key]);
        Object.keys(context.artifacts).forEach(key => delete context.artifacts[key]);
        this.clearExecutionLog();

        return finalResult;
    }

    _getExecutionLevels(nodes, edges) {
        const inDegree = new Map();
        const adj = new Map();
        const nodeMap = new Map();

        nodes.forEach(node => {
            inDegree.set(node.id, 0);
            adj.set(node.id, []);
            nodeMap.set(node.id, node);
        });

        edges.forEach(edge => {
            const currentIn = inDegree.get(edge.target) || 0;
            inDegree.set(edge.target, currentIn + 1);

            const currentAdj = adj.get(edge.source) || [];
            currentAdj.push(edge.target);
            adj.set(edge.source, currentAdj);
        });

        let queue = [];
        inDegree.forEach((count, id) => {
            if (count === 0) queue.push(id);
        });

        const levels = [];
        let processedCount = 0;
        while (queue.length > 0) {
            const currentLevelIds = [...queue];
            queue = [];
            const currentLevelNodes = [];

            currentLevelIds.forEach((nodeId) => {
                const nodeNode = nodeMap.get(nodeId);
                if (nodeNode) {
                    currentLevelNodes.push(nodeNode);
                    processedCount += 1;
                }

                const neighbors = adj.get(nodeId) || [];
                neighbors.forEach(v => {
                    const newCount = (inDegree.get(v) || 0) - 1;
                    inDegree.set(v, newCount);
                    if (newCount === 0) queue.push(v);
                });
            });

            if (currentLevelNodes.length > 0) {
                levels.push(currentLevelNodes);
            }
        }

        if (processedCount !== nodes.length) {
            throw new Error("Cycle detected in pipeline! Graph must be Acyclic (DAG).");
        }

        return levels;
    }

    _getTopologicalSort(nodes, edges) {
        return this._getExecutionLevels(nodes, edges).flat();
    }

    _resolveInputs(node, edges, context) {
        // Downstream nodes get a flat artifact view for backwards compatibility,
        // plus structured snapshots for nodes that need broader pipeline context.
        const artifactSnapshot = { ...context.artifacts };
        const resultSnapshot = { ...context.results };
        return {
            ...artifactSnapshot,
            artifacts: artifactSnapshot,
            resultsByNodeId: resultSnapshot
        };
    }

    _isFailureResult(result) {
        const normalizedStatus = String(result?.status || '').toUpperCase();
        return normalizedStatus === 'FAILURE' || normalizedStatus === 'FAILED' || normalizedStatus === 'ERROR';
    }
}

// Export
window.GraphEngine = GraphEngine;
