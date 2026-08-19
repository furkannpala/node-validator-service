/**
 * Posts the same body to the Java service and to this one and compares the rows each left
 * behind. The two runs cannot overlap: the second service would meet the first one's rows as
 * unique violations and write nothing, so the tables are cleared between them.
 *
 *   node tools/compare/compareWrites.js [--java URL] [--node URL] [--system 017]
 *
 * DESTRUCTIVE. It deletes the rows its own cases wrote, by their key, from the local schema.
 * Do not point it at anything but a local test database.
 */

const fs = require('fs');
const path = require('path');
const db = require('./db');
const { CASES, VOLATILE } = require('./writeCases');

const DEFAULTS = {
    java: 'http://localhost:8080/Validator Services',
    node: 'http://localhost:3099/Validator Services',
    system: '017',
    out: path.join(__dirname, 'report-writes.md'),
};

function parseArgs(argv) {
    const options = { ...DEFAULTS };
    for (let i = 0; i < argv.length; i += 2) {
        const key = String(argv[i]).replace(/^--/, '');
        if (key in options) options[key] = argv[i + 1];
    }
    return options;
}

function keyFor(testCase, table) {
    return table === 'tbl_validator_error_td' && testCase.errorTdKey
        ? testCase.errorTdKey : testCase.key;
}

function clear(testCase) {
    for (const table of testCase.tables) {
        db.execute(`DELETE FROM ${table} WHERE ${keyFor(testCase, table)};`);
    }
}

function snapshot(testCase) {
    const shot = {};
    for (const table of testCase.tables) {
        shot[table] = db.rows(table, keyFor(testCase, table));
    }
    return shot;
}

async function post(base, systemId, testCase) {
    const url = new URL(`${base}/Validator`);
    url.searchParams.set('systemid', systemId);
    for (const [key, value] of Object.entries(testCase.query)) url.searchParams.set(key, value);

    const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml' },
        body: testCase.body,
    });
    return response.text();
}

/** Sorted and stripped of the columns neither service controls, so two row sets can be equal. */
function canonical(rows) {
    return rows
        .map((row) => {
            const kept = Object.entries(row)
                .filter(([column]) => !VOLATILE.includes(column))
                .sort(([a], [b]) => a.localeCompare(b));
            return JSON.stringify(Object.fromEntries(kept));
        })
        .sort();
}

function compareTables(javaShot, nodeShot) {
    const findings = [];
    for (const table of Object.keys(javaShot)) {
        const a = canonical(javaShot[table]);
        const b = canonical(nodeShot[table]);
        if (a.length !== b.length) {
            findings.push({ table, kind: 'satır sayısı', java: a.length, node: b.length });
            continue;
        }
        for (let i = 0; i < a.length; i++) {
            if (a[i] === b[i]) continue;
            const ja = JSON.parse(a[i]);
            const nb = JSON.parse(b[i]);
            const columns = Object.keys(ja).filter((c) => JSON.stringify(ja[c]) !== JSON.stringify(nb[c]));
            findings.push({ table, kind: 'kolon', columns: columns.map((c) => `${c}: ${JSON.stringify(ja[c])} / ${JSON.stringify(nb[c])}`) });
        }
    }
    return findings;
}

async function runCase(options, testCase) {
    clear(testCase);
    const javaBody = await post(options.java, options.system, testCase);
    const javaShot = snapshot(testCase);

    clear(testCase);
    const nodeBody = await post(options.node, options.system, testCase);
    const nodeShot = snapshot(testCase);
    clear(testCase);

    const counts = Object.fromEntries(Object.keys(javaShot)
        .map((t) => [t, `${javaShot[t].length}/${nodeShot[t].length}`]));

    return {
        name: testCase.name,
        expected: testCase.expectDifference,
        counts,
        answersMatch: javaBody.replace(/<\?xml[^>]*\?>\s*/, '').trim()
            === nodeBody.replace(/<\?xml[^>]*\?>\s*/, '').trim(),
        findings: compareTables(javaShot, nodeShot),
    };
}

function writeReport(options, results) {
    const lines = [
        '# Yazma yolu karşılaştırması (Java / Node)',
        '',
        `Üretim: ${new Date().toISOString()}  ·  system_id: ${options.system}`,
        '',
        'Her durum önce Java\'ya, sonra Node\'a gönderilir; aralarda ilgili satırlar silinir.',
        `Karşılaştırmada yok sayılan kolonlar: ${VOLATILE.join(', ')}.`,
        '',
        '| Durum | Cevap | Satır (J/N) | Sonuç |',
        '|---|---|---|---|',
    ];

    for (const r of results) {
        const counts = Object.entries(r.counts).map(([t, c]) => `${t} ${c}`).join(', ');
        const verdict = r.findings.length === 0 ? 'AYNI'
            : (r.expected ? `BEKLENEN FARK` : `**FARK (${r.findings.length})**`);
        lines.push(`| ${r.name} | ${r.answersMatch ? 'aynı' : 'farklı'} | ${counts} | ${verdict} |`);
    }

    const withFindings = results.filter((r) => r.findings.length);
    if (withFindings.length) {
        lines.push('', '## Ayrıntı', '');
        for (const r of withFindings) {
            lines.push(`### ${r.name}`, '');
            if (r.expected) lines.push(`> Beklenen: ${r.expected}`, '');
            for (const f of r.findings) {
                lines.push(f.kind === 'kolon'
                    ? `- \`${f.table}\` kolon farkı: ${f.columns.join(' · ')}`
                    : `- \`${f.table}\` satır sayısı: Java ${f.java}, Node ${f.node}`);
            }
            lines.push('');
        }
    }

    fs.writeFileSync(options.out, lines.join('\n'), 'utf8');
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const results = [];

    for (const testCase of CASES) {
        const result = await runCase(options, testCase);
        results.push(result);
        const mark = result.findings.length === 0 ? '  ok  '
            : (result.expected ? ' bekl ' : ' FARK ');
        console.log(`[${mark}] ${result.name}`
            + (result.findings.length ? ` — ${result.findings.length} bulgu` : ''));
    }

    writeReport(options, results);
    const unexpected = results.filter((r) => r.findings.length && !r.expected).length;
    console.log(`\nRapor: ${options.out}`);
    console.log(`Beklenmeyen fark: ${unexpected}`);
    process.exitCode = unexpected > 0 ? 1 : 0;
}

main();
