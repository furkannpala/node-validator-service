const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const LogTransaction = require("../../bean/LogTransaction");
const { isUniqueViolation } = require("../dao/daoUtil");

class SendLog extends ValidatorControllerBase {
    constructor() {
        super();
        this.logDao = this.daoFactory.get("TblDeviceLogDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            const dbEnabled = !this.kafkaOnly(req, "sendlog");
            const toKafka = this.kafkaEnabled(req, "sendlog");
            // Java skipped the status call, and the connection with it, on the kafka-only path.
            if (dbEnabled) {
                await this.setValidatorStatus(req, " SendLog ",
                    ` Stationtype :${req.query.stationtype} arch :${req.query.arch}`);
            }

            // The bus id comes from the query string, not the body; LOG carries the host and
            // source, each DATA one entry. Java kept them in the same variables, so do we.
            const trx = new LogTransaction(req.query.busid ?? null);
            for (const element of this.bodyElements(req)) {
                trx.applyAttrs(element.name, element.attrs);
                // The produce runs before the scope guard: Java sent a message for every
                // element in the body, including the LOG one that carries no entry.
                if (toKafka) {
                    await this.produceKafka(req, "sendlog", trx.toKafkaPayload(), trx.bus_id,
                        "Kafka Error: ");
                }
                if (!dbEnabled) continue;
                // Java's only guard, and it applied to every element, not just DATA.
                if (trx.scope == null) continue;
                await this.storeOne(req, trx);
            }
            this.okResponse(res);
        } catch (error) {
            respErr = this.getServiceError(error);
        } finally {
            next(respErr);
        }
    }

    /**
     * Java batched the whole body and rolled all of it back when one row failed. The boundary
     * is one record now, so a single rejected entry no longer discards the good ones.
     */
    async storeOne(req, trx) {
        try {
            await this.withTransaction(req.dbConn, () => this.logDao.insert(req.dbConn, trx, req.sessionId));
        } catch (error) {
            if (isUniqueViolation(error)) return;
            throw error;
        }
    }
}

module.exports = new SendLog();
