const { ULog } = require("../../../../lib/utils");
const Constant = require("../../constant/Constant");

// server.js sets oracledb.autoCommit = true globally, so every statement that takes part in a
// transaction must pass this; the commit boundary then stays in the controller.
const TX = { autoCommit: false };

/**
 * Runs fn inside one transaction on conn. The boundary is one record, not one request:
 * a single bad record must not roll back the good ones (see roadmap 4.2).
 */
async function withTransaction(conn, fn) {
    try {
        const result = await fn();
        await conn.commit();
        return result;
    } catch (e) {
        try {
            await conn.rollback();
        } catch (re) {
            ULog.error(`rollback failed: ${re?.message}`);
        }
        throw e;
    }
}

function isUniqueViolation(err) {
    return err?.errorNum === Constant.SQL_EXCEPTION_UNIQUE_INDEX;
}

module.exports = { TX, withTransaction, isUniqueViolation };
