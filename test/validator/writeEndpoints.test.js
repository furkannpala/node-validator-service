const assert = require('assert');
const { fakeConn, makeReq, makeRes, run, oracleError } = require('../fakeConn');

const sendCfg = require('../../validator/controller/device').funcs.sendcfg;
const sendLog = require('../../validator/controller/device').funcs.sendlog;
const sendGps = require('../../validator/controller/gps').funcs.sendgps;
const sendCan = require('../../validator/controller/device').funcs.sendcan;
const sendAlarm = require('../../validator/controller/device').funcs.sendalarm;
const onlineGps = require('../../validator/controller/gps').funcs.onlinegps;
const wlanStatus = require('../../validator/controller/device').funcs.wlanstatus;
const readMessage = require('../../validator/controller/message').funcs.readmessage;
const setDriverPassword = require('../../validator/controller/driver').funcs.setdriverpassword;
const verifyDriver = require('../../validator/controller/driver').funcs.verifydriver;

const CFG_BODY = '<ROOT><VALAPPCONF bus_id="34AA0001" sam_id="05100001" pcb_id="ab12cd"'
    + ' temperature="30.5" input_voltage="12.10" battery_voltage="3.70" station_type="1"/></ROOT>';

describe('sendcfg', () => {
    it('writes the config row and its health reading in one transaction', async () => {
        const conn = fakeConn();
        const err = await run(sendCfg, makeReq(conn, { busid: '34AA0001' }, CFG_BODY), makeRes());

        assert.strictEqual(err, undefined);
        assert.strictEqual(conn.matching('MERGE INTO tbl_device_cfg').length, 1);
        assert.strictEqual(conn.matching('INSERT INTO tbl_device_health').length, 1);
        assert.strictEqual(conn.commits, 1, 'both statements share one commit');
    });

    it('uppercases pcb_id into VALIDATOR_ID', async () => {
        const conn = fakeConn();
        await run(sendCfg, makeReq(conn, {}, CFG_BODY), makeRes());
        assert.strictEqual(conn.matching('MERGE INTO tbl_device_cfg')[0].binds.validator_id, 'AB12CD');
    });

    it('keeps attributes a later element leaves out', async () => {
        const body = '<ROOT><C bus_id="34AA0001" sam_id="05100001" pcb_id="a1"'
            + ' input_voltage="12" battery_voltage="3"/><C bus_id="34AA0002"/></ROOT>';
        const conn = fakeConn();
        await run(sendCfg, makeReq(conn, {}, body), makeRes());

        const merges = conn.matching('MERGE INTO tbl_device_cfg');
        assert.strictEqual(merges.length, 2);
        assert.strictEqual(merges[1].binds.device_id, '34AA0002');
        assert.strictEqual(merges[1].binds.sam_id, '05100001', 'sam_id carries over, as in Java');
    });

    it('drops a duplicate row without failing the request', async () => {
        const conn = fakeConn((sql) => (sql.includes('MERGE INTO tbl_device_cfg') ? oracleError(1) : undefined));
        const err = await run(sendCfg, makeReq(conn, {}, CFG_BODY), makeRes());

        assert.strictEqual(err, undefined);
        assert.strictEqual(conn.rollbacks, 1);
        assert.strictEqual(conn.commits, 0);
    });

    it('skips every statement on the kafka-only path', async () => {
        const conn = fakeConn();
        const req = makeReq(conn, {}, CFG_BODY);
        req.cfg = { sendcfg_use_only_kafka_produce: 'true' };
        await run(sendCfg, req, makeRes());

        assert.strictEqual(conn.calls.length, 0, 'not even the validator status call runs');
    });
});

