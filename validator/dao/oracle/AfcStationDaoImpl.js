const BaseDao = require("../BaseDao");

// Upsert #3. Java's check_st matched on sam_id plus today's operation pdate, not on
// start_date_time as the plan's table says, so the MERGE follows the code.
const COLS = 'sam_id,validator_id,bus_id,comp_code,depot_code,route_code,driver_code,start_date_time,'
    + 'end_date_time,pdate,sam_seq_no_start,sam_seq_no_end';

const VALUES = ':sam_id,:validator_id,:bus_id,:comp_code,:depot_code,:route_code,:driver_code,'
    + ':start_date_time,:boarding_date_time,pk_config.fn_get_operation_pdate(),:sam_seq_no,:sam_seq_no';

function toBind(trx) {
    return {
        sam_id: trx.sam_id,
        validator_id: trx.validator_id,
        bus_id: trx.bus_id,
        comp_code: trx.compCode,
        depot_code: trx.depot_code,
        route_code: trx.route_code,
        driver_code: trx.driver_code,
        start_date_time: trx.start_date_time,
        boarding_date_time: trx.boarding_date_time,
        sam_seq_no: trx.sam_seq_no,
    };
}

class AfcStationDaoImpl extends BaseDao {

    insertSql = `INSERT INTO afc_station (${COLS}) VALUES(${VALUES})`;

    mergeSql = 'MERGE INTO afc_station t '
        + 'USING (SELECT :sam_id sam_id FROM DUAL) s '
        + 'ON (t.sam_id=s.sam_id AND t.pdate=pk_config.fn_get_operation_pdate()) '
        + 'WHEN MATCHED THEN UPDATE SET end_date_time=:boarding_date_time, sam_seq_no_end=:sam_seq_no '
        + `WHEN NOT MATCHED THEN INSERT (${COLS}) VALUES(${VALUES})`;

    insert(conn, trx, sessionId) {
        return this.exec(conn, this.insertSql, toBind(trx), sessionId);
    }

    merge(conn, trx, sessionId) {
        return this.exec(conn, this.mergeSql, toBind(trx), sessionId);
    }
}

module.exports = new AfcStationDaoImpl();
