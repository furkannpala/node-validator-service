const TravelTypes = require("../constant/TravelTypes");
const TravelTypeVisitor = require("../visitor/TravelTypeVisitor");

// Travel types that skip the company and stop-count lookup.
const NO_PREWORK = new Set([
    TravelTypes.VALAPP_STARTED, TravelTypes.DRIVERCARD_INSERTED, TravelTypes.DRIVERCARD_REMOVED,
    TravelTypes.DUTY_ENDED, TravelTypes.STOP_ENTERED, TravelTypes.STOP_LEFT,
]);

// The two stop events write to tms_val_route instead of leaving a trip event behind.
const STOP_EVENTS = new Set([TravelTypes.STOP_ENTERED, TravelTypes.STOP_LEFT]);

const SHIFT_EVENTS = new Set([
    TravelTypes.DRIVERCARD_INSERTED, TravelTypes.DRIVERCARD_REMOVED, TravelTypes.DUTY_ENDED,
]);

/**
 * An F record describes the trip, not a ticket: ins_data's record_id starting with F on a bus
 * station type. The travel type decides which of the visitor's methods run, and more than one
 * can apply to a single record.
 */
class FRecordStrategy {
    constructor(visitor) {
        this.visitor = visitor || new TravelTypeVisitor();
    }

    async processTransaction(conn, trx, cfg, sessionId) {
        // On an F record the old_amt attribute carries the path code, not an amount.
        trx.pathCode = String(trx.old_amt ?? '');
        if (trx.pathCode.substring(0, 6) === '000000') {
            trx.pathCode = `${trx.route_code}${trx.half_progress_type}`;
        }
        trx.travelType = trx.travel_type;

        for (const visit of this.plan(trx.travel_type)) {
            await this.visitor[visit](conn, trx, cfg, sessionId);
        }
    }

    /** The visitor methods this travel type triggers, in the order Java ran them. */
    plan(travelType) {
        const type = travelType == null ? '' : String(travelType);
        const steps = [];

        if (!NO_PREWORK.has(type)) steps.push('visitDefault');
        if (!STOP_EVENTS.has(type)) steps.push('visitWithoutStop');

        if (type === TravelTypes.TRIP_STARTED) steps.push('visitTripStarted');
        else if (type === TravelTypes.DRIVER_CHANGED) steps.push('visitDriverChanged');
        else if (type === TravelTypes.TRIP_END) steps.push('visitTripEnd');
        else if (type === TravelTypes.JOURNEY_STARTED) steps.push('visitJourneyStarted');
        else if (SHIFT_EVENTS.has(type)) steps.push('visitDrivercard');
        else if (type === TravelTypes.STOP_ENTERED) steps.push('visitStopEntered');
        else if (type === TravelTypes.STOP_LEFT) steps.push('visitStopLeft');

        return steps;
    }
}

module.exports = FRecordStrategy;
