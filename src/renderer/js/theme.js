// Палитры — один в один из Theme.swift мак-версии 3.1.1. Экраны не знают
// конкретных цветов — только роли, поэтому смена темы не требует правок.

export const hex = (value, alpha = 1) => ({
  r: (value >> 16) & 0xff,
  g: (value >> 8) & 0xff,
  b: value & 0xff,
  a: alpha
});

/** CSS-строка цвета с дополнительным множителем прозрачности (Color.opacity). */
export const css = (c, k = 1) => `rgba(${c.r}, ${c.g}, ${c.b}, ${+Math.min(1, c.a * k).toFixed(4)})`;

export const mix = (a, b, amount) => {
  const k = Math.max(0, Math.min(1, amount));
  return {
    r: a.r * (1 - k) + b.r * k,
    g: a.g * (1 - k) + b.g * k,
    b: a.b * (1 - k) + b.b * k,
    a: a.a * (1 - k) + b.a * k
  };
};

const WHITE = hex(0xFFFFFF);
const BLACK = hex(0x000000);

const light = {
  card: hex(0xFFFFFF, 0.70), cardBorder: hex(0xFFFFFF, 0.50),
  good: hex(0x8FD9BE), warn: hex(0xF3C696), bad: hex(0xF3A3AE),
  isDark: false
};
const darkVivid = {
  idleRing: hex(0xFFFFFF, 0.20),
  good: hex(0x4ADE9A), warn: hex(0xF5B451), bad: hex(0xFF6B6B),
  isDark: true
};

/**
 * Сначала — основная «Life night» и остальные тёмные; прежние пастельные
 * остаются для тех, кто к ним привык.
 */
export const PALETTES = [
  // «Life night» — основная тема: настоящий чёрный фон с пастельным
  // акцентом. Идентификатор остался прежним, «amoled», чтобы сохранённые
  // настройки и чёрная кнопка в покое продолжали работать.
  {
    id: 'amoled', nameRU: 'Life night', nameEN: 'Life night',
    background: hex(0x000000), card: hex(0x121214), cardBorder: hex(0xFFFFFF, 0.15),
    accentStart: hex(0x9AC2F2), accentEnd: hex(0xC2AEF7), idleRing: hex(0xFFFFFF, 0.20),
    textPrimary: hex(0xF5F6FA), textSecondary: hex(0x8C8F9C),
    good: hex(0x7FD9B8), warn: hex(0xF0C283), bad: hex(0xF08FA0),
    blob1: hex(0x121722), blob2: hex(0x17121F), blob3: hex(0x0F1A18), isDark: true
  },
  // «Life» — в цветах панели управления серверами: тёплый почти чёрный
  // фон, коричневатые карточки и оранжевый акцент.
  {
    id: 'panel', nameRU: 'Life', nameEN: 'Life',
    background: hex(0x0C0A09), card: hex(0x1C1714), cardBorder: hex(0xFFFFFF, 0.08),
    accentStart: hex(0xF97316), accentEnd: hex(0xFF9A4D), idleRing: hex(0xFFFFFF, 0.20),
    textPrimary: hex(0xF5F1ED), textSecondary: hex(0x9C9087),
    good: hex(0x3CCB7F), warn: hex(0xF5B451), bad: hex(0xFF6B6B),
    blob1: hex(0x4A2310), blob2: hex(0x2E1608), blob3: hex(0x3A1C0C), isDark: true
  },
  {
    ...darkVivid, id: 'amethyst', nameRU: 'Аметист', nameEN: 'Amethyst',
    background: hex(0x09080F), card: hex(0x1A1824), cardBorder: hex(0xFFFFFF, 0.10),
    accentStart: hex(0x7C5CFF), accentEnd: hex(0xA48BFF),
    textPrimary: hex(0xF4F4F7), textSecondary: hex(0x8E8E9C),
    blob1: hex(0x2A1A5E), blob2: hex(0x5A1230), blob3: hex(0x10283F)
  },
  {
    ...darkVivid, id: 'lagoon', nameRU: 'Лагуна', nameEN: 'Lagoon',
    background: hex(0x060B0D), card: hex(0x141C20), cardBorder: hex(0xFFFFFF, 0.10),
    accentStart: hex(0x14B8A6), accentEnd: hex(0x3DDCC8),
    textPrimary: hex(0xF2F6F7), textSecondary: hex(0x8A979C),
    blob1: hex(0x0E3B3A), blob2: hex(0x1D1554), blob3: hex(0x10283F)
  },
  {
    ...darkVivid, id: 'amber', nameRU: 'Янтарь', nameEN: 'Amber',
    background: hex(0x0B0906), card: hex(0x1E1A14), cardBorder: hex(0xFFFFFF, 0.10),
    accentStart: hex(0xF59E0B), accentEnd: hex(0xFFC14D),
    textPrimary: hex(0xF7F5F2), textSecondary: hex(0x9C9488),
    blob1: hex(0x4A2C08), blob2: hex(0x5A1230), blob3: hex(0x10283F)
  },
  {
    ...light, id: 'sky', nameRU: 'Небо', nameEN: 'Sky',
    background: hex(0xF2F7FD),
    accentStart: hex(0x9AC7EC), accentEnd: hex(0xB7CBF2), idleRing: hex(0x414352, 0.20),
    textPrimary: hex(0x43485A), textSecondary: hex(0x8F93A6),
    blob1: hex(0xD7E8FA), blob2: hex(0xDEE3FB), blob3: hex(0xDBF3E6)
  },
  {
    ...light, id: 'mint', nameRU: 'Мята', nameEN: 'Mint',
    background: hex(0xEFFAF4),
    accentStart: hex(0x8FD8BE), accentEnd: hex(0xAEE7CE), idleRing: hex(0x2F4740, 0.20),
    textPrimary: hex(0x3A4A44), textSecondary: hex(0x8B9C94),
    blob1: hex(0xD6F1E2), blob2: hex(0xCFEBE0), blob3: hex(0xD9EEF8)
  },
  {
    ...light, id: 'lavender', nameRU: 'Лаванда', nameEN: 'Lavender',
    background: hex(0xF5F1FC),
    accentStart: hex(0xBFA8EE), accentEnd: hex(0xD1C2F3), idleRing: hex(0x413C52, 0.20),
    textPrimary: hex(0x48435A), textSecondary: hex(0x938EA6),
    blob1: hex(0xE6DEFB), blob2: hex(0xEEE1FA), blob3: hex(0xDDE7FB)
  },
  {
    ...light, id: 'peach', nameRU: 'Персик', nameEN: 'Peach',
    background: hex(0xFDF5EC),
    accentStart: hex(0xF0B583), accentEnd: hex(0xF6CDA3), idleRing: hex(0x52453C, 0.20),
    textPrimary: hex(0x564A3E), textSecondary: hex(0xA69A8C),
    blob1: hex(0xFAE2C8), blob2: hex(0xF8D9D2), blob3: hex(0xF7EEC4)
  },
  {
    ...light, id: 'rose', nameRU: 'Роза', nameEN: 'Rose',
    background: hex(0xFDF0F5),
    accentStart: hex(0xEEA6C1), accentEnd: hex(0xF3BFD4), idleRing: hex(0x52414A, 0.20),
    textPrimary: hex(0x564650), textSecondary: hex(0xA6919C),
    blob1: hex(0xF9DCE9), blob2: hex(0xF6D9DE), blob3: hex(0xF7E9C4)
  }
].map(derive);

