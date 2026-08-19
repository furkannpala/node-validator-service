const HttpUtil = require("./HttpUtil");

/**
 * ins_data collected one <USAGE/> element per credit card ticket and posted the whole set to
 * the payment gateway once the body was processed. Only the bus path did this — ins_station
 * and ins_data_tchew have no equivalent.
 */

const ACTION = "addUsageEmvValidator";
const HEADER = '<?xml version="1.0" encoding="UTF-8"?><ROOT>';

// Attribute order is the order Java appended them in; the gateway logs the document verbatim.
const ATTRIBUTES = [
    "alias_no", "card_no", "usage_amt", "sam_id", "pdate", "boarding_date_time", "usage_cnt",
    "ptcn", "enc_pan", "masked_pan", "bin", "late_auth", "expired_date", "amount",
    "pan_sequence", "key_type", "key_index", "emv", "on_us", "term_no", "system_id",
    "trans_result", "trans_flag", "rtc_code", "ci_tid", "ci_bdt", "fare_file_version",
    "travel_type", "stop_name",
];

/** StringBuilder.append(null) writes the four characters "null", and Java escaped nothing. */
function attributeValue(value) {
    return value === null || value === undefined ? "null" : String(value);
}

class EmvUsageBatch {
    constructor() {
        this.usages = [];
    }

    add(fields) {
        this.usages.push(fields);
    }

    isEmpty() {
        return this.usages.length === 0;
    }

    toXml() {
        const elements = this.usages.map((usage) => {
            const attrs = ATTRIBUTES.map((name) => ` ${name}="${attributeValue(usage[name])}"`);
            return `<USAGE${attrs.join("")}/>`;
        });
        return `${HEADER}${elements.join("")}</ROOT>`;
    }
}

/**
 * getDefaultXmlResponse walked every element and kept the last one, so a wrapped answer is
 * read from its innermost element. Anything but code 0 with the message OK is a failure.
 */
function readResponse(xml) {
    const elements = String(xml).match(/<[A-Za-z_][^<>]*?\/?>/g) || [];
    const last = elements.filter((tag) => !tag.startsWith("<?") && !tag.startsWith("</")).pop();
    if (!last) return null;
    const code = last.match(/\bcode\s*=\s*"([^"]*)"/i);
    const message = last.match(/\bmessage\s*=\s*"([^"]*)"/i);
    return { code: code ? code[1] : "", message: message ? message[1] : "" };
}

/**
 * Posts the batch. Every failure, including a rejected answer, comes back as one message so
 * the device sees the text Java produced — which nests its own wording twice on a rejection.
 */
async function send(batch, creditCardDataUrl, timeouts, sessionId) {
    if (!creditCardDataUrl) return;
    try {
        const answer = await HttpUtil.post(`${creditCardDataUrl}${ACTION}`, batch.toXml(),
            { ...timeouts, sessionId });
        const response = readResponse(answer);
        if (!response) {
            throw new Error(`error when parsing ${ACTION} service xml response, xml: ${answer}`);
        }
        if (response.code === "0" && response.message.toLowerCase() === "ok") return;
        throw new Error(`error when calling ${ACTION} service, code: ${response.code} `
            + `,message:${response.message}`);
    } catch (e) {
        throw new Error(`error when calling ${ACTION} service: ${e?.message}`);
    }
}

module.exports = { EmvUsageBatch, send, readResponse, ACTION, ATTRIBUTES };
