const http = require("http");
const https = require("https");

// Java hard-codes these two headers on every KPG call; the gateway logs the agent string.
const USER_AGENT = "Mozilla/5.0";
const ACCEPT_LANGUAGE = "en-US,en;q=0.5";

const DEFAULT_CONNECT_TIMEOUT_MS = 30000;
const DEFAULT_READ_TIMEOUT_MS = 60000;
const DEFAULT_PROBE_TIMEOUT_MS = 5000;

/**
 * Node's globalAgent runs with keepAlive off, so every call here opened a fresh TCP connection
 * — and a fresh TLS handshake on https. senddata forwards the whole body to the ticket engine
 * on every single request, so that was one connection setup per device call. These sockets are
 * pooled instead and stay warm between calls.
 *
 * maxSockets bounds how many calls can be in flight towards one host at a time; beyond that
 * Node queues them, which is the right shape for a gateway that is slower than we are.
 */
const AGENT_OPTIONS = { keepAlive: true, keepAliveMsecs: 30000, maxSockets: 64, maxFreeSockets: 16 };
const httpAgent = new http.Agent(AGENT_OPTIONS);
const httpsAgent = new https.Agent(AGENT_OPTIONS);

function agentFor(secure) {
    return secure ? httpsAgent : httpAgent;
}

function positive(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * BufferedReader.readLine() drops the line terminator and Java appended the lines with nothing
 * between them, so a multi-line gateway answer reaches the device as one line. Kept as is.
 */
function joinLines(text) {
    return text.split(/\r\n|\n|\r/).join("");
}

/**
 * The KPG POST of ValidatorUtilFuncs.Post. HttpURLConnection arms a connect timeout first and
 * swaps in the read timeout once the socket is up, which is why this uses the socket timeout
 * in two phases rather than one overall deadline.
 */
function post(rawUrl, body, options = {}) {
    const connectMs = positive(options.connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS);
    const readMs = positive(options.readTimeoutMs, DEFAULT_READ_TIMEOUT_MS);
    // Java called String.replace, which replaces every space and not just the first.
    const url = new URL(String(rawUrl).split(" ").join("%20"));
    const secure = url.protocol === "https:";
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(body == null ? "" : body, "utf8");

    return new Promise((resolve, reject) => {
        const request = (secure ? https : http).request(url, {
            method: "POST",
            agent: agentFor(secure),
            headers: {
                "User-Agent": USER_AGENT,
                "Accept-Language": ACCEPT_LANGUAGE,
                "Content-Length": payload.length,
            },
        });

        let settled = false;
        let phase = "connect";
        const fail = (message) => {
            if (settled) return;
            settled = true;
            request.destroy();
            reject(new Error(message));
        };

        request.setTimeout(connectMs);
        request.on("timeout", () => fail(`KPG ${phase} timed out after `
            + `${phase === "connect" ? connectMs : readMs} ms: ${url.host}`));
        request.on("socket", (socket) => {
            const armRead = () => { phase = "read"; request.setTimeout(readMs); };
            if (!socket.connecting) armRead();
            else socket.once(secure ? "secureConnect" : "connect", armRead);
        });
        request.on("error", (e) => fail(e.message));

        request.on("response", (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("error", (e) => fail(e.message));
            response.on("end", () => {
                if (settled) return;
                settled = true;
                // getInputStream() throws on 4xx/5xx and Java let that reach the device as an
                // error document, so a failed gateway call must not look like an empty answer.
                if (response.statusCode >= 400) {
                    reject(new Error(`KPG returned HTTP ${response.statusCode}: ${url.host}`));
                    return;
                }
                resolve(joinLines(Buffer.concat(chunks).toString("utf8")));
            });
        });

        request.end(payload);
    });
}

/**
 * A GET with no business payload, for the kpgHealth job. The body is discarded and any status
 * counts as reachable: the probe answers "is the gateway there", not "is it happy".
 */
function probe(rawUrl, timeoutMs) {
    const url = new URL(String(rawUrl).split(" ").join("%20"));
    const secure = url.protocol === "https:";
    const started = Date.now();

    return new Promise((resolve, reject) => {
        const request = (secure ? https : http).request(url, {
            method: "GET",
            agent: agentFor(secure),
            headers: { "User-Agent": USER_AGENT },
        });

        let settled = false;
        const fail = (message) => {
            if (settled) return;
            settled = true;
            request.destroy();
            reject(new Error(message));
        };

        request.setTimeout(positive(timeoutMs, DEFAULT_PROBE_TIMEOUT_MS));
        request.on("timeout", () => fail(`probe timed out: ${url.host}`));
        request.on("error", (e) => fail(e.message));
        request.on("response", (response) => {
            response.resume();
            response.on("end", () => {
                if (settled) return;
                settled = true;
                resolve({ statusCode: response.statusCode, ms: Date.now() - started });
            });
        });
        request.end();
    });
}

module.exports = {
    post, probe, joinLines, httpAgent, httpsAgent,
    DEFAULT_CONNECT_TIMEOUT_MS, DEFAULT_READ_TIMEOUT_MS, DEFAULT_PROBE_TIMEOUT_MS,
};
