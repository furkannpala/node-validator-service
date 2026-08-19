const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class GetDriverPlan extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkRepDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getDriverPlan ",
                ` samid:${req.query.samid} busid:${req.query.busid}`);

            const data = await this.daoImpl.driverPlan(req.dbConn, {
                driverid: req.query.driverid ?? null,
                lang: req.query.lang ?? null,
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

module.exports = new GetDriverPlan();
