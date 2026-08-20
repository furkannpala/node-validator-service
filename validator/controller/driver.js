/**
 * Drivers: passwords, plans, working hours and the shift check.
 *
 * The keys of the funcs table at the bottom are the ?func= values this file answers;
 * validator/index.js registers them straight from there.
 */
const { ValidatorControllerBase } = require("../ValidatorControllerBase");
const crypto = require("crypto");


// ---------------------------------------------------------------- ?func=getdriverpassword

class GetDriverPassword extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
        // Java replaced the database failure with this text before it reached the
        // device; the ORA code only goes to the log.
        this.dbErrorMessage = "Failed to fetch driver password";
        // This one caught every exception, not just the SQL ones.
        this.dbErrorScope = "all";
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, "GetoOlineSchedule  ",
                ` busid:${req.query.busid} driver:${req.query.driverid}`);

            const data = await this.daoImpl.getDriverPassword(req.dbConn, {
                busid: req.query.busid ?? null,
                driverid: req.query.driverid ?? null,
            }, req.sessionId);

            if (data == null) throw new this.ServiceError(-97, "error");

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = data;
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


// ---------------------------------------------------------------- ?func=setdriverpassword

class SetDriverPassword extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            // The action string says GetoOlineSchedule; it is wrong but it is what val_status
            // has recorded for years, and reports group on it.
            await this.setValidatorStatus(req, "GetoOlineSchedule  ",
                ` busid:${req.query.busid} driver:${req.query.driverid} pass:${req.query.pass}`);

            const retval = await this.withTransaction(req.dbConn, () => this.daoImpl.setDriverPassword(req.dbConn, {
                busid: req.query.busid ?? null,
                driverid: req.query.driverid ?? null,
                pass: req.query.pass ?? null,
            }, req.sessionId));

            if (retval !== 0) throw new Error(" Error Code " + retval);

            this.okResponse(res);
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


// ---------------------------------------------------------------- ?func=verifydriver

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


// ---------------------------------------------------------------- ?func=getdriverplan

class GetDriverPlan extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkRepDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getDriverPlan ",
                ` samid:${req.query.samid} busid:${req.query.busid}`);

            const data = await this.daoImpl.driverPlan(req.dbConn, {
                driverid: req.query.driverid ?? null,
                lang: req.query.lang ?? null,
            }, req.sessionId);

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = data;
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


// ---------------------------------------------------------------- ?func=getdriverworkhours

class GetDriverWorkHours extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
        // Java replaced the database failure with this text before it reached the
        // device; the ORA code only goes to the log.
        this.dbErrorMessage = "Error occurred while fetching driver work hours";
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " getdriverworkhours ",
                ` aliasno:${req.query.aliasno} busid:${req.query.busid} driver:${req.query.driverid}`);

            const data = await this.daoImpl.getDriverWorkHours(req.dbConn, {
                busid: req.query.busid ?? null,
                driverid: req.query.driverid ?? null,
                aliasno: req.query.aliasno ?? null,
            }, req.sessionId);

            res.setHeader("Content-Type", "text/xml");
            res.locals.data = data;
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}


module.exports = {
    funcs: {
        getdriverpassword: new GetDriverPassword(),
        setdriverpassword: new SetDriverPassword(),
        verifydriver: new VerifyDriver(),
        getdriverplan: new GetDriverPlan(),
        getdriverworkhours: new GetDriverWorkHours(),
    },
};
