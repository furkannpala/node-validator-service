const assert = require('assert');
const FRecordStrategy = require('../../strategy/FRecordStrategy');
const Context = require('../../strategy/Context');
const { fakeConn } = require('../fakeConn');

/** Records which visitor methods ran, in order, without touching a database. */
function spyVisitor() {
    const calls = [];
    const visitor = { calls };
    for (const name of ['visitDefault', 'visitWithoutStop', 'visitTripStarted', 'visitTripEnd',
        'visitJourneyStarted', 'visitDriverChanged', 'visitDrivercard', 'visitStopEntered',
        'visitStopLeft']) {
        visitor[name] = async () => { calls.push(name); };
    }
    return visitor;
}

async function planFor(travelType, extra) {
    const visitor = spyVisitor();
    const strategy = new FRecordStrategy(visitor);
    const trx = { travel_type: travelType, old_amt: '000000', route_code: '00012',
        half_progress_type: '1', ...extra };
    await strategy.processTransaction(fakeConn(), trx, {}, 'test');
    return { calls: visitor.calls, trx };
}

describe('F record strategy', () => {
    it('runs the lookup and the event row for a trip start', async () => {
        const { calls } = await planFor('0');
        assert.deepStrictEqual(calls, ['visitDefault', 'visitWithoutStop', 'visitTripStarted']);
    });

    it('closes the trip on travel type 1', async () => {
        const { calls } = await planFor('1');
        assert.deepStrictEqual(calls, ['visitDefault', 'visitWithoutStop', 'visitTripEnd']);
    });

    it('records a journey start on 6 and a driver change on 11', async () => {
        assert.deepStrictEqual((await planFor('6')).calls,
            ['visitDefault', 'visitWithoutStop', 'visitJourneyStarted']);
        assert.deepStrictEqual((await planFor('11')).calls,
            ['visitDefault', 'visitWithoutStop', 'visitDriverChanged']);
    });

    it('skips the lookup for the three shift events but still logs them', async () => {
        for (const type of ['3', '4', '5']) {
            assert.deepStrictEqual((await planFor(type)).calls,
                ['visitWithoutStop', 'visitDrivercard'], `travel_type ${type}`);
        }
    });

    it('skips both the lookup and the event row for the stop events', async () => {
        assert.deepStrictEqual((await planFor('8')).calls, ['visitStopEntered']);
        assert.deepStrictEqual((await planFor('9')).calls, ['visitStopLeft']);
    });

    it('leaves travel type 2 with only an event row', async () => {
        assert.deepStrictEqual((await planFor('2')).calls, ['visitWithoutStop']);
    });

    it('still writes the event row for a travel type nothing else handles', async () => {
        assert.deepStrictEqual((await planFor('7')).calls, ['visitDefault', 'visitWithoutStop']);
    });

    describe('path code', () => {
        it('is taken from old_amt, which carries it on F records', async () => {
            const { trx } = await planFor('0', { old_amt: '123456789' });
            assert.strictEqual(trx.pathCode, '123456789');
        });

        it('falls back to route code plus direction when it is all zeroes', async () => {
            const { trx } = await planFor('0', { old_amt: '000000', route_code: '00012',
                half_progress_type: '1' });
            assert.strictEqual(trx.pathCode, '000121');
        });

        it('survives a missing old_amt without throwing', async () => {
            const { trx } = await planFor('0', { old_amt: null });
            assert.strictEqual(trx.pathCode, '');
        });
    });
});

describe('strategy Context', () => {
    it('runs the strategy it was given', async () => {
        const seen = [];
        const context = new Context({ processTransaction: async (c, trx) => seen.push(trx.record_id) });
        await context.execute(fakeConn(), { record_id: 'F001' }, {}, 'test');
        assert.deepStrictEqual(seen, ['F001']);
    });

    it('rethrows so the record can be rolled back and logged', async () => {
        const context = new Context({
            processTransaction: async () => { throw new Error('boom'); },
        });
        await assert.rejects(() => context.execute(fakeConn(), { record_id: 'F002' }, {}, 'test'), /boom/);
    });

    it('does nothing when no strategy was selected', async () => {
        await new Context(null).execute(fakeConn(), {}, {}, 'test');
    });
});
