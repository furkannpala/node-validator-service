const BaseDao = require("../BaseDao");

/**
 * The evidence table for a record senddata could not store. It must survive the rollback of
 * the record that failed, so the caller commits it on its own (roadmap risk #3).
 */
class TblValidatorErrorTdDaoImpl extends BaseDao {

    insertSql = 'INSERT INTO TBL_VALIDATOR_ERROR_TD '
        + '(TD_DATA, ERROR_MESSAGE, ERROR_CODE, SYSTEM_ID, BUS_ID, STATION_TYPE, REQUEST_URL) '
        + 'VALUES (:td_data, :error_message, :error_code, :system_id, :bus_id, :station_type, :request_url)';

    // Grouped rather than listed: the job reports how many of each kind arrived, and the
    // CLOB payload of every row would be far too much to carry into a log line.
    countSinceSql = 'SELECT ERROR_CODE, COUNT(*) CNT FROM TBL_VALIDATOR_ERROR_TD '
        + 'WHERE CREATION_DATE >= :since GROUP BY ERROR_CODE ORDER BY ERROR_CODE';

    // ROWNUM caps one round so a first run against years of rows cannot hold a long
    // transaction open; the caller repeats on the next tick if there is more.
    purgeSql = 'DELETE FROM TBL_VALIDATOR_ERROR_TD WHERE CREATION_DATE < SYSDATE - :days '
        + 'AND ROWNUM <= :batch_rows';

    async countSince(conn, since, sessionId) {
        const binds = { since };
        this.ULog.debug(this.countSinceSql + " " + this.maskJson(binds), sessionId);
        const result = await conn.execute(this.countSinceSql, binds,
            { outFormat: this.oracledb.OUT_FORMAT_OBJECT });
        return result.rows || [];
    }

    /** Autocommit is left on: a retention round commits by itself, as the roadmap asks. */
    async purge(conn, days, batchRows, sessionId) {
        const binds = { days, batch_rows: batchRows };
        this.ULog.debug(this.purgeSql + " " + this.maskJson(binds), sessionId);
        const result = await conn.execute(this.purgeSql, binds);
        const deleted = result.rowsAffected || 0;
        return { deleted, more: deleted >= batchRows };
    }

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
