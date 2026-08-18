const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class GetBusInfo extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " GetBusInfo ",
                `OldBusid:${req.query.oldbusid}Validatorid:${req.query.validatorid}Datetime:${req.query.datetime}Samid:${req.query.samid}Seqno:${req.query.seqno}`);

            const data = await this.daoImpl.getDeviceInfo(req.dbConn, {
                busid: req.query.busid ?? null,
                samid: req.query.samid ?? null,
                validatorid: req.query.validatorid ?? null,
                datetime: req.query.datetime ?? null,
                oldbusid: req.query.oldbusid ?? null,
                seqno: req.query.seqno ?? null,
            }, req.sessionId);

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = data;
        } catch (error) {
            respErr = this.getServiceError(error);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new GetBusInfo();
