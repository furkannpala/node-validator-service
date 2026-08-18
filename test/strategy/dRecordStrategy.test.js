const assert = require('assert');
const DRecordStrategy = require('../../strategy/DRecordStrategy');
const { fakeConn } = require('../fakeConn');
const DataTransaction = require('../../bean/DataTransaction');

const CFG = { currencyMultiplier: 100, systemId: '017', cardTypeCheckList: ['99'], saveExtendedFare: false };

/**
 * Built through the bean with the XML attribute names the device actually sends, so the test
 * covers the attribute map and the strategy defaults together.
 */
const ATTRS = {
    trans_seq_no: '1', trans_flag: '1', customer_flag: '0', data_save_flag: '0',
    station_type: '1', transmit_cnt: '1', bus_stop_code: '45', alias_no: 'A1',
    card_no: '01712340000001', date_time: '20260818101500', usage_cnt: '3',
    passenger_type: '1', usage_amt: '250', remained_amt: '1000', stage: '1',
    customer_cnt: '1', dc_rate: '0', old_route_code: '0', approval_no: '0', tc_code: '0',
    rtc_code: '0', travel_seq_no: '1', ht_start_time: '20260818080000', sam_id: '05100001',
    old_amount: '1250', old_date_time: '0', old_sam_id: '0', sam_seqno: '9',
    qtick_used: '000000', trans_sam_id: '0', rider: '', tariff_number: '',
    fare_file_version: '1', travel_type: '1', product_code: 'P1', record_id: 'D0001',
};

function trxOf(extra) {
    const trx = new DataTransaction();
    trx.applyAttrs({ ...ATTRS, ...extra });
    return trx;
}

async function run(trx, cfg) {
    const conn = fakeConn();
    await new DRecordStrategy().processTransaction(conn, trx, { ...CFG, ...cfg }, 'test');
    return conn;
}

