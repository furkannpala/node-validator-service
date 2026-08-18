const BaseDao = require("../BaseDao");

// Two callers, two statements. The alarm path marks a message as read by its id alone; the
// readmessage endpoint scopes the same act to one bus and does not touch STATUS.
class GuiMessageLogDaoImpl extends BaseDao {

    markReadByAlarmSql = "UPDATE GUI_MESSAGE_LOG SET STATUS=2, "
        + "READ_TIME=TO_CHAR(SYSDATE,'yyyymmddhh24miss'), READER_ID=:reader_id WHERE MESSAGE_ID=:message_id";

    markReadByBusSql = "UPDATE GUI_MESSAGE_LOG SET read_time = TO_CHAR(SYSDATE, 'YYYYMMDDHH24MISS') "
        + "WHERE bus_id = :bus_id AND message_id = :message_id";

    markReadByAlarm(conn, data, sessionId) {
        return this.exec(conn, this.markReadByAlarmSql, data, sessionId);
    }

    markReadByBus(conn, data, sessionId) {
        return this.exec(conn, this.markReadByBusSql, data, sessionId);
    }
}

module.exports = new GuiMessageLogDaoImpl();
