const BaseDao = require("../BaseDao");
const { buildInsert, bindFor } = require("./tdSql");

// One statement per variant, built once at load time. See tdSql.js for why the column order
// is not written out by hand here.
class AfcTdDaoImpl extends BaseDao {

    sqlFor(options) {
        const key = JSON.stringify(options || {});
        this.cache = this.cache || {};
        if (!this.cache[key]) this.cache[key] = buildInsert("afc_td", options);
        return this.cache[key];
    }

    /** options: { extendedFare, originSystemId, qrData } - whichever the variant carries. */
    insert(conn, trx, options, sessionId) {
        return this.execIgnoreDuplicate(
            conn, this.sqlFor(options), bindFor("afc_td", trx, options), sessionId);
    }
}

module.exports = new AfcTdDaoImpl();
