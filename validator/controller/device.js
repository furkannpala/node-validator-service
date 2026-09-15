/**
 * The validator reporting on itself — configuration, health, logs, alarms, network state — and the files it downloads.
 *
 * The keys of the funcs table at the bottom are the ?func= values this file answers;
 * validator/index.js registers them straight from there.
 */
const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const CfgTransaction = require("../transaction/CfgTransaction");
const { isUniqueViolation } = require("../dao/daoUtil");
const LogTransaction = require("../transaction/LogTransaction");
const XmlRpc = require("../../util/XmlRpc");


// ---------------------------------------------------------------- ?func=sendcfg

class SendCfg extends ValidatorControllerBase {
    constructor() {
        super();
        this.cfgDao = this.daoFactory.get("TblDeviceCfgDaoImpl");
        this.healthDao = this.daoFactory.get("TblDeviceHealthDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            const dbEnabled = !this.kafkaOnly(req, "sendcfg");
            const toKafka = this.kafkaEnabled(req, "sendcfg");
            // Java skipped the status call and the connection entirely on the kafka-only path.
            if (dbEnabled) {
                await this.setValidatorStatus(req, " SendCfg ",
                    ` Stationtype :${req.query.stationtype} arch :${req.query.arch}`);
            }

            // One bean for the whole body: ins_cfg never cleared its variables, so an element
            // that omits an attribute keeps the value the previous element supplied.
            const trx = new CfgTransaction();
            for (const element of this.bodyElements(req)) {
                trx.applyAttrs(element.attrs);
                if (trx.bus_id == null) continue;
                if (toKafka) {
                    await this.produceKafka(req, "sendcfg", trx.toKafkaPayload(), trx.sam_id);
                }
                if (!dbEnabled) continue;
                await this.storeOne(req, trx);
            }
            this.okResponse(res);
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }

    /** The config row and its health reading are one record, so they share one transaction. */
    async storeOne(req, trx) {
        try {
            await this.withTransaction(req.dbConn, async () => {
                await this.cfgDao.merge(req.dbConn, trx, req.sessionId);
                // Java caught a duplicate on the health insert by itself and moved on, keeping
                // the config row it had already committed. Rolling the merge back with it would
                // lose a config change every time one body carries the same device twice, which
                // the attributes-carry-over behaviour makes ordinary.
                try {
                    await this.healthDao.insert(req.dbConn, trx, req.sessionId);
                } catch (error) {
                    if (!isUniqueViolation(error)) throw error;
                }
            });
        } catch (error) {
            // Java answered a duplicate key with `continue`, dropping the element without noise.
            if (isUniqueViolation(error)) return;
            throw error;
        }
    }
}


// ---------------------------------------------------------------- ?func=sendlog

class SendLog extends ValidatorControllerBase {
    constructor() {
        super();
        this.logDao = this.daoFactory.get("TblDeviceLogDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            const dbEnabled = !this.kafkaOnly(req, "sendlog");
            const toKafka = this.kafkaEnabled(req, "sendlog");
            // Java skipped the status call, and the connection with it, on the kafka-only path.
            if (dbEnabled) {
                await this.setValidatorStatus(req, " SendLog ",
                    ` Stationtype :${req.query.stationtype} arch :${req.query.arch}`);
            }

            // The bus id comes from the query string, not the body; LOG carries the host and
            // source, each DATA one entry. Java kept them in the same variables, so do we.
            const trx = new LogTransaction(req.query.busid ?? null);
            for (const element of this.bodyElements(req)) {
                trx.applyAttrs(element.name, element.attrs);
                // The produce runs before the scope guard: Java sent a message for every
                // element in the body, including the LOG one that carries no entry.
                if (toKafka) {
                    await this.produceKafka(req, "sendlog", trx.toKafkaPayload(), trx.bus_id);
                }
                if (!dbEnabled) continue;
                // Java's only guard, and it applied to every element, not just DATA.
                if (trx.scope == null) continue;
                await this.storeOne(req, trx);
            }
            this.okResponse(res);
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }

    /**
     * Java batched the whole body and rolled all of it back when one row failed. The boundary
     * is one record now, so a single rejected entry no longer discards the good ones.
     */
    async storeOne(req, trx) {
        try {
            await this.withTransaction(req.dbConn, () => this.logDao.insert(req.dbConn, trx, req.sessionId));
        } catch (error) {
            if (isUniqueViolation(error)) return;
            throw error;
        }
    }
}


// ---------------------------------------------------------------- ?func=sendcan

const VALUE_TOO_LARGE = 1438;

const CAN_ATTRS = { createdatetime: 'create_date_time', hostname: 'sam_id' };
const MEASURES = ['total_vehicle_distance', 'accelerator_position', 'engine_load', 'instant_fuel_rate',
    'instant_fuel_economy', 'manifold_temperature', 'engine_boost_pressure', 'vehicle_speed',
    'fuel_level', 'battery_voltage', 'engine_temperature', 'engine_oil_level', 'engine_oil_pressure',
    'engine_hour', 'rpm'];

class SendCan extends ValidatorControllerBase {
    constructor() {
        super();
        this.canDao = this.daoFactory.get("AfcCanDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " SendCan ", "");
            await this.store(req);
            this.okResponse(res);
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }

    /**
     * ins_can ended in an empty catch, so anything other than a duplicate key stopped the loop
     * without ever reaching the caller. The endpoint still answers OK; only the log records it.
     */
    async store(req) {
        const data = {};
        try {
            for (const element of this.bodyElements(req)) {
                const name = element.name.toLowerCase();
                if (name === "can") {
                    this.collect(data, element.attrs, CAN_ATTRS);
                } else if (name === "data") {
                    this.collect(data, element.attrs, null);
                    await this.storeOne(req, data);
                }
            }
        } catch (error) {
            this.ULog.error(`sendcan stopped after an error: ${error?.message}`, req.sessionId);
        }
    }

    /** Attribute names are matched case insensitively here, as compareToIgnoreCase did. */
    collect(data, attrs, map) {
        for (const [name, value] of Object.entries(attrs)) {
            const key = name.toLowerCase();
            if (map) {
                if (map[key]) data[map[key]] = value;
            } else if (MEASURES.includes(key)) {
                data[key] = value;
            }
        }
    }

    async storeOne(req, data) {
        try {
            await this.withTransaction(req.dbConn, () => this.canDao.insert(req.dbConn, data, req.sessionId));
        } catch (error) {
            if (isUniqueViolation(error) || error?.errorNum === VALUE_TOO_LARGE) return;
            throw error;
        }
    }
}


// ---------------------------------------------------------------- ?func=sendalarm

const ALARM_ATTRS = {
    bus_id: 'bus_id', date_time: 'alarm_date_time', sam_id: 'sam_id', driver_code: 'driver_code',
    route_code: 'route_code', latitude: 'latitude', longitude: 'longitude',
    button_no: 'alarm_button', description: 'description', trip_no: 'trip_no',
    half_progress_type: 'direction', path_code: 'path_code',
};

// Buttons that need no confirmation message pushed back to the bus.
const SILENT_BUTTONS = new Set(['99', '12', '11', '10']);
// Java's XmlRpcClient had no timeout at all; a stuck bus would hold the request open forever.
const RPC_TIMEOUT_MS = 5000;

class SendAlarm extends ValidatorControllerBase {
    constructor() {
        super();
        this.alarmDao = this.daoFactory.get("AfcAlarmDaoImpl");
        this.messageLogDao = this.daoFactory.get("GuiMessageLogDaoImpl");
        this.pkAppValDao = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " SendAlarm ", "");

