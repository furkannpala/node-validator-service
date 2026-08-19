/**
 * Write-path cases. Each one posts the same body to both services and compares the rows that
 * landed, which is what section 3 and 4 of the roadmap ask for as the exit criterion.
 *
 * `key` is the predicate that identifies this case's rows in every table it touches, so the
 * harness can clear them between the two runs — otherwise the second service would meet its
 * own unique violations and write nothing. Every table a case can reach has to be listed, or
 * its rows survive into the next run and the comparison reads them as the other service's.
 *
 * Test data these rely on: MST_BUS '00001' (station_type 1) and '00002' (station_type 2),
 * MST_PERSONEL 'D0001' with pin 1234.
 */

const BUS = '00001';
const STATION = '00002';
const SAM = '05100077';

// Columns neither service controls: sequence values and insert-time clocks.
const VOLATILE = ['PDATE', 'RDATE', 'CREATE_DATE', 'CREATE_DATE_TIME', 'UPDATED_AT',
    'INSERT_DATE', 'SYSTEM_ENTRY_DATE'];

// Every table a senddata body can put a ticket in, so a case that picks the wrong one shows up
// as a row-count difference instead of passing quietly.
const TICKET_TABLES = ['afc_td', 'afc_bl_td', 'afc_td_test', 'afc_td_nonverified', 'afc_td_emv',
    'afc_tf', 'afc_tf_event', 'afc_th', 'tms_val_route'];

const dataAttrs = (over = {}) => Object.entries({
    record_id: 'D0001', trans_seq_no: '1', trans_flag: '1', customer_flag: '0',
    data_save_flag: '0', station_type: '1', transmit_cnt: '1', bus_stop_code: '45',
    alias_no: 'A1', card_no: '01712340000001', date_time: '20260819100000', usage_cnt: '3',
    passenger_type: '1', usage_amt: '250', remained_amt: '1000', stage: '1', customer_cnt: '1',
    dc_rate: '0', old_route_code: '0', approval_no: '0', tc_code: '0', rtc_code: '0',
    travel_seq_no: '7001', ht_start_time: '20260819080000', sam_id: SAM, old_amount: '1250',
    old_date_time: '0', old_sam_id: '0', sam_seqno: '9', qtick_used: '000000',
    trans_sam_id: '0', bus_id: BUS, validator_id: 'V1', depot_code: 'DEP0001',
    route_code: '00100', driver_code: 'D0001', half_progress_type: '1', return_flag: '0',
    emergency_flag: '0', trip_no: '1', odometer: '100', fare_file_version: '1',
    travel_type: '1', product_code: 'P1',
    // Java parses these into a float; without them the comparison never sees the column.
    latitude: '38.4', longitude: '27.1', ...over,
}).map(([k, v]) => `${k}="${v}"`).join(' ');

/** ins_station reads the stop under its own name and does not accept bus_stop_code. */
const stationAttrs = (over = {}) =>
    dataAttrs({ station_type: '2', bus_id: STATION, ...over })
        .replace('bus_stop_code=', 'bus_stop_id=');

const ticketCase = (name, over, extra = {}) => ({
    name,
    query: { func: 'senddata', busid: BUS, stationtype: '1', arch: 'x' },
    body: `<TD><DATA ${dataAttrs(over)}/></TD>`,
    tables: TICKET_TABLES,
    key: `sam_id='${SAM}'`,
    ...extra,
});

const fCase = (name, travelType) => ({
    name,
    query: { func: 'senddata', busid: BUS, stationtype: '1', arch: 'x' },
    // On an F record old_amount carries the path code; six leading zeros make Java replace it
    // with route_code + half_progress_type, which is what fits PATH_CODE CHAR(6).
    body: `<TD><DATA ${dataAttrs({ record_id: 'F0001', travel_type: travelType, old_amount: '00000011' })}/></TD>`,
    tables: TICKET_TABLES,
    key: `sam_id='${SAM}'`,
});

