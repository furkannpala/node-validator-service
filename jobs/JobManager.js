const {
    ULog, getConnection, assignFixRateScheduler, getPools,
} = require("../../../lib/utils");
const configDaoImpl = require("../validator/dao/oracle/ConfigDaoImpl");

// Java had no job layer, so there is no ConsumerManager equivalent to hang these off; this is
// the thin carrier the roadmap asks for. Nothing here answers a request.

const CONNECT_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
// How often the pool map is checked while initPools is still filling it.
const POOL_POLL_MS = 50;
// The config table has no home but this pool; see ConfigDaoImpl.resolveConfigAlias.
const KKCONFIG_ALIAS = "kkconfig";
// The shared config row, and also the systemId a service-wide job runs under, so that its ctx
// reads keys through the same lookup a per-system one uses.
const APP_SECTION = "app";
const SERVICE_SCOPE = "service";
const ASYNC_JOB_CONCURRENCY = 10;
const GROUP_STAGGER_MS = 10 * 1000;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency(items, limit, fn) {
    let nextIndex = 0;

    async function worker() {
        while (true) {
            const i = nextIndex++;
            if (i >= items.length) return;
            await fn(items[i]);
        }
    }

    const requested = Number(limit);
    const safeLimit = Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : 1;
    const workerCount = Math.min(safeLimit, items.length);
    const workers = [];
    for (let w = 0; w < workerCount; w++) workers.push(worker());
    await Promise.all(workers);
}

class JobManager {
    constructor() {
        this.appConfig = null;
        this.jobs = [];
        this.deps = null;
        // One entry per interval group: { handle, intervalMs, jobs: [name] }.
        this.groups = [];
        this.started = false;
        this._starting = false;
    }

    async init(appConfig, jobs = [], deps = null) {
        if (this.started || this._starting) return this.groups;
        this._starting = true;
        try {
            this.appConfig = appConfig;
            this.jobs = jobs;
            this.deps = deps || { getConnection, assignFixRateScheduler, getPools };

            if (appConfig.loaded === false) {
                appConfig.setCfgs(await this.loadConfig());
            }
            this.groups = await this.start(jobs);
            this.started = true;
            ULog.info(`JobManager started; ${jobs.length} job(s) in ${this.groups.length} group(s)`);
            return this.groups;
        } finally {
            this._starting = false;
        }
    }

    /**
     * server.js requires the webapps at module load and only awaits initPools afterwards, so the
     * autostart in index.js runs while the pool map is still filling — the first attempt lands
     * before 'kkconfig' exists and fails for a reason that will fix itself in a moment.
     *
     * Polling returns the instant the pool appears, so the common case costs one tick rather
     * than a retry delay. The budget is the one the connect retries already get: a second
     * timeout to keep in sync would be a second thing to get wrong, and a pool that never
     * appears is the same failure the retry loop below reports.
     */
    async waitForConfigPool() {
        const getPoolsFn = this.deps?.getPools;
        if (typeof getPoolsFn !== "function") return;

        const budgetMs = (this.deps?.connectRetries ?? CONNECT_RETRIES)
            * (this.deps?.retryDelayMs ?? RETRY_DELAY_MS);
        const pollMs = this.deps?.poolPollMs ?? POOL_POLL_MS;
        const deadline = Date.now() + budgetMs;

        while (Date.now() < deadline) {
            if ((await getPoolsFn())?.oracle?.[KKCONFIG_ALIAS]) return;
            await sleep(pollMs);
        }
        ULog.debug(`'${KKCONFIG_ALIAS}' pool still absent after ${budgetMs}ms; loading anyway`);
    }

