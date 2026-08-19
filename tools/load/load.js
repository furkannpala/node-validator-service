/**
 * Drives the same request at both services and reports what each sustained. Roadmap 9.2 asks
 * for throughput equivalent to the Java WAR, so the comparison is the measurement — the
 * absolute numbers belong to whatever machine this runs on.
 *
 *   node tools/load/load.js [--scenario read] [--concurrency 8] [--seconds 20]
 *
 * Scenarios are in scenarios.js. A write scenario leaves rows behind; it makes each request
 * unique so the run is not measuring how fast Oracle rejects duplicate keys.
 *
 * READ THE CAVEAT the report prints: the Java service runs in a container and this one runs on
 * the host, so this compares shapes — how each behaves as concurrency rises — not hardware.
 */

const fs = require('fs');
const path = require('path');
const { SCENARIOS } = require('./scenarios');

const DEFAULTS = {
    java: 'http://localhost:8080/Validator Services',
    node: 'http://localhost:3099/Validator Services',
    system: '017',
    scenario: 'read',
    concurrency: '8',
    seconds: '20',
    warmup: '3',
    out: path.join(__dirname, 'report-load.md'),
    // Runs the standard set instead of one scenario, and writes them all into one report.
    matrix: '',
};

function parseArgs(argv) {
    const options = { ...DEFAULTS };
    for (let i = 0; i < argv.length; i += 2) {
        const key = String(argv[i]).replace(/^--/, '');
        if (key in options) options[key] = argv[i + 1];
    }
    return options;
}

function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[index];
}

async function once(base, options, scenario, sequence) {
    const request = scenario.build(base, options.system, sequence);
    const started = process.hrtime.bigint();
    try {
        const response = await fetch(request.url, request.init);
        const body = await response.text();
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        // A validator answers 200 with an ERROR document, so the status alone says little.
        const ok = response.status === 200 && !body.includes('<ERROR');
        // The body is what says why; a status is useless when the failure is a document.
        return { ms, ok, status: response.status, body: ok ? null : body.slice(0, 200) };
    } catch (e) {
        return { ms: Number(process.hrtime.bigint() - started) / 1e6, ok: false, error: e.message };
    }
}

/** One worker keeps a single request in flight until the deadline, so concurrency is exact. */
async function worker(base, options, scenario, state, deadline) {
    const samples = [];
    while (Date.now() < deadline) {
        const result = await once(base, options, scenario, state.sequence++);
        if (Date.now() > deadline && result.ms > 0) break;   // started before, finished after
        samples.push(result);
    }
    return samples;
}

async function measure(base, options, scenario) {
    const concurrency = Number(options.concurrency);
    const state = { sequence: Date.now() % 1e7 };
    if (scenario.reset) scenario.reset();

    // A cold JIT and an empty connection pool would be charged to whichever service ran first.
    const warmupUntil = Date.now() + Number(options.warmup) * 1000;
    await Promise.all(Array.from({ length: concurrency },
        () => worker(base, options, scenario, state, warmupUntil)));

    const started = Date.now();
    const deadline = started + Number(options.seconds) * 1000;
    const batches = await Promise.all(Array.from({ length: concurrency },
        () => worker(base, options, scenario, state, deadline)));
    const elapsed = (Date.now() - started) / 1000;

    // A write scenario can answer 200 while writing nothing: senddata files a bad record and
    // reports OK. Without this check the run happily measures the error path.
    const wrong = scenario.verify ? scenario.verify() : null;

    const samples = batches.flat();
    const latencies = samples.map((s) => s.ms).sort((a, b) => a - b);
    const failed = samples.filter((s) => !s.ok);

    return {
        requests: samples.length,
        seconds: elapsed,
        rps: samples.length / elapsed,
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99),
        max: latencies[latencies.length - 1] || 0,
        failed: failed.length,
        firstError: failed.length
            ? (failed[0].error || failed[0].body || `status ${failed[0].status}`) : null,
        wrong,
    };
}

const round = (n) => Math.round(n * 10) / 10;

const CAVEAT = [
    '> **Bu bir donanım kıyaslaması değil.** Java bir konteynerde, bu servis doğrudan',
    '> makinede çalışıyor; ikisinin CPU ve bellek payı aynı değil. Anlamlı olan şekil:',
    '> eşzamanlılık arttıkça hangisi nasıl davranıyor ve gecikme kuyruğu nereye gidiyor.',
];

/** The standard set: round-trip count rises down the list, which is what the report is for. */
const MATRIX = [
    { scenario: 'nodb', concurrency: 8 },
    { scenario: 'read', concurrency: 8 },
    { scenario: 'procedure', concurrency: 8 },
    { scenario: 'senddata', concurrency: 8 },
    { scenario: 'senddata', concurrency: 10 },
    { scenario: 'senddata', concurrency: 12 },
    { scenario: 'senddata', concurrency: 16 },
];

