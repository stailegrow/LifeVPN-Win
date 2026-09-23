'use strict';

/**
 * Внутренние проверки — те же, что `swift run LifeVPN --self-check` в
 * мак-версии. Запуск: `npm test`.
 *
 * Дополнительно, если рядом есть ядро (переменная LIFEVPN_XRAY или
 * resources/bin/xray[.exe]), каждый собранный конфиг прогоняется через
 * `xray run -test` — ядро само подтверждает, что конфиг годный.
 */

const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LinkParser = require('../src/core/linkParser');
const Builder = require('../src/core/configBuilder');
const Sub = require('../src/core/subscriptionParse');
const { merge } = require('../src/core/merge');
const Ping = require('../src/core/pingTester');
const models = require('../src/core/models');
const { formatBytes } = require('../src/core/format');

let passed = 0;
const failures = [];

function check(name, body) {
  try {
    body();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log(`  ✗ ${name}`);
  }
}

const equal = (actual, expected, label) => assert.deepStrictEqual(actual, expected, `${label}: ожидалось ${JSON.stringify(expected)}, получено ${JSON.stringify(actual)}`);
const expect = (condition, message) => assert.ok(condition, message);
const unwrap = (value, label) => { assert.ok(value != null, `${label}: значение отсутствует`); return value; };

// Структурно повторяют боевые ссылки, но с обезличенными ключами.
const Sample = {
  realityTCP: 'vless://00000000-0000-4000-8000-000000000001@nl.example.org:2026'
    + '?encryption=none&flow=xtls-rprx-vision&fp=firefox'
    + '&pbk=AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKK'
    + '&security=reality&sid=958559f8df0a&sni=www.mozilla.org'
    + '&spx=%2F2bb01d3e9e2403f&type=tcp#%F0%9F%87%B3%F0%9F%87%B1%20Netherlands',
  realityXHTTP: 'vless://00000000-0000-4000-8000-000000000002@de.example.org:2029'
    + '?encryption=none'
    + '&extra=%7B%22mode%22%3A%22stream-up%22%2C%22xPaddingBytes%22%3A%22100-1000%22%7D'
    + '&fp=firefox&host=&mode=stream-up&path=%2Fapi%2Fv1%2Faddon%2Fstream'
    + '&pbk=LLLLMMMMNNNNOOOOPPPPQQQQRRRRSSSSTTTTUUUUVVV'
    + '&security=reality&sid=d3&sni=services.addons.mozilla.org'
    + '&spx=%2F0603ab5b1cf278c&type=xhttp&x_padding_bytes=100-1000'
    + '#%F0%9F%87%A9%F0%9F%87%AA%20Germany'
};

const bypassRU = () => models.preset('bypass-ru').make();
const global = () => models.preset('global').make();
const firstUser = (outbound) => unwrap(unwrap(outbound.settings.vnext, 'vnext')[0].users, 'users')[0];

