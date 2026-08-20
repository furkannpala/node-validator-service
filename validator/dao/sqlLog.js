const { ULog } = require("../../../../lib/utils");

/**
 * The statement trace every DAO runs before an execute, and the masking that decides what may
 * appear in it. The two belong together: the trace is the only thing that reads a bind object
 * on the log path, and the masking exists only because of the trace.
 *
 * It is not cheap. ULog has no level of its own, so every call formats the line, writes it to
 * stdout synchronously and sends a UDP packet to ELK — and the masked bind text is built before
 * it. Measured on senddata with eight concurrent requests: 105 requests/s with the trace, 161
 * without it, so it costs about a third of the throughput on the write path.
 *
 * On by default, because losing the trace silently would be worse than the cost. VS_SQL_DEBUG=0
 * turns it off, and then the masking is not computed either — that is the point of the guard
 * living here rather than inside ULog.
 */
const ENABLED = process.env.VS_SQL_DEBUG !== "0";

/**
 * B-17. Every DAO logs its binds and ULog.sendLog only scrubs `password`, so card numbers were
 * accumulating in the central ELK over UDP.
 *
 * This runs on the LOG path only: the bind object handed to the database is never modified,
 * masking always works on a copy.
 */

/** Fully hidden: these are useless to us in a log line anyway. */
const REDACT_KEYS = new Set([
    "ptcn", "enc_pan", "emv", "track2", "cvv", "pin", "pin_block",
]);

/**
 * PAN-like fields: first 6 + last 4 are kept, the form PCI-DSS permits.
 *
 * Several of these are not bound by any statement today. They stay anyway: an unused key costs
 * a Set lookup, a missing one puts a card number on the wire.
 */
const PAN_KEYS = new Set([
    "card_no", "alias_no", "masked_pan", "pan", "old_card_no", "origin_card_no",
]);

/** First 6 + last 4; short values are hidden entirely so nothing leaks. */
function maskPan(value) {
    const s = String(value);
    if (s.length <= 10) return "***";
    return s.slice(0, 6) + "*".repeat(s.length - 10) + s.slice(-4);
}

function maskScalar(key, value) {
    if (value === null || value === undefined) return value;
    if (REDACT_KEYS.has(key)) return "***";
    if (PAN_KEYS.has(key)) return maskPan(value);
    return value;
}

/**
 * Deep copy plus masking. Arrays (executeMany row lists) and nested objects are supported; no
 * cycles are expected since bind objects are flat data.
 */
function maskBinds(value) {
    if (Array.isArray(value)) return value.map(maskBinds);
    if (value === null || typeof value !== "object") return value;

    const out = {};
    for (const [k, v] of Object.entries(value)) {
        const key = String(k).toLowerCase();
        if (v !== null && typeof v === "object") out[k] = maskBinds(v);
        else out[k] = maskScalar(key, v);
    }
    return out;
}

/** Used instead of JSON.stringify in DAO log lines. */
function maskJson(value) {
    return JSON.stringify(maskBinds(value));
}

function debugSql(sql, binds, sessionId) {
    if (!ENABLED) return;
    ULog.debug(binds === undefined ? sql : sql + " " + maskJson(binds), sessionId);
}

// maskJson and the key sets are exported for the tests: the masking decision is the part worth
// asserting on, and driving it through debugSql would only ever check what reached ULog.
module.exports = { debugSql, maskJson, REDACT_KEYS, PAN_KEYS, SQL_DEBUG_ENABLED: ENABLED };
