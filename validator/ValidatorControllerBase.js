const { ULog, ServiceError, getXmlResponse, js2Xml } = require("../../../lib/utils");
const moment = require("moment");
const daoFactory = require("./daoFactory/DaoFactory");
const { withTransaction } = require("./dao/daoUtil");
const { ErrorManagement, ErrorCodes } = require("../constant/ErrorManagement");
const Constant = require("../constant/Constant");
const XmlWalk = require("../util/XmlWalk");
const HttpUtil = require("../util/HttpUtil");

class ValidatorControllerBase {
    constructor() {
        this.ULog = ULog;
        this.ServiceError = ServiceError;
        this.getXmlResponse = getXmlResponse;
        this.js2Xml = js2Xml;
        this.moment = moment;

        this.daoFactory = daoFactory;
        this.withTransaction = withTransaction;
        this.ErrorManagement = ErrorManagement;
        this.ErrorCodes = ErrorCodes;
        this.Constant = Constant;
    }

    /**
     * Java doProcess ran this as the first statement of 50+ endpoints. `action` and the extra
     * status text stay exactly as the Java branch built them, since they land in val_status.
     */
    async setValidatorStatus(req, action, extraParams) {
        const busid = req.query.busid;
        const binds = {
            busid: busid == null ? null : String(busid),
            ipaddr: req.query.remoteipaddr == null ? null : String(req.query.remoteipaddr),
            status: action,
            connected: '1',
            parameters: ` Busid:${busid}${extraParams || ''}`,
        };
        return await this.daoFactory.get("PkAppValDaoImpl").setValStatus(req.dbConn, binds, req.sessionId);
    }

    /** Config lookup with the Java default. req.cfg is the system row, defaultCfg the app row. */
    cfg(req, key, defaultValue) {
        const own = req.cfg ? req.cfg[key] : undefined;
        if (own !== undefined) return own;
        const app = req.cfg?.defaultCfg ? req.cfg.defaultCfg[key] : undefined;
        return app !== undefined ? app : defaultValue;
    }

    /**
     * The 'app' row only. Java read the KPG timeouts through EnvConfig.getSystemConfig("app"),
     * so a system row that sets them is ignored — unlike every other key.
     */
    appCfg(req, key, defaultValue) {
        const app = req.cfg?.defaultCfg ? req.cfg.defaultCfg[key] : undefined;
        return app !== undefined ? app : defaultValue;
    }

    /** Java's HttpURLConnection pair: one deadline to connect, another to read the answer. */
    kpgTimeouts(req) {
        return {
            connectTimeoutMs: Number(this.appCfg(req, "kpg_connect_timeout_ms",
                HttpUtil.DEFAULT_CONNECT_TIMEOUT_MS)),
            readTimeoutMs: Number(this.appCfg(req, "kpg_read_timeout_ms",
                HttpUtil.DEFAULT_READ_TIMEOUT_MS)),
        };
    }

    /** env.properties held these as comma lists; a JSON config may store either shape. */
    cfgList(req, key, defaultValue) {
        const v = this.cfg(req, key, defaultValue);
        if (Array.isArray(v)) return v;
        if (typeof v === "string") return v === "" ? [] : v.split(",");
        return [];
    }

    /** "false"/"0" from a JSON string value must not read as true. */
    cfgBool(req, key, defaultValue) {
        const v = this.cfg(req, key, defaultValue);
        if (typeof v === "string") return v !== "" && v !== "0" && v.toLowerCase() !== "false";
        return !!v;
    }

    /**
     * Java parsed the request body into a DOM and walked every element in document order.
     * rawBodyParser has already gunzipped it, so the payload is a Buffer or a string here.
     */
    bodyElements(req) {
        return XmlWalk.elements(req.rawBody);
    }

    /** Every write endpoint answered with the same empty OK document. */
    okResponse(res) {
        res.setHeader("Content-Type", "text/xml");
        res.locals.data = this.getXmlResponse(0, "");
    }

    getServiceError(error) {
        if (!error) return new ServiceError(-8, "Unknown error");
        if (error instanceof ServiceError) return error;
        const message = error?.stack || error?.message || "Unknown error";
        return new ServiceError(-8, message);
    }
}

module.exports = { ValidatorControllerBase };
