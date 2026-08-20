/**
 * Cards and the blacklist, including the free-card database the device downloads.
 *
 * The keys of the funcs table at the bottom are the ?func= values this file answers;
 * validator/index.js registers them straight from there.
 */
const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const Keystore = require("../../constant/Keystore");
const SqliteBuilder = require("../../util/SqliteBuilder");
const Constant = require("../../constant/Constant");


// ---------------------------------------------------------------- ?func=getblacklist

class GetBlacklist extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " GetBlacklist ",
                ` version:${req.query.version}`);

            const data = await this.daoImpl.createBlacklist(req.dbConn, {
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


// ---------------------------------------------------------------- ?func=getcarddetail

class GetCardDetail extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkCardActionDaoImpl");
        // Java replaced the database failure with this text before it reached the
        // device; the ORA code only goes to the log.
        this.dbErrorMessage = "Failed to fetch card detail";
        // This one caught every exception, not just the SQL ones.
        this.dbErrorScope = "all";
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getcarddetail ",
                ` aliasno:${req.query.aliasno} counter:${req.query.counter}`);

            const data = await this.daoImpl.getCardAction(req.dbConn, {
                aliasno: req.query.aliasno ?? null,
                counter: req.query.counter ?? null,
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


// ---------------------------------------------------------------- ?func=getcardinfo

// Java built this with the DOM and its serialiser writes attributes in alphabetical order,
// whatever order they were added in. Matching that keeps the document byte for byte the same.
const EMPTY_CARD = { ALIAS_NO: "", PASSENGER_TYPE: "", REGISTERED: "", USAGE_CNT: "" };

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
            res.locals.data = this.js2Xml({ ROOT: { CARD: { _attributes: this.sorted(attributes) } } },
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
            return { CARD_NO: this.text(cardNo), IS_SUCCEED: "0", ...EMPTY_CARD };
        }
        // Attr.setValue(null) serialises as an empty attribute in Java, so a request with no
        // card_no still carries CARD_NO="" rather than dropping the attribute.
        if (!row) return { CARD_NO: this.text(cardNo), IS_SUCCEED: "1", ...EMPTY_CARD };

        return {
            ALIAS_NO: this.text(row.ALIAS_NO),
            CARD_NO: this.text(row.CARD_NO),
            IS_SUCCEED: "1",
            PASSENGER_TYPE: this.text(row.PASSENGER_TYPE),
            REGISTERED: this.text(row.REGISTERED),
            USAGE_CNT: this.text(row.USAGE_CNT),
        };
    }

    /** The serialiser Java used sorts them, so the document is built sorted here. */
    sorted(attributes) {
        return Object.fromEntries(Object.entries(attributes).sort(([a], [b]) => a.localeCompare(b)));
    }

    /** Java read every column with getString, and a null column became an empty attribute. */
    text(value) {
        return value == null ? "" : String(value);
    }
}


// ---------------------------------------------------------------- ?func=getofflinecardlist

/**
 * Two different sources behind one endpoint: ?enc=1 reads the prepared binary card list,
 * anything else builds the recharge XML through a procedure whose arity is a per-system fact.
 */
class GetOfflineCardList extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
        this.rechargeDaoImpl = this.daoFactory.get("OfflineRechargeDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, "getOfflineCardList",
                ` version:${req.query.version} enc:${req.query.enc} samid:${req.query.samid}`);

            const isBlob = Keystore.BLOB === String(req.query.enc);
            const data = await this.read(req, isBlob);
            if (data == null || data.length < 1) throw new this.ServiceError(-99, "error");

            res.setHeader("Content-Type", isBlob ? "application/octet-stream" : "text/xml");
            res.locals.data = data;
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }

    async read(req, isBlob) {
        if (isBlob) {
            return await this.daoImpl.getCardListBlob(req.dbConn, {
                samid: req.query.samid ?? null,
                version: req.query.version ?? null,
            }, req.sessionId);
        }

        return await this.rechargeDaoImpl.createXml(req.dbConn, {
            systemid: req.query.systemid ?? null,
            version: req.query.version ?? null,
            provno: req.query.provno ?? null,
        }, this.cfgBool(req, "sp_create_offline_recharge_xml_includes_provno", true), req.sessionId);
    }
}


// ---------------------------------------------------------------- ?func=generatefreecardsqlite

// The free card .db file. Same cache rule as getrouteinfodb, one table instead of nine.
class GenerateFreeCardSqlite extends ValidatorControllerBase {

    async func(req, res, next) {
        let respErr;
        try {
            const data = await this.read(req);

            res.setHeader("Content-Disposition", 'attachment; filename="free_card_sqlite.db"');
            res.locals.data = data;
        } catch (error) {
            respErr = error instanceof this.ServiceError
                ? error : new this.ServiceError(-8, error?.message);
        } finally {
            next(respErr);
        }
    }

    async read(req) {
        const cache = req.query.cache;
        if (cache == null || String(cache).toLowerCase() === "0") {
            return await SqliteBuilder.buildFreeCard(req.dbConn, req.sessionId);
        }
        return SqliteBuilder.readCached(Constant.FREECARD_DB_FILE_PATH)
            ?? await SqliteBuilder.buildFreeCard(req.dbConn, req.sessionId);
    }
}


module.exports = {
    funcs: {
        getblacklist: new GetBlacklist(),
        getcarddetail: new GetCardDetail(),
        getcardinfo: new GetCardInfo(),
        getofflinecardlist: new GetOfflineCardList(),
        generatefreecardsqlite: new GenerateFreeCardSqlite(),
    },
};
