const { ULog } = require("../../../lib/utils");
const requestLogDao = require("../validator/dao/oracle/ValidatorRequestLogDaoImpl");
const errorTdDao = require("../validator/dao/oracle/TblValidatorErrorTdDaoImpl");
const { num, days, withSystemConnection, forEachSystem } = require("./jobUtil");

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_BATCH_ROWS = 5000;

/** 0 = OFF, and off is the deliberate default: this job deletes data. */
function requestLogDays(manager) {
    return days(manager, "request_log_retention_days", 0);
}

/**
 * Error records are investigation material and are usually kept longer than the request copy,
 * so they get their own period; unset, they follow the request log.
 */
function errorTdDays(manager) {
    return days(manager, "error_td_retention_days", requestLogDays(manager));
}

function intervalMs(manager) {
    return num(manager, "retention_interval_ms", DEFAULT_INTERVAL_MS);
}

async function run(manager, daos = { requestLog: requestLogDao, errorTd: errorTdDao }) {
    const logDays = requestLogDays(manager);
    const errorDays = errorTdDays(manager);
    if (!logDays && !errorDays) return;
    const batchRows = num(manager, "retention_batch_rows", DEFAULT_BATCH_ROWS);

    const { results, errors } = await forEachSystem(manager, (systemId) =>
        withSystemConnection(manager, systemId, async (conn) => ({
            requestLog: logDays
                ? await daos.requestLog.purge(conn, logDays, batchRows, "requestLogRetention") : null,
            errorTd: errorDays
                ? await daos.errorTd.purge(conn, errorDays, batchRows, "requestLogRetention") : null,
        })));

    for (const { systemId, value } of results) {
        report(systemId, "VALIDATOR_REQUEST_LOG", value.requestLog, logDays);
        report(systemId, "TBL_VALIDATOR_ERROR_TD", value.errorTd, errorDays);
    }
    if (errors.length) {
        ULog.error(`requestLogRetention: ${errors.join(" | ")}`);
        throw new Error(errors.join(" | "));
    }
}

function report(systemId, table, result, retentionDays) {
    if (!result || result.deleted <= 0) return;
    ULog.info(`requestLogRetention: ${systemId} ${table} ${result.deleted} row(s) deleted `
        + `(>${retentionDays} days)`
        + `${result.more ? " — hit the round limit, the rest follows next run" : ""}`);
}

/** With no period configured the job is never registered, so the console shows no idle row. */
function register(manager, staggerMs = 0) {
    const assign = manager.deps?.assignFixRateScheduler;
    if (typeof assign !== "function") return null;
    const logDays = requestLogDays(manager);
    const errorDays = errorTdDays(manager);
    if (!logDays && !errorDays) return null;
    const ms = intervalMs(manager);
    ULog.info(`job 'requestLogRetention' registered; interval=${ms}ms,`
        + ` first run in ${ms + staggerMs}ms, request log=${logDays || "off"} days,`
        + ` error td=${errorDays || "off"} days`);
    return assign(() => run(manager), ms, ms + staggerMs);
}

module.exports = {
    name: "requestLogRetention", register, run, requestLogDays, errorTdDays, intervalMs,
    DEFAULT_INTERVAL_MS, DEFAULT_BATCH_ROWS,
};
