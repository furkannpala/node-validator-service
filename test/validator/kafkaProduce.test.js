/* eslint-env mocha */
const assert = require('assert');
const { fakeConn, makeReq, makeRes, run } = require('../fakeConn');
const { installFakeKafka, resetKafka, sentPayload } = require('../fakeKafka');

const sendCfg = require('../../validator/controller/device').funcs.sendcfg;
const sendLog = require('../../validator/controller/device').funcs.sendlog;
const sendGps = require('../../validator/controller/gps').funcs.sendgps;
const sendData = require('../../validator/controller/transaction').funcs.senddata;

const BROKERS = { kk_bootstrap_servers: 'broker:9092' };

const CFG_BODY = '<ROOT><VALAPPCONF bus_id="34AA0001" sam_id="05100001" pcb_id="ab12cd"'
    + ' temperature="30.5" input_voltage="12.10" battery_voltage="3.70" station_type="1"/></ROOT>';

const LOG_BODY = '<LOG hostname="VAL01" source="app">'
    + '<DATA timestamp="20260818101500" type="1" scope="boot" desc="started"/></LOG>';

const GPS_BODY = '<ROOT><GPSDAT BUS_ID="34AA0001" DATE_TIME="20260818101500" LATITUDE="38.4"'
    + ' LONGITUDE="27.1" SPEED="42" ROUTECODE="00120" sam_id="05100001" main_event="1"/>'
    + '<CANDAT bus_id="34AA0002" date_time="20260818101600" latitude="38.5" longitude="27.2">'
    + '<VAL id="190" value="800"/></CANDAT></ROOT>';

const DATA_ATTRS = 'record_id="D0001" trans_seq_no="1" trans_flag="1" customer_flag="0"'
    + ' data_save_flag="0" station_type="1" transmit_cnt="1" bus_stop_code="45" alias_no="A1"'
    + ' card_no="01712340000001" date_time="20260818101500" usage_cnt="3" passenger_type="1"'
    + ' usage_amt="250" remained_amt="1000" stage="1" customer_cnt="1" dc_rate="0"'
    + ' old_route_code="0" approval_no="0" tc_code="0" rtc_code="0" travel_seq_no="1"'
    + ' ht_start_time="20260818080000" sam_id="05100001" old_amount="1250" old_date_time="0"'
    + ' old_sam_id="0" sam_seqno="9" qtick_used="000000" trans_sam_id="0"'
    + ' fare_file_version="1" travel_type="1" product_code="P1" latitude="38.4" longitude="27.1"';

/** mst_bus answers one row so senddata reaches the record loop. */
function dataConn(handler) {
    return fakeConn((sql, binds) => {
        if (/from mst_bus/i.test(sql)) return { rows: [{ COMP_CODE: 1 }], outBinds: {} };
        return handler ? handler(sql, binds) : undefined;
    });
}

