const BaseDao = require("../BaseDao");

// SQL carried over verbatim, Oracle (+) outer joins included. Java returned null for an empty
// result set; here an empty array serves the same purpose and the controller checks length.
class DailyBusRouteDaoImpl extends BaseDao {

    getRoutePlanSql = " SELECT trim(a.route_code) as route_code, b.display_route_code as display_route_code, a.bus_id as bus_id "
        + " FROM daily_bus_route a,mst_route b "
        + " WHERE TRUNC (SYSDATE)  BETWEEN a.activation_start_date  AND a.activation_end_date"
        + " and TRUNC (SYSDATE)  BETWEEN b.activation_start_date(+)  AND b.activation_end_date(+)"
        + " AND a.route_code = b.route_code(+) AND a.BUS_ID=:busid and a.comp_code is null ";

    getRoutePlanWithDriverIdSql = " SELECT trim(a.route_code) route_code, b.display_route_code, a.bus_id "
        + " FROM daily_bus_route a LEFT JOIN mst_route b on a.route_code = b.route_code "
        + " AND TRUNC (SYSDATE) BETWEEN b.activation_start_date AND b.activation_end_date "
        + " INNER JOIN DAILY_BUS_DRIVER c on c.bus_id = a.bus_id "
        + " AND c.driver_code = :driverid "
        + " AND TRUNC (SYSDATE) BETWEEN c.activation_start_date AND c.activation_end_date "
        + " WHERE a.BUS_ID = :busid and TRUNC(SYSDATE) BETWEEN a.activation_start_Date "
        + " AND a.activation_end_date ";

    getRoutePlanWithCompCodeSql = " SELECT distinct trim(a.route_code) as route_code, b.display_route_code as display_route_code, a.comp_code as comp_code "
        + " FROM daily_bus_route a, mst_route b "
        + " WHERE TRUNC (SYSDATE)  BETWEEN a.activation_start_date  AND a.activation_end_date"
        + " AND TRUNC (SYSDATE)  BETWEEN b.activation_start_date(+)  AND b.activation_end_date(+)"
        + " AND a.route_code = b.route_code(+) "
        + " AND a.COMP_CODE = (SELECT DISTINCT COMP_CODE FROM MST_BUS WHERE BUS_ID = :busid AND TRUNC (SYSDATE) BETWEEN VALIDITY_START_DATE AND VALIDITY_END_DATE) ";

    getRoutePlanWithDriverIdAndCompCodeSql = " SELECT trim(a.route_code) route_code, b.display_route_code, a.bus_id, a.comp_code COMP_CODE "
        + " FROM daily_bus_route a LEFT JOIN mst_route b ON a.route_code = b.route_code"
        + " AND TRUNC (SYSDATE) BETWEEN b.activation_start_date AND b.activation_end_date "
        + " INNER JOIN DAILY_BUS_DRIVER c ON c.bus_id = :busid "
        + " AND c.driver_code = :driverid "
        + " AND TRUNC (SYSDATE) BETWEEN c.activation_start_date AND c.activation_end_date "
        + " WHERE a.COMP_CODE = (SELECT DISTINCT COMP_CODE FROM MST_BUS WHERE BUS_ID = :busid2) "
        + "	AND TRUNC(SYSDATE) BETWEEN a.activation_start_Date AND a.activation_end_date ";

    getRoutePlanFromCompRouteSql = "SELECT DISTINCT A.ROUTE_CODE ROUTE_CODE, A.DISPLAY_ROUTE_CODE DISPLAY_ROUTE_CODE, B.COMP_CODE COMP_CODE "
        + "FROM MST_ROUTE A LEFT JOIN MST_COMPANY_ROUTE B ON A.ROUTE_CODE = B.ROUTE_CODE "
        + "WHERE ACTIVATION_END_DATE >= TRUNC(SYSDATE) AND ACTIVATION_START_DATE <= TRUNC(SYSDATE) "
        + "AND b.COMP_CODE = (SELECT COMP_CODE FROM MST_BUS WHERE BUS_ID = :busid AND TRUNC(SYSDATE) BETWEEN VALIDITY_START_DATE AND VALIDITY_END_DATE)";

    async query(conn, sql, binds, sessionId) {
        this.debugSql(sql, binds, sessionId);
        const result = await conn.execute(sql, binds, { outFormat: this.oracledb.OUT_FORMAT_OBJECT });
        return result.rows || [];
    }

    getRoutePlan(conn, busId, sessionId) {
        return this.query(conn, this.getRoutePlanSql, { busid: busId }, sessionId);
    }

    getRoutePlanWithDriverId(conn, busId, driverId, sessionId) {
        return this.query(conn, this.getRoutePlanWithDriverIdSql, { driverid: driverId, busid: busId }, sessionId);
    }

    getRoutePlanWithCompCode(conn, busId, sessionId) {
        return this.query(conn, this.getRoutePlanWithCompCodeSql, { busid: busId }, sessionId);
    }

    // busid appears twice in the Java statement as two separate `?` binds; a named bind cannot
    // repeat with different values, so the second one is busid2 and carries the same value.
    getRoutePlanWithDriverIdAndCompCode(conn, busId, driverId, sessionId) {
        return this.query(conn, this.getRoutePlanWithDriverIdAndCompCodeSql,
            { busid: busId, driverid: driverId, busid2: busId }, sessionId);
    }

    getRoutePlanFromCompRoute(conn, busId, sessionId) {
        return this.query(conn, this.getRoutePlanFromCompRouteSql, { busid: busId }, sessionId);
    }
}

module.exports = new DailyBusRouteDaoImpl();
