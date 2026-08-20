/* eslint-env mocha */
const assert = require('assert');

const jobs = require('../../jobs');
const { JobManager } = require('../../jobs/JobManager');
const configWatch = require('../../jobs/configWatch');
const cacheCleanup = require('../../jobs/cacheCleanup');
const errorTdWatch = require('../../jobs/errorTdWatch');
const poolPressure = require('../../jobs/poolPressure');
const sqliteRefresh = require('../../jobs/sqliteRefresh');
const requestLogRetention = require('../../jobs/requestLogRetention');
const kpgHealth = require('../../jobs/kpgHealth');
const { fakeConn } = require('../fakeConn');

/** A stand-in for system_cfg with the same three-step lookup: system -> app -> default. */
function appConfigOf(cfgs) {
    return {
        cfgs,
        loaded: true,
        getSystemConfig(key, systemId, defaultValue) {
            const k = String(key).toLowerCase();
            const own = cfgs[systemId];
            if (own && own[k] !== undefined) return own[k];
            if (cfgs.app && cfgs.app[k] !== undefined) return cfgs.app[k];
            return defaultValue;
        },
        setCfgs(next) {
            for (const key of Object.keys(cfgs)) delete cfgs[key];
            Object.assign(cfgs, next);
        },
    };
}

/** Records what got scheduled instead of arming real timers. */
function managerOf(cfgs, extraDeps = {}) {
    const scheduled = [];
    const manager = new JobManager();
    manager.appConfig = appConfigOf(cfgs);
    manager.deps = {
        assignFixRateScheduler: (fn, rateMs, delayMs) => {
            const handle = { fn, rateMs, delayMs, stop() { handle.stopped = true; } };
            scheduled.push(handle);
            return handle;
        },
        getStatistics: async () => ({ oracle: {} }),
        getConnection: async () => fakeConn(),
        ...extraDeps,
    };
    manager.scheduled = scheduled;
    return manager;
}

const APP_ONLY = () => ({ app: {} });

describe('job registration', () => {
    it('registers the four jobs that are on by default', async () => {
        const manager = managerOf(APP_ONLY());
        const handles = await jobs.bindJobs(manager);

        assert.strictEqual(handles.length, 4);
        assert.deepStrictEqual(
            [configWatch, cacheCleanup, errorTdWatch, poolPressure].map((j) => j.name),
            ['configWatch', 'cacheCleanup', 'errorTdWatch', 'poolPressure']);
    });

    it('leaves the other three unregistered until they are configured', async () => {
        const manager = managerOf(APP_ONLY());
        assert.strictEqual(sqliteRefresh.register(manager), null, 'no systems listed');
        assert.strictEqual(requestLogRetention.register(manager), null, 'no retention period');
        assert.strictEqual(kpgHealth.register(manager), null, 'no probe url');
    });

    it('registers each of the three once its key is set', async () => {
        const manager = managerOf({ app: {
            sqlite_refresh_systems: '017',
            request_log_retention_days: 30,
            kpg_health_url: 'https://kpg.example/health',
        } });
        assert.ok(sqliteRefresh.register(manager));
        assert.ok(requestLogRetention.register(manager));
        assert.ok(kpgHealth.register(manager));
    });

    it('staggers the first run by position so they do not collide on startup', async () => {
        const manager = managerOf(APP_ONLY());
        await jobs.bindJobs(manager);

        const delays = manager.scheduled.map((h) => h.delayMs - h.rateMs);
        assert.deepStrictEqual(delays, [0, jobs.STAGGER_STEP_MS, jobs.STAGGER_STEP_MS * 2,
            jobs.STAGGER_STEP_MS * 3]);
    });

    it('stops every handle it was given', async () => {
        const manager = managerOf(APP_ONLY());
        const handles = await jobs.bindJobs(manager);
        jobs.stopJobs(handles);
        assert.ok(handles.every((h) => h.stopped));
    });
});

