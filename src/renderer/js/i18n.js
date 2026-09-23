// Переводы рядом с местом, где строка нужна: t('Закрыть', 'Close').
let current = 'ru';

export const setLanguage = (lang) => { current = lang === 'en' ? 'en' : 'ru'; };
export const language = () => current;
export const t = (ru, en) => (current === 'ru' ? ru : en);
