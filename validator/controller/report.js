/**
 * Reports the device asks for.
 *
 * The keys of the funcs table at the bottom are the ?func= values this file answers;
 * validator/index.js registers them straight from there.
 */
const { ValidatorControllerBase } = require("../ValidatorControllerBase");


// ---------------------------------------------------------------- ?func=getreport

class GetReport extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " GetReport ",
                ` pdate:${req.query.pDate} pdate2:${req.query.pDate2}`);

            const data = await this.daoImpl.getTdPdate(req.dbConn, {
                busid: req.query.busid ?? null,
                pdate: req.query.pDate ?? null,
                pdate2: req.query.pDate2 ?? req.query.pDate ?? null,
            }, req.sessionId);

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = data;
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


// ---------------------------------------------------------------- ?func=getreportinterval

class GetReportInterval extends ValidatorControllerBase {
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
            await this.setValidatorStatus(req, " GetReportInterval ",
                ` pdate:${req.query.pDate} pdate2:${req.query.pDate2}`);

            const data = await this.daoImpl.tdReportInterval(req.dbConn, {
                busid: req.query.busid ?? null,
                pdate: req.query.pDate ?? null,
                pdate2: req.query.pDate2 ?? req.query.pDate ?? null,
            }, req.sessionId);

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = data;
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


// ---------------------------------------------------------------- ?func=getruninprogressreport

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
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


module.exports = {
    funcs: {
        getreport: new GetReport(),
        getreportinterval: new GetReportInterval(),
        getruninprogressreport: new GetRunInProgressReport(),
    },
};
