const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const SqliteBuilder = require("../../util/SqliteBuilder");
const Constant = require("../../constant/Constant");

// The free card .db file. Same cache rule as getrouteinfodb, one table instead of nine.
class GenerateFreeCardSqlite extends ValidatorControllerBase {

    async func(req, res, next) {
        let respErr;
        try {
            const data = await this.read(req);

            res.setHeader("Content-Disposition", 'attachment; filename="free_card_sqlite.db"');
            res.locals.data = data;
        } catch (error) {
            respErr = error instanceof this.ServiceError
                ? error : new this.ServiceError(-8, error?.message);
        } finally {
            next(respErr);
        }
    }

    async read(req) {
        const cache = req.query.cache;
        if (cache == null || String(cache).toLowerCase() === "0") {
            return await SqliteBuilder.buildFreeCard(req.dbConn, req.sessionId);
        }
        return SqliteBuilder.readCached(Constant.FREECARD_DB_FILE_PATH)
            ?? await SqliteBuilder.buildFreeCard(req.dbConn, req.sessionId);
    }
}

module.exports = new GenerateFreeCardSqlite();
