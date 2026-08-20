const BaseDao = require("../BaseDao");

// The fare side of AFC_TD: the host asks for the taps it has not priced yet, prices them
// elsewhere and sends the amounts back.
class AfcTdFareDaoImpl extends BaseDao {

    // Kept character for character, tab and all, from FareTransactionOperations.
    getUncalculatedSql = "SELECT TO_CHAR(A.PDATE,'dd.mm.yyyy') PDATE,\r\n"
        + "       A.BOARDING_DATE_TIME,\r\n"
        + "       A.CARD_NO,\r\n"
        + "       A.SAM_ID,\r\n"
        + "       A.USAGE_CNT,\r\n"
        + "       nvl(B.PASSENGER_TYPE,A.PASSENGER_TYPE) PASSENGER_TYPE,\r\n"
        + "       B.CARD_TYPE,\r\n"
        + "       C.ROUTE_CODE,\r\n"
        + "       A.PASSENGER_TYPE HOST_PASSENGER_TYPE\r\n"
        + "  FROM AFC_TD A, TBL_RFCARD B, AFC_TF C\r\n"
        + " WHERE     A.CARD_NO = B.CARD_NO\r\n"
        + "       AND B.CARD_NO LIKE '637243%'\r\n"
        + "       AND A.START_DATE_TIME = C.START_DATE_TIME\r\n"
        + "       AND A.SAM_ID = C.SAM_ID\r\n"
        + "       AND A.TRAVEL_SEQ_NO = C.TRAVEL_SEQ_NO\r\n"
        + "       AND A.PDATE >= PK_CONFIG.FN_GET_OPERATION_PDATE() -1"
        + "\t      AND A.FARE_CALC_STATUS='0'";

    updateFareSql = 'UPDATE AFC_TD set usage_amt=:usage_amt,fare_calc_status=:fare_calc_status'
        + ' where card_no=:card_no and boarding_date_time=:boarding_date_time '
        + 'and usage_cnt=:usage_cnt';

    async getUncalculated(conn, sessionId) {
        this.debugSql(this.getUncalculatedSql, undefined, sessionId);
        const result = await conn.execute(this.getUncalculatedSql, [],
            { outFormat: this.oracledb.OUT_FORMAT_OBJECT });
        return result.rows || [];
    }

    async updateFare(conn, binds, sessionId) {
        return await this.exec(conn, this.updateFareSql, binds, sessionId);
    }
}

module.exports = new AfcTdFareDaoImpl();
