const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const Keystore = require("../../constant/Keystore");

/**
 * Two different sources behind one endpoint: ?enc=1 reads the prepared binary card list,
 * anything else builds the recharge XML through a procedure whose arity is a per-system fact.
 */
class GetOfflineCardList extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
        this.rechargeDaoImpl = this.daoFactory.get("OfflineRechargeDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, "getOfflineCardList",
                ` version:${req.query.version} enc:${req.query.enc} samid:${req.query.samid}`);

            const isBlob = Keystore.BLOB === String(req.query.enc);
            const data = await this.read(req, isBlob);
            if (data == null || data.length < 1) throw new this.ServiceError(-99, "error");

            res.setHeader("Content-Type", isBlob ? "application/octet-stream" : "text/xml");
            res.locals.data = data;
        } catch (error) {
            respErr = this.getServiceError(error);
        } finally {
            next(respErr);
        }
    }

    async read(req, isBlob) {
        if (isBlob) {
            return await this.daoImpl.getCardListBlob(req.dbConn, {
                samid: req.query.samid ?? null,
                version: req.query.version ?? null,
            }, req.sessionId);
        }

        return await this.rechargeDaoImpl.createXml(req.dbConn, {
            systemid: req.query.systemid ?? null,
            version: req.query.version ?? null,
            provno: req.query.provno ?? null,
        }, this.cfgBool(req, "sp_create_offline_recharge_xml_includes_provno", true), req.sessionId);
    }
}

module.exports = new GetOfflineCardList();
