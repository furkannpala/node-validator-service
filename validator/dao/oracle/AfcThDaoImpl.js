const BaseDao = require("../BaseDao");

// The driver shift row. Java updated it and inserted when nothing was touched, so upsert #2
// becomes one MERGE. The ON columns are the three the UPDATE matched on and none of them
// appears in the SET list, which Oracle would reject with ORA-38104.
const COLS = 'DRIVER_CODE,ALIAS_NO,START_DATE_TIME,END_DATE_TIME,SAM_ID,TRAVEL_TYPE,PDATE,'
    + 'SAM_SEQ_NO_START,SAM_SEQ_NO_END,RDATE';

const VALUES = ':driver_code,:alias_no,:start_date_time,:boarding_date_time,:sam_id,:travel_type,'
    + 'pk_config.fn_get_operation_pdate(),:sam_seq_no,:sam_seq_no,'
    + 'pk_config.fn_get_operation_date(:start_date_time)';

function toBind(trx) {
    return {
        driver_code: trx.driver_code,
        alias_no: trx.alias_no,
        start_date_time: trx.start_date_time,
        boarding_date_time: trx.boarding_date_time,
        sam_id: trx.sam_id,
        travel_type: trx.travel_type,
        sam_seq_no: trx.sam_seq_no,
    };
}

class AfcThDaoImpl extends BaseDao {

    insertSql = `INSERT INTO afc_th(${COLS}) VALUES(${VALUES})`;

    mergeSql = 'MERGE INTO afc_th t '
        + 'USING (SELECT :start_date_time start_date_time, :sam_id sam_id, :alias_no alias_no FROM DUAL) s '
        + 'ON (t.start_date_time=s.start_date_time AND t.sam_id=s.sam_id AND t.alias_no=s.alias_no) '
        + 'WHEN MATCHED THEN UPDATE SET end_date_time=:boarding_date_time, travel_type=:travel_type, '
        + 'sam_seq_no_end=:sam_seq_no '
        + `WHEN NOT MATCHED THEN INSERT (${COLS}) VALUES(${VALUES})`;

    insert(conn, trx, sessionId) {
        return this.exec(conn, this.insertSql, toBind(trx), sessionId);
    }

    merge(conn, trx, sessionId) {
        return this.exec(conn, this.mergeSql, toBind(trx), sessionId);
    }
}

module.exports = new AfcThDaoImpl();
