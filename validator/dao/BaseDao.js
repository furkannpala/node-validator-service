const oracledb = require("oracledb");
const { ULog } = require("../../../../lib/utils");
const { maskJson } = require("../../util/LogMask");

class BaseDao {
    ULog = ULog;
    oracledb = oracledb;
    maskJson = maskJson;

    /**
     * The shape almost every read-only endpoint has in Java: N string IN params plus one OUT
     * LOB that is streamed back as the response body. Returns undefined when the procedure
     * produced no LOB, which controllers turn into the -97 "cannot fetch data from db" reply.
     */
    async callLob(conn, sql, data, sessionId, lobType) {
        data.out_result = { dir: oracledb.BIND_OUT, type: lobType || oracledb.CLOB };
        ULog.debug(sql + " " + maskJson(data), sessionId);
        const result = await conn.execute(sql, data);
        return await result.outBinds.out_result?.getData();
    }
}

module.exports = BaseDao;
