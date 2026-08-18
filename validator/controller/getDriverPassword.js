const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class GetDriverPassword extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, "GetoOlineSchedule  ",
                ` busid:${req.query.busid} driver:${req.query.driverid}`);

            const data = await this.daoImpl.getDriverPassword(req.dbConn, {
                busid: req.query.busid ?? null,
                driverid: req.query.driverid ?? null,
            }, req.sessionId);

            if (data == null) throw new this.ServiceError(-97, "error");

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = data;
        } catch (error) {
            respErr = this.getServiceError(error);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new GetDriverPassword();