console.log('\nПарсер ссылок');
check('vless/reality поверх tcp разбирается', () => {
  const c = LinkParser.parse(Sample.realityTCP);
  equal(c.address, 'nl.example.org', 'адрес');
  equal(c.port, 2026, 'порт');
  equal(c.security, 'reality', 'тип защиты');
  equal(c.transport, 'tcp', 'транспорт');
  equal(c.flow, 'xtls-rprx-vision', 'flow');
  equal(c.sni, 'www.mozilla.org', 'sni');
  equal(c.spiderX, '/2bb01d3e9e2403f', 'spiderX');
});
check('имя с эмодзи декодируется', () => {
  equal(LinkParser.parse(Sample.realityTCP).name, '🇳🇱 Netherlands', 'имя');
});
check('xhttp разбирается со всеми параметрами', () => {
  const c = LinkParser.parse(Sample.realityXHTTP);
  equal(c.transport, 'xhttp', 'транспорт');
  equal(c.xhttpMode, 'stream-up', 'режим');
  equal(c.path, '/api/v1/addon/stream', 'путь');
  equal(c.xPaddingBytes, '100-1000', 'padding');
  expect(c.flow == null, 'у xhttp-ссылки не должно быть flow');
  expect(c.xhttpExtraJSON != null, 'extra потерялся');
});
check('пустой host не превращается в пустую строку', () => {
  expect(LinkParser.parse(Sample.realityXHTTP).host == null, 'host должен быть null');
});
check('короткий shortId сохраняется', () => {
  equal(LinkParser.parse(Sample.realityXHTTP).shortID, 'd3', 'shortId');
});
check('splithttp считается тем же xhttp', () => {
  equal(LinkParser.parse(Sample.realityXHTTP.replace('type=xhttp', 'type=splithttp')).transport, 'xhttp', 'транспорт');
});
check('неизвестная схема отвергается', () => {
  let error = null;
  try { LinkParser.parse('ss://whatever@host:443'); } catch (e) { error = e; }
  expect(error, 'ошибки не было, хотя схема не поддерживается');
  equal(error.kind, 'unsupportedScheme', 'тип ошибки');
  equal(error.detail, 'ss', 'схема');
});
check('многострочный разбор пропускает пустое и мусор', () => {
  const text = `# комментарий\n\n${Sample.realityTCP}\n${Sample.realityXHTTP}\nмусор`;
  const result = LinkParser.parseMany(text);
  equal(result.configs.length, 2, 'разобранных ссылок');
  equal(result.errors.length, 1, 'ошибок');
});

console.log('\nСборщик конфига');
check('reality-блок собирается для tcp', () => {
  const stream = Builder.streamSettings(LinkParser.parse(Sample.realityTCP));
  equal(stream.network, 'tcp', 'network');
  equal(stream.security, 'reality', 'security');
  const reality = unwrap(stream.realitySettings, 'realitySettings');
  equal(reality.serverName, 'www.mozilla.org', 'serverName');
  equal(reality.shortId, '958559f8df0a', 'shortId');
});
check('vision доживает до конфига на tcp', () => {
  equal(firstUser(Builder.outbound(LinkParser.parse(Sample.realityTCP))).flow, 'xtls-rprx-vision', 'flow');
});
check('vision вырезается на xhttp', () => {
  const c = LinkParser.parse(Sample.realityXHTTP);
  c.flow = 'xtls-rprx-vision';
  expect(firstUser(Builder.outbound(c)).flow === undefined, 'flow не должен попадать в xhttp-конфиг');
});
check('xhttpSettings — слияние extra и явных параметров', () => {
  const s = Builder.xhttpSettings(LinkParser.parse(Sample.realityXHTTP));
  equal(s.mode, 'stream-up', 'mode');
  equal(s.xPaddingBytes, '100-1000', 'xPaddingBytes');
  equal(s.path, '/api/v1/addon/stream', 'path');
  expect(s.host === undefined, 'пустой host не должен попадать в конфиг');
});
check('незнакомые поля из extra не теряются', () => {
  const c = LinkParser.parse(Sample.realityXHTTP);
  c.xhttpExtraJSON = '{"mode":"packet-up","xmux":{"maxConcurrency":8}}';
  const s = Builder.xhttpSettings(c);
  expect(s.xmux != null, 'xmux потерялся');
  equal(s.mode, 'stream-up', 'явный параметр должен перекрывать extra');
});
check('конфиг сериализуется и имеет ожидаемую форму', () => {
  const root = JSON.parse(Builder.makeJSON(LinkParser.parse(Sample.realityXHTTP), {}));
  equal(unwrap(root.inbounds, 'inbounds').length, 2, 'число входящих');
  equal(unwrap(root.outbounds, 'outbounds').map((o) => o.tag), ['proxy', 'direct', 'block'], 'теги исходящих');
});
check('роутинг не ссылается на geo-базы', () => {
  const tree = Builder.makeTree(LinkParser.parse(Sample.realityTCP), {});
  const rules = unwrap(unwrap(tree.routing, 'routing').rules, 'rules');
  for (const rule of rules) {
    for (const v of rule.ip || []) expect(!v.startsWith('geoip:'), `правило ссылается на ${v}`);
    for (const v of rule.domain || []) expect(!v.startsWith('geosite:'), `правило ссылается на ${v}`);
  }
  expect(rules.length > 0, 'локальные адреса должны идти мимо туннеля');
});
check('порты из настроек доезжают до входящих', () => {
  const tree = Builder.makeTree(LinkParser.parse(Sample.realityTCP), { socksPort: 11080, httpPort: 11081 });
  equal(tree.inbounds[0].port, 11080, 'socks-порт');
  equal(tree.inbounds[1].port, 11081, 'http-порт');
});

