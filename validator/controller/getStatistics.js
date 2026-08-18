const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const RequestStats = require("../../util/RequestStats");

// Plain text, not XML: Java sent the report straight to the output stream.
class GetStatistics extends ValidatorControllerBase {
    async func(req, res, next) {
        let respErr;
        try {
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.locals.data = RequestStats.report();
        } catch (error) {
            respErr = this.getServiceError(error);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new GetStatistics();
