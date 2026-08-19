const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const { isUniqueViolation } = require("../dao/daoUtil");

const ATTRS = {
    bus_id: 'busid', sam_id: 'samid', gprs_ip: 'gprsip', wlan_ip: 'wlanip', wlan_status: 'wlanstatus',
};

class WlanStatus extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " wlanstatus ", "");

            // Bind names double as the attribute map; Java kept the values across elements.
            const binds = { busid: null, samid: null, gprsip: null, wlanip: null, wlanstatus: null };
            for (const element of this.bodyElements(req)) {
                if (element.name !== "WLAN") continue;
                for (const [name, bind] of Object.entries(ATTRS)) {
                    if (element.attrs[name] !== undefined) binds[bind] = element.attrs[name];
                }
                try {
                    await this.withTransaction(req.dbConn,
                        () => this.daoImpl.setDeviceWlanStatus(req.dbConn, { ...binds }, req.sessionId));
                } catch (error) {
                    if (!isUniqueViolation(error)) throw error;
                }
            }
            this.okResponse(res);
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new WlanStatus();
