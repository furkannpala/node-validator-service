const BaseDao = require("../BaseDao");

const COLS = 'bus_id,route_code,bus_stop_id,half_progress_type,arrival_date_time,leaving_date_time,'
    + 'travel_type,travel_seq_no,start_date_time,sam_id,pdate';
const VALUES = ':bus_id,:route_code,:bus_stop_id,:half_progress_type,:arrival_date_time,'
    + ':leaving_date_time,:travel_type,:travel_seq_no,:start_date_time,:sam_id,'
    + 'pk_config.fn_get_operation_pdate()';

// senddata writes a richer row than onlinegps does: it also carries the trip, the path, the
// stop sequence and the trip id.
const DATA_COLS = 'bus_id,route_code,bus_stop_id,half_progress_type,arrival_date_time,leaving_date_time,'
    + 'travel_type,travel_seq_no,start_date_time,sam_id,pdate,trip_no,path_code,STOP_SEQ_NO,tf_id,rdate';

const DATA_VALUES = ':bus_id,:route_code,:bus_stop_id,:half_progress_type,:arrival_date_time,'
    + ':leaving_date_time,:travel_type,:travel_seq_no,:start_date_time,:sam_id,'
    + 'pk_config.fn_get_operation_pdate(),:trip_no,substr(:path_code,1,6),:stop_seq_no,'
    + "pk_app_val.fn_get_tf_id(:start_date_time,:sam_id,'1'),"
    + 'pk_config.fn_get_operation_date(:start_date_time)';

function dataBind(trx) {
    return {
        bus_id: trx.bus_id,
        route_code: trx.route_code,
        bus_stop_id: trx.bus_stop_id,
        half_progress_type: trx.half_progress_type,
        arrival_date_time: trx.boarding_date_time,
        leaving_date_time: trx.boarding_date_time,
        travel_type: trx.travelType,
        travel_seq_no: trx.travel_seq_no,
        start_date_time: trx.start_date_time,
        sam_id: trx.sam_id,
        // The TRIP_NO column is bound from old_route_code, which on an F record carries the
        // trip number. The record's own trip_no attribute never reaches this table.
        trip_no: trx.old_route_code,
        path_code: trx.pathCode,
        stop_seq_no: trx.stop_seq_no,
    };
}

// onlinegps writes here twice: travel type 8 opens the stop visit, 9 closes it. These are two
// separate statements in Java, not an upsert, so no MERGE is involved on this path.
class TmsValRouteDaoImpl extends BaseDao {

    insertSql = `INSERT INTO tms_val_route (${COLS}) VALUES(${VALUES})`;

    updateLeavingSql = 'UPDATE tms_val_route SET leaving_date_time=:leaving_date_time, '
        + '    travel_type=:travel_type  '
        + 'WHERE bus_stop_id=:bus_stop_id AND  '
        + '      start_date_time=:start_date_time AND  '
        + '      sam_id=:sam_id'
        + '  AND travel_seq_no=:travel_seq_no';

    insert(conn, data, sessionId) {
        return this.exec(conn, this.insertSql, data, sessionId);
    }

    updateLeaving(conn, data, sessionId) {
        return this.exec(conn, this.updateLeavingSql, data, sessionId);
    }

    insertFromDataSql = `INSERT INTO tms_val_route (${DATA_COLS}) VALUES(${DATA_VALUES})`;

    // The stop must still be open (travel type 8) and belong to this bus for the leave to land.
    updateLeavingFromDataSql = 'UPDATE tms_val_route SET leaving_date_time=:leaving_date_time, '
        + '    travel_type=:travel_type  '
        + 'WHERE bus_stop_id=:bus_stop_id AND  travel_type=8 AND start_date_time=:start_date_time AND  '
        + '      sam_id=:sam_id   AND travel_seq_no=:travel_seq_no AND BUS_ID=:bus_id ';

    // Guards against writing the same leave twice; the plan calls this upsert #4, but the
    // three statements do not collapse into one MERGE without changing which rows match.
    checkLeavingDateTimeSql = 'SELECT 1 FROM TMS_VAL_ROUTE WHERE bus_stop_id=:bus_stop_id '
        + 'AND travel_type=:travel_type AND start_date_time=:start_date_time AND sam_id=:sam_id '
        + 'AND travel_seq_no=:travel_seq_no AND BUS_ID=:bus_id AND LEAVING_DATE_TIME=:leaving_date_time';

    insertFromData(conn, trx, sessionId) {
        return this.exec(conn, this.insertFromDataSql, dataBind(trx), sessionId);
    }

    updateLeavingFromData(conn, trx, travelType, sessionId) {
        return this.exec(conn, this.updateLeavingFromDataSql, {
            leaving_date_time: trx.boarding_date_time,
            travel_type: travelType,
            bus_stop_id: trx.bus_stop_id,
            start_date_time: trx.start_date_time,
            sam_id: trx.sam_id,
            travel_seq_no: trx.travel_seq_no,
            bus_id: trx.bus_id,
        }, sessionId);
    }

    async checkLeavingDateTime(conn, trx, travelType, sessionId) {
        const binds = {
            bus_stop_id: trx.bus_stop_id,
            travel_type: travelType,
            start_date_time: trx.start_date_time,
            sam_id: trx.sam_id,
            travel_seq_no: trx.travel_seq_no,
            bus_id: trx.bus_id,
            leaving_date_time: trx.boarding_date_time,
        };
        this.debugSql(this.checkLeavingDateTimeSql, binds, sessionId);
        const result = await conn.execute(this.checkLeavingDateTimeSql, binds, { autoCommit: false });
        return (result.rows || []).length > 0;
    }
}

module.exports = new TmsValRouteDaoImpl();
