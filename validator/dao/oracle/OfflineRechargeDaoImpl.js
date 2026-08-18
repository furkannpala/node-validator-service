const BaseDao = require("../BaseDao");

// The procedure exists with two signatures in the field. Which one is installed is a per-system
// fact, so the config key decides - calling the wrong arity raises ORA-06550.
class OfflineRechargeDaoImpl extends BaseDao {

    withProvNoSql = ' BEGIN sp_create_offline_recharge_xml(:systemid, :version, :provno, :out_result); END; ';
    withoutProvNoSql = ' BEGIN sp_create_offline_recharge_xml(:systemid, :version, :out_result); END; ';

    createXml(conn, data, includesProvNo, sessionId) {
        if (includesProvNo) return this.callLob(conn, this.withProvNoSql, data, sessionId);
        delete data.provno;
        return this.callLob(conn, this.withoutProvNoSql, data, sessionId);
    }
}

module.exports = new OfflineRechargeDaoImpl();
