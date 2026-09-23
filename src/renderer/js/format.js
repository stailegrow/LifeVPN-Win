import { language } from './i18n.js';

/** Двоичные единицы, как ByteCountFormatter мак-версии: «12,4 ГБ». */
export function formatBytes(value) {
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
  let text = amount.toFixed(decimals[index]);
  if (decimals[index] > 0) text = text.replace(/\.?0+$/, '');
  if (ru) text = text.replace('.', ',');
  return `${text} ${units[index]}`;
}
