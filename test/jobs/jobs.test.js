/* eslint-env mocha */
const assert = require('assert');

const { JOBS } = require('../../jobs');
const { JobManager, mapWithConcurrency, GROUP_STAGGER_MS } = require('../../jobs/JobManager');
const FileCacheManager = require('../../util/FileCacheManager');
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
    manager.jobs = JOBS;
    manager.deps = {
        assignFixRateScheduler: (fn, rateMs, delayMs) => {
            const handle = { fn, rateMs, delayMs, stop() { handle.stopped = true; } };
            scheduled.push(handle);
            return handle;
        },
        // A job always closes what it opened, so the fake has to accept it.
        getConnection: async () => Object.assign(fakeConn(), { close: async () => {} }),
        ...extraDeps,
    };
    manager.scheduled = scheduled;
    return manager;
}

const APP_ONLY = () => ({ app: {} });
const job = (name) => JOBS.find((j) => j.name === name);

/**
 * Both shipped jobs are service-wide, but scope/requires/mode are the runner's contract and
 * the next job to arrive will use them, so those paths are exercised with jobs made here.
 */
function systemJob(name, func, extra = {}) {
    return { name, scope: 'system', flag: `run_${name}`, intervalMs: 1000, func, ...extra };
}

/** The job bodies call the util singletons directly; this puts the real ones back. */
function stub(target, key, fn) {
    const original = target[key];
    target[key] = fn;
    restores.push(() => { target[key] = original; });
}
let restores = [];
afterEach(() => {
    for (const restore of restores.reverse()) restore();
    restores = [];
});

describe('job scheduling', () => {
    it('gives every job a group and puts jobs of one period together', async () => {
        const manager = managerOf(APP_ONLY());
        manager.groups = await manager.start(JOBS);

        assert.deepStrictEqual(manager.groups.map((g) => g.jobs.join('|')),
            ['config_watch', 'cache_cleanup'], 'the two periods differ, so two schedulers');
        assert.strictEqual(manager.groups.length, manager.scheduled.length);
        assert.deepStrictEqual(
            JOBS.map((j) => Boolean(manager.groupOf(j.name))), JOBS.map(() => true));
    });

    it('puts jobs that share a period in one group, in JOBS order', async () => {
        const manager = managerOf({ app: { cache_cleanup_interval_ms: 5 * 60 * 1000 } });
        const groups = await manager.start(JOBS);

        assert.deepStrictEqual(groups.map((g) => g.jobs.join('|')), ['config_watch|cache_cleanup']);
        assert.strictEqual(manager.scheduled.length, 1, 'one scheduler, so no overlap either');
    });

    it('staggers the first run of each group so they do not collide on startup', async () => {
        const manager = managerOf(APP_ONLY());
        await manager.start(JOBS);

        const offsets = manager.scheduled.map((h) => h.delayMs - h.rateMs);
        assert.deepStrictEqual(offsets, [0, GROUP_STAGGER_MS]);
    });

    it('takes the period from the app row and falls back on an unusable value', async () => {
        for (const bad of [0, -1, 'abc', null]) {
            const manager = managerOf({ app: { config_refresh_ms: bad } });
            assert.strictEqual(manager.intervalOf(job('config_watch')),
                job('config_watch').intervalMs, `value ${bad}`);
        }
        const manager = managerOf({
            app: { config_refresh_ms: 60000 }, '017': { config_refresh_ms: 1000 },
        });
        assert.strictEqual(manager.intervalOf(job('config_watch')), 60000,
            'a system row does not move a service-wide period');
    });

    it('stops every group it armed', async () => {
        const manager = managerOf(APP_ONLY());
        manager.groups = await manager.start(JOBS);
        manager.stop();
        assert.ok(manager.scheduled.every((h) => h.stopped));
        assert.deepStrictEqual(manager.groups, []);
        assert.strictEqual(manager.started, false);
    });
});

