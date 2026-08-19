/**
 * Tells a bad-data error apart from a real database failure. senddata files the first kind in
 * TBL_VALIDATOR_ERROR_TD and answers OK, because the device cannot fix it by resending; the
 * second kind is raised so the device tries again.
 */

const DATA_FORMAT_CODES = new Set([
    12899,  // value too large for column
    1438,   // larger than specified precision
    1722,   // invalid number
    1400,   // cannot insert NULL
    1407,   // cannot update to NULL
    1426,   // numeric overflow
    1461,   // bind LONG value only for LONG column
    6502,   // numeric or value error
    1858,   // a non-numeric character was found
    1401,   // inserted value too large for column
    1439,   // value larger than specified precision for column
]);

// Date and time literal or format errors.
const RANGE_MIN = 1830;
const RANGE_MAX = 1869;

// Java also matched on the message, which catches the same errors surfaced through a wrapper.
const MARKERS = [
    'VALUE TOO LARGE FOR COLUMN', 'INVALID NUMBER', 'LITERAL DOES NOT MATCH FORMAT STRING',
    'NUMERIC OR VALUE ERROR', 'NON-NUMERIC CHARACTER', 'INSERTED VALUE TOO LARGE FOR COLUMN',
    'ORA-01438', 'ORA-12899', 'ORA-01722', 'ORA-01861', 'ORA-01830', 'ORA-01400', 'ORA-01407',
    'ORA-01426', 'ORA-01461', 'ORA-06502', 'ORA-01858', 'ORA-01401',
];

function isSqlDataFormatError(error) {
    const code = error?.errorNum;
    if (code != null) {
        if (DATA_FORMAT_CODES.has(code)) return true;
        if (code >= RANGE_MIN && code <= RANGE_MAX) return true;
    }
    const message = String(error?.message || '').toUpperCase();
    return MARKERS.some((marker) => message.includes(marker));
}

/** An Oracle error carries a number; anything else is a plain failure of our own code. */
function isSqlError(error) {
    return error?.errorNum !== undefined;
}

function getErrorCode(error) {
    if (isSqlError(error)) return String(error.errorNum);
    if (error?.code !== undefined) return String(error.code);
    return '-1';
}

function getErrorMessage(error) {
    // 30006 is the row lock wait timeout, which Java spelled out because it reads as a hang.
    if (isSqlError(error) && error.errorNum === 30006) {
        return `Database resource busy error - WAIT timeout expired: ${error.message}`;
    }
    if (error?.code !== undefined) return `Service error: ${error.message}`;
    return error?.message;
}

// isSqlError is exported for the controller base: the Java retrieve funcs caught SQLException
// specifically, so masking has to tell a database failure from any other one.
module.exports = { isSqlDataFormatError, isSqlError, getErrorCode, getErrorMessage };
