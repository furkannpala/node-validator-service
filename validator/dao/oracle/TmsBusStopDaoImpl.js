const BaseDao = require("../BaseDao");

// Feeds the TMS_BUS_STOP table of the route .db file. Java read every column with getString,
// so the numeric ones are fetched as strings here too: SQLite stores what it is handed, and a
// number formatted by the driver is not always the text Oracle would have produced.
class TmsBusStopDaoImpl extends BaseDao {

    getStopsSql = 'SELECT BUS_STOP_ID,NAME,ZONE_ID,LATITUDE,LONGITUDE,ALTITUDE,MD5 '
        + 'FROM TMS_BUS_STOP WHERE :opdate BETWEEN ACTIVATION_START_DATETIME '
        + 'AND ACTIVATION_END_DATETIME';

    async getStops(conn, opdate, sessionId) {
        const binds = { opdate };
        this.debugSql(this.getStopsSql, binds, sessionId);
        const result = await conn.execute(this.getStopsSql, binds, {
            outFormat: this.oracledb.OUT_FORMAT_OBJECT,
            fetchArraySize: 2000,
            fetchInfo: {
                BUS_STOP_ID: { type: this.oracledb.STRING },
                ZONE_ID: { type: this.oracledb.STRING },
                LATITUDE: { type: this.oracledb.STRING },
                LONGITUDE: { type: this.oracledb.STRING },
                ALTITUDE: { type: this.oracledb.STRING },
            },
        });
        return result.rows || [];
    }
}

module.exports = new TmsBusStopDaoImpl();