function writeMatrixReport(options, rows) {
    const lines = [
        '# Yük karşılaştırması (Java / Node)',
        '',
        `Üretim: ${new Date().toISOString()}`,
        `Süre: ${options.seconds} sn/ölçüm  ·  Isınma: ${options.warmup} sn`,
        '',
        ...CAVEAT,
        '',
        '| Senaryo | Eşz. | Java ist/sn | Node ist/sn | Node/Java | Java p95 | Node p95 | Java hata | Node hata |',
        '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ];
    for (const r of rows) {
        // A run that rejected requests finished them fast, so its throughput is not a rate the
        // service could serve. Showing a ratio there would read as a win.
        const comparable = r.java.failed === 0 && r.node.failed === 0 && r.java.rps > 0;
        const ratio = comparable ? `${round((r.node.rps / r.java.rps) * 100)}%` : '—';
        lines.push(`| ${r.scenario} | ${r.concurrency} | ${round(r.java.rps)} | ${round(r.node.rps)}`
            + ` | ${ratio} | ${round(r.java.p95)} | ${round(r.node.p95)}`
            + ` | ${r.java.failed} | ${r.node.failed} |`);
    }
    lines.push('', 'Hata sayan satırlarda oran verilmez: reddedilen istek hızlı biter ve'
        + ' verimi olduğundan yüksek gösterir.');
    lines.push('');
    const broken = rows.filter((r) => r.java.wrong || r.node.wrong);
    for (const r of broken) {
        lines.push(`> ${r.scenario} @${r.concurrency} ölçümü geçersiz:`
            + ` ${r.java.wrong || ''} ${r.node.wrong || ''}`.trim(), '');
    }
    const failing = rows.find((r) => r.node.failed > 0);
    if (failing) lines.push('Node ilk hata: `' + failing.node.firstError + '`', '');
    fs.writeFileSync(options.out, lines.join('\n'), 'utf8');
}

function writeReport(options, scenario, java, node) {
    const ratio = java.rps > 0 ? node.rps / java.rps : 0;
    const lines = [
        '# Yük karşılaştırması (Java / Node)',
        '',
        `Üretim: ${new Date().toISOString()}`,
        `Senaryo: **${options.scenario}** — ${scenario.description}`,
        `Eşzamanlılık: ${options.concurrency}  ·  Süre: ${options.seconds} sn`
            + `  ·  Isınma: ${options.warmup} sn`,
        '',
        ...CAVEAT,
        '',
        '| Ölçüm | Java | Node |',
        '|---|---:|---:|',
        `| İstek | ${java.requests} | ${node.requests} |`,
        `| İstek/sn | **${round(java.rps)}** | **${round(node.rps)}** |`,
        `| p50 (ms) | ${round(java.p50)} | ${round(node.p50)} |`,
        `| p95 (ms) | ${round(java.p95)} | ${round(node.p95)} |`,
        `| p99 (ms) | ${round(java.p99)} | ${round(node.p99)} |`,
        `| en yavaş (ms) | ${round(java.max)} | ${round(node.max)} |`,
        `| başarısız | ${java.failed} | ${node.failed} |`,
        '',
        `Node / Java verim oranı: **${round(ratio * 100)}%**`,
        '',
    ];
    if (java.wrong) lines.push(`> **Java ölçümü geçersiz:** ${java.wrong}`, '');
    if (node.wrong) lines.push(`> **Node ölçümü geçersiz:** ${node.wrong}`, '');
    if (java.firstError) lines.push(`Java ilk hata: \`${java.firstError}\``, '');
    if (node.firstError) lines.push(`Node ilk hata: \`${node.firstError}\``, '');

    fs.writeFileSync(options.out, lines.join('\n'), 'utf8');
}

async function runMatrix(options) {
    const rows = [];
    for (const entry of MATRIX) {
        const scenario = SCENARIOS[entry.scenario];
        const step = { ...options, concurrency: String(entry.concurrency) };
        process.stdout.write(`${entry.scenario} @${entry.concurrency}  ... `);
        const java = await measure(options.java, step, scenario);
        const node = await measure(options.node, step, scenario);
        if (scenario.cleanup) scenario.cleanup();
        rows.push({ ...entry, java, node });
        console.log(`java ${round(java.rps)} / node ${round(node.rps)} ist/sn`
            + `  (node hata ${node.failed})`);
    }
    writeMatrixReport(options, rows);
    console.log(`
Rapor: ${options.out}`);
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.matrix) return runMatrix(options);
    const scenario = SCENARIOS[options.scenario];
    if (!scenario) {
        console.error(`bilinmeyen senaryo '${options.scenario}'; `
            + `secenekler: ${Object.keys(SCENARIOS).join(', ')}`);
        process.exitCode = 2;
        return;
    }

    console.log(`senaryo: ${options.scenario} — ${scenario.description}`);
    console.log(`eszamanlilik ${options.concurrency}, sure ${options.seconds} sn\n`);

    // Sequentially, never side by side: they share one database and one machine.
    process.stdout.write('java  ... ');
    const java = await measure(options.java, options, scenario);
    console.log(`${round(java.rps)} istek/sn, p95 ${round(java.p95)} ms, hata ${java.failed}`
        + (java.wrong ? `  [OLCUM GECERSIZ: ${java.wrong}]` : ''));

    process.stdout.write('node  ... ');
    const node = await measure(options.node, options, scenario);
    console.log(`${round(node.rps)} istek/sn, p95 ${round(node.p95)} ms, hata ${node.failed}`
        + (node.wrong ? `  [OLCUM GECERSIZ: ${node.wrong}]` : ''));

    if (scenario.cleanup) scenario.cleanup();

    writeReport(options, scenario, java, node);
    console.log(`\nRapor: ${options.out}`);
}

main();