console.log('\nПодписки');
check('base64-тело подписки разворачивается', () => {
  const encoded = Buffer.from(`${Sample.realityTCP}\n${Sample.realityXHTTP}`).toString('base64');
  equal(Sub.decodeBody(encoded).length, 2, 'число ссылок');
});
check('base64 без выравнивания и в url-safe виде тоже разворачивается', () => {
  const encoded = Buffer.from(Sample.realityTCP).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  equal(Sub.decodeBody(encoded).length, 1, 'число ссылок');
});
check('обычный текст остаётся текстом', () => {
  equal(Sub.decodeBody(`${Sample.realityTCP}\n${Sample.realityXHTTP}`).length, 2, 'число ссылок');
});
check('заголовок subscription-userinfo разбирается', () => {
  const info = Sub.parseUserInfo('upload=100; download=200; total=1000; expire=1767225600');
  equal(info.used, 300, 'израсходовано');
  equal(info.total, 1000, 'всего');
  equal(info.expiresAt, new Date(1767225600 * 1000).toISOString(), 'срок');
});
check('expire=0 означает бессрочную подписку', () => {
  expect(Sub.parseUserInfo('upload=0; download=0; total=0; expire=0').expiresAt == null, 'нулевой expire не должен превращаться в дату');
});
check('base64-заголовок profile-title декодируется', () => {
  equal(Sub.decodeHeaderValue('base64:' + Buffer.from('Мой сервис').toString('base64')), 'Мой сервис', 'название');
});

console.log('\nСинхронизация подписки');
check('синхронизация сохраняет id уцелевших серверов', () => {
  const sid = 'SUB-1';
  const first = { ...LinkParser.parse(Sample.realityTCP), subscriptionID: sid };
  const second = { ...LinkParser.parse(Sample.realityXHTTP), subscriptionID: sid };
  const result = merge([first, second], [LinkParser.parse(Sample.realityXHTTP)], sid);
  equal(result.servers.length, 1, 'осталось серверов');
  equal(result.servers[0].id, second.id, 'id уцелевшего сервера должен сохраниться');
  equal(result.removed, 1, 'удалено');
  equal(result.added, 0, 'добавлено');
});
check('новые серверы из подписки добавляются', () => {
  const sid = 'SUB-2';
  const existing = { ...LinkParser.parse(Sample.realityTCP), subscriptionID: sid };
  const result = merge([existing], [LinkParser.parse(Sample.realityTCP), LinkParser.parse(Sample.realityXHTTP)], sid);
  equal(result.servers.length, 2, 'стало серверов');
  equal(result.added, 1, 'добавлено');
  equal(result.removed, 0, 'удалено');
});
check('переименование на сервере подхватывается без потери id', () => {
  const sid = 'SUB-3';
  const existing = { ...LinkParser.parse(Sample.realityTCP), subscriptionID: sid, name: 'Старое имя' };
  const result = merge([existing], [LinkParser.parse(Sample.realityTCP)], sid);
  equal(result.servers[0].id, existing.id, 'id');
  equal(result.servers[0].name, '🇳🇱 Netherlands', 'имя должно обновиться');
});
check('ручные серверы не трогаются синхронизацией подписки', () => {
  const result = merge([LinkParser.parse(Sample.realityTCP)], [], 'SUB-4');
  equal(result.servers.length, 1, 'ручной сервер должен уцелеть');
  equal(result.removed, 0, 'удалено');
});

