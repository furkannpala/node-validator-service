const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class GetSchedulePlan extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " GetSchedulePlan  ",
                ` busid:${req.query.busid}`);

            const data = await this.daoImpl.getSchedulePlan(req.dbConn, {
                busid: req.query.busid ?? null,
                version: req.query.version ?? null,
                opdate: req.query.opdate ?? null,
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

module.exports = new GetSchedulePlan();
