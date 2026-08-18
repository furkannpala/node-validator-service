const BaseDao = require("../BaseDao");

// SQL text carried over from the Java service unchanged; only the positional `?` binds became
// named ones. Parameter order is the procedure signature and must not be "tidied".
class PkAppValDaoImpl extends BaseDao {

    setValStatusSql = ' BEGIN pk_app_val.sp_setval_status(:busid, :ipaddr, :status, :connected, :parameters); END; ';
    getCfgFileSql = ' BEGIN pk_app_val.sp_get_cfgfile(:busid, :filever, :fileid, :filename, :lobtype, :content_clob, :content_blob); END; ';
    getFileFromPathSql = ' BEGIN pk_app_val.sp_get_file_from_path(:busid, :fileid, :type, :lobtype, :content_clob, :content_blob); END; ';
    createBlacklistSql = ' BEGIN pk_app_val.sp_create_blacklist(:version, :out_result); END; ';
    getCardListBlobSql = ' BEGIN pk_app_val.sp_get_card_list_blob(:samid, :version, :out_result); END; ';
    createScheduleSql = ' BEGIN pk_app_val.sp_create_schedule(:busid, :driverid, :routecode, :out_result); END; ';
    getTdPdateSql = ' BEGIN pk_app_val.sp_get_td_pdate(:busid, :pdate, :pdate2, :out_result); END; ';
    tdReportIntervalSql = ' BEGIN pk_app_val.sp_td_report_interval(:busid, :pdate, :pdate2, :out_result); END; ';
    getRouteCoordinateSql = ' BEGIN pk_app_val.sp_get_route_coordinate(:routecode, :version, :out_result); END; ';
    getDeviceInfoSql = ' BEGIN pk_app_val.sp_get_device_info(:busid, :samid, :validatorid, :datetime, :oldbusid, :seqno, :out_result); END; ';
    getMessageInfoSql = ' BEGIN pk_app_val.sp_get_message_info(:busid, :out_result); END; ';
    getValidatorListSql = ' BEGIN pk_app_val.sp_get_validator_list(:busid, :out_result); END; ';
    getBusRouteListSql = ' BEGIN pk_app_val.sp_get_bus_route_list(:busid, :routecode, :routecnt); END; ';
    setDriverPasswordSql = ' BEGIN pk_app_val.sp_set_driver_password(:busid, :driverid, :pass, :retval); END; ';
    setDeviceWlanStatusSql = ' BEGIN pk_app_val.sp_setdevice_wlan_status(:busid, :samid, :gprsip, :wlanip, :wlanstatus); END; ';
    alarmTakeConfirmationSql = ' BEGIN pk_app_val.sp_alarm_take_confirmation(:alarmbutton, :message, :messageid); END; ';
    alarmMessageLogSql = ' BEGIN pk_app_val.sp_alarm_message_log(:busid, :messageid, :message, :result); END; ';
    createRouteBusStopSql = ' BEGIN pk_app_val.sp_create_route_busstop(:version, :groupid, :samid, :out_result); END; ';
    createBusStopSql = ' BEGIN pk_app_val.sp_create_busstop(:version, :samid, :out_result); END; ';
    getRouteSql = ' BEGIN pk_app_val.sp_get_route(:version, :busid, :opdate, :out_result); END; ';
    getPathSql = ' BEGIN pk_app_val.sp_get_path(:version, :busid, :opdate, :out_result); END; ';
    getRoutePathSql = ' BEGIN pk_app_val.sp_get_route_path(:version, :busid, :opdate, :out_result); END; ';
    getPathStageSql = ' BEGIN pk_app_val.sp_get_path_stage(:version, :busid, :opdate, :out_result); END; ';
    getBusStopSql = ' BEGIN pk_app_val.sp_get_busstop(:version, :busid, :opdate, :out_result); END; ';
    getPathBusStopSql = ' BEGIN pk_app_val.sp_get_path_busstop(:version, :busid, :opdate, :out_result); END; ';
    getRouteScheduleSql = ' BEGIN pk_app_val.sp_get_route_schedule(:version, :busid, :showtime, :opdate, :out_result); END; ';
    getSchedulePlanSql = ' BEGIN pk_app_val.sp_get_schedule_plan(:busid, :version, :opdate, :out_result); END; ';
    getStageSql = ' BEGIN pk_app_val.sp_get_stage(:version, :busid, :opdate, :out_result); END; ';
    getTripTypeSql = ' BEGIN pk_app_val.sp_get_trip_type(:busid, :out_result); END; ';
    getDriverPasswordSql = ' BEGIN pk_app_val.sp_get_driver_password(:busid, :driverid, :out_result); END; ';
    getDriverWorkHoursSql = ' BEGIN pk_app_val.sp_getdriverworkhours(:busid, :driverid, :aliasno, :out_result); END; ';
    getValidatorCfgSql = ' BEGIN pk_app_val.sp_get_validator_cfg(:busid, :samid, :out_result); END; ';
    getAvlRulesSql = ' BEGIN pk_app_val.sp_get_avl_rules(:busid, :version, :out_result); END; ';
    getBusParkPlaceSql = ' BEGIN pk_app_val.sp_get_bus_park_place(:pdate, :busid, :out_result); END; ';
    getZoneSql = ' BEGIN pk_app_val.sp_get_zone(:busid, :version, :out_result); END; ';
    getAfcOdMatrixSql = ' BEGIN pk_app_val.sp_get_afc_od_matrix(:busid, :version, :out_result); END; ';
    getAfcZoneGroupSql = ' BEGIN pk_app_val.sp_get_afc_zone_group(:busid, :version, :out_result); END; ';
    getAfcFaresSql = ' BEGIN pk_app_val.sp_get_afc_fares(:busid, :version, :out_result); END; ';
    getAfcProductSql = ' BEGIN pk_app_val.sp_get_afc_product(:busid, :version, :out_result); END; ';
    getMstProductTypeSql = ' BEGIN pk_app_val.sp_get_mst_product_type(:busid, :version, :out_result); END; ';
    getDutyScheduleSql = ' BEGIN pk_app_val.sp_get_duty_schedule(:version, :busid, :showtime, :opdate, :out_result); END; ';
    // The argument is a type code ("M"), not a bus id; it returns the operation-day offset
    // in minutes that the file cache uses to decide when a cached day rolls over.
    getSystemPdateSql = ' SELECT PK_APP_VAL.fn_get_system_pdate(:type) AS PDATE FROM dual ';