console.log('\nМаршрутизация');
check('глобальный пресет обходится без geo-баз', () => {
  expect(!models.needsGeoAssets(global()), 'глобальному режиму базы не нужны');
});
check('пресет обхода РФ требует geo-базы', () => {
  expect(models.needsGeoAssets(bypassRU()), 'правила geosite: без баз не работают');
});
check('блокировки идут раньше правила «российское напрямую»', () => {
  const tags = Builder.routing(bypassRU()).rules.map((r) => r.outboundTag);
  const block = tags.indexOf('block');
  const direct = tags.lastIndexOf('direct');
  expect(block >= 0 && direct >= 0 && block < direct, 'реклама обязана отсекаться до общего правила direct');
});
check('QUIC блокируется самым первым правилом', () => {
  const first = Builder.routing(bypassRU()).rules[0];
  equal(first.network, 'udp', 'сеть');
  equal(first.port, '443', 'порт');
  equal(first.outboundTag, 'block', 'тег первого правила');
});
check('локальная сеть уходит напрямую сразу за блоком QUIC', () => {
  const rules = Builder.routing(bypassRU()).rules;
  expect(rules.length > 1, 'правил должно быть больше одного');
  equal(rules[1].outboundTag, 'direct', 'тег правила локальной сети');
  expect(unwrap(rules[1].ip, 'диапазоны').includes('192.168.0.0/16'), 'домашняя сеть должна идти мимо туннеля');
});
check('выключенный обход LAN убирает правило локальной сети', () => {
  const config = bypassRU();
  config.bypassLAN = false;
  const rules = Builder.routing(config).rules;
  expect(!rules.some((r) => (r.ip || []).includes('192.168.0.0/16')), 'правило локальной сети должно исчезнуть');
});
check('свои домены идут напрямую и раньше правил туннеля', () => {
  const config = bypassRU();
  config.directDomains = ['mail.company.ru'];
  const rules = Builder.routing(config).rules;
  const mine = rules.findIndex((r) => (r.domain || []).includes('mail.company.ru'));
  const firstProxy = rules.findIndex((r) => r.outboundTag === 'proxy');
  expect(mine >= 0 && firstProxy >= 0 && mine < firstProxy, 'свой домен обязан побеждать общие категории');
  equal(rules[mine].outboundTag, 'direct', 'тег правила');
});
check('свои домены резолвятся системным DNS', () => {
  const config = bypassRU();
  config.directDomains = ['mail.company.ru'];
  const first = unwrap(Builder.dns(config), 'блок dns').servers[0];
  equal(first.address, 'localhost', 'резолвер');
  expect(first.domains.includes('mail.company.ru'), 'домен должен быть в списке');
});
check('при обходе LAN добавляются имена без точки и зона .local', () => {
  const config = bypassRU();
  config.bypassLAN = true;
  const domains = models.effectiveDirectDomains(config);
  expect(domains.includes('domain:local'), 'зона .local');
  expect(domains.includes('regexp:^[^.]+$'), 'внутренние имена без точки');
});
check('российские домены резолвятся местным DNS', () => {
  const servers = unwrap(Builder.dns(bypassRU()), 'блок dns').servers;
  const domestic = unwrap(servers.find((s) => typeof s === 'object' && s.address === 'https://77.88.8.8/dns-query'), 'местный резолвер');
  expect(domestic.domains.includes('geosite:category-ru'), 'российская категория должна быть в списке');
});
check('системный резолвер стоит раньше публичных', () => {
  const config = bypassRU();
  config.directDomains = ['vexch01.uvi.lan'];
  equal(unwrap(Builder.dns(config), 'блок dns').servers[0].address, 'localhost', 'первым обязан идти системный');
});
check('без списков и без обхода LAN блока dns нет', () => {
  const config = global();
  config.bypassLAN = false;
  expect(Builder.dns(config) == null, 'разделять резолверы незачем, когда делить нечего');
});
check('domainStrategy у обхода — IPIfNonMatch', () => {
  equal(Builder.routing(bypassRU()).domainStrategy, 'IPIfNonMatch', 'стратегия');
});

