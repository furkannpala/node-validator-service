const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const XmlRpc = require("../../util/XmlRpc");
const { isUniqueViolation } = require("../dao/daoUtil");

const ATTRS = {
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
                for (const [name, field] of Object.entries(ATTRS)) {
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

module.exports = new SendAlarm();
