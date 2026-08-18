const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const KpgClient = require("../../util/KpgClient");

// The settlement counterpart of realauth: the same proxy, a different gateway action.
class SendEmvData extends ValidatorControllerBase {

    async func(req, res, next) {
        let respErr;
        try {
            res.locals.data = await KpgClient.call(
                this.cfg(req, "credit_card_auth_url", ""), "sendEMVData",
                res.locals.systemId, req.rawBody, this.kpgTimeouts(req), req.sessionId);
        } catch (error) {
            respErr = error instanceof this.ServiceError
                ? error : new this.ServiceError(this.ErrorCodes.GENERIC_ERROR.code, error?.message);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new SendEmvData();
