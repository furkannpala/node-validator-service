const StringUtil = require("../util/StringUtil");
const EccDsaVerify = require("../util/EccDsaVerify");
const daoFactory = require("../validator/daoFactory/DaoFactory");

// Only this system signs its ticket records; everywhere else they are trusted as sent.
const SIGNED_SYSTEM = '112';
// Where a zero passenger count is left at zero instead of being raised to one.
const ZERO_COUNT_SYSTEM = '004';
const ZERO_COUNT_FLAGS = new Set(['9', '6']);
// Systems that stamp the card's own system id onto the row.
const ORIGIN_SYSTEM_IDS = new Set(['029', '020']);
// A cancellation: the count and the amount are stored negative.
const CANCEL_FLAG = '4';
// These two flags mean the card was blacklisted, so the row goes to the blacklist table.
const BLACKLIST_FLAGS = new Set(['2', '0']);
// What AFC_TD.TRANSFER_REF_CODE holds for a credit card row still waiting to be priced.
const TRANSFER_REF_SYNC = 'sync';

/**
 * A D record is one ticket. Which table it lands in depends on the card type, the transaction
 * flag and whether the signature checked out; ins_data had all four branches inline.
 */
class DRecordStrategy {
    constructor() {
        this.afcTd = daoFactory.get("AfcTdDaoImpl");
        this.afcTdTest = daoFactory.get("AfcTdTestDaoImpl");
        this.afcBlTd = daoFactory.get("AfcBlTdDaoImpl");
        this.afcTdNonverified = daoFactory.get("AfcTdNonverifiedDaoImpl");
        this.afcTf = daoFactory.get("AfcTfDaoImpl");
        this.mstBus = daoFactory.get("MstBusDaoImpl");
        this.afcTdEmv = daoFactory.get("AfcTdEmvDaoImpl");
        this.tblRfcard = daoFactory.get("TblRfcardDaoImpl");
    }

    async processTransaction(conn, trx, cfg, sessionId) {
        await this.ensureTrip(conn, trx, sessionId);
        this.normalize(trx, cfg);
        const verified = this.isVerified(trx, cfg, sessionId);

        if (this.isTestCard(trx, cfg)) {
            return this.afcTdTest.insert(conn, trx, this.options(trx, cfg, false), sessionId);
        }
        if (BLACKLIST_FLAGS.has(this.flag(trx))) {
            return this.afcBlTd.insert(conn, trx, this.options(trx, cfg, false), sessionId);
        }

        // Card payment data only ever reaches the plain ticket branch: Java wrote AFC_TD_EMV
        // and set transfer_ref_code here, after the test and blacklist tables were ruled out.
        await this.storeEmv(conn, trx, cfg, sessionId);
        trx.transfer_ref_code = this.transferRefCode(trx, cfg);

        if (!verified) {
            return this.afcTdNonverified.insert(conn, trx, {}, sessionId);
        }
        // only_tap records are counted but never stored as a ticket. The CSN still goes back,
        // because Java kept that write outside the only_tap guard.
        if (String(trx.only_tap) !== '1') {
            await this.afcTd.insert(conn, trx, this.options(trx, cfg, true), sessionId);
        }
        return await this.storeCsn(conn, trx, sessionId);
    }

    /** The EMV child of the record, if the device sent one; the ptcn is what marks it present. */
    async storeEmv(conn, trx, cfg, sessionId) {
        if (StringUtil.isNullOrEmpty(trx.ptcn)) return;
        // Java defaulted a bad amount to zero and stored the row anyway.
        const amount = StringUtil.tryParseDouble(trx.emv_amount, 0) / cfg.currencyMultiplier;
        await this.afcTdEmv.insert(conn, trx, amount, sessionId);
    }

    /**
     * Marks a credit card row for the fare sync that runs later. key_index 1 means the device
     * already calculated the fare itself, so those rows are left for nobody to pick up.
     */
    transferRefCode(trx, cfg) {
        const type = String(trx.card_no ?? '').substring(5, 7);
        const isCredit = (cfg.creditCardTypes || []).includes(type);
        const calculatedOnDevice = String(trx.key_index ?? '').toLowerCase() === '1';
        return isCredit && !calculatedOnDevice && !StringUtil.isNullOrEmpty(trx.ptcn)
            ? TRANSFER_REF_SYNC : null;
    }

