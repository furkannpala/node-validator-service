/**
 * The payment gateway proxies. Both forward the device body untouched and answer with the gateway's reply.
 *
 * The keys of the funcs table at the bottom are the ?func= values this file answers;
 * validator/index.js registers them straight from there.
 */
const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const KpgClient = require("../../util/KpgClient");


// ---------------------------------------------------------------- ?func=realauth

// The online authorisation request of a contactless payment. No database work at all: Java ran
// this branch before it ever took a connection.
class RealAuth extends ValidatorControllerBase {

    async func(req, res, next) {
        let respErr;
        try {
            res.locals.data = await KpgClient.call(
                this.cfg(req, "credit_card_auth_url", ""), "realAuth",
                res.locals.systemId, req.rawBody, this.kpgTimeouts(req));
        } catch (error) {
            // Java let the IOException out of doProcess, where it became a -99 reply.
            respErr = error instanceof this.ServiceError
                ? error : new this.ServiceError(this.ErrorCodes.GENERIC_ERROR.code, error?.message);
        } finally {
            next(respErr);
        }
    }
}


// ---------------------------------------------------------------- ?func=sendemvdata

// The settlement counterpart of realauth: the same proxy, a different gateway action.
class SendEmvData extends ValidatorControllerBase {

    async func(req, res, next) {
        let respErr;
        try {
            res.locals.data = await KpgClient.call(
                this.cfg(req, "credit_card_auth_url", ""), "sendEMVData",
                res.locals.systemId, req.rawBody, this.kpgTimeouts(req));
        } catch (error) {
            respErr = error instanceof this.ServiceError
                ? error : new this.ServiceError(this.ErrorCodes.GENERIC_ERROR.code, error?.message);
        } finally {
            next(respErr);
        }
    }
}


module.exports = {
    funcs: {
        realauth: new RealAuth(),
        sendemvdata: new SendEmvData(),
    },
};
