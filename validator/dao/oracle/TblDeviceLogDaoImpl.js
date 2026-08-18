const BaseDao = require("../BaseDao");

const COLS = 'device_id,sam_id,source,alert_level,time_stamp,scope,description,device_type,pdate';
const VALUES = ':device_id,:sam_id,:source,:alert_level,:time_stamp,:scope,:description,:device_type,'
    + 'pk_config.fn_get_operation_pdate()';

class TblDeviceLogDaoImpl extends BaseDao {

    insertSql = `INSERT INTO tbl_device_log(${COLS}) VALUES(${VALUES})`;

    // The SAM_ID column receives the hostname: that is what the Java statement bound, and the
    // devices have relied on it long enough that fixing it would break the log viewers.
    toBind(trx) {
        return {
            device_id: trx.bus_id,
            sam_id: trx.host_name,
            source: trx.source,
            alert_level: trx.alert_level,
            time_stamp: trx.time_stamp,
            scope: trx.scope,
            description: trx.desc,
            device_type: trx.device_type,
        };
    }

    insert(conn, trx, sessionId) {
        return this.exec(conn, this.insertSql, this.toBind(trx), sessionId);
    }
}

module.exports = new TblDeviceLogDaoImpl();
