const assert = require('assert');
const { TX, withTransaction, isUniqueViolation } = require('../../validator/dao/daoUtil');

function fakeConn() {
    return {
        commits: 0, rollbacks: 0,
        async commit() { this.commits++; },
        async rollback() { this.rollbacks++; },
    };
}

describe('daoUtil', () => {
    it('TX turns off the global autoCommit', () => {
        assert.strictEqual(TX.autoCommit, false);
    });

    it('commits once on success and returns the value', async () => {
        const conn = fakeConn();
        const out = await withTransaction(conn, async () => 'ok');
        assert.strictEqual(out, 'ok');
        assert.strictEqual(conn.commits, 1);
        assert.strictEqual(conn.rollbacks, 0);
    });

    it('rolls back and rethrows on failure', async () => {
        const conn = fakeConn();
        await assert.rejects(
            () => withTransaction(conn, async () => { throw new Error('boom'); }),
            /boom/);
        assert.strictEqual(conn.commits, 0);
        assert.strictEqual(conn.rollbacks, 1);
    });

    it('keeps the original error when the rollback itself fails', async () => {
        const conn = fakeConn();
        conn.rollback = async () => { throw new Error('rollback exploded'); };
        await assert.rejects(
            () => withTransaction(conn, async () => { throw new Error('boom'); }),
            /boom/);
    });

    it('recognises ORA-00001 only', () => {
        assert.strictEqual(isUniqueViolation({ errorNum: 1 }), true);
        assert.strictEqual(isUniqueViolation({ errorNum: 942 }), false);
        assert.strictEqual(isUniqueViolation(null), false);
    });
});