describe('sendlog', () => {
    const body = '<LOG hostname="VAL01" source="app">'
        + '<DATA timestamp="20260818101500" type="1" scope="boot" desc="started"/>'
        + '<DATA timestamp="20260818101600" type="2" scope="net" desc="up"/></LOG>';

    it('inserts one row per DATA element, each with its own commit', async () => {
        const conn = fakeConn();
        const err = await run(sendLog, makeReq(conn, { busid: '34AA0001' }, body), makeRes());

        assert.strictEqual(err, undefined);
        const inserts = conn.matching('INSERT INTO tbl_device_log');
        assert.strictEqual(inserts.length, 2);
        assert.strictEqual(conn.commits, 2, 'the boundary is one record, not one request');
    });

    it('stores the hostname in SAM_ID and the query busid in DEVICE_ID', async () => {
        const conn = fakeConn();
        await run(sendLog, makeReq(conn, { busid: '34AA0001' }, body), makeRes());

        const first = conn.matching('INSERT INTO tbl_device_log')[0].binds;
        assert.strictEqual(first.sam_id, 'VAL01');
        assert.strictEqual(first.device_id, '34AA0001');
        assert.strictEqual(first.description, 'started');
    });

    it('keeps the good entries when one of them is rejected', async () => {
        let seen = 0;
        const conn = fakeConn((sql) => {
            if (!sql.includes('INSERT INTO tbl_device_log')) return undefined;
            seen++;
            return seen === 1 ? oracleError(1) : undefined;
        });
        const err = await run(sendLog, makeReq(conn, { busid: '34AA0001' }, body), makeRes());

        assert.strictEqual(err, undefined);
        assert.strictEqual(conn.rollbacks, 1);
        assert.strictEqual(conn.commits, 1, 'the second entry still lands');
    });
});

describe('sendgps', () => {
    const gpsdat = (attrs) => `<GPSDATA><GPSDAT ${attrs}/></GPSDATA>`;

    it('writes the position and the stop counters in one transaction', async () => {
        const conn = fakeConn();
        const body = gpsdat('BUS_ID="34AA0001" DATE_TIME="20200101120000" LATITUDE="37.0" LONGITUDE="37.4" '
            + 'ROUTECODE="12" DIRECTION="1" MAIN_EVENT="7" SUB_EVENT="8" SAM_ID="05100001"');
        const err = await run(sendGps, makeReq(conn, {}, body), makeRes());

        assert.strictEqual(err, undefined);
        assert.strictEqual(conn.matching('INSERT INTO tms_gps').length, 1);
        assert.strictEqual(conn.matching('INSERT INTO TMS_APC_EVENT').length, 1);
        assert.strictEqual(conn.matching('INSERT INTO TMS_APC(').length, 1);
        assert.strictEqual(conn.commits, 1);
    });

    it('routes sub events 17 and 18 to the door table instead', async () => {
        const conn = fakeConn();
        await run(sendGps, makeReq(conn, {}, gpsdat('BUS_ID="1" DATE_TIME="20200101120000" '
            + 'MAIN_EVENT="7" SUB_EVENT="17"')), makeRes());

        assert.strictEqual(conn.matching('INSERT INTO TMS_DOOR_STATUS').length, 1);
        assert.strictEqual(conn.matching('INSERT INTO TMS_APC(').length, 0);
    });

    it('drops a position dated more than twelve hours ahead', async () => {
        const conn = fakeConn();
        await run(sendGps, makeReq(conn, {}, gpsdat('BUS_ID="1" DATE_TIME="29990101120000"')), makeRes());
        assert.strictEqual(conn.matching('INSERT INTO tms_gps').length, 0);
    });

    it('pads the route code to five characters and caps the speed', async () => {
        const conn = fakeConn();
        await run(sendGps, makeReq(conn, {}, gpsdat('BUS_ID="1" DATE_TIME="20200101120000" '
            + 'ROUTECODE="12" DIRECTION="1" SPEED="2000"')), makeRes());

        const binds = conn.matching('INSERT INTO tms_gps')[0].binds;
        assert.strictEqual(binds.route_code, '00012');
        assert.strictEqual(binds.speed, 999);
        assert.strictEqual(binds.path_code, '000121', 'path code falls back to route code plus direction');
    });

    it('zeroes hdop, svcount and utctime together when one of them is unreadable', async () => {
        const conn = fakeConn();
        await run(sendGps, makeReq(conn, {}, gpsdat('BUS_ID="1" DATE_TIME="20200101120000" '
            + 'HDOP="x" SVCOUNT="5" UTCTIME="120000"')), makeRes());

        const binds = conn.matching('INSERT INTO tms_gps')[0].binds;
        assert.deepStrictEqual([binds.hdop, binds.svcount, binds.utctime], [0, 0, 0]);
    });

    it('writes one can_data row per VAL element under CANDAT', async () => {
        const conn = fakeConn();
        const body = '<GPSDATA><CANDAT BUS_ID="34AA0001" DATE_TIME="20200101120000" LATITUDE="bad">'
            + '<VAL ID="190" VALUE="800"/><VAL ID="84" VALUE="42"/></CANDAT></GPSDATA>';
        await run(sendGps, makeReq(conn, {}, body), makeRes());

        const inserts = conn.matching('INSERT INTO can_data');
        assert.strictEqual(inserts.length, 2);
        assert.strictEqual(inserts[0].binds.lat, '0.0', 'an unparsable latitude becomes 0.0');
        assert.strictEqual(inserts[1].binds.param_id, '84');
        assert.strictEqual(conn.commits, 2);
    });
});

