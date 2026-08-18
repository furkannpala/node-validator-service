/* eslint-env mocha */
const assert = require('assert');
const http = require('http');
const { makeReq, makeRes, run } = require('../fakeConn');

const HttpUtil = require('../../util/HttpUtil');
const KpgClient = require('../../util/KpgClient');
const realAuth = require('../../validator/controller/realAuth');
const sendEmvData = require('../../validator/controller/sendEmvData');

let server;
let baseUrl;
/** Set per test: the handler the fake gateway runs for the next request. */
let handler;
/** What the gateway last received, so the tests can assert on the forwarded request. */
let received;

before((done) => {
    server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            received = { url: req.url, body: Buffer.concat(chunks).toString('utf8'), headers: req.headers };
            handler(req, res);
        });
    });
    server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}/kpg`;
        done();
    });
});

after((done) => server.close(done));

beforeEach(() => {
    received = null;
    handler = (req, res) => res.end('<OK/>');
});

describe('KPG url', () => {
    it('appends the action as a bare query token, as Java did', () => {
        assert.strictEqual(KpgClient.buildUrl('https://h/p', 'realAuth', '017'),
            'https://h/p?realAuth&systemid=017');
    });

    it('does not add a second question mark', () => {
        assert.strictEqual(KpgClient.buildUrl('https://h/p?a=1', 'sendEMVData', '017'),
            'https://h/p?a=1sendEMVData&systemid=017');
    });
});

describe('HttpUtil.post', () => {
    it('forwards the body and returns the answer', async () => {
        const answer = await HttpUtil.post(`${baseUrl}?realAuth`, '<REQ/>');
        assert.strictEqual(answer, '<OK/>');
        assert.strictEqual(received.body, '<REQ/>');
        assert.strictEqual(received.headers['user-agent'], 'Mozilla/5.0');
    });

    it('joins a multi line answer into one line, as BufferedReader did', async () => {
        handler = (req, res) => res.end('<A>\r\n<B/>\n</A>');
        assert.strictEqual(await HttpUtil.post(baseUrl, ''), '<A><B/></A>');
    });

    it('escapes every space in the url, not just the first', async () => {
        await HttpUtil.post(`${baseUrl}?a b c`, '');
        assert.strictEqual(received.url, '/kpg?a%20b%20c');
    });

    it('rejects a gateway error status instead of returning its body', async () => {
        handler = (req, res) => { res.statusCode = 500; res.end('boom'); };
        await assert.rejects(() => HttpUtil.post(baseUrl, ''),
            (e) => /HTTP 500/.test(e.message));
    });

    it('gives up when the gateway never answers', async () => {
        handler = () => { /* hold the request open */ };
        await assert.rejects(() => HttpUtil.post(baseUrl, '', { readTimeoutMs: 80 }),
            (e) => /read timed out/.test(e.message));
    });
});

describe('realauth and sendemvdata', () => {
    const reqFor = (body) => {
        const req = makeReq(null, {}, body);
        req.cfg = { credit_card_auth_url: baseUrl };
        return req;
    };

    it('proxies the device body to the gateway', async () => {
        const res = makeRes('017');
        const err = await run(realAuth, reqFor('<AUTH/>'), res);

        assert.strictEqual(err, undefined);
        assert.strictEqual(res.locals.data, '<OK/>');
        assert.strictEqual(received.body, '<AUTH/>');
        assert.strictEqual(received.url, '/kpg?realAuth&systemid=017');
    });

    it('sends the settlement action for sendemvdata', async () => {
        await run(sendEmvData, reqFor('<EMV/>'), makeRes('017'));
        assert.strictEqual(received.url, '/kpg?sendEMVData&systemid=017');
    });

    it('reports a gateway failure as -99, the code Java produced', async () => {
        handler = (req, res) => { res.statusCode = 502; res.end(''); };
        const err = await run(realAuth, reqFor('<AUTH/>'), makeRes('017'));

        assert.ok(err, 'expected an error reply');
        assert.strictEqual(err.code, -99);
    });

    it('honours the read timeout from the app config row', async () => {
        handler = () => { /* hold the request open */ };
        const req = reqFor('<AUTH/>');
        req.cfg.defaultCfg = { kpg_read_timeout_ms: 80 };

        const err = await run(realAuth, req, makeRes('017'));
        assert.strictEqual(err.code, -99);
        assert.ok(/read timed out/.test(err.message));
    });
});
