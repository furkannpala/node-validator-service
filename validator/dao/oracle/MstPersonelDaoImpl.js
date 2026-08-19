const BaseDao = require("../BaseDao");
const { debugSql } = require("../sqlLog");

// verifydriver picks one of these by the verify_driver_comp config: the second one also
// demands that the driver and the bus belong to the same company.
class MstPersonelDaoImpl extends BaseDao {

    getPinSql = 'SELECT PIN FROM MST_PERSONEL WHERE DRIVER_CODE = :driver_code '
        + 'AND TRUNC(SYSDATE) BETWEEN VALIDITY_START_DATE AND VALIDITY_END_DATE';

    getPinWithCompSql = 'SELECT P.PIN '
        + 'FROM MST_PERSONEL P JOIN MST_BUS B ON P.COMP_CODE = B.COMP_CODE '
        + 'WHERE P.DRIVER_CODE = :driver_code AND B.BUS_ID = :bus_id '
        + 'AND TRUNC(SYSDATE) BETWEEN P.VALIDITY_START_DATE AND P.VALIDITY_END_DATE '
        + 'AND TRUNC(SYSDATE) BETWEEN B.VALIDITY_START_DATE AND B.VALIDITY_END_DATE';

    /** Returns the row so the caller can tell "no driver" from "driver with a null PIN". */
    async getPin(conn, driverId, busId, withComp, sessionId) {
        const sql = withComp ? this.getPinWithCompSql : this.getPinSql;
        const binds = withComp ? { driver_code: driverId, bus_id: busId } : { driver_code: driverId };
        debugSql(sql, binds, sessionId);
        const result = await conn.execute(sql, binds, { outFormat: this.oracledb.OUT_FORMAT_OBJECT });
        return (result.rows || [])[0] || null;
    }
}

module.exports = new MstPersonelDaoImpl();