            // Only system 107 forwards the device address; everywhere else Java blanked it and
            // the confirmation branch below could never run.
            const ip = String(res.locals.systemId) === "107" ? req.query.remoteipaddr : "";
            const data = {};
            for (const element of this.bodyElements(req)) {
                if (element.name !== "DATA") continue;
                for (const [name, field] of Object.entries(ALARM_ATTRS)) {
                    if (element.attrs[name] !== undefined) data[field] = element.attrs[name];
                }
                if (data.path_code == null) data.path_code = `${data.route_code}${data.direction}`;
                await this.storeOne(req, data, ip);
            }
            this.okResponse(res);
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }

    async storeOne(req, data, ip) {
        try {
            await this.withTransaction(req.dbConn, () => this.alarmDao.insert(req.dbConn, data, req.sessionId));
        } catch (error) {
            if (isUniqueViolation(error)) return;
            throw error;
        }
        try {
            await this.confirm(req, data, ip);
        } catch (error) {
            // Java printed this and moved on: the alarm itself is already stored and that is
            // what matters; the driver simply sees no acknowledgement.
            this.ULog.error(`alarm confirmation failed: ${error?.message}`, req.sessionId);
        }
    }

    async confirm(req, data, ip) {
        // A missing button threw a NullPointerException in Java, which skipped both branches.
        if (data.alarm_button == null) return;

        if (!SILENT_BUTTONS.has(data.alarm_button) && ip && String(ip).length >= 5) {
            await this.pushMessage(req, data, ip);
        }
        if (data.alarm_button === "12") {
            // The message id travels in the description field on this button.
            await this.withTransaction(req.dbConn, () => this.messageLogDao.markReadByAlarm(req.dbConn,
                { reader_id: data.driver_code, message_id: data.description }, req.sessionId));
        }
    }

