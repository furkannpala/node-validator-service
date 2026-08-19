const BaseDao = require("../BaseDao");
const { debugSql } = require("../sqlLog");

/**
 * senddata's gatekeeper. The bus must exist for the station type it claims, and on the bus
 * paths the company code decides which strategy and which fare rules apply.
 */
class MstBusDaoImpl extends BaseDao {

    checkStationSql = 'select * from mst_bus where bus_id=:bus_id and  station_type=:station_type';

    // Java read only comp_code here, without any validity window.
    checkCompanySql = ' select comp_code from mst_bus where bus_id =:bus_id ';

    findCompSql = ' SELECT comp_code, depot_code FROM mst_bus '
        + 'WHERE bus_id=:bus_id and validity_start_date <= pk_config.fn_get_operation_date(:opdate1) '
        + 'and validity_end_date >= pk_config.fn_get_operation_date(:opdate2) ';

    async query(conn, sql, binds, sessionId) {
        debugSql(sql, binds, sessionId);
        const result = await conn.execute(sql, binds,
            { outFormat: this.oracledb.OUT_FORMAT_OBJECT, autoCommit: false });
        return result.rows || [];
    }

    /** False means the request is rejected with the mst_bus validation message. */
    async checkStation(conn, busId, stationType, sessionId) {
        const rows = await this.query(conn, this.checkStationSql,
            { bus_id: busId, station_type: stationType }, sessionId);
        return rows.length > 0;
    }

    /** Java defaulted a missing row to company 0, which is what routes 106 to the legacy path. */
    async getCompCode(conn, busId, sessionId) {
        const rows = await this.query(conn, this.checkCompanySql, { bus_id: busId }, sessionId);
        return rows.length ? Number(rows[0].COMP_CODE ?? 0) : 0;
    }

    // The same date is bound twice because the Java statement repeats the placeholder.
    async findComp(conn, busId, startDateTime, sessionId) {
        const rows = await this.query(conn, this.findCompSql,
            { bus_id: busId, opdate1: startDateTime, opdate2: startDateTime }, sessionId);
        return rows[0] || null;
    }
}

module.exports = new MstBusDaoImpl();
