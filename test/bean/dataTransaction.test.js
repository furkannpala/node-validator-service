const assert = require('assert');
const DataTransaction = require('../../bean/DataTransaction');

describe('DataTransaction attribute map', () => {
    it('renames the ten attributes whose XML name differs from the column', () => {
        const trx = new DataTransaction();
        trx.applyAttrs({
            date_time: '20260818101500', ht_start_time: '20260818080000', bus_stop_code: '45',
            trafic_type: '2', old_amount: '150', sam_seqno: '7', trans_sam_id: '05100002',
        });

        assert.strictEqual(trx.boarding_date_time, '20260818101500');
        assert.strictEqual(trx.start_date_time, '20260818080000');
        assert.strictEqual(trx.bus_stop_id, '45');
        assert.strictEqual(trx.traffic_type, '2');
        assert.strictEqual(trx.old_amt, '150');
        assert.strictEqual(trx.sam_seq_no, '7');
        assert.strictEqual(trx.origin_sam_id, '05100002');
    });

    it('matches the older fields case sensitively, as Java did with ==', () => {
        const trx = new DataTransaction();
        trx.applyAttrs({ CARD_NO: '1234', card_no: '5678' });
        assert.strictEqual(trx.card_no, '5678', 'only the lower case spelling is read');
    });

    it('matches the newer fields case insensitively', () => {
        const trx = new DataTransaction();
        trx.applyAttrs({ QR_DATA: 'abc', Product_Code: 'P1', TRIP_NO: '4' });
        assert.strictEqual(trx.qr_data, 'abc');
        assert.strictEqual(trx.product_code, 'P1');
        assert.strictEqual(trx.trip_no, '4');
    });

    it('lets the later of latitude and LATITUDE win, in document order', () => {
        const lowerLast = new DataTransaction();
        lowerLast.applyAttrs({ LATITUDE: '37.1', latitude: '37.9' });
        assert.strictEqual(lowerLast.latitude, '37.9');

        const upperLast = new DataTransaction();
        upperLast.applyAttrs({ latitude: '37.9', LATITUDE: '37.1' });
        assert.strictEqual(upperLast.latitude, '37.1');
    });

    it('keeps the Java defaults for the fields that had one', () => {
        const trx = new DataTransaction();
        assert.strictEqual(trx.station_type, '1');
        assert.strictEqual(trx.usage_amt, '0');
        assert.strictEqual(trx.qtick_used, '000000');
        assert.strictEqual(trx.stage, '1');
        assert.strictEqual(trx.rider, '');
        assert.strictEqual(trx.stop_seq_no, 0);
        assert.strictEqual(trx.compCode, -1);
    });

    it('stores the service charge as text and as a parsed amount', () => {
        const trx = new DataTransaction();
        trx.applyAttrs({ service_charge: '250' });
        assert.strictEqual(trx.service_charge_str, '250');
        assert.strictEqual(trx.service_charge, 250);
    });

    it('keeps the previous amount when the service charge will not parse', () => {
        const trx = new DataTransaction();
        trx.applyAttrs({ service_charge: 'abc' });
        assert.strictEqual(trx.service_charge_str, 'abc');
        assert.strictEqual(trx.service_charge, 0, 'Java swallowed the parse error');
    });

    it('throws on a non numeric stop_seq_no, which Java did not catch either', () => {
        const trx = new DataTransaction();
        assert.throws(() => trx.applyAttrs({ stop_seq_no: 'x' }), /NumberFormatException/);
    });

    it('does not let the EMV element overwrite the DATA sam_id', () => {
        const trx = new DataTransaction();
        trx.applyAttrs({ sam_id: '05100001' });
        trx.applyEmvAttrs({ sam_id: '09999999', boarding_date_time: '19700101000000', ptcn: 'P' });

        assert.strictEqual(trx.sam_id, '05100001', 'the EMV branch is commented out in Java');
        assert.strictEqual(trx.boarding_date_time, null);
        assert.strictEqual(trx.ptcn, 'P');
    });

    it('reads the record type from the first character of record_id', () => {
        const trx = new DataTransaction();
        assert.strictEqual(trx.getRecordType(), null);
        trx.applyAttrs({ record_id: 'D0001' });
        assert.strictEqual(trx.getRecordType(), 'D');
        trx.applyAttrs({ record_id: 'F0002' });
        assert.strictEqual(trx.getRecordType(), 'F');
    });

    it('ignores an attribute that is in neither map', () => {
        const trx = new DataTransaction();
        trx.applyAttrs({ not_a_field: 'x' });
        assert.strictEqual(trx.not_a_field, undefined);
    });

    it('carries every attribute Java read: 43 exact, 28 insensitive, 17 emv', () => {
        assert.strictEqual(Object.keys(DataTransaction.DATA_EXACT).length, 43);
        assert.strictEqual(Object.keys(DataTransaction.DATA_CI).length, 28);
        assert.strictEqual(Object.keys(DataTransaction.EMV_CI).length, 17);
    });
});

describe('DataTransaction station attribute map', () => {
    it('accepts the correct spelling of traffic_type, unlike the bus path', () => {
        const station = new DataTransaction();
        station.applyStationAttrs({ traffic_type: '2' });
        assert.strictEqual(station.traffic_type, '2');

        const bus = new DataTransaction();
        bus.applyAttrs({ traffic_type: '2' });
        assert.strictEqual(bus.traffic_type, null, 'ins_data only accepts the trafic_type typo');
    });

    it('reads origin_sam_id under its own name instead of trans_sam_id', () => {
        const station = new DataTransaction();
        station.applyStationAttrs({ origin_sam_id: 'S1' });
        assert.strictEqual(station.origin_sam_id, 'S1');

        const bus = new DataTransaction();
        bus.applyAttrs({ origin_sam_id: 'S1' });
        assert.strictEqual(bus.origin_sam_id, '0', 'the bus path expects trans_sam_id');
    });

    it('takes the stop under either name', () => {
        const byId = new DataTransaction();
        byId.applyStationAttrs({ bus_stop_id: '45' });
        assert.strictEqual(byId.bus_stop_id, '45');

        const byCode = new DataTransaction();
        byCode.applyStationAttrs({ bus_stop_code: '46' });
        assert.strictEqual(byCode.bus_stop_id, '46');
    });

    it('puts half_progress_type in hpt and matches it case insensitively', () => {
        const trx = new DataTransaction();
        trx.applyStationAttrs({ HALF_PROGRESS_TYPE: '1' });
        assert.strictEqual(trx.hpt, '1');
        assert.strictEqual(trx.half_progress_type, null);
    });

    it('has 36 exact and 24 insensitive entries', () => {
        assert.strictEqual(Object.keys(DataTransaction.STATION_EXACT).length, 36);
        assert.strictEqual(Object.keys(DataTransaction.STATION_CI).length, 24);
    });
});