describe('job periods', () => {
    it('falls back to the default for a non-positive or unusable value', () => {
        for (const bad of [0, -1, 'abc', null]) {
            const manager = managerOf({ app: { config_refresh_ms: bad } });
            assert.strictEqual(configWatch.intervalMs(manager), configWatch.DEFAULT_INTERVAL_MS,
                `value ${bad}`);
        }
    });

    it('takes a configured positive value', () => {
        const manager = managerOf({ app: { config_refresh_ms: 60000 } });
        assert.strictEqual(configWatch.intervalMs(manager), 60000);
    });

    it('reads job keys from the app row even when a system overrides them', () => {
        const manager = managerOf({ app: { config_refresh_ms: 60000 }, '017': { config_refresh_ms: 1000 } });
        assert.strictEqual(configWatch.intervalMs(manager), 60000);
    });
});

describe('poolPressure', () => {
    const watched = new Set(['017']);

    it('says nothing about a pool with room left', () => {
        const stats = { oracle: { '017': { connectionsInUse: 1, poolMax: 5, currentQueueLength: 0 } } };
        assert.deepStrictEqual(poolPressure.inspect(stats, watched), []);
    });

    it('warns when a request had to queue', () => {
        const stats = { oracle: { '017': { connectionsInUse: 5, poolMax: 5, currentQueueLength: 1 } } };
        assert.match(poolPressure.inspect(stats, watched)[0], /queued/);
    });

    it('warns when the pool is exactly full', () => {
        const stats = { oracle: { '017': { connectionsInUse: 5, poolMax: 5, currentQueueLength: 0 } } };
        assert.match(poolPressure.inspect(stats, watched)[0], /pool is full/);
    });

    it('ignores pools that belong to another webapp', () => {
        const stats = { oracle: { other: { connectionsInUse: 9, poolMax: 9, currentQueueLength: 3 } } };
        assert.deepStrictEqual(poolPressure.inspect(stats, watched), []);
    });
});

describe('cacheCleanup', () => {
    it('passes the configured age to the cache and reports what went', async () => {
        const manager = managerOf({ app: { cache_max_age_ms: 1000 } });
        let asked = null;
        const removed = await cacheCleanup.run(manager,
            { removeExpired: (ms) => { asked = ms; return 3; } });

        assert.strictEqual(asked, 1000);
        assert.strictEqual(removed, 3);
    });

    it('defaults to a day when nothing is configured', () => {
        assert.strictEqual(cacheCleanup.maxAgeMs(managerOf(APP_ONLY())),
            cacheCleanup.DEFAULT_MAX_AGE_MS);
    });
});

describe('errorTdWatch', () => {
    const cfgs = { app: {}, '017': {}, '026': {} };

    afterEach(() => { errorTdWatch.run.lastRunAt = null; });

    it('asks every configured system, not the app row', async () => {
        const asked = [];
        const manager = managerOf({ ...cfgs });
        manager.deps.getConnection = async (alias) => { asked.push(alias); return fakeConn(); };

        await errorTdWatch.run(manager, { countSince: async () => [] });
        assert.deepStrictEqual(asked, ['017', '026']);
    });

    it('looks one interval back on its first run and then from the last run', async () => {
        const windows = [];
        const manager = managerOf({ app: { error_td_watch_interval_ms: 60000 }, '017': {} });
        const dao = { countSince: async (conn, since) => { windows.push(since); return []; } };

        await errorTdWatch.run(manager, dao);
        const firstWindow = Date.now() - windows[0].getTime();
        assert.ok(firstWindow >= 60000 - 500 && firstWindow < 61000, 'first run looks back one interval');

        await errorTdWatch.run(manager, dao);
        assert.ok(windows[1] > windows[0], 'the second run starts where the first stopped');
    });

    it('keeps going when one system fails and reports it afterwards', async () => {
        const manager = managerOf({ ...cfgs });
        const seen = [];
        const dao = {
            countSince: async (conn) => {
                seen.push(conn);
                if (seen.length === 1) throw new Error('ORA-12541');
                return [{ ERROR_CODE: 'XML_PARSE_ERROR', CNT: 2 }];
            },
        };
        await assert.rejects(() => errorTdWatch.run(manager, dao), /ORA-12541/);
        assert.strictEqual(seen.length, 2, 'the second system was still asked');
    });

    it('does not move the window past a round that failed', async () => {
        const windows = [];
        const manager = managerOf({ app: { error_td_watch_interval_ms: 60000 }, '017': {} });
        let fail = true;
        const dao = {
            countSince: async (conn, since) => {
                windows.push(since);
                if (fail) throw new Error('ORA-12541');
                return [];
            },
        };

        await assert.rejects(() => errorTdWatch.run(manager, dao), /ORA-12541/);
        fail = false;
        await errorTdWatch.run(manager, dao);

        // Had the failed round moved the window, the second one would start where it ran —
        // a lookback of about zero — and the rows of the failed window would be lost for good.
        const secondLookback = Date.now() - windows[1].getTime();
        assert.ok(secondLookback >= 60000 - 500, `still looks an interval back, got ${secondLookback}`);
    });
});

