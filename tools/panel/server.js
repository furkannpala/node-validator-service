/**
 * A local control panel for the migration work: start and stop the two services, seed and
 * clear the test schema, run the comparisons and the load matrix, and read the reports —
 * without typing any of it.
 *
 *   node tools/panel/server.js        →  http://localhost:3100
 *
 * LOCAL TOOL. It runs shell commands and deletes rows on request, and it binds to loopback
 * only. Do not expose it, and do not point it at anything but a local test database.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PANEL_DIR = __dirname;
const SERVICE_DIR = path.resolve(PANEL_DIR, '..', '..');
const SERVER_DIR = path.resolve(SERVICE_DIR, '..', '..');

const CONFIG = {
    port: 3100,
    nodeUrl: 'http://localhost:3099/Validator Services',
    javaUrl: 'http://localhost:8080/Validator Services',
    tomcatContainer: 'vs-tomcat',
    oracleContainer: 'node-app-server-master-oracle-free-1',
    oracleHome: '/opt/oracle/product/26ai/dbhomeFree',
    oracleCredentials: 'gaziantep/gaziantep',
    kkconfigCredentials: 'kkconfig/kkconfig',
    oracleService: 'localhost:1521/FREEPDB1',
};

// One child at a time: every job here either drives both services or rewrites the schema
// under them, so two at once would report nonsense.
let running = null;
const listeners = new Set();

function broadcast(event, data) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const response of listeners) response.write(frame);
}

function say(line) {
    broadcast('log', { line });
}

/** Runs a command, streaming its output to every open panel. Resolves with the exit code. */
function run(label, command, args, options = {}) {
    return new Promise((resolve) => {
        if (running) {
            say(`[!] '${running}' calisiyor, once o bitsin`);
            resolve(-1);
            return;
        }
        running = label;
        broadcast('busy', { label });
        say(`\n=== ${label} ===`);

        const child = spawn(command, args, { cwd: options.cwd || SERVICE_DIR, shell: false });
        if (options.stdin !== undefined) child.stdin.end(options.stdin);

        const forward = (buffer) => String(buffer).split(/\r?\n/)
            .filter((l) => l.length).forEach((l) => say(l));
        child.stdout.on('data', forward);
        child.stderr.on('data', forward);

        child.on('error', (e) => {
            say(`[hata] ${e.message}`);
            running = null;
            broadcast('idle', {});
            resolve(-1);
        });
        child.on('close', (code) => {
            say(`--- bitti (cikis kodu ${code}) ---`);
            running = null;
            broadcast('idle', {});
            resolve(code);
        });
    });
}

/** SQL through the Oracle container, the same way tools/compare/db.js does it. */
function sqlplus(label, file, credentials) {
    const script = fs.readFileSync(path.join(PANEL_DIR, 'sql', file), 'utf8')
        .replace(/\r\n/g, '\n');
    const inner = `export ORACLE_HOME=${CONFIG.oracleHome}; export PATH=$ORACLE_HOME/bin:$PATH; `
        + 'export LD_LIBRARY_PATH=$ORACLE_HOME/lib; export NLS_LANG=.AL32UTF8; '
        + `sqlplus -s '${credentials}@${CONFIG.oracleService}'`;
    return run(label, 'docker',
        ['exec', '-i', CONFIG.oracleContainer, 'bash', '-lc', inner],
        { stdin: `${script}\nexit\n` });
}

// The Node service is started detached so it outlives one job; the panel keeps the handle.
let nodeChild = null;

function startNode() {
    if (nodeChild) {
        say('[!] node zaten calisiyor');
        return Promise.resolve(0);
    }
    say('\n=== node baslatiliyor ===');
    nodeChild = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, shell: false });
    const forward = (b) => String(b).split(/\r?\n/).filter((l) => l.length)
        .forEach((l) => say(`[node] ${l.slice(0, 300)}`));
    nodeChild.stdout.on('data', forward);
    nodeChild.stderr.on('data', forward);
    nodeChild.on('close', (code) => {
        say(`[node] durdu (cikis kodu ${code})`);
        nodeChild = null;
    });
    return new Promise((resolve) => setTimeout(resolve, 6000));
}

function stopNode() {
    if (!nodeChild) {
        say('[!] node zaten durmus');
        return Promise.resolve(0);
    }
    nodeChild.kill();
    nodeChild = null;
    return new Promise((resolve) => setTimeout(resolve, 1500));
}

async function reachable(url) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2500);
        const response = await fetch(`${url}/Validator?func=getversion&systemid=017`,
            { signal: controller.signal });
        clearTimeout(timer);
        return response.status === 200;
    } catch (e) {
        return false;
    }
}

