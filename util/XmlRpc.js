const { HttpCall } = require("../../../lib/utils");

/**
 * The bus runs an XML-RPC listener on port 8080 and the alarm path calls it to push a message
 * to the driver's screen. Only string parameters and an integer result are ever exchanged, so
 * this covers the protocol without pulling in a client library.
 */

function escapeXml(value) {
    return String(value)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Java's convertStringToHex: Integer.toHexString per char, unpadded, so widths vary. */
function stringToHex(str) {
    let hex = "";
    for (const ch of String(str)) hex += ch.codePointAt(0).toString(16);
    return hex;
}

function buildCall(methodName, params) {
    const body = params
        .map((p) => `<param><value><string>${escapeXml(p)}</string></value></param>`)
        .join("");
    return `<?xml version="1.0"?><methodCall><methodName>${methodName}</methodName>`
        + `<params>${body}</params></methodCall>`;
}

/** Resolves with the integer the device replied, or throws — the caller decides what that means. */
async function call(url, methodName, params, timeout, sessionId) {
    const resp = await HttpCall(url, { "Content-Type": "text/xml" },
        { method: "post", sessionId }, buildCall(methodName, params), timeout);

    if (resp.status !== 200) throw new Error(`xml-rpc ${methodName} failed with status ${resp.status}`);

    const text = typeof resp.data === "string" ? resp.data : String(resp.data);
    if (/<fault>/i.test(text)) throw new Error(`xml-rpc ${methodName} returned a fault: ${text}`);

    const match = text.match(/<(?:int|i4)>\s*(-?\d+)\s*<\/(?:int|i4)>/i);
    if (!match) throw new Error(`xml-rpc ${methodName} returned no integer: ${text}`);
    return Number(match[1]);
}

module.exports = { call, stringToHex };
