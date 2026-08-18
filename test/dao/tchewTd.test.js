const assert = require('assert');
const dao = require('../../validator/dao/oracle/TchewTdDaoImpl');
const TchewDataStrategy = require('../../strategy/TchewDataStrategy');
const DataTransaction = require('../../bean/DataTransaction');
const { fakeConn } = require('../fakeConn');

/**
 * ins_data_tchew names no columns, so every value is placed by its position in the table.
 * These tests are the only thing standing between a DDL change and silent corruption on
 * system 106 (risk register #1).
 */
const EXPECTED = [
    ':trans_seq_no', ':trans_flag', ':customer_flag', ':data_save_flag', ':station_type',
    ':transmit_cnt', ':bus_stop_id', ':alias_no', ':card_no', ':boarding_date_time',
    ':usage_cnt', ':passenger_type', ':usage_amt', ':remained_amt', ':stage', ':customer_cnt',
    ':dc_rate', ':old_route_code', ':approval_no', ':tc_code', ':rtc_code', ':travel_seq_no',
    ':start_date_time', ':sam_id', ':old_amt', ':old_date_time', ':old_sam_id',
    'pk_config.fn_get_operation_pdate()', ':sam_seq_no', ':qtick_used', ':origin_sam_id',
];

const valuesOf = (sql) => sql.slice(sql.indexOf('VALUES(') + 7, -1).split(',');

describe('tchew positional inserts', () => {
    it('places 31 values in the order the Java statement bound them', () => {
        assert.deepStrictEqual(valuesOf(dao.insertTdSql), EXPECTED);
        assert.strictEqual(EXPECTED.length, 31);
    });

    it('names no columns at all, exactly like Java', () => {
        for (const sql of [dao.insertTdSql, dao.insertTestTdSql, dao.insertBlTdSql,
            dao.insertCheckinTdSql, dao.insertTopupSql]) {
            assert.ok(/^INSERT INTO \w+ VALUES\(/.test(sql), sql.slice(0, 40));
        }
    });

    it('gives all five tables the same 31 positions', () => {
        for (const sql of [dao.insertTestTdSql, dao.insertBlTdSql, dao.insertCheckinTdSql,
            dao.insertTopupSql]) {
            assert.deepStrictEqual(valuesOf(sql), EXPECTED);
        }
    });

    it('appends the extended fare as a 32nd value and nothing else', () => {
        assert.deepStrictEqual(valuesOf(dao.insertTdExtendedFareSql), [...EXPECTED, ':extended_fare']);
    });

    it('puts pdate at position 28, where the function call sits', () => {
        assert.strictEqual(valuesOf(dao.insertTdSql)[27], 'pk_config.fn_get_operation_pdate()');
    });

    it('feeds traffic_type into the fifteenth position', async () => {
        const trx = new DataTransaction();
        trx.applyStationAttrs({ traffic_type: '7', usage_amt: '250', remained_amt: '1000',
            old_amount: '0', customer_cnt: '1', trans_flag: '1', card_no: '01712340000001',
            record_id: 'D1' });
        const conn = fakeConn();
        await new TchewDataStrategy().processTransaction(conn, trx,
            { currencyMultiplier: 100, cardTypeCheckList: [] }, 'test');

        assert.strictEqual(conn.calls[0].binds.stage, '7');
        assert.strictEqual(valuesOf(conn.calls[0].sql)[14], ':stage');
    });
    describe('table selection', () => {
        const ATTRS = { usage_amt: '250', remained_amt: '1000', old_amount: '0',
            customer_cnt: '1', trans_flag: '1', card_no: '01712340000001', record_id: 'D1',
            traffic_type: '7' };

        const runWith = async (extra, cfg) => {
            const trx = new DataTransaction();
            trx.applyStationAttrs({ ...ATTRS, ...extra });
            const conn = fakeConn();
            await new TchewDataStrategy().processTransaction(conn, trx,
                { currencyMultiplier: 100, cardTypeCheckList: ['99'], ...cfg }, 'test');
            return conn;
        };

        it('files transaction flag 7 in afc_topup_td', async () => {
            const conn = await runWith({ trans_flag: '7' });
            assert.strictEqual(conn.matching('INSERT INTO afc_topup_td').length, 1);
            assert.strictEqual(conn.matching('INSERT INTO afc_td ').length, 0);
        });

        it('lets the test card and blacklist tables win over the topup flag', async () => {
            const test = await runWith({ trans_flag: '7', card_no: '01712990000001' });
            assert.strictEqual(test.matching('INSERT INTO afc_td_test').length, 1);
            const blacklisted = await runWith({ trans_flag: '2' });
            assert.strictEqual(blacklisted.matching('INSERT INTO afc_bl_td').length, 1);
        });

        it('raises a zero passenger count to one, with no system exception', async () => {
            const conn = await runWith({ customer_cnt: '0' }, { systemId: '004' });
            assert.strictEqual(conn.calls[0].binds.customer_cnt, 1);
        });

        it('fails the record when no passenger count was ever sent', async () => {
            await assert.rejects(() => runWith({ customer_cnt: undefined }),
                (e) => /NumberFormatException/.test(e.message));
        });
    });
});
