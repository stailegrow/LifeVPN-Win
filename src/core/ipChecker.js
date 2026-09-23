'use strict';

const http = require('./http');

/**
 * Проверка внешнего IP через локальный HTTP-прокси ядра.
 *
 * Ходим именно через прокси, а не через системные настройки: так проверка
 * отвечает на вопрос «работает ли туннель», не завися от того, применились
 * системные настройки или нет.
 */
const ENDPOINTS = ['https://api.ipify.org', 'https://ipinfo.io/ip', 'https://ifconfig.me/ip'];

function isPlausibleIP(value) {
  if (!value || value.length > 45) return false;
  if (value.includes(':')) return /^[0-9a-fA-F:.]+$/.test(value); // IPv6
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d+$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

async function probe(route, timeout) {
  for (const endpoint of ENDPOINTS) {
    try {
      const { response, done } = await http.request(endpoint, { route, timeout });
      try {
        const value = (await response.text()).trim();
        if (response.ok && isPlausibleIP(value)) return value;
      } finally {
        done();
      }
    } catch (_) { /* пробуем следующий */ }
  }
  return null;
}

const externalIP = (httpPort, timeout = 8000) => probe({ proxyPort: httpPort }, timeout);
const directExternalIP = (timeout = 8000) => probe('direct', timeout);

module.exports = { externalIP, directExternalIP, isPlausibleIP };
