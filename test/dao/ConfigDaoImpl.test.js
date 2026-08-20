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

    it('reads the config table through kkconfig', () => {
        assert.strictEqual(configDaoImpl.pickConfigAlias({ '017': {}, kkconfig: {} }), 'kkconfig');
    });

    /**
     * The window this closes: initPools creates '017' first and 'kkconfig' second, so a caller
     * that arrives in between used to be handed '017' and configured the whole service from
     * whatever that pool's user could see, with no error anywhere.
     */
    it('refuses another pool rather than guessing while kkconfig is still coming up', () => {
        assert.throws(() => configDaoImpl.pickConfigAlias({ '017': {} }),
            /no 'kkconfig' oracle pool.*pools up: 017/);
    });

    it('says so plainly when no pool is up at all', () => {
        assert.throws(() => configDaoImpl.pickConfigAlias({}), /no 'kkconfig' oracle pool/);
    });

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

    it('hands every request of a system the same view instead of rebuilding it', () => {
        system_cfg.setCfgs({ app: {}, '017': { a: 1 } });
        assert.strictEqual(dispatcher.derivedFor('017'), dispatcher.derivedFor('017'));
    });

    it('drops the view when the config is reloaded', () => {
        system_cfg.setCfgs({ app: {}, '017': { a: 1 } });
        assert.strictEqual(dispatcher.derivedFor('017').cfg.a, 1);

        // What configWatch and ?func=reloadconfig do; a stale view here would pin the service
        // to the configuration it booted with.
        system_cfg.setCfgs({ app: {}, '017': { a: 2 } });
        assert.strictEqual(dispatcher.derivedFor('017').cfg.a, 2);
    });

    it('reads save_request_log_functions once per system, kafka-only funcs removed', () => {
        system_cfg.setCfgs({
            app: {},
            '017': { save_request_log_functions: ' senddata , sendgps ',
                sendgps_use_only_kafka_produce: 'true' },
        });
        const { requestLogFuncs } = dispatcher.derivedFor('017');

        assert.strictEqual(requestLogFuncs.has('senddata'), true);
        // With no database write there is nothing for a request log row to correlate with.
        assert.strictEqual(requestLogFuncs.has('sendgps'), false);
        assert.strictEqual(requestLogFuncs.has('getroute'), false);
    });
});
