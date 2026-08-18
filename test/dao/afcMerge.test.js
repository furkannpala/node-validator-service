const assert = require('assert');
const { fakeConn } = require('../fakeConn');

const afcTf = require('../../validator/dao/oracle/AfcTfDaoImpl');
const afcTh = require('../../validator/dao/oracle/AfcThDaoImpl');
const afcStation = require('../../validator/dao/oracle/AfcStationDaoImpl');
const afcTfEvent = require('../../validator/dao/oracle/AfcTfEventDaoImpl');
const tmsValRoute = require('../../validator/dao/oracle/TmsValRouteDaoImpl');

/** A transaction with every field the senddata DAOs read, so nothing is undefined by accident. */
function fullTrx() {
    return {
        travel_seq_no: '1', sam_id: '05100001', validator_id: 'V1', bus_id: '34AA0001',
        compCode: 7, depot_code: 'D1', route_code: '00012', driver_code: 'DR1',
        travelType: '2', travel_type: '2', start_date_time: '20260818080000',
        boarding_date_time: '20260818101500', half_progress_type: '1', return_flag: '0',
        emergency_flag: '0', total_fuel_used: '100', old_route_code: '3', bus_stop_id: '45',
        totalStopCnt: '20', trip_stop_cnt: '5', odometerStart: 1000, odometer: '1200',
        pathCode: '000121', manual_trip_start_time: '20260818080500', alias_no: 'A1',
        sam_seq_no: '9', tfType: '1', trip_no: '3', stop_seq_no: 4,
    };
}

/** Runs one DAO method and returns { sql, binds } of the single statement it issued. */
async function capture(fn) {
    const conn = fakeConn();
    await fn(conn, fullTrx(), 'test');
    assert.strictEqual(conn.calls.length, 1, 'expected exactly one statement');
    return conn.calls[0];
}

const bindsIn = (sql) => [...new Set(sql.match(/:[a-z_][a-z0-9_]*/gi) || [])].map((b) => b.slice(1));

// [label, invocation]
const CALLS = [
    ['afcTf.insert', (c, t, s) => afcTf.insert(c, t, s)],
    ['afcTf.insertForStation', (c, t, s) => afcTf.insertForStation(c, t, s)],
    ['afcTf.updateTripEnd', (c, t, s) => afcTf.updateTripEnd(c, t, 1500, s)],
    ['afcTf.updateTripOpen', (c, t, s) => afcTf.updateTripOpen(c, t, 1000, s)],
    ['afcTf.updateTripTime', (c, t, s) => afcTf.updateTripTime(c, t, s)],
    ['afcTf.updateDriverChange', (c, t, s) => afcTf.updateDriverChange(c, t, s)],
    ['afcTh.insert', (c, t, s) => afcTh.insert(c, t, s)],
    ['afcTh.merge', (c, t, s) => afcTh.merge(c, t, s)],
    ['afcStation.insert', (c, t, s) => afcStation.insert(c, t, s)],
    ['afcStation.merge', (c, t, s) => afcStation.merge(c, t, s)],
    ['afcTfEvent.insert', (c, t, s) => afcTfEvent.insert(c, t, s)],
    ['afcTfEvent.insertForStation', (c, t, s) => afcTfEvent.insertForStation(c, t, s)],
    ['tmsValRoute.insertFromData', (c, t, s) => tmsValRoute.insertFromData(c, t, s)],
    ['tmsValRoute.updateLeavingFromData', (c, t, s) => tmsValRoute.updateLeavingFromData(c, t, '9', s)],
];

describe('senddata write statements', () => {
    for (const [label, invoke] of CALLS) {
        it(`${label} supplies every bind it references`, async () => {
            const { sql, binds } = await capture(invoke);
            const missing = bindsIn(sql).filter((name) => !(name in binds));
            assert.deepStrictEqual(missing, [], `${label}: unbound is ORA-01008 at runtime`);
        });
    }

    it('never leaves a bind undefined, which the driver rejects', async () => {
        for (const [label, invoke] of CALLS) {
            const { binds } = await capture(invoke);
            const undef = Object.entries(binds).filter(([, v]) => v === undefined).map(([k]) => k);
            assert.deepStrictEqual(undef, [], `${label} has undefined binds`);
        }
    });

    describe('ORA-38104: an ON column may not be assigned in SET', () => {
        const MERGES = [
            ['afc_tf trip end', afcTf.mergeTripEndSql],
            ['afc_tf trip open', afcTf.mergeTripOpenSql],
            ['afc_tf trip time', afcTf.mergeTripTimeSql],
            ['afc_tf driver change', afcTf.mergeDriverChangeSql],
            ['afc_th', afcTh.mergeSql],
            ['afc_station', afcStation.mergeSql],
        ];

        for (const [label, sql] of MERGES) {
            it(label, () => {
                const on = sql.slice(sql.indexOf(' ON ('), sql.indexOf('WHEN MATCHED'));
                const set = sql.slice(sql.indexOf('UPDATE SET ') + 11, sql.indexOf('WHEN NOT MATCHED'));

                const onCols = [...new Set((on.match(/t\.(\w+)\s*=/g) || [])
                    .map((m) => m.replace(/t\.|\s|=/g, '').toLowerCase()))];
                const setCols = (set.match(/(^|,)\s*(\w+)\s*=/g) || [])
                    .map((m) => m.replace(/[,\s=]/g, '').toLowerCase());

                assert.ok(onCols.length > 0, `${label}: no ON columns found`);
                const clash = onCols.filter((c) => setCols.includes(c));
                assert.deepStrictEqual(clash, [], `${label}: ${clash.join(',')} is in both ON and SET`);
            });
        }

        it('matches on the same key the Java UPDATE did', () => {
            // The driver change UPDATE had no travel_seq_no in its WHERE, so its MERGE must not
            // add one, or it would stop matching rows the Java statement hit.
            assert.ok(!afcTf.mergeDriverChangeSql.includes('t.travel_seq_no'),
                afcTf.mergeDriverChangeSql);
            assert.ok(afcTf.mergeTripEndSql.includes('t.travel_seq_no=s.travel_seq_no'));
        });
    });

    it('keeps the two afc_tf_event column sets apart', () => {
        assert.ok(afcTfEvent.insertSql.includes('total_fuel_used_start'), 'bus path');
        assert.ok(!afcTfEvent.insertSql.includes('sam_seq_no_start'));
        assert.ok(afcTfEvent.insertStationSql.includes('sam_seq_no_start'), 'station path');
        assert.ok(!afcTfEvent.insertStationSql.includes('total_fuel_used_start'));
    });

    it('checkLeavingDateTime asks for all seven key columns', async () => {
        const conn = fakeConn();
        await tmsValRoute.checkLeavingDateTime(conn, fullTrx(), '9', 'test');
        const { sql, binds } = conn.calls[0];
        assert.deepStrictEqual(bindsIn(sql).sort(), Object.keys(binds).sort());
        assert.strictEqual(Object.keys(binds).length, 7);
    });
});
