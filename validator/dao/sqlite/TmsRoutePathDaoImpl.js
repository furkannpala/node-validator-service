const SqliteBaseDao = require("./SqliteBaseDao");

// The direction column is fed from the half_progress_type alias of the shared query.
class TmsRoutePathDaoImpl extends SqliteBaseDao {

    ddl = [
        "CREATE TABLE TMS_ROUTE_PATH (ROUTE_CODE CHAR(5), PATH_CODE VARCHAR,DIRECTION CHAR(1))",
        "CREATE INDEX idx_TMS_ROUTE_PATH ON TMS_ROUTE_PATH ( ROUTE_CODE,PATH_CODE)",
    ];

    insertSql = "INSERT INTO TMS_ROUTE_PATH (PATH_CODE,ROUTE_CODE,DIRECTION) VALUES(?,?,?)";

    bind(row) {
        return [row.PATH_CODE ?? null, row.ROUTE_CODE ?? null, row.HALF_PROGRESS_TYPE ?? null];
    }
}

module.exports = new TmsRoutePathDaoImpl();
