'use strict';

const { t, language } = require('./l10n');

/**
 * Размер в двоичных единицах, как ByteCountFormatter в мак-версии:
 * «12,4 ГБ», «512 КБ». Ноль — «0 КБ», а не «Zero KB».
 */
function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  const ru = language() === 'ru';
  const units = ru ? ['КБ', 'МБ', 'ГБ', 'ТБ'] : ['KB', 'MB', 'GB', 'TB'];
  const decimals = [0, 1, 2, 2];

  let amount = bytes / 1024;
  let index = 0;
  while (amount >= 1000 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  const digits = decimals[index];
  let text = amount.toFixed(digits);
  // Хвостовые нули не нужны: «1 ГБ», а не «1,00 ГБ».
  if (digits > 0) text = text.replace(/\.?0+$/, '');
  if (ru) text = text.replace('.', ',');
  return `${text} ${units[index]}`;
}

/**
 * «только что» вместо «через 0 секунд»: форматтер относительных дат на
 * почти совпадающих датах уезжает в будущее.
 */
function formatUpdated(date) {
  if (!date) return t('ещё ни разу', 'never yet');
  const then = new Date(date).getTime();
  const seconds = (Date.now() - then) / 1000;
  if (seconds < 60) return t('только что', 'just now');

  const formatter = new Intl.RelativeTimeFormat(language() === 'ru' ? 'ru' : 'en', { numeric: 'always' });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return formatter.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return formatter.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  if (days < 30) return formatter.format(-days, 'day');
  const months = Math.round(days / 30);
  if (months < 12) return formatter.format(-months, 'month');
  return formatter.format(-Math.round(days / 365), 'year');
}

/** «12 октября 2026» */
function formatDate(date) {
  const value = new Date(date);
  return new Intl.DateTimeFormat(language() === 'ru' ? 'ru-RU' : 'en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  }).format(value).replace(/\s*г\.$/, '');
}

module.exports = { formatBytes, formatUpdated, formatDate };
