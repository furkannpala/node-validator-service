const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// The DAO boundary is the whole point of the rewrite, so it is a test, not a convention.
const BANNED = /\b(conn|dbConn)\.execute(Many)?\s*\(|\boraQuery\s*\(|require\(['"]oracledb['"]\)|require\(['"]node:sqlite['"]\)/;
// Paths are compared with forward slashes so the rule reads the same on Windows and Linux.
const ALLOWED = /\/validator\/dao\//;
const posix = (f) => f.split(path.sep).join('/');

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir)) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const abs = path.join(dir, entry);
        if (fs.statSync(abs).isDirectory()) walk(abs, out);
        else out.push(abs);
    }
    return out;
}

const sourceFiles = walk(ROOT)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => !posix(f).includes('/test/'));

describe('architecture', () => {
    it('no database access outside validator/dao', () => {
        const offenders = sourceFiles
            .filter((f) => !ALLOWED.test(posix(f)))
            .filter((f) => BANNED.test(fs.readFileSync(f, 'utf8')))
            .map((f) => path.relative(ROOT, f));
        assert.deepStrictEqual(offenders, []);
    });

    it('no SQL text outside validator/dao', () => {
        const sqlLike = /\b(SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|MERGE\s+INTO|CREATE\s+TABLE)\b/i;
        const offenders = sourceFiles
            .filter((f) => !ALLOWED.test(posix(f)))
            .filter((f) => sqlLike.test(fs.readFileSync(f, 'utf8')))
            .map((f) => path.relative(ROOT, f));
        assert.deepStrictEqual(offenders, []);
    });

    it('every controller file name is a lowercase-unique ?func= key', () => {
        const dir = path.join(ROOT, 'validator', 'controller');
        if (!fs.existsSync(dir)) return;
        const seen = new Map();
        for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
            const key = path.parse(f).name.toLocaleLowerCase('en-US');
            assert.ok(!seen.has(key), `duplicate func key '${key}': ${seen.get(key)} vs ${f}`);
            seen.set(key, f);
        }
    });
});
