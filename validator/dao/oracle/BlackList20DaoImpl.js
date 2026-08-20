const BaseDao = require("../BaseDao");

// The free card list, copied whole into the generated .db file. Java read every column with
// getString, so BLACK_LIST comes back as text here too.
class BlackList20DaoImpl extends BaseDao {

    getFreeCardsSql = 'SELECT CSN,EXPIRED_DATE,PASSENGER_TYPE,BLACK_LIST,CARD_NO FROM black_list_20';

    async getFreeCards(conn, sessionId) {
        this.debugSql(this.getFreeCardsSql, undefined, sessionId);
        const result = await conn.execute(this.getFreeCardsSql, [], {
            outFormat: this.oracledb.OUT_FORMAT_OBJECT,
            fetchArraySize: 2000,
            fetchInfo: { BLACK_LIST: { type: this.oracledb.STRING } },
        });
        return result.rows || [];
    }
}

module.exports = new BlackList20DaoImpl();
