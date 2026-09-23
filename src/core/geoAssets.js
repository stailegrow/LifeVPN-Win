'use strict';

const fs = require('fs');
const path = require('path');
const http = require('./http');
const paths = require('./paths');
const { t } = require('./l10n');
const { formatBytes, formatUpdated } = require('./format');
const { DEFAULT_GEOSITE_URL, DEFAULT_GEOIP_URL } = require('./models');

/**
 * Базы geosite.dat и geoip.dat: по ним ядро понимает, что такое
 * «российский сайт» или «реклама». Путь к папке отдаётся ядру через
 * переменную окружения XRAY_LOCATION_ASSET.
 */

/** Оборвавшаяся закачка иначе выглядит как успешная, а ядро падает. */
const MINIMUM_SIZE = 50 * 1024;

const geosite = () => path.join(paths.geoDir(), 'geosite.dat');
const geoip = () => path.join(paths.geoDir(), 'geoip.dat');

function isValid(file) {
  try {
    return fs.statSync(file).size >= MINIMUM_SIZE;
  } catch (_) {
    return false;
  }
}

const isReady = () => isValid(geosite()) && isValid(geoip());

function lastUpdated() {
  const dates = [geosite(), geoip()].map((f) => {
    try { return fs.statSync(f).mtime; } catch (_) { return null; }
  }).filter(Boolean);
  if (!dates.length) return null;
  return new Date(Math.min(...dates.map((d) => d.getTime())));
}

function summary() {
  if (!isReady()) return t('не загружены', 'not downloaded');
  const total = [geosite(), geoip()].reduce((sum, f) => {
    try { return sum + fs.statSync(f).size; } catch (_) { return sum; }
  }, 0);
  const size = formatBytes(total);
  const date = lastUpdated();
  return date ? `${size} · ${formatUpdated(date)}` : size;
}

const resolveURLs = (routing) => ({
  geositeURL: routing && routing.geositeURL ? routing.geositeURL : DEFAULT_GEOSITE_URL,
  geoipURL: routing && routing.geoipURL ? routing.geoipURL : DEFAULT_GEOIP_URL
});

/**
 * Обновление при каждом запуске, без оглядки на возраст файлов: устаревший
 * список — это молча неверная маршрутизация. Ошибку показывать некому —
 * если не обновились, работают прежние.
 */
async function refreshOnLaunch(routing) {
  try { await download(routing); } catch (_) { /* работают прежние */ }
}

async function download(routing) {
  const { geositeURL, geoipURL } = resolveURLs(routing);
  await fetchTo(geositeURL, geosite(), 'geosite.dat');
  await fetchTo(geoipURL, geoip(), 'geoip.dat');
}

async function fetchTo(address, destination, name) {
  try {
    new URL(address);
  } catch (_) {
    throw new Error(t(`Неверная ссылка на ${name}.`, `Bad link for ${name}.`));
  }

  const { response, done } = await http.request(address, { route: 'system', timeout: 60000 });
  let buffer;
  try {
    if (!response.ok) {
      throw new Error(t(`Сервер вернул код ${response.status} на ${name}.`, `The server returned code ${response.status} for ${name}.`));
    }
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw http.normalizeError(error);
  } finally {
    done();
  }

  if (buffer.length < MINIMUM_SIZE) {
    throw new Error(t(`Файл ${name} пришёл обрезанным (${buffer.length} байт).`, `File ${name} arrived truncated (${buffer.length} bytes).`));
  }

  // Пишем через временный файл: оборванная замена не должна оставить на
  // месте рабочей базы огрызок, на котором ядро не поднимется.
  const staging = `${destination}.new`;
  fs.writeFileSync(staging, buffer);
  fs.renameSync(staging, destination);
}

module.exports = { isReady, summary, download, refreshOnLaunch, geoDir: () => paths.geoDir() };
