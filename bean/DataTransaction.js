const StringUtil = require('../util/StringUtil');

/**
 * The DATA element of a senddata body. Java read it with three different comparison styles in
 * one else-if chain and the split is kept exactly: the older fields are matched case
 * sensitively (Java used ==, which only ever worked because Xerces interns attribute names),
 * the ones added later case insensitively. Making the old ones case insensitive here would
 * start accepting payloads the Java service ignored.
 *
 * Both maps were extracted from ValidatorDataLoadFuncs.ins_data rather than typed out, because
 * a single wrong pair writes good values into the wrong column without any error.
 */

// attrname == "x"  — case sensitive.
const DATA_EXACT = {
    record_id: 'record_id', travel_seq_no: 'travel_seq_no', trans_seq_no: 'trans_seq_no',
    sam_id: 'sam_id', validator_id: 'validator_id', bus_id: 'bus_id', depot_code: 'depot_code',
    route_code: 'route_code', driver_code: 'driver_code', date_time: 'boarding_date_time',
    ht_start_time: 'start_date_time', half_progress_type: 'half_progress_type',
    return_flag: 'return_flag', emergency_flag: 'emergency_flag', alias_no: 'alias_no',
    card_no: 'card_no', trans_flag: 'trans_flag', data_save_flag: 'data_save_flag',
    station_type: 'station_type', customer_flag: 'customer_flag', bus_stop_code: 'bus_stop_id',
    transmit_cnt: 'transmit_cnt', usage_cnt: 'usage_cnt', passenger_type: 'passenger_type',
    usage_amt: 'usage_amt', remained_amt: 'remained_amt', customer_cnt: 'customer_cnt',
    trafic_type: 'traffic_type', schedule_type: 'schedule_type', old_route_code: 'old_route_code',
    dc_rate: 'dc_rate', tc_code: 'tc_code', approval_no: 'approval_no', rtc_code: 'rtc_code',
    old_amount: 'old_amt', old_date_time: 'old_date_time', old_sam_id: 'old_sam_id',
    // latitude and LATITUDE feed the same field, so whichever comes last in the element wins.
    latitude: 'latitude', longitude: 'longitude', LATITUDE: 'latitude', LONGITUDE: 'longitude',
    sam_seqno: 'sam_seq_no', service_charge: 'service_charge_str',
};

// attrname.equalsIgnoreCase("x") / compareToIgnoreCase("x") == 0 — case insensitive.
const DATA_CI = {
    qtick_used: 'qtick_used', trip_no: 'trip_no', trans_sam_id: 'origin_sam_id',
    trip_stop_cnt: 'trip_stop_cnt', odometer: 'odometer', schedule_type: 'schedule_type',
    trip_type: 'trip_type', stage: 'stage', path_code: 'path_code',
    manual_trip_start_time: 'manual_trip_start_time', stop_seq_no: 'stop_seq_no',
    total_fuel_used: 'total_fuel_used', rider: 'rider', tariff_number: 'tariff_number',
    extended_fare: 'extended_fare', qr_data: 'qr_data', tap_id: 'tap_id', only_tap: 'only_tap',
    cico_mode: 'cico_mode', ci_tid: 'ci_tid', ci_bdt: 'ci_bdt', uid: 'uid',
    fare_file_version: 'fare_file_version', travel_type: 'travel_type', vehicle_type: 'vehicle_type',
    product_code: 'product_code', stop_name: 'stop_name', csn: 'csn',
};

/**
 * ins_station reads a DIFFERENT attribute set from ins_data. Four of the differences change
 * what gets stored, so the station path cannot reuse the maps above:
 *   traffic_type   is spelled correctly here, while ins_data only accepts the typo trafic_type
 *   origin_sam_id  arrives under its own name, not as trans_sam_id
 *   bus_stop_id    is accepted as well as bus_stop_code
 *   half_progress_type lands in hpt, and is matched case insensitively rather than exactly
 * Stations also never send a position, a path code or fuel figures.
 */
const STATION_EXACT = {
    record_id: 'record_id', travel_seq_no: 'travel_seq_no', trans_seq_no: 'trans_seq_no',
    sam_id: 'sam_id', trip_no: 'trip_no', validator_id: 'validator_id', bus_id: 'bus_id',
    depot_code: 'depot_code', route_code: 'route_code', driver_code: 'driver_code',
    date_time: 'boarding_date_time', ht_start_time: 'start_date_time', alias_no: 'alias_no',
    card_no: 'card_no', trans_flag: 'trans_flag', data_save_flag: 'data_save_flag',
    station_type: 'station_type', customer_flag: 'customer_flag', bus_stop_id: 'bus_stop_id',
    transmit_cnt: 'transmit_cnt', usage_cnt: 'usage_cnt', passenger_type: 'passenger_type',
    usage_amt: 'usage_amt', remained_amt: 'remained_amt', customer_cnt: 'customer_cnt',
    traffic_type: 'traffic_type', old_route_code: 'old_route_code', dc_rate: 'dc_rate',
    tc_code: 'tc_code', approval_no: 'approval_no', rtc_code: 'rtc_code', old_amount: 'old_amt',
    old_date_time: 'old_date_time', old_sam_id: 'old_sam_id', sam_seqno: 'sam_seq_no',
    service_charge: 'service_charge_str',
};

