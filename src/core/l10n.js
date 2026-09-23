'use strict';

/**
 * Переводы живут рядом с местом, где строка нужна: `t('Закрыть', 'Close')`.
 *
 * Отдельная таблица ключей была бы аккуратнее на бумаге, но на практике
 * расходится с интерфейсом: ключ теряет смысл, перевод отстаёт. Пара
 * «оригинал — перевод» на месте не даёт строке остаться без перевода.
 */
let current = 'ru';

function t(ru, en) {
  return current === 'ru' ? ru : en;
}

function setLanguage(lang) {
  current = lang === 'en' ? 'en' : 'ru';
}

function language() {
  return current;
}

/** Язык системы: первый запуск начинается с него. */
function systemLanguage(locale) {
  return String(locale || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

const LANGS = [
  { id: 'ru', title: 'Русский', code: 'RU' },
  { id: 'en', title: 'English', code: 'EN' }
];

module.exports = { t, setLanguage, language, systemLanguage, LANGS };
