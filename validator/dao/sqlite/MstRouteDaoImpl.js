const SqliteBaseDao = require("./SqliteBaseDao");

// Filled from the getroute document rather than a query, which is why its rows arrive as XML
// attributes and not as an Oracle result set.
class MstRouteDaoImpl extends SqliteBaseDao {

    ddl = [
        "CREATE TABLE MST_ROUTE (ROUTE_CODE CHAR(5), REGION_CODE NUMERIC(2), DISPLAY_CODE VARCHAR, "
        + "LINE_START_NAME VARCHAR, LINE_END_NAME VARCHAR, ROUTE_ICON_URL VARCHAR, "
        + "ROUTE_COLOR VARCHAR, ROUTE_TEXT_COLOR VARCHAR)",
        "CREATE INDEX idx_MST_ROUTE ON MST_ROUTE (ROUTE_CODE)",
    ];

    insertSql = "INSERT INTO MST_ROUTE (ROUTE_CODE, DISPLAY_CODE, LINE_START_NAME, LINE_END_NAME, "
        + "REGION_CODE, ROUTE_ICON_URL, ROUTE_COLOR, ROUTE_TEXT_COLOR) VALUES (?,?,?,?,?,?,?,?)";

    /** region_code is the only value Java bound as a number; an unusable one becomes 0. */
    bind(attrs) {
        return [
            attrs.code ?? null,
            attrs.display_code ?? null,
            attrs.start_name ?? null,
            attrs.end_name ?? null,
            this.regionCode(attrs.region_code),
            attrs.route_icon_url ?? null,
            attrs.route_color ?? null,
            attrs.route_text_color ?? null,
        ];
    }

    regionCode(value) {
        const parsed = Number.parseInt(value, 10);
        return Number.isNaN(parsed) ? 0 : parsed;
    }
}

module.exports = new MstRouteDaoImpl();
