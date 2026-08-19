const BaseDao = require("../BaseDao");
const { debugSql } = require("../sqlLog");

// One query behind two tables of the route .db file: every row becomes a MST_PATH row and a
// TMS_ROUTE_PATH row. Java bound the same date into all three date ranges, so one named bind
// stands where its three question marks were.
class MstPathDaoImpl extends BaseDao {

    getPathsSql = 'SELECT UPPER(a.path_name) name, c.route_code route_code, '
        + 'c.display_route_code display_route_code, b.direction half_progress_type, '
        + 'a.path_code path_code, a.DESCRIPTION as DESCRIPTION '
        + ' FROM mst_path a, tms_route_path b, mst_route c '
        + " WHERE TO_DATE(:opdate,'YYYYMMDD') BETWEEN a.valid_from AND a.valid_to "
        + " AND TO_DATE(:opdate,'YYYYMMDD') BETWEEN b.valid_from AND b.valid_to "
        + " AND TO_DATE(:opdate,'YYYYMMDD') BETWEEN c.activation_start_date "
        + 'AND c.activation_end_date '
        + ' AND a.path_code = b.path_code AND B.ROUTE_CODE = c.route_code';

    async getPaths(conn, opdate, sessionId) {
        const binds = { opdate };
        debugSql(this.getPathsSql, binds, sessionId);
        const result = await conn.execute(this.getPathsSql, binds, {
            outFormat: this.oracledb.OUT_FORMAT_OBJECT,
            fetchArraySize: 2000,
        });
        return result.rows || [];
    }
}

module.exports = new MstPathDaoImpl();
