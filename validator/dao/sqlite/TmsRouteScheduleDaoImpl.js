const SqliteBaseDao = require("./SqliteBaseDao");

// Created empty, with the index the device queries it by.
class TmsRouteScheduleDaoImpl extends SqliteBaseDao {

    ddl = [
        "CREATE TABLE TMS_ROUTE_SCHEDULE (ROUTE_CODE CHAR(5), DIRECTION CHAR(1), "
        + "SCHEDULE_TYPE NUMERIC(2), SCHEDULES VARCHAR)",
        "CREATE INDEX idxTMS_ROUTE_SCHEDULE ON TMS_ROUTE_SCHEDULE (ROUTE_CODE,DIRECTION,SCHEDULE_TYPE)",
    ];
}

module.exports = new TmsRouteScheduleDaoImpl();
