const fs = require("fs");
const path = require("path");
const moment = require("moment");
const { ULog } = require("../../../lib/utils");

/**
 * Disk cache for the eight heavy read endpoints, carried over from Java FileCacheManager.
 * Pure file and date logic - the operation-day offset comes from the caller, because the
 * database call that produces it belongs in the DAO layer.
 */

const DIRECTORY_NAME = "validatorCacheFiles";

// func -> { directory, fileKey }. Java kept both fields even though they always match.
const OPERATIONS = {
    getvehiclestop: { directory: "VEHICLESTOP", fileKey: "VEHICLESTOP" },
    getpathbusstop: { directory: "PATHSTOP", fileKey: "PATHSTOP" },
    getfiles: { directory: "STOPSOUND", fileKey: "STOPSOUND" },
    getroute: { directory: "ROUTE", fileKey: "ROUTE" },
    getpath: { directory: "PATH", fileKey: "PATH" },
    getroutepath: { directory: "ROUTEPATH", fileKey: "ROUTEPATH" },
    getrouteschedule: { directory: "ROUTESCHEDULE", fileKey: "ROUTESCHEDULE" },
    getofflinecardlist: { directory: "GETOFFLINECARDLIST", fileKey: "GETOFFLINECARDLIST" },
};

const DOWNLOAD_TIMEOUT_MS = 120 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Java shifted by the operation offset plus five minutes when deciding which day it is.
const GRACE_MS = 5 * 60 * 1000;

const downloads = new Map();   // fileName -> start time
const offsets = new Map();     // systemId -> fn_get_system_pdate('M') in minutes
let startTime = 0;

function baseDir() {
    return path.join(process.cwd(), DIRECTORY_NAME);
}

function directoryOf(func) {
    return OPERATIONS[String(func).toLowerCase()]?.directory || "default";
}

function filePath(fileName, func) {
    return path.join(baseDir(), directoryOf(func), fileName);
}

/** Offsets are memoised per system: Java cached them in a static map for the process lifetime. */
function getOffset(systemId) {
    return offsets.get(String(systemId));
}

function setOffset(systemId, minutes) {
    offsets.set(String(systemId), Number(minutes) || 0);
}

function shiftedDate(offsetMinutes, extraMs) {
    return moment(Date.now() - (Number(offsetMinutes) || 0) * 60 * 1000 - (extraMs || 0));
}

/**
 * Four carve-outs that switch caching off, copied one for one from Java: they are the cases
 * where the answer is not the same for every device asking on that day.
 */
function isOperationDefined(func, systemId, version, enc, type) {
    const f = String(func).toLowerCase();
    if (String(systemId) === "004" && f === "getschedule") return false;
    if (f === "getofflinecardlist"
        && ((version != null && !String(version).startsWith("1970")) || (enc != null && String(enc) === "1"))) {
        return false;
    }
    if (f === "getfiles" && type != null && String(type) === "6") return false;
    return Object.prototype.hasOwnProperty.call(OPERATIONS, f);
}

/**
 * sysid_KEY_version_YYYYMMDD. getfiles has no version so it uses type_fileid, and
 * getrouteschedule appends the time unit because it changes the payload.
 */
function buildFileName(func, query, offsetMinutes) {
    const f = String(func).toLowerCase();
    if (!isOperationDefined(f, query.systemid, query.version, query.enc, query.type)) return "";

    let version = query.version;
    if (f === "getfiles") version = `${query.type}_${query.fileid}`;
    else if (f === "getrouteschedule") version = `${query.version}_${query.timeunit}`;

    const day = shiftedDate(offsetMinutes, 0).format("YYYYMMDD");
    return `${query.systemid}_${OPERATIONS[f].fileKey}_${version}_${day}`;
}

/**
 * True when the device is asking about the current operation day, or its version stamp is not
 * newer than it. Only then may an answer be shared between devices.
 */
