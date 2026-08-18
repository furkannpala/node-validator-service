const { ValidatorControllerBase } = require("../ValidatorControllerBase");

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
            respErr = this.getServiceError(error);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new ReadMessage();
