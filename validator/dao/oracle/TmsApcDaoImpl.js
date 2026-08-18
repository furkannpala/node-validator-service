const BaseDao = require("../BaseDao");
const { COLS, VALUES, apcBind } = require("./apcBind");

// Written only for sub events 8 and 9 (passenger counts at a stop).
class TmsApcDaoImpl extends BaseDao {

    insertSql = `INSERT INTO TMS_APC(${COLS}) values(${VALUES})`;

    insert(conn, trx, sessionId) {
        return this.exec(conn, this.insertSql, apcBind(trx), sessionId);
    }
}

module.exports = new TmsApcDaoImpl();
