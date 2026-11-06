'use strict';
// Журнал системного прокси (WIN01/WIN02/B02): снимок каждого подключения,
// восстановление строго по снимку, журнал сохраняется байт в байт при любой
// ошибке, новое подключение его не перезаписывает, повреждённый журнал не
// превращается в «просто выключить», старый формат журнала читается.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifevpn-proxy-test-'));
const paths = require('../src/core/paths');
paths.setRoot(root);
const proxy = require('../src/core/systemProxy');
const hex = proxy.encodeHex;

const LAN = { name: '', flags: 3, server: 'corporate:8080', bypass: '*.lan;<local>', autoconfig: '' };
const RAS = { name: 'Рабочий VPN', flags: 5, server: '', bypass: '', autoconfig: 'http://wpad.corp/proxy.pac' };
const snapshotText = (entries) => ['LIFEVPN-PROXY-SNAPSHOT 2',
  ...entries.map((e) => `E ${hex(e.name)} ${e.flags} ${hex(e.server)} ${hex(e.bypass)} ${hex(e.autoconfig)}`),
  `END ${entries.length}`].join('\r\n') + '\r\n';

let calls = [];
let fail = {};
proxy.setRunnerForTests((args) => {
  calls.push(args);
  const failure = fail[args[0] + (args[0] === 'restore-one' ? `:${args[1]}` : '')];
  if (failure) { const e = new Error(`${args[0]} failed`); e.status = failure; throw e; }
  if (args[0] === 'snapshot') return fail.snapshotText != null ? fail.snapshotText : snapshotText([LAN, RAS]);
  return '';
});

