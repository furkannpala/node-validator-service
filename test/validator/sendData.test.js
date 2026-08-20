const assert = require('assert');
const { fakeConn, makeReq, makeRes, run, oracleError } = require('../fakeConn');
const { ULog } = require('../../../../lib/utils');
const sendData = require('../../validator/controller/transaction').funcs.senddata;

const DATA_ATTRS = 'record_id="D0001" trans_seq_no="1" trans_flag="1" customer_flag="0"'
    + ' data_save_flag="0" station_type="1" transmit_cnt="1" bus_stop_code="45" alias_no="A1"'
    + ' card_no="01712340000001" date_time="20260818101500" usage_cnt="3" passenger_type="1"'
    + ' usage_amt="250" remained_amt="1000" stage="1" customer_cnt="1" dc_rate="0"'
    + ' old_route_code="0" approval_no="0" tc_code="0" rtc_code="0" travel_seq_no="1"'
    + ' ht_start_time="20260818080000" sam_id="05100001" old_amount="1250" old_date_time="0"'
    + ' old_sam_id="0" sam_seqno="9" qtick_used="000000" trans_sam_id="0"'
    + ' fare_file_version="1" travel_type="1" product_code="P1"';

const body = (n = 1) => `<TD>${`<DATA ${DATA_ATTRS}/>`.repeat(n)}</TD>`;

/** mst_bus answers one row unless the caller overrides it. */
function conn(handler) {
    return fakeConn((sql, binds) => {
        if (/from mst_bus/i.test(sql)) return { rows: [{ COMP_CODE: 1 }], outBinds: {} };
        return handler ? handler(sql, binds) : undefined;
    });
}

const request = (c, query) => makeReq(c, { busid: '34AA0001', stationtype: '1', ...query }, body());

