const fs = require("fs");
const path = require("path");
const { ULog } = require("../../../lib/utils");
const daoFactory = require("../validator/daoFactory/DaoFactory");
const SqliteDb = require("../validator/dao/sqlite/SqliteDb");
const XmlWalk = require("./XmlWalk");
const Constant = require("../constant/Constant");

// The route document is always asked for in full, whatever version the caller sent.
const FULL_VERSION = "19700101000000";
// Java appended a zero time to the yyyyMMdd operation date before comparing it.
const MIDNIGHT = "000000";
// The message the device sees when generation fails; the detail only reaches the log, as in Java.
const GENERATION_FAILED = "Error executing SQLite generation";
// Files older than this are swept out of the output directory after every generation.
const MAX_FILE_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Builds the two SQLite files the devices download. This is flow only: every statement lives in
 * validator/dao, Oracle on one side and the generated database on the other.
 *
 * node:sqlite is synchronous, so each table is read from Oracle first and then written in one
 * uninterrupted pass. The whole file is assembled in memory and copied out with a backup, which
 * is what the Java driver did with its "backup to <path>" statement.
 */
class SqliteBuilder {
    constructor() {
        this.oracle = {
            route: daoFactory.get("PkAppValDaoImpl"),
            busStop: daoFactory.get("TmsBusStopDaoImpl"),
            path: daoFactory.get("MstPathDaoImpl"),
            pathStop: daoFactory.get("TmsPathBusStopDaoImpl"),
            freeCard: daoFactory.get("BlackList20DaoImpl"),
        };
        this.sqlite = {
            version: daoFactory.get("TmsVersionDaoImpl", "sqlite"),
            route: daoFactory.get("MstRouteDaoImpl", "sqlite"),
            busStop: daoFactory.get("TmsBusStopDaoImpl", "sqlite"),
            path: daoFactory.get("MstPathDaoImpl", "sqlite"),
            routePath: daoFactory.get("TmsRoutePathDaoImpl", "sqlite"),
            pathStop: daoFactory.get("TmsPathBusStopDaoImpl", "sqlite"),
            tripType: daoFactory.get("MstTripTypeDaoImpl", "sqlite"),
            schedulePlan: daoFactory.get("TmsSchedulePlanDaoImpl", "sqlite"),
            routeSchedule: daoFactory.get("TmsRouteScheduleDaoImpl", "sqlite"),
            freeCard: daoFactory.get("TblRfcardFreeDaoImpl", "sqlite"),
        };
    }

    /** TMS_VERSION, MST_ROUTE, TMS_BUS_STOP, MST_PATH, TMS_ROUTE_PATH, TMS_PATH_BUS_STOP + plans. */
    async buildRouteInfo(conn, query, sessionId) {
        const today = this.today();
        const opdate = (query.opdate || today) + MIDNIGHT;
        const db = SqliteDb.open();
        try {
            SqliteDb.begin(db);
            // The order is Java's; MST_ROUTE adds its own TMS_VERSION row, so versions go first.
            this.step("TMS_VERSION", sessionId, () => {
                this.sqlite.version.create(db, sessionId);
                this.sqlite.version.insertAll(db, this.sqlite.version.defaults(today + MIDNIGHT), sessionId);
            });
            await this.fillRoutes(conn, db, query, sessionId);
            await this.fillBusStops(conn, db, opdate, sessionId);
            await this.fillPaths(conn, db, query.opdate || today, sessionId);
            await this.fillPathStops(conn, db, query.opdate || today, sessionId);
            this.step("MST_TRIP_TYPE, TMS_SCHEDULE_PLAN, TMS_ROUTE_SCHEDULE", sessionId, () => {
                this.sqlite.tripType.create(db, sessionId);
                this.sqlite.schedulePlan.create(db, sessionId);
                this.sqlite.routeSchedule.create(db, sessionId);
            });
            SqliteDb.commit(db);

            return await this.writeFile(db, Constant.ROUTE_DB_FILE_PATH, today, sessionId);
        } finally {
            SqliteDb.close(db);
        }
    }

    /** A single table: BLACK_LIST_20 copied into Tbl_RFCARD_FREE. */
    async buildFreeCard(conn, sessionId) {
        const today = this.today();
        const db = SqliteDb.open();
        try {
            SqliteDb.begin(db);
            const rows = await this.oracle.freeCard.getFreeCards(conn, sessionId);
            this.step("black_list_20", sessionId, () => {
                this.sqlite.freeCard.create(db, sessionId);
                this.sqlite.freeCard.insertAll(db, rows, sessionId);
            });
            SqliteDb.commit(db);

            return await this.writeFile(db, Constant.FREECARD_DB_FILE_PATH, today, sessionId);
        } finally {
            SqliteDb.close(db);
        }
    }

