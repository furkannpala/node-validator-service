const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const { isUniqueViolation } = require("../dao/daoUtil");

const VALUE_TOO_LARGE = 1438;

const CAN_ATTRS = { createdatetime: 'create_date_time', hostname: 'sam_id' };
const MEASURES = ['total_vehicle_distance', 'accelerator_position', 'engine_load', 'instant_fuel_rate',
    'instant_fuel_economy', 'manifold_temperature', 'engine_boost_pressure', 'vehicle_speed',
    'fuel_level', 'battery_voltage', 'engine_temperature', 'engine_oil_level', 'engine_oil_pressure',
    'engine_hour', 'rpm'];

class SendCan extends ValidatorControllerBase {
    constructor() {
        super();
        this.canDao = this.daoFactory.get("AfcCanDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " SendCan ", "");
            await this.store(req);
            this.okResponse(res);
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }

    /**
     * ins_can ended in an empty catch, so anything other than a duplicate key stopped the loop
     * without ever reaching the caller. The endpoint still answers OK; only the log records it.
     */
    async store(req) {
        const data = {};
        try {
            for (const element of this.bodyElements(req)) {
                const name = element.name.toLowerCase();
                if (name === "can") {
                    this.collect(data, element.attrs, CAN_ATTRS);
                } else if (name === "data") {
                    this.collect(data, element.attrs, null);
                    await this.storeOne(req, data);
                }
            }
        } catch (error) {
            this.ULog.error(`sendcan stopped after an error: ${error?.message}`, req.sessionId);
        }
    }

    /** Attribute names are matched case insensitively here, as compareToIgnoreCase did. */
    collect(data, attrs, map) {
        for (const [name, value] of Object.entries(attrs)) {
            const key = name.toLowerCase();
            if (map) {
                if (map[key]) data[map[key]] = value;
            } else if (MEASURES.includes(key)) {
                data[key] = value;
            }
        }
    }

    async storeOne(req, data) {
        try {
            await this.withTransaction(req.dbConn, () => this.canDao.insert(req.dbConn, data, req.sessionId));
        } catch (error) {
            if (isUniqueViolation(error) || error?.errorNum === VALUE_TOO_LARGE) return;
            throw error;
        }
    }
}

module.exports = new SendCan();
