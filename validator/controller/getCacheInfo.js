const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const FileCacheManager = require("../../util/FileCacheManager");

// Plain text dump of the cache state; Java answered before any database work was done.
class GetCacheInfo extends ValidatorControllerBase {
    async func(req, res, next) {
        let respErr;
        try {
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.locals.data = FileCacheManager.getInfo();
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new GetCacheInfo();
