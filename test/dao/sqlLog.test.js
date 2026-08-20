/* eslint-env mocha */
const assert = require('assert');
const path = require('path');
const { ULog } = require('../../../../lib/utils');
const sqlLog = require('../../validator/dao/sqlLog');

const MODULE_PATH = path.resolve(__dirname, '../../validator/dao/sqlLog.js');

/** Loads a fresh copy of the module with VS_SQL_DEBUG set to `value`. */
function loadWith(value) {
    const previous = process.env.VS_SQL_DEBUG;
    if (value === undefined) delete process.env.VS_SQL_DEBUG;
    else process.env.VS_SQL_DEBUG = value;
    delete require.cache[MODULE_PATH];
    try {
        return require(MODULE_PATH);
    } finally {
        if (previous === undefined) delete process.env.VS_SQL_DEBUG;
        else process.env.VS_SQL_DEBUG = previous;
        delete require.cache[MODULE_PATH];
        require(MODULE_PATH);   // put the shared copy back for everyone else
    }
}

/** Captures what reached ULog.debug while fn ran. */
function captureDebug(fn) {
    const lines = [];
    const real = ULog.debug;
    ULog.debug = (message, sessionId) => lines.push({ message: String(message), sessionId });
    try {
        fn();
    } finally {
        ULog.debug = real;
    }
    return lines;
}

describe('sqlLog masking', () => {
    it('keeps the first six and last four of a card number', () => {
        const masked = JSON.parse(sqlLog.maskJson({ card_no: '6372430000000001' }));
        assert.strictEqual(masked.card_no, '637243******0001');
    });

    it('hides a short value entirely rather than leaking most of it', () => {
        // 10 characters or fewer: first6+last4 would be the whole thing.
        assert.strictEqual(JSON.parse(sqlLog.maskJson({ card_no: '1234567890' })).card_no, '***');
    });

    it('redacts the tags that are useless in a log line', () => {
        const masked = JSON.parse(sqlLog.maskJson({ ptcn: 'A1B2C3', enc_pan: 'DEADBEEF' }));
        assert.strictEqual(masked.ptcn, '***');
        assert.strictEqual(masked.enc_pan, '***');
    });

    it('leaves everything else legible, which is the point of tracing at all', () => {
        const masked = JSON.parse(sqlLog.maskJson({
            sam_id: '05100001', bus_id: '34AA0001', usage_amt: 250, trans_flag: null,
        }));
        assert.deepStrictEqual(masked,
            { sam_id: '05100001', bus_id: '34AA0001', usage_amt: 250, trans_flag: null });
    });

    it('matches the key however the DAO cased it', () => {
        assert.strictEqual(JSON.parse(sqlLog.maskJson({ CARD_NO: '6372430000000001' })).CARD_NO,
            '637243******0001');
    });

    /** The bind object goes on to the database; masking it there would corrupt the row. */
    it('never touches the object it was given', () => {
        const binds = { card_no: '6372430000000001', ptcn: 'A1B2C3', nested: { alias_no: 'ALIAS12345678' } };
        sqlLog.maskJson(binds);

        assert.strictEqual(binds.card_no, '6372430000000001');
        assert.strictEqual(binds.ptcn, 'A1B2C3');
        assert.strictEqual(binds.nested.alias_no, 'ALIAS12345678');
    });

    it('masks inside an executeMany row list and inside nested objects', () => {
        const masked = JSON.parse(sqlLog.maskJson([
            { card_no: '6372430000000001' },
            { nested: { card_no: '6372430000000002' } },
        ]));
        assert.strictEqual(masked[0].card_no, '637243******0001');
        assert.strictEqual(masked[1].nested.card_no, '637243******0002');
    });

    /**
     * The two sets are the whole policy, so a key silently dropped from either is the bug this
     * guards: card data would reach the central log over UDP with nothing to show for it.
     */
    it('covers every field the statements actually bind card data into', () => {
        for (const key of ['card_no', 'alias_no', 'masked_pan']) {
            assert.ok(sqlLog.PAN_KEYS.has(key), `${key} must be masked`);
        }
        for (const key of ['ptcn', 'enc_pan']) {
            assert.ok(sqlLog.REDACT_KEYS.has(key), `${key} must be redacted`);
        }
    });
});

describe('sqlLog switch', () => {
    it('traces the statement with its masked binds when it is on', () => {
        const lines = captureDebug(() =>
            sqlLog.debugSql('SELECT 1 FROM dual', { card_no: '6372430000000001' }, 'sid'));

        assert.strictEqual(lines.length, 1);
        assert.ok(lines[0].message.startsWith('SELECT 1 FROM dual '), lines[0].message);
        assert.ok(lines[0].message.includes('637243******0001'), lines[0].message);
        assert.ok(!lines[0].message.includes('6372430000000001'), 'the raw number must not appear');
        assert.strictEqual(lines[0].sessionId, 'sid');
    });

    it('logs the statement alone when there are no binds', () => {
        const lines = captureDebug(() => sqlLog.debugSql('SELECT 1 FROM dual', undefined, 'sid'));
        assert.deepStrictEqual(lines.map((l) => l.message), ['SELECT 1 FROM dual']);
    });

    /**
     * The guard sits in front of maskJson on purpose: with the trace off the masked bind text
     * is never built either, which is why it lives here and not inside ULog.
     */
    it('builds nothing at all with VS_SQL_DEBUG=0', () => {
        const off = loadWith('0');
        assert.strictEqual(off.SQL_DEBUG_ENABLED, false);

        let touched = false;
        const binds = { get card_no() { touched = true; return '6372430000000001'; } };
        const lines = captureDebug(() => off.debugSql('SELECT 1 FROM dual', binds, 'sid'));

        assert.deepStrictEqual(lines, [], 'nothing reached the log');
        assert.strictEqual(touched, false, 'the binds were not even read');
    });

    it('is on when the switch is unset', () => {
        assert.strictEqual(loadWith(undefined).SQL_DEBUG_ENABLED, true);
    });
});
