const { ULog } = require("../../../lib/utils");
const { num } = require("./jobUtil");

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

function intervalMs(manager) {
    return num(manager, "config_refresh_ms", DEFAULT_INTERVAL_MS);
}

/**
 * Keeps the in-memory copy of VALIDATOR_SERVICE_CONFIG current. Without it the only way to
 * pick up a config change is ?func=getconfig by hand or a restart.
 */
async function run(manager) {
    try {
        await manager.reloadConfig();
    } catch (e) {
        ULog.error(`config watch error: ${e?.stack}`);
        throw e;
    }
}

function register(manager, staggerMs = 0) {
    const assign = manager.deps?.assignFixRateScheduler;
    if (typeof assign !== "function") return null;
    if (typeof manager.appConfig?.setCfgs !== "function") return null;
    const ms = intervalMs(manager);
    ULog.info(`job 'configWatch' registered; interval=${ms}ms, first run in ${ms + staggerMs}ms`);
    return assign(() => run(manager), ms, ms + staggerMs);
}

module.exports = { name: "configWatch", register, run, intervalMs, DEFAULT_INTERVAL_MS };
