const BaseDao = require("../BaseDao");
const { debugSql } = require("../sqlLog");

/**
 * Both TBL_RFCARD statements of the service live here: getcardinfo reads the card, and the
 * ticket path writes back the CSN the device reported. Java kept them in two classes, but the
 * one table / one DAO rule of the migration puts them together.
 */
class TblRfcardDaoImpl extends BaseDao {

    // Leading and trailing spaces are Java's; the text is left untouched on purpose.
    getCardSql = " SELECT CARD_NO,ALIAS_NO,'0' REGISTERED, PASSENGER_TYPE, "
        + 'NVL(USAGE_CNT,0) USAGE_CNT FROM TBL_RFCARD WHERE CARD_NO=:card_no ';

    updateCsnSql = 'UPDATE TBL_RFCARD SET CSN = :csn WHERE CARD_NO = :card_no';

    /** Returns the row, or null when the card is unknown; the caller answers differently. */
    async getCard(conn, cardNo, sessionId) {
        const binds = { card_no: cardNo };
        debugSql(this.getCardSql, binds, sessionId);
        const result = await conn.execute(this.getCardSql, binds,
            { outFormat: this.oracledb.OUT_FORMAT_OBJECT });
        return (result.rows || [])[0] || null;
    }

    /**
     * Java logged a failure here and carried on, so a rejected CSN never costs the ticket that
     * carried it. The surrounding transaction survives because Oracle only fails the statement.
     */
    async updateCsn(conn, cardNo, csn, sessionId) {
        try {
            return await this.exec(conn, this.updateCsnSql, { csn, card_no: cardNo }, sessionId);
        } catch (e) {
            this.ULog.error(`Error updating TBL_RFCARD.CSN for card_no: ${cardNo}, `
                + `csn: ${csn}: ${e?.message}`, sessionId);
            return 0;
        }
    }
}

module.exports = new TblRfcardDaoImpl();
