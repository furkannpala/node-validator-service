const { ValidatorControllerBase } = require("../ValidatorControllerBase");

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

module.exports = new GetBusRoutePlan();
