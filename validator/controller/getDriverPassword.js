const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class GetDriverPassword extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
        // Java replaced the database failure with this text before it reached the
        // device; the ORA code only goes to the log.
        this.dbErrorMessage = "Failed to fetch driver password";
        // This one caught every exception, not just the SQL ones.
        this.dbErrorScope = "all";
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
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new GetDriverPassword();