/** Производные роли — так же, как вычисляемые свойства Palette на маке. */
function derive(p) {
  const c = p.accentStart;
  const luminance = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  // Пастельным акцентам нужен тёмный текст, насыщенным — белый.
  const onAccent = luminance > 0.55 ? hex(0x000000, 0.85) : WHITE;

  let orbs;
  switch (p.id) {
    case 'panel':
      // Как у панели: только тёплое свечение, без холодных соседей.
      orbs = [p.accentStart, hex(0x9A3412), hex(0x7C2D12)];
      break;
    case 'lagoon':
      orbs = [p.accentStart, hex(0x5B47D6), hex(0x3BB8E6)];
      break;
    case 'amethyst':
    case 'amber':
      orbs = [p.accentStart, hex(0xE5383B), hex(0x3BB8E6)];
      break;
    default:
      orbs = [p.accentStart, p.accentEnd, p.isDark ? hex(0x3BB8E6) : p.blob3];
  }

  return {
    ...p,
    onAccent,
    orbs,
    // Подложка стекла: полупрозрачная, чтобы живой фон просвечивал.
    glass: p.isDark ? { ...p.card, a: p.card.a * 0.55 } : hex(0xFFFFFF, 0.45),
    glassEdge: p.isDark ? hex(0xFFFFFF, 0.09) : hex(0xFFFFFF, 0.75),
    hoverFill: { ...p.textPrimary, a: p.isDark ? 0.07 : 0.06 },
    rowFill: { ...p.textPrimary, a: 0.035 }
  };
}

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
  gutter: s(13),
  cardPadding: s(12),
  rowGap: s(6)
};

export const gradient = (p, angle = 135) => `linear-gradient(${angle}deg, ${css(p.accentStart)}, ${css(p.accentEnd)})`;

/** Переменные CSS для текущей палитры — разметка берёт цвета только отсюда. */
export function cssVariables(p) {
  return {
    '--bg': css(p.background),
    '--card': css(p.card),
    '--card-border': css(p.cardBorder),
    '--accent': css(p.accentStart),
    '--accent-end': css(p.accentEnd),
    '--accent-gradient': gradient(p),
    '--on-accent': css(p.onAccent),
    '--idle': css(p.idleRing),
    '--text': css(p.textPrimary),
    '--text2': css(p.textSecondary),
    '--good': css(p.good),
    '--warn': css(p.warn),
    '--bad': css(p.bad),
    '--glass': css(p.glass),
    '--glass-edge': css(p.glassEdge),
    '--hover': css(p.hoverFill),
    '--hover-strong': css(p.hoverFill, 1.8),
    '--row': css(p.rowFill),
    '--shadow': p.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.14)',
    'color-scheme': p.isDark ? 'dark' : 'light'
  };
}

export { WHITE, BLACK };
