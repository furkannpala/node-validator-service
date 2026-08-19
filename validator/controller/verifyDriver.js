const crypto = require("crypto");
const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class VerifyDriver extends ValidatorControllerBase {
    constructor() {
        super();
        this.personelDao = this.daoFactory.get("MstPersonelDaoImpl");
        this.thCheckDao = this.daoFactory.get("AfcThCheckDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, "verifyDriver  ", ` busid:${req.query.busid}`);
            try {
                await this.verify(req);
            } catch (error) {
                throw this.toVerifyError(error);
            }
            this.okResponse(res);
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }

    async verify(req) {
        const { busid, samid, driverid, pass } = req.query;
        const withComp = this.cfgBool(req, "verify_driver_comp", false);

        const row = await this.personelDao.getPin(req.dbConn, driverid ?? null, busid ?? null,
            withComp, req.sessionId);
        if (!row) this.ErrorManagement.throw(this.ErrorCodes.DRIVER_NOT_FOUND);

        if (await this.thCheckDao.isAnotherSessionExists(req.dbConn, samid ?? null, driverid ?? null, req.sessionId)) {
            this.ErrorManagement.throw(this.ErrorCodes.ANOTHER_BUS_HAS_OPEN_SESSION);
        }

        // The device sends SHA-1(driver id + PIN) in lower case hex; a null PIN counts as empty.
        const pin = row.PIN == null ? "" : row.PIN;
        const hash = crypto.createHash("sha1").update(`${driverid}${pin}`, "utf8").digest("hex");
        if (hash !== String(pass).toLowerCase()) this.ErrorManagement.throw(this.ErrorCodes.PIN_MISMATCH);
    }

    /**
     * Java wrapped anything the query threw as -57 and everything else as -58, letting only its
     * own ServiceExceptions through untouched.
     */
    toVerifyError(error) {
        if (error instanceof this.ServiceError) return error;
        if (error?.errorNum !== undefined) {
            return new this.ServiceError(this.ErrorCodes.DATABASE_ERROR.code,
                this.ErrorCodes.DATABASE_ERROR.message + error.message);
        }
        return new this.ServiceError(this.ErrorCodes.UNEXPECTED_ERROR.code,
            this.ErrorCodes.UNEXPECTED_ERROR.message + error?.message);
    }
}

module.exports = new VerifyDriver();
