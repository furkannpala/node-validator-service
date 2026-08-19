const { gson } = require('../util/Gson');

// Field names are the XML attribute names, exactly as Java's ins_cfg matched them, so
// applyAttrs needs no translation table. Two attributes are special-cased below.
const FIELDS = [
    'bus_id', 'terminal_no', 'depot_code', 'sam_id', 'station_type', 'validator_id', 'driver_code',
    'route_code', 'gprs_ip', 'black_list_version', 'modem_info1', 'modem_info2', 'modem_info3',
    'modem_info4', 'fare_table_version', 'para_version', 'software_version', 'sam_version',
    'firmware_version', 'dpversion', 'backup_disk', 'createdatetime', 'confrm_state',
    'half_progress_type', 'sam_module_state', 'flash_usage_count', 'active_connection', 'temperature',
    'input_voltage', 'battery_voltage', 'pcb_id', 'flash_id', 'boot_param_name', 'linux_param',
    'cpu_speed', 'console', 'image_version', 'kernel_version', 'page0_erasecount', 'page1_erasecount',
    'free_mem', 'tffs_mount', 'ppp_tx', 'ppp_rx', 'lastread_interval', 'eth_ip', 'sleepmode',
    'cico_mode', 'multi_drop_mode', 'stop_index', 'uptime', 'free_space', 'free_spi_space', 'chip_id',
    'second_sam_id', 'second_sam_version',
];

// The only fields Java did not start at null; the voltages are parsed unguarded downstream.
const DEFAULTS = {
    temperature: '0.00', input_voltage: '0.00', battery_voltage: '0.00',
    pcb_id: '000000', uptime: '', free_space: '', free_spi_space: '',
};

class CfgTransaction {
    constructor() {
        for (const f of FIELDS) this[f] = Object.prototype.hasOwnProperty.call(DEFAULTS, f) ? DEFAULTS[f] : null;
    }

    /**
     * Java declared these variables outside the element loop and never reset them, so a second
     * element inherits every attribute the first one carried. One bean per request keeps that.
     */
    applyAttrs(attrs) {
        for (const [name, value] of Object.entries(attrs || {})) {
            if (!FIELDS.includes(name)) continue;
            this[name] = value;
            // pcb_id fed both variables in Java; only the DAO's uppercased copy reaches the row.
            if (name === 'pcb_id') this.validator_id = value;
        }
    }

    // device_type was a static field on ValidatorDataLoadFuncs that nothing ever assigned.
    getDevice_type() { return 0; }

    /**
     * The sendcfg message, in the field order of Java's CfgTransaction. validator_id is taken
     * from pcb_id unconditionally: Java overwrote it right after setting it and pcb_id starts
     * at "000000", so the branch that guarded the overwrite could never be false.
     */
    toKafkaPayload() {
        return gson({
            bus_id: this.bus_id, terminal_no: this.terminal_no, depot_code: this.depot_code,
            sam_id: this.sam_id, station_type: this.station_type, validator_id: this.pcb_id,
            driver_code: this.driver_code, route_code: this.route_code, gprs_ip: this.gprs_ip,
            black_list_version: this.black_list_version, modem_info1: this.modem_info1,
            modem_info2: this.modem_info2, modem_info3: this.modem_info3,
            modem_info4: this.modem_info4, fare_table_version: this.fare_table_version,
            para_version: this.para_version, software_version: this.software_version,
            sam_version: this.sam_version, firmware_version: this.firmware_version,
            dpversion: this.dpversion, backup_disk: this.backup_disk,
            createdatetime: this.createdatetime, confrm_state: this.confrm_state,
            half_progress_type: this.half_progress_type, sam_module_state: this.sam_module_state,
            flash_usage_count: this.flash_usage_count, active_connection: this.active_connection,
            temperature: this.temperature, input_voltage: this.input_voltage,
            battery_voltage: this.battery_voltage, pcb_id: this.pcb_id, flash_id: this.flash_id,
            boot_param_name: this.boot_param_name, linux_param: this.linux_param,
            cpu_speed: this.cpu_speed, console: this.console, image_version: this.image_version,
            kernel_version: this.kernel_version, page0_erasecount: this.page0_erasecount,
            page1_erasecount: this.page1_erasecount, free_mem: this.free_mem,
            tffs_mount: this.tffs_mount, ppp_tx: this.ppp_tx, ppp_rx: this.ppp_rx,
            lastread_interval: this.lastread_interval, eth_ip: this.eth_ip,
            sleepmode: this.sleepmode, cico_mode: this.cico_mode,
            multi_drop_mode: this.multi_drop_mode, stop_index: this.stop_index,
            uptime: this.uptime, free_space: this.free_space,
            free_spi_space: this.free_spi_space, chip_id: this.chip_id,
            second_sam_id: this.second_sam_id, second_sam_version: this.second_sam_version,
        });
    }
}

module.exports = CfgTransaction;
