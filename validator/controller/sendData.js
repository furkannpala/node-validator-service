const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const DataTransaction = require("../../bean/DataTransaction");
const DataStrategy = require("../../strategy/DataStrategy");
const StationStrategy = require("../../strategy/StationStrategy");
const TchewDataStrategy = require("../../strategy/TchewDataStrategy");
const Context = require("../../strategy/Context");
const XmlWalk = require("../../util/XmlWalk");
const DatabaseError = require("../../util/DatabaseError");
const HttpUtil = require("../../util/HttpUtil");
const EmvUsage = require("../../util/EmvUsageBatch");
const { EmvUsageBatch } = EmvUsage;
const { isUniqueViolation } = require("../dao/daoUtil");

class SendData extends ValidatorControllerBase {
    constructor() {
        super();
        this.mstBus = this.daoFactory.get("MstBusDaoImpl");
        this.errorTdDao = this.daoFactory.get("TblValidatorErrorTdDaoImpl");
        this.pkConfig = this.daoFactory.get("PkConfigDaoImpl");
        this.dataContext = new Context(new DataStrategy());
        this.stationContext = new Context(new StationStrategy());
        this.tchewContext = new Context(new TchewDataStrategy());
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " SendData ",
                ` Stationtype :${req.query.stationtype} arch :${req.query.arch}`);
            await this.process(req, res);
            await this.forwardToTicketEngine(req);
            this.okResponse(res);
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }

    /**
     * Java's process() turned everything the body raised — a missing bus, a rejected record, a
     * refused Kafka send — into one code before it reached the device.
     */
    async process(req, res) {
        try {
            await this.store(req, res);
        } catch (error) {
            throw new this.ServiceError(this.ErrorCodes.DB_OPERATION_FAILED.code,
                this.ErrorCodes.DB_OPERATION_FAILED.message + DatabaseError.getErrorMessage(error));
        }
    }

    async store(req, res) {
        const cfg = this.senddataConfig(req, res);

        let elements;
        try {
            elements = this.bodyElements(req);
        } catch (error) {
            // A body that will not parse is filed and answered OK: resending cannot fix it.
            await this.recordError(req, cfg, 'XML parsing error', 'XML_PARSE_ERROR');
            return;
        }

        if (!await this.mstBus.checkStation(req.dbConn, cfg.busId, cfg.stationType, req.sessionId)) {
            // Message kept word for word: operations greps for it.
            throw new Error(`mst_bus validation failed: BUS_ID: ${cfg.busId}, `
                + `STATION_TYPE: ${cfg.stationType} (no record found)`);
        }

        const context = await this.selectContext(req, cfg);
        const isStation = !this.Constant.BUS_STATION_TYPES.has(String(cfg.stationType));
        // Only ins_data gathered the credit card usages; the station and tchew paths did not,
        // and the strategies skip the step when there is nothing to gather them into.
        if (context === this.dataContext) cfg.emvUsages = new EmvUsageBatch();
        const trx = new DataTransaction();
        for (const element of elements) {
            if (element.name.toUpperCase() !== 'DATA') continue;
            // Java cleared part of the state here and left the rest to carry over; see
            // DataTransaction.resetPerElement for which fields those are.
            trx.resetPerElement(isStation);
            // The EMV child is read first, so a name carried by both loses to the DATA value.
            for (const emv of XmlWalk.descendants(element.node, 'EMV')) trx.applyEmvAttrs(emv.attrs);
            // ins_station names several attributes differently; see DataTransaction.
            if (isStation) trx.applyStationAttrs(element.attrs);
            else trx.applyAttrs(element.attrs);

            if (cfg.toKafka) {
                await this.produceKafka(req, 'senddata', trx.toKafkaPayload(isStation), trx.sam_id,
                    isStation ? 'Kakfka Error:' : 'Kafka Error:');   // Java's two spellings
            }
            if (cfg.dbEnabled) await this.storeRecord(req, context, trx, cfg);
        }

        await this.sendEmvUsages(req, cfg);
    }

    /**
     * The whole body's credit card usages go to the gateway in one document, once the records
     * are stored. An empty credit_card_data_url turns the hop off, as it did in Java.
     */
    async sendEmvUsages(req, cfg) {
        if (!cfg.emvUsages || cfg.emvUsages.isEmpty()) return;
        await EmvUsage.send(cfg.emvUsages, this.cfg(req, 'credit_card_data_url', ''),
            this.kpgTimeouts(req), req.sessionId);
    }

    /**
     * The whole body is replayed to the ticket engine once the records are stored, which is
     * where Java did it. An empty URL from PK_CONFIG turns the hop off.
     */
    async forwardToTicketEngine(req) {
        const url = await this.pkConfig.getDataForwardUrl(req.dbConn, req.sessionId);
        if (!url) return;

        const answer = await HttpUtil.post(
            `${url}&systemid=${req.query.systemid}&lang=en`, req.rawBody ?? '',
            this.kpgTimeouts(req));
        const parsed = JSON.parse(answer);
        if (Number(parsed?.result?.code) === 0) return;
        this.ErrorManagement.throw(this.ErrorCodes.TICKET_ENGINE_ERROR, JSON.stringify(parsed));
    }

    /** One record, one transaction, so a bad record cannot roll back the good ones. */
    async storeRecord(req, context, trx, cfg) {
        try {
            await this.withTransaction(req.dbConn,
                () => context.execute(req.dbConn, trx, cfg, req.sessionId));
        } catch (error) {
            if (isUniqueViolation(error)) return;
            // The rollback has already happened, so the error record is written on its own and
            // survives it. Losing it would erase the only evidence of the bad record.
            if (DatabaseError.isSqlDataFormatError(error)) {
                await this.recordError(req, cfg, DatabaseError.getErrorMessage(error),
                    DatabaseError.getErrorCode(error));
                return;
            }
            // process() puts the Java wording on it; rethrowing raw keeps that from nesting.
            throw error;
        }
    }

    async recordError(req, cfg, message, code) {
        await this.withTransaction(req.dbConn, () => this.errorTdDao.insertErrorTd(req.dbConn, {
            td_data: req.rawBody == null ? null : String(req.rawBody),
            error_message: message,
            error_code: code,
            system_id: cfg.systemId,
            bus_id: cfg.busId,
            station_type: cfg.stationType,
            request_url: req.originalUrl,
        }, req.sessionId));
    }

    /**
     * Station type 1 and 5 are buses. One system runs an older set of statements on them, and
     * everything else is a station.
     */
    async selectContext(req, cfg) {
        if (!this.Constant.BUS_STATION_TYPES.has(String(cfg.stationType))) {
            return this.stationContext;
        }
        if (String(cfg.systemId) === '106') {
            const compCode = await this.mstBus.getCompCode(req.dbConn, cfg.busId, req.sessionId);
            if (compCode !== 1) return this.tchewContext;
        }
        return this.dataContext;
    }

    senddataConfig(req, res) {
        const systemId = String(res.locals.systemId);
        return {
            systemId,
            busId: req.query.busid ?? null,
            stationType: req.query.stationtype ?? null,
            // These systems always store the raw amount, whatever the config says.
            currencyMultiplier: this.Constant.FORCED_UNIT_MULTIPLIER_SYSTEMS.has(systemId)
                ? 1 : Number(this.cfg(req, 'currency_multiplier', this.Constant.DEFAULT_CURRENCY_MULTIPLIER)),
            saveExtendedFare: this.cfgBool(req, 'save_extended_fare', false),
            getTotalStopCntFromPattern: this.cfgBool(req, 'get_total_stop_cnt_from_pattern', false),
            cardTypeCheckList: this.cfgList(req, 'card_type_check', []),
            // Java's SystemConfig defaulted credit_card_type to the single type 11.
            creditCardTypes: this.cfgList(req, 'credit_card_type', ['11']),
            // A test system reports every credit card ride to the gateway, not just the ones
            // the device left unpriced.
            serverEnvironment: this.cfg(req, 'server_environment', this.Constant.PRODUCTION),
            toKafka: this.kafkaEnabled(req, 'senddata'),
            // senddata is the one function Java still gave a connection to on the kafka-only
            // path, because the mst_bus check and the ticket engine URL both need one.
            dbEnabled: !this.kafkaOnly(req, 'senddata'),
        };
    }
}

module.exports = new SendData();
