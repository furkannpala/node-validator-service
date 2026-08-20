/* eslint-env mocha */
const pkConfig = require('../validator/dao/oracle/PkConfigDaoImpl');

/**
 * Process-wide caches, reset before every test in the run.
 *
 * A hook declared outside any describe() attaches to mocha's root suite, so this covers every
 * file whether or not it knows the cache exists. That is the point: the ticket engine url is
 * held for a minute per system, so without this a case that configured one url would still be
 * forwarding to it several files later — and a case that never meant to forward at all would
 * open a real socket to whatever the previous one left behind.
 */
beforeEach(() => {
    pkConfig.clearCache();
});
