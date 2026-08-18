const BaseDao = require("../BaseDao");

// The contactless side of a ticket. PDATE is the only column the caller does not supply; Java
// rounded SYSDATE to the day inside the statement and that expression is kept verbatim.
class AfcTdEmvDaoImpl extends BaseDao {

    insertSql = 'INSERT INTO AFC_TD_EMV(PTCN, BOARDING_DATE_TIME, SAM_ID, TERM_NO, ENC_PAN, '
        + 'MASKED_PAN, BIN, LATE_AUTH, EXPIRED_DATE, AMOUNT, PAN_SEQUENCE, KEY_TYPE, KEY_INDEX, '
        + 'ONUS,PDATE,CURRENCY_CODE,CARD_NO,USAGE_CNT,ALIAS_NO,TRANS_RESULT,FARE_FILE_VERSION,'
        + 'TRAVEL_TYPE) VALUES(:ptcn,:boarding_date_time,:sam_id,:term_no,:enc_pan,:masked_pan,'
        + ':bin,:late_auth,:expired_date,:amount,:pan_sequence,:key_type,:key_index,:onus,'
        + "TO_DATE(TO_CHAR(SYSDATE,'dd.mm.yyyy'),'dd.mm.yyyy'),:currency_code,:card_no,"
        + ':usage_cnt,:alias_no,:trans_result,:fare_file_version,:travel_type)';

    /** amount is already divided by the currency multiplier; see DRecordStrategy.emvAmount. */
    async insert(conn, trx, amount, sessionId) {
        const binds = {
            ptcn: trx.ptcn,
            boarding_date_time: trx.boarding_date_time,
            sam_id: trx.sam_id,
            term_no: trx.term_no,
            enc_pan: trx.enc_pan,
            masked_pan: trx.masked_pan,
            bin: trx.bin,
            late_auth: trx.late_auth,
            expired_date: trx.expired_date,
            amount,
            pan_sequence: trx.pan_sequence,
            key_type: trx.key_type,
            key_index: trx.key_index,
            onus: trx.on_us,
            currency_code: trx.currency_code,
            card_no: trx.card_no,
            usage_cnt: trx.usage_cnt,
            alias_no: trx.alias_no,
            trans_result: trx.trans_result,
            fare_file_version: trx.fare_file_version,
            travel_type: trx.travel_type,
        };
        return await this.execIgnoreDuplicate(conn, this.insertSql, binds, sessionId);
    }
}

module.exports = new AfcTdEmvDaoImpl();
