const BaseDao = require("../BaseDao");

const COLS = 'TRAVEL_TYPE, SAM_ID, TRAVEL_SEQ_NO, START_DATE_TIME, DATE_TIME, TRIP_NO, BUS_STOP_ID, '
    + 'STOP_SEQ_NO, BUS_ID, RDATE, PDATE';
const VALUES = ':travel_type,:sam_id,:travel_seq_no,:start_date_time,:date_time,:trip_no,:bus_stop_id,'
    + ':stop_seq_no,:bus_id,pk_config.fn_get_operation_date(:r_start_date_time),'
    + 'pk_config.fn_get_operation_pdate()';

// Sub events 17 and 18: the door opened or closed, so no passenger counters are stored.
class TmsDoorStatusDaoImpl extends BaseDao {

    insertSql = `INSERT INTO TMS_DOOR_STATUS(${COLS}) values(${VALUES})`;

    toBind(trx) {
        return {
            travel_type: trx.sub_event,
            sam_id: trx.sam_id,
            travel_seq_no: trx.travel_seq_no,
            start_date_time: trx.start_date_time,
            date_time: trx.date_time,
            trip_no: trx.trip_no,
            bus_stop_id: trx.bus_stop_id,
            stop_seq_no: trx.stop_seq_no,
            bus_id: trx.bus_id,
            r_start_date_time: trx.getRStartDateTime(),
        };
    }

    insert(conn, trx, sessionId) {
        return this.exec(conn, this.insertSql, this.toBind(trx), sessionId);
    }
}

module.exports = new TmsDoorStatusDaoImpl();
