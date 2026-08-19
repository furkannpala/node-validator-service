const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class GetCardDetail extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkCardActionDaoImpl");
        // Java replaced the database failure with this text before it reached the
        // device; the ORA code only goes to the log.
        this.dbErrorMessage = "Failed to fetch card detail";
        // This one caught every exception, not just the SQL ones.
        this.dbErrorScope = "all";
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getcarddetail ",
                ` aliasno:${req.query.aliasno} counter:${req.query.counter}`);

            const data = await this.daoImpl.getCardAction(req.dbConn, {
                aliasno: req.query.aliasno ?? null,
                counter: req.query.counter ?? null,
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

module.exports = new GetCardDetail();
