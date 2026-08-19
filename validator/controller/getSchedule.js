const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class GetSchedule extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " GetSchedule ",
                ` driver_id:${req.query.driverid}`);

            const data = await this.daoImpl.createSchedule(req.dbConn, {
                busid: req.query.busid ?? null,
                driverid: req.query.driverid ?? null,
                routecode: req.query.routecode ?? null,
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

module.exports = new GetSchedule();
