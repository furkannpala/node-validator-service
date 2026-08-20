const { ULog } = require("../../../../lib/utils");
const { maskJson } = require("../../util/LogMask");

/**
 * The statement trace the roadmap asks for before every execute, behind a switch.
 *
 * It is not cheap. ULog has no level of its own, so every call formats the line, writes it to
 * stdout synchronously and sends a UDP packet to ELK — and the DAO builds the masked bind text
 * before it. Measured on senddata with eight concurrent requests: 105 requests/s with the
 * trace, 161 without it, so it costs about a third of the throughput on the write path.
 *
 * On by default, because losing the trace silently would be worse than the cost. VS_SQL_DEBUG=0
 * turns it off, and then the masking is not computed either — that is the point of the guard
 * living here rather than inside ULog.
 */
const ENABLED = process.env.VS_SQL_DEBUG !== "0";

function debugSql(sql, binds, sessionId) {
    if (!ENABLED) return;
    ULog.debug(binds === undefined ? sql : sql + " " + maskJson(binds), sessionId);
}

module.exports = { debugSql };
