'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const paths = require('./paths');
const { t } = require('./l10n');

/**
 * Журнал маршрутизации: куда ушло каждое соединение — в туннель, напрямую
 * или в блок. Перенос RoutingLog.swift.
 *
 * Источник — access-лог самого Xray. Ядро пишет в него строку на каждое
 * принятое соединение, а мы раз в секунду дочитываем только новые байты:
 * перечитывать файл целиком при каждом опросе — лишняя работа на долгой
 * сессии. Файл обнуляется при каждом подключении и не растёт бесконечно.
 */

const ROUTES = ['proxy', 'direct', 'block', 'other'];

const SHOWN_LIMIT = 400;
/** Выше этого размера файл ротируется: текущая часть переносится в
 *  access.log.1 (прежняя такая часть заменяется), а access.log начинается
 *  заново. Итого на диске не больше двух частей — около 16 МиБ — за сессию;
 *  при новом подключении обе части удаляются. Обрезка происходит только
 *  после того, как всё уже записанное прочитано и посчитано, поэтому события
 *  не теряются молча; в отчёт попадают обе части. */
const FILE_LIMIT = 8 * 1024 * 1024;
const rotated = () => `${paths.accessLog()}.1`;
const CHUNK_LIMIT = 1024 * 1024;

function routeOf(tag) {
  return ['proxy', 'direct', 'block'].includes(tag) ? tag : 'other';
}

function routeTitle(route) {
  switch (route) {
    case 'proxy': return t('Туннель', 'Tunnel');
    case 'direct': return t('Напрямую', 'Direct');
    case 'block': return t('Блок', 'Blocked');
    default: return t('Другое', 'Other');
  }
}

/**
 * `2026/10/23 06:39:53.219282 from tcp:127.0.0.1:42840 accepted tcp:github.com:443 [socks -> direct]`
 *
 * HTTP-прокси пишет адрес как `//host:port`, служебные запросы DNS самого
 * ядра (`from DNS`) в журнал не попадают — к трафику пользователя они
 * отношения не имеют. Возвращает запись без id или null.
 */
function parseLine(rawLine) {
  const line = String(rawLine).replace(/\r$/, '');
  const accepted = line.indexOf(' accepted ');
  if (accepted < 0) return null;
  const open = line.indexOf(' [', accepted + 10);
  if (open < 0) return null;
  const close = line.indexOf(']', open + 2);
  if (close < 0) return null;

  const head = line.slice(0, accepted);
  if (head.includes(' from DNS')) return null;
  const headParts = head.split(' ').filter(Boolean);
  const time = headParts.length > 1 ? headParts[1].slice(0, 8) : '';

  let target = line.slice(accepted + 10, open);
  let network = 'tcp';
  // Обычный HTTP через HTTP-вход ядро пишет целым адресом: `http://host/path`.
  const plain = /^(https?):\/\/(\[[^\]]+\]|[^/:]+)(?::(\d+))?/i.exec(target);
  if (plain) {
    const host = plain[2].replace(/^\[|\]$/g, '');
    const port = plain[3] || (plain[1].toLowerCase() === 'https' ? '443' : '80');
    target = `${host.includes(':') ? `[${host}]` : host}:${port}`;
  } else if (target.startsWith('//')) {
    target = target.slice(2);
  } else if (target.startsWith('tcp:') || target.startsWith('udp:')) {
    network = target.slice(0, 3);
    target = target.slice(4);
  }
  const colon = target.lastIndexOf(':');
  if (colon < 0) return null;
  let host = target.slice(0, colon);
  const port = target.slice(colon + 1);
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);

  const detour = line.slice(open + 2, close);
  const byDefault = detour.includes(' >> ');
  const sides = detour.split(byDefault ? ' >> ' : ' -> ');
  if (sides.length !== 2) return null;

  return {
    time,
    network: network.toUpperCase(),
    host,
    port,
    inbound: sides[0],
    route: routeOf(sides[1].trim()),
    byDefault
  };
}

class RoutingLog extends EventEmitter {
  constructor() {
    super();
    this.entries = [];
    this.counts = {};
    this.offset = 0;
    this.pending = '';
    this.nextID = 0;
    this.poller = null;
  }

  /** Перед запуском ядра: старый журнал к новой сессии отношения не имеет. */
  reset() {
    this.end();
    try { fs.rmSync(paths.accessLog(), { force: true }); } catch (_) { /* занят — обнулится сам */ }
    try { fs.rmSync(rotated(), { force: true }); } catch (_) { /* нет файла */ }
    this.rotations = 0;
    this.offset = 0;
    this.pending = '';
    this.entries = [];
    this.counts = {};
    this.emit('change');
  }

