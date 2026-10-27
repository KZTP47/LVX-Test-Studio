/**
 * GRAPH ENGINE
 * Handles execution of complex dependency graphs (DAGs).
 * - Topological Sort for execution order.
 * - Parallel execution support (future proofing).
 * - Artifact passing via shared Context.
 */

class GraphEngine {
    static async waitDelay(milliseconds,signal) {
        let remaining=milliseconds;
        while(remaining>0&&!signal?.aborted){
            const interval=Math.min(2**31-1,remaining),started=Date.now();
            await new Promise(resolve=>{const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();},timer=setTimeout(done,interval);signal?.addEventListener('abort',done,{once:true});if(signal?.aborted)done();});
            remaining-=Math.max(1,Date.now()-started);
        }
    }
    static normalizeStatus(status) {
        const value = String(status || '').toUpperCase();
        if (['SUCCESS', 'PASS', 'PASSED'].includes(value)) return 'SUCCESS';
        if (['FAILURE', 'FAIL', 'FAILED'].includes(value)) return 'FAILURE';
        if (value === 'CANCELLED') return value;
        return 'ERROR';
    }

    static normalizeNodeType(type) {
        const normalized = String(type || 'test-suite').replace(/_/g, '-');
        return ({test:'test-suite',suite:'test-suite',job:'test-suite','api-test':'api-performance','contract-test':'api-contract',deployment:'push-deploy'})[normalized] || normalized;
    }

    static nodeTypes() { return ['script','test-suite','security-scan','security-gate','git-repo','unit-test-runner','ai-unit-test','ai-log-summary','log-collector','start-runner','wait-delay','api-performance','api-contract','code-review','website-ux-auto-tester','push-deploy']; }

    // Old editors kept retry/stop references after deleting nodes or connections.
    // Remove only obsolete references; malformed live policies still need fixing.
    static normalizeRunnerReferences(workflow) {
        const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [], edges = Array.isArray(workflow.edges) ? workflow.edges : [];
        const ids = new Set(nodes.filter(Boolean).map(node => node.id)), warnings = [];
        for (const node of nodes) {
            if (!node || GraphEngine.normalizeNodeType(node.type || node.data?.type) !== 'start-runner' || !node.data || typeof node.data !== 'object') continue;
            const config = node.data, downstream = new Set(), queue = [node.id];
            if (config.runnerSettingsVersion == null && config.downloadLogs === true && typeof config.logPath === 'string' && /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(config.logPath)) {
                const relativePath = 'logs/' + String(node.id).replace(/[^a-zA-Z0-9_-]/g, '_');
                config.logDestinationMigration = {originalPath:config.logPath,relativePath};
                config.logPath = relativePath;
                config.runnerSettingsVersion = 1;
                warnings.push(`Runner ${node.id}: logs from this older graph will be saved inside this workspace at ${relativePath}. The previous destination is retained in its settings.`);
            }
            while (queue.length) {
                const current = queue.shift();
                for (const edge of edges.filter(edge => edge?.source === current)) {
                    if (edge.target !== node.id && !downstream.has(edge.target)) { downstream.add(edge.target); queue.push(edge.target); }
                }
            }
            if (config.stopNodeId && (!ids.has(config.stopNodeId) || !downstream.has(config.stopNodeId))) {
                config.stopNodeId = ''; warnings.push(`Runner ${node.id}: a removed stop boundary was cleared.`);
            }
            const disabled = new Set(Array.isArray(config.disabledRetryNodeIds) ? config.disabledRetryNodeIds.filter(id => ids.has(id)) : []);
            if (Array.isArray(config.disabledRetryNodeIds)) config.disabledRetryNodeIds = [...disabled];
            if (!Array.isArray(config.retryTargets)) continue;
            const seen = new Map();
            config.retryTargets = config.retryTargets.filter(target => {
                if (target && typeof target.nodeId === 'string' && (!ids.has(target.nodeId) || !downstream.has(target.nodeId) || disabled.has(target.nodeId))) {
                    warnings.push(`Runner ${node.id}: a removed or disabled retry target was cleared.`); return false;
                }
                if (!target || typeof target !== 'object') return true;
                if (target.attempts == null) target.attempts = 0;
                if (seen.has(target.nodeId) && JSON.stringify(seen.get(target.nodeId)) === JSON.stringify(target)) return false;
                seen.set(target.nodeId, target); return true;
            });
        }
        return warnings;
    }

    static executionPlan(workflow, options = {}) {
        const validation=GraphEngine.validate(workflow);
        if(!validation.valid) throw new Error(validation.errors.join(' '));
        const copy=validation.workflow, runners=copy.nodes.filter(n=>GraphEngine.normalizeNodeType(n.type)==='start-runner'), assignments={}, scopes=new Map();
        const outgoing=id=>copy.edges.filter(e=>e.source===id).map(e=>e.target);
        const scopeFor=runner=>{if(scopes.has(runner.id))return scopes.get(runner.id);const ids=new Set([runner.id]),distances=new Map([[runner.id,0]]),queue=[runner.id];while(queue.length){const id=queue.shift();if(id===runner.data.stopNodeId)continue;for(const next of outgoing(id))if(!ids.has(next)){ids.add(next);distances.set(next,distances.get(id)+1);queue.push(next);}}const result={ids,distances};scopes.set(runner.id,result);return result;};
        let allowed=null;
        if(options.selectedNodeId||options.selectedNodeIds?.length){const selected=options.selectedNodeIds||[options.selectedNodeId];if(!Array.isArray(selected)||selected.some(id=>!copy.nodes.some(n=>n.id===id)))throw Error('Selected node does not exist.');allowed=new Set(selected);const incoming=new Map();for(const edge of copy.edges){if(!incoming.has(edge.target))incoming.set(edge.target,[]);incoming.get(edge.target).push(edge.source);}const pending=[...selected];while(pending.length)for(const source of incoming.get(pending.pop())||[])if(!allowed.has(source)){allowed.add(source);pending.push(source);}}
        else if(runners.length){const selected=options.runnerId?runners.filter(r=>r.id===options.runnerId):runners;if(!selected.length)throw Error('Selected runner does not exist.');allowed=new Set();for(const runner of selected)for(const id of scopeFor(runner).ids)allowed.add(id);}
        else if(options.runnerId)throw Error('Selected runner does not exist.');
        for(const node of copy.nodes){let nearest=null,distance=Infinity;for(const runner of runners){const d=scopeFor(runner).distances.get(node.id);if(d!=null&&d<distance){nearest=runner;distance=d;}}if(nearest){assignments[node.id]=nearest.id;const target=nearest.data.retryTargets?.find(t=>t.nodeId===node.id);if(target&&!node.retry&&!node.data.retry&&node.executionPolicy?.retryAttempts==null)node.retry={maxAttempts:Number(target.attempts)+1,backoffMs:Number(target.backoffMs??0)};}}
        if(allowed){copy.nodes=copy.nodes.filter(n=>allowed.has(n.id));copy.edges=copy.edges.filter(e=>allowed.has(e.source)&&allowed.has(e.target));}
        return {workflow:copy,runnerAssignments:Object.fromEntries(Object.entries(assignments).filter(([id])=>copy.nodes.some(n=>n.id===id)))};
    }

    constructor() {
        this.executionLog = [];
    }

    /**
     * Executes a graph-based pipeline.
     * @param {Object} graphPipeline - { nodes: [], edges: [] }
     * @param {Function} nodeRunner - async function(node, context) to execute a single node.
     */
    async execute(graphPipeline, nodeRunner, options = {}) {
        this.executionLog = [];
        const { nodes, edges } = graphPipeline;
        const context = {
            artifacts: Object.create(null), // Shared data storage; names cannot mutate its prototype.
            results: Object.assign(Object.create(null), options.initialResults || {}), // Explicitly linked successful evidence only.
            startTime: Date.now()
        };

        options.log?.('Starting workflow execution.');

        // 1. Topological Sort
        const sortedNodes = this._getTopologicalSort(nodes, edges);
        options.log?.(`Execution order: ${sortedNodes.map(n => n.data?.name || n.id).join(', ')}`);

        // Stable admission order and exclusive resource leases make parallel runs
        // reproducible without allowing unrelated branches to share evidence.
        let overallStatus = 'SUCCESS';
        const concurrency = Number(options.concurrency ?? graphPipeline.concurrency ?? 1);
        if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isSafeInteger(concurrency)) throw new Error('Concurrency must be an integer greater than zero.');
        const pending = sortedNodes.filter(node => !context.results[node.id]), active = new Map(), locks = new Set();
        let halted = false;
        const notify = () => options.onState?.({ results: context.results, artifacts: context.artifacts });
        const run = async node => {
            options.log?.(`Running ${node.data?.name || node.id}`);

            try {
                // Resolve inputs from upstream artifacts if mapped
                const inputs = this._resolveInputs(node, edges, context);
                context.results[node.id] = { status:'RUNNING', startedAt:new Date().toISOString(), attempts:[] }; notify();

                // Execute Node
                const retry = node.retry || node.data?.retry || (node.executionPolicy?.retryAttempts!=null?{maxAttempts:Number(node.executionPolicy.retryAttempts)+1}:{});
                const maxAttempts = Number(retry.maxAttempts ?? 1), backoffMs = Number(retry.backoffMs ?? 0);
                if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || !Number.isSafeInteger(maxAttempts) || !Number.isFinite(backoffMs) || backoffMs < 0 || !Number.isSafeInteger(backoffMs)) throw new Error('Retry policy must use positive attempts and nonnegative millisecond backoff.');
                const attempts = [];
                let rawResult;
                for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                    if(options.signal?.aborted){rawResult={status:'CANCELLED',total:0,passed:0,failed:0,errors:0};break;}
                    const startedAt = new Date().toISOString();
                    try { rawResult = await nodeRunner(node, inputs, { ...context, signal: options.signal, attempt }); }
                    catch (error) { rawResult = { status: 'ERROR', errors:1, error: error.message }; }
                    rawResult = { ...rawResult, status: GraphEngine.normalizeStatus(rawResult?.status) };
                    attempts.push({ attempt, startedAt, finishedAt: new Date().toISOString(), ...rawResult });
                    context.results[node.id] = { ...rawResult, attempts: [...attempts] }; notify();
                    if (rawResult.status === 'SUCCESS' || rawResult.status === 'CANCELLED' || options.signal?.aborted) break;
                    if (attempt < maxAttempts && backoffMs) { const remaining=backoffMs*2**(attempt-1); if(!Number.isSafeInteger(remaining))throw Error('Retry delay exceeds the platform numeric range.'); await GraphEngine.waitDelay(remaining,options.signal); }
                }
                const result = { ...rawResult, status: GraphEngine.normalizeStatus(rawResult?.status) };
                for (const [key, port] of Object.entries(result.status==='CANCELLED'?{}:node.outputs || node.data?.outputs || {})) {
                    if (port.required && !Object.prototype.hasOwnProperty.call(result.artifacts || {}, key)) throw new Error(`Required output "${key}" was not produced.`);
                    if (key in (result.artifacts || {}) && port.type && !GraphEngine.matchesType(result.artifacts[key], port.type)) throw new Error(`Output "${key}" must be ${port.type}.`);
                }

                // Store result
                context.results[node.id] = { ...result, attempts };

                // Store outputs as artifacts
                if (result.artifacts) {
                    Object.assign(context.artifacts, result.artifacts);
                }

                if (result.status !== 'SUCCESS') {
                    if (overallStatus !== 'ERROR' && overallStatus !== 'CANCELLED') overallStatus = result.status;
                    if ((node.onFailure || node.data?.onFailure || 'stop') === 'stop') halted = true;
                }

            } catch (error) {
                options.log?.(`Step ${node.data?.name || node.id}: ${error.message}`);
                const attempts=context.results[node.id]?.attempts || [];
                if(attempts.length)attempts[attempts.length-1]={...attempts[attempts.length-1],status:'ERROR',error:error.message};
                context.results[node.id] = { status: 'ERROR', errors:1, error: error.message, attempts };
                overallStatus = 'ERROR';
                halted = true;
            }
            notify();
        };
        while (pending.length || active.size) {
            if (options.signal?.aborted) { halted = true; overallStatus = 'CANCELLED'; }
            let admitted = false;
            if (!halted) for (let i = 0; i < pending.length && active.size < concurrency;) {
                const node = pending[i], resources = node.resources || node.data?.resources || [];
                if (!Array.isArray(resources) || resources.some(r => typeof r !== 'string')) throw new Error('Resource locks must be named strings.');
                if (edges.some(e => e.target === node.id && (!context.results[e.source] || active.has(e.source))) || resources.some(r => locks.has(r))) { i++; continue; }
                pending.splice(i, 1); resources.forEach(r => locks.add(r)); admitted = true;
                const task = run(node).finally(() => { resources.forEach(r => locks.delete(r)); active.delete(node.id); });
                active.set(node.id, task);
            }
            if (active.size) await Promise.race(active.values());
            else if (pending.length) {
                for (const node of pending.splice(0)) context.results[node.id] = { status: options.signal?.aborted ? 'CANCELLED' : 'PENDING', reason: halted ? 'Stopped after upstream failure.' : 'Dependencies could not be resolved.', attempts: [] };
                if (!halted && !admitted) overallStatus = 'ERROR';
            }
        }

        const outputEntries=sortedNodes.flatMap(node=>Object.entries(context.results[node.id]?.artifacts||{}).map(([name,value])=>({producer:node.id,runId:context.results[node.id].runId||null,name,value})));
        const outputCounts=outputEntries.reduce((counts,item)=>{counts[item.name]=(counts[item.name]||0)+1;return counts;},Object.create(null));
        const artifacts=Object.fromEntries(outputEntries.map(item=>[outputCounts[item.name]>1?`${item.producer}.${item.name}`:item.name,item.value]));
        if (options.signal?.aborted) overallStatus = 'CANCELLED';
        return {
            status: overallStatus,
            duration: Date.now() - context.startTime,
            results: Object.fromEntries(sortedNodes.map(node => [node.id, context.results[node.id]])),
            artifacts,
            artifactProvenance:Object.fromEntries(outputEntries.map(item=>[`${item.producer}.${item.name}`,{producer:item.producer,runId:item.runId,type:Array.isArray(item.value)?'array':typeof item.value}]))
        };
    }

    _getTopologicalSort(nodes, edges) {
        const inDegree = new Map(), nodeById=new Map(nodes.map(node=>[node.id,node]));
        const adj = new Map();

        nodes.forEach(node => {
            if (!node.id || inDegree.has(node.id)) throw new Error('Graph node IDs must be unique and nonempty.');
            inDegree.set(node.id, 0);
            adj.set(node.id, []);
        });

        edges.forEach(edge => {
            if (!inDegree.has(edge.source) || !inDegree.has(edge.target)) throw new Error('Graph edge references a missing node.');
            const currentIn = inDegree.get(edge.target) || 0;
            inDegree.set(edge.target, currentIn + 1);

            const currentAdj = adj.get(edge.source) || [];
            currentAdj.push(edge.target);
            adj.set(edge.source, currentAdj);
        });

        const queue = [];
        inDegree.forEach((count, id) => {
            if (count === 0) queue.push(id);
        });

        const sorted = [];
        for(let cursor=0;cursor<queue.length;cursor++) {
            const u = queue[cursor];
            const nodeNode = nodeById.get(u);
            if (nodeNode) sorted.push(nodeNode);

            const neighbors = adj.get(u) || [];
            neighbors.forEach(v => {
                const newCount = (inDegree.get(v) || 0) - 1;
                inDegree.set(v, newCount);
                if (newCount === 0) queue.push(v);
            });
        }

        if (sorted.length !== nodes.length) {
            throw new Error("Cycle detected in pipeline! Graph must be Acyclic (DAG).");
        }

        return sorted;
    }

    _resolveInputs(node, edges, context) {
        // Only connected ancestors supply inputs; unrelated branches cannot satisfy a gate.
        const ancestors = new Set(), incoming=new Map(), pending=[node.id];
        for(const edge of edges){if(!incoming.has(edge.target))incoming.set(edge.target,[]);incoming.get(edge.target).push(edge.source);}
        while(pending.length)for(const source of incoming.get(pending.pop())||[])if(!ancestors.has(source)){ancestors.add(source);pending.push(source);}
        const inputs = {};
        const producers = {};
        const portEdges = edges.filter(edge => edge.target === node.id && (edge.output || edge.input));
        for (const edge of portEdges) {
            if (!edge.output || !edge.input) throw new Error('Artifact connections need both output and input names.');
            if(['__proto__','constructor','prototype','$provenance'].includes(edge.input))throw new Error('Artifact connection uses a reserved input name.');
            const source = context.results[edge.source];
            if (!Object.prototype.hasOwnProperty.call(source?.artifacts || {}, edge.output)) throw new Error(`Missing artifact ${edge.source}.${edge.output}.`);
            const value = source.artifacts[edge.output];
            if (Object.prototype.hasOwnProperty.call(inputs, edge.input)) throw new Error(`Input "${edge.input}" has multiple mapped producers.`);
            if (edge.type && !GraphEngine.matchesType(value, edge.type)) throw new Error(`Input "${edge.input}" must be ${edge.type}.`);
            inputs[edge.input] = value; producers[edge.input] = edge.source;
        }
        const securityScans = [];
        for (const [id, result] of Object.entries(context.results)) {
            if (!ancestors.has(id)) continue;
            for (const [key, value] of Object.entries(result.artifacts || {})) {
                if(['__proto__','constructor','prototype','$provenance'].includes(key))throw new Error('Artifact uses a reserved input name.');
                if (portEdges.some(edge => edge.source === id && edge.output === key)) continue;
                const mapping = node.inputs?.[key] || node.data?.inputs?.[key];
                if (mapping && mapping.producer !== id) continue;
                if (Object.prototype.hasOwnProperty.call(inputs, key) && !mapping && key !== 'securityResults') throw new Error(`Ambiguous artifact "${key}" from ${producers[key]} and ${id}; choose a producer.`);
                if (mapping?.type && !GraphEngine.matchesType(value, mapping.type)) throw new Error(`Artifact "${key}" must be ${mapping.type}.`);
                inputs[key] = value; producers[key] = id;
            }
            if (result.artifacts?.securityResults) securityScans.push(result.artifacts.securityResults);
        }
        if (securityScans.length) inputs.securityScans = securityScans;
        Object.defineProperty(inputs, '$provenance', { value: Object.fromEntries(Object.entries(producers).map(([key, producer]) => [key, { producer, runId: context.results[producer].runId || null }])), enumerable: true });
        return inputs;
    }

    static matchesType(value, type) { return type === 'any' || (type === 'array' ? Array.isArray(value) : type === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value) : typeof value === type); }

    static validate(workflow, { strict = false } = {}) {
        if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) return {valid:false,errors:['Choose a workflow containing nodes and connections.'],warnings:[],workflow:{schemaVersion:1,nodes:[],edges:[]}};
        let migrated;
        try { migrated = structuredClone(workflow); }
        catch { return {valid:false,errors:['Workflow must contain serializable data.'],warnings:[],workflow:{schemaVersion:1,nodes:[],edges:[]}}; }
        const errors = [];
        const warnings = GraphEngine.normalizeRunnerReferences(migrated);
        if (migrated.schemaVersion != null && migrated.schemaVersion !== 1) errors.push('Unsupported workflow schema version.');
        migrated.schemaVersion = 1;
        if (!Array.isArray(migrated.nodes) || !migrated.nodes.length) errors.push('Add at least one workflow step.');
        if (!Array.isArray(migrated.edges)) errors.push('Workflow connections must be an array.');
        const concurrency=Number(migrated.concurrency??1);
        if(!Number.isInteger(concurrency)||concurrency<1||!Number.isSafeInteger(concurrency))errors.push('Concurrency must be an integer greater than zero.');
        for (const node of Array.isArray(migrated.nodes) ? migrated.nodes : []) {
            if(!node || typeof node!=='object') {errors.push('Each step must contain a valid configuration.');continue;}
            if(typeof node.id!=='string'||!node.id.trim())errors.push('Step IDs must be nonempty strings.');
            node.type = GraphEngine.normalizeNodeType(node.type || node.data?.type);
            if (!node.data || typeof node.data !== 'object' || Array.isArray(node.data)) errors.push(`Step ${node.id || '(unnamed)'} needs configuration.`);
            if (!GraphEngine.nodeTypes().includes(node.type)) errors.push(`Step ${node.id} has unsupported type ${node.type}.`);
            if (strict && node.type==='script' && (!node.data?.engine || (!node.data.code && !node.data.projectPath))) errors.push(`Step ${node.id} needs an engine and code or project.`);
            if(strict&&node.data?.engine&&!['javascript','playwright','python','robot','java','csharp','jest','junit','nunit','pytest'].includes(node.data.engine))errors.push(`Step ${node.id} needs a supported execution engine.`);
            if(strict&&node.type==='script'&&['jest','junit','nunit','pytest'].includes(node.data?.engine)&&!node.data.projectPath)errors.push(`Step ${node.id} needs its native project directory.`);
            if(node.type==='start-runner'){
                if(node.data?.stopNodeId&&!migrated.nodes.some(n=>n.id===node.data.stopNodeId&&n.id!==node.id))errors.push(`Runner ${node.id} has an invalid stop boundary.`);
                const targets=node.data?.retryTargets;
                if(targets!=null&&(!Array.isArray(targets)||targets.some(t=>!t||typeof t.nodeId!=='string'||!migrated.nodes.some(n=>n?.id===t.nodeId&&n.id!==node.id)||typeof t.attempts==='boolean'||String(t.attempts).trim()===''||!Number.isInteger(Number(t.attempts))||Number(t.attempts)<0||!Number.isSafeInteger(Number(t.attempts))||!Number.isSafeInteger(Number(t.attempts)+1)||!Number.isFinite(Number(t.backoffMs??0))||Number(t.backoffMs??0)<0||!Number.isSafeInteger(Number(t.backoffMs??0)))||new Set(targets.map(t=>t?.nodeId)).size!==targets.length))errors.push(`Runner ${node.id}: choose each connected retry target once and use a whole number of nonnegative retries (0 means run once).`);
            }
            if(!['stop','continue'].includes(node.onFailure||node.data?.onFailure||'stop'))errors.push(`Step ${node.id} must stop or continue after failure.`);
            const retry=node.retry||node.data?.retry||(node.executionPolicy?.retryAttempts!=null?{maxAttempts:Number(node.executionPolicy.retryAttempts)+1}:{}),attempts=Number(retry.maxAttempts??1),backoff=Number(retry.backoffMs??0);
            if(!Number.isInteger(attempts)||attempts<1||!Number.isSafeInteger(attempts)||!Number.isFinite(backoff)||backoff<0||!Number.isSafeInteger(backoff))errors.push(`Step ${node.id} needs positive attempts and nonnegative retry backoff.`);
            const resources=node.resources||node.data?.resources||[];
            if(!Array.isArray(resources)||resources.some(value=>typeof value!=='string'||!value.trim()))errors.push(`Step ${node.id} needs nonempty resource lock names.`);
        }
        if (Array.isArray(migrated.nodes) && Array.isArray(migrated.edges)) try { new GraphEngine()._getTopologicalSort(migrated.nodes, migrated.edges); } catch (error) { errors.push(error.message); }
        return { valid: errors.length === 0, errors, warnings, workflow: migrated };
    }
}

// Export
if (typeof window !== 'undefined') window.GraphEngine = GraphEngine;
if (typeof module !== 'undefined') module.exports = GraphEngine;
