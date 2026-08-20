const BaseDao = require("../BaseDao");

/**
 * The stop sequence of every path in the route .db file. The two offsets are selected twice:
 * once raw as the _SEC alias and once divided by 60, and the aliases cross over so the minute
 * value keeps the plain name. That is how the device expects to read them.
 */
class TmsPathBusStopDaoImpl extends BaseDao {

    getPathStopsSql = 'SELECT PATH_CODE, BUS_STOP_ID, SEQ_NO,'
        + 'ARRIVAL_OFFSET ARRIVAL_OFFSET_SEC,FLOOR(nvl(ARRIVAL_OFFSET,0)/60) ARRIVAL_OFFSET,'
        + 'DEPARTURE_OFFSET DEPARTURE_OFFSET_SEC,'
        + 'FLOOR(nvl(DEPARTURE_OFFSET,0)/60) DEPARTURE_OFFSET,DISTANCE,STAGE_SEQ_NO,ZONE_ID '
        + " FROM TMS_PATH_BUS_STOP WHERE TO_DATE(:opdate,'YYYYMMDD') BETWEEN VALID_FROM AND VALID_TO "
        + ' AND PATH_CODE IN (SELECT a.PATH_CODE FROM mst_path a, tms_route_path b, mst_route c '
        + "\tWHERE TO_DATE(:opdate,'YYYYMMDD') BETWEEN a.valid_from AND a.valid_to "
        + "\tAND TO_DATE(:opdate,'YYYYMMDD') BETWEEN b.valid_from AND b.valid_to "
        + "\tAND TO_DATE(:opdate,'YYYYMMDD') BETWEEN c.activation_start_date AND c.activation_end_date "
        + '\tAND a.path_code = b.path_code AND B.ROUTE_CODE = c.route_code)';

    async getPathStops(conn, opdate, sessionId) {
        const binds = { opdate };
        this.debugSql(this.getPathStopsSql, binds, sessionId);
        const result = await conn.execute(this.getPathStopsSql, binds, {
            outFormat: this.oracledb.OUT_FORMAT_OBJECT,
            fetchArraySize: 2000,
            // Everything except the two the SQLite side stores as integers is read as text.
            fetchInfo: {
                ARRIVAL_OFFSET: { type: this.oracledb.STRING },
                ARRIVAL_OFFSET_SEC: { type: this.oracledb.STRING },
                DEPARTURE_OFFSET: { type: this.oracledb.STRING },
                DEPARTURE_OFFSET_SEC: { type: this.oracledb.STRING },
                DISTANCE: { type: this.oracledb.STRING },
                STAGE_SEQ_NO: { type: this.oracledb.STRING },
                ZONE_ID: { type: this.oracledb.STRING },
            },
        });
        return result.rows || [];
    }
}

module.exports = new TmsPathBusStopDaoImpl();
