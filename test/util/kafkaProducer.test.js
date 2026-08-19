/* eslint-env mocha */
const assert = require('assert');
const KafkaProducer = require('../../util/KafkaProducer');
const { installFakeKafka, resetKafka } = require('../fakeKafka');

const META = { systemId: '017', sessionId: 'validatorservices_test' };

describe('KafkaProducer', () => {
    let log;

    beforeEach(() => {
        resetKafka();
        log = installFakeKafka();
    });

    afterEach(resetKafka);

    it('splits the comma list the config carries into brokers', () => {
        assert.deepStrictEqual(KafkaProducer.brokerList('a:9092, b:9092 ,'), ['a:9092', 'b:9092']);
        assert.deepStrictEqual(KafkaProducer.brokerList(''), []);
        assert.deepStrictEqual(KafkaProducer.brokerList(null), []);
    });

    it('sends the payload as JSON with the key, acks all and a timestamp', async () => {
        await KafkaProducer.produce({ sam_id: '05100001' }, META, 'topic.a', '05100001', 'a:9092');

        assert.strictEqual(log.records.length, 1);
        const record = log.records[0];
        assert.strictEqual(record.topic, 'topic.a');
        assert.strictEqual(record.acks, -1);
        assert.strictEqual(record.messages[0].key, '05100001');
        assert.strictEqual(record.messages[0].value, '{"sam_id":"05100001"}');
        assert.ok(/^\d+$/.test(record.messages[0].timestamp));
    });

    it('keeps one producer per systemId and bootstrap pair', async () => {
        await KafkaProducer.produce({}, META, 't', 'k', 'a:9092');
        await KafkaProducer.produce({}, META, 't', 'k', 'a:9092');
        assert.strictEqual(log.producers.length, 1, 'the second call reuses the cached producer');

        await KafkaProducer.produce({}, { ...META, systemId: '020' }, 't', 'k', 'a:9092');
        await KafkaProducer.produce({}, META, 't', 'k', 'b:9092');
        assert.strictEqual(log.producers.length, 3);
    });

    it('names the client after the webapp context, as Java used the servlet context', async () => {
        await KafkaProducer.produce({}, META, 't', 'k', 'a:9092');
        assert.strictEqual(log.clients[0].clientId, 'Validator Services');
        assert.strictEqual(log.clients[0].brokers.length, 1);
    });

    it('throws ServiceError(-1) and drops the producer when connect fails', async () => {
        resetKafka();
        log = installFakeKafka({ connectError: new Error('no route to broker') });

        await assert.rejects(
            () => KafkaProducer.produce({}, META, 't', 'k', 'a:9092'),
            (e) => e.code === -1 && /no route to broker/.test(e.message));
        assert.strictEqual(KafkaProducer._producers.size, 0, 'the next call must rebuild it');
        assert.strictEqual(log.disconnects, 1);
    });

    it('refuses to send without a topic or a broker', async () => {
        await assert.rejects(() => KafkaProducer.produce({}, META, '', 'k', 'a:9092'),
            (e) => e.code === -1 && /no kafka topic/.test(e.message));
        await assert.rejects(() => KafkaProducer.produce({}, META, 't', 'k', ''),
            (e) => e.code === -1 && /bootstrap servers/.test(e.message));
    });

    it('does not wait for the broker answer, so a delivery failure is only logged', async () => {
        resetKafka();
        log = installFakeKafka({ sendError: new Error('leader not available') });

        // Java's send() handed the record to the buffer and let a callback log the outcome;
        // awaiting the ack here would fail requests Java answered with OK.
        await KafkaProducer.produce({}, META, 't', 'k', 'a:9092');
        assert.strictEqual(log.records.length, 1);
    });

    it('disconnects every cached producer on shutdown', async () => {
        await KafkaProducer.produce({}, META, 't', 'k', 'a:9092');
        await KafkaProducer.produce({}, { ...META, systemId: '020' }, 't', 'k', 'a:9092');

        await KafkaProducer.destroyAll();
        assert.strictEqual(log.disconnects, 2);
        assert.strictEqual(KafkaProducer._producers.size, 0);
    });
});
