const StringUtil = require("../util/StringUtil");
const DRecordStrategy = require("./DRecordStrategy");

/**
 * The ticket half of ins_station. The amounts, the signature check and the table choice are
 * the same as on a bus, so only the three things ins_station does differently are overridden.
 */
class StationDRecordStrategy extends DRecordStrategy {

    normalize(trx, cfg) {
        super.normalize(trx, cfg);
        // ins_station binds traffic_type where ins_data binds stage.
        trx.stage = trx.traffic_type;
        // A station has no position, and Java bound both coordinates as null here.
        trx.lat = null;
        trx.lng = null;
        // The origin system id variants exist only on the bus path.
        trx.originSystemId = null;
    }

    /** Only AFC_TD has extended fare variants here; the other two tables never get one. */
    options(trx, cfg, isMainTable) {
        return {
            extendedFare: isMainTable && !!cfg.saveExtendedFare,
            qrData: !StringUtil.isNullOrEmpty(trx.qr_data),
            originSystemId: false,
        };
    }
}

module.exports = StationDRecordStrategy;
