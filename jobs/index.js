const { ULog } = require("../../../lib/utils");
const FileCacheManager = require("../util/FileCacheManager");
const jobManager = require("./JobManager");

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const JOBS = [
    {
        name: "config_watch",
        scope: "service",
        flag: "run_config_watch",
        defaultOn: true,
        intervalKey: "config_refresh_ms",
        intervalMs: 5 * MINUTE_MS,
        func: (ctx) => ctx.manager.reloadConfig(),
    },
    {
        name: "cache_cleanup",
        scope: "service",
        flag: "run_cache_cleanup",
        defaultOn: true,
        intervalKey: "cache_cleanup_interval_ms",
        intervalMs: HOUR_MS,
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
