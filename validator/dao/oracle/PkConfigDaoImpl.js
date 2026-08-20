const BaseDao = require("../BaseDao");
const { debugSql } = require("../sqlLog");

/**
 * Only the two standalone selects live here. The other PK_CONFIG functions
 * (fn_get_operation_pdate/date/start_time/end_time) appear inline inside INSERT statements and
 * stay there: computing them in JS would move the operation-day boundary off the database.
 */
/**
 * The ticket engine address is a deployment setting, not per-request data, but senddata asked
 * the database for it on every single call. It is held for this long instead, so a change still
 * takes effect without a restart while the common case costs no round trip at all.
 */
const DATA_FORWARD_URL_TTL_MS = 60 * 1000;

class PkConfigDaoImpl extends BaseDao {

    operationPdateSql = " SELECT TO_CHAR(pk_config.fn_get_operation_pdate(),'dd.MM.yyyy') AS PDATE FROM dual ";
    dataForwardUrlSql = ' SELECT pk_config.FN_GET_TE_DATAFORWARD_URL AS URL FROM DUAL ';

    // systemId -> { url, at }. Keyed per system because each one has its own pool and its own
    // PK_CONFIG; a shared entry would send one system's records to another one's engine.
    dataForwardUrlCache = new Map();

    async getOperationPdate(conn, sessionId) {
        debugSql(this.operationPdateSql, undefined, sessionId);
        const result = await conn.execute(this.operationPdateSql, {},
            { outFormat: this.oracledb.OUT_FORMAT_OBJECT });
        return result.rows[0]?.PDATE;
    }

    async getDataForwardUrl(conn, sessionId, systemId) {
        const key = String(systemId ?? "");
        const cached = this.dataForwardUrlCache.get(key);
        if (cached && Date.now() - cached.at < DATA_FORWARD_URL_TTL_MS) return cached.url;

        debugSql(this.dataForwardUrlSql, undefined, sessionId);
        const result = await conn.execute(this.dataForwardUrlSql, {},
            { outFormat: this.oracledb.OUT_FORMAT_OBJECT });
        const url = result.rows[0]?.URL;
        this.dataForwardUrlCache.set(key, { url, at: Date.now() });
        return url;
    }

    /** The load tools and the tests drive the same process twice; this drops what they cached. */
    clearCache() {
        this.dataForwardUrlCache.clear();
    }
}

module.exports = new PkConfigDaoImpl();
