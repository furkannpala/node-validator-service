const { ULog } = require("../../../lib/utils");
const FileCacheManager = require("../util/FileCacheManager");
const { num } = require("./jobUtil");

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function intervalMs(manager) {
    return num(manager, "cache_cleanup_interval_ms", DEFAULT_INTERVAL_MS);
}

function maxAgeMs(manager) {
    return num(manager, "cache_max_age_ms", DEFAULT_MAX_AGE_MS);
}

/**
 * The scheduled half of ?func=cleancachefiles. Java only cleared the cache on a day rollover
 * or by hand, so a file for a version nobody asks for any more stayed on disk indefinitely.
 */
async function run(manager, cache = FileCacheManager) {
    const removed = await cache.removeExpired(maxAgeMs(manager));
    if (removed > 0) ULog.info(`cacheCleanup: ${removed} expired cache file(s) removed`);
    return removed;
}

function register(manager, staggerMs = 0) {
    const assign = manager.deps?.assignFixRateScheduler;
    if (typeof assign !== "function") return null;
    const ms = intervalMs(manager);
    ULog.info(`job 'cacheCleanup' registered; interval=${ms}ms, first run in ${ms + staggerMs}ms,`
        + ` max age=${maxAgeMs(manager)}ms`);
    return assign(() => run(manager), ms, ms + staggerMs);
}

module.exports = {
    name: "cacheCleanup", register, run, intervalMs, maxAgeMs,
    DEFAULT_INTERVAL_MS, DEFAULT_MAX_AGE_MS,
};
