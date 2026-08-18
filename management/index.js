const { ULog, ServiceError } = require("../../../lib/utils");
const system_cfg = require("../config/system_cfg");
const configDaoImpl = require("../validator/dao/oracle/ConfigDaoImpl");

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const SECRET_KEY = /pass|secret|token|pwd|credential|apikey|api_key/i;

const controller = {
    getversion: async (req, res) => {
        res.setHeader("Content-Type", JSON_CONTENT_TYPE);
        res.locals.data = {
            appName: system_cfg.appName,
            version: system_cfg.version,
            runTime: system_cfg.runTime,
        };
    },

    // Reads the config table straight through and refreshes the in-memory copy. Until the
    // configWatch job lands (phase 7.1) this is the only path that populates system_cfg.cfgs.
    getconfig: async (req, res) => {
        const rows = await configDaoImpl.getAllConfig();
        const cfgs = {};
        for (const row of rows) cfgs[row.SYSTEM_ID] = row.CONFIG;
        // Java EnvConfig always had an [app] section; downstream lookups assume it exists.
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
