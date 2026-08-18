const SqliteBaseDao = require("./SqliteBaseDao");

// Created empty. The device fills it from gettriptype once it sees the epoch version stamp.
class MstTripTypeDaoImpl extends SqliteBaseDao {

    ddl = [
        "CREATE TABLE MST_TRIP_TYPE (TRIP_TYPE NUMERIC(2), SELL_TICKET NUMERIC(1), "
        + "READ_CARD NUMERIC(1), SHOW_STOP NUMERIC(1), DESCRIPTION VARCHAR(128))",
    ];
}

module.exports = new MstTripTypeDaoImpl();
