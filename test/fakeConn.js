/**
 * Records every statement a controller runs and counts the commit boundaries, which is what
 * the Faz 3 tests assert on. `handler` may answer a specific statement; anything it ignores
 * gets the default one-row result.
 */
function fakeConn(handler) {
    return {
        calls: [],
        commits: 0,
        rollbacks: 0,
        async execute(sql, binds, opts) {
            this.calls.push({ sql, binds: binds || {}, opts });
            const answer = handler ? handler(sql, binds || {}) : undefined;
            if (answer instanceof Error) throw answer;
            return answer || { rowsAffected: 1, outBinds: {}, rows: [] };
        },
        async commit() { this.commits++; },
        async rollback() { this.rollbacks++; },

        /** Statements whose text contains `needle`, in the order they ran. */
        matching(needle) {
            return this.calls.filter((c) => c.sql.toLowerCase().includes(needle.toLowerCase()));
        },
    };
}

function makeReq(conn, query, body) {
    return { query: query || {}, dbConn: conn, sessionId: 'validatorservices_test', rawBody: body };
}

function makeRes(systemId) {
    return {
        locals: { systemId: systemId || '017' },
        headers: {},
        setHeader(key, value) { this.headers[key] = value; },
    };
}

/** Drives one controller and resolves with whatever it handed to next(). */
function run(controller, req, res) {
    return new Promise((resolve) => controller.func(req, res, (err) => resolve(err)));
}

function oracleError(errorNum) {
    const e = new Error(`ORA-${String(errorNum).padStart(5, '0')}`);
    e.errorNum = errorNum;
    return e;
}

module.exports = { fakeConn, makeReq, makeRes, run, oracleError };
