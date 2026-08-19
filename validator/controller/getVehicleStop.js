const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class GetVehicleStop extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
        // Java replaced the database failure with this text before it reached the
        // device; the ORA code only goes to the log.
        this.dbErrorMessage = "Database error occurred";
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " GetVehicleStop  ",
                ` busid:${req.query.busid} version:${req.query.version}`);

            const data = await this.daoImpl.getBusStop(req.dbConn, {
                version: req.query.version ?? null,
                busid: req.query.busid ?? null,
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

module.exports = new GetVehicleStop();