    async setValStatus(conn, data, sessionId) {
        this.ULog.debug(this.setValStatusSql + " " + this.maskJson(data), sessionId);
        return await conn.execute(this.setValStatusSql, data);
    }

    /**
     * Two OUT LOBs of which the procedure fills exactly one. The file name comes back
     * separately because Java put it in the download header.
     */
    async getCfgFile(conn, data, sessionId) {
        data.filename = { dir: this.oracledb.BIND_OUT, type: this.oracledb.STRING };
        data.lobtype = { dir: this.oracledb.BIND_OUT, type: this.oracledb.STRING };
        data.content_clob = { dir: this.oracledb.BIND_OUT, type: this.oracledb.CLOB };
        data.content_blob = { dir: this.oracledb.BIND_OUT, type: this.oracledb.BLOB };
        this.ULog.debug(this.getCfgFileSql + " " + this.maskJson(data), sessionId);

        const result = await conn.execute(this.getCfgFileSql, data);
        const out = result.outBinds;
        const lob = out.content_clob || out.content_blob;
        if (!lob) throw new Error("Unknown file lob type " + out.lobtype);
        return { fileName: out.filename, lobType: out.lobtype, content: await lob.getData() };
    }

    async getFileFromPath(conn, data, sessionId) {
        data.lobtype = { dir: this.oracledb.BIND_OUT, type: this.oracledb.STRING };
        data.content_clob = { dir: this.oracledb.BIND_OUT, type: this.oracledb.CLOB };
        data.content_blob = { dir: this.oracledb.BIND_OUT, type: this.oracledb.BLOB };
        this.ULog.debug(this.getFileFromPathSql + " " + this.maskJson(data), sessionId);

        const result = await conn.execute(this.getFileFromPathSql, data);
        const out = result.outBinds;
        const lob = out.content_clob || out.content_blob;
        if (!lob) throw new Error("Unknown file lob type " + out.lobtype);
        return { lobType: out.lobtype, content: await lob.getData() };
    }

    /** Returns a route count, not a LOB; Java threw when it came back <= 0. */
    async getBusRouteList(conn, data, sessionId) {
        data.routecnt = { dir: this.oracledb.BIND_OUT, type: this.oracledb.NUMBER };
        this.ULog.debug(this.getBusRouteListSql + " " + this.maskJson(data), sessionId);
        const result = await conn.execute(this.getBusRouteListSql, data);
        return result.outBinds.routecnt;
    }

    /** The procedure reports its own failure in an OUT code; a non-zero value is the error. */
    async setDriverPassword(conn, data, sessionId) {
        data.retval = { dir: this.oracledb.BIND_OUT, type: this.oracledb.NUMBER };
        this.ULog.debug(this.setDriverPasswordSql + " " + this.maskJson(data), sessionId);
        const result = await conn.execute(this.setDriverPasswordSql, data);
        return result.outBinds.retval;
    }

    setDeviceWlanStatus(conn, data, sessionId) {
        return this.exec(conn, this.setDeviceWlanStatusSql, data, sessionId);
    }

    /** Returns the message to display on the bus and its id; id 0 means there is nothing to send. */
    async alarmTakeConfirmation(conn, data, sessionId) {
        data.message = { dir: this.oracledb.BIND_OUT, type: this.oracledb.STRING };
        data.messageid = { dir: this.oracledb.BIND_OUT, type: this.oracledb.NUMBER };
        this.ULog.debug(this.alarmTakeConfirmationSql + " " + this.maskJson(data), sessionId);
        const result = await conn.execute(this.alarmTakeConfirmationSql, data);
        return { message: result.outBinds.message, messageId: result.outBinds.messageid };
    }

