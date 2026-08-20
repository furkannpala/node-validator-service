/**
 * Fares, tariffs, products and zones, plus the taps the host still has to price.
 *
 * The keys of the funcs table at the bottom are the ?func= values this file answers;
 * validator/index.js registers them straight from there.
 */
const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const StringUtil = require("../../util/StringUtil");


// ---------------------------------------------------------------- ?func=getafcfares

class GetAfcFares extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getAfcFares ",
                ` samid:${req.query.samid} busid:${req.query.busid}`);

            const data = await this.daoImpl.getAfcFares(req.dbConn, {
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


// ---------------------------------------------------------------- ?func=getafcodmatrix

class GetAfcOdMatrix extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getAfcOdMatrix ",
                ` samid:${req.query.samid} busid:${req.query.busid}`);

            const data = await this.daoImpl.getAfcOdMatrix(req.dbConn, {
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


// ---------------------------------------------------------------- ?func=getafcproduct

class GetAfcProduct extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getAfcProduct ",
                ` samid:${req.query.samid} busid:${req.query.busid}`);

            const data = await this.daoImpl.getAfcProduct(req.dbConn, {
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


// ---------------------------------------------------------------- ?func=getafczonegroup

class GetAfcZoneGroup extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getAfcZoneGroup ",
                ` samid:${req.query.samid} busid:${req.query.busid}`);

            const data = await this.daoImpl.getAfcZoneGroup(req.dbConn, {
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


// ---------------------------------------------------------------- ?func=getmstproducttype

class GetMstProductType extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getMstProductType ",
                ` samid:${req.query.samid} busid:${req.query.busid}`);

            const data = await this.daoImpl.getMstProductType(req.dbConn, {
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


// ---------------------------------------------------------------- ?func=getusagesummary

class GetUsageSummary extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("VvsSummaryDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getUsageSummary ",
                ` samid:${req.query.samid} busid:${req.query.busid}`);

            const data = await this.daoImpl.vvsSummary(req.dbConn, {
                pdate: req.query.pdate ?? null,
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


// ---------------------------------------------------------------- ?func=getzone

class GetZone extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getZone ",
                ` samid:${req.query.samid} busid:${req.query.busid}`);

            const data = await this.daoImpl.getZone(req.dbConn, {
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


// ---------------------------------------------------------------- ?func=getuncalculatedtransaction

// Only this card type has a query behind it. Java's loop also had an empty branch for 11 and
// ignored every other configured type, which is why the list is a filter and not a lookup.
const PRICED_CARD_TYPE = "09";
// Hard-coded in Java: the answer always claims system 001, whatever the caller asked as.
const REPORTED_SYSTEM_ID = "001";
// The literal Java put at the head of the StringBuilder.
const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

/** Taps the host has not priced yet, one FARE element each. */
class GetUnCalculatedTransaction extends ValidatorControllerBase {
    constructor() {
        super();
        this.fareConfigDao = this.daoFactory.get("TblFareConfigDaoImpl");
        this.afcTdFareDao = this.daoFactory.get("AfcTdFareDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            // tbl_fare_config has no unique key on card_type, so a second active 09 row used to
            // run the query twice and put every FARE element into the answer twice. The list is
            // a membership test, not something to iterate.
            const cardTypes = await this.cardTypes(req);
            const fares = cardTypes.includes(PRICED_CARD_TYPE)
                ? (await this.rows(req)).map((row) => this.fareElement(row))
                : [];

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = `${DECLARATION}<ROOT>${fares.join("")}</ROOT>`;
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }

    /** Java printed the stack trace and carried on with an empty list. */
    async cardTypes(req) {
        try {
            return await this.fareConfigDao.getActiveCardTypes(req.dbConn, req.sessionId);
        } catch (error) {
            this.ULog.error(`tbl_fare_config read failed: ${error?.message}`, req.sessionId);
            return [];
        }
    }

    /** Same here: a failed query yields an empty ROOT rather than an error reply. */
    async rows(req) {
        try {
            return await this.afcTdFareDao.getUncalculated(req.dbConn, req.sessionId);
        } catch (error) {
            this.ULog.error(`uncalculated transaction read failed: ${error?.message}`, req.sessionId);
            return [];
        }
    }

    /**
     * Assembled as text rather than through js2Xml because Java built it on a StringBuilder,
     * spaces around the equals signs and all, and the device receives those bytes. An empty
     * result is <ROOT></ROOT> there, never the self-closing form a serialiser would produce.
     */
    fareElement(row) {
        const pairs = [
            ["system_id", REPORTED_SYSTEM_ID],
            ["pdate", this.text(row.PDATE)],
            ["sam_id", this.text(row.SAM_ID)],
            ["boarding_date_time", this.text(row.BOARDING_DATE_TIME)],
            ["card_no", this.text(row.CARD_NO)],
            ["usage_cnt", this.text(row.USAGE_CNT)],
            ["passenger_type", this.text(row.PASSENGER_TYPE)],
            ["route_code", this.text(row.ROUTE_CODE)],
            ["host_passenger_type", this.text(row.HOST_PASSENGER_TYPE)],
            ["card_type", this.text(row.CARD_TYPE)],
        ];
        // Java escaped nothing here, so a quote in a column would break the document there too.
        return `<FARE ${pairs.map(([k, v]) => ` ${k} = "${v}"`).join("")} />`;
    }

    /**
     * Java appended the column straight onto a StringBuilder, and StringBuilder.append(null)
     * writes the four characters "null". So an empty column really does reach the device as
     * the text null, and that is reproduced rather than quietly turned into an empty string.
     */
    text(value) {
        return value == null ? "null" : String(value);
    }
}


// ---------------------------------------------------------------- ?func=updateuncalculatedtransaction

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


module.exports = {
    funcs: {
        getafcfares: new GetAfcFares(),
        getafcodmatrix: new GetAfcOdMatrix(),
        getafcproduct: new GetAfcProduct(),
        getafczonegroup: new GetAfcZoneGroup(),
        getmstproducttype: new GetMstProductType(),
        getusagesummary: new GetUsageSummary(),
        getzone: new GetZone(),
        getuncalculatedtransaction: new GetUnCalculatedTransaction(),
        updateuncalculatedtransaction: new UpdateUnCalculatedTransaction(),
    },
};
