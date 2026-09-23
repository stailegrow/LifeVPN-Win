'use strict';

/**
 * Разбор ответа подписки. Панели отдают список по-разному: то простым
 * текстом, то base64 целиком, то url-safe base64 без выравнивания.
 */

function links(text) {
  return String(text)
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('://'));
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
  const fields = {};
  for (const pair of String(value).split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    const key = pair.slice(0, index).trim().toLowerCase();
    const raw = pair.slice(index + 1).trim();
    if (/^-?\d+$/.test(raw)) fields[key] = Number(raw);
  }

  const info = { used: null, total: null, expiresAt: null };
  if (fields.upload != null || fields.download != null) {
    info.used = (fields.upload || 0) + (fields.download || 0);
  }
  if (fields.total != null) info.total = fields.total;
  // expire=0 у панелей означает «бессрочно», а не 1970 год.
  if (fields.expire != null && fields.expire > 0) {
    info.expiresAt = new Date(fields.expire * 1000).toISOString();
  }
  return info;
}

module.exports = { decodeBody, decodeBase64, decodeHeaderValue, parseUserInfo };
