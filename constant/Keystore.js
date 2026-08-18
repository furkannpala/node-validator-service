// Java enum Keystore: the values are the wire codes devices send, not names.
// BLOB is "1", so ?enc=1 - not ?enc=blob - selects the binary card list.
module.exports = Object.freeze({
    BLOB: "1",
    FILE_ID: "1",
    FILE_TYPE: "6",
});