const CASES = [
    ticketCase('senddata — bir bilet (D)', {}),

    {
        name: 'senddata — üç bilet, ikincisi bozuk tarihli',
        query: { func: 'senddata', busid: BUS, stationtype: '1', arch: 'x' },
        body: '<TD>'
            + `<DATA ${dataAttrs({ trans_seq_no: '1' })}/>`
            + `<DATA ${dataAttrs({ trans_seq_no: '2', date_time: 'BOZUK' })}/>`
            + `<DATA ${dataAttrs({ trans_seq_no: '3' })}/>`
            + '</TD>',
        tables: [...TICKET_TABLES, 'tbl_validator_error_td'],
        key: `sam_id='${SAM}'`,
        keys: { tbl_validator_error_td: `bus_id='${BUS}'` },
        // Java stops processing the body at the bad record; this service carries on, which the
        // roadmap chose deliberately. See notes [48].
        expectDifference: 'notlar [48]: veri formatı hatasından sonra Node kalan kayıtları yazar',
    },

    // Table selection, in the order DRecordStrategy applies it: test card, then the blacklist
    // flags, then the signature, and only_tap last.
    ticketCase('senddata — kara liste bileti (trans_flag 2)', { trans_flag: '2' }),
    ticketCase('senddata — kara liste bileti (trans_flag 0)', { trans_flag: '0' }),
    ticketCase('senddata — test kartı (card_type_check 31)', { card_no: '01712310000001' }),
    ticketCase('senddata — only_tap, bilet yazılmaz', { only_tap: '1' }),
    ticketCase('senddata — iptal (trans_flag 4), tutarlar negatif',
        { trans_flag: '4', customer_cnt: '2' }),
    ticketCase('senddata — customer_cnt 0, bire yükseltilir', { customer_cnt: '0' }),
    ticketCase('senddata — qr_data varyantı', { qr_data: 'QR-TEST-1' }),

    {
        name: 'senddata — EMV çocuğu (afc_td_emv)',
        query: { func: 'senddata', busid: BUS, stationtype: '1', arch: 'x' },
        body: `<TD><DATA ${dataAttrs({ card_no: '01711340000001' })}>`
            + '<EMV ptcn="PT100" bin="454671" amount="265" key_index="2" enc_pan="ENC1"'
            + ' masked_pan="4546**0001" pan_sequence="01" key_type="1" on_us="0"'
            + ' currency_code="949" trans_result="00" late_auth="0" expired_date="2812"/>'
            + '</DATA></TD>',
        tables: TICKET_TABLES,
        key: `sam_id='${SAM}'`,
    },

    // F records. travel_type decides which visitors run; see notes [23].
    fCase('senddata — sefer kaydı (F, travel_type 1)', '1'),
    fCase('senddata — F, travel_type 3 (afc_th)', '3'),
    fCase('senddata — F, travel_type 8 (tms_val_route)', '8'),
    fCase('senddata — F, travel_type 9 (leaving_date_time yolu)', '9'),
    fCase('senddata — F, travel_type 0 (sefer açılışı)', '0'),
    fCase('senddata — F, travel_type 11 (sürücü değişimi)', '11'),

    // The station branch: a different attribute map and a shift opened before the ticket.
    {
        name: 'senddata — istasyon bileti (ins_station)',
        query: { func: 'senddata', busid: STATION, stationtype: '2', arch: 'x' },
        body: `<TD><DATA ${stationAttrs()}/></TD>`,
        tables: [...TICKET_TABLES, 'afc_station'],
        key: `sam_id='${SAM}'`,
    },
    {
        name: 'senddata — istasyon F kaydı',
        query: { func: 'senddata', busid: STATION, stationtype: '2', arch: 'x' },
        body: `<TD><DATA ${stationAttrs({ record_id: 'F0001', travel_type: '3' })}/></TD>`,
        tables: [...TICKET_TABLES, 'afc_station'],
        key: `sam_id='${SAM}'`,
    },

    {
        name: 'sendgps — bir konum',
        query: { func: 'sendgps', busid: BUS, stationtype: '1', arch: 'x' },
        body: `<ROOT><GPSDAT BUS_ID="${BUS}" DATE_TIME="20260819100000" LATITUDE="38.4"`
            + ' LONGITUDE="27.1" NSINDICATOR="N" EWINDICATOR="E" ALTITUDE="10" SPEED="42"'
            + ' UTCTIME="100000" HDOP="1" SVCOUNT="8" STATUS="A" ROUTE_DISTANCE="100"'
            + ' ROUTECODE="00100" DIRECTION="1" ROUTEOFFSET="5" ODOMETER="100"'
            + ` sam_id="${SAM}" driver_code="D0001" trip_code="1" main_event="1"`
            + ' sub_event="0"/></ROOT>',
        tables: ['tms_gps', 'tms_apc', 'tms_apc_event', 'tms_door_status'],
        key: `bus_id='${BUS}'`,
        keys: { tms_door_status: `sam_id='${SAM}'` },
    },
    {
        name: 'sendgps — main_event 7 / sub_event 8 (yolcu sayacı)',
        query: { func: 'sendgps', busid: BUS, stationtype: '1', arch: 'x' },
        body: `<ROOT><GPSDAT BUS_ID="${BUS}" DATE_TIME="20260819100100" LATITUDE="38.4"`
            + ' LONGITUDE="27.1" SPEED="0" ROUTECODE="00100" DIRECTION="1" ODOMETER="100"'
            + ` sam_id="${SAM}" driver_code="D0001" trip_code="1" main_event="7"`
            + ' sub_event="8" bus_stop_id="45" stop_seq_no="1" apc_1_in_cnt="3"'
            + ' apc_1_out_cnt="2" start_date_time="20260819080000" travel_seq_no="7001"/></ROOT>',
        tables: ['tms_gps', 'tms_apc', 'tms_apc_event', 'tms_door_status'],
        key: `bus_id='${BUS}'`,
        keys: { tms_door_status: `sam_id='${SAM}'` },
    },
    {
        name: 'sendgps — MAIN_EVENT yok',
        query: { func: 'sendgps', busid: BUS, stationtype: '1', arch: 'x' },
        body: `<ROOT><GPSDAT BUS_ID="${BUS}" DATE_TIME="20260819100200" LATITUDE="38.4"`
            + ' LONGITUDE="27.1" SPEED="42" ROUTECODE="00100" DIRECTION="1"'
            + ` sam_id="${SAM}" driver_code="D0001" trip_code="1"/></ROOT>`,
        tables: ['tms_gps', 'tms_apc', 'tms_apc_event', 'tms_door_status'],
        key: `bus_id='${BUS}'`,
        keys: { tms_door_status: `sam_id='${SAM}'` },
        // Java calls main_event.equals("7") and throws a NullPointerException when the
        // attribute is absent, losing the whole request. README, divergence 3.
        expectDifference: 'notlar [15]: MAIN_EVENT yokken Java NPE atıp isteği düşürüyor, Node kaydı yazıyor',
    },
    {
        name: 'sendgps — CANDAT',
        query: { func: 'sendgps', busid: BUS, stationtype: '1', arch: 'x' },
        body: `<ROOT><CANDAT bus_id="${BUS}" date_time="20260819100300" latitude="38.4"`
            + ' longitude="27.1"><VAL id="190" value="800"/><VAL id="247" value="1200"/>'
            + '</CANDAT></ROOT>',
        tables: ['can_data'],
        key: `bus_id='${BUS}'`,
    },

    {
        name: 'sendcfg — bir cihaz konfigürasyonu',
        query: { func: 'sendcfg', busid: BUS, stationtype: '1', arch: 'x' },
        body: `<ROOT><VALAPPCONF bus_id="${BUS}" sam_id="${SAM}" pcb_id="ab12cd"`
            + ' terminal_no="1" depot_code="DEP0001" station_type="1" driver_code="D0001"'
            + ' route_code="00100" temperature="30.5" input_voltage="12.10"'
            + ' battery_voltage="3.70" software_version="1.0"/></ROOT>',
        tables: ['tbl_device_cfg', 'tbl_device_health'],
        key: `device_id='${BUS}'`,
    },
    {
        name: 'sendcfg — ikinci eleman birincinin alanlarını devralır',
        query: { func: 'sendcfg', busid: BUS, stationtype: '1', arch: 'x' },
        // ins_cfg never cleared its variables between elements; notes [16].
        body: `<ROOT><VALAPPCONF bus_id="${BUS}" sam_id="${SAM}" pcb_id="ab12cd"`
            + ' terminal_no="1" depot_code="DEP0001" software_version="1.0"/>'
            + `<VALAPPCONF bus_id="${BUS}" route_code="00200"/></ROOT>`,
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
    {
        name: 'sendcan — CAN ölçümü',
        query: { func: 'sendcan', busid: BUS, stationtype: '1', arch: 'x' },
        body: `<ROOT><CANDAT bus_id="${BUS}" date_time="20260819100400" latitude="38.4"`
            + ' longitude="27.1"><VAL id="190" value="800"/></CANDAT></ROOT>',
        tables: ['afc_can', 'can_data'],
        key: `bus_id='${BUS}'`,
        keys: { afc_can: `hostname='${BUS}'` },
    },
];

module.exports = { CASES, VOLATILE, BUS, STATION, SAM };