describe('job flags', () => {
    it('keeps both housekeeping jobs on with no config at all', () => {
        const manager = managerOf(APP_ONLY());
        const ctx = manager.contextFor('app', 'test');
        assert.strictEqual(manager.isEnabled(job('config_watch'), ctx), true);
        assert.strictEqual(manager.isEnabled(job('cache_cleanup'), ctx), true);
    });

    it('turns a default-on job off when the key says so', () => {
        const manager = managerOf({ app: { run_cache_cleanup: false } });
        assert.strictEqual(
            manager.isEnabled(job('cache_cleanup'), manager.contextFor('app', 'test')), false);
    });

    it('leaves a job with no defaultOn off until it is asked for', () => {
        const manager = managerOf({ app: {}, '017': {} });
        const later = systemJob('later', async () => {});
        assert.strictEqual(manager.isEnabled(later, manager.contextFor('017', 'test')), false);
    });

    it('reads a flag per cycle, so one system can have it on and another off', () => {
        const manager = managerOf({ app: {}, '017': { run_later: true }, '026': {} });
        const later = systemJob('later', async () => {});
        assert.strictEqual(manager.isEnabled(later, manager.contextFor('017', 'test')), true);
        assert.strictEqual(manager.isEnabled(later, manager.contextFor('026', 'test')), false);
    });

    it("takes the string 'true' a JSON CLOB may carry", () => {
        const manager = managerOf({ app: { run_later: 'true' }, '017': {} });
        assert.strictEqual(
            manager.isEnabled(systemJob('later', async () => {}), manager.contextFor('017', 'test')),
            true);
    });
});

describe('a cycle', () => {
    it('runs a service job once however many systems are configured', async () => {
        const manager = managerOf({ app: {}, '017': {}, '026': {} });
        const seen = [];
        stub(FileCacheManager, 'removeExpired', async () => { seen.push('cache'); return 0; });

        await manager.run([job('cache_cleanup')], 'test');
        assert.deepStrictEqual(seen, ['cache']);
    });

    it('runs a system job once per system, and not for the app row', async () => {
        const manager = managerOf({ app: { run_later: true }, '017': {}, '026': {} });
        const seen = [];
        await manager.run([systemJob('later', async (ctx) => seen.push(ctx.systemId))], 'test');
        assert.deepStrictEqual(seen, ['017', '026']);
    });

    it('runs the service pass before the system pass so config_watch goes first', async () => {
        const manager = managerOf({ app: { run_later: true }, '017': {} });
        const order = [];
        manager.reloadConfig = async () => { order.push('config'); return []; };

        await manager.run(
            [systemJob('later', async () => order.push('later')), job('config_watch')], 'test');
        assert.deepStrictEqual(order, ['config', 'later'],
            'JOBS order does not put a system job ahead of the config refresh');
    });

    it('skips a job whose flag is off without touching anything', async () => {
        const manager = managerOf({ app: {}, '017': {} });
        let called = false;
        await manager.run([systemJob('later', async () => { called = true; })], 'test');
        assert.strictEqual(called, false);
    });

    it('refuses to run a job whose required config is missing, and says so', async () => {
        const manager = managerOf({ app: {}, '017': { run_later: true } });
        let called = false;
        const later = systemJob('later', async () => { called = true; }, { requires: ['later_days'] });

        await assert.rejects(() => manager.run([later], 'test'), /missing config \[later_days\]/);
        assert.strictEqual(called, false, 'a half-configured job does not get to run');
    });

    it('keeps going when one system fails and reports every failure together', async () => {
        const manager = managerOf({ app: { run_later: true }, '017': {}, '026': {}, '030': {} });
        const asked = [];
        const later = systemJob('later', async (ctx) => {
            asked.push(ctx.systemId);
            if (ctx.systemId === '017') throw new Error('ORA-00942');
        });

        await assert.rejects(() => manager.run([later], 'test'), /later error, 017: ORA-00942/);
        assert.deepStrictEqual(asked, ['017', '026', '030'], 'the other two were still served');
    });

    it('lets an async job run alongside the sync ones and still collects its failure', async () => {
        const manager = managerOf({ app: { run_slow: true, run_quick: true }, '017': {} });
        const order = [];
        const slow = systemJob('slow', async () => {
            order.push('slow start');
            await new Promise((resolve) => setTimeout(resolve, 20));
            order.push('slow end');
            throw new Error('boom');
        }, { mode: 'async' });
        const quick = systemJob('quick', async () => { order.push('quick'); });

        await assert.rejects(() => manager.run([slow, quick], 'test'), /slow error, 017: boom/);
        assert.deepStrictEqual(order, ['slow start', 'quick', 'slow end'],
            'the sync job did not wait for the async one');
    });

    it('opens one connection per system and closes it whatever happens', async () => {
        const manager = managerOf({ app: { run_later: true }, '017': {}, '026': {} });
        const opened = [];
        const closed = [];
        manager.deps.getConnection = async (alias) => {
            opened.push(alias);
            return Object.assign(fakeConn(), { close: async () => { closed.push(alias); } });
        };
        const later = systemJob('later', (ctx) => ctx.withConnection(async () => {
            throw new Error('ORA-00942');
        }));

        await assert.rejects(() => manager.run([later], 'test'));
        assert.deepStrictEqual(opened, ['017', '026']);
        assert.deepStrictEqual(closed, ['017', '026'], 'the failing round still gave it back');
    });

    it('applies datasource_prefix to the pool alias, as a request does', async () => {
        const manager = managerOf({ app: { run_later: true, datasource_prefix: 'val_' }, '017': {} });
        const opened = [];
        manager.deps.getConnection = async (alias) => {
            opened.push(alias);
            return Object.assign(fakeConn(), { close: async () => {} });
        };

        await manager.run([systemJob('later', (ctx) => ctx.withConnection(async () => {}))], 'test');
        assert.deepStrictEqual(opened, ['val_017']);
    });
});