describe('sendcan', () => {
    const body = '<CAN HOSTNAME="05100001" CREATEDATETIME="20260818101500">'
        + '<DATA total_vehicle_distance="1" accelerator_position="2" engine_load="3" instant_fuel_rate="4"'
        + ' instant_fuel_economy="5" manifold_temperature="6" engine_boost_pressure="7" vehicle_speed="8"'
        + ' fuel_level="9" battery_voltage="10" engine_temperature="11" engine_oil_level="12"'
        + ' engine_oil_pressure="13" engine_hour="14" rpm="15"/></CAN>';

    it('inserts the measurement set', async () => {
        const conn = fakeConn();
        const err = await run(sendCan, makeReq(conn, {}, body), makeRes());

        assert.strictEqual(err, undefined);
        const inserts = conn.matching('INSERT INTO afc_can');
        assert.strictEqual(inserts.length, 1);
        assert.strictEqual(inserts[0].binds.hostname, '05100001');
        assert.strictEqual(inserts[0].binds.rpm, 15);
    });

    it('still answers OK when a measurement is missing, as the empty catch did', async () => {
        const conn = fakeConn();
        const err = await run(sendCan, makeReq(conn, {}, '<CAN HOSTNAME="x"><DATA rpm="1"/></CAN>'), makeRes());

        assert.strictEqual(err, undefined);
        assert.strictEqual(conn.matching('INSERT INTO afc_can').length, 0);
    });
});

describe('sendalarm', () => {
    const body = '<ALARM><DATA bus_id="34AA0001" sam_id="05100001" button_no="5" route_code="00012"'
        + ' half_progress_type="1" latitude="37.0" longitude="37.4" date_time="20260818101500"/></ALARM>';

    it('inserts the alarm and builds the path code from route and direction', async () => {
        const conn = fakeConn();
        const err = await run(sendAlarm, makeReq(conn, {}, body), makeRes('017'));

        assert.strictEqual(err, undefined);
        const inserts = conn.matching('INSERT INTO afc_alarm');
        assert.strictEqual(inserts.length, 1);
        assert.strictEqual(inserts[0].binds.path_code, '000121');
        assert.strictEqual(conn.commits, 1);
    });

    it('never reaches the confirmation procedure outside system 107', async () => {
        const conn = fakeConn();
        await run(sendAlarm, makeReq(conn, { remoteipaddr: '10.0.0.9' }, body), makeRes('017'));
        assert.strictEqual(conn.matching('sp_alarm_take_confirmation').length, 0);
    });

    it('marks the message read for button 12', async () => {
        const twelve = body.replace('button_no="5"', 'button_no="12"').replace('/>', ' driver_code="D1" description="77"/>');
        const conn = fakeConn();
        await run(sendAlarm, makeReq(conn, {}, twelve), makeRes('017'));

        const updates = conn.matching('UPDATE GUI_MESSAGE_LOG');
        assert.strictEqual(updates.length, 1);
        assert.strictEqual(updates[0].binds.message_id, '77');
        assert.strictEqual(updates[0].binds.reader_id, 'D1');
    });
});

