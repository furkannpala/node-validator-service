const { ULog } = require("../../../lib/utils");
const errorTdDao = require("../validator/dao/oracle/TblValidatorErrorTdDaoImpl");
const { num, withSystemConnection, forEachSystem } = require("./jobUtil");

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

function intervalMs(manager) {
    return num(manager, "error_td_watch_interval_ms", DEFAULT_INTERVAL_MS);
}

/**
 * TBL_VALIDATOR_ERROR_TD is where senddata files a record it could not store. Nothing reads it
 * on its own, so a device sending malformed data can go unnoticed for days: this reports what
 * landed there since the last run.
 *
 * The window is remembered on the job itself rather than in the database, so a restart looks
 * one interval back and may report the same rows twice. Double reporting is the safe side.
 */
async function run(manager, dao = errorTdDao) {
    const window = intervalMs(manager);
    const since = run.lastRunAt || new Date(Date.now() - window);
    const now = new Date();

    const { results, errors } = await forEachSystem(manager, (systemId) =>
        withSystemConnection(manager, systemId, (conn) => dao.countSince(conn, since, "errorTdWatch")));

    for (const { systemId, value } of results) {
        const total = value.reduce((sum, row) => sum + Number(row.CNT || 0), 0);
        if (total === 0) continue;
        const breakdown = value.map((row) => `${row.ERROR_CODE || "?"}=${row.CNT}`).join(", ");
        ULog.error(`errorTdWatch: ${systemId} ${total} error record(s) since `
            + `${since.toISOString()} (${breakdown})`);
    }

    // Only a clean round moves the window. A system whose pool was down did not get read, and
    // advancing past it would drop its error rows for that window instead of reporting them
    // late: double reporting is the safe side here, silence is not.
    if (errors.length) {
        ULog.error(`errorTdWatch: ${errors.join(" | ")}`);
        throw new Error(errors.join(" | "));
    }
    run.lastRunAt = now;
    return results;
}

run.lastRunAt = null;

function register(manager, staggerMs = 0) {
    const assign = manager.deps?.assignFixRateScheduler;
    if (typeof assign !== "function") return null;
    if (typeof manager.deps?.getConnection !== "function") return null;
    const ms = intervalMs(manager);
    ULog.info(`job 'errorTdWatch' registered; interval=${ms}ms, first run in ${ms + staggerMs}ms`);
    return assign(() => run(manager), ms, ms + staggerMs);
}

module.exports = { name: "errorTdWatch", register, run, intervalMs, DEFAULT_INTERVAL_MS };
