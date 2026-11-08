'use strict';
/**
 * Счётчики трафика без локального порта и изоляция программ по процессу.
 *
 * Без ядра проверяется только сборка конфига. С LIFEVPN_XRAY (путь к
 * xray для текущей ОС) — живой прогон: ядро пускает к metrics только наш
 * процесс, чужому процессу служебное имя закрыто, а изолированная программа
 * идёт напрямую, хотя всё остальное уходит в туннель.
 */
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFile } = require('child_process');
const Builder = require('../src/core/configBuilder');
const Parser = require('../src/core/linkParser');
const models = require('../src/core/models');

const server = Parser.parse('vless://00000000-0000-4000-8000-000000000001@203.0.113.10:443?encryption=none&type=tcp&security=tls&sni=vpn.example.com#Test');

// --- Сборка конфига.
{
  const tree = Builder.makeTree(server, { metrics: true, selfProcess: ['/opt/app/Life VPN.exe'] });
  assert.deepEqual(tree.metrics, { tag: 'metrics' }, 'metrics без listen');
  for (const inbound of tree.inbounds) assert.equal(inbound.listen, '127.0.0.1');
  const ports = tree.inbounds.map((i) => i.port);
  assert.deepEqual(ports, [10808, 10809], 'никаких портов, кроме socks/http');
  const [allow, deny] = tree.routing.rules;
  assert.deepEqual(allow.domain, [`full:${Builder.METRICS_HOST}`]);
  assert.deepEqual(allow.process, ['/opt/app/Life VPN.exe']);
  assert.equal(allow.outboundTag, 'metrics');
  assert.deepEqual(deny.domain, [`full:${Builder.METRICS_HOST}`]);
  assert.equal(deny.outboundTag, 'block');
  assert.equal(deny.process, undefined);

  const plain = Builder.makeTree(server, {});
  assert.equal(plain.metrics, undefined);
  assert.ok(!plain.routing.rules.some((r) => r.process), 'без опций правил по процессам нет');
}

// --- Изоляция: только «Обход РФ» и только когда включена.
{
  const ru = models.preset('bypass-ru').make();
  const global = models.preset('global').make();
  assert.deepEqual(models.isolatedProcessesFor({ isolateRuApps: true }, ru), models.ISOLATED_PROCESSES);
  assert.deepEqual(models.isolatedProcessesFor({}, ru), models.ISOLATED_PROCESSES, 'включено по умолчанию');
  assert.deepEqual(models.isolatedProcessesFor({ isolateRuApps: false }, ru), []);
  assert.deepEqual(models.isolatedProcessesFor({ isolateRuApps: true }, global), []);
  assert.ok(models.ISOLATED_PROCESSES.includes('MAX'));

  const tree = Builder.makeTree(server, { metrics: true, selfProcess: ['x'], isolatedProcesses: ['MAX'], routing: ru });
  const idx = tree.routing.rules.findIndex((r) => r.process && r.process.includes('MAX'));
  assert.equal(idx, 2, 'изоляция сразу после правил счётчиков');
  assert.equal(tree.routing.rules[idx].outboundTag, 'direct');
}

async function live(xray) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifevpn-exposure-'));
  const target = http.createServer((req, res) => res.end('direct-ok'));
  await new Promise((r) => target.listen(0, '127.0.0.1', r));
  const targetPort = target.address().port;
  const socksPort = 20000 + (process.pid % 5000);
  const httpPort = socksPort + 1;
  const routing = models.makeRoutingConfig({ presetID: 'global', bypassLAN: false, domainStrategy: 'AsIs', domesticDNS: '', remoteDNS: '' });
  const config = path.join(dir, 'config.json');
  const access = path.join(dir, 'access.log');
  fs.writeFileSync(config, Builder.makeJSON(server, {
    socksPort, httpPort, accessLogPath: access, routing,
    metrics: true, selfProcess: [process.execPath], isolatedProcesses: ['curl']
  }));
  const core = spawn(xray, ['run', '-c', config], { stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 1200));

    // Наш процесс получает счётчики через прокси.
    const own = await new Promise((resolve) => {
      const req = http.get({ hostname: '127.0.0.1', port: httpPort, path: `http://${Builder.METRICS_HOST}/debug/vars`,
        headers: { Host: Builder.METRICS_HOST }, agent: false, timeout: 3000 }, (res) => {
        let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ code: res.statusCode, body }));
      });
      req.on('error', (e) => resolve({ code: 0, body: String(e) }));
      req.on('timeout', () => req.destroy());
    });
    assert.equal(own.code, 200, `свой процесс видит metrics: ${own.body.slice(0, 120)}`);
    assert.ok('stats' in JSON.parse(own.body));

    // Асинхронно: локальный сервер-цель живёт в этом же процессе.
    const curl = (url) => new Promise((resolve) => {
      execFile('curl', ['-s', '--noproxy', '', '-m', '4', '-o', '-', '-w', '\n%{http_code}', '-x', `http://127.0.0.1:${httpPort}`, url],
        { encoding: 'utf8' }, (error, stdout) => resolve(error ? `${stdout || ''}\nERR` : stdout));
    });
    // Чужой процесс (curl) к счётчикам не пускается…
    const foreign = await curl(`http://${Builder.METRICS_HOST}/debug/vars`);
    assert.ok(!/\n200$/.test(foreign.trim()) && !foreign.includes('"stats"'), `чужой процесс не видит metrics: ${foreign.slice(0, 120)}`);
    // …а как изолированная программа идёт напрямую.
    const direct = await curl(`http://127.0.0.1:${targetPort}/`);
    assert.ok(direct.includes('direct-ok'), `изолированная программа идёт напрямую: ${direct}`);

    await new Promise((r) => setTimeout(r, 300));
    const log = fs.readFileSync(access, 'utf8');
    assert.match(log, /-> direct\]|>> direct\]/, 'в журнале есть direct');
    assert.match(log, /-> block\]/, 'служебное имя для чужих — block');
  } finally {
    core.kill();
    target.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

(async () => {
  if (process.env.LIFEVPN_XRAY) await live(process.env.LIFEVPN_XRAY);
  console.log('Local exposure: metrics only for own process, no extra ports, process isolation passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
