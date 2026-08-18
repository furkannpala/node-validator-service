const ZERO = '0'.repeat(76);

function isNullOrEmpty(str) {
    return str === null || str === undefined || str === '';
}

function parseIntStrict(str) {
    if (typeof str !== 'string' || !/^[+-]?\d+$/.test(str)) {
        throw new Error(`NumberFormatException: For input string: "${str}"`);
    }
    const n = Number(str);
    if (n > 2147483647 || n < -2147483648) {
        throw new Error(`NumberFormatException: For input string: "${str}" (int overflow)`);
    }
    return n;
}

function parseDoubleStrict(str) {
    if (str === null || str === undefined) {
        throw new Error('NullPointerException: null double');
    }
    const s = String(str).trim();
    if (s === '') throw new Error('NumberFormatException: empty String');
    const n = Number(s);
    if (Number.isNaN(n) && s !== 'NaN') {
        throw new Error(`NumberFormatException: For input string: "${str}"`);
    }
    return n;
}

function tryParseInt(str, exceptionValue) {
    try { return parseIntStrict(str); } catch (e) { return exceptionValue; }
}

function tryParseDouble(str, exceptionValue) {
    try { return parseDoubleStrict(str); } catch (e) { return exceptionValue; }
}

function tryParseLong(str, exceptionValue) {
    if (typeof str !== 'string' || !/^[+-]?\d+$/.test(str)) return exceptionValue;
    return Number(str);
}

function lpadZero(data, length) {
    const s = ZERO + data;
    return s.substring(s.length - length);
}





module.exports = {
    isNullOrEmpty,
    parseIntStrict,
    parseDoubleStrict,
    tryParseInt,
    tryParseDouble,
    tryParseLong,
    lpadZero,
};
