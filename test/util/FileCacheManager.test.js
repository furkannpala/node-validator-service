/* eslint-env mocha */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const moment = require('moment');
const FileCacheManager = require('../../util/FileCacheManager');

const today = () => moment().format('YYYYMMDD');

describe('FileCacheManager.isOperationDefined', () => {
    it('accepts the eight cached funcs and nothing else', () => {
        assert.strictEqual(FileCacheManager.isOperationDefined('getroute', '017'), true);
        assert.strictEqual(FileCacheManager.isOperationDefined('getrouteschedule', '017'), true);
        assert.strictEqual(FileCacheManager.isOperationDefined('getzone', '017'), false);
        assert.strictEqual(FileCacheManager.isOperationDefined('getschedule', '017'), false);
    });

    it('switches off for system 004 + getschedule', () => {
        assert.strictEqual(FileCacheManager.isOperationDefined('getschedule', '004'), false);
    });

    it('switches off for getofflinecardlist unless version is a 1970 stamp', () => {
        assert.strictEqual(
            FileCacheManager.isOperationDefined('getofflinecardlist', '017', '19700101000000', null, null), true);
        assert.strictEqual(
            FileCacheManager.isOperationDefined('getofflinecardlist', '017', '20260101000000', null, null), false);
        // enc=1 is the binary card list, which is per-sam and must never be shared.
        assert.strictEqual(
            FileCacheManager.isOperationDefined('getofflinecardlist', '017', '19700101000000', '1', null), false);
    });

    it('switches off for getfiles with type 6', () => {
        assert.strictEqual(FileCacheManager.isOperationDefined('getfiles', '017', null, null, '5'), true);
        assert.strictEqual(FileCacheManager.isOperationDefined('getfiles', '017', null, null, '6'), false);
    });
});

describe('FileCacheManager.buildFileName', () => {
    it('uses sysid_KEY_version_YYYYMMDD', () => {
        const name = FileCacheManager.buildFileName('getroute', { systemid: '017', version: '20260101000000' }, 0);
        assert.strictEqual(name, `017_ROUTE_20260101000000_${today()}`);
    });

    it('uses type_fileid for getfiles, which carries no version', () => {
        const name = FileCacheManager.buildFileName('getfiles', { systemid: '017', type: '5', fileid: '30002' }, 0);
        assert.strictEqual(name, `017_STOPSOUND_5_30002_${today()}`);
    });

    it('appends the time unit for getrouteschedule', () => {
        const name = FileCacheManager.buildFileName(
            'getrouteschedule', { systemid: '017', version: '1970', timeunit: '1' }, 0);
        assert.strictEqual(name, `017_ROUTESCHEDULE_1970_1_${today()}`);
    });

    it('returns an empty name when the operation is not cached', () => {
        assert.strictEqual(FileCacheManager.buildFileName('getzone', { systemid: '017' }, 0), '');
    });
});

describe('FileCacheManager.isSameDate', () => {
    it('is true when the device asks about the current operation day', () => {
        assert.strictEqual(FileCacheManager.isSameDate(today(), null, 0), true);
    });

    it('falls back to the version stamp when opdate is missing or in the past', () => {
        assert.strictEqual(FileCacheManager.isSameDate(null, '19700101000000', 0), true);
        assert.strictEqual(FileCacheManager.isSameDate('19990101', '19700101000000', 0), true);
        assert.strictEqual(FileCacheManager.isSameDate('19990101', '29990101000000', 0), false);
    });

    it('is false with neither a usable opdate nor a version', () => {
        assert.strictEqual(FileCacheManager.isSameDate(null, null, 0), false);
        assert.strictEqual(FileCacheManager.isSameDate('not-a-date', '123', 0), false);
    });
});

describe('FileCacheManager download lock', () => {
    it('reports a build in progress until it is cleared', () => {
        assert.strictEqual(FileCacheManager.isDownloadStarted('x_1'), false);
        FileCacheManager.startDownload('x_1');
        assert.strictEqual(FileCacheManager.isDownloadStarted('x_1'), true);
        FileCacheManager.clearDownload('x_1');
        assert.strictEqual(FileCacheManager.isDownloadStarted('x_1'), false);
    });
});

describe('FileCacheManager store/read', () => {
    const fileName = `017_ROUTE_test_${today()}`;

    after(() => {
        try { fs.rmSync(FileCacheManager.filePath(fileName, 'getroute'), { force: true }); } catch (e) { /* best effort */ }
    });

    it('round-trips content and answers URI with the path', async () => {
        await FileCacheManager.store('getroute', fileName, '<ROOT/>');
        assert.strictEqual((await FileCacheManager.read(fileName, 'getroute')).toString(), '<ROOT/>');

        const uri = (await FileCacheManager.read(fileName, 'getroute', 'URI')).toString();
        assert.ok(uri.endsWith(path.join('ROUTE', fileName)), uri);
    });

    it('returns null for a file that is not there', async () => {
        assert.strictEqual(await FileCacheManager.read('missing_file', 'getroute'), null);
        // URI answers null too rather than a path to something that is not on disk.
        assert.strictEqual(await FileCacheManager.read('missing_file', 'getroute', 'URI'), null);
    });
});
