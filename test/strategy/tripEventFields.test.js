/* eslint-env mocha */
const assert = require('assert');
const { fakeConn, makeReq, makeRes, run } = require('../fakeConn');
const sendData = require('../../validator/controller/sendData');

/**
 * Fields the two services disagreed on until the write comparison put the same body through
 * both. Each one is a Java quirk, verified against the running Java service.
 */

const ATTRS = 'record_id="F0001" trans_seq_no="1" trans_flag="1" customer_flag="0"'
    + ' data_save_flag="0" station_type="1" transmit_cnt="1" bus_stop_code="45" alias_no="A1"'
    + ' card_no="01712340000001" date_time="20260819100000" usage_cnt="3" passenger_type="1"'
    + ' usage_amt="250" remained_amt="1000" stage="1" customer_cnt="1" dc_rate="0"'
    + ' old_route_code="4242" approval_no="0" tc_code="0" rtc_code="0" travel_seq_no="7001"'
    + ' ht_start_time="20260819080000" sam_id="05100077" old_amount="00000011"'
    + ' old_date_time="0" old_sam_id="0" sam_seqno="9" qtick_used="000000" trans_sam_id="0"'
    + ' bus_id="00001" validator_id="V1" depot_code="DEP0001" route_code="00100"'
    + ' driver_code="D0001" half_progress_type="1" trip_no="7" odometer="100"';

const body = (over = '') => `<TD><DATA ${ATTRS} ${over}/></TD>`;

function conn() {
    return fakeConn((sql) => {
        if (/from mst_bus/i.test(sql)) return { rows: [{ COMP_CODE: 1, DEPOT_CODE: 'DEP0001' }], outBinds: {} };
        return undefined;
    });
}

const request = (c, body_, query) =>
    makeReq(c, { busid: '00001', stationtype: '1', systemid: '017', ...query }, body_);

describe('trip event fields', () => {
    it('leaves the odometer at zero on a travel type that skips the preparation step', async () => {
        const c = conn();
        await run(sendData, request(c, body('travel_type="3"')), makeRes());

        const event = c.matching('INSERT INTO afc_tf_event')[0];
        // Java bound its iodometer, and travel types 2, 3, 4, 5, 8 and 9 never reach the code
        // that fills it, however far the bus has driven.
        assert.strictEqual(event.binds.odometer, 0);
    });

    it('carries the odometer on a travel type that does run it', async () => {
        const c = conn();
        await run(sendData, request(c, body('travel_type="1"')), makeRes());
        assert.strictEqual(c.matching('INSERT INTO afc_tf_event')[0].binds.odometer, 100);
    });

    it('writes old_route_code into TMS_VAL_ROUTE.TRIP_NO, not the trip number', async () => {
        const c = conn();
        await run(sendData, request(c, body('travel_type="8"')), makeRes());

        const route = c.matching('INSERT INTO tms_val_route')[0];
        assert.strictEqual(route.binds.trip_no, '4242', 'the record says trip_no="7"');
    });

    it('binds the two literals ins_station uses on the station event row', async () => {
        const c = conn();
        await run(sendData, request(c, body('travel_type="3"'),
            { busid: '00002', stationtype: '2' }), makeRes());

        const event = c.matching('INSERT INTO afc_tf_event')[0];
        assert.strictEqual(event.binds.path_code, '0');
        assert.strictEqual(event.binds.total_stop_cnt, '0');
        // Unlike the bus path, ins_station parses the odometer for every travel type.
        assert.strictEqual(event.binds.odometer, 100);
    });
});
