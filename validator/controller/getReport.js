const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class GetReport extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " GetReport ",
                ` pdate:${req.query.pDate} pdate2:${req.query.pDate2}`);

            const data = await this.daoImpl.getTdPdate(req.dbConn, {
                busid: req.query.busid ?? null,
                pdate: req.query.pDate ?? null,
                pdate2: req.query.pDate2 ?? req.query.pDate ?? null,
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

module.exports = new GetReport();
