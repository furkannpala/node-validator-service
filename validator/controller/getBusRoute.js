const { ValidatorControllerBase } = require("../ValidatorControllerBase");

// The only read endpoint that answers with a plain OK instead of a payload: the procedure
// returns a route count and Java only used it as a validity check.
class GetBusRoute extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getbusroute ", ` routecode:${req.query.routecode}`);

            const routeCnt = await this.daoImpl.getBusRouteList(req.dbConn, {
                busid: req.query.busid ?? null,
                routecode: req.query.routecode ?? null,
            }, req.sessionId);

            if (!(routeCnt > 0)) throw new Error("Route count is less than or equal to zero.");

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = this.getXmlResponse(0, "");
        } catch (error) {
            respErr = this.getServiceError(error);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new GetBusRoute();
