const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class GetFile extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
        // Java replaced the database failure with this text before it reached the
        // device; the ORA code only goes to the log.
        this.dbErrorMessage = "Database error occurred";
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " GetFile  ",
                ` fileid:${req.query.busid} fileversion:${req.query.filever}`);

            const data = await this.daoImpl.getCfgFile(req.dbConn, {
                busid: req.query.busid ?? null,
                filever: req.query.filever ?? null,
                fileid: req.query.fileid ?? null,
            }, req.sessionId);

            res.setHeader("Content-Type",
                String(data.lobType).toLowerCase() === "blob" ? "application/octet-stream" : "text/xml");
            res.locals.data = data.content;
        } catch (error) {
            respErr = this.getServiceError(error, req);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new GetFile();
