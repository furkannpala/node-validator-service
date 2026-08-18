const HttpUtil = require("./HttpUtil");

/**
 * realauth and sendemvdata are pure proxies: the device body is forwarded to the payment
 * gateway untouched and the gateway's answer is returned as the response.
 */

/**
 * Java appended the action as a bare query token, so a base url without a query string turns
 * into "https://host/path?realAuth&systemid=001". The gateway parses it that way; kept as is.
 */
function buildUrl(baseUrl, action, systemId) {
    const url = baseUrl == null ? "" : String(baseUrl);
    const separator = url.indexOf("?") < 0 ? "?" : "";
    return `${url}${separator}${action}&systemid=${systemId}`;
}

async function call(baseUrl, action, systemId, body, timeouts, sessionId) {
    return await HttpUtil.post(buildUrl(baseUrl, action, systemId), body, {
        connectTimeoutMs: timeouts?.connectTimeoutMs,
        readTimeoutMs: timeouts?.readTimeoutMs,
        sessionId,
    });
}

module.exports = { buildUrl, call };