function isSameDate(opdate, version, offsetMinutes) {
    const sysdate = shiftedDate(offsetMinutes, GRACE_MS).format("YYYYMMDD");
    const versionDate = (version != null && String(version).length >= 8) ? String(version).slice(0, 8) : "";

    if (opdate != null && String(opdate) !== "") {
        const parsed = moment(String(opdate), "YYYYMMDD", true);
        if (parsed.isValid() && parsed.format("YYYYMMDD") === sysdate) return true;
    }
    return versionDate !== "" && versionDate <= sysdate;
}

function createDirectory() {
    try {
        fs.mkdirSync(baseDir(), { recursive: true });
        for (const op of Object.values(OPERATIONS)) {
            fs.mkdirSync(path.join(baseDir(), op.directory), { recursive: true });
        }
    } catch (e) {
        ULog.error(`cache createDirectory failed: ${e?.message}`);
    }
}

function cleanDirectory() {
    try {
        fs.rmSync(baseDir(), { recursive: true, force: true });
    } catch (e) {
        ULog.error(`cache cleanDirectory failed: ${e?.message}`);
    } finally {
        startTime = Date.now();
    }
}

/**
 * Deletes cached files that are older than maxAgeMs and reports how many went. This is what
 * the cacheCleanup job runs; ?func=cleancachefiles still empties the whole tree at once.
 */
function removeExpired(maxAgeMs) {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const dir of directories()) {
        for (const entry of safeList(dir)) {
            const target = path.join(dir, entry);
            try {
                if (!fs.statSync(target).isFile() || fs.statSync(target).mtimeMs > cutoff) continue;
                fs.rmSync(target, { force: true });
                removed++;
            } catch (e) {
                ULog.error(`cache removeExpired failed for ${target}: ${e?.message}`);
            }
        }
    }
    return removed;
}

/** The base directory plus one directory per cached operation. */
function directories() {
    return [baseDir(), ...Object.values(OPERATIONS).map((op) => path.join(baseDir(), op.directory))];
}

function safeList(dir) {
    try {
        return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    } catch (e) {
        ULog.error(`cache list failed for ${dir}: ${e?.message}`);
        return [];
    }
}

/** Also performs the day rollover: a cached file must never outlive its operation day. */
function exists(fileName, func, offsetMinutes) {
    const now = Date.now();
    const dayNow = shiftedDate(offsetMinutes, GRACE_MS).dayOfYear();
    const dayStart = moment(startTime - (Number(offsetMinutes) || 0) * 60 * 1000 - GRACE_MS).dayOfYear();

    if (now - startTime > DAY_MS || dayNow !== dayStart) {
        cleanDirectory();
        createDirectory();
    }
    return fs.existsSync(filePath(fileName, func));
}

/** rtype=URI answers with the path itself instead of the content, as Java did. */
function read(fileName, func, rtype) {
    const full = filePath(fileName, func);
    if (!fs.existsSync(full)) return null;
    if (String(rtype).toUpperCase() === "URI") return Buffer.from(full);
    return fs.readFileSync(full);
}

function store(func, fileName, content) {
    try {
        createDirectory();
        fs.writeFileSync(filePath(fileName, func), Buffer.isBuffer(content) ? content : Buffer.from(String(content)));
    } catch (e) {
        // Java swallowed this silently; a failed write only costs the next caller a rebuild.
        ULog.error(`cache store failed for ${fileName}: ${e?.message}`);
    }
}

/** True while another request is already building the same file and has not timed out. */
function isDownloadStarted(fileName) {
    const started = downloads.get(fileName);
    return started != null && (Date.now() - started) < DOWNLOAD_TIMEOUT_MS;
}

function startDownload(fileName) {
    downloads.set(fileName, Date.now());
}

function clearDownload(fileName) {
    downloads.delete(fileName);
}

function getInfo() {
    let out = "StartTime :" + startTime;
    for (const [name, at] of downloads) out += `\n${name}-${at}`;
    out += "\n Skip Bus-Operation List";
    return out;
}

module.exports = {
    isOperationDefined, buildFileName, isSameDate,
    exists, read, store, filePath,
    isDownloadStarted, startDownload, clearDownload, cleanDirectory, removeExpired,
    getOffset, setOffset, getInfo,
};
