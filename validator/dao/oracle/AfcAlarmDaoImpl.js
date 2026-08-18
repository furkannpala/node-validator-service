const BaseDao = require("../BaseDao");
const StringUtil = require("../../../util/StringUtil");

const COLS = 'bus_id,sam_id,route_code,driver_code,alarm_date_time,alarm_button,latitude,longitude,'
    + 'system_entry_date,status,description,half_progress_type,trip_no,pdate,path_code';
// status is the literal '0' and system_entry_date is SYSDATE; neither was ever bound.
const VALUES = ':bus_id,:sam_id,:route_code,:driver_code,:alarm_date_time,:alarm_button,:latitude,'
    + ":longitude,SYSDATE,'0',:description,:half_progress_type,:trip_no,"
    + 'pk_config.fn_get_operation_pdate(),substr(:path_code,1,6)';

class AfcAlarmDaoImpl extends BaseDao {

    insertSql = `INSERT INTO afc_alarm(${COLS}) VALUES(${VALUES})`;

    toBind(data) {
        return {
            bus_id: data.bus_id,
            sam_id: data.sam_id,
            route_code: data.route_code,
            driver_code: data.driver_code,
            alarm_date_time: data.alarm_date_time,
            alarm_button: data.alarm_button,
            // Java parsed both coordinates unguarded, so a non-numeric one fails the record.
            latitude: StringUtil.parseDoubleStrict(data.latitude),
            longitude: StringUtil.parseDoubleStrict(data.longitude),
            description: data.description,
            half_progress_type: data.direction,
            trip_no: data.trip_no,
            path_code: data.path_code,
        };
    }

    insert(conn, data, sessionId) {
        return this.exec(conn, this.insertSql, this.toBind(data), sessionId);
    }
}

module.exports = new AfcAlarmDaoImpl();
