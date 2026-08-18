// TMS_APC and TMS_APC_EVENT are written from the same GPSDAT element with the same column list,
// so the projection lives here instead of being repeated in both DAOs.
const COLS = 'TRAVEL_TYPE, SAM_ID, TRAVEL_SEQ_NO, START_DATE_TIME, DATE_TIME, TRIP_NO, BUS_STOP_ID, '
    + 'STOP_SEQ_NO, BUS_ID, APC_1_IN_CNT, APC_2_IN_CNT, APC_3_IN_CNT, APC_4_IN_CNT, APC_5_IN_CNT, '
    + 'APC_1_OUT_CNT, APC_2_OUT_CNT, APC_3_OUT_CNT, APC_4_OUT_CNT, APC_5_OUT_CNT, RDATE, PDATE';

const VALUES = ':travel_type,:sam_id,:travel_seq_no,:start_date_time,:date_time,:trip_no,:bus_stop_id,'
    + ':stop_seq_no,:bus_id,:apc_1_in_cnt,:apc_2_in_cnt,:apc_3_in_cnt,:apc_4_in_cnt,:apc_5_in_cnt,'
    + ':apc_1_out_cnt,:apc_2_out_cnt,:apc_3_out_cnt,:apc_4_out_cnt,:apc_5_out_cnt,'
    + 'pk_config.fn_get_operation_date(:r_start_date_time),pk_config.fn_get_operation_pdate()';

function apcBind(trx) {
    return {
        travel_type: trx.sub_event,   // the sub event is what TRAVEL_TYPE stores here
        sam_id: trx.sam_id,
        travel_seq_no: trx.travel_seq_no,
        start_date_time: trx.start_date_time,
        date_time: trx.date_time,
        trip_no: trx.trip_no,
        bus_stop_id: trx.bus_stop_id,
        stop_seq_no: trx.stop_seq_no,
        bus_id: trx.bus_id,
        apc_1_in_cnt: trx.apc_1_in_cnt,
        apc_2_in_cnt: trx.apc_2_in_cnt,
        apc_3_in_cnt: trx.apc_3_in_cnt,
        apc_4_in_cnt: trx.apc_4_in_cnt,
        apc_5_in_cnt: trx.apc_5_in_cnt,
        apc_1_out_cnt: trx.apc_1_out_cnt,
        apc_2_out_cnt: trx.apc_2_out_cnt,
        apc_3_out_cnt: trx.apc_3_out_cnt,
        apc_4_out_cnt: trx.apc_4_out_cnt,
        apc_5_out_cnt: trx.apc_5_out_cnt,
        r_start_date_time: trx.getRStartDateTime(),
    };
}

module.exports = { COLS, VALUES, apcBind };
