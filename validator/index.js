const fs = require("fs");
const path = require("path");
const { ULog, ServiceError, xml2Json } = require("../../../lib/utils");
const configDaoImpl = require("./dao/oracle/ConfigDaoImpl");
const pkAppValDaoImpl = require("./dao/oracle/PkAppValDaoImpl");
const RequestStats = require("../util/RequestStats");
const FileCacheManager = require("../util/FileCacheManager");

const controller = {};

// The lowercased file name becomes the ?func= key, so the file name is the contract.
// This replaces the 130-branch if/else chain of Java Services.doProcess.
const loadControllers = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const element of fs.readdirSync(directory)) {
        const absolute = path.join(directory, element);
        if (fs.statSync(absolute).isDirectory()) continue;
        if (path.extname(element) !== ".js") continue;
        controller[path.parse(element).name.toLocaleLowerCase("en-US")] = require(absolute);
    }
};
loadControllers(`${__dirname}/controller`);

/** Minutes of operation-day offset. Java swallowed every failure here and fell back to 0. */
async function resolveOffset(req) {
    const systemId = req.query.systemid;
    let offset = FileCacheManager.getOffset(systemId);
    if (offset !== undefined) return offset;

    try {
        offset = await pkAppValDaoImpl.getSystemPdate(req.dbConn, { type: "M" }, req.sessionId);
    } catch (e) {
        ULog.error(`fn_get_system_pdate failed, cache offset falls back to 0: ${e?.message}`, req.sessionId);
        offset = 0;
    }
    FileCacheManager.setOffset(systemId, offset);
    return offset;
}

/** Returns the cache file name for this request, or null when the answer is not shareable. */
async function cacheKeyFor(req, func) {
    const q = req.query;
    if (!FileCacheManager.isOperationDefined(func, q.systemid, q.version, q.enc, q.type)) return null;
    // fromservice=1 marks a call the service made to itself; it must not read or write the cache.
    if (String(q.fromservice) === "1") return null;

    const offset = await resolveOffset(req);
    if (!FileCacheManager.isSameDate(q.opdate, q.version, offset)) return null;

    const fileName = FileCacheManager.buildFileName(func, q, offset);
    return fileName ? { fileName, offset } : null;
}

/** Walks the compact xml-js tree and returns the code of the first ERROR element. */
function firstErrorCode(node) {
    if (!node || typeof node !== "object") return null;
    for (const [key, value] of Object.entries(node)) {
        if (key === "ERROR") {
            const list = Array.isArray(value) ? value : [value];
            const attrs = list[0]?._attributes || {};
            return attrs.code ?? attrs.CODE ?? null;
        }
        const found = firstErrorCode(value);
        if (found !== null) return found;
    }
    return null;
}

/**
 * An error document must never be cached and must not reach the device as a payload.
 * Content that is not XML at all (sound files) parses badly and is stored as-is, as in Java.
 */
function assertNoErrorPayload(data) {
    let parsed;
    try {
        parsed = xml2Json(data);
    } catch (e) {
        return;
    }
    const code = firstErrorCode(parsed);
    if (code == null) return;
    if (String(code) === "-20098") throw new ServiceError(-20098, "Get Full Version");
    throw new ServiceError(-20093, "Result Has Error");
}

function sendCached(res, func, content) {
    // Java set no content type here; this mirrors what the live path sends for the same funcs.
    res.setHeader("Content-Type", func === "getfiles" ? "application/octet-stream" : "text/xml");
    res.locals.data = content;
}

/**
 * Runs the controller, then validates and stores its payload before the response goes out.
 * The controller always calls next() exactly once, so wrapping it is the only hook available.
 */
async function runAndCache(req, res, next, func, key) {
    FileCacheManager.startDownload(key.fileName);
    await controller[func].func(req, res, (err) => {
        if (err) {
            FileCacheManager.clearDownload(key.fileName);
            return next(err);
        }
        try {
            assertNoErrorPayload(res.locals.data);
        } catch (e) {
            FileCacheManager.clearDownload(key.fileName);
            return next(e);
        }
        FileCacheManager.store(func, key.fileName, res.locals.data);
        next();
    });
}

module.exports = {
    methods: ['get', 'post'],
    conn: true,
    path: "/Validator",
    func: async (req, res, next) => {
        const func = (req.query.func || 'no_func').toLowerCase();
        ULog.debug(func, req.sessionId);
        // Counted before dispatch, as Java did in the servlet, so failed calls count too.
        RequestStats.add(res.locals.systemId, req.query.func || 'no_func');
        try {
            // hasOwnProperty is required: a plain lookup also walks the prototype chain, so
            // ?func=constructor would pass the guard and hang the request forever.
            if (!Object.prototype.hasOwnProperty.call(controller, func)) {
                return next(new ServiceError(-9, "unrecognized func " + func));
            }
            const config = await configDaoImpl.getConfigViaSystemId(req.dbConn, res.locals.systemId, req.sessionId);
            req.cfg = config?.CONFIG;
            if (req.cfg) req.cfg.defaultCfg = config?.defaultCfg?.CONFIG;

            const key = await cacheKeyFor(req, func);
            if (!key) return await controller[func].func(req, res, next);

            if (FileCacheManager.exists(key.fileName, func, key.offset)) {
                sendCached(res, func, FileCacheManager.read(key.fileName, func, req.query.rtype));
                return next();
            }
            if (FileCacheManager.isDownloadStarted(key.fileName)) {
                return next(new ServiceError(-20095, "File Not Ready"));
            }
            await runAndCache(req, res, next, func, key);
        } catch (error) {
            ULog.error(error?.stack || error?.message, req.sessionId);
            next(error instanceof ServiceError ? error : new ServiceError(-99, error.message));
        }
    }
};

module.exports.controller = controller;
