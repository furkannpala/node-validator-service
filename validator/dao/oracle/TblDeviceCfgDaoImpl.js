const BaseDao = require("../BaseDao");

// Java ran an UPDATE and fell back to an INSERT when it touched no row. That is upsert #5 in
// the plan; one MERGE replaces the pair and removes the race between the two statements.
const COLUMNS = [
    ['DEVICE_ID', ':device_id'], ['TERMINAL_NO', ':terminal_no'], ['DEPOT_CODE', ':depot_code'],
    ['SAM_ID', ':sam_id'], ['STATION_TYPE', ':station_type'], ['VALIDATOR_ID', ':validator_id'],
    ['DRIVER_CODE', ':driver_code'], ['ROUTE_CODE', ':route_code'], ['ACTIVE_CONNECTION', ':active_connection'],
    ['GPRS_IP', ':gprs_ip'], ['ETH_IP', ':eth_ip'], ['MODEM_INFO1', ':modem_info1'],
    ['MODEM_INFO2', ':modem_info2'], ['MODEM_INFO3', ':modem_info3'], ['MODEM_INFO4', ':modem_info4'],
    ['BLACK_LIST_VERSION', ':black_list_version'], ['FARE_TABLE_VERSION', ':fare_table_version'],
    ['PARA_VERSION', ':para_version'], ['SOFTWARE_VERSION', ':software_version'], ['SAM_VERSION', ':sam_version'],
    ['FIRMWARE_VERSION', ':firmware_version'], ['KERNEL_VERSION', ':kernel_version'],
    ['IMAGE_VERSION', ':image_version'], ['DP_VERSION', ':dp_version'], ['BACKUP_DISK', ':backup_disk'],
    ['CREATEDATETIME', ':createdatetime'], ['CONFRM_STATE', ':confrm_state'], ['MODULE_STATE', ':module_state'],
    ['SAM_MODULE_STATE', ':sam_module_state'], ['FLASH_USAGE_COUNT', ':flash_usage_count'],
    ['FLASH_ID', ':flash_id'], ['BOOT_PARAM_NAME', ':boot_param_name'], ['LINUX_PARAM', ':linux_param'],
    ['CPU_SPEED', ':cpu_speed'], ['CONSOLE', ':console'], ['CICO_MODE', ':cico_mode'],
    ['MULTI_DROP_MODE', ':multi_drop_mode'], ['STOP_INDEX', ':stop_index'], ['DEVICE_TYPE', ':device_type'],
    ['PDATE', 'pk_config.fn_get_operation_pdate()'], ['UPTIME', ':uptime'], ['FREE_SPACE', ':free_space'],
    ['FREE_MEM', ':free_mem'], ['FREE_SPI_SPACE', ':free_spi_space'], ['CHIP_ID', ':chip_id'],
    ['SECOND_SAM_ID', ':second_sam_id'], ['SECOND_SAM_VERSION', ':second_sam_version'],
];

// Row identity — Oracle rejects an ON column inside SET with ORA-38104, so they are filtered out.
const ON_COLS = new Set(['DEVICE_ID', 'SAM_ID']);

const COL_NAMES = COLUMNS.map((c) => c[0]).join(',');
const VAL_EXPRS = COLUMNS.map((c) => c[1]).join(',');
const SET_EXPRS = COLUMNS.filter((c) => !ON_COLS.has(c[0])).map((c) => `${c[0]}=${c[1]}`).join(', ');

class TblDeviceCfgDaoImpl extends BaseDao {

    mergeSql = 'MERGE INTO tbl_device_cfg t '
        + 'USING (SELECT :device_id AS device_id, :sam_id AS sam_id FROM dual) s '
        + 'ON (t.DEVICE_ID = s.device_id AND t.SAM_ID = s.sam_id) '
        + `WHEN MATCHED THEN UPDATE SET ${SET_EXPRS} `
        + `WHEN NOT MATCHED THEN INSERT (${COL_NAMES}) VALUES(${VAL_EXPRS})`;

    /** trx is a CfgTransaction; the column order above is the Java statement's order. */
    toBind(trx) {
        return {
            device_id: trx.bus_id,
            terminal_no: trx.terminal_no,
            depot_code: trx.depot_code,
            sam_id: trx.sam_id,
            station_type: trx.station_type,
            // Java bound pcb_id here, not the validator_id variable it had just filled.
            validator_id: String(trx.pcb_id).toUpperCase(),
            driver_code: trx.driver_code,
            route_code: trx.route_code,
            active_connection: trx.active_connection,
            gprs_ip: trx.gprs_ip,
            eth_ip: trx.eth_ip,
            modem_info1: trx.modem_info1,
            modem_info2: trx.modem_info2,
            modem_info3: trx.modem_info3,
            modem_info4: trx.modem_info4,
            black_list_version: trx.black_list_version,
            fare_table_version: trx.fare_table_version,
            para_version: trx.para_version,
            software_version: trx.software_version,
            sam_version: trx.sam_version,
            firmware_version: trx.firmware_version,
            kernel_version: trx.kernel_version,
            image_version: trx.image_version,
            dp_version: trx.dpversion,
            backup_disk: trx.backup_disk,
            createdatetime: trx.createdatetime,
            confrm_state: trx.confrm_state,
            module_state: trx.half_progress_type,
            sam_module_state: trx.sam_module_state,
            flash_usage_count: trx.flash_usage_count,
            flash_id: trx.flash_id,
            boot_param_name: trx.boot_param_name,
            linux_param: trx.linux_param,
            cpu_speed: trx.cpu_speed,
            console: trx.console,
            cico_mode: trx.cico_mode,
            multi_drop_mode: trx.multi_drop_mode,
            stop_index: trx.stop_index,
            device_type: trx.getDevice_type(),
            uptime: trx.uptime,
            free_space: trx.free_space,
            free_mem: trx.free_mem,
            free_spi_space: trx.free_spi_space,
            chip_id: trx.chip_id,
            second_sam_id: trx.second_sam_id,
            second_sam_version: trx.second_sam_version,
        };
    }

    merge(conn, trx, sessionId) {
        return this.exec(conn, this.mergeSql, this.toBind(trx), sessionId);
    }
}

module.exports = new TblDeviceCfgDaoImpl();
