const { ValidatorControllerBase } = require("../ValidatorControllerBase");

/**
 * Integer.parseInt's own message, which this endpoint sends straight back to the device: a
 * missing value reads as the four characters "null", anything else as For input string.
 */
function javaParseInt(value) {
    if (value === null || value === undefined) throw new Error("null");
    if (!/^[+-]?\d+$/.test(String(value))) throw new Error(`For input string: "${value}"`);
    return Number(value);
}

class GetRouteBusStop extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
        // Java replaced the database failure with this text before it reached the
        // device; the ORA code only goes to the log.
        this.dbErrorMessage = "Database error occurred";
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getroutebusstop ",
                ` version:${req.query.version} groupid:${req.query.groupid}`);

            const answer = await this.fetch(req);
            if (answer.raw !== undefined) {
                res.locals.data = answer.raw;
            } else {
                if (answer.data == null) throw new this.ServiceError(-99, "error");
                res.setHeader("Content-Type", "text/xml");
                res.locals.data = answer.data;
            }
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }

    /**
     * This endpoint has a catch of its own in Java that answers with the bare exception text —
     * no XML document, no error code, no content type — so a failure here is not an error path.
     */
    async fetch(req) {
        try {
            return {
                data: await this.daoImpl.createRouteBusStop(req.dbConn, {
                    version: req.query.version ?? null,
                    groupid: javaParseInt(req.query.groupid),
                    samid: req.query.samid ?? null,
                }, req.sessionId),
            };
        } catch (error) {
            this.ULog.error(error?.stack || error?.message, req.sessionId);
            return { raw: String(error?.message ?? "") };
        }
    }
}

module.exports = new GetRouteBusStop();
