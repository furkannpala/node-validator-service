/**
 * Schedules, plans, trip types and the rules that drive them.
 *
 * The keys of the funcs table at the bottom are the ?func= values this file answers;
 * validator/index.js registers them straight from there.
 */
const { ValidatorControllerBase } = require("../ValidatorControllerBase");


// ---------------------------------------------------------------- ?func=getschedule

class GetSchedule extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " GetSchedule ",
                ` driver_id:${req.query.driverid}`);

            const data = await this.daoImpl.createSchedule(req.dbConn, {
                busid: req.query.busid ?? null,
                driverid: req.query.driverid ?? null,
                routecode: req.query.routecode ?? null,
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


// ---------------------------------------------------------------- ?func=getscheduleplan

class GetSchedulePlan extends ValidatorControllerBase {
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
            await this.setValidatorStatus(req, " GetSchedulePlan  ",
                ` busid:${req.query.busid}`);

            const data = await this.daoImpl.getSchedulePlan(req.dbConn, {
                busid: req.query.busid ?? null,
                version: req.query.version ?? null,
                opdate: req.query.opdate ?? null,
            }, req.sessionId);

            if (data == null) throw new this.ServiceError(-97, "error");

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = data;
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


// ---------------------------------------------------------------- ?func=gettriptype

class GetTripType extends ValidatorControllerBase {
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
            await this.setValidatorStatus(req, " GetTripType  ",
                ` busid:${req.query.busid}`);

            const data = await this.daoImpl.getTripType(req.dbConn, {
                busid: req.query.busid ?? null,
            }, req.sessionId);

            if (data == null) throw new this.ServiceError(-97, "error");

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = data;
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


// ---------------------------------------------------------------- ?func=getdutyschedule

class GetDutySchedule extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " GetDutySchedule  ",
                ` busid:${req.query.busid} version:${req.query.version}`);

            const data = await this.daoImpl.getDutySchedule(req.dbConn, {
                version: req.query.version ?? null,
                busid: req.query.busid ?? null,
                showtime: req.query.timeunit ?? "0",
                opdate: req.query.opdate ?? null,
            }, req.sessionId);

            if (data == null) throw new this.ServiceError(-97, "error");

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = data;
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


// ---------------------------------------------------------------- ?func=getavlrules

class GetAvlRules extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getAvlRules ",
                ` samid:${req.query.samid} busid:${req.query.busid}`);

            const data = await this.daoImpl.getAvlRules(req.dbConn, {
                busid: req.query.busid ?? null,
                version: req.query.version ?? null,
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


module.exports = {
    funcs: {
        getschedule: new GetSchedule(),
        getscheduleplan: new GetSchedulePlan(),
        gettriptype: new GetTripType(),
        getdutyschedule: new GetDutySchedule(),
        getavlrules: new GetAvlRules(),
    },
};
