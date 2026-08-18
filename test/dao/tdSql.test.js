const assert = require('assert');
const { columnsFor, buildInsert, bindFor } = require('../../validator/dao/oracle/tdSql');

/**
 * The 40 columns Java's insertColumns string carries, transcribed from
 * daoImpl/AfcTdDaoImpl.java. All three tables share this prefix. If a column is ever inserted
 * in the middle of this list the values silently land one column over, so it is spelled out.
 */
const BASE = [
    'TRANS_SEQ_NO', 'TRANS_FLAG', 'CUSTOMER_FLAG', 'DATA_SAVE_FLAG', 'STATION_TYPE', 'TRANSMIT_CNT',
    'BUS_STOP_ID', 'ALIAS_NO', 'CARD_NO', 'BOARDING_DATE_TIME', 'USAGE_CNT', 'PASSENGER_TYPE',
    'USAGE_AMT', 'REMAINED_AMT', 'STAGE', 'CUSTOMER_CNT', 'DC_RATE', 'OLD_ROUTE_CODE', 'APPROVAL_NO',
    'TC_CODE', 'RTC_CODE', 'TRAVEL_SEQ_NO', 'START_DATE_TIME', 'SAM_ID', 'OLD_AMT', 'OLD_DATE_TIME',
    'OLD_SAM_ID', 'PDATE', 'SAM_SEQ_NO', 'QTICK_USED', 'ORIGIN_SAM_ID', 'TF_ID', 'RIDER',
    'TARIFF_NUMBER', 'RDATE', 'LAT', 'LNG', 'SERVICE_CHARGE', 'FARE_FILE_VERSION', 'TRAVEL_TYPE',
];

const TD_TAIL = ['TRANSFER_REF_CODE', 'PRODUCT_CODE'];

// table -> options -> the exact column list of the Java method it replaces.
const VARIANTS = [
    ['afc_td', {}, [...BASE, ...TD_TAIL], 'insert'],
    ['afc_td', { qrData: true }, [...BASE, 'QR_DATA', ...TD_TAIL], 'insertWithQrData'],
    ['afc_td', { originSystemId: true }, [...BASE, 'origin_system_id', ...TD_TAIL],
        'insertWithOriginSystemId'],
    ['afc_td', { originSystemId: true, qrData: true },
        [...BASE, 'origin_system_id', 'QR_DATA', ...TD_TAIL], 'insertWithOriginSystemIdAndQrData'],
    ['afc_td', { extendedFare: true }, [...BASE, 'EXTENDED_FARE', ...TD_TAIL], 'insertWithExtendedFare'],
    ['afc_td', { extendedFare: true, qrData: true },
        [...BASE, 'EXTENDED_FARE', 'QR_DATA', ...TD_TAIL], 'insertWithExtendedFareAndQrData'],
    ['afc_td', { extendedFare: true, originSystemId: true },
        [...BASE, 'EXTENDED_FARE', 'origin_system_id', ...TD_TAIL], 'insertWithExtendedFareAndOriginSystemId'],
    ['afc_td', { extendedFare: true, originSystemId: true, qrData: true },
        [...BASE, 'EXTENDED_FARE', 'origin_system_id', 'QR_DATA', ...TD_TAIL],
        'insertWithExtendedFareAndOriginSystemIdAndQrData'],

    ['afc_bl_td', {}, [...BASE, 'PRODUCT_CODE'], 'insert'],
    ['afc_bl_td', { qrData: true }, [...BASE, 'PRODUCT_CODE', 'QR_DATA'], 'insertWithQrData'],
    ['afc_bl_td', { extendedFare: true }, [...BASE, 'PRODUCT_CODE', 'EXTENDED_FARE'],
        'insertWithExtendedFare'],
    ['afc_bl_td', { extendedFare: true, qrData: true },
        [...BASE, 'PRODUCT_CODE', 'EXTENDED_FARE', 'QR_DATA'], 'insertWithExtendedFareAndQrData'],

    ['afc_td_test', {}, [...BASE, 'PRODUCT_CODE'], 'insert'],
    ['afc_td_test', { qrData: true }, [...BASE, 'PRODUCT_CODE', 'QR_DATA'], 'insertWithQrData'],
    ['afc_td_test', { extendedFare: true }, [...BASE, 'PRODUCT_CODE', 'EXTENDED_FARE'],
        'insertWithExtendedFare'],
    ['afc_td_test', { extendedFare: true, qrData: true },
        [...BASE, 'PRODUCT_CODE', 'EXTENDED_FARE', 'QR_DATA'], 'insertWithExtendedFareAndQrData'],
];

