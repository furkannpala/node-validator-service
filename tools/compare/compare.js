/**
 * Replays the same request against the Java service and this one and reports where the answers
 * differ. This is the phase 9 acceptance tool, not a test: it needs both services running
 * against the same schema.
 *
 *   node tools/compare/compare.js [--system 017] [--java URL] [--node URL] [--out report.md]
 *
 * Defaults match the local setup described in validator-migration-notlar.txt [51].
 */

const fs = require('fs');
const path = require('path');
const { READ } = require('./cases');
const { normalise, RULES } = require('./normalise');

const DEFAULTS = {
    java: 'http://localhost:8080/Validator Services',
    node: 'http://localhost:3099/Validator Services',
    system: '017',
    out: path.join(__dirname, 'report.md'),
    timeout: 30000,
};

function parseArgs(argv) {
    const options = { ...DEFAULTS };
    for (let i = 0; i < argv.length; i += 2) {
        const key = String(argv[i]).replace(/^--/, '');
        if (key in options) options[key] = argv[i + 1];
    }
    return options;
}

function buildUrl(base, systemId, testCase) {
    const url = new URL(`${base}/Validator`);
    url.searchParams.set('func', testCase.func);
    url.searchParams.set('systemid', systemId);
    // Both services keep a file cache; asking as the service itself bypasses both, so the
    // comparison sees the live answer rather than yesterday's file.
    url.searchParams.set('fromservice', '1');
    for (const [key, value] of Object.entries(testCase.query || {})) {
        url.searchParams.set(key, value);
    }
    return url.toString();
}

async function fetchBody(url, timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(timeout));
    try {
        const response = await fetch(url, { signal: controller.signal });
        return { status: response.status, body: await response.text() };
    } catch (e) {
        return { status: 0, body: '', error: e.message };
    } finally {
        clearTimeout(timer);
    }
}

/** First place the two texts diverge, with a little context on each side. */
function firstDifference(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const from = Math.max(0, i - 40);
    return { at: i, java: a.slice(from, i + 80), node: b.slice(from, i + 80) };
}

async function runCase(options, testCase) {
    const name = testCase.name || testCase.func;
    if (testCase.skip) return { name, verdict: 'SKIP', note: testCase.skip };

    const java = await fetchBody(buildUrl(options.java, options.system, testCase), options.timeout);
    const node = await fetchBody(buildUrl(options.node, options.system, testCase), options.timeout);

    if (java.error || node.error) {
        return { name, verdict: 'ERROR', note: `java: ${java.error || 'ok'} / node: ${node.error || 'ok'}` };
    }

    const a = normalise(java.body, testCase.volatile);
    const b = normalise(node.body, testCase.volatile);
    if (a === b) return { name, verdict: 'SAME', bytes: a.length };

    return { name, verdict: 'DIFF', diff: firstDifference(a, b), java: a, node: b };
}

function writeReport(options, results) {
    const counts = results.reduce((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] || 0) + 1 }), {});
    const lines = [
        '# Java / Node karşılaştırma raporu',
        '',
        `Üretim: ${new Date().toISOString()}  ·  system_id: ${options.system}`,
        `Java: ${options.java}  ·  Node: ${options.node}`,
        '',
        `**Aynı: ${counts.SAME || 0}  ·  Farklı: ${counts.DIFF || 0}  ·  Atlanan: ${counts.SKIP || 0}`
            + `  ·  Ulaşılamayan: ${counts.ERROR || 0}**`,
        '',
        '## Karşılaştırmadan önce normalize edilenler',
        '',
        ...RULES.map((r) => `- ${r}`),
        '',
        '## Sonuçlar',
        '',
        '| Endpoint | Sonuç | Not |',
        '|---|---|---|',
    ];

    for (const r of results) {
        const note = r.verdict === 'DIFF' ? `ilk fark ${r.diff.at}. karakterde`
            : r.verdict === 'SAME' ? `${r.bytes} bayt eşleşti`
                : (r.note || '');
        lines.push(`| \`${r.name}\` | ${r.verdict} | ${note.replace(/\|/g, '\\|')} |`);
    }

    const diffs = results.filter((r) => r.verdict === 'DIFF');
    if (diffs.length) {
        lines.push('', '## Farklar', '');
        for (const r of diffs) {
            lines.push(`### \`${r.name}\``, '', '```', `JAVA: ${r.diff.java}`, `NODE: ${r.diff.node}`, '```', '');
        }
    }

    fs.writeFileSync(options.out, lines.join('\n'), 'utf8');
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const results = [];

    for (const testCase of READ) {
        const result = await runCase(options, testCase);
        results.push(result);
        const mark = { SAME: '  ok  ', DIFF: ' DIFF ', SKIP: ' skip ', ERROR: 'ERROR ' }[result.verdict];
        console.log(`[${mark}] ${result.name}${result.verdict === 'DIFF' ? ` (${result.diff.at}. karakter)` : ''}`);
    }

    writeReport(options, results);
    const diffs = results.filter((r) => r.verdict === 'DIFF').length;
    const errors = results.filter((r) => r.verdict === 'ERROR').length;
    console.log(`\nRapor: ${options.out}`);
    console.log(`Aynı ${results.filter((r) => r.verdict === 'SAME').length}`
        + ` · Farklı ${diffs} · Atlanan ${results.filter((r) => r.verdict === 'SKIP').length}`
        + ` · Ulaşılamayan ${errors}`);
    process.exitCode = diffs + errors > 0 ? 1 : 0;
}

main();
