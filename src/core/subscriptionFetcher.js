'use strict';

const http = require('./http');
const { t } = require('./l10n');
const Parse = require('./subscriptionParse');

/**
 * Часть панелей отвечает заголовком subscription-userinfo только знакомым
 * клиентам, а незнакомым отдаёт голый список ссылок. Поэтому сначала
 * представляемся собой, а если ссылок нет — повторяем запрос с
 * распространёнными строками.
 */
function userAgents(version) {
  return [`LifeVPN/${version}`, 'v2rayNG/1.9.5', 'Happ/1.0'];
}

async function fetchSubscription(urlString, { version = 'dev', timeout = 20000 } = {}) {
  let url;
  try {
    url = new URL(String(urlString).trim());
  } catch (_) {
    url = null;
  }
  if (!url || url.protocol !== 'https:') {
    throw new Error(t('Для подписки нужна защищённая ссылка HTTPS.', 'A secure HTTPS subscription link is required.'));
  }

  let lastFailure = null;
  for (const agent of userAgents(version)) {
    try {
      const payload = await load(url.toString(), agent, timeout);
      if (payload.links.length) return payload;
      lastFailure = new Error(t('Подписка ответила, но ни одной ссылки в ответе нет.', 'The subscription answered, but the reply holds no links.'));
    } catch (error) {
      lastFailure = error;
    }
  }
  throw lastFailure || new Error(t('Не удалось загрузить подписку.', 'Could not load the subscription.'));
}

async function load(url, userAgent, timeout) {
  const { response, done } = await http.request(url, {
    route: 'system',
    httpsOnly: true,
    headers: { 'User-Agent': userAgent },
    timeout
  });
  try {
    if (!response.ok) {
      throw new Error(t(`Сервер подписки ответил кодом ${response.status}.`, `The subscription server replied with code ${response.status}.`));
    }
    let body;
    try {
      const limit = 8 * 1024 * 1024;
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Subscription response has no body');
      const chunks = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > limit) throw new Error(t('Ответ подписки слишком большой.', 'Subscription response is too large.'));
          chunks.push(Buffer.from(value));
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const buffer = Buffer.concat(chunks, size);
      body = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch (error) {
      if (error && error.name === 'TypeError') {
        throw new Error(t('Ответ подписки не читается как текст.', 'The subscription reply is not readable as text.'));
      }
      throw http.normalizeError(error);
    }

    const header = (name) => {
      const value = response.headers.get(name);
      return value && value.trim() ? value : null;
    };

    const payload = {
      links: Parse.decodeBody(body),
      title: null,
      announce: null,
      updateIntervalHours: null,
      userInfo: { used: null, total: null, expiresAt: null },
      rawUserInfo: null
    };
    const title = header('profile-title');
    if (title) payload.title = Parse.decodeHeaderValue(title);
    const announce = header('announce');
    if (announce) payload.announce = Parse.decodeHeaderValue(announce);
    const info = header('subscription-userinfo');
    if (info) {
      payload.rawUserInfo = info;
      payload.userInfo = Parse.parseUserInfo(info);
    }
    payload.updateIntervalHours = Parse.parseUpdateInterval(header('profile-update-interval')); 
    return payload;
  } finally {
    done();
  }
}

module.exports = { fetchSubscription };