describe('requestLogRetention', () => {
    it('is off with no period, and error records follow the request log by default', () => {
        const off = managerOf(APP_ONLY());
        assert.strictEqual(requestLogRetention.requestLogDays(off), 0);
        assert.strictEqual(requestLogRetention.errorTdDays(off), 0);

        const on = managerOf({ app: { request_log_retention_days: 30 } });
        assert.strictEqual(requestLogRetention.errorTdDays(on), 30, 'inherits the request period');
    });

    it('keeps a separate period for the error records', () => {
        const manager = managerOf({ app: { request_log_retention_days: 30, error_td_retention_days: 180 } });
        assert.strictEqual(requestLogRetention.errorTdDays(manager), 180);
    });

    it('purges only the table whose period is set', async () => {
        const manager = managerOf({ app: { error_td_retention_days: 180 }, '017': {} });
        const calls = [];
        await requestLogRetention.run(manager, {
            requestLog: { purge: async () => { calls.push('requestLog'); return { deleted: 0 }; } },
            errorTd: { purge: async (conn, days, batch) => {
                calls.push(`errorTd:${days}:${batch}`);
                return { deleted: 5, more: false };
            } },
        });
        assert.deepStrictEqual(calls, ['errorTd:180:5000']);
    });
});

describe('sqliteRefresh', () => {
    it('reads its system list as a comma list', () => {
        const manager = managerOf({ app: { sqlite_refresh_systems: '017, 026 ,' } });
        assert.deepStrictEqual(sqliteRefresh.systems(manager), ['017', '026']);
    });

    it('builds both files for each listed system', async () => {
        const manager = managerOf({ app: { sqlite_refresh_systems: '017,026' } });
        const built = [];
        await sqliteRefresh.run(manager, {
            buildRouteInfo: async () => built.push('route'),
            buildFreeCard: async () => built.push('freeCard'),
        });
        assert.deepStrictEqual(built, ['route', 'freeCard', 'route', 'freeCard']);
    });

    it('reports a failing system without stopping the others', async () => {
        const manager = managerOf({ app: { sqlite_refresh_systems: '017,026' } });
        let calls = 0;
        await assert.rejects(() => sqliteRefresh.run(manager, {
            buildRouteInfo: async () => { calls++; if (calls === 1) throw new Error('ORA-00942'); },
            buildFreeCard: async () => {},
        }), /017: ORA-00942/);
        assert.strictEqual(calls, 2);
    });
});

