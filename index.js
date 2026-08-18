const validator = require("./validator/");
const management = require("./management/");
const JobManager = require("./jobs/JobManager");
const appConfig = require("./config/system_cfg");

// Jobs start after the webapp is mounted, so a slow KKCONFIG cannot hold up the routes. Set
// VS_AUTOSTART=0 to load the endpoints without any background work, which is what tests do.
if (process.env.VS_AUTOSTART !== "0") {
    setImmediate(() => {
        JobManager.init(appConfig).catch((e) => {
            try {
                require("../../lib/utils").ULog.error(`job autostart failed: ${e?.stack}`);
            } catch (_) {
                console.error(`job autostart failed: ${e?.stack}`);
            }
        });
    });
}

module.exports = [validator, management];
