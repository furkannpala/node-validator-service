const StringUtil = require("../util/StringUtil");
const TravelTypes = require("../constant/TravelTypes");
const StationDRecordStrategy = require("./StationDRecordStrategy");
const daoFactory = require("../validator/daoFactory/DaoFactory");
const { ULog } = require("../../../lib/utils");

// Station types that keep a shift row in afc_station. Type 1 and 5 are buses and never get here.
const SHIFT_STATION_TYPES = new Set(['2', '3', '4', '6', '7', '8', '9']);

const SHIFT_EVENTS = new Set([
    TravelTypes.DRIVERCARD_INSERTED, TravelTypes.DRIVERCARD_REMOVED, TravelTypes.DUTY_ENDED,
]);

/**
 * ins_station: the same senddata body coming from a station rather than a bus. The trip half is
 * much smaller than the bus one — there are no stops, no odometer and no trip events, only the
 * shift — and the ticket half differs from ins_data in three details, kept in
 * StationDRecordStrategy.
 */
class StationStrategy {
    constructor() {
        this.dRecord = new StationDRecordStrategy();
        this.mstBus = daoFactory.get("MstBusDaoImpl");
        this.afcStation = daoFactory.get("AfcStationDaoImpl");
        this.afcTf = daoFactory.get("AfcTfDaoImpl");
        this.afcTh = daoFactory.get("AfcThDaoImpl");
        this.afcTfEvent = daoFactory.get("AfcTfEventDaoImpl");
        this.util = daoFactory.get("UtilDaoImpl");
        this.afcBlTd = daoFactory.get("AfcBlTdDaoImpl");
    }

    async processTransaction(conn, trx, cfg, sessionId) {
        const type = trx.getRecordType();
        if (type === 'D') {
            await this.openShift(conn, trx, cfg, sessionId);
            return this.dRecord.processTransaction(conn, trx, cfg, sessionId);
        }
        if (type === 'F') return this.processF(conn, trx, cfg, sessionId);
        return this.processOther(conn, trx, cfg, sessionId);
    }

    /**
     * Before the first ticket of a shift the station row has to exist, and with it the trip row
     * that the ticket's tf_id points at. Java checked and then inserted or updated; both are
     * upserts now, so the check is gone.
     */
    async openShift(conn, trx, cfg, sessionId) {
        if (!SHIFT_STATION_TYPES.has(String(trx.station_type ?? '').charAt(0))) return;

        await this.fillCompany(conn, trx, sessionId);
        // The shift row keeps the start time the record sent; only afterwards does Java
        // replace the variable, so the order of these two steps matters.
        await this.afcStation.merge(conn, trx, sessionId);

        // From here on the day start replaces the record's own start time. Everything that
        // follows - the trip row, its tf_id, and every ticket of this record - uses it, which
        // is what ties the tickets to the trip.
        const dayStart = await this.util.getStationStartDateTime(conn, trx, sessionId);
        if (dayStart != null) trx.start_date_time = dayStart;

        if (await this.afcTf.checkStationRecord(conn, trx, sessionId)) return;
        trx.tfType = '1';
        await this.afcTf.insertForStation(conn, trx, sessionId);
    }

    async fillCompany(conn, trx, sessionId) {
        const row = await this.mstBus.findComp(conn, trx.bus_id, trx.boarding_date_time, sessionId);
        if (row) {
            trx.compCode = Number(row.COMP_CODE);
            trx.depot_code = row.DEPOT_CODE;
        }
    }

    /**
     * The station trip record: an event row always, and the shift row when the driver card
     * went in or out. None of the bus travel types apply here.
     */
    async processF(conn, trx, cfg, sessionId) {
        trx.travelType = trx.travel_type;
        trx.pathCode = trx.path_code;
        // ins_station parses the odometer here for every travel type, unlike the bus path where
        // only the types that run the preparation step ever set it.
        trx.odometerStart = StringUtil.tryParseInt(trx.odometer, 0);

        await this.afcTfEvent.insertForStation(conn, trx, sessionId);

        if (SHIFT_EVENTS.has(String(trx.travel_type))) {
            await this.afcTh.merge(conn, trx, sessionId);
        }
    }

    /** Neither D nor F: stored in the blacklist table, exactly as the bus path does. */
    async processOther(conn, trx, cfg, sessionId) {
        ULog.debug(`record_id is not D or F, stored as blacklist: ${trx.record_id}`, sessionId);
        const multiplier = cfg.currencyMultiplier;

        trx.usageAmt = StringUtil.parseIntStrict(trx.usage_amt) / multiplier;
        trx.remainedAmt = StringUtil.parseIntStrict(trx.remained_amt) / multiplier;
        const oldAmt = StringUtil.parseIntStrict(trx.old_amt);
        trx.oldAmt = oldAmt > 0 ? oldAmt / multiplier : 0;
        trx.customerCnt = StringUtil.isNullOrEmpty(trx.customer_cnt)
            ? 0 : StringUtil.parseIntStrict(trx.customer_cnt);
        trx.tfType = '1';
        trx.stage = trx.traffic_type;
        trx.lat = null;
        trx.lng = null;
        trx.serviceChargeAmt = trx.service_charge / multiplier;

        return this.afcBlTd.insert(conn, trx, {
            qrData: !StringUtil.isNullOrEmpty(trx.qr_data),
        }, sessionId);
    }
}

module.exports = StationStrategy;
