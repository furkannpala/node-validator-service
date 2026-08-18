const path = require('path');
const version = require('../version');

const cfgs = {};

module.exports = {
    "appName": path.basename(path.resolve(__dirname, '..')),
    "version": version,
    // Java weblogic.xml context-root. Keeping it identical means devices need no URL change.
    "context": "Validator Services",
    "runTime": new Date(),
    loaded: false,

    // Schema that owns VALIDATOR_SERVICE_CONFIG, applied by util/SchemaUtil.qualifyTable.
    // Empty = unqualified (the pool user owns it); 'KKCONFIG' on test/prod. Read at call time.
    kk_config_scheme: '',

    // Lookup order: the system's own value -> the shared 'app' row -> defaultValue.
    // Mirrors Java EnvConfig: a system that defines the same key overrides 'app'.
    getSystemConfig: function (key, systemId, defaultValue) {
        const app = cfgs["app"] || {};
        const k = String(key).toLowerCase();
        const sys = cfgs[systemId];
        if (sys && sys[k] != undefined) return sys[k];
        if (app[k] != undefined) return app[k];
        return defaultValue;
    },

    setCfgs: function (newCfgs) {
        for (const key of Object.keys(cfgs)) delete cfgs[key];
        Object.assign(cfgs, newCfgs || {});
        module.exports.loaded = true;
        return cfgs;
    },

    cfgs: cfgs
};
