const SqliteBaseDao = require("./SqliteBaseDao");

// RAD, PARENT and TYPE are read from nowhere: Java bound the literals below on every row.
class TmsBusStopDaoImpl extends SqliteBaseDao {

    ddl = [
        "CREATE TABLE TMS_BUS_STOP (STOP_ID NUMERIC(6), NAME VARCHAR, LAT NUMERIC(10,7), "
        + "LON NUMERIC(10,7), ALT NUMERIC(10,7), RAD NUMERIC(10,7),MD5 VARCHAR,ZONE_ID NUMERIC(2),"
        + "PARENT NUMERIC(6),TYPE NUMERIC(1))",
        "CREATE INDEX idx_TMS_BUS_STOP ON TMS_BUS_STOP (STOP_ID)",
    ];

    insertSql = "INSERT INTO TMS_BUS_STOP (STOP_ID,NAME,LAT,LON,ALT,RAD,MD5,ZONE_ID,PARENT,TYPE) "
        + "VALUES (?,?,?,?,?,?,?,?,?,?)";

    bind(row) {
        return [
            row.BUS_STOP_ID ?? null,
            row.NAME ?? null,
            row.LATITUDE ?? null,
            row.LONGITUDE ?? null,
            row.ALTITUDE ?? null,
            "10",
            row.MD5 ?? null,
            row.ZONE_ID ?? null,
            "0",
            "0",
        ];
    }
}

module.exports = new TmsBusStopDaoImpl();
