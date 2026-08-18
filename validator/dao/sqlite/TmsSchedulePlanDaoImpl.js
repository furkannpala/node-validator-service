const SqliteBaseDao = require("./SqliteBaseDao");

// Created empty, like MST_TRIP_TYPE.
class TmsSchedulePlanDaoImpl extends SqliteBaseDao {

    ddl = [
        "CREATE TABLE TMS_SCHEDULE_PLAN (ACTIVATION_START_TIME CHAR(14), "
        + "ACTIVATION_END_TIME CHAR(14), DAYS CHAR(7), SCHEDULE_TYPE NUMERIC(2), "
        + "PRIORITY NUMERIC(2), UNIQUE (ACTIVATION_START_TIME, ACTIVATION_END_TIME,SCHEDULE_TYPE))",
    ];
}

module.exports = new TmsSchedulePlanDaoImpl();
