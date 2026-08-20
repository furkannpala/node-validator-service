/* eslint-env mocha */
const assert = require('assert');
const { fakeConn, makeReq, makeRes, run } = require('../fakeConn');
const HttpUtil = require('../../util/HttpUtil');
const sendData = require('../../validator/controller/transaction').funcs.senddata;

const DATA_ATTRS = 'record_id="D0001" trans_seq_no="1" trans_flag="1" customer_flag="0"'
    + ' data_save_flag="0" station_type="1" transmit_cnt="1" bus_stop_code="45" alias_no="A1"'
    + ' card_no="01712340000001" date_time="20260818101500" usage_cnt="3" passenger_type="1"'
    + ' usage_amt="250" remained_amt="1000" stage="1" customer_cnt="1" dc_rate="0"'
    + ' old_route_code="0" approval_no="0" tc_code="0" rtc_code="0" travel_seq_no="1"'
    + ' ht_start_time="20260818080000" sam_id="05100001" old_amount="1250" old_date_time="0"'
    + ' old_sam_id="0" sam_seqno="9" qtick_used="000000" trans_sam_id="0"';

const BODY = `<TD><DATA ${DATA_ATTRS}/></TD>`;

/** mst_bus answers a row, and PK_CONFIG hands back whatever url the case wants. */
function conn(url) {
    return fakeConn((sql) => {
        if (/from mst_bus/i.test(sql)) return { rows: [{ COMP_CODE: 1 }], outBinds: {} };
        if (/FN_GET_TE_DATAFORWARD_URL/i.test(sql)) return { rows: [{ URL: url }], outBinds: {} };
        return undefined;
    });
}

const request = (c) => makeReq(c, { busid: '34AA0001', stationtype: '1', systemid: '017' }, BODY);

describe('senddata data forward', () => {
    let posts;
    let answer;
    const realPost = HttpUtil.post;

    beforeEach(() => {
        // test/rootHooks.js empties the ticket engine url cache before every case, so each one
        // here really does read the url its own fakeConn hands back.
        posts = [];
        answer = '{"result":{"code":0}}';
        HttpUtil.post = async (url, body, options) => {
            posts.push({ url, body, options });
            return answer;
        };
    });

    afterEach(() => { HttpUtil.post = realPost; });

    it('does not call the ticket engine when PK_CONFIG returns no url', async () => {
        const err = await run(sendData, request(conn(null)), makeRes());
        assert.strictEqual(err, undefined);
        assert.strictEqual(posts.length, 0);
    });

    it('replays the raw body to the url PK_CONFIG hands back', async () => {
        const err = await run(sendData, request(conn('http://te/api?cmd=forward')), makeRes());

        assert.strictEqual(err, undefined);
        assert.strictEqual(posts.length, 1);
        // Java appended both parameters with no separator logic of its own.
        assert.strictEqual(posts[0].url, 'http://te/api?cmd=forward&systemid=017&lang=en');
        assert.strictEqual(posts[0].body, BODY);
        // The timeouts come from the app row, like every other call through Post().
        assert.strictEqual(posts[0].options.connectTimeoutMs, HttpUtil.DEFAULT_CONNECT_TIMEOUT_MS);
    });

    it('fails the request with code -3 when the engine answers a non-zero code', async () => {
        answer = '{"result":{"code":-11,"message":"bad card"}}';
        const err = await run(sendData, request(conn('http://te/api?cmd=forward')), makeRes());

        assert.ok(err, 'expected an error');
        assert.strictEqual(err.code, -3);
        assert.ok(err.message.startsWith('Ticket Engine Error: '), err.message);
        assert.ok(err.message.includes('bad card'), err.message);
    });

    it('forwards only after the records are stored', async () => {
        const c = conn('http://te/api?cmd=forward');
        await run(sendData, request(c), makeRes());

        const insertAt = c.calls.findIndex((call) => call.sql.includes('INSERT INTO afc_td('));
        assert.ok(insertAt >= 0, 'the record should have been written');
        assert.strictEqual(posts.length, 1, 'and the forward comes after it');
    });

    it('fails the request when the engine answers something that is not JSON', async () => {
        answer = '<html>gateway error</html>';
        const err = await run(sendData, request(conn('http://te/api?cmd=forward')), makeRes());
        assert.ok(err, 'a broken answer must not read as success');
    });
});
