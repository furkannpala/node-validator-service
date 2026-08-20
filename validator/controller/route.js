/**
 * Routes, paths, stops and stages — the network the vehicle drives, and the SQLite copy the device downloads.
 *
 * The keys of the funcs table at the bottom are the ?func= values this file answers;
 * validator/index.js registers them straight from there.
 */
const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const SqliteBuilder = require("../../util/SqliteBuilder");
const Constant = require("../../constant/Constant");


// ---------------------------------------------------------------- ?func=getroute

class GetRoute extends ValidatorControllerBase {
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
            await this.setValidatorStatus(req, " GetRoute  ",
                ` busid:${req.query.busid} version:${req.query.version}`);

            const data = await this.daoImpl.getRoute(req.dbConn, {
                version: req.query.version ?? null,
                busid: req.query.busid ?? null,
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


// ---------------------------------------------------------------- ?func=getroutepath

class GetRoutePath extends ValidatorControllerBase {
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
            await this.setValidatorStatus(req, " GetRoutePath  ",
                ` busid:${req.query.busid} version:${req.query.version}`);

            const data = await this.daoImpl.getRoutePath(req.dbConn, {
                version: req.query.version ?? null,
                busid: req.query.busid ?? null,
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


// ---------------------------------------------------------------- ?func=getroutebusstop

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


// ---------------------------------------------------------------- ?func=getroutecoordinate

class GetRouteCoordinate extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getRouteCoordinate ",
                ` routecode:${req.query.routecode} version:${req.query.version}`);

            const data = await this.daoImpl.getRouteCoordinate(req.dbConn, {
                routecode: req.query.routecode ?? null,
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


// ---------------------------------------------------------------- ?func=getrouteschedule

class GetRouteSchedule extends ValidatorControllerBase {
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
            await this.setValidatorStatus(req, " GetRouteSchedule  ",
                ` busid:${req.query.busid} version:${req.query.version}`);

            const data = await this.daoImpl.getRouteSchedule(req.dbConn, {
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


// ---------------------------------------------------------------- ?func=getpath

class GetPath extends ValidatorControllerBase {
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
            await this.setValidatorStatus(req, " GetPath  ",
                ` busid:${req.query.busid} version:${req.query.version}`);

            const data = await this.daoImpl.getPath(req.dbConn, {
                version: req.query.version ?? null,
                busid: req.query.busid ?? null,
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


// ---------------------------------------------------------------- ?func=getpathbusstop

class GetPathBusStop extends ValidatorControllerBase {
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
            await this.setValidatorStatus(req, " GetPathBusStop  ",
                ` busid:${req.query.busid} version:${req.query.version} groupid:${req.query.groupid}`);

            const data = await this.daoImpl.getPathBusStop(req.dbConn, {
                version: req.query.version ?? null,
                busid: req.query.busid ?? null,
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


// ---------------------------------------------------------------- ?func=getpathstage

class GetPathStage extends ValidatorControllerBase {
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
            await this.setValidatorStatus(req, " GetPathStage  ",
                ` busid:${req.query.busid} version:${req.query.version}`);

            const data = await this.daoImpl.getPathStage(req.dbConn, {
                version: req.query.version ?? null,
                busid: req.query.busid ?? null,
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


// ---------------------------------------------------------------- ?func=getstage

class GetStage extends ValidatorControllerBase {
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
            await this.setValidatorStatus(req, " GetStage  ",
                ` busid:${req.query.busid} version:${req.query.version}`);

            const data = await this.daoImpl.getStage(req.dbConn, {
                version: req.query.version ?? null,
                busid: req.query.busid ?? null,
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


// ---------------------------------------------------------------- ?func=getbusstop

class GetBusStop extends ValidatorControllerBase {
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
            await this.setValidatorStatus(req, " getbusstop ",
                ` version:${req.query.version}`);

            const data = await this.daoImpl.createBusStop(req.dbConn, {
                version: req.query.version ?? null,
                samid: req.query.samid ?? null,
            }, req.sessionId);

            if (data == null) throw new this.ServiceError(-99, "error");

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = data;
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


// ---------------------------------------------------------------- ?func=getrouteinfodb

/**
 * The route .db file the device downloads once a day. ?cache=1 hands back today's file if it
 * has already been produced; anything else, including no value at all, rebuilds it.
 */
class GetRouteInfoDb extends ValidatorControllerBase {

    async func(req, res, next) {
        let respErr;
        try {
            const data = await this.read(req);

            res.setHeader("Content-Disposition", 'attachment; filename="route_info_sqlite.db"');
            res.locals.data = data;
        } catch (error) {
            // Java replaced the failure with one message and kept the detail in the log only.
            respErr = error instanceof this.ServiceError
                ? error : new this.ServiceError(-8, error?.message);
        } finally {
            next(respErr);
        }
    }

    async read(req) {
        if (this.rebuilds(req.query.cache)) {
            return await SqliteBuilder.buildRouteInfo(req.dbConn, req.query, req.sessionId);
        }
        return SqliteBuilder.readCached(Constant.ROUTE_DB_FILE_PATH)
            ?? await SqliteBuilder.buildRouteInfo(req.dbConn, req.query, req.sessionId);
    }

    /** A missing cache parameter and cache=0 both mean "build it now". */
    rebuilds(cache) {
        return cache == null || String(cache).toLowerCase() === "0";
    }
}


module.exports = {
    funcs: {
        getroute: new GetRoute(),
        getroutepath: new GetRoutePath(),
        getroutebusstop: new GetRouteBusStop(),
        getroutecoordinate: new GetRouteCoordinate(),
        getrouteschedule: new GetRouteSchedule(),
        getpath: new GetPath(),
        getpathbusstop: new GetPathBusStop(),
        getpathstage: new GetPathStage(),
        getstage: new GetStage(),
        getbusstop: new GetBusStop(),
        getrouteinfodb: new GetRouteInfoDb(),
    },
};
