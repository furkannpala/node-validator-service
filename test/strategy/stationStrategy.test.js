const assert = require('assert');
const StationStrategy = require('../../strategy/StationStrategy');
const DataTransaction = require('../../bean/DataTransaction');
const { fakeConn } = require('../fakeConn');

const CFG = { currencyMultiplier: 100, systemId: '017', cardTypeCheckList: ['99'], saveExtendedFare: false };

const BASE = {
    record_id: 'D0001', trans_seq_no: '1', trans_flag: '1', customer_flag: '0',
    data_save_flag: '0', station_type: '2', transmit_cnt: '1', bus_stop_id: '45',
    alias_no: 'A1', card_no: '01712340000001', date_time: '20260818101500', usage_cnt: '3',
    passenger_type: '1', usage_amt: '250', remained_amt: '1000', customer_cnt: '1',
    traffic_type: '7', dc_rate: '0', old_route_code: '0', approval_no: '0', tc_code: '0',
    rtc_code: '0', travel_seq_no: '1', ht_start_time: '20260818080000', sam_id: '05100001',
    old_amount: '1250', old_date_time: '0', old_sam_id: '0', sam_seqno: '9',
    qtick_used: '000000', origin_sam_id: 'S1', fare_file_version: '1', travel_type: '1',
    product_code: 'P1', half_progress_type: '1',
};

function trxOf(extra) {
    const trx = new DataTransaction();
    trx.applyStationAttrs({ ...BASE, ...extra });
    return trx;
}

async function run(trx, cfg) {
    const conn = fakeConn((sql) => (/from mst_bus/i.test(sql)
        ? { rows: [{ COMP_CODE: 3, DEPOT_CODE: 'D9' }], outBinds: {} } : undefined));
    await new StationStrategy().processTransaction(conn, trx, { ...CFG, ...cfg }, 'test');
    return conn;
}

describe('station strategy', () => {
    it('replaces start_date_time with the operation day start before the trip row', async () => {
        const c = fakeConn((sql) => {
            if (/from mst_bus/i.test(sql)) return { rows: [{ COMP_CODE: 3 }], outBinds: {} };
            if (sql.includes('fn_get_operation_start_time') && sql.includes('from dual')) {
                return { rows: [{ START_DATE_TIME: '20260818050000' }], outBinds: {} };
            }
            return undefined;
        });
        const trx = trxOf();
        await new StationStrategy().processTransaction(c, trx, CFG, 'test');

        // The shift row still carries what the record sent; the ticket carries the day start.
        assert.strictEqual(c.matching('MERGE INTO afc_station')[0].binds.start_date_time,
            '20260818080000');
        assert.strictEqual(c.matching('INSERT INTO afc_td(')[0].binds.start_date_time,
            '20260818050000', 'the ticket must line up with the trip it belongs to');
    });

    it('opens the shift before storing the first ticket', async () => {
        const c = await run(trxOf());
        assert.strictEqual(c.matching('MERGE INTO afc_station').length, 1);
        assert.strictEqual(c.matching('INSERT INTO afc_tf (sam_id').length, 1);
        assert.strictEqual(c.matching('INSERT INTO afc_td(').length, 1);
    });

    it('does not repeat the trip row when one already exists', async () => {
        const c = fakeConn((sql) => {
            if (/from mst_bus/i.test(sql)) return { rows: [{ COMP_CODE: 3 }], outBinds: {} };
            if (sql.includes('SELECT 1 FROM afc_tf')) return { rows: [[1]], outBinds: {} };
            return undefined;
        });
        await new StationStrategy().processTransaction(c, trxOf(), CFG, 'test');
        assert.strictEqual(c.matching('INSERT INTO afc_tf (sam_id').length, 0);
    });

    it('skips the shift entirely for a station type that has none', async () => {
        const c = await run(trxOf({ station_type: '5' }));
        assert.strictEqual(c.matching('MERGE INTO afc_station').length, 0);
        assert.strictEqual(c.matching('INSERT INTO afc_td(').length, 1);
    });

    it('stores traffic_type in the STAGE column, unlike the bus path', async () => {
        const c = await run(trxOf());
        assert.strictEqual(c.matching('INSERT INTO afc_td(')[0].binds.stage, '7');
    });

    it('leaves the coordinates null because a station has no position', async () => {
        const c = await run(trxOf());
        const binds = c.matching('INSERT INTO afc_td(')[0].binds;
        assert.strictEqual(binds.lat, null);
        assert.strictEqual(binds.lng, null);
    });

    it('never adds origin_system_id, even on a system that uses it', async () => {
        const c = await run(trxOf(), { systemId: '029' });
        assert.strictEqual(c.matching('origin_system_id').length, 0);
    });

    it('gives the extended fare to afc_td only', async () => {
        const main = await run(trxOf({ extended_fare: '500' }), { saveExtendedFare: true });
        assert.strictEqual(main.matching('EXTENDED_FARE').length, 1);

        const blacklist = await run(trxOf({ trans_flag: '2', extended_fare: '500' }),
            { saveExtendedFare: true });
        assert.strictEqual(blacklist.matching('EXTENDED_FARE').length, 0);
    });

    describe('F records', () => {
        it('writes the station event row and nothing else', async () => {
            const c = await run(trxOf({ record_id: 'F001', travel_type: '1' }));
            assert.strictEqual(c.matching('INSERT INTO afc_tf_event').length, 1);
            assert.ok(c.matching('INSERT INTO afc_tf_event')[0].sql.includes('sam_seq_no_start'),
                'the station column set, not the bus one');
            assert.strictEqual(c.matching('MERGE INTO afc_th').length, 0);
        });

        it('also updates the shift for the driver card events', async () => {
            for (const type of ['3', '4', '5']) {
                const c = await run(trxOf({ record_id: 'F001', travel_type: type }));
                assert.strictEqual(c.matching('MERGE INTO afc_th').length, 1, `travel_type ${type}`);
            }
        });

        it('carries hpt into the half_progress_type column', async () => {
            const c = await run(trxOf({ record_id: 'F001', half_progress_type: '1' }));
            assert.strictEqual(c.matching('INSERT INTO afc_tf_event')[0].binds.half_progress_type, '1');
        });
    });

    it('files an unrecognised record in the blacklist table', async () => {
        const c = await run(trxOf({ record_id: 'X001' }));
        assert.strictEqual(c.matching('INSERT INTO afc_bl_td').length, 1);
    });
});
