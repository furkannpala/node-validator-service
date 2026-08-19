const BaseDao = require("../BaseDao");

/**
 * The trip event log. ins_data and ins_station write different column sets into this table:
 * the bus path records fuel counters and a tf_id, the station path records sam sequence
 * numbers and an alias. Both statements live here rather than being merged into one.
 */
const BUS_COLS = 'travel_seq_no,sam_id,validator_id,bus_id,comp_code,depot_code,route_code,driver_code,'
    + 'travel_type,start_date_time,end_date_time,half_progress_type,return_flag,emergency_flag,pdate,'
    + 'total_fuel_used_start,total_fuel_used_end,trip_no,change_driver_code,driver_change_time,bus_stop_id,'
    + 'travel_date_time,alias_no,total_stop_cnt,trip_stop_cnt,odometer,path_code,manual_trip_start_time,tf_id';

const BUS_VALUES = ':travel_seq_no,:sam_id,:validator_id,:bus_id,:comp_code,:depot_code,:route_code,'
    + ':driver_code,:travel_type,:start_date_time,:boarding_date_time,:half_progress_type,:return_flag,'
    + ':emergency_flag,pk_config.fn_get_operation_pdate(),:total_fuel_used,:total_fuel_used,'
    + ':old_route_code,:driver_code,:boarding_date_time,:bus_stop_id,:boarding_date_time,:alias_no,'
    + ":total_stop_cnt,:trip_stop_cnt,:odometer,:path_code,:manual_trip_start_time,"
    + "pk_app_val.fn_get_tf_id(:start_date_time,:sam_id,'1')";

const STATION_COLS = 'travel_seq_no,sam_id,validator_id,bus_id,comp_code,depot_code,route_code,driver_code,'
    + 'travel_type,start_date_time,end_date_time,half_progress_type,return_flag,emergency_flag,pdate,'
    + 'sam_seq_no_start,sam_seq_no_end,trip_no,change_driver_code,driver_change_time,bus_stop_id,'
    + 'travel_date_time,alias_no,total_stop_cnt,trip_stop_cnt,odometer,path_code';

const STATION_VALUES = ':travel_seq_no,:sam_id,:validator_id,:bus_id,:comp_code,:depot_code,:route_code,'
    + ':driver_code,:travel_type,:start_date_time,:boarding_date_time,:half_progress_type,:return_flag,'
    + ':emergency_flag,pk_config.fn_get_operation_pdate(),:sam_seq_no,:sam_seq_no,:old_route_code,'
    + ':driver_code,:boarding_date_time,:bus_stop_id,:boarding_date_time,:alias_no,:total_stop_cnt,'
    + ':trip_stop_cnt,:odometer,:path_code';

function commonBind(trx) {
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
        old_route_code: trx.old_route_code,
        bus_stop_id: trx.bus_stop_id,
        alias_no: trx.alias_no,
        total_stop_cnt: trx.totalStopCnt,
        trip_stop_cnt: trx.trip_stop_cnt,
        // Java bound its iodometer, which only the travel types that run the preparation step
        // ever set; the others leave the event row at zero however far the bus has driven.
        odometer: trx.odometerStart,
        path_code: trx.pathCode,
    };
}

class AfcTfEventDaoImpl extends BaseDao {

    insertSql = `INSERT INTO afc_tf_event(${BUS_COLS}) VALUES(${BUS_VALUES})`;
    insertStationSql = `INSERT INTO afc_tf_event(${STATION_COLS}) VALUES(${STATION_VALUES})`;

    insert(conn, trx, sessionId) {
        return this.exec(conn, this.insertSql, {
            ...commonBind(trx),
            total_fuel_used: trx.total_fuel_used,
            manual_trip_start_time: trx.manual_trip_start_time,
        }, sessionId);
    }

    insertForStation(conn, trx, sessionId) {
        // ins_station binds two literals here rather than the record's own values.
        return this.exec(conn, this.insertStationSql,
            { ...commonBind(trx), sam_seq_no: trx.sam_seq_no, path_code: '0', total_stop_cnt: '0' },
            sessionId);
    }
}

module.exports = new AfcTfEventDaoImpl();
