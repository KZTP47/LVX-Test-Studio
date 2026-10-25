'use strict';
function pausedContext(client, source) {
    const metadata = frame => {
        const sameScript = frame.location?.scriptId === client.script?.scriptId || String(frame.url || '').includes(`lvx-authored-${client.runId}.js`);
        const line = sameScript && source ? frame.location.lineNumber - source.lineOffset + 1 : null;
        const authored = sameScript && Number.isInteger(line) && line >= 1 && line <= source?.lines;
        return { authored, functionName: frame.functionName || '(anonymous)', url: frame.url || (sameScript ? client.script?.url : '') || '', line: authored ? line : null, column: frame.location?.columnNumber ?? null, phase: authored ? 'authored' : sameScript ? 'setup-cleanup-or-wrapper' : 'runtime' };
    };
    const frames = (client.paused?.callFrames || []).map(metadata);
    const selected = frames.findIndex(frame => frame.authored);
    const pausedInRuntime = selected < 0;
    const stepOverAvailable = !pausedInRuntime && frames[0]?.authored === true;
    return {
        pausedInRuntime, stepOverAvailable, frame: selected < 0 ? frames[0] || null : frames[selected], frames,
        message: pausedInRuntime ? 'Execution is paused while waiting in runtime. Resume or set an authored breakpoint.' : !stepOverAvailable ? 'An authored caller is visible, but the current frame is runtime code. Resume to an authored breakpoint before stepping.' : null,
        selectedFrame: selected < 0 ? null : client.paused.callFrames[selected]
    };
}
module.exports = { pausedContext };