    /**
     * MST_ROUTE comes from the getroute document rather than a query of its own, and the
     * version stamped on that document becomes the table's TMS_VERSION row.
     */
    async fillRoutes(conn, db, query, sessionId) {
        const document = await this.oracle.route.getRoute(conn, {
            version: FULL_VERSION,
            busid: query.busid ?? null,
            opdate: query.opdate ?? null,
        }, sessionId);

        this.step("MST_ROUTE", sessionId, () => {
            this.sqlite.route.create(db, sessionId);
            if (document == null || document.length === 0) return;

            const elements = XmlWalk.elements(document);
            const root = elements.find((e) => e.name === "ROUTE_ROOT");
            this.sqlite.version.insertAll(db,
                [{ file_name: "MST_ROUTE", version: root?.attrs?.VERSION ?? null }], sessionId);

            const routes = elements.filter((e) => e.name === "ROUTE").map((e) => e.attrs);
            this.sqlite.route.insertAll(db, routes, sessionId);
        });
    }

    async fillBusStops(conn, db, opdate, sessionId) {
        const rows = await this.oracle.busStop.getStops(conn, opdate, sessionId);
        this.step("TMS_BUS_STOP", sessionId, () => {
            this.sqlite.busStop.create(db, sessionId);
            this.sqlite.busStop.insertAll(db, rows, sessionId);
        });
    }

    /** One result set, two tables: Java inserted into both inside the same loop. */
    async fillPaths(conn, db, opdate, sessionId) {
        const rows = await this.oracle.path.getPaths(conn, opdate, sessionId);
        this.step("MST_PATH,TMS_ROUTE_PATH", sessionId, () => {
            this.sqlite.path.create(db, sessionId);
            this.sqlite.routePath.create(db, sessionId);
            this.sqlite.path.insertAll(db, rows, sessionId);
            this.sqlite.routePath.insertAll(db, rows, sessionId);
        });
    }

    async fillPathStops(conn, db, opdate, sessionId) {
        const rows = await this.oracle.pathStop.getPathStops(conn, opdate, sessionId);
        this.step("TMS_PATH_BUS_STOP", sessionId, () => {
            this.sqlite.pathStop.create(db, sessionId);
            this.sqlite.pathStop.insertAll(db, rows, sessionId);
        });
    }

    /** Java labelled every failure with the table it was building; the labels are kept. */
    step(label, sessionId, fn) {
        try {
            fn();
        } catch (error) {
            ULog.error(`Error for ${label} table: ${error?.stack || error?.message}`, sessionId);
            throw new Error(GENERATION_FAILED);
        }
    }

    /**
     * The device is handed the file, not the in-memory database, so it is copied out and read
     * back. The name carries only the date, so a second call on the same day overwrites it.
     */
    async writeFile(db, directory, dateStr, sessionId) {
        fs.mkdirSync(directory, { recursive: true });
        const filePath = path.join(directory, `${dateStr}_local_.db`);
        // backup() refuses to overwrite, so yesterday's file is not in the way but today's is.
        fs.rmSync(filePath, { force: true });

        await SqliteDb.backupTo(db, filePath, sessionId);
        const data = fs.readFileSync(filePath);
        this.prune(directory, sessionId);
        return data;
    }

    /**
     * The file this run would produce, if it is already on disk. Java re-opened it through a
     * try-with-resources and handed out a stream that was closed before anyone read it, so its
     * cache branch always failed; here the bytes are read while the handle is still open.
     */
    readCached(directory) {
        const filePath = path.join(directory, `${this.today()}_local_.db`);
        return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
    }

    /** Java swept the output directory after every run, deleting anything over a day old. */
    prune(directory, sessionId) {
        const cutoff = Date.now() - MAX_FILE_AGE_MS;
        for (const entry of fs.readdirSync(directory)) {
            const target = path.join(directory, entry);
            try {
                if (fs.statSync(target).mtimeMs > cutoff) continue;
                fs.rmSync(target, { recursive: true, force: true });
            } catch (error) {
                ULog.error(`Failed to delete file: ${target}: ${error?.message}`, sessionId);
            }
        }
    }

    today() {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        return `${now.getFullYear()}${month}${day}`;
    }
}

module.exports = new SqliteBuilder();
module.exports.GENERATION_FAILED = GENERATION_FAILED;