describe('senddata', () => {
    /**
     * The reply carries no record_id and neither does the error row, so this log line is the
     * only thing that says which record of a body failed. It used to live in strategy/Context;
     * a test guards it now that the class it sat in is gone.
     */
    it('names the failing record in the log', async () => {
        const lines = [];
        const realError = ULog.error;
        ULog.error = (message) => lines.push(String(message));
        try {
            const c = conn((sql) => (sql.includes('INSERT INTO afc_td(')
                ? oracleError(942) : undefined));
            await run(sendData, request(c), makeRes());
        } finally {
            ULog.error = realError;
        }

        const named = lines.filter((l) => l.includes('record_id=D0001') && l.includes('sam_id=05100001'));
        assert.strictEqual(named.length, 1,
            `expected the record to be named once, got: ${JSON.stringify(lines)}`);
    });

    it('checks mst_bus before touching anything else', async () => {
        const c = conn();
        const err = await run(sendData, request(c), makeRes());

        assert.strictEqual(err, undefined);
        assert.ok(c.matching('from mst_bus').length >= 1);
        assert.strictEqual(c.matching('INSERT INTO afc_td(').length, 1);
    });

    it('fails with the exact Java message when the bus is unknown', async () => {
        const c = fakeConn((sql) => (/from mst_bus/i.test(sql) ? { rows: [], outBinds: {} } : undefined));
        const err = await run(sendData, request(c), makeRes());

        assert.ok(err, 'expected an error');
        // Java process() put everything the body raised behind the same code and prefix.
        assert.strictEqual(err.code, 103);
        assert.ok(err.message.startsWith('Database operation failed: '), err.message);
        assert.ok(err.message.includes(
            'mst_bus validation failed: BUS_ID: 34AA0001, STATION_TYPE: 1 (no record found)'), err.message);
        assert.strictEqual(c.matching('INSERT INTO afc_td(').length, 0);
    });

    it('commits once per record, not once per request', async () => {
        const c = conn();
        const req = makeReq(c, { busid: '34AA0001', stationtype: '1' }, body(3));
        await run(sendData, req, makeRes());

        assert.strictEqual(c.matching('INSERT INTO afc_td(').length, 3);
        assert.strictEqual(c.commits, 3);
    });

    it('keeps the good records when one of them is rejected', async () => {
        let seen = 0;
        const c = conn((sql) => {
            if (!sql.includes('INSERT INTO afc_td(')) return undefined;
            seen++;
            return seen === 2 ? oracleError(12899) : undefined;
        });
        const req = makeReq(c, { busid: '34AA0001', stationtype: '1' }, body(3));
        const err = await run(sendData, req, makeRes());

        assert.strictEqual(err, undefined, 'a bad record must not fail the request');
        assert.strictEqual(c.rollbacks, 1);
        assert.strictEqual(c.matching('TBL_VALIDATOR_ERROR_TD').length, 1);
    });

    it('writes the error record after the rollback, with its own commit', async () => {
        const c = conn((sql) => (sql.includes('INSERT INTO afc_td(') ? oracleError(1722) : undefined));
        await run(sendData, request(c), makeRes());

        const order = c.calls.map((call) => (call.sql.includes('TBL_VALIDATOR_ERROR_TD') ? 'error' : 'other'));
        assert.ok(order.includes('error'));
        assert.strictEqual(c.rollbacks, 1);
        assert.strictEqual(c.commits, 1, 'only the error record commits');
    });

    it('raises 103 for a database failure that is not about the data', async () => {
        const c = conn((sql) => (sql.includes('INSERT INTO afc_td(') ? oracleError(30006) : undefined));
        const err = await run(sendData, request(c), makeRes());

        assert.strictEqual(err.code, 103);
        assert.ok(err.message.includes('WAIT timeout expired'), err.message);
        assert.strictEqual(c.matching('TBL_VALIDATOR_ERROR_TD').length, 0);
    });

    it('ignores a duplicate record without filing an error', async () => {
        const c = conn((sql) => (sql.includes('INSERT INTO afc_td(') ? oracleError(1) : undefined));
        const err = await run(sendData, request(c), makeRes());

        assert.strictEqual(err, undefined);
        assert.strictEqual(c.matching('TBL_VALIDATOR_ERROR_TD').length, 0);
    });

    it('files an unparsable body and still answers OK', async () => {
        const c = conn();
        const req = makeReq(c, { busid: '34AA0001', stationtype: '1' }, '<TD><DATA broken');
        const err = await run(sendData, req, makeRes());

        assert.strictEqual(err, undefined);
        const filed = c.matching('TBL_VALIDATOR_ERROR_TD');
        assert.strictEqual(filed.length, 1);
        assert.strictEqual(filed[0].binds.error_code, 'XML_PARSE_ERROR');
        assert.strictEqual(c.matching('from mst_bus').length, 0, 'nothing else runs');
    });

    it('forces the multiplier to 1 on the systems that store raw amounts', async () => {
        const c = conn();
        await run(sendData, request(c), makeRes('107'));
        assert.strictEqual(c.matching('INSERT INTO afc_td(')[0].binds.usage_amt, 250);
    });

    it('reads the EMV child before the DATA attributes', async () => {
        const c = conn();
        const withEmv = `<TD><DATA ${DATA_ATTRS}><EMV ptcn="PT1" travel_type="9"/></DATA></TD>`;
        const req = makeReq(c, { busid: '34AA0001', stationtype: '1' }, withEmv);
        await run(sendData, req, makeRes());

        // travel_type is in both maps, and the DATA value has to win.
        assert.strictEqual(c.matching('INSERT INTO afc_td(')[0].binds.travel_type, '1');
    });

    it('sends a station type down the station path', async () => {
        // The shift is decided by the station_type INSIDE the record, as in Java, so the body
        // has to carry it too; the query parameter only picks the strategy.
        const stationBody = `<TD><DATA ${DATA_ATTRS.replace('station_type="1"', 'station_type="2"')}/></TD>`;
        const c = conn();
        const err = await run(sendData,
            makeReq(c, { busid: '34AA0001', stationtype: '2' }, stationBody), makeRes());

        assert.strictEqual(err, undefined);
        // The shift row is the station path's fingerprint; the bus path never writes it.
        assert.strictEqual(c.matching('MERGE INTO afc_station').length, 1);
        assert.strictEqual(c.matching('INSERT INTO afc_td(').length, 1);
    });

    it('reads a station body with the station attribute names', async () => {
        // bus_stop_id and traffic_type only exist on the station map.
        const stationBody = '<TD><DATA record_id="D1" station_type="2" trans_flag="1"'
            + ' card_no="01712340000001" usage_amt="250" remained_amt="1000" customer_cnt="1"'
            + ' old_amount="0" sam_id="05100001" ht_start_time="20260818080000"'
            + ' date_time="20260818101500" bus_stop_id="45" traffic_type="7"/></TD>';
        const c = conn();
        await run(sendData, makeReq(c, { busid: '34AA0001', stationtype: '2' }, stationBody), makeRes());

        const binds = c.matching('INSERT INTO afc_td(')[0].binds;
        assert.strictEqual(binds.bus_stop_id, '45');
        assert.strictEqual(binds.stage, '7', 'traffic_type lands in STAGE on the station path');
    });

    it('sends system 106 with another company down the legacy path', async () => {
        const tchew = fakeConn((sql) => {
            if (/from mst_bus/i.test(sql)) return { rows: [{ COMP_CODE: 9 }], outBinds: {} };
            return undefined;
        });
        const err = await run(sendData,
            makeReq(tchew, { busid: '34AA0001', stationtype: '1' }, body()), makeRes('106'));

        assert.strictEqual(err, undefined);
        // The positional statement names no columns; the modern one lists them.
        const inserts = tchew.matching('INSERT INTO afc_td ');
        assert.strictEqual(inserts.length, 1);
        assert.ok(inserts[0].sql.startsWith('INSERT INTO afc_td VALUES('), inserts[0].sql.slice(0, 40));
    });

    it('keeps system 106 company 1 on the modern path', async () => {
        const c = fakeConn((sql) => {
            if (/from mst_bus/i.test(sql)) return { rows: [{ COMP_CODE: 1 }], outBinds: {} };
            return undefined;
        });
        await run(sendData, makeReq(c, { busid: '34AA0001', stationtype: '1' }, body()), makeRes('106'));
        assert.strictEqual(c.matching('INSERT INTO afc_td(').length, 1);
    });

    describe('per-element reset', () => {
        /**
         * Java cleared part of its state at the top of every DATA element. Without that, a
         * value the first element sent is written again for the second one, silently.
         */
        // The first element carries the extras, the second one only the base attributes.
        const BASE = DATA_ATTRS.replace(' product_code="P1"', '');
        const twoElements = (extras) => `<TD><DATA ${BASE} ${extras}/><DATA ${BASE}/></TD>`;

        it('clears the fields Java cleared and keeps the ones it did not', async () => {
            const c = conn();
            const body = twoElements('qr_data="QR1" product_code="P9"');
            await run(sendData, makeReq(c, { busid: '34AA0001', stationtype: '1' }, body), makeRes());

            const rows = c.matching('INSERT INTO afc_td(');
            assert.strictEqual(rows.length, 2);
            assert.strictEqual(rows[0].binds.qr_data, 'QR1');
            // qr_data is on the reset list, so the second statement has no QR_DATA column.
            assert.ok(!rows[1].sql.includes('QR_DATA'), rows[1].sql);
            assert.strictEqual(rows[1].binds.product_code, null, 'product_code is on it too');
            // card_no is not, so the second row still carries the first one's value.
            assert.strictEqual(rows[1].binds.card_no, rows[0].binds.card_no);
        });

        it('leaves product_code alone on the station path, as ins_station did', async () => {
            const c = conn();
            await run(sendData, makeReq(c, { busid: 'ST01', stationtype: '2' },
                twoElements('product_code="P9"')), makeRes());

            const rows = c.matching('INSERT INTO afc_td(');
            assert.strictEqual(rows.length, 2);
            assert.strictEqual(rows[1].binds.product_code, 'P9');
        });
    });
});
