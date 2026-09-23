'use strict';

const http = require('./http');
const { t } = require('./l10n');

/**
 * Замер скорости скачивания.
 *
 * Меряем не «сколько заняла загрузка файла», а установившуюся скорость
 * потока: запрашиваем заведомо большой поток, первые 0,9 секунды
 * выбрасываем, считаем скорость на следующих четырёх и обрываем загрузку.
 */
const WARM_UP = 900;
const WINDOW = 4000;

/**
 * Cloudflare первым: сам сервис в России не блокируют, но его защита от
 * ботов режет запросы с адресов дата-центров. Hetzner — ровно наоборот.
 * CacheFly — третий, на случай если оба первых откажут разом.
 */
const SOURCES = [
  { name: 'Cloudflare', url: 'https://speed.cloudflare.com/__down?bytes=104857600' },
  { name: 'Hetzner', url: 'https://fsn1-speed.hetzner.com/100MB.bin' },
  { name: 'CacheFly', url: 'https://cachefly.cachefly.net/100mb.test' }
];

// Обычная браузерная строка: незнакомые сигнатуры клиентов Cloudflare
// блокирует раньше, чем запрос доходит до раздачи тестовых байт.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function measure(httpPort) {
  let lastMessage = t('Ни одно зеркало не ответило.', 'No mirror responded.');
  for (const source of SOURCES) {
    try {
      return await run(source, httpPort);
    } catch (error) {
      lastMessage = `${source.name}: ${error.message}`;
    }
  }
  throw new Error(lastMessage);
}

async function run(source, httpPort) {
  const route = httpPort ? { proxyPort: httpPort } : 'direct';
  const started = Date.now();
  // Шесть секунд без ответа — уже отказ: заблокированный хост обычно молчит.
  const { response, controller, done } = await http.request(source.url, {
    route,
    headers: { 'User-Agent': USER_AGENT },
    timeout: 6000
  });
  // Заголовки пришли — тайм-аут ожидания ответа больше не нужен, дальше
  // длительность ограничивает само окно замера.
  done();

  if (!response.ok) {
    controller.abort();
    throw new Error(t(`ответ с кодом ${response.status}`, `replied with code ${response.status}`));
  }

  let received = 0;
  let finished = false;
  let failure = null;
  const reader = response.body.getReader();
  const pump = (async () => {
    try {
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        received += value.byteLength;
      }
    } catch (error) {
      if (!controller.signal.aborted) failure = http.normalizeError(error).message;
    } finally {
      finished = true;
    }
  })();

  const now = () => (Date.now() - started) / 1000;
  await sleep(WARM_UP);
  const base = { bytes: received, at: now() };

  let waited = 0;
  while (waited < WINDOW && !finished) {
    await sleep(200);
    waited += 200;
  }
  const end = { bytes: received, at: now() };

  controller.abort();
  reader.cancel().catch(() => {});
  await pump.catch(() => {});

  const bytes = end.bytes - base.bytes;
  const seconds = end.at - base.at;
  if (!(bytes > 0) || !(seconds > 0.4)) {
    throw new Error(failure || t('поток оборвался, мерить нечего', 'the stream broke off, nothing to measure'));
  }
  return {
    mbps: (bytes * 8) / seconds / 1e6,
    bytes,
    seconds,
    throughProxy: !!httpPort,
    source: source.name,
    measuredAt: new Date().toISOString()
  };
}

module.exports = { measure };
