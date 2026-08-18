const { ValidatorControllerBase } = require("../ValidatorControllerBase");

// ?ontrip=0 asks for the end-of-shift report; anything else (including a missing value) asks
// for the run-in-progress one. Both procedures take the same four parameters.
class GetRunInProgressReport extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkRepDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getruninprogressreport");

            const binds = {
                samid: req.query.samid ?? null,
                termno: req.query.busid ?? null,
                startdate: req.query.start_date ?? null,
                lang: req.query.lang ?? null,
            };
            const onTrip = req.query.ontrip;
            const data = onTrip === "0"
                ? await this.daoImpl.endOfShiftReport(req.dbConn, binds, req.sessionId)
                : await this.daoImpl.runInProgressReport(req.dbConn, binds, req.sessionId);

            if (data == null) throw new this.ServiceError(-97, "cannot fetch data from db");

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = data;
        } catch (error) {
            respErr = this.getServiceError(error);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new GetRunInProgressReport();
