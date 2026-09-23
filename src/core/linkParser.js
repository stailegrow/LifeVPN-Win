'use strict';

const { t } = require('./l10n');
const { makeProxyConfig, TRANSPORTS, SECURITIES } = require('./models');

/** Разбор share-ссылок. Пока только `vless://`. */
class LinkError extends Error {
  constructor(kind, detail) {
    super(LinkError.describe(kind, detail));
    this.kind = kind;
    this.detail = detail;
  }

  static describe(kind, detail) {
    switch (kind) {
      case 'unsupportedScheme':
        return t(`Протокол ${detail}:// пока не поддерживается.`, `The ${detail}:// protocol is not supported yet.`);
      case 'malformed': {
        const head = String(detail).slice(0, 48);
        return t(`Не удалось разобрать ссылку: ${head}…`, `Could not parse the link: ${head}…`);
      }
      case 'missingUser': return t('В ссылке нет идентификатора пользователя.', 'The link has no user id.');
      case 'missingHost': return t('В ссылке нет адреса сервера.', 'The link has no server address.');
      case 'missingPort': return t('В ссылке нет порта.', 'The link has no port.');
      default: return String(kind);
    }
  }
}

/**
 * Разбирает многострочный текст: пустые строки и комментарии пропускает,
 * нераспознанные строки возвращает отдельным списком.
 */
function parseMany(text) {
  const configs = [];
  const errors = [];
  for (const rawLine of String(text).split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    try {
      configs.push(parse(line));
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { configs, errors };
}

function parse(link) {
  const trimmed = String(link).trim();
  const scheme = trimmed.split(':')[0];
  if (!scheme) throw new LinkError('malformed', trimmed);
  switch (scheme.toLowerCase()) {
    case 'vless': return parseVLESS(trimmed);
    default: throw new LinkError('unsupportedScheme', scheme.toLowerCase());
  }
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}

/**
 * Параметры запроса как у URLComponents.queryItems: percent-декодирование
 * без превращения «+» в пробел — в ключах Reality и в JSON из `extra`
 * плюс значимый.
 */
function queryDictionary(query) {
  const result = {};
  if (!query) return result;
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const index = pair.indexOf('=');
    const name = safeDecode(index >= 0 ? pair.slice(0, index) : pair);
    if (index < 0) {
      delete result[name];
      continue;
    }
    result[name] = safeDecode(pair.slice(index + 1));
  }
  return result;
}

function nonEmpty(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

/**
 * vless://<uuid>@<host>:<port>?<query>#<name>
 *
 * Разбираем руками, а не через URL: для незнакомых схем он ведёт себя
 * по-разному в разных движках, а ссылки с панелей бывают неаккуратными.
 */
function parseVLESS(link) {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^?#]*)(\?[^#]*)?(#.*)?$/.exec(link);
  if (!match) throw new LinkError('malformed', link);
  if (/\s/.test(link)) throw new LinkError('malformed', link);

  const authority = match[2];
  const query = match[3] ? match[3].slice(1) : '';
  const fragment = match[4] ? match[4].slice(1) : null;

  const at = authority.lastIndexOf('@');
  const userPart = at >= 0 ? authority.slice(0, at) : '';
  const hostPort = (at >= 0 ? authority.slice(at + 1) : authority).replace(/\/.*$/, '');

  const user = safeDecode(userPart.split(':')[0] || '');
  if (!user) throw new LinkError('missingUser');

  let host = '';
  let portText = '';
  if (hostPort.startsWith('[')) {
    const close = hostPort.indexOf(']');
    if (close < 0) throw new LinkError('malformed', link);
    host = hostPort.slice(1, close);
    portText = hostPort.slice(close + 1).replace(/^:/, '');
  } else {
    const colon = hostPort.lastIndexOf(':');
    host = colon >= 0 ? hostPort.slice(0, colon) : hostPort;
    portText = colon >= 0 ? hostPort.slice(colon + 1) : '';
  }
  host = safeDecode(host);
  if (!host) throw new LinkError('missingHost');
  if (!portText) throw new LinkError('missingPort');
  if (!/^\d+$/.test(portText)) throw new LinkError('malformed', link);
  const port = parseInt(portText, 10);

  const q = queryDictionary(query);
  const config = makeProxyConfig({
    kind: 'vless',
    userID: user,
    address: host,
    port,
    sourceLink: link,
    name: fragment != null ? safeDecode(fragment) : ''
  });

  config.encryption = q.encryption != null ? q.encryption : 'none';
  config.flow = nonEmpty(q.flow);

  const security = (q.security != null ? q.security : 'none').toLowerCase();
  config.security = SECURITIES.includes(security) ? security : 'none';
  const transport = normalizedTransport(q);
  config.transport = TRANSPORTS.includes(transport) ? transport : 'tcp';

  config.sni = nonEmpty(q.sni) || nonEmpty(q.peer);
  config.fingerprint = nonEmpty(q.fp);
  config.publicKey = nonEmpty(q.pbk);
  config.shortID = nonEmpty(q.sid);
  config.spiderX = nonEmpty(q.spx);
  config.allowInsecure = ['1', 'true'].includes(String(q.allowInsecure || '').toLowerCase());
  const alpn = nonEmpty(q.alpn);
  if (alpn) {
    config.alpn = alpn.split(',').map((v) => v.trim()).filter(Boolean);
  }

  config.path = nonEmpty(q.path);
  config.host = nonEmpty(q.host);
  config.serviceName = nonEmpty(q.serviceName);
  config.headerType = nonEmpty(q.headerType);

  if (config.transport === 'xhttp') {
    config.xhttpMode = nonEmpty(q.mode);
    config.xhttpExtraJSON = nonEmpty(q.extra);
    // В ссылках параметр приходит в snake_case, в конфиге Xray он xPaddingBytes.
    config.xPaddingBytes = nonEmpty(q.x_padding_bytes) || nonEmpty(q.xPaddingBytes);
  }

  return config;
}

/** `splithttp` — прежнее имя XHTTP, ссылки со старых панелей им пользуются. */
function normalizedTransport(q) {
  const raw = String(q.type != null ? q.type : (q.net != null ? q.net : 'tcp')).toLowerCase();
  return raw === 'splithttp' ? 'xhttp' : raw;
}

module.exports = { parse, parseMany, LinkError };
