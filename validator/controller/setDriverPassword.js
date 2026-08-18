const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class SetDriverPassword extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            // The action string says GetoOlineSchedule; it is wrong but it is what val_status
            // has recorded for years, and reports group on it.
            await this.setValidatorStatus(req, "GetoOlineSchedule  ",
                ` busid:${req.query.busid} driver:${req.query.driverid} pass:${req.query.pass}`);

            const retval = await this.withTransaction(req.dbConn, () => this.daoImpl.setDriverPassword(req.dbConn, {
                busid: req.query.busid ?? null,
                driverid: req.query.driverid ?? null,
                pass: req.query.pass ?? null,
            }, req.sessionId));

            if (retval !== 0) throw new Error(" Error Code " + retval);

            this.okResponse(res);
        } catch (error) {
            respErr = this.getServiceError(error);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new SetDriverPassword();
