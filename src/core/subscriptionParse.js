'use strict';

/**
 * Разбор ответа подписки. Панели отдают список по-разному: то простым
 * текстом, то base64 целиком, то url-safe base64 без выравнивания.
 */

function links(text) {
  text = String(text);
  const result = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && text[i] !== '\r' && text[i] !== '\n') continue;
    const line = text.slice(start, i).trim();
    if (line && !line.startsWith('#') && line.includes('://')) {
      if (result.length >= 10000) {
        const { t } = require('./l10n');
        throw new Error(t('В подписке слишком много ссылок.', 'Subscription contains too many links.'));
      }
      result.push(line);
    }
    if (text[i] === '\r' && text[i + 1] === '\n') i++;
    start = i + 1;
  }
  return result;
}

function decodeBase64(value) {
  let normalized = String(value).replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  // Выравнивание до кратности четырём — многие панели его срезают.
  const remainder = normalized.length % 4;
  if (remainder > 0) normalized += '='.repeat(4 - remainder);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null;
  const buffer = Buffer.from(normalized, 'base64');
  const text = buffer.toString('utf8');
  // Невалидный UTF-8 даёт символ замены — считаем, что это был не base64.
  if (text.includes('�')) return null;
  return text;
}

/** Строки-ссылки. Тело может быть простым текстом либо base64. */
function decodeBody(body) {
  const trimmed = String(body).trim();
  if (!trimmed) return [];
  if (trimmed.includes('://')) return links(trimmed);
  const decoded = decodeBase64(trimmed);
  return decoded != null ? links(decoded) : [];
}

/** Заголовки с не-ASCII панели присылают как `base64:<...>`. */
function decodeHeaderValue(value) {
  const trimmed = String(value).trim();
  if (trimmed.toLowerCase().startsWith('base64:')) {
    const payload = trimmed.slice('base64:'.length);
    const decoded = decodeBase64(payload);
    return decoded != null ? decoded : payload;
  }
  return trimmed ? trimmed : null;
}

/** `upload=1; download=2; total=3; expire=1767225600` */
function parseUserInfo(value) {
  const fields = Object.create(null);
  for (const pair of String(value).split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    const key = pair.slice(0, index).trim().toLowerCase();
    const raw = pair.slice(index + 1).trim();
    const number = /^\d+$/.test(raw) ? Number(raw) : NaN;
    fields[key] = Number.isSafeInteger(number) ? number : null;
  }
  const info = { used: null, total: null, expiresAt: null };
  const has = key => Object.hasOwn(fields, key);
  if (has('upload') || has('download')) {
    const up = has('upload') ? fields.upload : 0;
    const down = has('download') ? fields.download : 0;
    if (up !== null && down !== null && Number.isSafeInteger(up + down)) info.used = up + down;
  }
  if (fields.total != null) info.total = fields.total;
  if (fields.expire > 0) {
    const date = new Date(fields.expire * 1000);
    if (Number.isFinite(date.getTime())) info.expiresAt = date.toISOString();
  }
  return info;
}

function parseUpdateInterval(value) {
  if (value == null || !String(value).trim()) return null;
  const days = Number(value);
  const hours = days * 24;
  return days > 0 && Number.isFinite(hours * 3600000) && hours > 0 ? hours : null;
}

module.exports = { decodeBody, decodeBase64, decodeHeaderValue, parseUserInfo, parseUpdateInterval };
