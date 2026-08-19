const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class GetDutySchedule extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " GetDutySchedule  ",
                ` busid:${req.query.busid} version:${req.query.version}`);

            const data = await this.daoImpl.getDutySchedule(req.dbConn, {
                version: req.query.version ?? null,
                busid: req.query.busid ?? null,
                showtime: req.query.timeunit ?? "0",
                opdate: req.query.opdate ?? null,
            }, req.sessionId);

            if (data == null) throw new this.ServiceError(-97, "error");

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = data;
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new GetDutySchedule();