const STATION_CI = {
    fare_file_version: 'fare_file_version', travel_type: 'travel_type',
    vehicle_type: 'vehicle_type', qtick_used: 'qtick_used', origin_sam_id: 'origin_sam_id',
    half_progress_type: 'hpt', odometer: 'odometer', return_flag: 'return_flag',
    emergency_flag: 'emergency_flag', bus_stop_code: 'bus_stop_id', rider: 'rider',
    tariff_number: 'tariff_number', extended_fare: 'extended_fare', qr_data: 'qr_data',
    tap_id: 'tap_id', only_tap: 'only_tap', cico_mode: 'cico_mode', ci_tid: 'ci_tid',
    ci_bdt: 'ci_bdt', uid: 'uid', stop_seq_no: 'stop_seq_no', product_code: 'product_code',
    stop_name: 'stop_name', csn: 'csn',
};

// The EMV child element, all case insensitive. boarding_date_time and sam_id are absent on
// purpose: those two branches are commented out in Java, so EMV cannot override the DATA ones.
const EMV_CI = {
    term_no: 'term_no', ptcn: 'ptcn', enc_pan: 'enc_pan', masked_pan: 'masked_pan', bin: 'bin',
    late_auth: 'late_auth', expired_date: 'expired_date', amount: 'emv_amount',
    pan_sequence: 'pan_sequence', key_type: 'key_type', key_index: 'key_index', emv: 'emv',
    on_us: 'on_us', currency_code: 'currency_code', trans_result: 'trans_result',
    fare_file_version: 'fare_file_version', travel_type: 'travel_type',
};

// Java's local declarations; everything not listed starts as null.
const DEFAULTS = {
    station_type: '1', usage_amt: '0', remained_amt: '0', old_amt: '0', sam_seq_no: '1',
    qtick_used: '000000', trip_no: '0', origin_sam_id: '0', total_stop_cnt: '0',
    trip_stop_cnt: '0', odometer: '0', stage: '1', rider: '', tariff_number: '',
    extended_fare: '0', stop_seq_no: 0, service_charge: 0,
};

const EMV_DEFAULTS = {
    ptcn: '', term_no: '', enc_pan: '', masked_pan: '', bin: '', late_auth: '', expired_date: '',
    emv_amount: '', pan_sequence: '', key_type: '', key_index: '', emv: '', on_us: '',
    currency_code: '', trans_result: '', ci_tid: '', ci_bdt: '', stop_name: '',
};

const FIELDS = [...new Set([
    ...Object.values(DATA_EXACT), ...Object.values(DATA_CI), ...Object.values(EMV_CI),
    ...Object.values(STATION_EXACT), ...Object.values(STATION_CI),
    ...Object.keys(DEFAULTS), ...Object.keys(EMV_DEFAULTS),
])];

class DataTransaction {
    constructor() {
        for (const f of FIELDS) this[f] = null;
        Object.assign(this, DEFAULTS, EMV_DEFAULTS);

        // Filled by the strategies, not by the payload.
        this.compCode = -1;
        this.usageAmt = 0;
        this.remainedAmt = 0;
        this.oldAmt = 0;
        this.customerCnt = 0;
        this.extendedFare = 0;
        this.serviceChargeAmt = 0;
        this.lat = 0;
        this.lng = 0;
        this.tfType = null;
        this.travelType = null;
        this.odometerStart = 0;
        this.originSystemId = null;
        this.transfer_ref_code = null;
        this.pathCode = null;
    }

    /**
     * One element's attributes, in document order. The exact map is consulted first so the
     * else-if order of the Java chain is preserved where a name appears in both.
     */
    applyAttrs(attrs) {
        this.applyWith(attrs, DATA_EXACT, DATA_CI);
    }

    /** The exact map is consulted first, which is the order of the Java else-if chain. */
    applyWith(attrs, exactMap, ciMap) {
        for (const [name, value] of Object.entries(attrs || {})) {
            const field = exactMap[name] || ciMap[name.toLowerCase()];
            if (!field) continue;
            if (field === 'stop_seq_no') {
                // Java parsed this one on the spot and let a bad value throw.
                this.stop_seq_no = StringUtil.parseIntStrict(value);
            } else if (field === 'service_charge_str') {
                this.setServiceCharge(value);
            } else {
                this[field] = value;
            }
        }
    }

    /** The station variant of applyAttrs; see STATION_EXACT for how the two differ. */
    applyStationAttrs(attrs) {
        this.applyWith(attrs, STATION_EXACT, STATION_CI);
    }

    applyEmvAttrs(attrs) {
        for (const [name, value] of Object.entries(attrs || {})) {
            const field = EMV_CI[name.toLowerCase()];
            if (field) this[field] = value;
        }
    }

    /** The string goes to the row, the parsed copy to the amount; Java swallowed a bad parse. */
    setServiceCharge(value) {
        this.service_charge_str = value;
        if (StringUtil.isNullOrEmpty(value)) return;
        this.service_charge = StringUtil.tryParseInt(value, this.service_charge);
    }


    /** F records are trips, D records are ticket data; anything else is logged and dropped. */
    getRecordType() {
        const id = this.record_id;
        return id == null || id === '' ? null : id.charAt(0);
    }
}

DataTransaction.DATA_EXACT = DATA_EXACT;
DataTransaction.DATA_CI = DATA_CI;
DataTransaction.EMV_CI = EMV_CI;
DataTransaction.STATION_EXACT = STATION_EXACT;
DataTransaction.STATION_CI = STATION_CI;
module.exports = DataTransaction;
