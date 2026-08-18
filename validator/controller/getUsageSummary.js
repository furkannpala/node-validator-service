const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class GetUsageSummary extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("VvsSummaryDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getUsageSummary ",
                ` samid:${req.query.samid} busid:${req.query.busid}`);

            const data = await this.daoImpl.vvsSummary(req.dbConn, {
                pdate: req.query.pdate ?? null,
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

module.exports = new GetUsageSummary();
