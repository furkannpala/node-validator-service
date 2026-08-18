/* eslint-env mocha */
const assert = require('assert');
const { fakeConn, makeReq, makeRes, run } = require('../fakeConn');

const getCardInfo = require('../../validator/controller/getCardInfo');
const getUnCalculated = require('../../validator/controller/getUnCalculatedTransaction');
const updateUnCalculated = require('../../validator/controller/updateUnCalculatedTransaction');

const CARD_ROW = {
    CARD_NO: '6372430000000001', ALIAS_NO: 'A1', REGISTERED: '0',
    PASSENGER_TYPE: '01', USAGE_CNT: 5,
};

const FARE_ROW = {
    PDATE: '18.08.2026', BOARDING_DATE_TIME: '20260818101500', CARD_NO: '6372430000000001',
    SAM_ID: '05100001', USAGE_CNT: 3, PASSENGER_TYPE: '01', CARD_TYPE: '09',
    ROUTE_CODE: '100', HOST_PASSENGER_TYPE: '02',
};

describe('getcardinfo', () => {
    it('answers with the card row', async () => {
        const conn = fakeConn(() => ({ rows: [CARD_ROW] }));
        const res = makeRes();
        const err = await run(getCardInfo, makeReq(conn, { card_no: CARD_ROW.CARD_NO }), res);

        assert.strictEqual(err, undefined);
        assert.ok(res.locals.data.includes('CARD_NO="6372430000000001"'));
        assert.ok(res.locals.data.includes('IS_SUCCEED="1"'));
        assert.ok(res.locals.data.includes('USAGE_CNT="5"'));
    });

    it('reports an unknown card as succeeded with empty fields, as Java did', async () => {
        const conn = fakeConn(() => ({ rows: [] }));
        const res = makeRes();
        await run(getCardInfo, makeReq(conn, { card_no: '999' }), res);

        assert.ok(res.locals.data.includes('CARD_NO="999"'));
        assert.ok(res.locals.data.includes('IS_SUCCEED="1"'), 'a missing card is not a failure');
        assert.ok(res.locals.data.includes('ALIAS_NO=""'));
    });

    it('turns a failed query into IS_SUCCEED 0 rather than an error reply', async () => {
        const conn = fakeConn(() => new Error('ORA-00942: table or view does not exist'));
        const res = makeRes();
        const err = await run(getCardInfo, makeReq(conn, { card_no: '999' }), res);

        assert.strictEqual(err, undefined, 'the device still gets 200 and a document');
        assert.ok(res.locals.data.includes('IS_SUCCEED="0"'));
    });

    it('writes a null column as an empty attribute', async () => {
        const conn = fakeConn(() => ({ rows: [{ ...CARD_ROW, ALIAS_NO: null }] }));
        const res = makeRes();
        await run(getCardInfo, makeReq(conn, { card_no: CARD_ROW.CARD_NO }), res);
        assert.ok(res.locals.data.includes('ALIAS_NO=""'));
    });
});

describe('getuncalculatedtransaction', () => {
    const answer = (types, rows) => (sql) => {
        if (sql.includes('tbl_fare_config')) return { rows: types.map((t) => [t]) };
        if (sql.includes('FROM AFC_TD A')) return { rows };
        return undefined;
    };

    it('emits one FARE element per uncalculated tap', async () => {
        const conn = fakeConn(answer(['09'], [FARE_ROW]));
        const res = makeRes();
        const err = await run(getUnCalculated, makeReq(conn, {}), res);

        assert.strictEqual(err, undefined);
        assert.ok(res.locals.data.includes('system_id="001"'), 'the system id is hard coded');
        assert.ok(res.locals.data.includes('card_no="6372430000000001"'));
        assert.ok(res.locals.data.includes('route_code="100"'));
    });

    it('runs no query for a card type that has none', async () => {
        const conn = fakeConn(answer(['11'], [FARE_ROW]));
        const res = makeRes();
        await run(getUnCalculated, makeReq(conn, {}), res);

        assert.strictEqual(conn.matching('FROM AFC_TD A').length, 0);
        assert.ok(res.locals.data.includes('ROOT'));
    });

    it('keeps the literal "null" Java wrote for an empty column', async () => {
        const conn = fakeConn(answer(['09'], [{ ...FARE_ROW, ROUTE_CODE: null }]));
        const res = makeRes();
        await run(getUnCalculated, makeReq(conn, {}), res);
        assert.ok(res.locals.data.includes('route_code="null"'));
    });

    it('answers with an empty document when the query fails', async () => {
        const conn = fakeConn((sql) => {
            if (sql.includes('tbl_fare_config')) return { rows: [['09']] };
            return new Error('ORA-00904');
        });
        const res = makeRes();
        const err = await run(getUnCalculated, makeReq(conn, {}), res);

        assert.strictEqual(err, undefined);
        assert.ok(!res.locals.data.includes('<FARE'));
    });
});

