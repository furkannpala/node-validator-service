const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const KpgClient = require("../../util/KpgClient");

// The online authorisation request of a contactless payment. No database work at all: Java ran
// this branch before it ever took a connection.
class RealAuth extends ValidatorControllerBase {

    async func(req, res, next) {
        let respErr;
        try {
            res.locals.data = await KpgClient.call(
                this.cfg(req, "credit_card_auth_url", ""), "realAuth",
                res.locals.systemId, req.rawBody, this.kpgTimeouts(req), req.sessionId);
        } catch (error) {
            // Java let the IOException out of doProcess, where it became a -99 reply.
            respErr = error instanceof this.ServiceError
                ? error : new this.ServiceError(this.ErrorCodes.GENERIC_ERROR.code, error?.message);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new RealAuth();
