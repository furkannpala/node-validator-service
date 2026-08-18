const BaseDao = require("../BaseDao");

/**
 * The trip row. Java ran one of four UPDATEs and inserted when it touched no row, so upsert #1
 * becomes four MERGEs that share one INSERT branch. The column and value lists are defined once
 * because a merged row and an inserted row have to be identical.
 */
const BUS_COLS =
    'travel_seq_no,sam_id,validator_id,bus_id,comp_code,depot_code,route_code,driver_code,travel_type,'
    + 'start_date_time,end_date_time,half_progress_type,return_flag,emergency_flag,pdate,total_fuel_used_start,'
    + 'total_fuel_used_end,trip_no,change_driver_code,driver_change_time,bus_stop_id,travel_date_time,'
    + 'total_stop_cnt,trip_stop_cnt,odometer_start,r_trip_no,rdate,path_code,manual_trip_start_time,tf_id';

// trip_no and r_trip_no both take old_route_code, and total_fuel_used fills both fuel columns.
// Both are what the Java statement bound; the leftover "// sam_seq_no" comment there is stale.
const BUS_VALUES =
    ':travel_seq_no,:sam_id,:validator_id,:bus_id,:comp_code,:depot_code,:route_code,:driver_code,'
    + ':travel_type,:start_date_time,:boarding_date_time,:half_progress_type,:return_flag,:emergency_flag,'
    + 'pk_config.fn_get_operation_pdate(),:total_fuel_used,:total_fuel_used,:old_route_code,:driver_code,'
    + ':boarding_date_time,:bus_stop_id,:boarding_date_time,:total_stop_cnt,:trip_stop_cnt,:odometer_start,'
    + ':old_route_code,pk_config.fn_get_operation_date(:start_date_time),substr(:path_code,1,6),'
    + ":manual_trip_start_time,pk_app_val.fn_get_tf_id(:start_date_time,:sam_id,'1')";

// The three columns all four UPDATEs matched on, so the MERGE hits exactly the same rows.
const USING_TRIP_KEY =
    'USING (SELECT :travel_seq_no travel_seq_no, :start_date_time start_date_time,'
    + ' :sam_id sam_id FROM DUAL) s'
    + ' ON (t.travel_seq_no=s.travel_seq_no AND t.start_date_time=s.start_date_time'
    + ' AND t.sam_id=s.sam_id) ';

// The driver change UPDATE deliberately left travel_seq_no out of its WHERE, so this key does too.
const USING_SAM_KEY =
    'USING (SELECT :start_date_time start_date_time, :sam_id sam_id FROM DUAL) s'
    + ' ON (t.start_date_time=s.start_date_time AND t.sam_id=s.sam_id) ';

const WHEN_NOT_MATCHED = `WHEN NOT MATCHED THEN INSERT (${BUS_COLS}) VALUES(${BUS_VALUES})`;

function mergeBus(using, setClause) {
    return `MERGE INTO afc_tf t ${using}WHEN MATCHED THEN UPDATE SET ${setClause} ` + WHEN_NOT_MATCHED;
}

// SET lists verbatim from the UPDATEs. Inside a MERGE the CASE reads must be qualified with t.,
// or the name could resolve against the USING source instead of the target row.
const SET_TRIP_END =
    'end_date_time=:boarding_date_time, travel_type=:travel_type, '
    + 'total_fuel_used_end=:total_fuel_used, trip_stop_cnt=:trip_stop_cnt, odometer_end=:odometer_end, '
    + 'trip_no=:old_route_code, r_trip_no=:old_route_code';

const SET_TRIP_OPEN =
    'total_fuel_used_start=:total_fuel_used, odometer_start=:odometer_start, '
    + 'manual_trip_start_time=:manual_trip_start_time, path_code=substr(:path_code,1,6), '
    + 'driver_code=:driver_code, change_driver_code=:driver_code';

const SET_TRIP_TIME =
    'travel_date_time=:boarding_date_time, '
    + "travel_type=(case when t.travel_type='1' then '1' else :travel_type end), "
    + "end_date_time=(case when t.travel_type='1' then t.end_date_time else :boarding_date_time end), "
    + 'driver_code=:driver_code, path_code=:path_code';

const SET_DRIVER_CHANGE =
    "travel_type=(case when t.travel_type='1' then '1' else :travel_type end), "
    + 'change_driver_code=:change_driver_code, driver_change_time=:driver_change_time,'
    + ' bus_stop_id=:bus_stop_id';

// The station path writes a whole shift, not a trip: its window comes from the operation day.
const SQL_INSERT_STATION =
    'INSERT INTO afc_tf ('
    + 'sam_id,validator_id,bus_id,comp_code,depot_code,route_code,driver_code,start_date_time,end_date_time,'
    + 'pdate,sam_seq_no_start,sam_seq_no_end,travel_seq_no,rdate,tf_id) '
    + 'VALUES(:sam_id,:validator_id,:bus_id,:comp_code,:depot_code,:route_code,:driver_code,'
    + "to_char(pk_config.fn_get_operation_date(:boarding_date_time),'yyyymmdd')||pk_config.fn_get_operation_start_time()||'00',"
    + "to_char(pk_config.fn_get_operation_date(:boarding_date_time),'yyyymmdd')||pk_config.fn_get_operation_end_time()||'00',"
    + 'pk_config.fn_get_operation_pdate(),:sam_seq_no,:sam_seq_no,:travel_seq_no,'
    + 'pk_config.fn_get_operation_date(:boarding_date_time),pk_app_val.fn_get_tf_id(:start_date_time,:sam_id,:tf_type))';

