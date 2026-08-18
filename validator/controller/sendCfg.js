const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const CfgTransaction = require("../../bean/CfgTransaction");
const { isUniqueViolation } = require("../dao/daoUtil");

class SendCfg extends ValidatorControllerBase {
    constructor() {
        super();
        this.cfgDao = this.daoFactory.get("TblDeviceCfgDaoImpl");
        this.healthDao = this.daoFactory.get("TblDeviceHealthDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            // Java skipped the status call and the connection entirely on the kafka-only path.
            if (this.cfgBool(req, "sendcfg_use_only_kafka_produce", false)) {
                this.okResponse(res);
                return;
            }
            await this.setValidatorStatus(req, " SendCfg ",
                ` Stationtype :${req.query.stationtype} arch :${req.query.arch}`);

            // One bean for the whole body: ins_cfg never cleared its variables, so an element
            // that omits an attribute keeps the value the previous element supplied.
            const trx = new CfgTransaction();
            for (const element of this.bodyElements(req)) {
                trx.applyAttrs(element.attrs);
                if (trx.bus_id == null) continue;
                await this.storeOne(req, trx);
            }
            this.okResponse(res);
        } catch (error) {
            respErr = this.getServiceError(error);
        } finally {
            next(respErr);
        }
    }

    /** The config row and its health reading are one record, so they share one transaction. */
    async storeOne(req, trx) {
        try {
            await this.withTransaction(req.dbConn, async () => {
                await this.cfgDao.merge(req.dbConn, trx, req.sessionId);
                await this.healthDao.insert(req.dbConn, trx, req.sessionId);
            });
        } catch (error) {
            // Java answered a duplicate key with `continue`, dropping the element without noise.
            if (isUniqueViolation(error)) return;
            throw error;
        }
    }
}

module.exports = new SendCfg();
