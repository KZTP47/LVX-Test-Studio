'use strict';
function createRedactor() {
    const variants = new Set();
    function add(secret) {
        if (typeof secret !== 'string' || !secret) return;
        const xml = secret.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        for (const value of [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret), xml, xml.replaceAll('"', '&quot;').replaceAll("'", '&apos;'), secret.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\t', '\\t').replaceAll("'", "\\'")]) if (value) variants.add(value);
    }
    function redact(value) {
        if (typeof value === 'string') { for (const secret of [...variants].sort((a, b) => b.length - a.length)) value = value.split(secret).join('[REDACTED]'); return value; }
        if (Array.isArray(value)) return value.map(redact);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [redact(key), redact(child)]));
        return value;
    }
    return { add, redact, variants };
}
module.exports = { createRedactor };
