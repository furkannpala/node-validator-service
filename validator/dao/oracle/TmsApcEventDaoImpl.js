const BaseDao = require("../BaseDao");
const { COLS, VALUES, apcBind } = require("./apcBind");

// Written for every main event 7, whatever the sub event turns out to be.
class TmsApcEventDaoImpl extends BaseDao {

    insertSql = `INSERT INTO TMS_APC_EVENT(${COLS}) values(${VALUES})`;

    insert(conn, trx, sessionId) {
        return this.exec(conn, this.insertSql, apcBind(trx), sessionId);
    }
}

module.exports = new TmsApcEventDaoImpl();
