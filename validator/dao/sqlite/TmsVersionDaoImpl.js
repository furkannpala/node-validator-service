const SqliteBaseDao = require("./SqliteBaseDao");

/**
 * One row per table telling the device how fresh that table is. Seven rows are written up front
 * with fixed values and MST_ROUTE gets its own row later, from the version the route document
 * carries.
 */
class TmsVersionDaoImpl extends SqliteBaseDao {

    ddl = ["CREATE TABLE TMS_VERSION (FILE_NAME VARCHAR, VERSION VARCHAR)"];

    insertSql = "INSERT INTO TMS_VERSION VALUES (?,?)";

    bind(row) {
        return [row.file_name ?? null, row.version ?? null];
    }

    /**
     * The four route tables are stamped with today, the three plan tables with the epoch so the
     * device always considers them stale. The order is the order Java batched them in.
     */
    defaults(currentDate) {
        const epoch = "19700101000000";
        return [
            { file_name: "MST_PATH", version: currentDate },
            { file_name: "TMS_PATH_BUS_STOP", version: currentDate },
            { file_name: "TMS_ROUTE_PATH", version: currentDate },
            { file_name: "TMS_BUS_STOP", version: currentDate },
            { file_name: "MST_TRIP_TYPE", version: epoch },
            { file_name: "TMS_ROUTE_SCHEDULE", version: epoch },
            { file_name: "TMS_SCHEDULE_PLAN", version: epoch },
        ];
    }
}

module.exports = new TmsVersionDaoImpl();
