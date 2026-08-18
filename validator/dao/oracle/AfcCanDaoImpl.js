const BaseDao = require("../BaseDao");
const StringUtil = require("../../../util/StringUtil");

// Every measurement is bound as a float with no fallback, exactly as ins_can did: a missing
// attribute throws and the record is dropped.
const MEASURES = ['total_vehicle_distance', 'accelerator_position', 'engine_load', 'instant_fuel_rate',
    'instant_fuel_economy', 'manifold_temperature', 'engine_boost_pressure', 'vehicle_speed',
    'fuel_level', 'battery_voltage', 'engine_temperature', 'engine_oil_level', 'engine_oil_pressure',
    'engine_hour', 'rpm'];

const COLS = `hostname,createdatetime,${MEASURES.join(',')}`;
const VALUES = `:hostname,:createdatetime,${MEASURES.map((m) => ':' + m).join(',')}`;

class AfcCanDaoImpl extends BaseDao {

    insertSql = `INSERT INTO afc_can(${COLS}) VALUES(${VALUES})`;

    toBind(data) {
        const binds = { hostname: data.sam_id, createdatetime: data.create_date_time };
        for (const m of MEASURES) binds[m] = StringUtil.parseDoubleStrict(data[m]);
        return binds;
    }

    insert(conn, data, sessionId) {
        return this.exec(conn, this.insertSql, this.toBind(data), sessionId);
    }
}

module.exports = new AfcCanDaoImpl();
