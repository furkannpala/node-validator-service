const BaseDao = require("../BaseDao");

// Report package. runin_progress and end_of_shift take the same four params; ?ontrip=0 picks
// the second one, exactly as Java Services.doProcess did.
class PkRepDaoImpl extends BaseDao {

    driverPlanSql = ' BEGIN pk_rep.sp_rep_driver_plan(:driverid, :lang, :out_result); END; ';
    runInProgressReportSql = ' BEGIN pk_rep.sp_rep_runin_progress_report(:samid, :termno, :startdate, :lang, :out_result); END; ';
    endOfShiftReportSql = ' BEGIN pk_rep.end_of_shift_report(:samid, :termno, :startdate, :lang, :out_result); END; ';

    driverPlan(conn, data, sessionId) { return this.callLob(conn, this.driverPlanSql, data, sessionId); }
    runInProgressReport(conn, data, sessionId) { return this.callLob(conn, this.runInProgressReportSql, data, sessionId); }
    endOfShiftReport(conn, data, sessionId) { return this.callLob(conn, this.endOfShiftReportSql, data, sessionId); }
}

module.exports = new PkRepDaoImpl();