    alarmMessageLog(conn, data, sessionId) {
        return this.exec(conn, this.alarmMessageLogSql, data, sessionId);
    }

    async getSystemPdate(conn, data, sessionId) {
        this.ULog.debug(this.getSystemPdateSql + " " + this.maskJson(data), sessionId);
        const result = await conn.execute(this.getSystemPdateSql, data,
            { outFormat: this.oracledb.OUT_FORMAT_OBJECT });
        return result.rows[0]?.PDATE;
    }

    createBlacklist(conn, data, sessionId) { return this.callLob(conn, this.createBlacklistSql, data, sessionId); }
    getCardListBlob(conn, data, sessionId) { return this.callLob(conn, this.getCardListBlobSql, data, sessionId, this.oracledb.BLOB); }
    createSchedule(conn, data, sessionId) { return this.callLob(conn, this.createScheduleSql, data, sessionId); }
    getTdPdate(conn, data, sessionId) { return this.callLob(conn, this.getTdPdateSql, data, sessionId); }
    tdReportInterval(conn, data, sessionId) { return this.callLob(conn, this.tdReportIntervalSql, data, sessionId); }
    getRouteCoordinate(conn, data, sessionId) { return this.callLob(conn, this.getRouteCoordinateSql, data, sessionId); }
    getDeviceInfo(conn, data, sessionId) { return this.callLob(conn, this.getDeviceInfoSql, data, sessionId); }
    getMessageInfo(conn, data, sessionId) { return this.callLob(conn, this.getMessageInfoSql, data, sessionId); }
    getValidatorList(conn, data, sessionId) { return this.callLob(conn, this.getValidatorListSql, data, sessionId); }
    createRouteBusStop(conn, data, sessionId) { return this.callLob(conn, this.createRouteBusStopSql, data, sessionId); }
    createBusStop(conn, data, sessionId) { return this.callLob(conn, this.createBusStopSql, data, sessionId); }
    getRoute(conn, data, sessionId) { return this.callLob(conn, this.getRouteSql, data, sessionId); }
    getPath(conn, data, sessionId) { return this.callLob(conn, this.getPathSql, data, sessionId); }
    getRoutePath(conn, data, sessionId) { return this.callLob(conn, this.getRoutePathSql, data, sessionId); }
    getPathStage(conn, data, sessionId) { return this.callLob(conn, this.getPathStageSql, data, sessionId); }
    getBusStop(conn, data, sessionId) { return this.callLob(conn, this.getBusStopSql, data, sessionId); }
    getPathBusStop(conn, data, sessionId) { return this.callLob(conn, this.getPathBusStopSql, data, sessionId); }
    getRouteSchedule(conn, data, sessionId) { return this.callLob(conn, this.getRouteScheduleSql, data, sessionId); }
    getSchedulePlan(conn, data, sessionId) { return this.callLob(conn, this.getSchedulePlanSql, data, sessionId); }
    getStage(conn, data, sessionId) { return this.callLob(conn, this.getStageSql, data, sessionId); }
    getTripType(conn, data, sessionId) { return this.callLob(conn, this.getTripTypeSql, data, sessionId); }
    getDriverPassword(conn, data, sessionId) { return this.callLob(conn, this.getDriverPasswordSql, data, sessionId); }
    getDriverWorkHours(conn, data, sessionId) { return this.callLob(conn, this.getDriverWorkHoursSql, data, sessionId); }
    getValidatorCfg(conn, data, sessionId) { return this.callLob(conn, this.getValidatorCfgSql, data, sessionId); }
    getAvlRules(conn, data, sessionId) { return this.callLob(conn, this.getAvlRulesSql, data, sessionId); }
    getBusParkPlace(conn, data, sessionId) { return this.callLob(conn, this.getBusParkPlaceSql, data, sessionId); }
    getZone(conn, data, sessionId) { return this.callLob(conn, this.getZoneSql, data, sessionId); }
    getAfcOdMatrix(conn, data, sessionId) { return this.callLob(conn, this.getAfcOdMatrixSql, data, sessionId); }
    getAfcZoneGroup(conn, data, sessionId) { return this.callLob(conn, this.getAfcZoneGroupSql, data, sessionId); }
    getAfcFares(conn, data, sessionId) { return this.callLob(conn, this.getAfcFaresSql, data, sessionId); }
    getAfcProduct(conn, data, sessionId) { return this.callLob(conn, this.getAfcProductSql, data, sessionId); }
    getMstProductType(conn, data, sessionId) { return this.callLob(conn, this.getMstProductTypeSql, data, sessionId); }
    getDutySchedule(conn, data, sessionId) { return this.callLob(conn, this.getDutyScheduleSql, data, sessionId); }
}

module.exports = new PkAppValDaoImpl();
