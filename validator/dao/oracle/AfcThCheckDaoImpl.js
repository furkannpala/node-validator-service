const BaseDao = require("../BaseDao");

// A driver may only have one open shift. Any AFC_TH row for today on another SAM means the
// previous bus never closed its session.
class AfcThCheckDaoImpl extends BaseDao {

    anotherSessionSql = "SELECT 1 FROM AFC_TH WHERE PDATE = pk_config.FN_GET_OPERATION_PDATE() "
        + "AND SAM_ID != :sam_id AND LPAD(TRIM(DRIVER_CODE), 5, '0') = LPAD(TRIM(:driver_code), 5, '0') "
        + "AND TRAVEL_TYPE = '3'";

    async isAnotherSessionExists(conn, samId, driverId, sessionId) {
        const binds = { sam_id: samId, driver_code: driverId };
        this.ULog.debug(this.anotherSessionSql + " " + this.maskJson(binds), sessionId);
        const result = await conn.execute(this.anotherSessionSql, binds);
        return (result.rows || []).length > 0;
    }
}

module.exports = new AfcThCheckDaoImpl();
