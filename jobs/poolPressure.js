const { ULog } = require("../../../lib/utils");
const { num, poolAliasFor, systemIds } = require("./jobUtil");

const DEFAULT_INTERVAL_MS = 60 * 1000;

function intervalMs(manager) {
    return num(manager, "pool_pressure_interval_ms", DEFAULT_INTERVAL_MS);
}

/**
 * The pools run with queueMax=1, so a request that arrives at a full pool errors out instead
 * of waiting: saturation here is a rejected device, not just a slow one. This warns first.
 */
function inspect(stats, watched) {
    const oracle = stats?.oracle || {};
    const warnings = [];
    for (const alias of Object.keys(oracle)) {
        // Other webapps share the process; their pools are not this job's business.
        if (watched.size && !watched.has(alias)) continue;
        const pool = oracle[alias] || {};
        const inUse = Number(pool.connectionsInUse) || 0;
        const max = Number(pool.poolMax) || 0;
        const queued = Number(pool.currentQueueLength) || 0;

        if (queued > 0) {
            warnings.push(`${alias}: ${queued} request(s) queued (queueMax=1, overflow errors out)`);
        } else if (max > 0 && inUse >= max) {
            warnings.push(`${alias}: ${inUse}/${max} connections in use — pool is full`);
        }
    }
    return warnings;
}

async function run(manager) {
    const getStatistics = manager.deps?.getStatistics;
    if (typeof getStatistics !== "function") return;

    const watched = new Set([
        ...systemIds(manager).map((id) => poolAliasFor(manager, id)),
        await manager._configAlias(),
    ]);

    const warnings = inspect(await getStatistics(), watched);
    if (!warnings.length) return;

    ULog.error(`poolPressure: ${warnings.join(" | ")}`);
    // Thrown so the console shows the job red rather than quietly green with a log line.
    throw new Error(warnings.join(" | "));
}

function register(manager, staggerMs = 0) {
    const assign = manager.deps?.assignFixRateScheduler;
    if (typeof assign !== "function") return null;
    if (typeof manager.deps?.getStatistics !== "function") return null;
    const ms = intervalMs(manager);
    ULog.info(`job 'poolPressure' registered; interval=${ms}ms, first run in ${ms + staggerMs}ms`);
    return assign(() => run(manager), ms, ms + staggerMs);
}

module.exports = { name: "poolPressure", register, run, inspect, intervalMs, DEFAULT_INTERVAL_MS };
