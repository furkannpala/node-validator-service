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
}

module.exports = LogTransaction;