describe('kafka produce', () => {
    let log;

    beforeEach(() => {
        resetKafka();
        log = installFakeKafka();
    });

    afterEach(resetKafka);

    describe('sendcfg', () => {
        it('produces nothing while the switch is off', async () => {
            const conn = fakeConn();
            await run(sendCfg, makeReq(conn, {}, CFG_BODY), makeRes());
            assert.strictEqual(log.records.length, 0);
        });

        it('sends one message per element, keyed by sam_id, on the configured topic', async () => {
            const conn = fakeConn();
            const req = makeReq(conn, {}, CFG_BODY);
            req.cfg = { ...BROKERS, sendcfg_use_kafka_producer: 'true', sendcfg_topic: 'cfg.topic' };
            await run(sendCfg, req, makeRes());

            assert.strictEqual(log.records.length, 1);
            assert.strictEqual(log.records[0].topic, 'cfg.topic');
            assert.strictEqual(log.records[0].messages[0].key, '05100001');
            const payload = sentPayload(log);
            assert.strictEqual(payload.bus_id, '34AA0001');
            // Java overwrote validator_id with pcb_id right after setting it, and pcb_id is
            // never null, so the raw attribute value is what travels.
            assert.strictEqual(payload.validator_id, 'ab12cd');
            assert.strictEqual(payload.pcb_id, 'ab12cd');
        });

        it('still produces on the kafka-only path, where Java wrote nothing', async () => {
            const conn = fakeConn();
            const req = makeReq(conn, {}, CFG_BODY);
            req.cfg = {
                ...BROKERS, sendcfg_use_kafka_producer: 'true', sendcfg_topic: 'cfg.topic',
                sendcfg_use_only_kafka_produce: 'true',
            };
            await run(sendCfg, req, makeRes());

            assert.strictEqual(log.records.length, 1);
            assert.strictEqual(conn.calls.length, 0, 'not even the validator status call runs');
        });

        it('swallows a producer failure unless the throw switch is on', async () => {
            resetKafka();
            log = installFakeKafka({ connectError: new Error('broker down') });
            const cfg = { ...BROKERS, sendcfg_use_kafka_producer: 'true', sendcfg_topic: 't' };

            const first = makeReq(fakeConn(), {}, CFG_BODY);
            first.cfg = cfg;
            assert.strictEqual(await run(sendCfg, first, makeRes()), undefined);

            const second = makeReq(fakeConn(), {}, CFG_BODY);
            second.cfg = { ...cfg, sendcfg_kafka_error_throw: 'true' };
            const err = await run(sendCfg, second, makeRes());
            assert.ok(err && err.code === -99999, 'expected the Java kafka error code');
            assert.ok(err.message.startsWith('Kakfka Error:'), err.message);
        });
    });

    describe('sendlog', () => {
        it('sends a message for every element, including the one with no entry', async () => {
            const conn = fakeConn();
            const req = makeReq(conn, { busid: '34AA0001' }, LOG_BODY);
            req.cfg = { ...BROKERS, sendlog_use_kafka_producer: 'true', sendlog_topic: 'log.topic' };
            await run(sendLog, req, makeRes());

            // LOG carries the host, DATA the entry; Java produced once per element either way.
            assert.strictEqual(log.records.length, 2);
            assert.strictEqual(log.records[0].messages[0].key, '34AA0001');
            const first = sentPayload(log, 0);
            assert.strictEqual(first.host_name, 'VAL01');
            assert.strictEqual(first.scope, undefined, 'the LOG element has no entry yet');
            // A Java int, so it is in the document even though nothing assigns it.
            assert.strictEqual(sentPayload(log, 1).device_type, 0);
            assert.strictEqual(sentPayload(log, 1).desc, 'started');
        });
    });

    describe('sendgps', () => {
        it('tags GPSDAT and CANDAT and keys them differently', async () => {
            const conn = fakeConn();
            const req = makeReq(conn, {}, GPS_BODY);
            req.cfg = { ...BROKERS, sendgps_use_kafka_producer: 'true', sendgps_topic: 'gps.topic' };
            await run(sendGps, req, makeRes());

            assert.strictEqual(log.records.length, 2);
            const gps = sentPayload(log, 0);
            assert.strictEqual(gps.dataType, 'GPSDAT');
            assert.strictEqual(gps.latitude, '38.4');
            assert.strictEqual(gps.route_code, '00120');
            assert.strictEqual(log.records[0].messages[0].key, '05100001', 'GPSDAT keys on sam_id');

            const can = sentPayload(log, 1);
            assert.strictEqual(can.dataType, 'CANDAT');
            assert.strictEqual(can.param_id, '190');
            assert.strictEqual(can.param_value, '800');
            assert.strictEqual(can.bus_id, '34AA0002');
            assert.strictEqual(log.records[1].messages[0].key, '34AA0002', 'CANDAT keys on bus_id');
            // Java reused the one GpsTransaction and overwrote six fields, so the rest of the
            // last GPSDAT element rides along in the CANDAT document.
            assert.strictEqual(can.speed, '42');
            assert.strictEqual(can.sam_id, '05100001');
        });

        it('produces a position whose clock is too far ahead to be stored', async () => {
            const body = '<ROOT><GPSDAT BUS_ID="34AA0001" DATE_TIME="29991231235959"'
                + ' sam_id="05100001"/></ROOT>';
            const conn = fakeConn();
            const req = makeReq(conn, {}, body);
            req.cfg = { ...BROKERS, sendgps_use_kafka_producer: 'true', sendgps_topic: 't' };
            await run(sendGps, req, makeRes());

            assert.strictEqual(log.records.length, 1);
            assert.strictEqual(conn.matching('INSERT INTO tms_gps').length, 0);
        });

        it('produces both elements while writing neither on the kafka-only path', async () => {
            const conn = fakeConn();
            const req = makeReq(conn, {}, GPS_BODY);
            req.cfg = {
                ...BROKERS, sendgps_use_kafka_producer: 'true', sendgps_topic: 't',
                sendgps_use_only_kafka_produce: 'true',
            };
            await run(sendGps, req, makeRes());

            assert.strictEqual(log.records.length, 2);
            assert.strictEqual(conn.calls.length, 0);
        });
    });

    describe('senddata', () => {
        const busReq = (conn, cfg) => {
            const req = makeReq(conn, { busid: '34AA0001', stationtype: '1', systemid: '017' },
                `<TD><DATA ${DATA_ATTRS}/></TD>`);
            req.cfg = { ...BROKERS, senddata_use_kafka_producer: 'true', senddata_topic: 'td.topic',
                ...cfg };
            return req;
        };

        it('sends the bus document with both latitude spellings and an empty EMV object', async () => {
            const conn = dataConn();
            await run(sendData, busReq(conn), makeRes());

            assert.strictEqual(log.records.length, 1);
            const payload = sentPayload(log);
            assert.strictEqual(payload.type, 'T');
            assert.strictEqual(payload.latitude, '38.4');
            assert.strictEqual(payload.LATITUDE, '38.4', 'Java assigned the merged value twice');
            assert.strictEqual(payload.LONGITUDE, '27.1');
            // The Java field is an object that is never null, so an element with no EMV child
            // still carries an (empty) one.
            assert.deepStrictEqual(payload.emvTransaction, {});
            // A Java primitive boolean, always present.
            assert.strictEqual(payload.offline_success_tap, false);
            // The raw attribute value: the currency division happens on the database side only.
            assert.strictEqual(payload.usage_amt, '250');
            assert.strictEqual(log.records[0].messages[0].key, '05100001');
        });

        it('fills emvTransaction when the element carries an EMV child', async () => {
            const conn = dataConn();
            const req = busReq(conn);
            req.rawBody = `<TD><DATA ${DATA_ATTRS}><EMV ptcn="PT1" bin="454671" amount="250"`
                + ' key_index="2"/></DATA></TD>';
            await run(sendData, req, makeRes());

            const emv = sentPayload(log).emvTransaction;
            assert.strictEqual(emv.ptcn, 'PT1');
            assert.strictEqual(emv.bin, '454671');
            assert.strictEqual(emv.emv_amount, '250');
            assert.strictEqual(emv.key_index, '2');
            // The rest were reset to "" for this element, which Gson emits.
            assert.strictEqual(emv.enc_pan, '');
        });

        it('sends the narrower station document', async () => {
            const conn = dataConn();
            const req = makeReq(conn, { busid: 'ST01', stationtype: '2', systemid: '017' },
                `<TD><DATA ${DATA_ATTRS} half_progress_type="1" path_code="PC1"/></TD>`);
            req.cfg = { ...BROKERS, senddata_use_kafka_producer: 'true', senddata_topic: 't' };
            await run(sendData, req, makeRes());

            const payload = sentPayload(log);
            assert.strictEqual(payload.half_progress_type, '1', 'the station path reads it as hpt');
            assert.strictEqual(payload.path_code, undefined, 'stations never send one');
            assert.strictEqual(payload.latitude, undefined);
            assert.strictEqual(payload.stage, undefined);
            assert.strictEqual(payload.type, 'T');
        });

        it('applies the Java per-element reset before building the message', async () => {
            const conn = dataConn();
            const req = busReq(conn);
            req.rawBody = `<TD><DATA ${DATA_ATTRS} qr_data="QR1" tap_id="T1" only_tap="0"/>`
                + `<DATA ${DATA_ATTRS}/></TD>`;
            await run(sendData, req, makeRes());

            assert.strictEqual(sentPayload(log, 0).qr_data, 'QR1');
            const second = sentPayload(log, 1);
            assert.strictEqual(second.qr_data, undefined, 'Java cleared qr_data per element');
            assert.strictEqual(second.tap_id, undefined);
            // card_no is not on the reset list, so it does carry over — as it did in Java.
            assert.strictEqual(second.card_no, '01712340000001');
        });

        it('keeps writing rows while the producer is on, and stops on the kafka-only path', async () => {
            const both = dataConn();
            await run(sendData, busReq(both), makeRes());
            assert.strictEqual(both.matching('INSERT INTO afc_td(').length, 1);

            const onlyKafka = dataConn();
            await run(sendData, busReq(onlyKafka, { senddata_use_only_kafka_produce: 'true' }),
                makeRes());
            assert.strictEqual(onlyKafka.matching('INSERT INTO afc_td(').length, 0);
            // The bus check still runs: Java kept a connection for senddata either way.
            assert.ok(onlyKafka.matching('from mst_bus').length >= 1);
            assert.strictEqual(log.records.length, 2);
        });

        it('uses the senddata broker list when one is set', async () => {
            const conn = dataConn();
            await run(sendData, busReq(conn, { kk_bootstrap_servers_senddata: 'td:9092' }), makeRes());
            assert.deepStrictEqual(log.clients[0].brokers, ['td:9092']);
        });
    });
});
