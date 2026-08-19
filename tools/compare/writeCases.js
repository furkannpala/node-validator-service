/**
 * Write-path cases. Each one posts the same body to both services and compares the rows that
 * landed, which is what section 3 and 4 of the roadmap ask for as the exit criterion.
 *
 * `key` is the predicate that identifies this case's rows in every table it touches, so the
 * harness can clear them between the two runs — otherwise the second service would meet its
 * own unique violations and write nothing.
 */

const BUS = '00001';
const SAM = '05100077';

// Columns neither service controls: sequence values and insert-time clocks.
const VOLATILE = ['PDATE', 'RDATE', 'CREATE_DATE', 'CREATE_DATE_TIME', 'UPDATED_AT', 'INSERT_DATE'];

const dataAttrs = (over = {}) => Object.entries({
    record_id: 'D0001', trans_seq_no: '1', trans_flag: '1', customer_flag: '0',
    data_save_flag: '0', station_type: '1', transmit_cnt: '1', bus_stop_code: '45',
    alias_no: 'A1', card_no: '01712340000001', date_time: '20260819100000', usage_cnt: '3',
    passenger_type: '1', usage_amt: '250', remained_amt: '1000', stage: '1', customer_cnt: '1',
    dc_rate: '0', old_route_code: '0', approval_no: '0', tc_code: '0', rtc_code: '0',
    travel_seq_no: '7001', ht_start_time: '20260819080000', sam_id: SAM, old_amount: '1250',
    old_date_time: '0', old_sam_id: '0', sam_seqno: '9', qtick_used: '000000',
    trans_sam_id: '0', bus_id: BUS, validator_id: 'V1', depot_code: 'DEP0001',
    route_code: '00100', driver_code: 'D1', half_progress_type: '1', return_flag: '0',
    emergency_flag: '0', trip_no: '1', odometer: '100', fare_file_version: '1',
    travel_type: '1', product_code: 'P1',
    // Java parses these into a float; without them the comparison never sees the column.
    latitude: '38.4', longitude: '27.1', ...over,
}).map(([k, v]) => `${k}="${v}"`).join(' ');

const CASES = [
    {
        name: 'senddata — bir bilet (D)',
        query: { func: 'senddata', busid: BUS, stationtype: '1', arch: 'x' },
        body: `<TD><DATA ${dataAttrs()}/></TD>`,
        tables: ['afc_td', 'afc_tf', 'afc_bl_td', 'afc_td_test', 'afc_td_nonverified'],
        key: `sam_id='${SAM}'`,
    },
    {
        name: 'senddata — üç bilet, ikincisi bozuk tarihli',
        query: { func: 'senddata', busid: BUS, stationtype: '1', arch: 'x' },
        body: '<TD>'
            + `<DATA ${dataAttrs({ trans_seq_no: '1' })}/>`
            + `<DATA ${dataAttrs({ trans_seq_no: '2', date_time: 'BOZUK' })}/>`
            + `<DATA ${dataAttrs({ trans_seq_no: '3' })}/>`
            + '</TD>',
        tables: ['afc_td', 'afc_tf', 'tbl_validator_error_td'],
        key: `sam_id='${SAM}'`,
        errorTdKey: `bus_id='${BUS}'`,
        // Java stops processing the body at the bad record; this service carries on. The
        // difference is recorded in the notes as [48] and is expected here.
        expectDifference: 'notlar [48]: veri formatı hatasından sonra Node kalan kayıtları yazar',
    },
    {
        name: 'senddata — sefer kaydı (F)',
        query: { func: 'senddata', busid: BUS, stationtype: '1', arch: 'x' },
        body: `<TD><DATA ${dataAttrs({ record_id: 'F0001', travel_type: '1', old_amount: '00000011' })}/></TD>`,
        tables: ['afc_tf', 'afc_tf_event', 'afc_th', 'tms_val_route'],
        key: `sam_id='${SAM}'`,
    },
    {
        name: 'sendgps — bir konum',
        query: { func: 'sendgps', busid: BUS, stationtype: '1', arch: 'x' },
        body: `<ROOT><GPSDAT BUS_ID="${BUS}" DATE_TIME="20260819100000" LATITUDE="38.4"`
            + ` LONGITUDE="27.1" NSINDICATOR="N" EWINDICATOR="E" ALTITUDE="10" SPEED="42"`
            + ` UTCTIME="100000" HDOP="1" SVCOUNT="8" STATUS="A" ROUTE_DISTANCE="100"`
            + ` ROUTECODE="00100" DIRECTION="1" ROUTEOFFSET="5" ODOMETER="100"`
            + ` sam_id="${SAM}" driver_code="D1" trip_code="1" main_event="1"`
            + ' sub_event="0"/></ROOT>',
        tables: ['tms_gps'],
        key: `bus_id='${BUS}'`,
    },
    {
        name: 'sendgps — MAIN_EVENT yok',
        query: { func: 'sendgps', busid: BUS, stationtype: '1', arch: 'x' },
        body: `<ROOT><GPSDAT BUS_ID="${BUS}" DATE_TIME="20260819100200" LATITUDE="38.4"`
            + ` LONGITUDE="27.1" SPEED="42" ROUTECODE="00100" DIRECTION="1"`
            + ` sam_id="${SAM}" driver_code="D1" trip_code="1"/></ROOT>`,
        tables: ['tms_gps'],
        key: `bus_id='${BUS}'`,
        // Java calls main_event.equals("7") and throws a NullPointerException when the
        // attribute is absent, losing the whole request. See README, divergence 3.
        expectDifference: 'notlar [15]: MAIN_EVENT yokken Java NPE atıp isteği düşürüyor, Node kaydı yazıyor',
    },
    {
        name: 'sendcfg — bir cihaz konfigürasyonu',
        query: { func: 'sendcfg', busid: BUS, stationtype: '1', arch: 'x' },
        body: `<ROOT><VALAPPCONF bus_id="${BUS}" sam_id="${SAM}" pcb_id="ab12cd"`
            + ' terminal_no="1" depot_code="DEP0001" station_type="1" driver_code="D1"'
            + ' route_code="00100" temperature="30.5" input_voltage="12.10"'
            + ' battery_voltage="3.70" software_version="1.0"/></ROOT>',
        tables: ['tbl_device_cfg', 'tbl_device_health'],
        key: `device_id='${BUS}'`,
    },
    {
        name: 'sendlog — iki günlük satırı',
        query: { func: 'sendlog', busid: BUS, stationtype: '1', arch: 'x' },
        body: '<LOG hostname="VAL01" source="app">'
            + '<DATA timestamp="20260819100000" type="1" scope="boot" desc="started"/>'
            + '<DATA timestamp="20260819100100" type="2" scope="net" desc="up"/></LOG>',
        tables: ['tbl_device_log'],
        key: `device_id='${BUS}'`,
    },
];

module.exports = { CASES, VOLATILE, BUS, SAM };
