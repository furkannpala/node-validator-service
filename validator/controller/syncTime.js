const { ValidatorControllerBase } = require("../ValidatorControllerBase");

// Answers a bare <TIMESYNC datetime="yyyyMMddHHmmss"/>; no database, no validator status.
class SyncTime extends ValidatorControllerBase {
    async func(req, res, next) {
        let respErr;
        try {
            res.setHeader("Content-Type", "text/xml");
            res.locals.data = this.js2Xml({
                TIMESYNC: { _attributes: { datetime: this.moment().format("YYYYMMDDHHmmss") } },
            });
        } catch (error) {
            respErr = this.getServiceError(error);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new SyncTime();
