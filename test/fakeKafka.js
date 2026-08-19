const KafkaProducer = require('../util/KafkaProducer');

/**
 * Stands in for kafkajs. Records every client built and every record handed to send(), so a
 * test can assert on the document without a broker. `behaviour` may fail connect or send.
 */
function installFakeKafka(behaviour = {}) {
    const log = { clients: [], records: [], producers: [], disconnects: 0 };

    KafkaProducer.deps.Kafka = class FakeKafka {
        constructor(options) {
            log.clients.push(options);
        }

        producer(options) {
            const producer = {
                options,
                async connect() {
                    if (behaviour.connectError) throw behaviour.connectError;
                },
                async send(record) {
                    log.records.push(record);
                    if (behaviour.sendError) throw behaviour.sendError;
                    return [];
                },
                async disconnect() { log.disconnects++; },
            };
            log.producers.push(producer);
            return producer;
        }
    };

    return log;
}

/** The producer cache is a module singleton, so it has to go between tests. */
function resetKafka() {
    KafkaProducer._producers.clear();
    KafkaProducer.deps.Kafka = null;
}

/** The one message the fake received, parsed back into an object. */
function sentPayload(log, index = 0) {
    return JSON.parse(log.records[index].messages[0].value);
}

module.exports = { installFakeKafka, resetKafka, sentPayload };
