const oracledb = require("oracledb");
const { ULog } = require("../../../../lib/utils");
const { TX } = require("./daoUtil");
const Constant = require("../../constant/Constant");
const { debugSql } = require("./sqlLog");

class BaseDao {
    ULog = ULog;
    oracledb = oracledb;

    /**
     * The statement trace, so a DAO does not have to know sqlLog exists. It stays a module of
     * its own because the sqlite DAOs share it, and they do not extend this class: they talk to
     * node:sqlite synchronously and none of what is below means anything to them.
     */
    debugSql(sql, binds, sessionId) {
        debugSql(sql, binds, sessionId);
    }

    /**
     * Every write statement in the service has the same shape. autoCommit stays off so the
     * commit boundary is the controller's, one record at a time.
     */
    async exec(conn, sql, binds, sessionId) {
        debugSql(sql, binds, sessionId);
        const result = await conn.execute(sql, binds, TX);
        return result.rowsAffected || 0;
    }

    /**
     * The AFC_TD family of DAOs swallowed a duplicate key in Java and reported false, so the
     * rest of the record still went in. Anything else is the caller's problem.
     */
    async execIgnoreDuplicate(conn, sql, binds, sessionId) {
        try {
            return await this.exec(conn, sql, binds, sessionId) === 1;
        } catch (e) {
            if (e?.errorNum !== Constant.SQL_EXCEPTION_UNIQUE_INDEX) throw e;
            ULog.debug(`duplicate ignored: ${e.message}`, sessionId);
            return false;
        }
    }

    /**
     * The shape almost every read-only endpoint has in Java: N string IN params plus one OUT
     * LOB that is streamed back as the response body. Returns undefined when the procedure
     * produced no LOB, which controllers turn into the -97 "cannot fetch data from db" reply.
     */
    async callLob(conn, sql, data, sessionId, lobType) {
        data.out_result = { dir: oracledb.BIND_OUT, type: lobType || oracledb.CLOB };
        debugSql(sql, data, sessionId);
        const result = await conn.execute(sql, data);
        return await result.outBinds.out_result?.getData();
    }
}

module.exports = BaseDao;
