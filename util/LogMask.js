/**
 * B-17 — card-data masking on the log path. Every DAO logs its binds, and ULog.sendLog only
 * scrubs `password`, so card numbers were accumulating in the central ELK over UDP.
 *
 * This module runs on the LOG path only: the bind object sent to the database is never
 * modified, masking always works on a copy.
 */

/** Fully hidden: these are useless to us in a log line anyway. */
const REDACT_KEYS = new Set([
    'ptcn', 'enc_pan', 'emv', 'track2', 'cvv', 'pin', 'pin_block',
]);

/** PAN-like fields: first 6 + last 4 are kept, the form PCI-DSS permits. */
const PAN_KEYS = new Set([
    'card_no', 'alias_no', 'masked_pan', 'pan', 'old_card_no', 'origin_card_no',
]);

/** Raw Kafka message: card fields embedded inside it are scrubbed too. */
const RAW_KEYS = new Set(['record_value', 'recordvalue']);

const MAX_RAW_CHARS = 512;

/** First 6 + last 4; short values are hidden entirely so nothing leaks. */
function maskPan(value) {
    const s = String(value);
    if (s.length <= 10) return '***';
    return s.slice(0, 6) + '*'.repeat(s.length - 10) + s.slice(-4);
}

// The key sets are constants, so the pattern is too: it used to be recompiled on every call,
// on the log path of every DAO statement.
const SENSITIVE_JSON_KEY = new RegExp(
    `("(?:${[...PAN_KEYS, ...REDACT_KEYS].join('|')})"\\s*:\\s*")([^"]*)(")`, 'gi');

/**
 * Masks sensitive fields inside raw JSON text without parsing it: record_value may well be
 * malformed (that is why poison-pill records get logged), and parsing would throw here.
 */
function maskRawJson(text) {
    let s = String(text);
    // lastIndex is shared state on a /g regex; replace() resets it, but only if it is not
    // left mid-scan by an earlier throw, so it is cleared here rather than assumed.
    SENSITIVE_JSON_KEY.lastIndex = 0;
    s = s.replace(SENSITIVE_JSON_KEY, (_all, head, value, tail) => {
        const key = head.slice(1, head.indexOf('"', 1));
        return head + maskScalar(key.toLowerCase(), value) + tail;
    });
    return s.length > MAX_RAW_CHARS ? s.slice(0, MAX_RAW_CHARS) + `…(+${s.length - MAX_RAW_CHARS})` : s;
}

function maskScalar(key, value) {
    if (value === null || value === undefined) return value;
    if (REDACT_KEYS.has(key)) return '***';
    if (PAN_KEYS.has(key)) return maskPan(value);
    if (RAW_KEYS.has(key)) return maskRawJson(value);
    return value;
}

/**
 * Deep copy plus masking. Arrays (executeMany row lists) and nested objects are supported;
 * no cycles are expected since bind objects are flat data.
 */
function maskBinds(value) {
    if (Array.isArray(value)) return value.map(maskBinds);
    if (value === null || typeof value !== 'object') return value;

    const out = {};
    for (const [k, v] of Object.entries(value)) {
        const key = String(k).toLowerCase();
        if (v !== null && typeof v === 'object') out[k] = maskBinds(v);
        else out[k] = maskScalar(key, v);
    }
    return out;
}

/** Used instead of JSON.stringify in DAO log lines. */
function maskJson(value) {
    return JSON.stringify(maskBinds(value));
}

module.exports = { maskJson, maskBinds, maskPan, maskRawJson, REDACT_KEYS, PAN_KEYS };
