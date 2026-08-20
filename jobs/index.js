const { ULog } = require("../../../lib/utils");
const FileCacheManager = require("../util/FileCacheManager");
const jobManager = require("./JobManager");

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

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
 * Jobs sharing a period share a scheduler and run in this order within it. Both jobs here are
 * service-wide today; scope/requires/mode are the runner's contract, not dead options — a
 * per-system job drops in as one more entry.
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
];

module.exports = {
    JOBS,
    manager: jobManager,
    init: (appConfig, deps) => jobManager.init(appConfig, JOBS, deps),
    run: (label) => jobManager.run(JOBS, label),
    stop: () => jobManager.stop(),
};
