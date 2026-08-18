const { ULog } = require("../../../lib/utils");
const HttpUtil = require("../util/HttpUtil");
const { num, str } = require("./jobUtil");

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5000;

function healthUrl(manager) {
    return str(manager, "kpg_health_url", "");
}

function intervalMs(manager) {
    return num(manager, "kpg_health_interval_ms", DEFAULT_INTERVAL_MS);
}

/**
 * realauth and sendemvdata are pure proxies: when the gateway is down every contactless tap
 * fails at the device with nothing on our side to show for it. This probe notices first.
 */
async function run(manager, http = HttpUtil) {
    const url = healthUrl(manager);
    if (!url) return;
    const timeout = num(manager, "kpg_health_timeout_ms", DEFAULT_TIMEOUT_MS);

    let result;
    try {
        result = await http.probe(url, timeout);
    } catch (e) {
        const message = `KPG unreachable (${url}): ${e?.message}`;
        ULog.error(`kpgHealth: ${message}`);
        throw new Error(message);
    }
    ULog.debug(`kpgHealth: ${url} -> HTTP ${result.statusCode} (${result.ms}ms)`);
    return result;
}

/**
 * OFF unless an address is configured, and there is deliberately no default: which endpoint
 * KPG wants probed has to be agreed with them, and falling back to credit_card_auth_url would
 * put uninvited traffic on a payment gateway.
 */
function register(manager, staggerMs = 0) {
    const assign = manager.deps?.assignFixRateScheduler;
    if (typeof assign !== "function") return null;
    const url = healthUrl(manager);
    if (!url) return null;
    const ms = intervalMs(manager);
    ULog.info(`job 'kpgHealth' registered; interval=${ms}ms, first run in ${ms + staggerMs}ms,`
        + ` url=${url}`);
    return assign(() => run(manager), ms, ms + staggerMs);
}

module.exports = {
    name: "kpgHealth", register, run, healthUrl, intervalMs,
    DEFAULT_INTERVAL_MS, DEFAULT_TIMEOUT_MS,
};
