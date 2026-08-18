const BaseDao = require("../BaseDao");

const COLS = 'bus_id, date_time, lat, lng, param_id, param_value, system_entry_date, pdate';
const VALUES = ':bus_id,:date_time,:lat,:lng,:param_id,:param_value,sysdate,'
    + 'pk_config.fn_get_operation_pdate()';

// The CANDAT half of a sendgps body: one row per VAL element under the CANDAT element.
class CanDataDaoImpl extends BaseDao {

    insertSql = `INSERT INTO can_data(${COLS}) values(${VALUES})`;

    insert(conn, data, sessionId) {
        return this.exec(conn, this.insertSql, data, sessionId);
    }
}

module.exports = new CanDataDaoImpl();
