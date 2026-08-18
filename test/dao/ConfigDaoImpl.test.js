/* eslint-env mocha */
const assert = require('assert');
const system_cfg = require('../../config/system_cfg');
const configDaoImpl = require('../../validator/dao/oracle/ConfigDaoImpl');
const dispatcher = require('../../validator/index');

/**
 * The layering used to live in a per-request query; it now happens in memory in the
 * dispatcher, so the cases that query was tested for are asserted against configFor.
 */
describe('ConfigDaoImpl', () => {
    const original = system_cfg.kk_config_scheme;
    afterEach(() => { system_cfg.kk_config_scheme = original; });

    it('applies kk_config_scheme at call time', () => {
        system_cfg.kk_config_scheme = '';
        assert.strictEqual(configDaoImpl.table(), 'VALIDATOR_SERVICE_CONFIG');
        system_cfg.kk_config_scheme = 'KKCONFIG';
        assert.strictEqual(configDaoImpl.table(), 'KKCONFIG.VALIDATOR_SERVICE_CONFIG');
    });
});

describe('request config', () => {
    const original = { ...system_cfg.cfgs };
    afterEach(() => system_cfg.setCfgs(original));

    it('layers the system row over app', () => {
        system_cfg.setCfgs({ app: { currency_multiplier: 100 }, '017': { currency_multiplier: 1 } });
        const cfg = dispatcher.configFor('017');
        assert.strictEqual(cfg.currency_multiplier, 1);
        assert.strictEqual(cfg.defaultCfg.currency_multiplier, 100);
    });

    it('falls back to app when the system has no row', () => {
        system_cfg.setCfgs({ app: { a: 1 } });
        assert.strictEqual(dispatcher.configFor('999').a, 1);
    });

    it('answers with the defaults when nothing is loaded at all', () => {
        system_cfg.setCfgs({});
        const cfg = dispatcher.configFor('017');
        assert.deepStrictEqual(cfg.defaultCfg, {});
    });

    it('does not let a request mutate the shared copy', () => {
        system_cfg.setCfgs({ app: {}, '017': { a: 1 } });
        dispatcher.configFor('017').a = 2;
        assert.strictEqual(system_cfg.cfgs['017'].a, 1);
    });
});
