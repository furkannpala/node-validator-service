const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class GetReportInterval extends ValidatorControllerBase {
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
            await this.setValidatorStatus(req, " GetReportInterval ",
                ` pdate:${req.query.pDate} pdate2:${req.query.pDate2}`);

            const data = await this.daoImpl.tdReportInterval(req.dbConn, {
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

module.exports = new GetReportInterval();
