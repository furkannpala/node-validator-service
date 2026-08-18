const { ULog } = require("../../../lib/utils");
const configWatch = require("./configWatch");
const cacheCleanup = require("./cacheCleanup");
const errorTdWatch = require("./errorTdWatch");
const poolPressure = require("./poolPressure");
const sqliteRefresh = require("./sqliteRefresh");
const requestLogRetention = require("./requestLogRetention");
const kpgHealth = require("./kpgHealth");

/**
 * Registration ORDER matters: the console list and the stagger step both follow this array, so
 * new jobs go at the end. The last three are OFF by default and their register() returns null
 * without the config key that turns them on — retention deletes data, sqliteRefresh is
 * expensive, and kpgHealth calls an external system.
 */
const JOBS = [
    configWatch,
    cacheCleanup,
    errorTdWatch,
    poolPressure,
    sqliteRefresh,
    requestLogRetention,
    kpgHealth,
];

/**
 * Extra delay added to each job's FIRST run, stepped by position in JOBS. configWatch and
 * errorTdWatch share a period and both take a connection, so without this they would ask for
 * one at the same instant on pools that run with queueMax=1.
 *
 * It only removes the deterministic startup collision: the framework arms the next run after
 * the current one finishes, so phases can drift back together over time.
 */
const STAGGER_STEP_MS = 15 * 1000;

async function bindJobs(manager) {
    const handles = [];
    for (let i = 0; i < JOBS.length; i++) {
        const job = JOBS[i];
        try {
            const handle = await job.register(manager, i * STAGGER_STEP_MS);
            if (handle) handles.push(handle);
        } catch (e) {
            ULog.error(`job register failed (${job.name}): ${e?.stack}`);
        }
    }
    return handles;
}

function stopJobs(handles) {
    for (const handle of handles || []) {
        if (typeof handle?.stop !== "function") continue;
        try {
            handle.stop();
        } catch (e) {
            ULog.error(`job stop failed: ${e?.stack}`);
        }
    }
}

module.exports = {
    JOBS, bindJobs, stopJobs, STAGGER_STEP_MS,
    configWatch, cacheCleanup, errorTdWatch, poolPressure,
    sqliteRefresh, requestLogRetention, kpgHealth,
};