console.log('\nСтатистика замеров');
check('медиана игнорирует единичный выброс', () => equal(Ping.median([54, 0, 56]), 54, 'медиана'));
check('медиана чётного числа замеров — среднее середины', () => equal(Ping.median([10, 20, 30, 40]), 25, 'медиана'));
check('пустой набор замеров даёт nil', () => expect(Ping.median([]) == null, 'мерить нечего'));

// ---------------------------------------------------------------------------
// Сверх мак-версии: то, что на Windows устроено иначе.
// ---------------------------------------------------------------------------

console.log('\nWindows-специфика');
check('размеры форматируются двоичными единицами', () => {
  require('../src/core/l10n').setLanguage('ru');
  equal(formatBytes(0), '0 КБ', 'ноль');
  equal(formatBytes(1536 * 1024), '1,5 МБ', 'мегабайты');
  require('../src/core/l10n').setLanguage('en');
  equal(formatBytes(1024 ** 3), '1 GB', 'гигабайт');
  require('../src/core/l10n').setLanguage('ru');
});
check('ключи Reality с «+» не превращаются в пробел', () => {
  const c = LinkParser.parse(Sample.realityTCP.replace('pbk=AAAA', 'pbk=A+AA'));
  equal(c.publicKey, 'A+AABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKK', 'pbk');
});
check('IPv6-адрес узла разбирается без скобок', () => {
  const c = LinkParser.parse('vless://id@[2001:db8::1]:443?security=none#v6');
  equal(c.address, '2001:db8::1', 'адрес');
  equal(c.port, 443, 'порт');
});

// Проверка ядром — только если бинарник под рукой.
const xray = process.env.LIFEVPN_XRAY
  || [path.join(__dirname, '..', 'resources', 'bin', process.platform === 'win32' ? 'xray.exe' : 'xray')]
    .find((p) => fs.existsSync(p) && (process.platform === 'win32' || !p.endsWith('.exe')));
if (xray) {
  console.log('\nПроверка ядром (xray run -test)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifevpn-check-'));
  const cases = [
    ['reality/tcp, глобально', Sample.realityTCP, global()],
    ['reality/xhttp, глобально', Sample.realityXHTTP, global()],
    ['reality/tcp, свои домены', Sample.realityTCP, { ...global(), directDomains: ['mail.company.ru'] }]
  ];
  for (const [name, link, routing] of cases) {
    check(`ядро принимает конфиг: ${name}`, () => {
      const file = path.join(dir, 'config.json');
      fs.writeFileSync(file, Builder.makeJSON(LinkParser.parse(link), { routing }));
      execFileSync(xray, ['run', '-test', '-c', file], { stdio: 'pipe' });
    });
  }
  const geo = process.env.LIFEVPN_GEO;
  if (geo) {
    check('ядро принимает конфиг: обход РФ с базами', () => {
      const file = path.join(dir, 'config.json');
      fs.writeFileSync(file, Builder.makeJSON(LinkParser.parse(Sample.realityTCP), { routing: bypassRU() }));
      execFileSync(xray, ['run', '-test', '-c', file], { stdio: 'pipe', env: { ...process.env, XRAY_LOCATION_ASSET: geo } });
    });
  }
}

console.log('');
if (failures.length === 0) {
  console.log(`Проверок пройдено: ${passed}. Все зелёные.`);
  process.exit(0);
}
console.log(`Пройдено: ${passed}, провалено: ${failures.length}`);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(1);
