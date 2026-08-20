const { ULog } = require("../../../lib/utils");
const FileCacheManager = require("../util/FileCacheManager");
const SqliteBuilder = require("../util/SqliteBuilder");
const requestLogDao = require("../validator/dao/oracle/ValidatorRequestLogDaoImpl");
const errorTdDao = require("../validator/dao/oracle/TblValidatorErrorTdDaoImpl");
const jobManager = require("./JobManager");

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_BATCH_ROWS = 5000;

/**
 * Every scheduled job of the service, as data. A job is:
 *
 *   name        the key ?func=getjobs reports it under
 *   scope       "service" runs it once a cycle; "system" (the default) once per kkconfig row
 *   flag        the config key that switches it on. defaultOn:true keeps a job on until the
 *               key says otherwise, which is how the two housekeeping jobs stay on with no
 *               config row at all. Read per cycle: turning a flag on needs no restart
 *   requires    keys that must carry a value; missing ones fail the job's turn with a log
 *               rather than letting it run half configured
 *   intervalKey the 'app' key holding its period, intervalMs the default when it is unset
 *   mode        "async" hands the job to a bounded pool so it does not hold up the group
 *   func(ctx)   the work. ctx carries the config lookups and, for a system job, the connection
 *
 * Jobs sharing a period share a scheduler and run in this order within it.
 */
const JOBS = [
    {
        name: "config_watch",
        scope: "service",
        flag: "run_config_watch",
        defaultOn: true,
        intervalKey: "config_refresh_ms",
        intervalMs: 5 * MINUTE_MS,
        /**
         * Keeps the in-memory copy of VALIDATOR_SERVICE_CONFIG current. Without it the only way
         * to pick up a config change is ?func=getconfig by hand, or a restart.
         */
        func: (ctx) => ctx.manager.reloadConfig(),
    },
    {
        name: "cache_cleanup",
        scope: "service",
        flag: "run_cache_cleanup",
        defaultOn: true,
        intervalKey: "cache_cleanup_interval_ms",
        intervalMs: HOUR_MS,
        /**
         * The scheduled half of ?func=cleancachefiles. Java only cleared the cache on a day
         * rollover or by hand, so a file for a version nobody asks for any more stayed on disk
         * indefinitely.
         */
        func: async (ctx) => {
            const removed = await FileCacheManager.removeExpired(ctx.num("cache_max_age_ms", DAY_MS));
            if (removed > 0) {
                ULog.info(`cache_cleanup: ${removed} expired cache file(s) removed`, ctx.sessionId);
            }
            return removed;
        },
    },
    {
        name: "sqlite_refresh",
        scope: "system",
        flag: "run_sqlite_refresh",
        mode: "async",
        intervalKey: "sqlite_refresh_interval_ms",
        intervalMs: 30 * MINUTE_MS,
        /**
         * Builds today's route and free card files ahead of the first device asking for them. A
         * cold getrouteinfodb reads four tables and writes nine, which is minutes of work for
         * the caller that happens to arrive first; with ?cache=1 that caller gets a ready file.
         *
         * OFF unless a system asks for it: generation is expensive and the files are shared
         * through one directory, so which systems may drive it is an operational decision.
         */
        func: (ctx) => ctx.withConnection(async (conn) => {
            await SqliteBuilder.buildRouteInfo(conn, {}, ctx.sessionId);
            await SqliteBuilder.buildFreeCard(conn, ctx.sessionId);
            ULog.info(`sqlite_refresh: ${ctx.systemId} route and free card files rebuilt`,
                ctx.sessionId);
        }),
    },
    {
        name: "request_log_retention",
        scope: "system",
        flag: "run_retention",
        // OFF by default, and the period is required rather than defaulted: this job deletes
        // data, and how long a system keeps its records is never ours to guess.
        requires: ["request_log_retention_days"],
        intervalKey: "retention_interval_ms",
        intervalMs: HOUR_MS,
        func: async (ctx) => {
            const logDays = ctx.num("request_log_retention_days", 0);
            // Error records are investigation material and are usually kept longer than the
            // request copy, so they get their own period; unset, they follow the request log.
            const errorDays = ctx.num("error_td_retention_days", logDays);
            const batchRows = ctx.num("retention_batch_rows", DEFAULT_BATCH_ROWS);

            await ctx.withConnection(async (conn) => {
                report(ctx, "VALIDATOR_REQUEST_LOG",
                    await requestLogDao.purge(conn, logDays, batchRows, ctx.sessionId), logDays);
                report(ctx, "TBL_VALIDATOR_ERROR_TD",
                    await errorTdDao.purge(conn, errorDays, batchRows, ctx.sessionId), errorDays);
            });
        },
    },
];

function report(ctx, table, result, retentionDays) {
    if (!result || result.deleted <= 0) return;
    ULog.info(`request_log_retention: ${ctx.systemId} ${table} ${result.deleted} row(s) deleted `
        + `(>${retentionDays} days)`
        + `${result.more ? " — hit the round limit, the rest follows next run" : ""}`,
    ctx.sessionId);
}

module.exports = {
    JOBS,
    manager: jobManager,
    init: (appConfig, deps) => jobManager.init(appConfig, JOBS, deps),
    run: (label) => jobManager.run(JOBS, label),
    stop: () => jobManager.stop(),
    DEFAULT_BATCH_ROWS,
};