    /** The device reports the chip serial it read; the card row is kept up to date with it. */
    async storeCsn(conn, trx, sessionId) {
        if (StringUtil.isNullOrEmpty(trx.csn) || StringUtil.isNullOrEmpty(trx.card_no)) return 0;
        return await this.tblRfcard.updateCsn(conn, trx.card_no, trx.csn, sessionId);
    }

    /**
     * A ticket's tf_id points at a trip row. Tickets can reach the service before the record
     * that opens the trip, so Java created a placeholder trip with travel type 0 rather than
     * leaving the ticket pointing at nothing.
     */
    async ensureTrip(conn, trx, sessionId) {
        if (await this.afcTf.checkRecord(conn, trx, sessionId)) return;

        const row = await this.mstBus.findComp(conn, trx.bus_id, trx.start_date_time, sessionId);
        if (!row) return;
        trx.compCode = Number(row.COMP_CODE);
        trx.depot_code = row.DEPOT_CODE;
        trx.travelType = '0';
        await this.afcTf.insert(conn, trx, sessionId);
    }

    /**
     * Amounts arrive as integers in the smallest currency unit and are divided by the system's
     * multiplier. Java parsed them unguarded, so a missing amount fails the record.
     */
    normalize(trx, cfg) {
        const multiplier = cfg.currencyMultiplier;
        // fn_get_tf_id's third argument. The bus path always passes 1; only the station
        // strategy of ins_station ever passes 2.
        trx.tfType = '1';
        trx.usageAmt = StringUtil.parseIntStrict(trx.usage_amt) / multiplier;
        trx.remainedAmt = StringUtil.parseIntStrict(trx.remained_amt) / multiplier;
        trx.extendedFare = StringUtil.parseIntStrict(trx.extended_fare) / multiplier;
        trx.serviceChargeAmt = trx.service_charge / multiplier;

        // A negative or zero previous balance is stored as zero, not divided.
        const oldAmt = StringUtil.parseIntStrict(trx.old_amt);
        trx.oldAmt = oldAmt > 0 ? oldAmt / multiplier : 0;

        trx.customerCnt = this.customerCount(trx, cfg);
        if (this.flag(trx) === CANCEL_FLAG) {
            if (trx.customerCnt > 0) trx.customerCnt *= -1;
            if (trx.usageAmt > 0) trx.usageAmt *= -1;
        }

        trx.originSystemId = ORIGIN_SYSTEM_IDS.has(String(cfg.systemId))
            ? String(trx.card_no).substring(0, 3) : null;
    }

    /** An absent passenger count means one passenger, except on the one system that says zero. */
    customerCount(trx, cfg) {
        const count = StringUtil.parseIntStrict(trx.customer_cnt);
        if (count !== 0) return count;
        const staysZero = String(cfg.systemId) === ZERO_COUNT_SYSTEM
            && ZERO_COUNT_FLAGS.has(this.flag(trx));
        return staysZero ? 0 : 1;
    }

    isVerified(trx, cfg, sessionId) {
        if (String(cfg.systemId) !== SIGNED_SYSTEM) return true;
        const input = EccDsaVerify.buildInput(trx, StringUtil.lpadZero);
        return EccDsaVerify.verify(trx.tc_code, input, sessionId) !== 0;
    }

    /** Two characters inside the card number identify the card type. */
    isTestCard(trx, cfg) {
        const type = String(trx.card_no ?? '').substring(5, 7);
        return (cfg.cardTypeCheckList || []).includes(type);
    }

    flag(trx) {
        return String(trx.trans_flag ?? '').charAt(0);
    }

    /** Which optional columns the chosen insert variant carries; isMainTable means AFC_TD. */
    options(trx, cfg, isMainTable) {
        return {
            extendedFare: !!cfg.saveExtendedFare,
            qrData: !StringUtil.isNullOrEmpty(trx.qr_data),
            originSystemId: isMainTable && trx.originSystemId != null,
        };
    }
}

module.exports = DRecordStrategy;
