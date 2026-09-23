// Палитры — один в один из Theme.swift мак-версии. Экраны не знают
// конкретных цветов — только роли, поэтому смена темы не требует правок.

export const hex = (value, alpha = 1) => ({
  r: (value >> 16) & 0xff,
  g: (value >> 8) & 0xff,
  b: value & 0xff,
  a: alpha
});

/** CSS-строка цвета с дополнительным множителем прозрачности (Color.opacity). */
export const css = (c, k = 1) => `rgba(${c.r}, ${c.g}, ${c.b}, ${+(c.a * k).toFixed(4)})`;

export const mix = (a, b, amount) => {
  const k = Math.max(0, Math.min(1, amount));
  return {
    r: a.r * (1 - k) + b.r * k,
    g: a.g * (1 - k) + b.g * k,
    b: a.b * (1 - k) + b.b * k,
    a: a.a * (1 - k) + b.a * k
  };
};

const base = {
  good: hex(0x8FD9BE), warn: hex(0xF3C696), bad: hex(0xF3A3AE),
  card: hex(0xFFFFFF, 0.70), cardBorder: hex(0xFFFFFF, 0.50)
};
const darkStates = { good: hex(0x7FD9B8), warn: hex(0xF0C283), bad: hex(0xF08FA0) };

export const PALETTES = [
  {
    ...base, id: 'sky', nameRU: 'Небо', nameEN: 'Sky',
    background: hex(0xF2F7FD),
    accentStart: hex(0x9AC7EC), accentEnd: hex(0xB7CBF2), idleRing: hex(0x414352, 0.20),
    textPrimary: hex(0x43485A), textSecondary: hex(0x8F93A6),
    blob1: hex(0xD7E8FA), blob2: hex(0xDEE3FB), blob3: hex(0xDBF3E6), isDark: false
  },
  {
    ...base, id: 'mint', nameRU: 'Мята', nameEN: 'Mint',
    background: hex(0xEFFAF4),
    accentStart: hex(0x8FD8BE), accentEnd: hex(0xAEE7CE), idleRing: hex(0x2F4740, 0.20),
    textPrimary: hex(0x3A4A44), textSecondary: hex(0x8B9C94),
    blob1: hex(0xD6F1E2), blob2: hex(0xCFEBE0), blob3: hex(0xD9EEF8), isDark: false
  },
  {
    ...base, id: 'lavender', nameRU: 'Лаванда', nameEN: 'Lavender',
    background: hex(0xF5F1FC),
    accentStart: hex(0xBFA8EE), accentEnd: hex(0xD1C2F3), idleRing: hex(0x413C52, 0.20),
    textPrimary: hex(0x48435A), textSecondary: hex(0x938EA6),
    blob1: hex(0xE6DEFB), blob2: hex(0xEEE1FA), blob3: hex(0xDDE7FB), isDark: false
  },
  {
    ...base, id: 'peach', nameRU: 'Персик', nameEN: 'Peach',
    background: hex(0xFDF5EC),
    accentStart: hex(0xF0B583), accentEnd: hex(0xF6CDA3), idleRing: hex(0x52453C, 0.20),
    textPrimary: hex(0x564A3E), textSecondary: hex(0xA69A8C),
    blob1: hex(0xFAE2C8), blob2: hex(0xF8D9D2), blob3: hex(0xF7EEC4), isDark: false
  },
  {
    ...base, id: 'rose', nameRU: 'Роза', nameEN: 'Rose',
    background: hex(0xFDF0F5),
    accentStart: hex(0xEEA6C1), accentEnd: hex(0xF3BFD4), idleRing: hex(0x52414A, 0.20),
    textPrimary: hex(0x564650), textSecondary: hex(0xA6919C),
    blob1: hex(0xF9DCE9), blob2: hex(0xF6D9DE), blob3: hex(0xF7E9C4), isDark: false
  },
  {
    ...darkStates, id: 'night', nameRU: 'Ночь', nameEN: 'Night',
    background: hex(0x1B2030), card: hex(0x262C40), cardBorder: hex(0xFFFFFF, 0.20),
    accentStart: hex(0x8FB6EE), accentEnd: hex(0xB7A6EE), idleRing: hex(0xFFFFFF, 0.20),
    textPrimary: hex(0xEDEFF6), textSecondary: hex(0x9BA1B8),
    blob1: hex(0x2E3A57), blob2: hex(0x362F57), blob3: hex(0x20404A), isDark: true
  },
  {
    ...darkStates, id: 'amoled', nameRU: 'AMOLED', nameEN: 'AMOLED',
    background: hex(0x000000), card: hex(0x121214), cardBorder: hex(0xFFFFFF, 0.15),
    accentStart: hex(0x9AC2F2), accentEnd: hex(0xC2AEF7), idleRing: hex(0xFFFFFF, 0.20),
    textPrimary: hex(0xF5F6FA), textSecondary: hex(0x8C8F9C),
    blob1: hex(0x121722), blob2: hex(0x17121F), blob3: hex(0x0F1A18), isDark: true
  }
];

export const palette = (id) => PALETTES.find((p) => p.id === id) || PALETTES[0];

// ---------------------------------------------------------------------------
// Размеры — общий масштаб интерфейса, как UI.s / UI.t на маке.
// ---------------------------------------------------------------------------

export const SCALE = 0.9;
/** Кегли масштабируются мягче раскладки. */
export const TEXT_SCALE = 1.09;

export const s = (v) => v * SCALE;
export const ts = (v) => v * SCALE * TEXT_SCALE;

export const Metrics = {
  cut: s(18),
  gutter: s(13),
  cardPadding: s(12),
  rowGap: s(6)
};

/** Переменные CSS для текущей палитры — разметка берёт цвета только отсюда. */
export function cssVariables(p) {
  return {
    '--bg': css(p.background),
    '--card': css(p.card),
    '--card-border': css(p.cardBorder),
    '--accent': css(p.accentStart),
    '--accent-end': css(p.accentEnd),
    '--accent-gradient': `linear-gradient(135deg, ${css(p.accentStart)}, ${css(p.accentEnd)})`,
    '--idle': css(p.idleRing),
    '--text': css(p.textPrimary),
    '--text2': css(p.textSecondary),
    '--good': css(p.good),
    '--warn': css(p.warn),
    '--bad': css(p.bad),
    'color-scheme': p.isDark ? 'dark' : 'light'
  };
}