describe('D record strategy', () => {
    describe('table selection', () => {
        it('sends a normal ticket to afc_td', async () => {
            const conn = await run(trxOf());
            assert.strictEqual(conn.matching('INSERT INTO afc_td(').length, 1);
        });

        it('sends a card type on the check list to afc_td_test', async () => {
            // Characters 5 and 6 of the card number are the type.
            const conn = await run(trxOf({ card_no: '01712990000001' }));
            assert.strictEqual(conn.matching('INSERT INTO afc_td_test').length, 1);
            assert.strictEqual(conn.matching('INSERT INTO afc_td(').length, 0);
        });

        it('sends transaction flags 2 and 0 to afc_bl_td', async () => {
            for (const flag of ['2', '0']) {
                const conn = await run(trxOf({ trans_flag: flag }));
                assert.strictEqual(conn.matching('INSERT INTO afc_bl_td').length, 1, `flag ${flag}`);
            }
        });

        it('drops an only_tap record without storing a ticket', async () => {
            const conn = await run(trxOf({ only_tap: '1' }));
            // The trip lookup still runs: Java did it before it looked at only_tap.
            assert.strictEqual(conn.matching('INSERT INTO afc_td').length, 0);
            assert.strictEqual(conn.matching('INSERT INTO afc_bl_td').length, 0);
        });

        it('creates the trip row when the ticket arrives before it', async () => {
            // mst_bus has to answer, or Java skipped the insert too.
            const conn = fakeConn((sql) => (/from mst_bus/i.test(sql)
                ? { rows: [{ COMP_CODE: 1, DEPOT_CODE: 'D1' }], outBinds: {} } : undefined));
            await new DRecordStrategy().processTransaction(conn, trxOf(), CFG, 'test');
            assert.strictEqual(conn.matching('SELECT 1 FROM afc_tf').length, 1);
            assert.strictEqual(conn.matching('INSERT INTO afc_tf (').length, 1,
                'a placeholder trip so the ticket tf_id resolves');
            assert.strictEqual(conn.matching('INSERT INTO afc_tf (')[0].binds.travel_type, '0');
        });

        it('does not create a second trip row when one is already there', async () => {
            const conn = fakeConn((sql) => {
                if (sql.includes('SELECT 1 FROM afc_tf')) return { rows: [[1]], outBinds: {} };
                if (/from mst_bus/i.test(sql)) return { rows: [{ COMP_CODE: 1 }], outBinds: {} };
                return undefined;
            });
            await new DRecordStrategy().processTransaction(conn, trxOf(), CFG, 'test');
            assert.strictEqual(conn.matching('INSERT INTO afc_tf (').length, 0);
        });
    });

    describe('amounts', () => {
        it('divides by the currency multiplier', async () => {
            const trx = trxOf();
            const conn = await run(trx);
            const binds = conn.matching('INSERT INTO afc_td(')[0].binds;
            assert.strictEqual(binds.usage_amt, 2.5);
            assert.strictEqual(binds.remained_amt, 10);
            assert.strictEqual(binds.old_amt, 12.5);
        });

        it('stores a non positive previous balance as zero', async () => {
            const conn = await run(trxOf({ old_amount: '0' }));
            assert.strictEqual(conn.matching('INSERT INTO afc_td(')[0].binds.old_amt, 0);
        });

        it('leaves amounts untouched when the multiplier is 1', async () => {
            const conn = await run(trxOf(), { currencyMultiplier: 1 });
            assert.strictEqual(conn.matching('INSERT INTO afc_td(')[0].binds.usage_amt, 250);
        });

        it('negates the count and the amount on a cancellation', async () => {
            const conn = await run(trxOf({ trans_flag: '4' }));
            const binds = conn.matching('INSERT INTO afc_td(')[0].binds;
            assert.strictEqual(binds.customer_cnt, -1);
            assert.strictEqual(binds.usage_amt, -2.5);
        });
    });

    describe('passenger count', () => {
        it('raises a zero count to one', async () => {
            const conn = await run(trxOf({ customer_cnt: '0' }));
            assert.strictEqual(conn.matching('INSERT INTO afc_td(')[0].binds.customer_cnt, 1);
        });

        it('keeps it at zero for system 004 with flag 9 or 6', async () => {
            for (const flag of ['9', '6']) {
                const conn = await run(trxOf({ customer_cnt: '0', trans_flag: flag }), { systemId: '004' });
                assert.strictEqual(conn.matching('INSERT INTO afc_td(')[0].binds.customer_cnt, 0, `flag ${flag}`);
            }
        });

        it('still raises it on system 004 with another flag', async () => {
            const conn = await run(trxOf({ customer_cnt: '0', trans_flag: '1' }), { systemId: '004' });
            assert.strictEqual(conn.matching('INSERT INTO afc_td(')[0].binds.customer_cnt, 1);
        });
    });

    describe('insert variant', () => {
        it('adds origin_system_id only for systems 029 and 020', async () => {
            const on = await run(trxOf(), { systemId: '029' });
            assert.ok(on.matching('origin_system_id').length === 1);
            assert.strictEqual(on.matching('INSERT INTO afc_td(')[0].binds.origin_system_id, '017');

            const off = await run(trxOf(), { systemId: '017' });
            assert.strictEqual(off.matching('origin_system_id').length, 0);
        });

        it('adds QR_DATA when the record carries one', async () => {
            const conn = await run(trxOf({ qr_data: 'abc' }));
            assert.strictEqual(conn.matching('QR_DATA').length, 1);
        });

        it('adds EXTENDED_FARE when the system saves it', async () => {
            const conn = await run(trxOf({ extended_fare: '500' }), { saveExtendedFare: true });
            const call = conn.matching('EXTENDED_FARE')[0];
            assert.ok(call, 'expected the extended fare variant');
            assert.strictEqual(call.binds.extended_fare, 5);
        });

        it('never puts origin_system_id on the blacklist table', async () => {
            const conn = await run(trxOf({ trans_flag: '2' }), { systemId: '029' });
            assert.strictEqual(conn.matching('origin_system_id').length, 0);
        });
    });

    describe('signature check for system 112', () => {
        it('does not verify on any other system', async () => {
            const conn = await run(trxOf({ tc_code: 'not-a-signature' }));
            assert.strictEqual(conn.matching('INSERT INTO afc_td(').length, 1);
        });

        it('routes an unverifiable record to afc_td_nonverified', async () => {
            const conn = await run(trxOf({ tc_code: 'aabbcc' }), { systemId: '112' });
            assert.strictEqual(conn.matching('INSERT INTO afc_td_nonverified').length, 1);
            assert.strictEqual(conn.matching('INSERT INTO afc_td(').length, 0);
        });
    });
    describe('card payment data', () => {
        const EMV = { ptcn: 'PT1', amount: '1500', key_index: '2', term_no: 'T1', on_us: '1' };
        const emvTrx = (extra, emv) => {
            const trx = trxOf(extra);
            trx.applyEmvAttrs({ ...EMV, ...emv });
            return trx;
        };

        it('writes the EMV row when the record carries a ptcn', async () => {
            const conn = await run(emvTrx());
            const inserts = conn.matching('INSERT INTO AFC_TD_EMV');
            assert.strictEqual(inserts.length, 1);
            assert.strictEqual(inserts[0].binds.amount, 15, 'divided by the currency multiplier');
            assert.strictEqual(inserts[0].binds.ptcn, 'PT1');
            assert.strictEqual(inserts[0].binds.onus, '1');
        });

        it('writes no EMV row without a ptcn', async () => {
            const conn = await run(emvTrx({}, { ptcn: '' }));
            assert.strictEqual(conn.matching('INSERT INTO AFC_TD_EMV').length, 0);
        });

        it('stores an unparsable EMV amount as zero', async () => {
            const conn = await run(emvTrx({}, { amount: 'x' }));
            assert.strictEqual(conn.matching('INSERT INTO AFC_TD_EMV')[0].binds.amount, 0);
        });

        it('keeps the EMV row off the test and blacklist branches', async () => {
            const test = await run(emvTrx({ card_no: '01712990000001' }));
            assert.strictEqual(test.matching('INSERT INTO AFC_TD_EMV').length, 0);
            const blacklisted = await run(emvTrx({ trans_flag: '2' }));
            assert.strictEqual(blacklisted.matching('INSERT INTO AFC_TD_EMV').length, 0);
        });

        it('still writes the EMV row for a record that fails its signature check', async () => {
            const conn = await run(emvTrx({ tc_code: 'aabbcc' }), { systemId: '112' });
            assert.strictEqual(conn.matching('INSERT INTO AFC_TD_EMV').length, 1);
            assert.strictEqual(conn.matching('INSERT INTO afc_td_nonverified').length, 1);
        });

        it('marks a credit card ticket for the fare sync', async () => {
            // Characters 5 and 6 of the card number are the type; 11 is the default credit type.
            const conn = await run(emvTrx({ card_no: '01712110000001' }), { creditCardTypes: ['11'] });
            assert.strictEqual(conn.matching('INSERT INTO afc_td(')[0].binds.transfer_ref_code, 'sync');
        });

        it('leaves transfer_ref_code null when the device priced the tap itself', async () => {
            const conn = await run(emvTrx({ card_no: '01712110000001' }, { key_index: '1' }),
                { creditCardTypes: ['11'] });
            assert.strictEqual(conn.matching('INSERT INTO afc_td(')[0].binds.transfer_ref_code, null);
        });

        it('leaves transfer_ref_code null for a card type that is not a credit card', async () => {
            const conn = await run(emvTrx(), { creditCardTypes: ['11'] });
            assert.strictEqual(conn.matching('INSERT INTO afc_td(')[0].binds.transfer_ref_code, null);
        });

        it('writes the reported chip serial back to the card', async () => {
            const conn = await run(trxOf({ csn: 'ABCD1234' }));
            const updates = conn.matching('UPDATE TBL_RFCARD SET CSN');
            assert.strictEqual(updates.length, 1);
            assert.strictEqual(updates[0].binds.csn, 'ABCD1234');
            assert.strictEqual(updates[0].binds.card_no, '01712340000001');
        });

        it('writes the chip serial even when the ticket itself is skipped', async () => {
            const conn = await run(trxOf({ csn: 'ABCD1234', only_tap: '1' }));
            assert.strictEqual(conn.matching('INSERT INTO afc_td(').length, 0);
            assert.strictEqual(conn.matching('UPDATE TBL_RFCARD SET CSN').length, 1);
        });

        it('leaves the card alone when no chip serial was reported', async () => {
            const conn = await run(trxOf());
            assert.strictEqual(conn.matching('UPDATE TBL_RFCARD SET CSN').length, 0);
        });

        it('keeps the ticket when the chip serial write fails', async () => {
            const conn = fakeConn((sql) => (sql.includes('UPDATE TBL_RFCARD')
                ? new Error('ORA-01400') : undefined));
            await new DRecordStrategy().processTransaction(conn, trxOf({ csn: 'A1' }), CFG, 'test');
            assert.strictEqual(conn.matching('INSERT INTO afc_td(').length, 1);
        });
    });
});
