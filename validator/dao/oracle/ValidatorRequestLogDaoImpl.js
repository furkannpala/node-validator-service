const BaseDao = require("../BaseDao");

/**
 * The raw request body of the functions listed in save_request_log_functions. Java opened a
 * connection of its own for this, so the row was committed whatever the request did next; here
 * the statement is left on autocommit, which gives the same separate commit.
 */
class ValidatorRequestLogDaoImpl extends BaseDao {

    insertSql = 'INSERT INTO VALIDATOR_REQUEST_LOG'
        + '(BUS_ID,SAM_ID,FUNC_NAME,REQ_URL,REQ_XML,CREATED_AT,PDATE) '
        + 'VALUES(:bus_id,:sam_id,:func_name,:req_url,:req_xml,CURRENT_DATE,TRUNC(CURRENT_DATE))';

    /** Java logged a failure and carried on: the request itself must not depend on its log. */
    async insert(conn, data, sessionId) {
        const binds = {
            bus_id: data.bus_id ?? null,
            sam_id: data.sam_id ?? null,
            func_name: data.func_name ?? null,
            req_url: data.req_url ?? null,
            req_xml: { val: data.req_xml ?? null, type: this.oracledb.CLOB },
        };
        try {
            this.debugSql(this.insertSql, binds, sessionId);
            // No TX: this row commits on its own, as it did on its own connection in Java.
            const result = await conn.execute(this.insertSql, binds);
            return result.rowsAffected === 1;
        } catch (e) {
            this.ULog.error(`Error while saving request log: ${e?.message}`, sessionId);
            return false;
        }
    }
}

module.exports = new ValidatorRequestLogDaoImpl();