describe('updateuncalculatedtransaction', () => {
    const body = (attrs) => `<ROOT><FARE ${attrs}/></ROOT>`;
    const ONE = 'boarding_date_time="20260818101500" card_no="6372430000000001" '
        + 'usage_cnt="3" amount="250" resultCode="01"';

    it('prices the tap and marks it calculated', async () => {
        const conn = fakeConn();
        const err = await run(updateUnCalculated, makeReq(conn, {}, body(ONE)), makeRes());

        assert.strictEqual(err, undefined);
        const updates = conn.matching('UPDATE AFC_TD set usage_amt');
        assert.strictEqual(updates.length, 1);
        assert.strictEqual(updates[0].binds.usage_amt, 2.5, 'the amount is divided by 100');
        assert.strictEqual(updates[0].binds.fare_calc_status, '1');
        assert.strictEqual(updates[0].binds.usage_cnt, 3);
        assert.strictEqual(conn.commits, 1, 'one transaction per record');
    });

    it('leaves the tap uncalculated for any other result code', async () => {
        const conn = fakeConn();
        await run(updateUnCalculated, makeReq(conn, {}, body(ONE.replace('"01"', '"99"'))), makeRes());
        assert.strictEqual(conn.matching('UPDATE AFC_TD set usage_amt')[0].binds.fare_calc_status, '0');
    });

    it('carries an omitted attribute over from the previous element, as Java did', async () => {
        const second = '<FARE amount="500" usage_cnt="4"/>';
        const conn = fakeConn();
        await run(updateUnCalculated, makeReq(conn, {},
            `<ROOT><FARE ${ONE}/>${second}</ROOT>`), makeRes());

        const updates = conn.matching('UPDATE AFC_TD set usage_amt');
        assert.strictEqual(updates.length, 2);
        assert.strictEqual(updates[1].binds.card_no, '6372430000000001');
        assert.strictEqual(updates[1].binds.usage_amt, 5);
    });

    it('skips a record with an unparsable amount and keeps going', async () => {
        const conn = fakeConn();
        const err = await run(updateUnCalculated, makeReq(conn, {},
            `<ROOT><FARE ${ONE.replace('amount="250"', 'amount="x"')}/><FARE ${ONE}/></ROOT>`),
        makeRes());

        assert.strictEqual(err, undefined);
        assert.strictEqual(conn.matching('UPDATE AFC_TD set usage_amt').length, 1);
    });

    it('ignores elements that are not FARE', async () => {
        const conn = fakeConn();
        await run(updateUnCalculated, makeReq(conn, {}, '<ROOT><fare amount="1"/></ROOT>'), makeRes());
        assert.strictEqual(conn.calls.length, 0, 'the tag name is matched case sensitively');
    });

    it('rolls back and carries on when the update fails', async () => {
        const conn = fakeConn((sql) => (sql.includes('UPDATE AFC_TD') ? new Error('ORA-01400') : undefined));
        const err = await run(updateUnCalculated, makeReq(conn, {}, body(ONE)), makeRes());

        assert.strictEqual(err, undefined);
        assert.strictEqual(conn.rollbacks, 1);
        assert.strictEqual(conn.commits, 0);
    });
});
