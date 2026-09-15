/**
 * Position and telemetry, both the batched upload and the live one.
 *
 * The keys of the funcs table at the bottom are the ?func= values this file answers;
 * validator/index.js registers them straight from there.
 */
const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const GpsTransaction = require("../transaction/GpsTransaction");
const StringUtil = require("../../util/StringUtil");
const XmlWalk = require("../../util/XmlWalk");
const { isUniqueViolation } = require("../dao/daoUtil");


// ---------------------------------------------------------------- ?func=sendgps

// ORA-01438: value larger than the column allows. Java skipped the record for it, same as ORA-1.
const VALUE_TOO_LARGE = 1438;

// The CANDAT half of the payload was read with compareToIgnoreCase throughout.
function lowerKeys(attrs) {
    const out = {};
    for (const [name, value] of Object.entries(attrs || {})) out[name.toLowerCase()] = value;
    return out;
}

/** The coordinate is stored as text; Java replaced it with "0.0" only when it would not parse. */
function coordinateOrZero(value) {
    const text = value || "";
    return StringUtil.tryParseDouble(text, null) === null ? "0.0" : text;
}

class SendGps extends ValidatorControllerBase {
    constructor() {
        super();
        this.gpsDao = this.daoFactory.get("TmsGpsDaoImpl");
        this.canDataDao = this.daoFactory.get("CanDataDaoImpl");
        this.apcDao = this.daoFactory.get("TmsApcDaoImpl");
        this.apcEventDao = this.daoFactory.get("TmsApcEventDaoImpl");
        this.doorDao = this.daoFactory.get("TmsDoorStatusDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            const dbEnabled = !this.kafkaOnly(req, "sendgps");
            const toKafka = this.kafkaEnabled(req, "sendgps");
            if (dbEnabled) {
                await this.setValidatorStatus(req, " SendGPS ",
                    ` Stationtype :${req.query.stationtype} arch :${req.query.arch}`);
            }

            // Twelve hours ahead of now: a device whose clock runs further into the future than
            // that is considered broken and its positions are dropped.
            const horizon = this.moment().add(12, "hours").format("YYYYMMDDHHmmss");
            // One bean for the whole body, as in Java: the CANDAT message overwrites only six
            // of its fields, so it carries whatever the last GPSDAT element left behind.
            const trx = new GpsTransaction();

            for (const element of this.bodyElements(req)) {
                if (element.name === "GPSDAT") {
                    trx.applyAttrs(element.attrs);
                    // Produced before the clock check, which lives on the database side only.
                    if (toKafka) {
                        await this.produceKafka(req, "sendgps", trx.toKafkaGpsPayload(), trx.sam_id);
                    }
                    if (dbEnabled) await this.storeGpsdat(req, trx, horizon);
                } else if (element.name === "CANDAT") {
                    await this.handleCandat(req, element, trx, dbEnabled, toKafka);
                }
            }
            this.okResponse(res);
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }

    /** One position plus whatever passenger counters came with it: a single record. */
    async storeGpsdat(req, trx, horizon) {
        const stamp = StringUtil.tryParseLong(trx.date_time, null);
        if (stamp === null || stamp > Number(horizon)) return;

        // Padded up to five characters but never truncated: Java only entered the pad loop
        // when the code was shorter, and a longer one went to the column untouched.
        const routeCode = trx.route_code == null || trx.route_code.length >= 5
            ? trx.route_code : StringUtil.lpadZero(trx.route_code, 5);
        // Java also tested path_code against "" by reference, which never matched, so an empty
        // path code stays empty here too.
        const pathCode = trx.path_code == null ? `${routeCode}${trx.hpt}` : trx.path_code;

        try {
            await this.withTransaction(req.dbConn, async () => {
                await this.gpsDao.insert(req.dbConn, trx, routeCode, pathCode, req.sessionId);
                // Java called main_event.equals("7") and threw a NullPointerException when the
                // attribute was missing, taking the whole request down; a null is simply not 7.
                if (trx.main_event === "7") await this.storeApc(req, trx);
            });
        } catch (error) {
            if (isUniqueViolation(error) || error?.errorNum === VALUE_TOO_LARGE) return;
            throw error;
        }
    }

    /** Main event 7 is a stop event; the sub event decides which counter table receives it. */
    async storeApc(req, trx) {
        await this.ignoreDuplicate(() => this.apcEventDao.insert(req.dbConn, trx, req.sessionId));

        if (trx.sub_event === "8" || trx.sub_event === "9") {
            await this.ignoreDuplicate(() => this.apcDao.insert(req.dbConn, trx, req.sessionId));
        } else if (trx.sub_event === "17" || trx.sub_event === "18") {
            await this.ignoreDuplicate(() => this.doorDao.insert(req.dbConn, trx, req.sessionId));
        }
    }

    /** A repeated counter row must not cost the position row it arrived with. */
    async ignoreDuplicate(fn) {
        try {
            await fn();
        } catch (error) {
            if (!isUniqueViolation(error)) throw error;
        }
    }

    /** CANDAT holds one VAL element per measured parameter, each its own can_data row. */
    async handleCandat(req, element, trx, dbEnabled, toKafka) {
        const attrs = lowerKeys(element.attrs);
        const base = {
            bus_id: attrs.bus_id || "",
            date_time: attrs.date_time || "",
            lat: coordinateOrZero(attrs.latitude),
            lng: coordinateOrZero(attrs.longitude),
        };

        for (const val of XmlWalk.descendants(element.node, "VAL")) {
            const attr = lowerKeys(val.attrs);
            const can = { ...base, param_id: attr.id || "", param_value: attr.value || "" };
            // The row is written before the message here, the other way round to GPSDAT.
            if (dbEnabled) {
                await this.withTransaction(req.dbConn,
                    () => this.canDataDao.insert(req.dbConn, can, req.sessionId));
            }
            if (toKafka) {
                await this.produceKafka(req, "sendgps", trx.toKafkaCanPayload(can), can.bus_id);
            }
        }
    }
}


// ---------------------------------------------------------------- ?func=onlinegps

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
            respErr = this.getServiceError(error, req);
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


module.exports = {
    funcs: {
        sendgps: new SendGps(),
        onlinegps: new OnlineGps(),
    },
};
