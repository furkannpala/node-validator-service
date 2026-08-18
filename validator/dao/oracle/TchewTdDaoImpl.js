const BaseDao = require("../BaseDao");

/**
 * The legacy inserts of ins_data_tchew, used only by system 106 with a company code other
 * than 1. They name no columns at all — `INSERT INTO afc_td VALUES(...)` — so every value is
 * placed by its physical position in the table.
 *
 * This is risk register #1 and it is kept as it is on purpose: rewriting these with a column
 * list would need the table's physical order, which is not in the migration export. Adding a
 * column to AFC_TD anywhere before ORIGIN_SAM_ID silently corrupts this path, in Java exactly
 * as here. test/dao/tchewTd.test.js pins the order so a change is at least noticed.
 */
const ORDER = [
    'trans_seq_no', 'trans_flag', 'customer_flag', 'data_save_flag', 'station_type',
    'transmit_cnt', 'bus_stop_id', 'alias_no', 'card_no', 'boarding_date_time', 'usage_cnt',
    'passenger_type', 'usage_amt', 'remained_amt', 'stage', 'customer_cnt', 'dc_rate',
    'old_route_code', 'approval_no', 'tc_code', 'rtc_code', 'travel_seq_no', 'start_date_time',
    'sam_id', 'old_amt', 'old_date_time', 'old_sam_id',
    // PDATE sits here as a function call, which is why it is not in this list.
    'sam_seq_no', 'qtick_used', 'origin_sam_id',
];

// Position 28 of the statement; everything after OLD_SAM_ID follows it.
const PDATE_AFTER = 'old_sam_id';

function values(extra = []) {
    const parts = [];
    for (const name of ORDER) {
        parts.push(`:${name}`);
        if (name === PDATE_AFTER) parts.push('pk_config.fn_get_operation_pdate()');
    }
    return parts.concat(extra.map((name) => `:${name}`)).join(',');
}

function toBind(trx) {
    return {
        trans_seq_no: trx.trans_seq_no,
        trans_flag: trx.trans_flag,
        customer_flag: trx.customer_flag,
        data_save_flag: trx.data_save_flag,
        station_type: trx.station_type,
        transmit_cnt: trx.transmit_cnt,
        bus_stop_id: trx.bus_stop_id,
        alias_no: trx.alias_no,
        card_no: trx.card_no,
        boarding_date_time: trx.boarding_date_time,
        usage_cnt: trx.usage_cnt,
        passenger_type: trx.passenger_type,
        usage_amt: trx.usageAmt,
        remained_amt: trx.remainedAmt,
        // The fifteenth column receives traffic_type here, as it does on the station path.
        stage: trx.traffic_type,
        customer_cnt: trx.customerCnt,
        dc_rate: trx.dc_rate,
        old_route_code: trx.old_route_code,
        approval_no: trx.approval_no,
        tc_code: trx.tc_code,
        rtc_code: trx.rtc_code,
        travel_seq_no: trx.travel_seq_no,
        start_date_time: trx.start_date_time,
        sam_id: trx.sam_id,
        old_amt: trx.oldAmt,
        old_date_time: trx.old_date_time,
        old_sam_id: trx.old_sam_id,
        sam_seq_no: trx.sam_seq_no,
        qtick_used: trx.qtick_used,
        origin_sam_id: trx.origin_sam_id,
    };
}

class TchewTdDaoImpl extends BaseDao {

    insertTdSql = `INSERT INTO afc_td VALUES(${values()})`;
    insertTdExtendedFareSql = `INSERT INTO afc_td VALUES(${values(['extended_fare'])})`;
    insertTestTdSql = `INSERT INTO afc_td_test VALUES(${values()})`;
    insertBlTdSql = `INSERT INTO afc_bl_td VALUES(${values()})`;
    insertCheckinTdSql = `INSERT INTO afc_checkin_td VALUES(${values()})`;
    insertTopupSql = `INSERT INTO afc_topup_td VALUES(${values()})`;

    insertTd(conn, trx, sessionId) {
        return this.execIgnoreDuplicate(conn, this.insertTdSql, toBind(trx), sessionId);
    }

    insertTdExtendedFare(conn, trx, sessionId) {
        return this.execIgnoreDuplicate(conn, this.insertTdExtendedFareSql,
            { ...toBind(trx), extended_fare: trx.extendedFare }, sessionId);
    }

    insertTestTd(conn, trx, sessionId) {
        return this.execIgnoreDuplicate(conn, this.insertTestTdSql, toBind(trx), sessionId);
    }

    insertBlTd(conn, trx, sessionId) {
        return this.execIgnoreDuplicate(conn, this.insertBlTdSql, toBind(trx), sessionId);
    }

    insertCheckinTd(conn, trx, sessionId) {
        return this.execIgnoreDuplicate(conn, this.insertCheckinTdSql, toBind(trx), sessionId);
    }

    insertTopup(conn, trx, sessionId) {
        return this.execIgnoreDuplicate(conn, this.insertTopupSql, toBind(trx), sessionId);
    }
}

module.exports = new TchewTdDaoImpl();
