/* eslint-env mocha */
const assert = require('assert');
const { fakeConn, makeReq, makeRes, run } = require('../fakeConn');
const HttpUtil = require('../../util/HttpUtil');
const { readResponse, EmvUsageBatch } = require('../../util/EmvUsageBatch');
const sendData = require('../../validator/controller/sendData');

// key_index 2 means the device did not price the ride, which is what puts it in the batch.
const DATA_ATTRS = 'record_id="D0001" trans_seq_no="1" trans_flag="1" customer_flag="0"'
    + ' data_save_flag="0" station_type="1" transmit_cnt="1" bus_stop_code="45" alias_no="A1"'
    + ' card_no="01712340000001" date_time="20260818101500" usage_cnt="3" passenger_type="1"'
    + ' usage_amt="250" remained_amt="1000" stage="1" customer_cnt="1" dc_rate="0"'
    + ' old_route_code="0" approval_no="0" tc_code="0" rtc_code="0" travel_seq_no="1"'
    + ' ht_start_time="20260818080000" sam_id="05100001" old_amount="1250" old_date_time="0"'
    + ' old_sam_id="0" sam_seqno="9" qtick_used="000000" trans_sam_id="0" service_charge="15"'
    + ' fare_file_version="1" travel_type="1" ci_tid="T9" ci_bdt="20260818"'
    + ' bus_id="34AA0001"';

const EMV = '<EMV ptcn="PT1" bin="454671" amount="265" key_index="2" masked_pan="4546**0001"/>';

const body = (extra = EMV, n = 1) => `<TD>${`<DATA ${DATA_ATTRS}>${extra}</DATA>`.repeat(n)}</TD>`;

// card_no[5..7] is "34", so credit_card_type has to list it for the batch to pick the row up.
const CFG = { credit_card_type: '34', credit_card_data_url: 'http://kpg/api/' };

function conn() {
    return fakeConn((sql) => {
        if (/from mst_bus/i.test(sql)) return { rows: [{ COMP_CODE: 1 }], outBinds: {} };
        if (/fn_get_operation_pdate\(\),'dd\.MM\.yyyy'/i.test(sql)) {
            return { rows: [{ PDATE: '18.08.2026' }], outBinds: {} };
        }
        return undefined;
    });
}

function request(c, cfg) {
    const req = makeReq(c, { busid: '34AA0001', stationtype: '1', systemid: '017' }, body());
    req.cfg = { ...CFG, ...cfg };
    return req;
}

describe('senddata credit card usage batch', () => {
    let posts;
    let answer;
    const realPost = HttpUtil.post;

    beforeEach(() => {
        posts = [];
        answer = '<ROOT code="0" message="OK"/>';
        HttpUtil.post = async (url, payload) => {
            posts.push({ url, payload });
            return answer;
        };
    });

    afterEach(() => { HttpUtil.post = realPost; });

    it('posts one document with the usage of every credit card record', async () => {
        const c = conn();
        const req = request(c);
        req.rawBody = body(EMV, 2);
        const err = await run(sendData, req, makeRes());

        assert.strictEqual(err, undefined);
        assert.strictEqual(posts.length, 1, 'the batch goes out once, after the loop');
        assert.strictEqual(posts[0].url, 'http://kpg/api/addUsageEmvValidator');
        assert.strictEqual((posts[0].payload.match(/<USAGE /g) || []).length, 2);
    });

    it('carries the fields Java appended, in its order and without escaping', async () => {
        await run(sendData, request(conn()), makeRes());

        const xml = posts[0].payload;
        assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><ROOT><USAGE '), xml);
        // usage_amt is the raw attribute plus the service charge, not the divided amount.
        assert.ok(xml.includes(' usage_amt="265"'), xml);
        assert.ok(xml.includes(' pdate="18.08.2026"'), xml);
        // term_no is the bus, not the EMV terminal the card sent.
        assert.ok(xml.includes(' term_no="34AA0001"'), xml);
        assert.ok(xml.includes(' system_id="017"'), xml);
        assert.ok(xml.includes(' ci_tid="T9"'), xml);
        // stop_name is one of the fields Java left at its empty-string default.
        assert.ok(xml.includes(' stop_name=""'), xml);
        assert.ok(xml.endsWith('/></ROOT>'), xml);
    });

    it('leaves the gateway alone when the card type is not a credit card', async () => {
        await run(sendData, request(conn(), { credit_card_type: '99' }), makeRes());
        assert.strictEqual(posts.length, 0);
    });

    it('skips a ride the device priced itself, unless the system is a test one', async () => {
        const priced = request(conn());
        priced.rawBody = body('<EMV ptcn="PT1" key_index="1"/>');
        await run(sendData, priced, makeRes());
        assert.strictEqual(posts.length, 0);

        const onTest = request(conn(), { server_environment: 'test' });
        onTest.rawBody = body('<EMV ptcn="PT1" key_index="1"/>');
        await run(sendData, onTest, makeRes());
        assert.strictEqual(posts.length, 1);
    });

    it('skips a ride with no key index at all on a production system', async () => {
        const req = request(conn());
        req.rawBody = body('<EMV ptcn="PT1"/>');
        await run(sendData, req, makeRes());
        assert.strictEqual(posts.length, 0);
    });

    it('fails the record when a credit card arrives without an EMV element', async () => {
        const req = request(conn());
        // key_index only ever arrives on the EMV child, so the element is there but bare.
        req.rawBody = body('<EMV key_index="2"/>');
        const err = await run(sendData, req, makeRes());

        assert.ok(err, 'expected an error');
        assert.ok(err.message.includes('xml data has not EMV tag for card_no=01712340000001'),
            err.message);
        assert.strictEqual(posts.length, 0);
    });

    it('does not call the gateway without a url', async () => {
        await run(sendData, request(conn(), { credit_card_data_url: '' }), makeRes());
        assert.strictEqual(posts.length, 0);
    });

    it('fails the request when the gateway rejects the batch', async () => {
        answer = '<ROOT code="5" message="NOK"/>';
        const err = await run(sendData, request(conn()), makeRes());

        assert.ok(err, 'expected an error');
        assert.ok(err.message.includes('addUsageEmvValidator service'), err.message);
        assert.ok(err.message.includes('code: 5'), err.message);
    });

    it('never collects on the station path, which had no batch in Java', async () => {
        const c = conn();
        const req = makeReq(c, { busid: 'ST01', stationtype: '2', systemid: '017' }, body());
        req.cfg = { ...CFG };
        await run(sendData, req, makeRes());
        assert.strictEqual(posts.length, 0);
    });

    describe('document', () => {
        it('writes a null field as the four characters StringBuilder.append(null) produced', () => {
            const batch = new EmvUsageBatch();
            batch.add({ card_no: '017', alias_no: null });
            const xml = batch.toXml();
            assert.ok(xml.includes(' alias_no="null"'), xml);
            assert.ok(xml.includes(' card_no="017"'), xml);
            // Java escaped nothing, so a value with a quote in it would break the document.
            assert.strictEqual(xml.indexOf('&'), -1);
        });
    });

    describe('gateway answer', () => {
        it('reads the innermost element, as getDefaultXmlResponse kept the last one', () => {
            assert.deepStrictEqual(readResponse('<ROOT><RESULT code="0" message="OK"/></ROOT>'),
                { code: '0', message: 'OK' });
        });

        it('reports nothing for a document with no elements', () => {
            assert.strictEqual(readResponse('not xml at all'), null);
        });
    });
});
