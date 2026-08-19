const StringUtil = require('../util/StringUtil');
const { gson } = require('../util/Gson');

const FIELDS = [
    'bus_id', 'date_time', 'latitude', 'nsindicator', 'longitude', 'ewindicator', 'altitude',
    'speed', 'utctime', 'hdop', 'svcount', 'status', 'route_distance', 'route_code', 'hpt',
    'route_offset', 'odometer', 'main_event', 'sub_event', 'driver_code', 'trip_no', 'path_code',
    'total_fuel_used', 'sam_id', 'travel_seq_no', 'start_date_time', 'bus_stop_id', 'stop_seq_no',
    'apc_1_in_cnt', 'apc_2_in_cnt', 'apc_3_in_cnt', 'apc_4_in_cnt', 'apc_5_in_cnt',
    'apc_1_out_cnt', 'apc_2_out_cnt', 'apc_3_out_cnt', 'apc_4_out_cnt', 'apc_5_out_cnt',
];

const DEFAULTS = {
    apc_1_in_cnt: '0', apc_2_in_cnt: '0', apc_3_in_cnt: '0', apc_4_in_cnt: '0', apc_5_in_cnt: '0',
    apc_1_out_cnt: '0', apc_2_out_cnt: '0', apc_3_out_cnt: '0', apc_4_out_cnt: '0', apc_5_out_cnt: '0',
};

// Java compared the first block with == (case sensitive) and the rest with compareToIgnoreCase.
// Four names differ from their column: ROUTECODE, DIRECTION, ROUTEOFFSET, TRIP_CODE.
const EXACT_ATTRS = {
    BUS_ID: 'bus_id', DATE_TIME: 'date_time', LATITUDE: 'latitude', NSINDICATOR: 'nsindicator',
    LONGITUDE: 'longitude', EWINDICATOR: 'ewindicator', ALTITUDE: 'altitude', SPEED: 'speed',
    UTCTIME: 'utctime', HDOP: 'hdop', SVCOUNT: 'svcount', STATUS: 'status',
    ROUTE_DISTANCE: 'route_distance', ROUTECODE: 'route_code', DIRECTION: 'hpt',
    ROUTEOFFSET: 'route_offset', ODOMETER: 'odometer',
};

const CI_ATTRS = {
    main_event: 'main_event', sub_event: 'sub_event', driver_code: 'driver_code',
    trip_code: 'trip_no', path_code: 'path_code', total_fuel_used: 'total_fuel_used',
    sam_id: 'sam_id', travel_seq_no: 'travel_seq_no', start_date_time: 'start_date_time',
    bus_stop_id: 'bus_stop_id', stop_seq_no: 'stop_seq_no',
    apc_1_in_cnt: 'apc_1_in_cnt', apc_2_in_cnt: 'apc_2_in_cnt', apc_3_in_cnt: 'apc_3_in_cnt',
    apc_4_in_cnt: 'apc_4_in_cnt', apc_5_in_cnt: 'apc_5_in_cnt',
    apc_1_out_cnt: 'apc_1_out_cnt', apc_2_out_cnt: 'apc_2_out_cnt', apc_3_out_cnt: 'apc_3_out_cnt',
    apc_4_out_cnt: 'apc_4_out_cnt', apc_5_out_cnt: 'apc_5_out_cnt',
};

class GpsTransaction {
    constructor() {
        this.reset();
    }

    /** Java cleared every variable at the top of each GPSDAT element, unlike ins_cfg. */
    reset() {
        for (const f of FIELDS) this[f] = Object.prototype.hasOwnProperty.call(DEFAULTS, f) ? DEFAULTS[f] : null;
    }

    applyAttrs(attrs) {
        this.reset();
        for (const [name, value] of Object.entries(attrs || {})) {
            const field = EXACT_ATTRS[name] || CI_ATTRS[name.toLowerCase()];
            if (field) this[field] = value;
        }
    }

    /**
     * The numeric getters below replace 35 try/catch blocks in ins_gps. Where Java parsed several
     * values inside one try, one bad value zeroed all of them — the grouping is kept for that.
     */
    getLatLng() {
        const lat = StringUtil.tryParseDouble(this.latitude, null);
        const lng = StringUtil.tryParseDouble(this.longitude, null);
        if (lat === null || lng === null) return { lat: 0, lng: 0 };
        return { lat: Math.fround(lat), lng: Math.fround(lng) };
    }

