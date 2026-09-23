'use strict';

/**
 * Сетевые запросы идут через сетевой стек Chromium (session.fetch):
 * он сам умеет системный прокси Windows, HTTP/2 и современный TLS.
 *
 * Три вида сессий — как три конфигурации URLSession в мак-версии:
 *   system  — уважает системные настройки (подписки, базы правил);
 *   direct  — мимо любого прокси (замер скорости без VPN, внешний IP);
 *   proxy(p)— строго через локальный HTTP-вход ядра (проверка туннеля).
 */

let sessions = null;

function init(electronSession) {
  const proxyCache = new Map();

  const direct = electronSession.fromPartition('lifevpn-direct', { cache: false });
  direct.setProxy({ mode: 'direct' });

  sessions = {
    system: electronSession.fromPartition('lifevpn-system', { cache: false }),
    direct,
    async proxy(port) {
      if (!proxyCache.has(port)) {
        const ses = electronSession.fromPartition(`lifevpn-proxy-${port}`, { cache: false });
        await ses.setProxy({ proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`, proxyBypassRules: '' });
        proxyCache.set(port, ses);
      }
      const ses = proxyCache.get(port);
      // Старые соединения могли остаться от прошлого запуска ядра.
      await ses.closeAllConnections().catch(() => {});
      return ses;
    }
  };
  sessions.system.setProxy({ mode: 'system' });
}

async function sessionFor(route) {
  if (!sessions) throw new Error('http: not initialised');
  if (route && typeof route === 'object' && route.proxyPort) return sessions.proxy(route.proxyPort);
  return route === 'direct' ? sessions.direct : sessions.system;
}

/**
 * fetch с тайм-аутом. `timeout` — на весь запрос, пока не пришли
 * заголовки; тело читает вызывающий.
 */
async function request(url, { route = 'system', headers = {}, timeout = 20000, signal } = {}) {
  const ses = await sessionFor(route);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeout);
  if (signal) signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  try {
    const response = await ses.fetch(url, {
      headers: { 'Cache-Control': 'no-cache', ...headers },
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'follow',
      bypassCustomProtocolHandlers: true
    });
    return { response, controller, done: () => clearTimeout(timer) };
  } catch (error) {
    clearTimeout(timer);
    throw normalizeError(error);
  }
}

/** Ошибки Chromium приходят кодами net::ERR_… — переводим в человеческие. */
function normalizeError(error) {
  const { t } = require('./l10n');
  const text = String((error && (error.message || error.cause)) || error);
  if (/timeout|aborted|ERR_TIMED_OUT/i.test(text)) return new Error(t('Время ожидания истекло.', 'The request timed out.'));
  if (/ERR_NAME_NOT_RESOLVED/.test(text)) return new Error(t('Не удалось найти сервер по имени.', 'The server name could not be resolved.'));
  if (/ERR_CONNECTION_REFUSED/.test(text)) return new Error(t('Сервер отклонил подключение.', 'The server refused the connection.'));
  if (/ERR_INTERNET_DISCONNECTED/.test(text)) return new Error(t('Нет подключения к интернету.', 'There is no internet connection.'));
  if (/ERR_PROXY_CONNECTION_FAILED/.test(text)) return new Error(t('Не удалось подключиться к прокси.', 'Could not connect to the proxy.'));
  if (/ERR_CONNECTION_(RESET|CLOSED)|ERR_EMPTY_RESPONSE/.test(text)) return new Error(t('Соединение оборвалось.', 'The connection was dropped.'));
  if (/ERR_CERT|ERR_SSL/.test(text)) return new Error(t('Ошибка защищённого соединения.', 'A secure connection error occurred.'));
  return error instanceof Error ? error : new Error(text);
}

module.exports = { init, request, normalizeError };
