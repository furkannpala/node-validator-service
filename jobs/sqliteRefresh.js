const { ULog } = require("../../../lib/utils");
const SqliteBuilder = require("../util/SqliteBuilder");
const { num, list, withSystemConnection } = require("./jobUtil");

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

function intervalMs(manager) {
    return num(manager, "sqlite_refresh_interval_ms", DEFAULT_INTERVAL_MS);
}

/** Empty list = off. There is no default: which systems want it is an operational decision. */
function systems(manager) {
    return list(manager, "sqlite_refresh_systems");
}

/**
 * Builds today's route and free card files ahead of the first device asking for them. A cold
 * getrouteinfodb reads four tables and writes nine, which is minutes of work for the caller
 * that happens to arrive first; with ?cache=1 that caller gets a ready file instead.
 */
async function run(manager, builder = SqliteBuilder) {
    const errors = [];
    for (const systemId of systems(manager)) {
        try {
            await withSystemConnection(manager, systemId, async (conn) => {
                await builder.buildRouteInfo(conn, {}, "sqliteRefresh");
                await builder.buildFreeCard(conn, "sqliteRefresh");
            });
            ULog.info(`sqliteRefresh: ${systemId} route and free card files rebuilt`);
        } catch (e) {
            errors.push(`${systemId}: ${e?.message}`);
        }
    }
    if (errors.length) {
        ULog.error(`sqliteRefresh: ${errors.join(" | ")}`);
        throw new Error(errors.join(" | "));
    }
}

/**
 * OFF by default. Generation is expensive and the files are shared by every system through one
 * directory, so which systems may drive it has to be stated explicitly.
 */
function register(manager, staggerMs = 0) {
    const assign = manager.deps?.assignFixRateScheduler;
    if (typeof assign !== "function") return null;
    const configured = systems(manager);
    if (!configured.length) return null;
    const ms = intervalMs(manager);
    ULog.info(`job 'sqliteRefresh' registered; interval=${ms}ms, first run in ${ms + staggerMs}ms,`
        + ` systems=${configured.join(",")}`);
    return assign(() => run(manager), ms, ms + staggerMs);
}

module.exports = { name: "sqliteRefresh", register, run, intervalMs, systems, DEFAULT_INTERVAL_MS };
