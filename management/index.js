const { ULog, ServiceError } = require("../../../lib/utils");
const system_cfg = require("../config/system_cfg");
const configDaoImpl = require("../validator/dao/oracle/ConfigDaoImpl");
const { JOBS, manager: JobManager } = require("../jobs");

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

const SECRET_KEY = /pass|secret|token|pwd|credential|apikey|api_key/i;

/**
 * Where a job's flag is on right now. Read straight from the live config rather than from what
 * was true at bind time, because the runner reads the flag on every cycle too.
 */
function enabledFor(job) {
    if (!JobManager.appConfig) return [];
    const targets = job.scope === "service" ? ["app"] : JobManager.systemIds();
    return targets.filter((systemId) =>
        JobManager.isEnabled(job, JobManager.contextFor(systemId, "getjobs")));
}

const controller = {
    getversion: async (req, res) => {
        res.setHeader("Content-Type", JSON_CONTENT_TYPE);
        res.locals.data = {
            appName: system_cfg.appName,
            version: system_cfg.version,
            runTime: system_cfg.runTime,
        };
    },

    // Reads the config table straight through and refreshes the in-memory copy. The
    // config_watch job does the same on a timer; this is the by-hand path.
    getconfig: async (req, res) => {
        const rows = await configDaoImpl.getAllConfig();
        const cfgs = {};
        for (const row of rows) cfgs[row.SYSTEM_ID] = row.CONFIG;
        if (!cfgs.app) cfgs.app = {};
        system_cfg.setCfgs(cfgs);

        const masked = {};
        for (const [systemId, section] of Object.entries(cfgs)) {
            masked[systemId] = {};
            for (const [k, v] of Object.entries(section)) {
                masked[systemId][k] = (SECRET_KEY.test(k) && v) ? "***" : v;
            }
        }

        const systemId = req.query.systemid;
        res.setHeader("Content-Type", JSON_CONTENT_TYPE);
        res.locals.data = {
            context: system_cfg.context,
            version: system_cfg.version,
            kk_config_scheme: system_cfg.kk_config_scheme,
            cfgs: systemId ? { [systemId]: masked[systemId] } : masked,
        };
    },
    /**
     * Every job in the JOBS array, with the group it was scheduled in and where it is switched
     * on. A job that is off shows up with an empty enabledFor, so the list explains its own
     * silence; the group carries the run state, because a group is what the scheduler arms.
     */
    getjobs: async (req, res) => {
        const groups = JobManager.groups || [];

        res.setHeader("Content-Type", JSON_CONTENT_TYPE);
        res.locals.data = {
            started: JobManager.started,
            groups: groups.map((group) => ({
                jobs: group.jobs,
                rateMs: group.intervalMs,
                running: group.handle?.running,
                lastRunAt: group.handle?.lastRunAt,
                lastDurationMs: group.handle?.lastDurationMs,
                lastError: group.handle?.lastError,
                nextRunAt: group.handle?.nextRunAt,
            })),
            jobs: JOBS.map((job) => ({
                name: job.name,
                scope: job.scope || "system",
                mode: job.mode || "sync",
                flag: job.flag || null,
                group: JobManager.groupOf(job.name)?.jobs.join("|") || null,
                rateMs: JobManager.groupOf(job.name)?.intervalMs ?? null,
                enabledFor: enabledFor(job),
            })),
        };
    },

    /** Re-reads KKCONFIG and rebinds the jobs, so a changed period takes effect at once. */
    reloadconfig: async (req, res) => {
        const changed = await JobManager.reloadConfig();
        res.setHeader("Content-Type", JSON_CONTENT_TYPE);
        res.locals.data = { changed, systems: Object.keys(system_cfg.cfgs) };
    },
};

module.exports = {
    methods: ['get', 'post'],
    conn: false,
    path: "Admin",
    func: async (req, res, next) => {
        const func = (req.query.func || 'no_func').toLowerCase();
        ULog.debug(func, req.sessionId);
        let respErr;
        try {
            // hasOwnProperty is required: a plain lookup also walks the prototype chain, so
            // ?func=constructor would pass the guard and hang the request forever.
            if (!Object.prototype.hasOwnProperty.call(controller, func)) {
                return next(new ServiceError(-9, "unrecognized func " + func));
            }
            await controller[func](req, res, next);
        } catch (error) {
            ULog.error(error?.stack || error?.message, req.sessionId);
            respErr = error instanceof ServiceError ? error : new ServiceError(-99, error.message);
        } finally {
            next(respErr);
        }
    }
};

module.exports.controller = controller;