    async pushMessage(req, data, ip) {
        const { message, messageId } = await this.pkAppValDao.alarmTakeConfirmation(req.dbConn,
            { alarmbutton: data.alarm_button }, req.sessionId);
        if (!(messageId > 0)) return;

        const content = `ID:${messageId}${message}`;
        const result = await XmlRpc.call(`http://${ip}:8080/RPC2`, "Option.Display_message",
            [XmlRpc.stringToHex(content), data.bus_id, "107"], RPC_TIMEOUT_MS, req.sessionId);

        await this.withTransaction(req.dbConn, () => this.pkAppValDao.alarmMessageLog(req.dbConn,
            { busid: data.bus_id, messageid: String(messageId), message, result: String(result) }, req.sessionId));
    }
}


// ---------------------------------------------------------------- ?func=wlanstatus

const WLAN_ATTRS = {
    bus_id: 'busid', sam_id: 'samid', gprs_ip: 'gprsip', wlan_ip: 'wlanip', wlan_status: 'wlanstatus',
};

class WlanStatus extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " wlanstatus ", "");

            // Bind names double as the attribute map; Java kept the values across elements.
            const binds = { busid: null, samid: null, gprsip: null, wlanip: null, wlanstatus: null };
            for (const element of this.bodyElements(req)) {
                if (element.name !== "WLAN") continue;
                for (const [name, bind] of Object.entries(WLAN_ATTRS)) {
                    if (element.attrs[name] !== undefined) binds[bind] = element.attrs[name];
                }
                try {
                    await this.withTransaction(req.dbConn,
                        () => this.daoImpl.setDeviceWlanStatus(req.dbConn, { ...binds }, req.sessionId));
                } catch (error) {
                    if (!isUniqueViolation(error)) throw error;
                }
            }
            this.okResponse(res);
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


// ---------------------------------------------------------------- ?func=getvalcfg

class GetValCfg extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " GetValCfg ",
                ` samid:${req.query.samid} busid:${req.query.busid}`);

            const data = await this.daoImpl.getValidatorCfg(req.dbConn, {
                busid: req.query.busid ?? null,
                samid: req.query.samid ?? null,
            }, req.sessionId);

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = data;
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


// ---------------------------------------------------------------- ?func=getvalidatorlist

class GetValidatorList extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
        // Java replaced the database failure with this text before it reached the
        // device; the ORA code only goes to the log.
        this.dbErrorMessage = "Database error occurred";
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getValidatorList ");

            const data = await this.daoImpl.getValidatorList(req.dbConn, {
                busid: req.query.busid ?? null,
            }, req.sessionId);

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = data;
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


// ---------------------------------------------------------------- ?func=getfile

class GetFile extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
        // Java replaced the database failure with this text before it reached the
        // device; the ORA code only goes to the log.
        this.dbErrorMessage = "Database error occurred";
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " GetFile  ",
                ` fileid:${req.query.busid} fileversion:${req.query.filever}`);

            const data = await this.daoImpl.getCfgFile(req.dbConn, {
                busid: req.query.busid ?? null,
                filever: req.query.filever ?? null,
                fileid: req.query.fileid ?? null,
            }, req.sessionId);

            res.setHeader("Content-Type",
                String(data.lobType).toLowerCase() === "blob" ? "application/octet-stream" : "text/xml");
            res.locals.data = data.content;
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


// ---------------------------------------------------------------- ?func=getfiles

class GetFiles extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " GetFileS  ",
                ` busid:${req.query.busid} fileid:${req.query.fileid} type:${req.query.type}`);

            const data = await this.daoImpl.getFileFromPath(req.dbConn, {
                busid: req.query.busid ?? null,
                fileid: req.query.fileid ?? null,
                type: req.query.type ?? null,
            }, req.sessionId);

            res.setHeader("Content-Type",
                String(data.lobType).toLowerCase() === "blob" ? "application/octet-stream" : "text/xml");
            res.locals.data = data.content;
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


module.exports = {
    funcs: {
        sendcfg: new SendCfg(),
        sendlog: new SendLog(),
        sendcan: new SendCan(),
        sendalarm: new SendAlarm(),
        wlanstatus: new WlanStatus(),
        getvalcfg: new GetValCfg(),
        getvalidatorlist: new GetValidatorList(),
        getfile: new GetFile(),
        getfiles: new GetFiles(),
    },
};