function dockerRunning(name) {
    return new Promise((resolve) => {
        const child = spawn('docker', ['inspect', '-f', '{{.State.Running}}', name], { shell: false });
        let out = '';
        child.stdout.on('data', (b) => { out += b; });
        child.on('error', () => resolve(false));
        child.on('close', () => resolve(out.trim() === 'true'));
    });
}

async function status() {
    const [node, java, tomcat, oracle] = await Promise.all([
        reachable(CONFIG.nodeUrl),
        reachable(CONFIG.javaUrl),
        dockerRunning(CONFIG.tomcatContainer),
        dockerRunning(CONFIG.oracleContainer),
    ]);
    return { node, java, tomcat, oracle, running };
}

const REPORTS = {
    read: path.join(SERVICE_DIR, 'tools', 'compare', 'report.md'),
    write: path.join(SERVICE_DIR, 'tools', 'compare', 'report-writes.md'),
    load: path.join(SERVICE_DIR, 'tools', 'load', 'report-load.md'),
};

const ACTIONS = {
    'seed-kkconfig': () => sqlplus('KKCONFIG seed', 'seed-kkconfig.sql', CONFIG.kkconfigCredentials),
    'seed-testdata': () => sqlplus('test verisi seed', 'seed-testdata.sql', CONFIG.oracleCredentials),
    'clean-db': () => sqlplus('test satirlarini temizle', 'clean.sql', CONFIG.oracleCredentials),

    'node-start': () => startNode(),
    'node-stop': () => stopNode(),
    'war-start': () => run('tomcat baslat', 'docker', ['start', CONFIG.tomcatContainer]),
    'war-stop': () => run('tomcat durdur', 'docker', ['stop', CONFIG.tomcatContainer]),
    'both-start': async () => {
        await run('tomcat baslat', 'docker', ['start', CONFIG.tomcatContainer]);
        await startNode();
        say('ikisi de ayakta olmali; durum satirina bak');
    },

    'compare-read': () => run('okuma karsilastirmasi', process.execPath,
        [path.join(SERVICE_DIR, 'tools', 'compare', 'compare.js')]),
    'compare-write': () => run('yazma karsilastirmasi', process.execPath,
        [path.join(SERVICE_DIR, 'tools', 'compare', 'compareWrites.js')]),
    'load-matrix': () => run('yuk matrisi', process.execPath,
        [path.join(SERVICE_DIR, 'tools', 'load', 'load.js'), '--matrix', '1', '--seconds', '12']),
    'load-quick': () => run('hizli yuk (senddata)', process.execPath,
        [path.join(SERVICE_DIR, 'tools', 'load', 'load.js'),
            '--scenario', 'senddata', '--seconds', '8', '--warmup', '2']),

    tests: () => run('birim testler', 'npx',
        ['mocha', './webapps/node-validator-service/test', '--recursive', '--exit', '--reporter', 'dot'],
        { cwd: SERVER_DIR }),
};

function send(response, code, type, body) {
    response.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    response.end(body);
}

const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');

    if (url.pathname === '/') {
        send(response, 200, 'text/html; charset=utf-8',
            fs.readFileSync(path.join(PANEL_DIR, 'index.html')));
        return;
    }

    if (url.pathname === '/api/events') {
        response.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        });
        response.write('\n');
        listeners.add(response);
        request.on('close', () => listeners.delete(response));
        return;
    }

    if (url.pathname === '/api/status') {
        send(response, 200, 'application/json', JSON.stringify(await status()));
        return;
    }

    if (url.pathname === '/api/report') {
        const file = REPORTS[url.searchParams.get('name')];
        const body = file && fs.existsSync(file)
            ? fs.readFileSync(file, 'utf8') : 'Bu rapor henuz uretilmedi.';
        send(response, 200, 'text/plain; charset=utf-8', body);
        return;
    }

    if (url.pathname.startsWith('/api/run/')) {
        const action = ACTIONS[url.pathname.slice('/api/run/'.length)];
        if (!action) {
            send(response, 404, 'application/json', '{"error":"bilinmeyen islem"}');
            return;
        }
        send(response, 202, 'application/json', '{"started":true}');
        action().catch((e) => say(`[hata] ${e.message}`));
        return;
    }

    send(response, 404, 'text/plain', 'yok');
});

// Loopback only: this endpoint runs commands, so it must not be reachable from the network.
server.listen(CONFIG.port, '127.0.0.1', () => {
    console.log(`panel: http://localhost:${CONFIG.port}`);
});

process.on('SIGINT', () => {
    if (nodeChild) nodeChild.kill();
    process.exit(0);
});