    getEvents() {
        const main = StringUtil.tryParseInt(this.main_event, null);
        const sub = StringUtil.tryParseInt(this.sub_event, null);
        if (main === null || sub === null) return { mainevent: 0, subevent: 0 };
        return { mainevent: main, subevent: sub };
    }

    getQuality() {
        const hdop = StringUtil.tryParseInt(this.hdop, null);
        const svcount = StringUtil.tryParseInt(this.svcount, null);
        const utctime = StringUtil.tryParseInt(this.utctime, null);
        if (hdop === null || svcount === null || utctime === null) return { hdop: 0, svcount: 0, utctime: 0 };
        return { hdop, svcount, utctime };
    }

    getSpeedInt() {
        const speed = StringUtil.tryParseInt(this.speed, 0);
        return speed > 1000 ? 999 : speed;   // capped in 2013, kept as is
    }

    getRouteDistanceInt() { return StringUtil.tryParseInt(this.route_distance, 0); }
    getRouteOffsetInt() { return StringUtil.tryParseInt(this.route_offset, 0); }
    getOdometerInt() { return StringUtil.tryParseInt(this.odometer, 0); }

    /**
     * The GPSDAT message, in the field order of Java's GpsTransaction. param_id and param_value
     * belong to the CANDAT half and are never set on this path, so they stay out.
     */
    toKafkaGpsPayload() {
        return gson({
            dataType: 'GPSDAT',
            bus_id: this.bus_id, date_time: this.date_time, latitude: this.latitude,
            nsindicator: this.nsindicator, longitude: this.longitude,
            ewindicator: this.ewindicator, altitude: this.altitude, speed: this.speed,
            utctime: this.utctime, hdop: this.hdop, svcount: this.svcount, status: this.status,
            route_distance: this.route_distance, route_code: this.route_code, hpt: this.hpt,
            route_offset: this.route_offset, odometer: this.odometer,
            main_event: this.main_event, sub_event: this.sub_event,
            driver_code: this.driver_code, trip_no: this.trip_no, path_code: this.path_code,
            total_fuel_used: this.total_fuel_used, sam_id: this.sam_id,
            travel_seq_no: this.travel_seq_no, start_date_time: this.start_date_time,
            bus_stop_id: this.bus_stop_id, stop_seq_no: this.stop_seq_no,
            apc_1_in_cnt: this.apc_1_in_cnt, apc_2_in_cnt: this.apc_2_in_cnt,
            apc_3_in_cnt: this.apc_3_in_cnt, apc_4_in_cnt: this.apc_4_in_cnt,
            apc_5_in_cnt: this.apc_5_in_cnt, apc_1_out_cnt: this.apc_1_out_cnt,
            apc_2_out_cnt: this.apc_2_out_cnt, apc_3_out_cnt: this.apc_3_out_cnt,
            apc_4_out_cnt: this.apc_4_out_cnt, apc_5_out_cnt: this.apc_5_out_cnt,
        });
    }

    /**
     * The CANDAT message. Java reused the one GpsTransaction it built for the whole body and
     * overwrote only these six fields, so whatever the last GPSDAT element left behind rides
     * along in the document. Calling this on the same instance keeps that.
     */
    toKafkaCanPayload(can) {
        const payload = this.toKafkaGpsPayload();
        payload.dataType = 'CANDAT';
        payload.bus_id = can.bus_id;
        payload.date_time = can.date_time;
        payload.latitude = can.lat;
        payload.longitude = can.lng;
        payload.param_id = can.param_id;
        payload.param_value = can.param_value;
        return gson(payload);
    }

    /** TMS_APC and friends store 19700101000000 rather than an empty or zero start time. */
    getRStartDateTime() {
        const s = this.start_date_time;
        if (s === null || s === undefined || String(s).trim() === '' || String(s).trim() === '00000000000000') {
            return '19700101000000';
        }
        return s;
    }
}

module.exports = GpsTransaction;
