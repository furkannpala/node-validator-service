/**
 * AFC_TD, AFC_BL_TD and AFC_TD_TEST are written by 16 hand-written INSERT variants in Java
 * (8 + 4 + 4), each one a string concatenation of the same base column list with a different
 * tail. They differ only in which optional columns they carry, so one builder produces all of
 * them. Roadmap D4; the column order is pinned by test/dao/tdSql.test.js because a shift here
 * writes good values into the wrong columns without any error (risk register #1).
 */

// Positions 1..41 of the Java statement, in order. PDATE, TF_ID and RDATE are expressions,
// which is why the bind count and the column count do not match.
const COMMON = [
    ['TRANS_SEQ_NO', ':trans_seq_no'],
    ['TRANS_FLAG', ':trans_flag'],
    ['CUSTOMER_FLAG', ':customer_flag'],
    ['DATA_SAVE_FLAG', ':data_save_flag'],
    ['STATION_TYPE', ':station_type'],
    ['TRANSMIT_CNT', ':transmit_cnt'],
    ['BUS_STOP_ID', ':bus_stop_id'],
    ['ALIAS_NO', ':alias_no'],
    ['CARD_NO', ':card_no'],
    ['BOARDING_DATE_TIME', ':boarding_date_time'],
    ['USAGE_CNT', ':usage_cnt'],
    ['PASSENGER_TYPE', ':passenger_type'],
    ['USAGE_AMT', ':usage_amt'],
    ['REMAINED_AMT', ':remained_amt'],
    ['STAGE', ':stage'],
    ['CUSTOMER_CNT', ':customer_cnt'],
    ['DC_RATE', ':dc_rate'],
    ['OLD_ROUTE_CODE', ':old_route_code'],
    ['APPROVAL_NO', ':approval_no'],
    ['TC_CODE', ':tc_code'],
    ['RTC_CODE', ':rtc_code'],
    ['TRAVEL_SEQ_NO', ':travel_seq_no'],
    ['START_DATE_TIME', ':start_date_time'],
    ['SAM_ID', ':sam_id'],
    ['OLD_AMT', ':old_amt'],
    ['OLD_DATE_TIME', ':old_date_time'],
    ['OLD_SAM_ID', ':old_sam_id'],
    ['PDATE', 'pk_config.fn_get_operation_pdate()'],
    ['SAM_SEQ_NO', ':sam_seq_no'],
    ['QTICK_USED', ':qtick_used'],
    ['ORIGIN_SAM_ID', ':origin_sam_id'],
    ['TF_ID', 'pk_app_val.fn_get_tf_id(:start_date_time,:sam_id,:tf_type)'],
    ['RIDER', ':rider'],
    ['TARIFF_NUMBER', ':tariff_number'],
    ['RDATE', 'pk_config.fn_get_operation_date(:start_date_time)'],
    ['LAT', ':lat'],
    ['LNG', ':lng'],
    ['SERVICE_CHARGE', ':service_charge'],
    ['FARE_FILE_VERSION', ':fare_file_version'],
    ['TRAVEL_TYPE', ':travel_type'],
];

const OPTIONAL = {
    extendedFare: ['EXTENDED_FARE', ':extended_fare'],
    // Lower case in Java and kept that way: the text is compared against the original.
    originSystemId: ['origin_system_id', ':origin_system_id'],
    qrData: ['QR_DATA', ':qr_data'],
};

// The three side tables stop at TF_ID: they carry no fare, position or travel type at all.
const SHORT_BASE = COMMON.slice(0, COMMON.findIndex((c) => c[0] === 'TF_ID') + 1);

// AFC_TD closes with two columns the other tables do not have, and its optionals go in front
// of them. AFC_BL_TD and AFC_TD_TEST end at PRODUCT_CODE and append their optionals after it.

const TABLES = {
    afc_td: { base: COMMON, tail: ['TRANSFER_REF_CODE', 'PRODUCT_CODE'], optionalsBeforeTail: true,
        allowed: ['extendedFare', 'originSystemId', 'qrData'] },
    afc_bl_td: { base: COMMON, tail: ['PRODUCT_CODE'], optionalsBeforeTail: false,
        allowed: ['extendedFare', 'qrData'] },
    afc_td_test: { base: COMMON, tail: ['PRODUCT_CODE'], optionalsBeforeTail: false,
        allowed: ['extendedFare', 'qrData'] },
    afc_td_nonverified: { base: SHORT_BASE, tail: ['PRODUCT_CODE'], optionalsBeforeTail: false, allowed: [] },
    afc_checkin_td: { base: SHORT_BASE, tail: ['PRODUCT_CODE'], optionalsBeforeTail: false, allowed: [] },
    afc_topup_td: { base: SHORT_BASE, tail: ['PRODUCT_CODE'], optionalsBeforeTail: false, allowed: [] },
};

const TAIL_BINDS = { TRANSFER_REF_CODE: ':transfer_ref_code', PRODUCT_CODE: ':product_code' };

/** Ordered [column, valueExpression] pairs for one variant. */
function columnsFor(table, options = {}) {
    const spec = TABLES[table];
    if (!spec) throw new Error(`unknown td table ${table}`);

    const optionals = spec.allowed.filter((name) => options[name]).map((name) => OPTIONAL[name]);
    const tail = spec.tail.map((col) => [col, TAIL_BINDS[col]]);

    return spec.optionalsBeforeTail
        ? [...spec.base, ...optionals, ...tail]
        : [...spec.base, ...tail, ...optionals];
}

function buildInsert(table, options) {
    const pairs = columnsFor(table, options);
    return `INSERT INTO ${table}(${pairs.map((p) => p[0]).join(',')}) `
        + `VALUES(${pairs.map((p) => p[1]).join(',')})`;
}


/**
 * The bind object every variant shares. Values the strategies computed (currency divided,
 * parsed) come off the transaction under their camelCase names.
 */
function tdBind(trx) {
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
        stage: trx.stage,
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
        tf_type: trx.tfType,
        rider: trx.rider,
        tariff_number: trx.tariff_number,
        lat: trx.lat,
        lng: trx.lng,
        service_charge: trx.serviceChargeAmt,
        fare_file_version: trx.fare_file_version,
        travel_type: trx.travel_type,
        product_code: trx.product_code,
    };
}

function bindFor(table, trx, options = {}) {
    // Only the binds the chosen variant references: an extra one is ORA-01036 on some drivers.
    const text = columnsFor(table, options).map((p) => p[1]).join(',');
    const referenced = new Set(text.match(/:[a-z_]\w*/gi) || []);
    const binds = {};
    for (const [name, value] of Object.entries(tdBind(trx))) {
        if (referenced.has(':' + name)) binds[name] = value;
    }
    const spec = TABLES[table];
    if (spec.tail.includes('TRANSFER_REF_CODE')) binds.transfer_ref_code = trx.transfer_ref_code;
    // An option the table does not allow is ignored here too, or the bind set would not match
    // the column set and the driver would reject the statement.
    const on = (name) => spec.allowed.includes(name) && options[name];
    if (on('extendedFare')) binds.extended_fare = trx.extendedFare;
    if (on('originSystemId')) binds.origin_system_id = trx.originSystemId;
    if (on('qrData')) binds.qr_data = trx.qr_data;
    return binds;
}

module.exports = { columnsFor, buildInsert, bindFor };
