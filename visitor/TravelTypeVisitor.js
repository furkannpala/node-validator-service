const StringUtil = require("../util/StringUtil");
const daoFactory = require("../validator/daoFactory/DaoFactory");

/**
 * One method per branch of ins_data's travel_type chain. The strategy decides which of them
 * run for a record; each of them owns exactly the statements the Java branch issued.
 */
class TravelTypeVisitor {
    constructor() {
        this.mstBus = daoFactory.get("MstBusDaoImpl");
        this.util = daoFactory.get("UtilDaoImpl");
        this.afcTf = daoFactory.get("AfcTfDaoImpl");
        this.afcTh = daoFactory.get("AfcThDaoImpl");
        this.afcTfEvent = daoFactory.get("AfcTfEventDaoImpl");
        this.tmsValRoute = daoFactory.get("TmsValRouteDaoImpl");
    }

    /**
     * Runs for every travel type except 2, 3, 4, 5, 8 and 9: fills in the company, the
     * odometer and the stop count the trip row needs.
     */
    async visitDefault(conn, trx, cfg, sessionId) {
        const row = await this.mstBus.findComp(conn, trx.bus_id, trx.start_date_time, sessionId);
        if (row) {
            trx.compCode = Number(row.COMP_CODE);
            trx.depot_code = row.DEPOT_CODE;
        }
        trx.odometerStart = StringUtil.tryParseInt(trx.odometer, 0);

        // old_route_code carries the trip number on F records, which is what the pattern
        // query keys on.
        trx.totalStopCnt = cfg.getTotalStopCntFromPattern
            ? String(await this.util.getTotalStopCntFromPattern(conn, trx.old_route_code, sessionId))
            : String(await this.util.getBusStopCount(conn, trx, sessionId));
    }

    /** Every travel type but 8 and 9 leaves an event row behind. */
    visitWithoutStop(conn, trx, cfg, sessionId) {
        return this.afcTfEvent.insert(conn, trx, sessionId);
    }

    visitTripStarted(conn, trx, cfg, sessionId) {
        return this.afcTf.updateTripOpen(conn, trx, trx.odometerStart, sessionId);
    }

    visitTripEnd(conn, trx, cfg, sessionId) {
        return this.afcTf.updateTripEnd(conn, trx, StringUtil.tryParseInt(trx.odometer, 0), sessionId);
    }

    visitJourneyStarted(conn, trx, cfg, sessionId) {
        return this.afcTf.updateTripTime(conn, trx, sessionId);
    }

    visitDriverChanged(conn, trx, cfg, sessionId) {
        return this.afcTf.updateDriverChange(conn, trx, sessionId);
    }

    /** Driver card in, out or duty ended: the shift row, upsert #2. */
    visitDrivercard(conn, trx, cfg, sessionId) {
        return this.afcTh.merge(conn, trx, sessionId);
    }

    visitStopEntered(conn, trx, cfg, sessionId) {
        return this.tmsValRoute.insertFromData(conn, trx, sessionId);
    }

    /**
     * Closing a stop visit. Java updated the open row, and when that matched nothing it made
     * sure the same leave had not already been recorded before inserting one.
     */
    async visitStopLeft(conn, trx, cfg, sessionId) {
        const updated = await this.tmsValRoute.updateLeavingFromData(conn, trx, trx.travelType, sessionId);
        if (updated) return updated;

        const exists = await this.tmsValRoute.checkLeavingDateTime(conn, trx, trx.travelType, sessionId);
        if (exists) return 0;
        return this.tmsValRoute.insertFromData(conn, trx, sessionId);
    }
}

module.exports = TravelTypeVisitor;
