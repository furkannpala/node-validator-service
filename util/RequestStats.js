const moment = require("moment");

/**
 * In-memory call counter per systemId and func, carried over from Java Validator.statics.
 * The framework's getStatistics() reports pool metrics, which is a different thing, so this
 * counter has to live here for ?func=getstatistics to keep answering what devices expect.
 */
let statics = {};
let statisticDate = moment().format("YYYYMMDD");
let appStartDate = moment().format("DD.MM.YYYY HH:mm:ss");

function rpad(data, pad, length) {
    return String(data == null ? "" : data).padEnd(length, pad).slice(0, length);
}

function add(systemId, func) {
    // Java rolled the counters over at midnight rather than growing them forever.
    const today = moment().format("YYYYMMDD");
    if (statisticDate !== today) reset();

    const sys = systemId == null ? "" : String(systemId);
    if (!statics[sys]) statics[sys] = {};
    statics[sys][func] = (statics[sys][func] || 0) + 1;
}

/** Fixed-width text report, CRLF line endings, exactly as the Java branch built it. */
function report() {
    let out = "Baslangic Tarihi : " + appStartDate + "\r\n\r\n";
    for (const sys of Object.keys(statics).sort()) {
        out += sys + "  (SystemID)\r\n";
        out += rpad("Fonksiyon", " ", 20) + "    Sayi\r\n";
        out += "-----------------------------------------------------\r\n";
        for (const func of Object.keys(statics[sys])) {
            out += rpad(func, " ", 20) + " => " + statics[sys][func] + "\r\n";
        }
        out += "-----------------------------------------------------\r\n\r\n\r\n";
    }
    return out;
}

function reset() {
    statics = {};
    appStartDate = moment().format("DD.MM.YYYY HH:mm:ss");
    statisticDate = moment().format("YYYYMMDD");
}

module.exports = { add, report, reset, rpad };
