const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const SqliteBuilder = require("../../util/SqliteBuilder");
const Constant = require("../../constant/Constant");

/**
 * The route .db file the device downloads once a day. ?cache=1 hands back today's file if it
 * has already been produced; anything else, including no value at all, rebuilds it.
 */
class GetRouteInfoDb extends ValidatorControllerBase {

    async func(req, res, next) {
        let respErr;
        try {
            const data = await this.read(req);

            res.setHeader("Content-Disposition", 'attachment; filename="route_info_sqlite.db"');
            res.locals.data = data;
        } catch (error) {
            // Java replaced the failure with one message and kept the detail in the log only.
            respErr = error instanceof this.ServiceError
                ? error : new this.ServiceError(-8, error?.message);
        } finally {
            next(respErr);
        }
    }

    async read(req) {
        if (this.rebuilds(req.query.cache)) {
            return await SqliteBuilder.buildRouteInfo(req.dbConn, req.query, req.sessionId);
        }
        return SqliteBuilder.readCached(Constant.ROUTE_DB_FILE_PATH)
            ?? await SqliteBuilder.buildRouteInfo(req.dbConn, req.query, req.sessionId);
    }

    /** A missing cache parameter and cache=0 both mean "build it now". */
    rebuilds(cache) {
        return cache == null || String(cache).toLowerCase() === "0";
    }
}

module.exports = new GetRouteInfoDb();
