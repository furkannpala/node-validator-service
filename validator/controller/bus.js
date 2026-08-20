/**
 * Buses and vehicles: the fleet a validator identifies itself against.
 *
 * The keys of the funcs table at the bottom are the ?func= values this file answers;
 * validator/index.js registers them straight from there.
 */
const { ValidatorControllerBase } = require("../ValidatorControllerBase");


// ---------------------------------------------------------------- ?func=getbusinfo

class GetBusInfo extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " GetBusInfo ",
                `OldBusid:${req.query.oldbusid}Validatorid:${req.query.validatorid}Datetime:${req.query.datetime}Samid:${req.query.samid}Seqno:${req.query.seqno}`);

            const data = await this.daoImpl.getDeviceInfo(req.dbConn, {
                busid: req.query.busid ?? null,
                samid: req.query.samid ?? null,
                validatorid: req.query.validatorid ?? null,
                datetime: req.query.datetime ?? null,
                oldbusid: req.query.oldbusid ?? null,
                seqno: req.query.seqno ?? null,
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


// ---------------------------------------------------------------- ?func=getbusparkplace

class GetBusParkPlace extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getBusParkPlace ",
                ` pdate:${req.query.pdate} busid:${req.query.busid}`);

            const data = await this.daoImpl.getBusParkPlace(req.dbConn, {
                pdate: req.query.pdate ?? null,
                busid: req.query.busid ?? null,
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


// ---------------------------------------------------------------- ?func=getbusroute

// The only read endpoint that answers with a plain OK instead of a payload: the procedure
// returns a route count and Java only used it as a validity check.
class GetBusRoute extends ValidatorControllerBase {
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
            await this.setValidatorStatus(req, " getbusroute ", ` routecode:${req.query.routecode}`);

            const routeCnt = await this.daoImpl.getBusRouteList(req.dbConn, {
                busid: req.query.busid ?? null,
                routecode: req.query.routecode ?? null,
            }, req.sessionId);

            if (!(routeCnt > 0)) throw new Error("Route count is less than or equal to zero.");

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = this.getXmlResponse(0, "");
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


// ---------------------------------------------------------------- ?func=getbusrouteplan

/**
 * Four possible sources, tried in the order Java tried them, then hand-built XML.
 * route_code "-1" is a sentinel meaning "display all routes" and short-circuits the whole list.
 */
class GetBusRoutePlan extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("DailyBusRouteDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getBusRoutePlan ",
                ` samid:${req.query.samid} busid:${req.query.busid}`);

            const plans = await this.loadPlans(req);
            res.setHeader("Content-Type", "text/xml");
            res.locals.data = this.buildXml(plans, req);
        } catch (error) {
            // Java answered 200 with the exception text as the body instead of an error code.
            this.ULog.error(error?.stack || error?.message, req.sessionId);
            res.setHeader("Content-Type", "text/xml");
            res.locals.data = String(error?.message);
        } finally {
            next(respErr);
        }
    }

    async loadPlans(req) {
        const busId = req.query.busid;
        const driverId = req.query.driverid;
        const conn = req.dbConn;
        const withDriver = this.cfgBool(req, "getbusrouteplan_driverid_query", false) && !!driverId;
        const withCompCode = this.cfgBool(req, "getbusrouteplan_compcode_query", false);

        let plans;
        if (withDriver) {
            plans = await this.daoImpl.getRoutePlanWithDriverId(conn, busId, driverId, req.sessionId);
            if (!plans.length && withCompCode) {
                plans = await this.daoImpl.getRoutePlanWithDriverIdAndCompCode(conn, busId, driverId, req.sessionId);
            }
        } else {
            plans = await this.daoImpl.getRoutePlan(conn, busId, req.sessionId);
            if (!plans.length && withCompCode) {
                plans = await this.daoImpl.getRoutePlanWithCompCode(conn, busId, req.sessionId);
            }
        }

        if (!plans.length && withCompCode && !withDriver) {
            plans = await this.daoImpl.getRoutePlanFromCompRoute(conn, busId, req.sessionId);
        }
        return { plans, withDriver };
    }

    buildXml({ plans, withDriver }, req) {
        const routes = [];
        for (const plan of plans) {
            if (plan.ROUTE_CODE === "-1") {
                return this.js2Xml({ ERROR: { _attributes: { code: "-20098", message: "display all routes" } } });
            }
            const attrs = { ROUTE_CODE: plan.ROUTE_CODE };
            if (withDriver) attrs.DRIVER_ID = req.query.driverid;
            if (plan.COMP_CODE) attrs.COMP_CODE = plan.COMP_CODE;
            attrs.DISPLAY_ROUTE_CODE = plan.DISPLAY_ROUTE_CODE;
            routes.push({ _attributes: attrs });
        }

        if (!routes.length) {
            return this.js2Xml({ ERROR: { _attributes: { code: "-1", message: "no plan found" } } });
        }
        return this.js2Xml({ ROOT: { ROUTE: routes } });
    }
}


// ---------------------------------------------------------------- ?func=getvehiclestop

class GetVehicleStop extends ValidatorControllerBase {
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
            await this.setValidatorStatus(req, " GetVehicleStop  ",
                ` busid:${req.query.busid} version:${req.query.version}`);

            const data = await this.daoImpl.getBusStop(req.dbConn, {
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


module.exports = {
    funcs: {
        getbusinfo: new GetBusInfo(),
        getbusparkplace: new GetBusParkPlace(),
        getbusroute: new GetBusRoute(),
        getbusrouteplan: new GetBusRoutePlan(),
        getvehiclestop: new GetVehicleStop(),
    },
};
