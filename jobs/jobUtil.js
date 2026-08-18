const { ULog } = require("../../../lib/utils");

/**
 * Helpers every job shares. Job configuration is always read from the 'app' row: the per-system
 * keys answer requests, but a job runs once for the whole service and has no system of its own.
 */

/** Every configured system, which is every kkconfig row except the shared 'app' one. */
function systemIds(manager) {
    const cfgs = manager.appConfig?.cfgs || {};
    return Object.keys(cfgs).filter((id) => id !== "app");
}

/** Pool alias = datasource_prefix + systemId, the same rule the framework uses per request. */
function poolAliasFor(manager, systemId) {
    const prefix = manager.appConfig.getSystemConfig("datasource_prefix", systemId, "") || "";
    return prefix + systemId;
}

async function withSystemConnection(manager, systemId, fn) {
    const getConnection = manager.deps?.getConnection;
    if (typeof getConnection !== "function") throw new Error("deps.getConnection is missing");
    const conn = await getConnection(poolAliasFor(manager, systemId));
    try {
        return await fn(conn);
    } finally {
        try {
            await conn.close();
        } catch (e) {
            ULog.debug(`job conn close failed (${systemId}): ${e?.message}`);
        }
    }
}

/**
 * Each system runs in its own try: one pool being down must not cost us the information about
 * the others. Failures are collected and handed back so the caller can report them together.
 */
async function forEachSystem(manager, fn) {
    const results = [];
    const errors = [];
    for (const systemId of systemIds(manager)) {
        try {
            results.push({ systemId, value: await fn(systemId) });
        } catch (e) {
            errors.push(`${systemId}: ${e?.message}`);
        }
    }
    return { results, errors };
}

/**
 * A period that must be positive. Zero and negative values fall back to the default, because
 * a non-positive delay fires setTimeout immediately and spins the job in a loop.
 */
function num(manager, key, defaultValue) {
    const n = Number(manager._appConfigValue(key, defaultValue));
    return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

/** A count that may legitimately be zero, which is how the off switches are spelled. */
function days(manager, key, defaultValue = 0) {
    const n = Number(manager._appConfigValue(key, defaultValue));
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/** kkconfig values come from a JSON CLOB, so a flag may also arrive as the string 'true'. */
function bool(manager, key, defaultValue = false) {
    const v = manager._appConfigValue(key, defaultValue);
    return v === true || String(v).toLowerCase() === "true";
}

function str(manager, key, defaultValue = "") {
    const v = manager._appConfigValue(key, defaultValue);
    return v == null ? "" : String(v).trim();
}

/** A comma list in the config, which is how the roadmap spells every multi-value key. */
function list(manager, key) {
    const v = manager._appConfigValue(key, "");
    const parts = Array.isArray(v) ? v : String(v ?? "").split(",");
    return parts.map((p) => String(p).trim()).filter((p) => p !== "");
}

module.exports = { systemIds, poolAliasFor, withSystemConnection, forEachSystem, num, days, bool, str, list };
