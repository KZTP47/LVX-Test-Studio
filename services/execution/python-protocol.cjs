'use strict';
const { StringDecoder } = require('node:string_decoder');
// stdout is reserved for typed output/result frames. Normal Python print and
// sys.stdout/sys.stderr become these frames; configuration/result never use disk.
function createProtocol({ onOutput, onResult, onError }) {
    const decoder = new StringDecoder('utf8');
    let pending = '', ended = false, received = false, failed = false;
    function fail(message) { if (!failed) { failed = true; onError(new Error(message)); } }
    function parse(line) {
        if (!line.trim() || failed) return;
        try {
            const message = JSON.parse(line);
            if (message.type === 'stdout' || message.type === 'stderr') { if (typeof message.text !== 'string') throw new Error(); onOutput(message.type, message.text); }
            else if (message.type === 'result' && message.result && typeof message.result === 'object' && !received) { received = true; onResult(message.result); }
            else throw new Error();
        } catch { fail('Native Python returned an invalid execution protocol message.'); }
    }
    function consume(text) {
        pending += text;
        if (pending.length > 32 * 1024 * 1024) { pending = ''; fail('Native Python result exceeded the 32 MiB in-memory protocol limit.'); return; }
        let index;
        while ((index = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, index); pending = pending.slice(index + 1); parse(line); }
    }
    return {
        push(chunk) { if (!ended) consume(decoder.write(chunk)); },
        end() { if (ended) return; ended = true; consume(decoder.end()); if (pending.trim()) parse(pending); pending = ''; if (!received && !failed) fail('Native Python stopped without a terminal result.'); }
    };
}
module.exports = { createProtocol };
