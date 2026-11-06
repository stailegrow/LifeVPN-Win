'use strict';
// Жизненный цикл подключения (WIN01) на заглушках ядра, IP-проверки и
// помощника прокси: устаревшая попытка ничего не включает и не публикует,
// неудачное восстановление блокирует новое подключение, выход останавливает
// ядро даже при ошибке восстановления.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifevpn-conn-test-'));
const paths = require('../src/core/paths');
paths.setRoot(root);
const xray = require('../src/core/xray');
const IPChecker = require('../src/core/ipChecker');
const SystemProxy = require('../src/core/systemProxy');
const { ConnectionManager } = require('../src/core/connection');
const Parser = require('../src/core/linkParser');

let running = 0;
let stops = 0;
xray.XrayProcess.prototype.start = function start() { this.fake = true; running++; this.alive = true; };
xray.XrayProcess.prototype.stop = function stop() { if (this.alive) running--; this.alive = false; stops++; };
Object.defineProperty(xray.XrayProcess.prototype, 'isRunning', { get() { return !!this.alive; } });

let ipWaiters = [];
IPChecker.externalIP = () => new Promise((resolve) => ipWaiters.push(resolve));
const releaseIP = (ip = '203.0.113.7') => { const w = ipWaiters.shift(); if (w) w(ip); };

const hex = SystemProxy.encodeHex;
let calls = [];
let fail = {};
SystemProxy.setRunnerForTests((args) => {
  calls.push(args[0]);
  if (fail[args[0]]) throw new Error(`${args[0]} failed`);
  if (args[0] === 'snapshot') return `LIFEVPN-PROXY-SNAPSHOT 2\nE - 1 - - -\nEND 1\n`;
  return '';
});

const settings = { get: (key) => ({ socksPort: 10808, httpPort: 10809, routing: { preset: 'global' } }[key]) };
const server = (name) => Parser.parse(`vless://00000000-0000-4000-8000-000000000001@${name}.example.com:443?encryption=none&type=tcp&security=tls#${name}`);
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const waitIP = async () => { for (let i = 0; i < 100 && !ipWaiters.length; i++) await tick(20); assert.ok(ipWaiters.length, 'ждём IP-проверку'); };

(async () => {
  const c = new ConnectionManager(settings);
  c.resolvedRouting = async () => ({ preset: 'global' });

  // 1. connect → disconnect во время IP-проверки: прокси не включается.
  let p = c.connect(server('a'));
  await waitIP();
  await c.disconnect();
  releaseIP();
  await p;
  assert.equal(c.state.kind, 'disconnected');
  assert.ok(!calls.includes('set'), 'устаревшая попытка не включает прокси');
  assert.equal(running, 0);

  // 2. connect A → connect B во время IP-проверки A: остаётся B.
  calls = [];
  const pa = c.connect(server('a'));
  await waitIP();
  const pb = c.connect(server('b'));
  releaseIP('198.51.100.1'); // ответ A приходит уже после B
  await pa;
  await waitIP();
  releaseIP('198.51.100.2');
  await pb;
  assert.equal(c.state.kind, 'connected');
  assert.equal(c.activeServer.address, 'b.example.com');
  assert.equal(c.externalIP, '198.51.100.2');
  assert.equal(calls.filter((x) => x === 'set').length, 1);
  assert.equal(running, 1);

  // 3. Сбой ядра в подключённом состоянии: прокси восстанавливается.
  calls = [];
  c.core.alive = false; running--;
  c.handleCoreCrash(1);
  assert.equal(c.state.kind, 'failed');
  assert.deepEqual(calls, ['restore-one']);
  assert.equal(SystemProxy.hasPendingRecovery(), false);

  // 4. Сбой set и отката: журнал остаётся, новое подключение блокируется.
  calls = [];
  fail = { set: true, 'restore-one': true };
  p = c.connect(server('a'));
  await waitIP();
  releaseIP();
  await p;
  assert.equal(c.state.kind, 'failed');
  assert.ok(SystemProxy.hasPendingRecovery());
  calls = [];
  await c.connect(server('b'));
  assert.equal(c.state.kind, 'failed');
  assert.ok(!calls.includes('snapshot') && !calls.includes('set'), 'новое подключение не затирает журнал');
  assert.equal(running, 0);

  // 5. Выход при неудачном восстановлении: ядро всё равно останавливается.
  c.core.alive = true; running = 1;
  c.proxyApplied = true;
  c.shutdownSynchronously();
  assert.equal(running, 0);
  assert.ok(SystemProxy.hasPendingRecovery(), 'журнал не удалён');

  // 6. Восстановление починилось: отключение повторяет попытку и снимает блок.
  fail = {};
  await c.disconnect();
  assert.equal(c.state.kind, 'disconnected');
  assert.equal(SystemProxy.hasPendingRecovery(), false);

  // 7. Неудачное восстановление при старте: состояние failed, подключение ждёт.
  fs.writeFileSync(paths.proxyState(), '{broken');
  const c2 = new ConnectionManager(settings);
  assert.equal(c2.state.kind, 'failed');
  calls = [];
  await c2.connect(server('a'));
  assert.ok(!calls.includes('set'));
  fs.rmSync(paths.proxyState());

  console.log('Connection lifecycle: stale attempts publish nothing, A→B keeps B, crash restores proxy, failed restore blocks reconnect, shutdown always stops the core');
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
