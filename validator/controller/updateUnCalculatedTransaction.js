const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const StringUtil = require("../../util/StringUtil");

// resultCode 01 means the host priced the tap; anything else leaves it in the queue.
const PRICED_RESULT_CODE = "01";
const CALCULATED = "1";
const NOT_CALCULATED = "0";
// The amount arrives in cents and Java divided by a literal 100 here, not by the system's
// currency multiplier as the senddata path does.
const AMOUNT_DIVISOR = 100;

/** The host sends back the prices it calculated for the taps getuncalculatedtransaction gave. */
class UpdateUnCalculatedTransaction extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("AfcTdFareDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.store(req);
            this.okResponse(res);
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }

    async store(req) {
        // Java declared these outside the loop and never cleared them, so a FARE element that
        // omits an attribute keeps the previous element's value. Kept: clearing them here
        // would change which rows an existing payload updates.
        const fare = {};
        for (const element of this.bodyElements(req)) {
            if (element.name !== "FARE") continue;
            this.readAttrs(fare, element.attrs);
            await this.update(req, fare);
        }
    }

    readAttrs(fare, attrs) {
        for (const [name, value] of Object.entries(attrs || {})) {
            if (name === "boarding_date_time") fare.boarding_date_time = value;
            else if (name === "card_no") fare.card_no = value;
            else if (name === "usage_cnt") fare.usage_cnt = value;
            else if (name === "amount") fare.usage_amt = value;
            else if (name === "resultCode") fare.result_code = value;
        }
    }

    /**
     * One record, one transaction. Java swallowed every failure here — a bad amount or a
     * missing row must not stop the elements that follow — and that is preserved.
     */
    async update(req, fare) {
        try {
            // The two parses sit inside the catch in Java as well, so an unparsable amount
            // skips its own element instead of failing the request.
            const binds = {
                usage_amt: StringUtil.parseDoubleStrict(fare.usage_amt) / AMOUNT_DIVISOR,
                fare_calc_status: fare.result_code === PRICED_RESULT_CODE
                    ? CALCULATED : NOT_CALCULATED,
                card_no: fare.card_no ?? null,
                boarding_date_time: fare.boarding_date_time ?? null,
                usage_cnt: StringUtil.parseIntStrict(fare.usage_cnt),
            };
            await this.withTransaction(req.dbConn,
                () => this.daoImpl.updateFare(req.dbConn, binds, req.sessionId));
        } catch (error) {
            this.ULog.error(`fare update failed for card_no ${fare.card_no}: `
                + `${error?.message}`, req.sessionId);
        }
    }
}

module.exports = new UpdateUnCalculatedTransaction();
