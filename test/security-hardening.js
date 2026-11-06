'use strict';
// Хранилище (B06), подпись обновлений (B05), разбор ссылок (A04),
// ротация журнала маршрутизации (B07), слушатели только на loopback.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifevpn-sec-test-'));
const paths = require('../src/core/paths');
paths.setRoot(root);
const { writeAtomic } = require('../src/core/atomic');
const updater = require('../src/core/updater');
const Parser = require('../src/core/linkParser');
const Builder = require('../src/core/configBuilder');
const { RoutingLog } = require('../src/core/routingLog');

try {
  // --- Атомарная запись: без огрызков, без следования за подложенной ссылкой.
  const target = path.join(root, 'servers.json');
  writeAtomic(target, '{"a":1}');
  writeAtomic(target, '{"a":2}');
  assert.equal(fs.readFileSync(target, 'utf8'), '{"a":2}');
  assert.deepEqual(fs.readdirSync(root).filter((n) => n.endsWith('.tmp')), []);
  if (process.platform !== 'win32') assert.equal(fs.statSync(target).mode & 0o777, 0o600);

  // --- secureRoot: ACL на Windows, отказ на ссылках и жёстких ссылках.
  const icacls = [];
  paths.secureRoot({ platform: 'win32', execIcacls: (args) => icacls.push(args), currentAccount: () => '*S-1-5-21-1-2-3-1001' });
  assert.equal(icacls[0][0], root);
  assert.ok(icacls[0].includes('/inheritance:r'));
  assert.ok(icacls[0].includes('*S-1-5-21-1-2-3-1001:(OI)(CI)F'));
  assert.ok(icacls[0].includes('*S-1-5-18:(OI)(CI)F'));
  assert.ok(!icacls[0].some((a) => /Everyone|\*S-1-1-0/i.test(a)), 'Everyone не получает доступа');
  assert.deepEqual(icacls[1], [target, '/reset', '/q']);
  paths.secureRoot({ platform: 'linux' });
  if (process.platform !== 'win32') assert.equal(fs.statSync(root).mode & 0o777, 0o700);

  const hard = path.join(root, 'outside-link');
  fs.linkSync(target, hard);
  assert.throws(() => paths.secureRoot({ platform: 'linux' }), /hard links/);
  fs.unlinkSync(hard);
  fs.unlinkSync(target);
  // На Windows символическая ссылка требует прав разработчика — там часть
  // проверки пропускается, если создать ссылку нельзя.
  let linked = true;
  try { fs.symlinkSync(path.join(root, 'elsewhere'), target); } catch (error) { if (process.platform === 'win32') linked = false; else throw error; }
  if (linked) {
    assert.throws(() => paths.secureRoot({ platform: 'linux' }), /Unsafe/);
    fs.unlinkSync(target);
  }

  // --- Подпись обновлений.
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pk = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
  const sha = 'a'.repeat(64);
  const sig = crypto.sign(null, updater.signedMessage('lifevpn-windows', '3.1.5', sha), privateKey);
  assert.equal(updater.verifySignature(sig, { version: '3.1.5', sha256: sha, publicKey: pk }), true);
  assert.equal(updater.verifySignature(sig, { version: '3.1.6', sha256: sha, publicKey: pk }), false);
  assert.equal(updater.verifySignature(sig, { version: '3.1.5', sha256: 'b'.repeat(64), publicKey: pk }), false);
  assert.equal(updater.verifySignature(sig, { product: 'lifevpn-macos', version: '3.1.5', sha256: sha, publicKey: pk }), false);
  assert.equal(updater.verifySignature(sig, { version: '3.1.5', sha256: sha }), false, 'чужой ключ');
  assert.equal(updater.verifySignature(Buffer.alloc(64), { version: '3.1.5', sha256: sha, publicKey: pk }), false);
  assert.ok(updater.isOwnReleaseAsset('https://github.com/stailegrow/LifeVPN-Win/releases/download/v3.1.5/LifeVPN-Setup-3.1.5.exe'));
  for (const bad of ['http://github.com/stailegrow/LifeVPN-Win/releases/download/v1/x.exe',
    'https://github.com/evil/LifeVPN-Win/releases/download/v1/x.exe',
    'https://github.com.evil.net/stailegrow/LifeVPN-Win/releases/download/v1/x.exe', 'not a url']) {
    assert.equal(updater.isOwnReleaseAsset(bad), false, bad);
  }

  // --- Ссылки: неизвестный security — ошибка, пустой и отсутствующий — none.
  const base = 'vless://00000000-0000-4000-8000-000000000001@h.example.com:443?encryption=none&type=tcp';
  assert.equal(Parser.parse(base).security, 'none');
  assert.equal(Parser.parse(`${base}&security=`).security, 'none');
  assert.equal(Parser.parse(`${base}&security=TLS&sni=h.example.com`).security, 'tls');
  assert.throws(() => Parser.parse(`${base}&security=quantum`), /quantum/);
  const many = Parser.parseMany(`${base}&security=quantum\n${base}&security=tls`);
  assert.equal(many.configs.length, 1);
  assert.equal(many.errors.length, 1);

  // --- Слушатели только на 127.0.0.1.
  const tree = Builder.makeTree(Parser.parse(base), { metricsPort: 5555 });
  for (const inbound of tree.inbounds) assert.equal(inbound.listen, '127.0.0.1');
  assert.equal(tree.metrics.listen, '127.0.0.1:5555');

  // --- Журнал маршрутизации: ротация вместо обнуления, ничего не теряется.
  const log = new RoutingLog();
  log.reset();
  const line = '2026/10/23 06:39:53.219282 from tcp:127.0.0.1:42840 accepted tcp:github.com:443 [socks -> direct]\n';
  const big = line.repeat(Math.ceil((8 * 1024 * 1024 + 10) / line.length));
  fs.writeFileSync(paths.accessLog(), big);
  for (let i = 0; i < 20 && log.offset < big.length; i++) log.poll();
  const counted = log.counts.direct;
  assert.equal(counted, big.length / line.length, 'все строки посчитаны до ротации');
  log.poll(); // ротация
  assert.ok(fs.existsSync(`${paths.accessLog()}.1`), 'часть перенесена в access.log.1');
  assert.equal(fs.statSync(paths.accessLog()).size, 0);
  fs.appendFileSync(paths.accessLog(), line);
  log.poll();
  assert.equal(log.counts.direct, counted + 1);
  assert.ok(log.report().includes('github.com'));
  log.reset();
  assert.equal(fs.existsSync(`${paths.accessLog()}.1`), false);

  console.log('Security hardening: atomic private writes, ACL and link checks, update signature, link security, loopback listeners, routing log rotation passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
