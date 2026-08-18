const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const system_cfg = require("../../config/system_cfg");

// Java answered with <OK code="0" message="<version>"/> from Admin.version_number.
class GetVersion extends ValidatorControllerBase {
    async func(req, res, next) {
        let respErr;
        try {
            res.setHeader("Content-Type", "text/xml");
            res.locals.data = this.getXmlResponse(0, system_cfg.version);
        } catch (error) {
            respErr = this.getServiceError(error);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new GetVersion();