describe('onlinegps', () => {
    const gpsdat = (attrs) => `<ONLINE><GPSDAT ${attrs}/></ONLINE>`;

    it('opens the stop visit on travel type 8 and strips leading zeros', async () => {
        const conn = fakeConn();
        const err = await run(onlineGps, makeReq(conn, {}, gpsdat('BUS_ID="34AA0001" ROUTE_CODE="00012" '
            + 'BUS_STOP_ID="000045" HALF_PROGRESS_TYPE="01" TRAVEL_TYPE="08" TF_SEQ="007" '
            + 'DATE_TIME="20260818101500" TF_START_DATE="20260818080000" SAM_ID="05100001"')), makeRes());

        assert.strictEqual(err, undefined);
        const inserts = conn.matching('INSERT INTO tms_val_route');
        assert.strictEqual(inserts.length, 1);
        assert.strictEqual(inserts[0].binds.route_code, '12');
        assert.strictEqual(inserts[0].binds.bus_stop_id, '45');
        assert.strictEqual(inserts[0].binds.travel_seq_no, '7');
    });

    it('closes it on travel type 9', async () => {
        const conn = fakeConn();
        await run(onlineGps, makeReq(conn, {}, gpsdat('BUS_ID="1" ROUTE_CODE="12" BUS_STOP_ID="45" '
            + 'HALF_PROGRESS_TYPE="1" TRAVEL_TYPE="9" TF_SEQ="7" DATE_TIME="20260818101500" '
            + 'TF_START_DATE="20260818080000" SAM_ID="05100001"')), makeRes());

        assert.strictEqual(conn.matching('UPDATE tms_val_route').length, 1);
        assert.strictEqual(conn.matching('INSERT INTO tms_val_route').length, 0);
    });

    it('fails the request when a numeric field is not a number, as cutZero did', async () => {
        const conn = fakeConn();
        const err = await run(onlineGps, makeReq(conn, {}, gpsdat('BUS_ID="1" ROUTE_CODE="AB"')), makeRes());
        assert.strictEqual(err.code, -8);
    });
});

describe('wlanstatus', () => {
    it('calls the procedure once per WLAN element', async () => {
        const conn = fakeConn();
        const body = '<W><WLAN bus_id="34AA0001" sam_id="05100001" gprs_ip="10.0.0.1" wlan_ip="10.0.1.1"'
            + ' wlan_status="1"/></W>';
        const err = await run(wlanStatus, makeReq(conn, {}, body), makeRes());

        assert.strictEqual(err, undefined);
        const calls = conn.matching('sp_setdevice_wlan_status');
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].binds.wlanip, '10.0.1.1');
        assert.strictEqual(conn.commits, 1);
    });
});

describe('readmessage', () => {
    it('stamps the read time for one bus and message', async () => {
        const conn = fakeConn();
        const err = await run(readMessage, makeReq(conn, { busid: '34AA0001', messageid: '77' }), makeRes());

        assert.strictEqual(err, undefined);
        const updates = conn.matching('UPDATE GUI_MESSAGE_LOG');
        assert.strictEqual(updates.length, 1);
        assert.deepStrictEqual(updates[0].binds, { bus_id: '34AA0001', message_id: '77' });
    });
});

describe('setdriverpassword', () => {
    const query = { busid: '34AA0001', driverid: 'D1', pass: 'x' };

    it('answers OK when the procedure returns 0', async () => {
        const conn = fakeConn((sql) => (sql.includes('sp_set_driver_password')
            ? { outBinds: { retval: 0 } } : undefined));
        const err = await run(setDriverPassword, makeReq(conn, query), makeRes());

        assert.strictEqual(err, undefined);
        assert.strictEqual(conn.commits, 1);
    });

    it('reports the procedure code verbatim when it is not 0', async () => {
        const conn = fakeConn((sql) => (sql.includes('sp_set_driver_password')
            ? { outBinds: { retval: 5 } } : undefined));
        const err = await run(setDriverPassword, makeReq(conn, query), makeRes());

        assert.strictEqual(err.code, -8);
        assert.ok(err.message.includes(' Error Code 5'), err.message);
    });
});

