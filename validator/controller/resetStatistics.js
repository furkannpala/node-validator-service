const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const RequestStats = require("../../util/RequestStats");

// Java cleared the counters and then immediately counted this very call.
class ResetStatistics extends ValidatorControllerBase {
    async func(req, res, next) {
        let respErr;
        try {
            RequestStats.reset();
            RequestStats.add(res.locals.systemId, "resetStatistics");
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.locals.data = "OK";
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new ResetStatistics();
