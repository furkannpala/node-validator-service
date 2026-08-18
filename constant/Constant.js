const path = require('path');

// Java Constant.java used System.getProperty("user.dir") (the WebLogic domain dir);
// here the equivalent anchor is the node-app-server working directory.
const BASE_DIR = process.cwd();

module.exports = Object.freeze({
    SQL_EXCEPTION_UNIQUE_INDEX: 1,

    ROUTE_DB_FILE_PATH: path.join(BASE_DIR, 'ValidatorServiceRouteDbFile'),
    FREECARD_DB_FILE_PATH: path.join(BASE_DIR, 'ValidatorServiceFreeCardDbFile'),

    PRODUCTION: 'prod',
    TEST: 'test',

    ANOTHER_BUS_HAS_OPEN_SESSION: -2001,

    // Kept from the Java service: these system ids force currency_multiplier to 1 in code,
    // whatever the config says.
    FORCED_UNIT_MULTIPLIER_SYSTEMS: new Set(['102', '103', '107', '109', '111']),

    BUS_STATION_TYPES: new Set(['1', '5']),

    DEFAULT_CURRENCY_MULTIPLIER: 100,
});
