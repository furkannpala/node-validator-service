/* eslint-env mocha */
const assert = require('assert');
const { fakeConn, makeReq, makeRes, run, oracleError } = require('../fakeConn');

const getTripType = require('../../validator/controller/schedule').funcs.gettriptype;
const getDriverPassword = require('../../validator/controller/driver').funcs.getdriverpassword;
const getCardDetail = require('../../validator/controller/card').funcs.getcarddetail;
const getBusInfo = require('../../validator/controller/bus').funcs.getbusinfo;

/** Fails every statement except the validator status call, which every endpoint makes first. */
function failingConn(error) {
    return fakeConn((sql) => (/sp_setval_status/i.test(sql) ? undefined : error));
}

const ORA = () => {
    const e = oracleError(1403);
    e.message = 'ORA-01403: no data found\nORA-06512: at "GAZIANTEP.PK_APP_VAL", line 1615';
    return e;
};

describe('database error masking', () => {
    it('never sends a stack to the device', async () => {
        const err = await run(getTripType,
            makeReq(failingConn(ORA()), { busid: '34AA0001' }), makeRes());

        assert.ok(err, 'expected an error');
        // Java answered with e.getMessage(); a Node stack would carry absolute server paths
        // into a document that reaches a validator on a public network.
        assert.ok(!/ {4}at |node_modules/.test(err.message), err.message);
    });

    it('replaces an ORA code with the fixed text Java used', async () => {
        const err = await run(getTripType,
            makeReq(failingConn(ORA()), { busid: '34AA0001' }), makeRes());

        assert.strictEqual(err.code, -8);
        assert.strictEqual(err.message, 'Database error occurred');
    });

    it('keeps a non-database failure visible where Java caught only SQLException', async () => {
        const err = await run(getTripType,
            makeReq(failingConn(new Error('socket hang up')), { busid: '34AA0001' }), makeRes());

        assert.strictEqual(err.message, 'socket hang up');
    });

    it('masks every failure on the two endpoints that caught Exception', async () => {
        const pass = await run(getDriverPassword,
            makeReq(failingConn(new Error('socket hang up')), { busid: '34AA0001' }), makeRes());
        assert.strictEqual(pass.message, 'Failed to fetch driver password');

        const detail = await run(getCardDetail,
            makeReq(failingConn(new Error('socket hang up')), { aliasno: '1' }), makeRes());
        assert.strictEqual(detail.message, 'Failed to fetch card detail');
    });

    it('leaves the ORA text alone on an endpoint Java did not mask', async () => {
        // getbusinfo has no catch of its own in ValidatorDataRetrieveFuncs, so the device sees
        // the database message. Verified against the running Java service.
        const err = await run(getBusInfo,
            makeReq(failingConn(ORA()), { busid: '34AA0001' }), makeRes());

        assert.ok(err.message.startsWith('ORA-01403: no data found'), err.message);
    });

    it('answers getroutebusstop with the bare exception text, as its own Java catch did', async () => {
        const getRouteBusStop = require('../../validator/controller/route').funcs.getroutebusstop;
        const conn = fakeConn();
        const res = makeRes();
        // Integer.parseInt(null) carries the message "null", and Java sent it as the whole
        // body with no XML around it. Verified byte for byte against the running Java service.
        const err = await run(getRouteBusStop, makeReq(conn, { busid: '34AA0001' }), res);

        assert.strictEqual(err, undefined, 'this endpoint answers 200 with the text');
        assert.strictEqual(res.locals.data, 'null');
        assert.strictEqual(res.headers['Content-Type'], undefined, 'Java set no content type');
    });

    it('lets a ServiceError through untouched, so -97 still reaches the device', async () => {
        // The procedure answering no LOB is not a failure; Java sent setMessage(-97, "error").
        const conn = fakeConn(() => ({ rowsAffected: 1, outBinds: {}, rows: [] }));
        const err = await run(getTripType, makeReq(conn, { busid: '34AA0001' }), makeRes());

        assert.strictEqual(err.code, -97);
        assert.strictEqual(err.message, 'error');
    });
});
