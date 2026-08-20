const BaseDao = require("../BaseDao");

/**
 * The evidence table for a record senddata could not store. It must survive the rollback of
 * the record that failed, so the caller commits it on its own (roadmap risk #3).
 */
class TblValidatorErrorTdDaoImpl extends BaseDao {

    insertSql = 'INSERT INTO TBL_VALIDATOR_ERROR_TD '
        + '(TD_DATA, ERROR_MESSAGE, ERROR_CODE, SYSTEM_ID, BUS_ID, STATION_TYPE, REQUEST_URL) '
        + 'VALUES (:td_data, :error_message, :error_code, :system_id, :bus_id, :station_type, :request_url)';

    /** Java swallowed a failure here: losing the error record must not mask the first error. */
    async insertErrorTd(conn, data, sessionId) {
        try {
            return await this.exec(conn, this.insertSql, data, sessionId);
        } catch (e) {
            this.ULog.error(`Error occurred while adding error record: ${e?.message}`, sessionId);
            return 0;
        }
    }
}

module.exports = new TblValidatorErrorTdDaoImpl();
