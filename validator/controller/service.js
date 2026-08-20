/**
 * The service itself: version, clock, cache and the call counters. None of these touch business data.
 *
 * The keys of the funcs table at the bottom are the ?func= values this file answers;
 * validator/index.js registers them straight from there.
 */
const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const system_cfg = require("../../config/system_cfg");
const FileCacheManager = require("../../util/FileCacheManager");
const RequestStats = require("../../util/RequestStats");


// ---------------------------------------------------------------- ?func=getversion

// Java answered with <OK code="0" message="<version>"/> from Admin.version_number.
class GetVersion extends ValidatorControllerBase {
    async func(req, res, next) {
        let respErr;
        try {
            res.setHeader("Content-Type", "text/xml");
            res.locals.data = this.getXmlResponse(0, system_cfg.version);
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


// ---------------------------------------------------------------- ?func=synctime

// Answers a bare <TIMESYNC datetime="yyyyMMddHHmmss"/>; no database, no validator status.
class SyncTime extends ValidatorControllerBase {
    async func(req, res, next) {
        let respErr;
        try {
            res.setHeader("Content-Type", "text/xml");
            res.locals.data = this.js2Xml({
                TIMESYNC: { _attributes: { datetime: this.moment().format("YYYYMMDDHHmmss") } },
            });
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


// ---------------------------------------------------------------- ?func=getcacheinfo

// Plain text dump of the cache state; Java answered before any database work was done.
class GetCacheInfo extends ValidatorControllerBase {
    async func(req, res, next) {
        let respErr;
        try {
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.locals.data = FileCacheManager.getInfo();
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


// ---------------------------------------------------------------- ?func=cleancachefiles

// Empties the download cache by hand. The scheduled version of this is the cache_cleanup job.
class CleanCacheFiles extends ValidatorControllerBase {

    async func(req, res, next) {
        let respErr;
        try {
            await FileCacheManager.cleanDirectory();
            this.okResponse(res);
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


// ---------------------------------------------------------------- ?func=getstatistics

// Plain text, not XML: Java sent the report straight to the output stream.
class GetStatistics extends ValidatorControllerBase {
    async func(req, res, next) {
        let respErr;
        try {
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.locals.data = RequestStats.report();
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


// ---------------------------------------------------------------- ?func=resetstatistics

// Java cleared the counters and then immediately counted this very call.
class ResetStatistics extends ValidatorControllerBase {
    async func(req, res, next) {
        let respErr;
        try {
            RequestStats.reset();
            RequestStats.add(res.locals.systemId, "resetStatistics");
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.locals.data = "OK";
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


module.exports = {
    funcs: {
        getversion: new GetVersion(),
        synctime: new SyncTime(),
        getcacheinfo: new GetCacheInfo(),
        cleancachefiles: new CleanCacheFiles(),
        getstatistics: new GetStatistics(),
        resetstatistics: new ResetStatistics(),
    },
};
