const { ULog, ServiceError, getXmlResponse, js2Xml } = require("../../../lib/utils");
const moment = require("moment");
const daoFactory = require("./daoFactory/DaoFactory");
const { withTransaction } = require("./dao/daoUtil");
const { ErrorManagement, ErrorCodes } = require("../constant/ErrorManagement");
const Constant = require("../constant/Constant");
const XmlWalk = require("../util/XmlWalk");
const HttpUtil = require("../util/HttpUtil");
const KafkaProducer = require("../util/KafkaProducer");
const DatabaseError = require("../util/DatabaseError");

class ValidatorControllerBase {
    constructor() {
        this.ULog = ULog;
        this.ServiceError = ServiceError;
        this.getXmlResponse = getXmlResponse;
        this.js2Xml = js2Xml;
        this.moment = moment;

        this.daoFactory = daoFactory;
        this.withTransaction = withTransaction;
        this.ErrorManagement = ErrorManagement;
        this.ErrorCodes = ErrorCodes;
        this.Constant = Constant;
    }

    /**
     * Java doProcess ran this as the first statement of 50+ endpoints. `action` and the extra
     * status text stay exactly as the Java branch built them, since they land in val_status.
     */
    async setValidatorStatus(req, action, extraParams) {
        const busid = req.query.busid;
        const binds = {
            busid: busid == null ? null : String(busid),
            ipaddr: req.query.remoteipaddr == null ? null : String(req.query.remoteipaddr),
            status: action,
            connected: '1',
            parameters: ` Busid:${busid}${extraParams || ''}`,
        };
        return await this.daoFactory.get("PkAppValDaoImpl").setValStatus(req.dbConn, binds, req.sessionId);
    }

    /** Config lookup with the Java default. req.cfg is the system row, defaultCfg the app row. */
    cfg(req, key, defaultValue) {
        const own = req.cfg ? req.cfg[key] : undefined;
        if (own !== undefined) return own;
        const app = req.cfg?.defaultCfg ? req.cfg.defaultCfg[key] : undefined;
        return app !== undefined ? app : defaultValue;
    }

    /** Java's HttpURLConnection pair: one deadline to connect, another to read the answer. */
    kpgTimeouts(req) {
        return {
            connectTimeoutMs: Number(this.cfg(req, "kpg_connect_timeout_ms",
                HttpUtil.DEFAULT_CONNECT_TIMEOUT_MS)),
            readTimeoutMs: Number(this.cfg(req, "kpg_read_timeout_ms",
                HttpUtil.DEFAULT_READ_TIMEOUT_MS)),
        };
    }

    /** env.properties held these as comma lists; a JSON config may store either shape. */
    cfgList(req, key, defaultValue) {
        const v = this.cfg(req, key, defaultValue);
        if (Array.isArray(v)) return v;
        if (typeof v === "string") return v === "" ? [] : v.split(",");
        return [];
    }

    /** "false"/"0" from a JSON string value must not read as true. */
    cfgBool(req, key, defaultValue) {
        const v = this.cfg(req, key, defaultValue);
        if (typeof v === "string") return v !== "" && v !== "0" && v.toLowerCase() !== "false";
        return !!v;
    }

    /** senddata, sendcfg, sendgps and sendlog each have their own producer switch. */
    kafkaEnabled(req, func) {
        return this.cfgBool(req, `${func}_use_kafka_producer`, false);
    }

    /** With this on, the record only goes to Kafka and every database write is skipped. */
    kafkaOnly(req, func) {
        return this.cfgBool(req, `${func}_use_only_kafka_produce`, false);
    }

    /**
     * The six Java produce blocks share one shape: send the message, log a failure, and let it
     * take the request down only when <func>_kafka_error_throw is on. Java spelled the prefix
     * three ways across the blocks, one of them "Kakfka Error:"; they all carry the same code,
     * so the constant is used at every one of them now.
     */
    async produceKafka(req, func, payload, recordKey) {
        try {
            await KafkaProducer.produce(payload, {
                systemId: req.systemId ?? req.query.systemid,
                sessionId: req.sessionId,
                retries: this.cfg(req, "kafka_producer_retries", KafkaProducer.DEFAULT_RETRIES),
                maxBlockMs: this.cfg(req, "kafka_producer_max_block_ms",
                    KafkaProducer.DEFAULT_MAX_BLOCK_MS),
            }, this.cfg(req, `${func}_topic`, null), recordKey, this.bootstrapServers(req, func));
        } catch (error) {
            this.ULog.error(`Kafka producer error: ${error?.message}`, req.sessionId);
            if (!this.cfgBool(req, `${func}_kafka_error_throw`, false)) return;
            throw new ServiceError(this.ErrorCodes.KAFKA_ERROR.code,
                this.ErrorCodes.KAFKA_ERROR.message + error?.message);
        }
    }

    /** A per-function broker list wins; an empty one falls back to the shared list, as in Java. */
    bootstrapServers(req, func) {
        const own = this.cfg(req, `kk_bootstrap_servers_${func}`, "");
        const list = KafkaProducer.brokerList(own);
        return list.length ? own : this.cfg(req, "kk_bootstrap_servers", "");
    }

    /**
     * Java parsed the request body into a DOM and walked every element in document order.
     * rawBodyParser has already gunzipped it, so the payload is a Buffer or a string here.
     */
    bodyElements(req) {
        return XmlWalk.elements(req.rawBody);
    }

    /** Every write endpoint answered with the same empty OK document. */
    okResponse(res) {
        res.setHeader("Content-Type", "text/xml");
        res.locals.data = this.getXmlResponse(0, "");
    }

    /**
     * Java's top-level catch answered the device with e.getMessage() and nothing else. The
     * stack is logged instead of sent: the document reaches a validator on a public network
     * and a Node stack carries absolute server paths.
     */
    getServiceError(error, req) {
        if (!error) return new ServiceError(-8, "Unknown error");
        if (error instanceof ServiceError) return error;
        // The ServiceError built below carries its own stack, so the original is logged here
        // or it is lost for good.
        ULog.error(error?.stack || error?.message, req?.sessionId);
        if (this.dbErrorMessage && this.masksError(error)) {
            return new ServiceError(-8, this.dbErrorMessage);
        }
        return new ServiceError(-8, error?.message || "Unknown error");
    }

    /**
     * Most of the Java retrieve funcs caught SQLException and replaced it with a fixed text, so
     * an ORA code never reached the device; two of them caught every exception that way. A
     * controller opts in by setting dbErrorMessage, and dbErrorScope 'all' for the wider pair.
     */
    masksError(error) {
        return this.dbErrorScope === "all" || DatabaseError.isSqlError(error);
    }
}

module.exports = { ValidatorControllerBase };
