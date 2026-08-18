const SqliteBaseDao = require("./SqliteBaseDao");

// The whole content of the free card file: BLACK_LIST_20 copied one to one. The unique index
// on csn means a repeated card serial in Oracle fails the generation, as it did in Java.
class TblRfcardFreeDaoImpl extends SqliteBaseDao {

    ddl = [
        "CREATE TABLE Tbl_RFCARD_FREE (csn char(10),expired_date char(8),passenger_type char(2),"
        + "black_list number,card_no char(16))",
        "CREATE UNIQUE INDEX idx_Tbl_RFCARD_FREE ON Tbl_RFCARD_FREE (csn)",
    ];

    insertSql = "INSERT INTO Tbl_RFCARD_FREE (csn, expired_date, passenger_type, black_list, "
        + "card_no) VALUES (?,?,?,?,?)";

    bind(row) {
        return [
            row.CSN ?? null,
            row.EXPIRED_DATE ?? null,
            row.PASSENGER_TYPE ?? null,
            row.BLACK_LIST ?? null,
            row.CARD_NO ?? null,
        ];
    }
}

module.exports = new TblRfcardFreeDaoImpl();
