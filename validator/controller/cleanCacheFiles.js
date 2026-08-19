const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const FileCacheManager = require("../../util/FileCacheManager");

// Empties the download cache by hand. The scheduled version of this is the cacheCleanup job.
class CleanCacheFiles extends ValidatorControllerBase {

    async func(req, res, next) {
        let respErr;
        try {
            FileCacheManager.cleanDirectory();
            this.okResponse(res);
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new CleanCacheFiles();
