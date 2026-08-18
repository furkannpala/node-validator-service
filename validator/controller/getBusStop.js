const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class GetBusStop extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getbusstop ",
                ` version:${req.query.version}`);

            const data = await this.daoImpl.createBusStop(req.dbConn, {
                version: req.query.version ?? null,
                samid: req.query.samid ?? null,
            }, req.sessionId);

            if (data == null) throw new this.ServiceError(-99, "error");

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = data;
        } catch (error) {
            respErr = this.getServiceError(error);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new GetBusStop();
