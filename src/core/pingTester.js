'use strict';

const net = require('net');

/**
 * Замер задержки до сервера обычным TCP-подключением.
 *
 * Это не ICMP-пинг: меряем время до установления TCP-соединения с портом
 * сервера. Для прокси такой замер честнее — он проверяет ровно тот порт,
 * через который пойдёт трафик, и не требует прав.
 *
 * Сокет Node про системный прокси не знает ничего и идёт ровно туда, куда
 * сказано, — поэтому цифра не зависит от того, поднят туннель или нет.
 */

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.floor((sorted[middle - 1] + sorted[middle]) / 2);
}

function attempt(host, port, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const started = process.hrtime.bigint();
    const socket = net.connect({ host, port, noDelay: true });
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.once('connect', () => {
      const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
      finish(Math.max(1, Math.floor(elapsed)));
    });
    socket.once('error', () => finish(null));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Одиночный замер врёт: в первую попытку попадает резолв имени. Поэтому
 * греем соединение, делаем несколько попыток и берём медиану — не
 * минимум: минимум максимально чувствителен к единственному ложному замеру.
 * `warmup` и `samples` снижаются для фонового опроса.
 */
async function latency(host, port, { samples = 3, timeout = 4000, warmup = true } = {}) {
  if (warmup) await attempt(host, port, timeout);

  const values = [];
  const count = Math.max(1, samples);
  for (let index = 0; index < count; index++) {
    const value = await attempt(host, port, timeout);
    if (value != null && value >= 1) values.push(value);
    if (index < count - 1) await sleep(120);
  }
  return values.length ? median(values) : null;
}

/** Как красить значение задержки. */
function quality(ms) {
  if (ms < 120) return 'good';
  if (ms < 250) return 'fair';
  return 'poor';
}

module.exports = { median, latency, quality };
