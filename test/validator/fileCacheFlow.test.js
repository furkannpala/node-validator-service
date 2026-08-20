/* eslint-env mocha */
const assert = require('assert');
const fs = require('fs');
const moment = require('moment');
const validator = require('../../validator/');
const FileCacheManager = require('../../util/FileCacheManager');

// Answers the two statements the dispatcher runs before it reaches a controller.
function fakeConn() {
    return {
        async execute(sql) {
            if (sql.includes('VALIDATOR_SERVICE_CONFIG')) {
                return { rows: [{ SYSTEM_ID: 'app', CONFIG: '{}' }] };
            }
            if (sql.includes('fn_get_system_pdate')) return { rows: [{ PDATE: 0 }] };
            throw new Error('unexpected sql: ' + sql);
        },
    };
}

function makeReq(query) {
    return { query, dbConn: fakeConn(), sessionId: 'validatorservices_test' };
}

function makeRes() {
    return { locals: { systemId: query => query }, headers: {}, setHeader(k, v) { this.headers[k] = v; } };
}

/** Drives the dispatcher once and resolves with whatever it passed to next(). */
function dispatch(query) {
    const req = makeReq(query);
    const res = makeRes();
    return new Promise((resolve) => {
        validator.func(req, res, (err) => resolve({ err, res }));
    });
}

describe('dispatcher file cache', () => {
    const version = '19700101000000';
    let calls = 0;
    let payload = '<ROOT><ROUTE CODE="1"/></ROOT>';
    let original;
    const fileName = () => `017_ROUTE_${version}_${moment().format('YYYYMMDD')}`;

    before(() => {
        original = validator.controller.getroute;
        validator.controller.getroute = {
            func: async (req, res, next) => {
                calls++;
                res.setHeader('Content-Type', 'text/xml');
                res.locals.data = payload;
                next();
            },
        };
    });

    after(() => {
        validator.controller.getroute = original;
        try { fs.rmSync(FileCacheManager.filePath(fileName(), 'getroute'), { force: true }); } catch (e) { /* best effort */ }
    });

    beforeEach(() => {
        calls = 0;
        FileCacheManager.clearDownload(fileName());
        try { fs.rmSync(FileCacheManager.filePath(fileName(), 'getroute'), { force: true }); } catch (e) { /* best effort */ }
    });

    it('runs the controller on a miss and stores the payload', async () => {
        const { err, res } = await dispatch({ func: 'getroute', systemid: '017', version });
        assert.strictEqual(err, undefined);
        assert.strictEqual(calls, 1);
        assert.strictEqual(res.locals.data, payload);
        assert.strictEqual((await FileCacheManager.read(fileName(), 'getroute')).toString(), payload);
    });

    it('serves the second call from disk without touching the controller', async () => {
        await dispatch({ func: 'getroute', systemid: '017', version });
        assert.strictEqual(calls, 1);

        const { err, res } = await dispatch({ func: 'getroute', systemid: '017', version });
        assert.strictEqual(err, undefined);
        assert.strictEqual(calls, 1, 'controller must not run again');
        assert.strictEqual(res.locals.data.toString(), payload);
    });

    it('bypasses the cache entirely for fromservice=1', async () => {
        await dispatch({ func: 'getroute', systemid: '017', version, fromservice: '1' });
        await dispatch({ func: 'getroute', systemid: '017', version, fromservice: '1' });
        assert.strictEqual(calls, 2);
        assert.strictEqual(await FileCacheManager.read(fileName(), 'getroute'), null);
    });

    it('does not cache a stale-version answer', async () => {
        // No opdate and a version stamp in the future: the answer is not shareable.
        await dispatch({ func: 'getroute', systemid: '017', version: '29990101000000' });
        assert.strictEqual(calls, 1);
        assert.strictEqual(await FileCacheManager.read(`017_ROUTE_29990101000000_${moment().format('YYYYMMDD')}`, 'getroute'), null);
    });

    describe('error payloads', () => {
        afterEach(() => { payload = '<ROOT><ROUTE CODE="1"/></ROOT>'; });

        it('turns code -20098 into "Get Full Version" and stores nothing', async () => {
            payload = '<ERROR code="-20098" message="x"/>';
            const { err } = await dispatch({ func: 'getroute', systemid: '017', version });
            assert.strictEqual(err.code, -20098);
            assert.strictEqual(err.message, 'Get Full Version');
            assert.strictEqual(await FileCacheManager.read(fileName(), 'getroute'), null);
        });

        it('turns any other error code into "Result Has Error"', async () => {
            payload = '<ERROR code="-1" message="no plan found"/>';
            const { err } = await dispatch({ func: 'getroute', systemid: '017', version });
            assert.strictEqual(err.code, -20093);
            assert.strictEqual(await FileCacheManager.read(fileName(), 'getroute'), null);
        });

        it('releases the download lock so the next call can retry', async () => {
            payload = '<ERROR code="-1"/>';
            await dispatch({ func: 'getroute', systemid: '017', version });
            assert.strictEqual(FileCacheManager.isDownloadStarted(fileName()), false);
        });

        it('stores non-XML content untouched', async () => {
            payload = Buffer.from([0x00, 0x01, 0x02, 0x03]);
            const { err } = await dispatch({ func: 'getroute', systemid: '017', version });
            assert.strictEqual(err, undefined);
            assert.deepStrictEqual(await FileCacheManager.read(fileName(), 'getroute'), payload);
        });
    });

    it('answers -20095 while another request is still building the file', async () => {
        FileCacheManager.startDownload(fileName());
        const { err } = await dispatch({ func: 'getroute', systemid: '017', version });
        assert.strictEqual(err.code, -20095);
        assert.strictEqual(err.message, 'File Not Ready');
        assert.strictEqual(calls, 0);
    });

    it('releases the download lock after a successful build too', async () => {
        await dispatch({ func: 'getroute', systemid: '017', version });
        // Left behind, the marker grows the map for the life of the process and answers -20095
        // for two minutes to anyone who arrives after the file itself has been swept away.
        assert.strictEqual(FileCacheManager.isDownloadStarted(fileName()), false);
    });

    it('rebuilds instead of sending an empty body when the file is swept mid-request', async () => {
        // Build it once so exists() is satisfied, then delete it underneath the next call, which
        // is exactly what the cleanup job and ?func=cleancachefiles do to a live request.
        await dispatch({ func: 'getroute', systemid: '017', version });
        assert.strictEqual(calls, 1);

        const realRead = FileCacheManager.read;
        FileCacheManager.read = async () => null;
        try {
            const { err, res } = await dispatch({ func: 'getroute', systemid: '017', version });
            assert.strictEqual(err, undefined);
            assert.strictEqual(calls, 2, 'the controller runs again rather than answering null');
            assert.strictEqual(res.locals.data, payload);
        } finally {
            FileCacheManager.read = realRead;
        }
    });
});
