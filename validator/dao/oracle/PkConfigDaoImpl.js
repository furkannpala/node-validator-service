const BaseDao = require("../BaseDao");

/**
 * Only the two standalone selects live here. The other PK_CONFIG functions
 * (fn_get_operation_pdate/date/start_time/end_time) appear inline inside INSERT statements and
 * stay there: computing them in JS would move the operation-day boundary off the database.
 */
class PkConfigDaoImpl extends BaseDao {

    operationPdateSql = " SELECT TO_CHAR(pk_config.fn_get_operation_pdate(),'dd.MM.yyyy') AS PDATE FROM dual ";
    dataForwardUrlSql = ' SELECT pk_config.FN_GET_TE_DATAFORWARD_URL AS URL FROM DUAL ';

    async getOperationPdate(conn, sessionId) {
        this.ULog.debug(this.operationPdateSql, sessionId);
        const result = await conn.execute(this.operationPdateSql, {},
            { outFormat: this.oracledb.OUT_FORMAT_OBJECT });
        return result.rows[0]?.PDATE;
    }

    async getDataForwardUrl(conn, sessionId) {
        this.ULog.debug(this.dataForwardUrlSql, sessionId);
        const result = await conn.execute(this.dataForwardUrlSql, {},
            { outFormat: this.oracledb.OUT_FORMAT_OBJECT });
        return result.rows[0]?.URL;
    }
}

module.exports = new PkConfigDaoImpl();