describe('verifydriver', () => {
    const query = { busid: '34AA0001', samid: '05100001', driverid: 'D1' };
    // SHA-1 of "D1" + "1234", which is what the device is expected to send.
    const goodPass = require('crypto').createHash('sha1').update('D11234', 'utf8').digest('hex');

    const pinRow = (rows, openSession) => (sql) => {
        if (sql.includes('MST_PERSONEL')) return { rows, outBinds: {} };
        if (sql.includes('AFC_TH')) return { rows: openSession ? [[1]] : [], outBinds: {} };
        return undefined;
    };

    it('accepts a matching pin', async () => {
        const conn = fakeConn(pinRow([{ PIN: '1234' }], false));
        const err = await run(verifyDriver, makeReq(conn, { ...query, pass: goodPass }), makeRes());
        assert.strictEqual(err, undefined);
    });

    it('answers -55 when the driver is unknown', async () => {
        const conn = fakeConn(pinRow([], false));
        const err = await run(verifyDriver, makeReq(conn, { ...query, pass: goodPass }), makeRes());
        assert.strictEqual(err.code, -55);
    });

    it('answers -2001 when another bus still holds the shift', async () => {
        const conn = fakeConn(pinRow([{ PIN: '1234' }], true));
        const err = await run(verifyDriver, makeReq(conn, { ...query, pass: goodPass }), makeRes());
        assert.strictEqual(err.code, -2001);
    });

    it('answers -56 on a wrong pin', async () => {
        const conn = fakeConn(pinRow([{ PIN: '9999' }], false));
        const err = await run(verifyDriver, makeReq(conn, { ...query, pass: goodPass }), makeRes());
        assert.strictEqual(err.code, -56);
    });

    it('turns a database failure into -57', async () => {
        const conn = fakeConn((sql) => (sql.includes('MST_PERSONEL') ? oracleError(942) : undefined));
        const err = await run(verifyDriver, makeReq(conn, { ...query, pass: goodPass }), makeRes());
        assert.strictEqual(err.code, -57);
    });

    it('joins MST_BUS only when verify_driver_comp is on', async () => {
        const conn = fakeConn(pinRow([{ PIN: '1234' }], false));
        const req = makeReq(conn, { ...query, pass: goodPass });
        req.cfg = { verify_driver_comp: true };
        await run(verifyDriver, req, makeRes());

        assert.strictEqual(conn.matching('MST_BUS').length, 1);
    });
});

describe('sendcfg health duplicate', () => {
    it('keeps the config change when only the health row is a duplicate', async () => {
        // Java committed the config row before the health insert and caught the duplicate on
        // its own, so a body that carries the same device twice still records the change.
        // Rolling the merge back with it lost a config update; the write comparison caught it.
        const body = '<ROOT><VALAPPCONF bus_id="34AA0001" sam_id="05100001" pcb_id="a1"'
            + ' input_voltage="12" battery_voltage="3"/>'
            + '<VALAPPCONF bus_id="34AA0001" route_code="00200"/></ROOT>';
        const conn = fakeConn((sql) =>
            (sql.includes('INSERT INTO tbl_device_health') ? oracleError(1) : undefined));

        const err = await run(sendCfg, makeReq(conn, {}, body), makeRes());

        assert.strictEqual(err, undefined);
        const merges = conn.matching('MERGE INTO tbl_device_cfg');
        assert.strictEqual(merges.length, 2);
        assert.strictEqual(merges[1].binds.route_code, '00200');
        assert.strictEqual(conn.rollbacks, 0, 'a duplicate health row must not undo the merge');
        assert.strictEqual(conn.commits, 2);
    });
});
