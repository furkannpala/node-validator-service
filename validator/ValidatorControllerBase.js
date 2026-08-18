const { ULog, LogLevel, ServiceError, getXmlResponse, xml2Json, js2Xml, HttpCall } = require("../../../lib/utils");
const xmlJs = require("xml-js");
const moment = require("moment");
const daoFactory = require("./daoFactory/DaoFactory");
const { withTransaction } = require("./dao/daoUtil");
const { ErrorManagement, ErrorCodes } = require("../constant/ErrorManagement");
const Constant = require("../constant/Constant");

class ValidatorControllerBase {
    constructor() {
        this.ULog = ULog;
        this.LogLevel = LogLevel;
        this.ServiceError = ServiceError;
        this.getXmlResponse = getXmlResponse;
        this.xml2Json = xml2Json;
        this.js2Xml = js2Xml;
        this.xmlJs = xmlJs;
        this.HttpCall = HttpCall;
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

    /** "false"/"0" from a JSON string value must not read as true. */
    cfgBool(req, key, defaultValue) {
        const v = this.cfg(req, key, defaultValue);
        if (typeof v === "string") return v !== "" && v !== "0" && v.toLowerCase() !== "false";
        return !!v;
    }

    getServiceError(error) {
        if (!error) return new ServiceError(-8, "Unknown error");
        if (error instanceof ServiceError) return error;
        const message = error?.stack || error?.message || "Unknown error";
        return new ServiceError(-8, message);
    }
}

module.exports = { ValidatorControllerBase };
