const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class GetRouteCoordinate extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getRouteCoordinate ",
                ` routecode:${req.query.routecode} version:${req.query.version}`);

            const data = await this.daoImpl.getRouteCoordinate(req.dbConn, {
                routecode: req.query.routecode ?? null,
                version: req.query.version ?? null,
            }, req.sessionId);

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = data;
        } catch (error) {
            respErr = this.getServiceError(error);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new GetRouteCoordinate();
