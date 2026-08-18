const oracledb = require("oracledb");
const { getConnection, getPools, ULog } = require("../../../../../lib/utils");
const system_cfg = require("../../../config/system_cfg");

// Empty kk_config_scheme = the pool user owns the table; 'KKCONFIG' on test/prod.
// Only this table is prefixed: AFC_TD, MST_BUS, PK_APP_VAL always live in the pool schema.
function table() {
    const scheme = system_cfg.kk_config_scheme ? system_cfg.kk_config_scheme + "." : "";
    return scheme + "VALIDATOR_SERVICE_CONFIG";
}

const KKCONFIG_ALIAS = "kkconfig";

/**
 * The config table lives in one central place. A pool named 'kkconfig' is that place when it
 * exists; otherwise the first Oracle pool is used, which is only correct while every pool can
 * see the table.
 */
async function resolveConfigAlias() {
    const oracle = (await getPools())?.oracle || {};
    if (oracle[KKCONFIG_ALIAS]) return KKCONFIG_ALIAS;
    const first = Object.keys(oracle)[0];
    if (!first) throw new Error("no oracle pool available for the config table");
    return first;
}

// Every row, for the boot-time / admin load. A row whose CONFIG is not valid JSON is logged
// and skipped so one bad il cannot keep the whole service from configuring itself.
async function getAllConfig() {
    const sql = `SELECT SYSTEM_ID, CONFIG FROM ${table()}`;
    let dbConn;
    const result = [];
    try {
        dbConn = await getConnection(await resolveConfigAlias());
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

module.exports = { getAllConfig, table, resolveConfigAlias };
