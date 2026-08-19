const { ServiceError } = require("../../../lib/utils");

// Codes and message texts are copied verbatim from the Java service: devices match on them.
// Trailing spaces in the "…: " messages are intentional — Java concatenates a detail after them.
const ErrorCodes = {
    XML_PARSE_PROBLEM: { code: -1, message: 'Rfcard xml has a problem:' },
    TICKET_ID_NOT_SPECIFIED: { code: -1, message: 'ticket id is not specified' },
    FUNC_NOT_SPECIFIED: { code: -3, message: 'func is not specified' },
    TICKET_ENGINE_ERROR: { code: -3, message: 'Ticket Engine Error: ' },
    UNRECOGNIZED_FUNC: { code: -9, message: 'unrecognized func ' },
    DRIVER_NOT_FOUND: { code: -55, message: 'Driver not found. Please check the driver ID.' },
    PIN_MISMATCH: { code: -56, message: 'PIN does not match. Please check the provided credentials.' },
    DATABASE_ERROR: { code: -57, message: 'Database error occurred: ' },
    UNEXPECTED_ERROR: { code: -58, message: 'An unexpected error occurred: ' },
    CANNOT_FETCH_DATA: { code: -97, message: 'cannot fetch data from db' },
    GENERIC_ERROR: { code: -99, message: 'error' },
    NOT_MODIFIED: { code: -304, message: 'Not Modified' },
    ANOTHER_BUS_HAS_OPEN_SESSION: { code: -2001, message: 'Another bus has an open session with this driver. Please close it before proceeding.' },
    DOWNLOAD_FAILED: { code: -20094, message: 'Download Failed' },
    FILE_NOT_READY: { code: -20095, message: 'File Not Ready' },
    FILE_NOT_FOUND: { code: -20096, message: 'File Not found' },
    UNDEFINED_FUNCTION: { code: -20099, message: 'Undefined Function' },
    // One Java call site spells this "Kakfka Error:"; that literal is preserved at the site.
    KAFKA_ERROR: { code: -99999, message: 'Kafka Error: ' },
    EMV_SERVICE_ERROR: { code: 101, message: 'error when calling addUsageEmvValidator service: ' },
    EMV_TAG_MISSING: { code: 101, message: 'xml data has not EMV tag for card_no=' },
    DB_OPERATION_FAILED: { code: 103, message: 'Database operation failed: ' },
};

class ErrorManagement {
    static throw(errorCodeObj, detail) {
        if (!errorCodeObj || typeof errorCodeObj !== 'object') {
            throw new ServiceError(-9999, 'Invalid error code object!');
        }
        const { code, message } = errorCodeObj;
        throw new ServiceError(code, detail == null ? message : message + detail);
    }
}

module.exports = { ErrorManagement, ErrorCodes };
