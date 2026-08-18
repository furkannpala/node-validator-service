const BaseDao = require("../BaseDao");

class PkCardActionDaoImpl extends BaseDao {

    getCardActionSql = ' BEGIN PK_CARDACTION.SP_GETCARDACTION(:aliasno, :counter, :out_result); END; ';

    getCardAction(conn, data, sessionId) { return this.callLob(conn, this.getCardActionSql, data, sessionId); }
}

module.exports = new PkCardActionDaoImpl();
