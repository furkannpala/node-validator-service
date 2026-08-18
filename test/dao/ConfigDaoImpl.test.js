const assert = require('assert');
const system_cfg = require('../../config/system_cfg');
const configDaoImpl = require('../../validator/dao/oracle/ConfigDaoImpl');

function fakeConn(rows) {
    return { lastSql: null, async execute(sql) { this.lastSql = sql; return { rows }; } };
}

describe('ConfigDaoImpl', () => {
    const original = system_cfg.kk_config_scheme;
    afterEach(() => { system_cfg.kk_config_scheme = original; });

    it('applies kk_config_scheme at call time', () => {
        system_cfg.kk_config_scheme = '';
        assert.strictEqual(configDaoImpl.table(), 'VALIDATOR_SERVICE_CONFIG');
        system_cfg.kk_config_scheme = 'KKCONFIG';
        assert.strictEqual(configDaoImpl.table(), 'KKCONFIG.VALIDATOR_SERVICE_CONFIG');
    });

    it('layers the system row over app', async () => {
        const conn = fakeConn([
            { SYSTEM_ID: '017', CONFIG: '{"currency_multiplier":1}' },
            { SYSTEM_ID: 'app', CONFIG: '{"currency_multiplier":100}' },
        ]);
        const out = await configDaoImpl.getConfigViaSystemId(conn, '017');
        assert.deepStrictEqual(out.CONFIG, { currency_multiplier: 1 });
        assert.deepStrictEqual(out.defaultCfg.CONFIG, { currency_multiplier: 100 });
    });

    it('falls back to app when the system has no row', async () => {
        const conn = fakeConn([{ SYSTEM_ID: 'app', CONFIG: '{"a":1}' }]);
        const out = await configDaoImpl.getConfigViaSystemId(conn, '999');
        assert.deepStrictEqual(out.CONFIG, { a: 1 });
    });

    it('skips a row with broken JSON instead of failing the request', async () => {
        const conn = fakeConn([
            { SYSTEM_ID: '017', CONFIG: '{not json' },
            { SYSTEM_ID: 'app', CONFIG: '{"a":1}' },
        ]);
        const out = await configDaoImpl.getConfigViaSystemId(conn, '017');
        assert.deepStrictEqual(out.CONFIG, { a: 1 });
    });

    it('treats an empty CLOB as an empty object', async () => {
        const conn = fakeConn([{ SYSTEM_ID: 'app', CONFIG: null }]);
        const out = await configDaoImpl.getConfigViaSystemId(conn, 'app');
        assert.deepStrictEqual(out.CONFIG, {});
    });

    // Matched on .message, not a regex: ServiceError.toString() serialises to JSON and
    // drops the message, so assert.rejects(/.../) would never see it.
    it('throws when the table has no matching row at all', async () => {
        await assert.rejects(() => configDaoImpl.getConfigViaSystemId(fakeConn([]), '017'),
            (e) => e.code === -99 && /empty config for system_id='017'/.test(e.message));
    });
});
