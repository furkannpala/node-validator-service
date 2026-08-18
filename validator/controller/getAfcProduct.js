const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class GetAfcProduct extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getAfcProduct ",
                ` samid:${req.query.samid} busid:${req.query.busid}`);

            const data = await this.daoImpl.getAfcProduct(req.dbConn, {
                busid: req.query.busid ?? null,
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

module.exports = new GetAfcProduct();
