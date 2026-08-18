const SqliteBaseDao = require("./SqliteBaseDao");

// Fed by the same query as TMS_ROUTE_PATH; one Oracle row produces one row in each table.
class MstPathDaoImpl extends SqliteBaseDao {

    ddl = [
        "CREATE TABLE MST_PATH (PATH_CODE CHAR(6), PATH_NAME VARCHAR(128),DESCRIPTION VARCHAR(128))",
        "CREATE INDEX idx_MST_PATH ON MST_PATH (PATH_CODE)",
    ];

    insertSql = "INSERT INTO MST_PATH (PATH_CODE,PATH_NAME,DESCRIPTION) VALUES(?,?,?)";

    bind(row) {
        return [row.PATH_CODE ?? null, row.NAME ?? null, row.DESCRIPTION ?? null];
    }
}

module.exports = new MstPathDaoImpl();
