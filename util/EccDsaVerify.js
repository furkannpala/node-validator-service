const crypto = require("crypto");
const { ULog } = require("../../../lib/utils");

/**
 * Signature check for system 112 (Baku): the device signs the ticket fields and sends the
 * signature in tc_code. Only that system uses it; everywhere else the record is trusted.
 *
 * The key is hard-coded in the Java service too. It is a public key, so it carries no secret.
 */
const PUBLIC_KEY_B64 =
    'MEkwEwYHKoZIzj0CAQYIKoZIzj0DAQIDMgAELRJ+onz1ztUe4armVe9hTpZhggzfhMFJLAlkJEXwgjjXSexsYco9UmeLfndYiVYL';

let publicKey;

function getKey() {
    if (!publicKey) {
        publicKey = crypto.createPublicKey({
            key: Buffer.from(PUBLIC_KEY_B64, 'base64'), format: 'der', type: 'spki',
        });
    }
    return publicKey;
}

/**
 * Returns 1 when the signature matches and 0 otherwise, keeping the Java return values.
 * Java verified twice on failure, but a failed verify leaves the same input in place, so the
 * retry could never reach a different answer and one pass is equivalent.
 */
function verify(tcCode, inputData, sessionId) {
    try {
        const verifier = crypto.createVerify('SHA1');
        verifier.update(Buffer.from(String(inputData), 'utf8'));
        const ok = verifier.verify(getKey(), Buffer.from(String(tcCode), 'hex'));
        if (!ok) ULog.error(`ecdsa verify failed input:${inputData} tc_code:${tcCode}`, sessionId);
        return ok ? 1 : 0;
    } catch (e) {
        ULog.error(`ecdsa verify error: ${e?.message}`, sessionId);
        return 0;
    }
}

/** The signed field list, in the order and padding the device used. */
function buildInput(trx, lpadZero) {
    return [
        trx.sam_id, trx.sam_seq_no, trx.boarding_date_time, trx.card_no,
        lpadZero(trx.usage_cnt, 8), lpadZero(trx.usage_amt, 8), trx.trans_flag,
        lpadZero(trx.remained_amt, 10), trx.passenger_type, trx.customer_flag, trx.alias_no,
    ].join(':');
}

module.exports = { verify, buildInput };
