const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class GetTripType extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " GetTripType  ",
                ` busid:${req.query.busid}`);

            const data = await this.daoImpl.getTripType(req.dbConn, {
                busid: req.query.busid ?? null,
            }, req.sessionId);

            if (data == null) throw new this.ServiceError(-97, "error");

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = data;
        } catch (error) {
            respErr = this.getServiceError(error);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new GetTripType();