try {
  // Кодирование однозначно для кириллицы, пробелов и спецсимволов.
  for (const value of ['', 'Рабочий VPN', 'a;b <local>', '🙂 x']) assert.equal(proxy.decodeHex(hex(value)), value);
  assert.throws(() => proxy.decodeHex('04'));
  assert.throws(() => proxy.decodeHex('zzzz'));
  assert.throws(() => proxy.decodeHex('0000'));

  // Снимок двух подключений с разными значениями.
  assert.deepEqual(proxy.parseSnapshot(snapshotText([LAN, RAS])), [LAN, RAS]);
  for (const broken of ['', 'LIFEVPN-PROXY-SNAPSHOT 1\nE - 1 - - -\nEND 1', 'LIFEVPN-PROXY-SNAPSHOT 2\nE - 1 - - -\nEND 2',
    'LIFEVPN-PROXY-SNAPSHOT 2\nE - 1 - - -', 'LIFEVPN-PROXY-SNAPSHOT 2\nE - x - - -\nEND 1',
    'LIFEVPN-PROXY-SNAPSHOT 2\nE 0041 1 - - -\nEND 1', 'LIFEVPN-PROXY-SNAPSHOT 2\nE - 1 - -\nEND 1']) {
    assert.throws(() => proxy.parseSnapshot(broken), undefined, `принят битый снимок: ${broken}`);
  }

  // Включение: снимок → журнал → set.
  proxy.enable(10808, 10809);
  assert.deepEqual(calls.map((c) => c[0]), ['snapshot', 'set']);
  const journal = JSON.parse(fs.readFileSync(paths.proxyState(), 'utf8'));
  assert.equal(journal.version, 2);
  assert.deepEqual(journal.entries, [LAN, RAS]);
  const saved = fs.readFileSync(paths.proxyState());

  // Сбой восстановления одного профиля: остальные всё равно восстанавливаются,
  // журнал остаётся байт в байт.
  calls = [];
  fail = { [`restore-one:${hex(RAS.name)}`]: 2 };
  assert.throws(() => proxy.disable(), /Рабочий VPN|restore-one failed/);
  assert.deepEqual(calls.map((c) => c[1]), ['-', hex(RAS.name)]);
  assert.deepEqual(fs.readFileSync(paths.proxyState()), saved);

  // Новое подключение не перезаписывает журнал, пока восстановление не прошло.
  calls = [];
  assert.throws(() => proxy.enable(10808, 10809));
  assert.ok(!calls.some((c) => c[0] === 'set' || c[0] === 'snapshot'));
  assert.deepEqual(fs.readFileSync(paths.proxyState()), saved);

  // Повтор восстанавливает каждое подключение к его значениям.
  calls = [];
  fail = {};
  proxy.disable();
  assert.deepEqual(calls, [
    ['restore-one', '-', '3', hex(LAN.server), hex(LAN.bypass), '-'],
    ['restore-one', hex(RAS.name), '5', '-', '-', hex(RAS.autoconfig)]
  ]);
  assert.equal(fs.existsSync(paths.proxyState()), false);

  // Профиль удалили за время сессии (код 3) — не ошибка.
  proxy.enable(10808, 10809);
  fail = { [`restore-one:${hex(RAS.name)}`]: 3 };
  proxy.disable();
  assert.equal(fs.existsSync(paths.proxyState()), false);

  // Ошибка снимка: прокси не трогаем, журнала нет.
  calls = [];
  fail = { snapshot: 2 };
  assert.throws(() => proxy.enable(10808, 10809));
  assert.ok(!calls.some((c) => c[0] === 'set'));
  assert.equal(fs.existsSync(paths.proxyState()), false);
  fail = { snapshotText: 'garbage' };
  assert.throws(() => proxy.enable(10808, 10809));
  assert.ok(!calls.some((c) => c[0] === 'set'));

  // Журнал не записался — прокси не трогаем.
  fail = {};
  calls = [];
  fs.mkdirSync(paths.proxyState());
  assert.throws(() => proxy.enable(10808, 10809));
  assert.ok(!calls.some((c) => c[0] === 'set'));
  fs.rmSync(paths.proxyState(), { recursive: true });

  // Частичный сбой set: откат по журналу.
  calls = [];
  fail = { set: 2 };
  assert.throws(() => proxy.enable(10808, 10809), /set failed/);
  assert.deepEqual(calls.map((c) => c[0]), ['snapshot', 'set', 'restore-one', 'restore-one']);
  assert.equal(fs.existsSync(paths.proxyState()), false);

  // Сбой set и сбой отката: журнал остаётся, ошибка содержит обе причины.
  fail = { set: 2, [`restore-one:-`]: 2 };
  assert.throws(() => proxy.enable(10808, 10809), /set failed[\s\S]*restore-one failed/);
  assert.ok(fs.existsSync(paths.proxyState()));
  fail = {};
  proxy.disable();

  // Повреждённый журнал: ошибка, файл не тронут, никаких «clear».
  for (const broken of ['{broken', '{}', '{"version":2,"entries":[]}', '{"version":2,"entries":[{"name":"","flags":0,"server":"","bypass":"","autoconfig":""}]}',
    '{"previous":{"flags":"3"}}', 'null']) {
    fs.writeFileSync(paths.proxyState(), broken);
    calls = [];
    assert.throws(() => proxy.disable(), undefined, broken);
    assert.equal(fs.readFileSync(paths.proxyState(), 'utf8'), broken);
    assert.equal(calls.length, 0);
  }

  // Старый формат (до 3.1.5): одно значение для всех подключений.
  fs.writeFileSync(paths.proxyState(), JSON.stringify({ previous: { flags: 3, server: 'old:3128', bypass: '-', autoconfig: '-' }, httpPort: 1, socksPort: 2 }));
  calls = [];
  proxy.disable();
  assert.deepEqual(calls, [['restore', '3', 'old:3128', '-', '-']]);
  fs.writeFileSync(paths.proxyState(), JSON.stringify({ previous: null }));
  calls = [];
  proxy.disable();
  assert.deepEqual(calls, [['clear']]);

  // 127.0.0.1 в прежних настройках — чужой клиент, а не «наш след»: возвращается как есть.
  fail = { snapshotText: snapshotText([{ ...LAN, server: '127.0.0.1:7890' }]) };
  proxy.enable(10808, 10809);
  fail = {};
  calls = [];
  proxy.disable();
  assert.deepEqual(calls[0], ['restore-one', '-', '3', hex('127.0.0.1:7890'), hex(LAN.bypass), '-']);

  console.log('Proxy recovery: per-connection snapshot, exact restore, journal kept byte-for-byte on failure, reconnect blocked, RAS removal tolerated, corrupt and legacy journals handled');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
