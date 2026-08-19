const { gson } = require('../util/Gson');

// Attribute names differ from column names here, so each element type carries its own map.
const LOG_ATTRS = { hostname: 'host_name', source: 'source' };
const DATA_ATTRS = { timestamp: 'time_stamp', type: 'alert_level', scope: 'scope', desc: 'desc' };

class LogTransaction {
    constructor(busId) {
        this.bus_id = busId ?? null;
        this.host_name = null;
        this.source = null;
        this.alert_level = null;
        this.time_stamp = null;
        this.scope = null;
        this.desc = null;
        this.device_type = 0;
    }

    /** LOG carries the device identity, DATA the entry; Java kept both in the same variables. */
    applyAttrs(tagName, attrs) {
        const map = tagName === 'LOG' ? LOG_ATTRS : tagName === 'DATA' ? DATA_ATTRS : null;
        if (!map) return;
        for (const [name, field] of Object.entries(map)) {
            if (attrs[name] !== undefined) this[field] = attrs[name];
        }
    }

    /** The sendlog message, in the field order of Java's LogTransaction. */
    toKafkaPayload() {
        return gson({
            bus_id: this.bus_id, host_name: this.host_name, source: this.source,
            time_stamp: this.time_stamp, alert_level: this.alert_level, scope: this.scope,
            desc: this.desc,
            // A Java int, so it is always in the document even though it is always zero.
            device_type: this.device_type,
        });
    }
}

module.exports = LogTransaction;