    /**
     * Retried, unlike the request path: at startup Oracle may still be coming up, and a single
     * failed attempt would leave the service running with no configuration at all.
     */
    async loadConfig() {
        // Injectable so a test does not have to sit through the real backoff.
        const retries = this.deps?.connectRetries ?? CONNECT_RETRIES;
        const retryDelay = this.deps?.retryDelayMs ?? RETRY_DELAY_MS;
        await this.waitForConfigPool();
        let lastError = null;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const rows = await configDaoImpl.getAllConfig();
                const cfgs = {};
                for (const row of rows) cfgs[row.SYSTEM_ID] = row.CONFIG;
                // Java EnvConfig always had an [app] section; every lookup assumes it exists.
                if (!cfgs[APP_SECTION]) cfgs[APP_SECTION] = {};
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

    /**
     * Re-reads the config table. Which sections changed is reported back, because a changed
     * period only takes effect once the jobs are bound again. Flags and thresholds do not need
     * the rebind — those are read fresh on every cycle — but the period is fixed in the
     * scheduler handle at bind time.
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

    /** Every configured system, which is every kkconfig row except the shared 'app' one. */
    systemIds() {
        const cfgs = this.appConfig?.cfgs || {};
        return Object.keys(cfgs).filter((id) => id !== APP_SECTION);
    }

    /** Pool alias = datasource_prefix + systemId, the same rule the framework uses per request. */
    poolAliasFor(systemId) {
        const prefix = this.appConfig.getSystemConfig("datasource_prefix", systemId, "") || "";
        return prefix + systemId;
    }

    async withConnection(systemId, fn) {
        const getConn = this.deps?.getConnection;
        if (typeof getConn !== "function") throw new Error("deps.getConnection is missing");
        const conn = await getConn(this.poolAliasFor(systemId));
        try {
            return await fn(conn);
        } finally {
            try {
                await conn.close();
            } catch (e) {
                ULog.debug(`job conn close failed (${systemId}): ${e?.message}`);
            }
        }
    }

    /** Job configuration is read through the normal chain: the system's own row, then 'app'. */
    contextFor(systemId, runSessionId) {
        const value = (key, defaultValue) =>
            this.appConfig.getSystemConfig(key, systemId, defaultValue);
        return {
            manager: this,
            systemId,
            sessionId: `${runSessionId}-${systemId}`,
            cfg: this.appConfig?.cfgs?.[systemId] || {},
            value,
            /**
             * A period or a size that must be positive. Zero and negative values fall back to
             * the default: a non-positive delay fires setTimeout at once and spins the job.
             */
            num: (key, defaultValue) => {
                const n = Number(value(key, defaultValue));
                return Number.isFinite(n) && n > 0 ? n : defaultValue;
            },
            /** kkconfig values come from a JSON CLOB, so a flag may arrive as the string 'true'. */
            bool: (key, defaultValue = false) => {
                const v = value(key, defaultValue);
                return v === true || String(v).toLowerCase() === "true";
            },
            str: (key, defaultValue = "") => {
                const v = value(key, defaultValue);
                return v == null ? "" : String(v).trim();
            },
            withConnection: (fn) => this.withConnection(systemId, fn),
        };
    }

    /** The period is fixed at bind time and, like every job key, comes from the 'app' row. */
    intervalOf(job) {
        const fallback = Number(job.intervalMs);
        if (!job.intervalKey) return fallback;
        const configured = Number(
            this.appConfig?.getSystemConfig?.(job.intervalKey, APP_SECTION, fallback));
        return Number.isFinite(configured) && configured > 0 ? configured : fallback;
    }

    isEnabled(job, ctx) {
        if (!job.flag) return true;
        return ctx.bool(job.flag, job.defaultOn === true);
    }

    async runFor(jobs, systemId, runSessionId, failures) {
        const ctx = this.contextFor(systemId, runSessionId);

        // Split enabled, fully configured jobs by mode. JOBS order is kept within each list.
        const syncJobs = [];
        const asyncJobs = [];
        for (const job of jobs) {
            if (!this.isEnabled(job, ctx)) {
                ULog.debug(`${job.name} flag [${job.flag}] off, skipping ${systemId}`, ctx.sessionId);
                continue;
            }
            // e.g. a retention round turned on without saying how many days to keep.
            const missing = (job.requires || []).filter((key) => !ctx.value(key));
            if (missing.length > 0) {
                const message = `${job.name} missing config [${missing.join(", ")}],`
                    + ` skipping ${systemId}`;
                ULog.error(message, ctx.sessionId);
                failures.push(message);
                continue;
            }
            // Default (mode omitted) is "sync", so a job runs serially unless it asks not to.
            (job.mode === "async" ? asyncJobs : syncJobs).push(job);
        }

        const safeRun = async (job) => {
            try {
                await job.func(ctx);
            } catch (e) {
                const message = `${job.name} error, ${systemId}: ${e?.message}`;
                ULog.error(`${message}\n${e?.stack}`, ctx.sessionId);
                failures.push(message);
            }
        };

        const asyncDone = mapWithConcurrency(asyncJobs, ASYNC_JOB_CONCURRENCY, safeRun);
        for (const job of syncJobs) await safeRun(job);
        await asyncDone;
    }

    async run(jobs, label = "jobs") {
        const runSessionId = `${label}-${Date.now()}`;
        const started = Date.now();
        const failures = [];
        ULog.debug("run start", runSessionId);

        const serviceJobs = jobs.filter((job) => job.scope === SERVICE_SCOPE);
        const systemJobs = jobs.filter((job) => job.scope !== SERVICE_SCOPE);
        if (serviceJobs.length) {
            await this.runFor(serviceJobs, APP_SECTION, runSessionId, failures);
        }
        if (systemJobs.length) {
            for (const systemId of this.systemIds()) {
                await this.runFor(systemJobs, systemId, runSessionId, failures);
            }
        }

        ULog.debug(`run finish, total ms: ${Date.now() - started}`, runSessionId);
        if (failures.length) throw new Error(failures.join(" | "));
    }

    /** Jobs sharing a period share a scheduler, which is what keeps them off each other's toes. */
    async start(jobs) {
        const assign = this.deps?.assignFixRateScheduler;
        if (typeof assign !== "function") return [];

        const byInterval = new Map();
        for (const job of jobs) {
            const interval = this.intervalOf(job);
            if (!byInterval.has(interval)) byInterval.set(interval, []);
            byInterval.get(interval).push(job);
        }

        const groups = [];
        let index = 0;
        for (const [intervalMs, groupJobs] of byInterval) {
            const names = groupJobs.map((job) => job.name);
            const label = names.join("|");
            const delayMs = intervalMs + index * GROUP_STAGGER_MS;
            const handle = await assign(() => this.run(groupJobs, label), intervalMs, delayMs);
            handle.name = label;
            groups.push({ handle, intervalMs, jobs: names });
            ULog.info(`job group scheduled: [${label}], rateMs=${intervalMs},`
                + ` first run in ${delayMs}ms`);
            index++;
        }
        return groups;
    }

    stopGroups() {
        for (const group of this.groups || []) {
            try {
                group.handle?.stop?.();
            } catch (e) {
                ULog.error(`job stop failed (${group.jobs?.join("|")}): ${e?.stack}`);
            }
        }
    }

    async rebind() {
        this.stopGroups();
        this.groups = await this.start(this.jobs);
    }

    stop() {
        this.stopGroups();
        this.groups = [];
        this.started = false;
    }

    /** The group a job was scheduled in, for ?func=getjobs. */
    groupOf(jobName) {
        return (this.groups || []).find((group) => group.jobs.includes(jobName)) || null;
    }
}

const singleton = new JobManager();
singleton.JobManager = JobManager;
singleton.mapWithConcurrency = mapWithConcurrency;
singleton.APP_SECTION = APP_SECTION;
singleton.SERVICE_SCOPE = SERVICE_SCOPE;
singleton.GROUP_STAGGER_MS = GROUP_STAGGER_MS;
module.exports = singleton;
