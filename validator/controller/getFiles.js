const { ValidatorControllerBase } = require("../ValidatorControllerBase");

class GetFiles extends ValidatorControllerBase {
    constructor() {
        super();
        this.daoImpl = this.daoFactory.get("PkAppValDaoImpl");
    }

    async func(req, res, next) {
        let respErr;
        try {
            await this.setValidatorStatus(req, " GetFileS  ",
                ` busid:${req.query.busid} fileid:${req.query.fileid} type:${req.query.type}`);

            const data = await this.daoImpl.getFileFromPath(req.dbConn, {
                busid: req.query.busid ?? null,
                fileid: req.query.fileid ?? null,
                type: req.query.type ?? null,
            }, req.sessionId);

            res.setHeader("Content-Type",
                String(data.lobType).toLowerCase() === "blob" ? "application/octet-stream" : "text/xml");
            res.locals.data = data.content;
        } catch (error) {
            respErr = this.getServiceError(error);
        } finally {
            next(respErr);
        }
    }
}

module.exports = new GetFiles();
