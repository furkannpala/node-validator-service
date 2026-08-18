class DaoFactory {
    dbType = "oracle";

    constructor(dbType) {
        if (dbType) {
            this.dbType = dbType;
        }
    }

    // dbType "sqlite" targets the generated .db files; everything else is Oracle.
    get(className, dbType) {
        let daoImpl = null;
        if ((dbType || this.dbType) == "sqlite") {
            daoImpl = require("../dao/sqlite/" + className + ".js");
        } else {
            daoImpl = require("../dao/oracle/" + className + ".js");
        }

        return daoImpl;
    }
}

module.exports = new DaoFactory();
