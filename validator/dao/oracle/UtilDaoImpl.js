const BaseDao = require("../BaseDao");

// Two lookups senddata needs while building a trip row. Both swallow their errors in Java and
// fall back to a neutral value, so a missing pattern never costs the record.
class UtilDaoImpl extends BaseDao {

    busStopCountSql = ' select pk_app_val.fn_get_bus_stop_count(:route_code,:half_progress_type,'
        + ':start_date_time,substr(:path_code,1,6)) as stop_cnt from dual';

    totalStopCntFromPatternSql =
        'SELECT count(*) AS total_stop_cnt FROM tms_route_path a, tms_path_bus_stop c, tms_pattern e ,tms_bus_Stop f, tms_route_schedule x '
        + ' WHERE a.path_code = c.path_code and c.path_code=e.path_code and c.bus_stop_id=e.bus_stop_id and c.bus_stop_id=f.bus_stop_id '
        + " and to_char(current_date,'yyyymmddhh24miss') between f.activation_start_datetime and f.activation_end_datetime "
        + ' AND TRUNC (current_date) BETWEEN c.valid_From AND c.valid_to '
        + ' AND TRUNC (current_date) BETWEEN a.valid_From AND a.valid_to '
        + ' AND trunc(current_date) between x.activation_start_date and x.activation_end_date '
        + ' AND e.arrival_offset > 0  AND e.pattern_type = x.PERIOD_TYPE '
        + ' AND a.path_code = x.PATH_CODE  AND x.TRIP_NO=:trip_no';

    // A station's shift starts when the operation day does, not when the record says.
    stationStartDateTimeSql = "select to_char(pk_config.fn_get_operation_date(:boarding_date_time),"
        + "'yyyymmdd')||pk_config.fn_get_operation_start_time()||'00' as start_date_time from dual";

    async scalar(conn, sql, binds, column, fallback, sessionId) {
        try {
            this.ULog.debug(sql + " " + this.maskJson(binds), sessionId);
            const result = await conn.execute(sql, binds,
                { outFormat: this.oracledb.OUT_FORMAT_OBJECT, autoCommit: false });
            const row = (result.rows || [])[0];
            return row ? row[column] : fallback;
        } catch (e) {
            // Java logged and returned the fallback; the trip row is written either way.
            this.ULog.error(`${column} lookup failed: ${e?.message}`, sessionId);
            return fallback;
        }
    }

    getBusStopCount(conn, trx, sessionId) {
        return this.scalar(conn, this.busStopCountSql, {
            route_code: trx.route_code,
            half_progress_type: trx.half_progress_type,
            start_date_time: trx.start_date_time,
            path_code: trx.pathCode,
        }, 'STOP_CNT', '0', sessionId);
    }

    getStationStartDateTime(conn, trx, sessionId) {
        return this.scalar(conn, this.stationStartDateTimeSql,
            { boarding_date_time: trx.boarding_date_time }, 'START_DATE_TIME', null, sessionId);
    }

    /** tripNo is the old_route_code attribute, which carries the trip number on F records. */
    getTotalStopCntFromPattern(conn, tripNo, sessionId) {
        return this.scalar(conn, this.totalStopCntFromPatternSql,
            { trip_no: tripNo }, 'TOTAL_STOP_CNT', 0, sessionId);
    }
}

module.exports = new UtilDaoImpl();