// The three side tables of ins_data stop at TF_ID and take no optionals at all.
const SHORT = [...BASE.slice(0, BASE.indexOf('TF_ID') + 1), 'PRODUCT_CODE'];
const SHORT_TABLES = ['afc_td_nonverified', 'afc_checkin_td', 'afc_topup_td'];

/** Every :name occurrence in the generated statement, duplicates removed. */
function bindsIn(sql) {
    return [...new Set(sql.match(/:[a-z_][a-z0-9_]*/gi) || [])].map((b) => b.slice(1));
}

describe('td insert builder', () => {
    it('covers all 16 Java variants', () => {
        assert.strictEqual(VARIANTS.length, 16);
    });

    for (const [table, options, expected, javaMethod] of VARIANTS) {
        it(`${table}.${javaMethod} keeps the Java column order`, () => {
            const columns = columnsFor(table, options).map((pair) => pair[0]);
            assert.deepStrictEqual(columns, expected);
        });
    }

    it('emits one value expression per column, in the same order', () => {
        for (const [table, options] of VARIANTS) {
            const pairs = columnsFor(table, options);
            const sql = buildInsert(table, options);
            const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(') VALUES(')).split(',');
            const values = sql.slice(sql.indexOf(') VALUES(') + 9, -1);

            assert.strictEqual(cols.length, pairs.length, `${table} column count`);
            // Splitting on commas would break the function calls, so compare the joined text.
            assert.strictEqual(values, pairs.map((p) => p[1]).join(','), `${table} value order`);
        }
    });

    it('binds every placeholder it emits and nothing more', () => {
        const trx = { tfType: '1', usageAmt: 0, remainedAmt: 0, customerCnt: 0, oldAmt: 0, lat: 0, lng: 0 };
        for (const [table, options, , javaMethod] of VARIANTS) {
            const sql = buildInsert(table, options);
            const provided = Object.keys(bindFor(table, trx, options)).sort();
            assert.deepStrictEqual(bindsIn(sql).sort(), provided,
                `${table}.${javaMethod}: a missing bind is ORA-01008 at runtime`);
        }
    });

    it('reuses start_date_time and sam_id for the tf_id and rdate expressions', () => {
        const sql = buildInsert('afc_td', {});
        assert.ok(sql.includes('pk_app_val.fn_get_tf_id(:start_date_time,:sam_id,:tf_type)'), sql);
        assert.ok(sql.includes('pk_config.fn_get_operation_date(:start_date_time)'), sql);
        assert.ok(sql.includes('pk_config.fn_get_operation_pdate()'), sql);
    });

    for (const table of SHORT_TABLES) {
        it(`${table} stops at TF_ID and ends with PRODUCT_CODE`, () => {
            assert.deepStrictEqual(columnsFor(table, {}).map((p) => p[0]), SHORT);
        });
    }

    it('ignores an optional on the short tables, binds included', () => {
        const trx = { tfType: '1', qr_data: 'x', extendedFare: 5 };
        const sql = buildInsert('afc_td_nonverified', { qrData: true, extendedFare: true });
        assert.ok(!sql.includes('QR_DATA'), sql);
        assert.deepStrictEqual(
            bindsIn(sql).sort(),
            Object.keys(bindFor('afc_td_nonverified', trx, { qrData: true, extendedFare: true })).sort());
    });

    it('rejects an optional the table does not have', () => {
        // AFC_BL_TD has no origin_system_id variant in Java; asking for one must not add it.
        const columns = columnsFor('afc_bl_td', { originSystemId: true }).map((p) => p[0]);
        assert.ok(!columns.includes('origin_system_id'), columns.join(','));
    });
});
