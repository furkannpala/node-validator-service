const { ULog, ServiceError } = require("../../../lib/utils");
const system_cfg = require("../config/system_cfg");

// Java KkKafkaConfigurator held one producer per systemId + bootstrapServers and threw the pair
// away whenever a send failed, so the next call rebuilt it. The same cache is kept here.
const producers = new Map();

const DEFAULT_RETRIES = 3;
const DEFAULT_MAX_BLOCK_MS = 10000;

// Injectable so a test never opens a socket; the real client is resolved from the parent project.
const deps = { Kafka: null };

function kafkaClass() {
    if (deps.Kafka) return deps.Kafka;
    return require("kafkajs").Kafka;
}

function cacheKey(systemId, bootstrapServers) {
    return `${systemId}|${bootstrapServers}`;
}

/** kk_bootstrap_servers is a comma list in the config, kafkajs wants an array. */
function brokerList(bootstrapServers) {
    if (Array.isArray(bootstrapServers)) return bootstrapServers.map((b) => String(b).trim()).filter(Boolean);
    return String(bootstrapServers ?? "").split(",").map((b) => b.trim()).filter(Boolean);
}

function positiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function getOrCreate(systemId, bootstrapServers, options) {
    const key = cacheKey(systemId, bootstrapServers);
    const cached = producers.get(key);
    if (cached) return cached;

    const brokers = brokerList(bootstrapServers);
    if (!brokers.length) throw new Error("no kafka bootstrap servers configured");

    const Kafka = kafkaClass();
    const client = new Kafka({
        // Java used the WebLogic context name as client.id; system_cfg.context is that name.
        clientId: system_cfg.context,
        brokers,
        retry: { retries: options.retries },
    });
    // ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG was false in Java, which is also what allows
    // acks/retries to be set independently.
    const entry = {
        producer: client.producer({ idempotent: false, retry: { retries: options.retries } }),
        connected: false,
        connecting: null,
    };
    producers.set(key, entry);
    return entry;
}

function withDeadline(promise, ms, message) {
    let timer;
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * max.block.ms bounded how long Java's send() could sit waiting for metadata or buffer space.
 * kafkajs does that work inside connect(), so the deadline belongs here.
 */
async function ensureConnected(entry, maxBlockMs) {
    if (entry.connected) return;
    if (!entry.connecting) {
        entry.connecting = entry.producer.connect()
            .then(() => { entry.connected = true; })
            .catch((e) => { entry.connecting = null; throw e; });
    }
    await withDeadline(entry.connecting, maxBlockMs, `kafka connect exceeded ${maxBlockMs} ms`);
}

/**
 * One record, mirroring KkAvlProducer.produce. The payload is serialised the way Gson did it:
 * a null field is left out of the document entirely, which the consumers rely on.
 *
 * @param {object} payload           already projected into the Java bean's shape
 * @param {object} meta              { systemId, retries, maxBlockMs, sessionId }
 * @param {string} topic
 * @param {string} recordKey         the partition key, sam_id or bus_id depending on the caller
 * @param {string} bootstrapServers
 */
async function produce(payload, meta, topic, recordKey, bootstrapServers) {
    const systemId = String(meta?.systemId ?? "");
    const sessionId = meta?.sessionId;
    const options = {
        retries: positiveInt(meta?.retries, DEFAULT_RETRIES),
        maxBlockMs: positiveInt(meta?.maxBlockMs, DEFAULT_MAX_BLOCK_MS),
    };
    const message = JSON.stringify(payload);
    try {
        // Java built the ProducerRecord inside the same try, so a missing topic came back as
        // the same failure a missing broker did.
        if (!topic) throw new Error("no kafka topic configured");
        const entry = getOrCreate(systemId, bootstrapServers, options);
        await ensureConnected(entry, options.maxBlockMs);

        // Java's send(record, callback) returned as soon as the record was buffered and the
        // broker's answer only ever reached a callback that logged it. Awaiting the ack here
        // would turn a delivery failure into a failed request, which Java never did.
        entry.producer.send({
            topic,
            acks: -1,
            messages: [{ key: recordKey == null ? null : String(recordKey), value: message,
                timestamp: String(Date.now()) }],
        }).catch((e) => ULog.error(`kafka_producer_callback_error: ${e?.message}`, sessionId));
    } catch (e) {
        ULog.error(`kafka_producer_send_failure(topic->${topic}) : ${message}`, sessionId);
        await destroy(systemId, bootstrapServers);
        throw new ServiceError(-1, e?.message);
    }
}

async function disconnect(entry) {
    try {
        await entry.producer.disconnect();
    } catch (e) {
        ULog.error(`kafka producer disconnect failed: ${e?.message}`);
    }
}

/** Java destroyed the failing producer so the next call rebuilt it against fresh metadata. */
async function destroy(systemId, bootstrapServers) {
    const key = cacheKey(systemId, bootstrapServers);
    const entry = producers.get(key);
    if (!entry) return;
    producers.delete(key);
    await disconnect(entry);
}

/** Validator.destroy() flushed and closed every producer; this is the servlet-shutdown twin. */
async function destroyAll() {
    const entries = [...producers.values()];
    producers.clear();
    await Promise.all(entries.map(disconnect));
}

module.exports = {
    produce, destroy, destroyAll, brokerList, deps,
    DEFAULT_RETRIES, DEFAULT_MAX_BLOCK_MS,
    _producers: producers,
};
