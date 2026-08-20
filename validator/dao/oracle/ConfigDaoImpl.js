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
 * The config table lives in one central place, and the pool named 'kkconfig' is that place.
 *
 * There is deliberately no fallback to another pool. initPools fills the pool map one alias at
 * a time and getPools() answers with whatever exists at that instant, so during startup "there
 * is no kkconfig" and "kkconfig has not been created yet" look identical from here. Falling
 * back would mean reading the config table through whichever pool happened to be created first
 * — on this deployment '017' — and configuring the whole service from it without any error.
 * Refusing costs a retry; guessing costs a service that runs on the wrong configuration.
 */
async function resolveConfigAlias() {
    return pickConfigAlias((await getPools())?.oracle || {});
}

/**
 * Split out from the call above so the decision can be tested against a pool map that has
 * other aliases in it: getPools is captured at load time and the test process has no pools of
 * its own, so going through resolveConfigAlias would only ever exercise the empty map.
 */
function pickConfigAlias(oraclePools) {
    if (oraclePools[KKCONFIG_ALIAS]) return KKCONFIG_ALIAS;
    const others = Object.keys(oraclePools);
    throw new Error(`no '${KKCONFIG_ALIAS}' oracle pool: the config table has no other home`
        + `${others.length ? ` (pools up: ${others.join(", ")})` : ""}`);
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

module.exports = { getAllConfig, table, resolveConfigAlias, pickConfigAlias };
