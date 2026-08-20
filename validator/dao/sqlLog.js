const { ULog } = require("../../../../lib/utils");

const ENABLED = process.env.VS_SQL_DEBUG !== "0";

const REDACT_KEYS = new Set([
    "ptcn", "enc_pan", "emv", "track2", "cvv", "pin", "pin_block",
]);

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
