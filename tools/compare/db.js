const { execFileSync } = require('child_process');

/**
 * Runs SQL in the local Oracle container for the write comparison. This talks to the database
 * through sqlplus rather than the oracledb driver on purpose: the architecture test forbids a
 * database client outside validator/dao, and an acceptance tool is no reason to loosen it.
 */

const DEFAULTS = {
    container: 'node-app-server-master-oracle-free-1',
    oracleHome: '/opt/oracle/product/26ai/dbhomeFree',
    credentials: 'gaziantep/gaziantep',
    service: 'localhost:1521/FREEPDB1',
};

function run(sql, options = {}) {
    const cfg = { ...DEFAULTS, ...options };
    const script = [
        'set pagesize 0 feedback off verify off heading off echo off',
        'set linesize 32767 long 1000000 longchunksize 1000000 trimspool on trimout on',
        // SQL*Plus compresses runs of spaces into tabs by default, which corrupts the padding
        // of every CHAR column on the way out.
        'set tab off',
        'whenever sqlerror exit failure',
        sql,
        'exit',
        '',
    ].join('\n');

    const command = `export ORACLE_HOME=${cfg.oracleHome}; export PATH=$ORACLE_HOME/bin:$PATH; `
        + `export LD_LIBRARY_PATH=$ORACLE_HOME/lib; export NLS_LANG=.AL32UTF8; `
        + `sqlplus -s '${cfg.credentials}@${cfg.service}'`;

    return execFileSync('docker', ['exec', '-i', cfg.container, 'bash', '-lc', command],
        { input: script, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Every row of a table as an object. JSON_OBJECT(*) keeps the harness from having to know the
 * column list, which is the whole point: a column added to AFC_TD is compared automatically.
 */
function rows(table, where, options) {
    const output = run(`SELECT JSON_OBJECT(*) FROM ${table} WHERE ${where};`, options);
    return output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line));
}

function execute(sql, options) {
    run(`${sql}\nCOMMIT;`, options);
}

module.exports = { run, rows, execute, DEFAULTS };
