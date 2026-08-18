const SqliteBaseDao = require("./SqliteBaseDao");

/**
 * MUMERIC and NUMBERIC below are typos in the Java DDL and are kept: SQLite decides a column
 * affinity from the spelling of its type, so correcting them would change how the device reads
 * the file back.
 */
class TmsPathBusStopDaoImpl extends SqliteBaseDao {

    ddl = [
        "CREATE TABLE TMS_PATH_BUS_STOP (PATH_CODE CHAR(6), BUS_STOP_ID NUMERIC(6),"
        + "ARRIVAL_OFFSET MUMERIC(4),ARRIVAL_OFFSET_SEC NUMERIC(3),DEPARTURE_OFFSET MUMERIC(4),"
        + "DEPARTURE_OFFSET_SEC NUMERIC(3),DISTANCE NUMERIC(10), SEQ_NO NUMERIC(3) ,"
        + "STAGE_SEQ_NO NUMBERIC(3), ZONE_ID NUMERIC (2))",
        "CREATE INDEX idx_TMS_PATH_BUS_STOP ON TMS_PATH_BUS_STOP (PATH_CODE)",
    ];

    insertSql = "INSERT INTO TMS_PATH_BUS_STOP (PATH_CODE,BUS_STOP_ID,SEQ_NO,ARRIVAL_OFFSET,"
        + "DEPARTURE_OFFSET,DISTANCE,STAGE_SEQ_NO,ZONE_ID,ARRIVAL_OFFSET_SEC,DEPARTURE_OFFSET_SEC) "
        + "VALUES(?,?,?,?,?,?,?,?,?,?)";

    /** Only these two came off the result set as numbers, and a null one read back as 0. */
    bind(row) {
        return [
            row.PATH_CODE ?? null,
            this.int(row.BUS_STOP_ID),
            this.int(row.SEQ_NO),
            row.ARRIVAL_OFFSET ?? null,
            row.DEPARTURE_OFFSET ?? null,
            row.DISTANCE ?? null,
            row.STAGE_SEQ_NO ?? null,
            row.ZONE_ID ?? null,
            row.ARRIVAL_OFFSET_SEC ?? null,
            row.DEPARTURE_OFFSET_SEC ?? null,
        ];
    }

    int(value) {
        const parsed = Number.parseInt(value, 10);
        return Number.isNaN(parsed) ? 0 : parsed;
    }
}

module.exports = new TmsPathBusStopDaoImpl();
