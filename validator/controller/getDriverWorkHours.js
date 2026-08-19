const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class GetDriverWorkHours extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
        // Java replaced the database failure with this text before it reached the
        // device; the ORA code only goes to the log.
        this.dbErrorMessage = "Error occurred while fetching driver work hours";
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getdriverworkhours ",
                ` aliasno:${req.query.aliasno} busid:${req.query.busid} driver:${req.query.driverid}`);

            const data = await this.daoImpl.getDriverWorkHours(req.dbConn, {
                busid: req.query.busid ?? null,
                driverid: req.query.driverid ?? null,
                aliasno: req.query.aliasno ?? null,
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

module.exports = new GetDriverWorkHours();
