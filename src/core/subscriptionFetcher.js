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
  if (!url || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error(t('Это не похоже на ссылку подписки.', 'This does not look like a subscription link.'));
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
    headers: { 'User-Agent': userAgent },
    timeout
  });
  try {
    if (!response.ok) {
      throw new Error(t(`Сервер подписки ответил кодом ${response.status}.`, `The subscription server replied with code ${response.status}.`));
    }
    let body;
    try {
      const buffer = Buffer.from(await response.arrayBuffer());
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
    const days = parseFloat(header('profile-update-interval') || '');
    if (days > 0) payload.updateIntervalHours = days * 24;
    return payload;
  } finally {
    done();
  }
}

module.exports = { fetchSubscription };