  begin() {
    this.end();
    this.poller = setInterval(() => this.poll(), 1000);
  }

  end() {
    if (this.poller) clearInterval(this.poller);
    this.poller = null;
  }

  poll() {
    const file = paths.accessLog();
    let fd;
    try {
      fd = fs.openSync(file, 'r');
    } catch (_) {
      return;
    }
    try {
      const size = fs.fstatSync(fd).size;
      if (size < this.offset) { this.offset = 0; this.pending = ''; } // файл обнулили
      if (size > FILE_LIMIT && this.offset >= size) {
        // Всё записанное уже прочитано — переносим часть в access.log.1 и
        // начинаем файл заново. Ядро пишет в режиме дозаписи, поэтому
        // следующая строка просто ляжет в начало пустого файла.
        try {
          fs.copyFileSync(file, rotated());
          fs.truncateSync(file, 0);
          this.rotations = (this.rotations || 0) + 1;
          this.offset = 0;
          this.pending = '';
        } catch (_) { /* занят — попробуем в следующий раз */ }
        return;
      }
      if (size <= this.offset) return;

      const length = Math.min(size - this.offset, CHUNK_LIMIT);
      const buffer = Buffer.alloc(length);
      const read = fs.readSync(fd, buffer, 0, length, this.offset);
      this.offset += read;
      this.pending += buffer.slice(0, read).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }

    const lastNewline = this.pending.lastIndexOf('\n');
    if (lastNewline < 0) return;
    const complete = this.pending.slice(0, lastNewline);
    this.pending = this.pending.slice(lastNewline + 1);

    const fresh = [];
    for (const line of complete.split('\n')) {
      const entry = parseLine(line);
      if (entry) {
        this.nextID += 1;
        fresh.push({ id: this.nextID, ...entry });
      }
    }
    this.append(fresh);
  }

  append(fresh) {
    if (!fresh.length) return;
    for (const entry of fresh) this.counts[entry.route] = (this.counts[entry.route] || 0) + 1;
    let merged = fresh.slice().reverse().concat(this.entries);
    if (merged.length > SHOWN_LIMIT) merged = merged.slice(0, SHOWN_LIMIT);
    this.entries = merged;
    this.emit('change');
  }

  /** Весь журнал текущей сессии текстом — не только то, что в окне. */
  report(now = new Date()) {
    this.poll();
    let all = [];
    for (const file of [rotated(), paths.accessLog()]) {
      try {
        const text = fs.readFileSync(file, 'utf8');
        for (const line of text.split('\n')) {
          const entry = parseLine(line);
          if (entry) all.push(entry);
        }
      } catch (_) { /* файла нет */ }
    }
    if (!all.length) all = this.entries.slice().reverse();

    const two = (v) => String(v).padStart(2, '0');
    const stamp = `${two(now.getDate())}.${two(now.getMonth() + 1)}.${now.getFullYear()} ${two(now.getHours())}:${two(now.getMinutes())}`;
    const totals = ROUTES
      .map((route) => {
        const n = all.filter((e) => e.route === route).length;
        return n > 0 ? `${routeTitle(route)}: ${n}` : null;
      })
      .filter(Boolean)
      .join('  ·  ');

    const lines = [
      'Life VPN — журнал маршрутизации',
      `Выгружен: ${stamp}`,
      `Соединений: ${all.length}  ·  ${totals}`,
      '',
      'Время     Сеть  Маршрут    Правило      Адрес'
    ];
    for (const e of all) {
      const route = routeTitle(e.route).padEnd(10, ' ').slice(0, 10);
      const rule = (e.byDefault ? 'по умолч.' : 'правило').padEnd(12, ' ');
      lines.push(`${e.time}  ${e.network}   ${route} ${rule} ${e.host}:${e.port}`);
    }
    return `${lines.join('\r\n')}\r\n`;
  }

  /** Имя файла по умолчанию для выгрузки. */
  static exportName(now = new Date()) {
    const two = (v) => String(v).padStart(2, '0');
    return `LifeVPN-routing-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}_${two(now.getHours())}-${two(now.getMinutes())}.txt`;
  }

  snapshot() {
    return { entries: this.entries, counts: this.counts };
  }
}

module.exports = { RoutingLog, parseLine, routeTitle, ROUTES };
