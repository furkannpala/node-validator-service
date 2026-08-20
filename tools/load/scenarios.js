const db = require('../compare/db');
const { BUS, SAM } = require('../compare/writeCases');

/** The card every senddata ticket of a run is written for; reset() has to clear it by name. */
const CARD = '01712340000001';

/**
 * What the load runner drives. `build` returns a fetch request; `sequence` is unique per
 * request so a write scenario is not measuring how fast Oracle rejects a duplicate key.
 */

function url(base, func, systemId, params = {}) {
    const address = new URL(`${base}/Validator`);
    address.searchParams.set('func', func);
    address.searchParams.set('systemid', systemId);
    // Both services keep a file cache; without this the run measures disk reads, not the service.
    address.searchParams.set('fromservice', '1');
    for (const [key, value] of Object.entries(params)) address.searchParams.set(key, value);
    return address.toString();
}

const SCENARIOS = {
    read: {
        description: 'getvalcfg — tek prosedür + LOB, okuma trafiğinin tipik hâli',
        build: (base, systemId) => ({
            url: url(base, 'getvalcfg', systemId, { busid: BUS }),
            init: { method: 'GET' },
        }),
    },

    procedure: {
        description: 'getvalidatorlist — prosedür çağrısı, LOB gövdesi küçük',
        build: (base, systemId) => ({
            url: url(base, 'getvalidatorlist', systemId, { busid: BUS }),
            init: { method: 'GET' },
        }),
    },

    nodb: {
        description: 'synctime — veritabanına hiç gitmez, saf çatı maliyeti',
        build: (base, systemId) => ({
            url: url(base, 'synctime', systemId),
            init: { method: 'GET' },
        }),
    },

    senddata: {
        description: 'senddata — bir bilet yazar; her istek kendi trans_seq_no değeriyle',
        // TRANS_SEQ_NO and TRAVEL_SEQ_NO are NUMBER(5,0). A wider value makes every request
        // fail with ORA-01438 and take the error path, which the endpoint answers with OK —
        // the first run of this scenario measured that without noticing.
        sequenceOf: (sequence) => 1000 + (sequence % 90000),
        build: (base, systemId, sequence) => {
            // travel_seq_no moves with the sequence too, or every ticket would hang off one
            // trip row and the run would measure lock contention on it.
            const seq = SCENARIOS.senddata.sequenceOf(sequence);
            // AFC_TD_UN_INNDX is unique on (CARD_NO, BOARDING_DATE_TIME, USAGE_CNT). Moving
            // trans_seq_no alone leaves all three fixed, so only the first ticket of a run went
            // in and every later one hit ORA-00001 — which AfcTdDaoImpl swallows and the
            // endpoint still answers OK. The run then measured how fast Oracle rejects a
            // duplicate, not how fast a ticket is written. usage_cnt is NUMBER(8,0), wide
            // enough for the sequence, and reads as the nth tap of the card.
            const attrs = 'record_id="D0001" trans_flag="1" customer_flag="0" data_save_flag="0"'
                + ' station_type="1" transmit_cnt="1" bus_stop_code="45" alias_no="A1"'
                + ` card_no="${CARD}" date_time="20260819100000" usage_cnt="${seq}"`
                + ' passenger_type="1" usage_amt="250" remained_amt="1000" stage="1"'
                + ' customer_cnt="1" dc_rate="0" old_route_code="0" approval_no="0" tc_code="0"'
                + ' rtc_code="0" ht_start_time="20260819080000" old_amount="1250"'
                + ' old_date_time="0" old_sam_id="0" sam_seqno="9" qtick_used="000000"'
                + ' trans_sam_id="0" validator_id="V1" depot_code="DEP0001" route_code="00100"'
                + ' driver_code="D0001" half_progress_type="1" return_flag="0"'
                + ' emergency_flag="0" trip_no="1" odometer="100" fare_file_version="1"'
                + ' travel_type="1" product_code="P1" latitude="38.4" longitude="27.1"'
                + ` bus_id="${BUS}" sam_id="${SAM}"`;
            return {
                url: url(base, 'senddata', systemId,
                    { busid: BUS, stationtype: '1', arch: 'x' }),
                init: {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/xml' },
                    body: `<TD><DATA ${attrs} trans_seq_no="${seq}"`
                        + ` travel_seq_no="${seq}"/></TD>`,
                },
            };
        },
        // Run before each service, or the second one meets the first one's rows as duplicates
        // and measures how fast Oracle rejects them.
        reset: () => {
            for (const table of ['afc_td', 'afc_tf', 'afc_tf_event', 'tbl_validator_error_td']) {
                const where = table === 'tbl_validator_error_td'
                    ? `bus_id='${BUS}'` : `sam_id='${SAM}'`;
                db.execute(`DELETE FROM ${table} WHERE ${where};`);
            }
            // A ticket sent by hand with another sam_id still occupies the unique index for this
            // card, and every later ticket of the run would be a duplicate. Clearing by sam_id
            // alone does not reach those rows.
            db.execute(`DELETE FROM afc_td WHERE card_no='${CARD}';`);
        },
        /**
         * A ticket has to land and no error row with it, or the run is timing a failure. The
         * row count matters as much as its presence: one stored ticket and ten thousand
         * duplicates also leaves afc_td non-empty, and that is the shape this scenario had
         * before usage_cnt moved with the sequence.
         */
        verify: (requests) => {
            const tickets = db.rows('afc_td', `sam_id='${SAM}'`).length;
            const errors = db.rows('tbl_validator_error_td', `bus_id='${BUS}'`).length;
            if (tickets === 0) return 'afc_td satırı yazılmadı';
            if (errors > 0) return `TBL_VALIDATOR_ERROR_TD'ye ${errors} satır düştü`;
            // Warmup requests are written too, so the stored count is never below the measured
            // count in a healthy run; well below it means records were swallowed as duplicates.
            if (requests && tickets < requests * 0.9) {
                return `${requests} istek yazıldı ama afc_td'de ${tickets} satır var`
                    + ' — kayıtlar yinelenen olarak yutuldu, ölçüm yazma yolunu ölçmüyor';
            }
            return null;
        },
        cleanup: () => SCENARIOS.senddata.reset(),
    },
};

module.exports = { SCENARIOS };