function busBind(trx) {
    return {
        travel_seq_no: trx.travel_seq_no,
        sam_id: trx.sam_id,
        validator_id: trx.validator_id,
        bus_id: trx.bus_id,
        comp_code: trx.compCode,
        depot_code: trx.depot_code,
        route_code: trx.route_code,
        driver_code: trx.driver_code,
        travel_type: trx.travelType,
        start_date_time: trx.start_date_time,
        boarding_date_time: trx.boarding_date_time,
        half_progress_type: trx.half_progress_type,
        return_flag: trx.return_flag,
        emergency_flag: trx.emergency_flag,
        total_fuel_used: trx.total_fuel_used,
        old_route_code: trx.old_route_code,
        bus_stop_id: trx.bus_stop_id,
        total_stop_cnt: trx.totalStopCnt,
        trip_stop_cnt: trx.trip_stop_cnt,
        odometer_start: trx.odometerStart,
        path_code: trx.pathCode,
        manual_trip_start_time: trx.manual_trip_start_time,
    };
}

class AfcTfDaoImpl extends BaseDao {

    insertSql = `INSERT INTO afc_tf (${BUS_COLS}) VALUES(${BUS_VALUES})`;
    insertStationSql = SQL_INSERT_STATION;
    checkSql = 'SELECT 1 FROM afc_tf WHERE travel_seq_no=:travel_seq_no '
        + 'AND start_date_time=:start_date_time AND sam_id=:sam_id';

    // The station variant computes the day start in SQL instead of comparing the record's own
    // start time, so it must stay a separate statement.
    checkStationSql = ' SELECT 1 FROM afc_tf  WHERE  sam_id=:sam_id and start_date_time='
        + "to_char(pk_config.fn_get_operation_date(:boarding_date_time),'yyyymmdd')"
        + "||pk_config.fn_get_operation_start_time()||'00'"
        + ' and travel_seq_no=:travel_seq_no';

    mergeTripEndSql = mergeBus(USING_TRIP_KEY, SET_TRIP_END);
    mergeTripOpenSql = mergeBus(USING_TRIP_KEY, SET_TRIP_OPEN);
    mergeTripTimeSql = mergeBus(USING_TRIP_KEY, SET_TRIP_TIME);
    mergeDriverChangeSql = mergeBus(USING_SAM_KEY, SET_DRIVER_CHANGE);

    async exists(conn, sql, binds, sessionId) {
        this.ULog.debug(sql + " " + this.maskJson(binds), sessionId);
        const result = await conn.execute(sql, binds, { autoCommit: false });
        return (result.rows || []).length > 0;
    }

    checkRecord(conn, trx, sessionId) {
        return this.exists(conn, this.checkSql, {
            travel_seq_no: trx.travel_seq_no, start_date_time: trx.start_date_time, sam_id: trx.sam_id,
        }, sessionId);
    }

    checkStationRecord(conn, trx, sessionId) {
        return this.exists(conn, this.checkStationSql, {
            sam_id: trx.sam_id, boarding_date_time: trx.boarding_date_time,
            travel_seq_no: trx.travel_seq_no,
        }, sessionId);
    }

    insert(conn, trx, sessionId) {
        return this.exec(conn, this.insertSql, busBind(trx), sessionId);
    }

    insertForStation(conn, trx, sessionId) {
        return this.exec(conn, this.insertStationSql, {
            sam_id: trx.sam_id,
            validator_id: trx.validator_id,
            bus_id: trx.bus_id,
            comp_code: trx.compCode,
            depot_code: trx.depot_code,
            route_code: trx.route_code,
            driver_code: trx.driver_code,
            boarding_date_time: trx.boarding_date_time,
            sam_seq_no: trx.sam_seq_no,
            travel_seq_no: trx.travel_seq_no,
            start_date_time: trx.start_date_time,
            tf_type: trx.tfType,
        }, sessionId);
    }

    merge(conn, sql, trx, extraBinds, sessionId) {
        return this.exec(conn, sql, { ...busBind(trx), ...extraBinds }, sessionId);
    }

    /** Trip closed: the end of a run, with its final odometer reading. */
    updateTripEnd(conn, trx, odometerEnd, sessionId) {
        return this.merge(conn, this.mergeTripEndSql, trx, { odometer_end: odometerEnd }, sessionId);
    }

    updateTripOpen(conn, trx, odometerStart, sessionId) {
        return this.merge(conn, this.mergeTripOpenSql, trx, { odometer_start: odometerStart }, sessionId);
    }

    updateTripTime(conn, trx, sessionId) {
        return this.merge(conn, this.mergeTripTimeSql, trx, {}, sessionId);
    }

    updateDriverChange(conn, trx, sessionId) {
        return this.merge(conn, this.mergeDriverChangeSql, trx, {
            change_driver_code: trx.driver_code,
            driver_change_time: trx.boarding_date_time,
        }, sessionId);
    }
}

module.exports = new AfcTfDaoImpl();