describe('kpgHealth', () => {
    it('does nothing at all without a url', async () => {
        let called = false;
        await kpgHealth.run(managerOf(APP_ONLY()), { probe: async () => { called = true; } });
        assert.strictEqual(called, false, 'no uninvited traffic to a payment gateway');
    });

    it('probes the configured url with the configured timeout', async () => {
        const manager = managerOf({ app: { kpg_health_url: 'https://kpg.example/h', kpg_health_timeout_ms: 1234 } });
        const seen = {};
        await kpgHealth.run(manager, { probe: async (url, timeout) => {
            Object.assign(seen, { url, timeout });
            return { statusCode: 200, ms: 5 };
        } });
        assert.deepStrictEqual(seen, { url: 'https://kpg.example/h', timeout: 1234 });
    });

    it('fails the job when the gateway cannot be reached', async () => {
        const manager = managerOf({ app: { kpg_health_url: 'https://kpg.example/h' } });
        await assert.rejects(() => kpgHealth.run(manager,
            { probe: async () => { throw new Error('ECONNREFUSED'); } }),
        /KPG unreachable/);
    });
});

describe('JobManager', () => {
    it('waits for the kkconfig pool and goes on the moment it appears', async () => {
        const manager = new JobManager();
        let polls = 0;
        manager.deps = {
            connectRetries: 3, retryDelayMs: 1000, poolPollMs: 1,
            // initPools fills the map one alias at a time; kkconfig is not the first one.
            getPools: async () => {
                polls++;
                return { oracle: polls < 3 ? { '017': {} } : { '017': {}, kkconfig: {} } };
            },
        };

        const started = Date.now();
        await manager.waitForConfigPool();
        const waited = Date.now() - started;

        assert.strictEqual(polls, 3, 'it kept looking until kkconfig showed up');
        assert.ok(waited < 900, `returned on the poll, not on the retry delay (${waited}ms)`);
    });

    it('gives the pool the same budget the connect retries get, then moves on', async () => {
        const manager = new JobManager();
        manager.deps = {
            connectRetries: 3, retryDelayMs: 10, poolPollMs: 1,
            getPools: async () => ({ oracle: { '017': {} } }),   // kkconfig never arrives
        };
        const started = Date.now();
        await manager.waitForConfigPool();
        const waited = Date.now() - started;

        // 3 x 10ms, and then the load below reports the real failure rather than hanging here.
        assert.ok(waited >= 25 && waited < 400, `bounded by the retry budget (${waited}ms)`);
    });

    it('retries a failing config load before giving up', async () => {
        const manager = new JobManager();
        manager.deps = { retryDelayMs: 0 };
        let attempts = 0;
        const dao = require('../../validator/dao/oracle/ConfigDaoImpl');
        const original = dao.getAllConfig;
        dao.getAllConfig = async () => {
            attempts++;
            if (attempts < 3) throw new Error('ORA-12541: TNS:no listener');
            return [{ SYSTEM_ID: '017', CONFIG: { a: 1 } }];
        };
        try {
            const cfgs = await manager.loadConfig();
            assert.strictEqual(attempts, 3, 'kept trying while Oracle was still coming up');
            assert.ok(cfgs.app, 'an app section is always present');
        } finally {
            dao.getAllConfig = original;
        }
    });

    it('gives up with a clear message after the last attempt', async () => {
        const manager = new JobManager();
        manager.deps = { retryDelayMs: 0 };
        const dao = require('../../validator/dao/oracle/ConfigDaoImpl');
        const original = dao.getAllConfig;
        dao.getAllConfig = async () => { throw new Error('ORA-12541'); };
        try {
            await assert.rejects(() => manager.loadConfig(), /KKCONFIG unreachable after 4 attempts/);
        } finally {
            dao.getAllConfig = original;
        }
    });

    it('spots a changed section whatever order the keys are in', () => {
        const manager = new JobManager();
        assert.deepStrictEqual(
            manager.changedSystemIds({ app: { a: 1, b: 2 } }, { app: { b: 2, a: 1 } }), []);
        assert.deepStrictEqual(
            manager.changedSystemIds({ app: { a: 1 } }, { app: { a: 2 } }), ['app']);
        assert.deepStrictEqual(
            manager.changedSystemIds({ app: {} }, { app: {}, '017': {} }), ['017']);
    });
});
