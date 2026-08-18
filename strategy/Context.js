const { ULog } = require("../../../lib/utils");

/**
 * senddata picks one strategy per request and runs it for every record in the body. The
 * strategy object is stateless, so one instance is shared by all requests.
 */
class Context {
    constructor(strategy) {
        this.strategy = strategy;
    }

    async execute(conn, trx, cfg, sessionId) {
        if (!this.strategy) return;
        try {
            await this.strategy.processTransaction(conn, trx, cfg, sessionId);
        } catch (e) {
            ULog.error(`error processing transaction record_id=${trx?.record_id} `
                + `sam_id=${trx?.sam_id}: ${e?.stack || e?.message}`, sessionId);
            throw e;
        }
    }
}

module.exports = Context;
