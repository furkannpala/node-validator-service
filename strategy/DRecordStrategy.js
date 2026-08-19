const StringUtil = require("../util/StringUtil");
const EccDsaVerify = require("../util/EccDsaVerify");
const daoFactory = require("../validator/daoFactory/DaoFactory");
const Constant = require("../constant/Constant");
const { ErrorManagement, ErrorCodes } = require("../constant/ErrorManagement");

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
        this.pkConfig = daoFactory.get("PkConfigDaoImpl");
        this.Constant = Constant;
        this.ErrorManagement = ErrorManagement;
        this.ErrorCodes = ErrorCodes;
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
            await this.afcTdNonverified.insert(conn, trx, {}, sessionId);
        } else {
            // only_tap records are counted but never stored as a ticket. The CSN still goes
            // back, because Java kept that write outside the only_tap guard.
            if (String(trx.only_tap) !== '1') {
                await this.afcTd.insert(conn, trx, this.options(trx, cfg, true), sessionId);
            }
            await this.storeCsn(conn, trx, sessionId);
        }
        // Java gathered the usage after both branches, so an unverified ticket is sent too.
        return await this.collectEmvUsage(conn, trx, cfg, sessionId);
    }

    /**
     * A credit card ticket is also reported to the payment gateway, in one batch per body.
     * key_index 1 means the device priced the ride itself, so only the rest are reported —
     * unless the service is running as a test system, where every one of them is.
     */
    async collectEmvUsage(conn, trx, cfg, sessionId) {
        if (!cfg.emvUsages) return 0;
        const type = String(trx.card_no ?? '').substring(5, 7);
        if (!(cfg.creditCardTypes || []).includes(type)) return 0;

        const keyIndex = String(trx.key_index ?? '');
        const isTestEnvironment = String(cfg.serverEnvironment).toLowerCase() === this.Constant.TEST;
        if (!isTestEnvironment && (keyIndex.toLowerCase() === '1' || keyIndex === '')) return 0;

        if (StringUtil.isNullOrEmpty(trx.ptcn)) {
            this.ErrorManagement.throw(this.ErrorCodes.EMV_TAG_MISSING,
                `${trx.card_no} ,boarding_date_time=${trx.boarding_date_time}`);
        }
        // The raw attribute plus the parsed service charge; neither is divided by the multiplier.
        const totalUsageAmt = StringUtil.parseIntStrict(trx.usage_amt) + trx.service_charge;
        cfg.emvUsages.add({
            alias_no: trx.alias_no, card_no: trx.card_no, usage_amt: totalUsageAmt,
            sam_id: trx.sam_id, pdate: await this.pkConfig.getOperationPdate(conn, sessionId),
            boarding_date_time: trx.boarding_date_time, usage_cnt: trx.usage_cnt, ptcn: trx.ptcn,
            enc_pan: trx.enc_pan, masked_pan: trx.masked_pan, bin: trx.bin,
            late_auth: trx.late_auth, expired_date: trx.expired_date, amount: trx.emv_amount,
            pan_sequence: trx.pan_sequence, key_type: trx.key_type, key_index: trx.key_index,
            emv: trx.emv, on_us: trx.on_us,
            // The gateway's term_no is the bus, not the EMV terminal number the card sent.
            term_no: trx.bus_id, system_id: cfg.systemId, trans_result: trx.trans_result,
            trans_flag: trx.trans_flag, rtc_code: trx.rtc_code, ci_tid: trx.ci_tid,
            ci_bdt: trx.ci_bdt, fare_file_version: trx.fare_file_version,
            travel_type: trx.travel_type, stop_name: trx.stop_name,
        });
        return 0;
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
        this.readPosition(trx);
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

    /**
     * The coordinate the device reported with the tap. Java parsed both inside one try and set
     * both to zero if either failed, so a half-readable position is stored as no position.
     * The value kept here is the float Java held; how it reaches the column depends on which
     * insert variant runs, which tdSql decides.
     */
    readPosition(trx) {
        const lat = StringUtil.tryParseDouble(trx.latitude, null);
        const lng = StringUtil.tryParseDouble(trx.longitude, null);
        if (lat === null || lng === null) {
            trx.lat = 0;
            trx.lng = 0;
            return;
        }
        trx.lat = Math.fround(lat);
        trx.lng = Math.fround(lng);
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
