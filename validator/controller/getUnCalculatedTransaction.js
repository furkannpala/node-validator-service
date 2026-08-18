const { ValidatorControllerBase } = require("../ValidatorControllerBase");

// Only this card type has a query behind it. Java's loop also had an empty branch for 11 and
// ignored every other configured type, which is why the list is a filter and not a lookup.
const PRICED_CARD_TYPE = "09";
// Hard-coded in Java: the answer always claims system 001, whatever the caller asked as.
const REPORTED_SYSTEM_ID = "001";

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
            const fares = [];
            for (const cardType of await this.cardTypes(req)) {
                if (cardType !== PRICED_CARD_TYPE) continue;
                for (const row of await this.rows(req)) fares.push(this.fareElement(row));
            }

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = this.js2Xml({ ROOT: fares.length ? { FARE: fares } : {} },
                { compact: true, ignoreComment: true, spaces: 0 });
        } catch (error) {
            respErr = this.getServiceError(error);
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

    fareElement(row) {
        return {
            _attributes: {
                system_id: REPORTED_SYSTEM_ID,
                pdate: this.text(row.PDATE),
                sam_id: this.text(row.SAM_ID),
                boarding_date_time: this.text(row.BOARDING_DATE_TIME),
                card_no: this.text(row.CARD_NO),
                usage_cnt: this.text(row.USAGE_CNT),
                passenger_type: this.text(row.PASSENGER_TYPE),
                route_code: this.text(row.ROUTE_CODE),
                host_passenger_type: this.text(row.HOST_PASSENGER_TYPE),
                card_type: this.text(row.CARD_TYPE),
            },
        };
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

module.exports = new GetUnCalculatedTransaction();
