const { ValidatorControllerBase } = require("../ValidatorControllerBase");

// Attribute order is the order Java added the nodes in, and devices read the document
// positionally in places, so it is fixed here rather than left to object literal order.
const EMPTY_CARD = { ALIAS_NO: "", REGISTERED: "", PASSENGER_TYPE: "", USAGE_CNT: "" };

/**
 * One card looked up by number. Java answered 200 with a document either way: a missing card
 * still reports IS_SUCCEED 1 with empty fields, and only a failed query reports 0.
 */
class GetCardInfo extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("TblRfcardDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            const cardNo = req.query.card_no ?? null;
            const attributes = await this.cardAttributes(req, cardNo);

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = this.js2Xml({ ROOT: { CARD: { _attributes: attributes } } },
                { compact: true, ignoreComment: true, spaces: 0 });
        } catch (error) {
            // Only a failure to build the document reaches here; a failed query is reported
            // inside the document instead.
            respErr = new this.ServiceError(this.ErrorCodes.XML_PARSE_PROBLEM.code,
                this.ErrorCodes.XML_PARSE_PROBLEM.message + error?.message);
        } finally {
            next(respErr);
        }
    }

    async cardAttributes(req, cardNo) {
        let row;
        try {
            row = await this.daoImpl.getCard(req.dbConn, cardNo, req.sessionId);
        } catch (error) {
            this.ULog.error(`getcardinfo query failed for card_no ${cardNo}: `
                + `${error?.message}`, req.sessionId);
            return { CARD_NO: cardNo, IS_SUCCEED: "0", ...EMPTY_CARD };
        }
        if (!row) return { CARD_NO: cardNo, IS_SUCCEED: "1", ...EMPTY_CARD };

        return {
            CARD_NO: this.text(row.CARD_NO),
            IS_SUCCEED: "1",
            ALIAS_NO: this.text(row.ALIAS_NO),
            REGISTERED: this.text(row.REGISTERED),
            PASSENGER_TYPE: this.text(row.PASSENGER_TYPE),
            USAGE_CNT: this.text(row.USAGE_CNT),
        };
    }

    /** Java read every column with getString, and a null column became an empty attribute. */
    text(value) {
        return value == null ? "" : String(value);
    }
}

module.exports = new GetCardInfo();
