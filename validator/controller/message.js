/**
 * Messages sent to the driver and the acknowledgement that comes back.
 *
 * The keys of the funcs table at the bottom are the ?func= values this file answers;
 * validator/index.js registers them straight from there.
 */
const { ValidatorControllerBase } = require("../ValidatorControllerBase");


// ---------------------------------------------------------------- ?func=getmessageinfo

class GetMessageInfo extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " GetMesageInfo ");

            const data = await this.daoImpl.getMessageInfo(req.dbConn, {
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


// ---------------------------------------------------------------- ?func=readmessage

// Stamps the read time on a message the driver acknowledged. Takes no body.
class ReadMessage extends ValidatorControllerBase {
    constructor() {
        super();
        this.messageLogDao = this.daoFactory.get("GuiMessageLogDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            const busId = req.query.busid ?? null;
            const messageId = req.query.messageid ?? null;
            await this.setValidatorStatus(req, "readmessage  ",
                ` busid:${busId} messageid:${messageId}`);

            await this.withTransaction(req.dbConn, () => this.messageLogDao.markReadByBus(req.dbConn,
                { bus_id: busId, message_id: messageId }, req.sessionId));

            this.okResponse(res);
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


module.exports = {
    funcs: {
        getmessageinfo: new GetMessageInfo(),
        readmessage: new ReadMessage(),
    },
};