describe('cache_cleanup', () => {
    it('passes the configured age to the cache and reports what went', async () => {
        const manager = managerOf({ app: { cache_max_age_ms: 1000 } });
        let asked = null;
        stub(FileCacheManager, 'removeExpired', async (ms) => { asked = ms; return 3; });

        const removed = await job('cache_cleanup').func(manager.contextFor('app', 'test'));
        assert.strictEqual(asked, 1000);
        assert.strictEqual(removed, 3);
    });

    it('defaults to a day when nothing is configured', async () => {
        const manager = managerOf(APP_ONLY());
        let asked = null;
        stub(FileCacheManager, 'removeExpired', async (ms) => { asked = ms; return 0; });

        await job('cache_cleanup').func(manager.contextFor('app', 'test'));
        assert.strictEqual(asked, 24 * 60 * 60 * 1000);
    });
});

describe('mapWithConcurrency', () => {
    it('keeps at most `limit` in flight', async () => {
        let inFlight = 0;
        let peak = 0;
        await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 5));
            inFlight--;
        });
        assert.strictEqual(peak, 2);
    });

    it('runs serially rather than skipping the batch on an unusable limit', async () => {
        for (const bad of [undefined, 0, 'abc']) {
            const done = [];
            await mapWithConcurrency([1, 2, 3], bad, async (n) => { done.push(n); });
            assert.deepStrictEqual(done, [1, 2, 3], `limit ${bad}`);
        }
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
        stub(dao, 'getAllConfig', async () => {
            attempts++;
            if (attempts < 3) throw new Error('ORA-12541: TNS:no listener');
            return [{ SYSTEM_ID: '017', CONFIG: { a: 1 } }];
        });

        const cfgs = await manager.loadConfig();
        assert.strictEqual(attempts, 3, 'kept trying while Oracle was still coming up');
        assert.ok(cfgs.app, 'an app section is always present');
    });

    it('gives up with a clear message after the last attempt', async () => {
        const manager = new JobManager();
        manager.deps = { retryDelayMs: 0 };
        const dao = require('../../validator/dao/oracle/ConfigDaoImpl');
        stub(dao, 'getAllConfig', async () => { throw new Error('ORA-12541'); });

        await assert.rejects(() => manager.loadConfig(), /KKCONFIG unreachable after 4 attempts/);
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

    it('rebinds only when a section actually changed', async () => {
        const manager = managerOf({ app: { a: 1 } });
        stub(require('../../validator/dao/oracle/ConfigDaoImpl'), 'getAllConfig',
            async () => [{ SYSTEM_ID: 'app', CONFIG: { a: 1 } }]);
        let rebinds = 0;
        manager.rebind = async () => { rebinds++; };

        assert.deepStrictEqual(await manager.reloadConfig(), []);
        assert.strictEqual(rebinds, 0, 'an unchanged config leaves the schedulers alone');
    });
});
