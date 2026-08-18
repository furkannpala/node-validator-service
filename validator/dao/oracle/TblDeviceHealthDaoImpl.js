const BaseDao = require("../BaseDao");
const StringUtil = require("../../../util/StringUtil");

const COLS = 'device_id,sam_id,temperature,input_voltage,battery_voltage,pcb_id,page0_erasecount,'
    + 'page1_erasecount,free_mem,tffs_mount,ppp_tx,ppp_rx,lastread_interval,sleepmode,device_type,createdatetime';
const VALUES = ':device_id,:sam_id,:temperature,:input_voltage,:battery_voltage,:pcb_id,:page0_erasecount,'
    + ':page1_erasecount,:free_mem,:tffs_mount,:ppp_tx,:ppp_rx,:lastread_interval,:sleepmode,'
    + ':device_type,:createdatetime';

class TblDeviceHealthDaoImpl extends BaseDao {

    insertSql = `INSERT INTO tbl_device_health (${COLS}) VALUES(${VALUES})`;

    toBind(trx) {
        return {
            device_id: trx.bus_id,
            sam_id: trx.sam_id,
            // Java guarded only the temperature parse; a bad voltage was left to throw.
            temperature: StringUtil.tryParseDouble(trx.temperature, 0.0),
            input_voltage: StringUtil.parseDoubleStrict(trx.input_voltage),
            battery_voltage: StringUtil.parseDoubleStrict(trx.battery_voltage),
            pcb_id: trx.pcb_id,
            page0_erasecount: trx.page0_erasecount,
            page1_erasecount: trx.page1_erasecount,
            free_mem: trx.free_mem,
            tffs_mount: trx.tffs_mount,
            ppp_tx: trx.ppp_tx,
            ppp_rx: trx.ppp_rx,
            lastread_interval: trx.lastread_interval,
            sleepmode: trx.sleepmode,
            device_type: trx.getDevice_type(),
            createdatetime: trx.createdatetime,
        };
    }

    insert(conn, trx, sessionId) {
        return this.exec(conn, this.insertSql, this.toBind(trx), sessionId);
    }
}

module.exports = new TblDeviceHealthDaoImpl();
