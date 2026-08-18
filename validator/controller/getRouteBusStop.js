const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class GetRouteBusStop extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getroutebusstop ",
                ` version:${req.query.version} groupid:${req.query.groupid}`);

            const data = await this.daoImpl.createRouteBusStop(req.dbConn, {
                version: req.query.version ?? null,
                groupid: Number.parseInt(req.query.groupid, 10),
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

module.exports = new GetRouteBusStop();
