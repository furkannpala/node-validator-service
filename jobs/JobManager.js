const {
    ULog, getConnection, assignFixRateScheduler, getPools, getStatistics,
} = require("../../../lib/utils");
const configDaoImpl = require("../validator/dao/oracle/ConfigDaoImpl");
const { bindJobs, stopJobs } = require("./index");

// Java had no job layer, so there is no ConsumerManager equivalent to hang these off; this is
// the thin carrier the roadmap asks for. Nothing here answers a request.

const CONNECT_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

class JobManager {
    constructor() {
        this.appConfig = null;
        this.deps = null;
        this.handles = [];
        this.started = false;
        this._starting = false;
    }

    async init(appConfig, deps) {
        if (this.started || this._starting) return this.handles;
        this._starting = true;
        try {
            this.appConfig = appConfig;
            this.deps = deps || { getConnection, assignFixRateScheduler, getPools, getStatistics };

            if (appConfig.loaded === false) {
                appConfig.setCfgs(await this.loadConfig());
            }
            this.handles = await bindJobs(this);
            this.started = true;
            ULog.info(`JobManager started; ${this.handles.length} job(s) registered`);
            return this.handles;
        } finally {
            this._starting = false;
        }
    }

    /**
     * Retried, unlike the request path: at startup Oracle may still be coming up, and a single
     * failed attempt would leave the service running with no configuration at all.
     */
    async loadConfig() {
        // Injectable so a test does not have to sit through the real backoff.
        const retries = this.deps?.connectRetries ?? CONNECT_RETRIES;
        const retryDelay = this.deps?.retryDelayMs ?? RETRY_DELAY_MS;
        let lastError = null;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const rows = await configDaoImpl.getAllConfig();
                const cfgs = {};
                for (const row of rows) cfgs[row.SYSTEM_ID] = row.CONFIG;
                // Java EnvConfig always had an [app] section; every lookup assumes it exists.
                if (!cfgs.app) cfgs.app = {};
                return cfgs;
            } catch (e) {
                lastError = e;
                ULog.error(`KKCONFIG load attempt ${attempt + 1} failed: ${e?.message}`);
                if (attempt < retries) await sleep(retryDelay);
            }
        }
        throw new Error(`KKCONFIG unreachable after ${retries + 1} attempts: `
            + `${lastError?.message}`);
    }

    /** Job periods and switches always come from the 'app' row; see jobUtil. */
    _appConfigValue(key, defaultValue) {
        if (typeof this.appConfig?.getSystemConfig !== "function") return defaultValue;
        return this.appConfig.getSystemConfig(key, "app", defaultValue);
    }

    async _configAlias() {
        return await configDaoImpl.resolveConfigAlias();
    }

    /**
     * Re-reads the config table. Which sections changed is reported back, because a change in
     * a period key only takes effect once the jobs are bound again.
     */
    async reloadConfig() {
        const cfgs = await this.loadConfig();
        const changed = this.changedSystemIds(this.appConfig.cfgs, cfgs);
        this.appConfig.setCfgs(cfgs);
        if (changed.length) {
            ULog.info(`KKCONFIG changed for ${changed.join(",")}; rebinding jobs`);
            await this.rebind();
        }
        return changed;
    }

    /** Compared by content and independent of key order; a new system counts as changed. */
    changedSystemIds(current, next) {
        const ids = new Set([...Object.keys(current || {}), ...Object.keys(next || {})]);
        return [...ids].filter((id) => this.stable(current?.[id]) !== this.stable(next?.[id]));
    }

    stable(section) {
        if (section == null) return null;
        return JSON.stringify(Object.keys(section).sort().map((k) => [k, section[k]]));
    }

    async rebind() {
        stopJobs(this.handles);
        this.handles = await bindJobs(this);
    }

    stop() {
        stopJobs(this.handles);
        this.handles = [];
        this.started = false;
    }
}

const singleton = new JobManager();
singleton.JobManager = JobManager;
module.exports = singleton;
