const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const StringUtil = require("../../util/StringUtil");
const { isUniqueViolation } = require("../dao/daoUtil");

const ATTRS = {
    BUS_ID: 'bus_id', ROUTE_CODE: 'route_code', BUS_STOP_ID: 'bus_stop_id',
    HALF_PROGRESS_TYPE: 'hpt', DATE_TIME: 'date_time', TRAVEL_TYPE: 'travel_type',
    TF_SEQ: 'tf_seq', TF_START_DATE: 'tf_start_date', SAM_ID: 'sam_id',
};

// Java's cutZero: parse as an integer and print it back, which drops any leading zeros and
// throws on anything that is not a number. Nothing caught that throw, so the request fails.
const cutZero = (value) => String(StringUtil.parseIntStrict(value));

class OnlineGps extends ValidatorControllerBase {
    constructor() {
        super();
        this.valRouteDao = this.daoFactory.get("TmsValRouteDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " OnlineBusStop ", "");

            const data = {};
            for (const element of this.bodyElements(req)) {
                if (element.name !== "GPSDAT") continue;
                for (const [name, field] of Object.entries(ATTRS)) {
                    if (element.attrs[name] !== undefined) data[field] = element.attrs[name];
                }
                await this.storeOne(req, data);
            }
            this.okResponse(res);
        } catch (error) {
            respErr = this.getServiceError(error);
        } finally {
            next(respErr);
        }
    }

    /** Travel type 8 opens the stop visit and 9 closes it; nothing else is written. */
    async storeOne(req, data) {
        const stop = {
            bus_id: data.bus_id,
            route_code: cutZero(data.route_code),
            bus_stop_id: cutZero(data.bus_stop_id),
            half_progress_type: cutZero(data.hpt),
            arrival_date_time: data.date_time,
            leaving_date_time: data.date_time,
            travel_type: cutZero(data.travel_type),
            travel_seq_no: cutZero(data.tf_seq),
            start_date_time: data.tf_start_date,
            sam_id: data.sam_id,
        };

        try {
            if (stop.travel_type === "8") {
                await this.withTransaction(req.dbConn, () => this.valRouteDao.insert(req.dbConn, stop, req.sessionId));
            } else if (stop.travel_type === "9") {
                await this.withTransaction(req.dbConn, () => this.valRouteDao.updateLeaving(req.dbConn, {
                    leaving_date_time: stop.leaving_date_time,
                    travel_type: stop.travel_type,
                    bus_stop_id: stop.bus_stop_id,
                    start_date_time: stop.start_date_time,
                    sam_id: stop.sam_id,
                    travel_seq_no: stop.travel_seq_no,
                }, req.sessionId));
            }
        } catch (error) {
            if (isUniqueViolation(error)) return;
            throw error;
        }
    }
}

module.exports = new OnlineGps();
