const { debugSql } = require("../sqlLog");

/**
 * Shared behaviour of the generated .db files. node:sqlite is synchronous, so the Oracle read
 * is awaited first and the whole table is then written in one blocking pass (see the migration
 * notes on DatabaseSync); nothing here yields.
 */
class SqliteBaseDao {

    exec(db, sql, sessionId) {
        debugSql(sql, undefined, sessionId);
        db.exec(sql);
    }

    /** Creates the table and whatever indexes go with it. */
    create(db, sessionId) {
        for (const sql of this.ddl) this.exec(db, sql, sessionId);
    }

    /**
     * One prepared statement for the whole table. An undefined bind is a TypeError here, not a
     * null, so every mapper has to answer with null explicitly.
     */
    insertAll(db, rows, sessionId) {
        if (!rows || !rows.length) return 0;
        debugSql(`${this.insertSql} x${rows.length}`, undefined, sessionId);
        const statement = db.prepare(this.insertSql);
        for (const row of rows) statement.run(...this.bind(row));
        return rows.length;
    }
}

module.exports = SqliteBaseDao;
