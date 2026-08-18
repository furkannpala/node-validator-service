const BaseDao = require("../BaseDao");

// Standalone procedure, not part of a package - kept unqualified as in Java.
class VvsSummaryDaoImpl extends BaseDao {

    vvsSummarySql = ' BEGIN SP_VVS_SUMMARY(:pdate, :out_result); END; ';

    vvsSummary(conn, data, sessionId) { return this.callLob(conn, this.vvsSummarySql, data, sessionId); }
}

module.exports = new VvsSummaryDaoImpl();
