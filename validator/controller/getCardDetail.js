const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class GetCardDetail extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkCardActionDaoImpl");
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
            respErr = this.getServiceError(error);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new GetCardDetail();
