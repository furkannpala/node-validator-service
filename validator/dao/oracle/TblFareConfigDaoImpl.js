const BaseDao = require("../BaseDao");

// Which card types the host prices centrally. getuncalculatedtransaction only has a query for
// type 09; Java left the 11 branch empty and the others are not considered at all.
class TblFareConfigDaoImpl extends BaseDao {

    getActiveCardTypesSql = "select card_type from tbl_fare_config where status='1'";

    async getActiveCardTypes(conn, sessionId) {
        this.ULog.debug(this.getActiveCardTypesSql, sessionId);
        const result = await conn.execute(this.getActiveCardTypesSql, [],
            { outFormat: this.oracledb.OUT_FORMAT_ARRAY });
        return (result.rows || []).map((row) => row[0]);
    }
}

module.exports = new TblFareConfigDaoImpl();
