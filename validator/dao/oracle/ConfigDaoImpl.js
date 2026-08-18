const oracledb = require("oracledb");
const { getConnection, getPools, ULog, ServiceError } = require("../../../../../lib/utils");
const system_cfg = require("../../../config/system_cfg");
const { maskJson } = require("../../../util/LogMask");

// Empty kk_config_scheme = the pool user owns the table; 'KKCONFIG' on test/prod.
// Only this table is prefixed: AFC_TD, MST_BUS, PK_APP_VAL always live in the pool schema.
function table() {
    const scheme = system_cfg.kk_config_scheme ? system_cfg.kk_config_scheme + "." : "";
    return scheme + "VALIDATOR_SERVICE_CONFIG";
}

// Every row, for the boot-time / admin load. A row whose CONFIG is not valid JSON is logged
// and skipped so one bad il cannot keep the whole service from configuring itself.
async function getAllConfig() {
    const sql = `SELECT SYSTEM_ID, CONFIG FROM ${table()}`;
    let dbConn;
    const result = [];
    try {
        // Config table lives in one central place, so any configured Oracle pool can read it.
        dbConn = await getConnection(Object.keys((await getPools()).oracle)[0]);
        ULog.debug(sql);
        const rows = await dbConn.execute(sql, [], {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            fetchInfo: { CONFIG: { type: oracledb.STRING } } // fetch CLOB as a string, not a stream
        });
        for (const row of rows.rows) {
            try {
                result.push({ SYSTEM_ID: row.SYSTEM_ID, CONFIG: JSON.parse(row.CONFIG || "{}") });
            } catch (parseError) {
                ULog.error(`VALIDATOR_SERVICE_CONFIG parse error, SYSTEM_ID: ${row.SYSTEM_ID}, error: ${parseError?.message}`);
            }
        }
    } finally {
        if (dbConn) await dbConn.close();
    }
    return result;
}

// The per-request lookup: the system's own row plus 'app', so the caller can layer them the
// way Java EnvConfig did (system value first, then app). Uses the request's pool connection.
async function getConfigViaSystemId(conn, systemId, sessionId) {
    const sql = `SELECT SYSTEM_ID, CONFIG FROM ${table()}`
        + ` WHERE SYSTEM_ID = :systemid OR SYSTEM_ID = 'app' ORDER BY SYSTEM_ID`;
    const binds = { systemid: systemId == null ? "" : String(systemId) };
    ULog.debug(sql + " " + maskJson(binds), sessionId);

    const rows = await conn.execute(sql, binds, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        fetchInfo: { CONFIG: { type: oracledb.STRING } }
    });
    if (!rows.rows.length) throw new ServiceError(-99, `empty config for system_id='${systemId}'`);

    let own = null, app = null;
    for (const row of rows.rows) {
        let parsed;
        try {
            parsed = JSON.parse(row.CONFIG || "{}");
        } catch (parseError) {
            ULog.error(`VALIDATOR_SERVICE_CONFIG parse error, SYSTEM_ID: ${row.SYSTEM_ID}, error: ${parseError?.message}`, sessionId);
            continue;
        }
        if (row.SYSTEM_ID === "app") app = parsed;
        else own = parsed;
    }
    return { CONFIG: own || app || {}, defaultCfg: { CONFIG: app || {} } };
}

module.exports = { getAllConfig, getConfigViaSystemId, table };
