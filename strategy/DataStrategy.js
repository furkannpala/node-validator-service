const StringUtil = require("../util/StringUtil");
const Constant = require("../constant/Constant");
const FRecordStrategy = require("./FRecordStrategy");
const DRecordStrategy = require("./DRecordStrategy");
const daoFactory = require("../validator/daoFactory/DaoFactory");
const { ULog } = require("../../../lib/utils");

/**
 * ins_data: the bus path of senddata. Each record announces its kind in the first character of
 * record_id — F for the trip, D for a ticket. Anything else falls through to the blacklist
 * table, which is where Java put records it could not classify.
 */
class DataStrategy {
    constructor() {
        this.fRecord = new FRecordStrategy();
        this.dRecord = new DRecordStrategy();
        this.afcBlTd = daoFactory.get("AfcBlTdDaoImpl");
    }

    async processTransaction(conn, trx, cfg, sessionId) {
        const type = trx.getRecordType();

        if (type === 'F' && Constant.BUS_STATION_TYPES.has(String(trx.station_type))) {
            return this.fRecord.processTransaction(conn, trx, cfg, sessionId);
        }
        if (type === 'D') {
            return this.dRecord.processTransaction(conn, trx, cfg, sessionId);
        }
        return this.processOther(conn, trx, cfg, sessionId);
    }

    /**
     * Not a D and not an F. Java logged it and still stored it in afc_bl_td, with its own
     * amount handling: the passenger count is taken as sent and never raised to one.
     */
    async processOther(conn, trx, cfg, sessionId) {
        ULog.debug(`record_id is not D or F, stored as blacklist: ${trx.record_id}`, sessionId);
        const multiplier = cfg.currencyMultiplier;

        trx.usageAmt = StringUtil.parseIntStrict(trx.usage_amt) / multiplier;
        trx.remainedAmt = StringUtil.parseIntStrict(trx.remained_amt) / multiplier;
        trx.extendedFare = StringUtil.parseIntStrict(trx.extended_fare) / multiplier;

        const oldAmt = StringUtil.parseIntStrict(trx.old_amt);
        trx.oldAmt = oldAmt > 0 ? oldAmt / multiplier : 0;

        // Guarded here, unlike the D path, where a missing count fails the record.
        trx.customerCnt = StringUtil.isNullOrEmpty(trx.customer_cnt)
            ? 0 : StringUtil.parseIntStrict(trx.customer_cnt);
        trx.tfType = '1';
        // Java left service_charge_amt holding whatever the previous D record computed. That
        // is a leak with no meaning, so this path recomputes it from its own record.
        trx.serviceChargeAmt = trx.service_charge / multiplier;

        return this.afcBlTd.insert(conn, trx, {
            extendedFare: !!cfg.saveExtendedFare,
            qrData: !StringUtil.isNullOrEmpty(trx.qr_data),
        }, sessionId);
    }
}

module.exports = DataStrategy;
