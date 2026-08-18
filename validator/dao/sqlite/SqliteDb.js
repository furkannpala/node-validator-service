const { DatabaseSync, backup } = require("node:sqlite");
const { ULog } = require("../../../../../lib/utils");

/**
 * The in-memory database the two generators fill and then copy to a file, which is what Java's
 * "backup to <path>" did through the xerial driver.
 *
 * Journal mode is deliberately left alone: WAL would put -wal and -shm files next to the .db
 * and the device only ever receives the .db, so it would get a file that is missing writes.
 */

function open() {
    return new DatabaseSync(":memory:");
}

/** Java held one transaction open around every table and committed once at the end. */
function begin(db) {
    db.exec("BEGIN");
}

function commit(db) {
    db.exec("COMMIT");
}

async function backupTo(db, filePath, sessionId) {
    ULog.debug(`sqlite backup to ${filePath}`, sessionId);
    await backup(db, filePath);
}

/**
 * Java dropped every table here instead, because it never closed the in-memory connection.
 * Closing releases the same memory and leaves nothing behind.
 */
function close(db) {
    db.close();
}

module.exports = { open, begin, commit, backupTo, close };
