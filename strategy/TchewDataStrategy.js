const StringUtil = require("../util/StringUtil");
const daoFactory = require("../validator/daoFactory/DaoFactory");
const { ULog } = require("../../../lib/utils");

const BLACKLIST_FLAGS = new Set(['2', '0']);
const CANCEL_FLAG = '4';
// A load onto the card rather than a fare, which this branch files in its own table.
const TOPUP_FLAG = '7';

/**
 * ins_data_tchew: the oldest branch still in service, reached only by system 106 when the bus
 * belongs to a company other than 1. It writes the same tables as the bus path but through
 * positional inserts, so it gets its own DAO rather than the column builder.
 */
class TchewDataStrategy {
    constructor() {
        this.dao = daoFactory.get("TchewTdDaoImpl");
    }

    async processTransaction(conn, trx, cfg, sessionId) {
        if (trx.getRecordType() !== 'D') {
            // This branch's F handling writes the trip tables with the same statements the bus
            // path uses; only the ticket inserts are positional, so only they live here.
            ULog.debug(`tchew: record ${trx.record_id} is not a D record, skipped`, sessionId);
            return 0;
        }
        this.normalize(trx, cfg);

        if (this.isTestCard(trx, cfg)) return this.dao.insertTestTd(conn, trx, sessionId);
        if (BLACKLIST_FLAGS.has(this.flag(trx))) return this.dao.insertBlTd(conn, trx, sessionId);
        if (this.flag(trx) === TOPUP_FLAG) return this.dao.insertTopup(conn, trx, sessionId);
        if (cfg.saveExtendedFare) return this.dao.insertTdExtendedFare(conn, trx, sessionId);
        return this.dao.insertTd(conn, trx, sessionId);
    }

    /** The same arithmetic as the bus path; only the passenger count rule is simpler here. */
    normalize(trx, cfg) {
        const multiplier = cfg.currencyMultiplier;
        trx.usageAmt = StringUtil.parseIntStrict(trx.usage_amt) / multiplier;
        trx.remainedAmt = StringUtil.parseIntStrict(trx.remained_amt) / multiplier;
        trx.extendedFare = StringUtil.parseIntStrict(trx.extended_fare) / multiplier;

        const oldAmt = StringUtil.parseIntStrict(trx.old_amt);
        trx.oldAmt = oldAmt > 0 ? oldAmt / multiplier : 0;

        // An absent count means one passenger. This branch has no system 004 exception, and
        // it parses unguarded, so a record that never carried a count fails the request.
        trx.customerCnt = StringUtil.parseIntStrict(trx.customer_cnt);
        if (trx.customerCnt === 0) trx.customerCnt = 1;
        if (this.flag(trx) === CANCEL_FLAG) {
            if (trx.customerCnt > 0) trx.customerCnt *= -1;
            if (trx.usageAmt > 0) trx.usageAmt *= -1;
        }
    }

    isTestCard(trx, cfg) {
        const type = String(trx.card_no ?? '').substring(5, 7);
        return (cfg.cardTypeCheckList || []).includes(type);
    }

    flag(trx) {
        return String(trx.trans_flag ?? '').charAt(0);
    }
}

module.exports = TchewDataStrategy;
