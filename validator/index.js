const fs = require("fs");
const path = require("path");
const { ULog, ServiceError, xml2Json } = require("../../../lib/utils");
const requestLogDaoImpl = require("./dao/oracle/ValidatorRequestLogDaoImpl");
const pkAppValDaoImpl = require("./dao/oracle/PkAppValDaoImpl");
const RequestStats = require("../util/RequestStats");
const system_cfg = require("../config/system_cfg");
const FileCacheManager = require("../util/FileCacheManager");

const controller = {};

/**
 * The ?func= key is what a module registers, not where it lives. Endpoints are grouped by
 * subject — every card function in card.js, every route function in route.js — and each group
 * exports a `funcs` table whose keys are the ?func= values it answers.
 *
 * This replaces the 130-branch if/else chain of Java Services.doProcess. A file that exports a
 * controller directly still registers under its own lowercased name, so a single endpoint that
 * belongs in no group can stay a file of its own.
 */
const loadControllers = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const element of fs.readdirSync(directory)) {
        const absolute = path.join(directory, element);
        if (fs.statSync(absolute).isDirectory()) continue;
        if (path.extname(element) !== ".js") continue;

        const loaded = require(absolute);
        if (!loaded?.funcs) {
            controller[path.parse(element).name.toLocaleLowerCase("en-US")] = loaded;
            continue;
        }
        for (const [name, impl] of Object.entries(loaded.funcs)) {
            const key = name.toLocaleLowerCase("en-US");
            // Two groups claiming the same key would silently shadow one endpoint with another,
            // and the loser would only be noticed by the device that stopped getting answers.
            if (Object.prototype.hasOwnProperty.call(controller, key)) {
                throw new Error(`duplicate ?func= key '${key}' registered by ${element}`);
            }
            controller[key] = impl;
        }
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

/**
 * The system row layered over the shared 'app' row, straight from memory. Java read this out
 * of EnvConfig the same way; the configWatch job keeps the copy current and ?func=reloadconfig
 * refreshes it on demand, so a request never pays for a round trip to the config table.
 */
function configFor(systemId) {
    const cfgs = system_cfg.cfgs || {};
    const app = cfgs.app || {};
    const own = cfgs[systemId];
    const cfg = { ...(own || app) };
    cfg.defaultCfg = app;
    return cfg;
}

// Only these four functions have a kafka-only switch, and Java skipped the request log
// whenever the switch was on: with no database write there is nothing to correlate a log with.
const KAFKA_ONLY_FUNCS = new Set(["senddata", "sendcfg", "sendgps", "sendlog"]);

function configValue(cfg, key) {
    const own = cfg ? cfg[key] : undefined;
    if (own !== undefined) return own;
    return cfg?.defaultCfg ? cfg.defaultCfg[key] : undefined;
}

function isKafkaOnly(cfg, func) {
    if (!KAFKA_ONLY_FUNCS.has(func)) return false;
    const value = configValue(cfg, `${func}_use_only_kafka_produce`);
    if (typeof value === "string") return value !== "" && value !== "0" && value.toLowerCase() !== "false";
    return !!value;
}

/**
 * configFor copies the whole system row and savesRequestLog re-splits a comma list; both used
 * to run on every request for a result that only changes when the config does. The derived
 * view is built once per system and thrown away when system_cfg.revision moves, which
 * setCfgs bumps — the configWatch job and ?func=reloadconfig are the only writers.
 *
 * req.cfg is shared between requests from here on. Nothing writes to it: the controllers read
 * it through ValidatorControllerBase.cfg() and never assign.
 */
const derived = new Map();   // systemId -> { cfg, requestLogFuncs }
let derivedRevision = -1;

function derivedFor(systemId) {
    if (derivedRevision !== system_cfg.revision) {
        derived.clear();
        derivedRevision = system_cfg.revision;
    }
    const key = String(systemId);
    let view = derived.get(key);
    if (!view) {
        const cfg = configFor(systemId);
        const configured = configValue(cfg, "save_request_log_functions");
        const list = Array.isArray(configured) ? configured : String(configured ?? "").split(",");
        view = {
            cfg,
            requestLogFuncs: new Set(list.map((f) => String(f).trim().toLowerCase())
                .filter((f) => f !== "" && !isKafkaOnly(cfg, f))),
        };
        derived.set(key, view);
    }
    return view;
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
 * An <ERROR> element cannot be present without these bytes, so a document that does not carry
 * them needs no parse at all. That matters: xml2Json goes through xml2json + JSON.parse, which
 * is two full conversions of a payload that reaches several MB here — measured at 73 ms of
 * blocked event loop for an 800 KB card list, against roughly nothing for this test.
 */
const ERROR_ELEMENT = /<ERROR[\s/>]/i;

/**
 * An error document must never be cached and must not reach the device as a payload.
 * Content that is not XML at all (sound files) parses badly and is stored as-is, as in Java.
 */
function assertNoErrorPayload(data) {
    if (data == null) return;
    const text = Buffer.isBuffer(data) ? data.toString("utf-8") : String(data);
    if (!ERROR_ELEMENT.test(text)) return;

    let parsed;
    try {
        parsed = xml2Json(text);
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
 *
 * The marker is released in every outcome, the successful one included. Leaving it behind used
 * to grow the map for the life of the process and, once the file was swept by the cleanup job
 * or by ?func=cleancachefiles, answered the next two minutes of callers with -20095 for a
 * build that had finished long ago.
 */
async function runAndCache(req, res, next, func, key) {
    FileCacheManager.startDownload(key.fileName);
    try {
        let controllerError;
        await controller[func].func(req, res, (err) => { controllerError = err; });
        if (controllerError) return next(controllerError);

        // An error document is a normal answer here, not a failure of ours: it is reported to
        // the device and kept out of the cache without going through the -99 catch below.
        try {
            assertNoErrorPayload(res.locals.data);
        } catch (e) {
            return next(e);
        }
        await FileCacheManager.store(func, key.fileName, res.locals.data);
        next();
    } finally {
        FileCacheManager.clearDownload(key.fileName);
    }
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
            const view = derivedFor(res.locals.systemId);
            req.cfg = view.cfg;
            // Java carried the id on SystemConfig; the kafka producer cache is keyed by it.
            req.systemId = res.locals.systemId;

            if (view.requestLogFuncs.has(func)) {
                await requestLogDaoImpl.insert(req.dbConn, {
                    bus_id: req.query.busid ?? null,
                    sam_id: req.query.samid ?? null,
                    func_name: req.query.func ?? null,
                    req_url: req.originalUrl,
                    req_xml: req.rawBody == null ? null : String(req.rawBody),
                }, req.sessionId);
            }

            const key = await cacheKeyFor(req, func);
            if (!key) return await controller[func].func(req, res, next);

            if (await FileCacheManager.exists(key.fileName, func, key.offset)) {
                // The cleanup job and ?func=cleancachefiles both delete underneath a request,
                // so the file can be gone by the time it is read. A null here means the answer
                // has to be built after all; sending it would be an empty 200 to the device.
                const cached = await FileCacheManager.read(key.fileName, func, req.query.rtype);
                if (cached !== null) {
                    sendCached(res, func, cached);
                    return next();
                }
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
module.exports.configFor = configFor;
// Exported for the tests: the cached view is what a request actually gets, so its invalidation
// is the thing worth asserting, not the layering configFor does underneath it.
module.exports.derivedFor = derivedFor;
