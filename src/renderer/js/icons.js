// Значки вместо SF Symbols мак-версии. Контурные — по мотивам Lucide
// (ISC), залитые («.fill») нарисованы отдельно, чтобы вкладки и тревожные
// значки читались так же плотно, как на маке.

import { html } from '../vendor/preact-htm.js';

const stroke = (inner, weight = 2.2) => (size) => html`
  <svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width=${weight} stroke-linecap="round" stroke-linejoin="round"
       dangerouslySetInnerHTML=${{ __html: inner }} />`;

const filled = (inner) => (size) => html`
  <svg width=${size} height=${size} viewBox="0 0 24 24" fill="currentColor"
       dangerouslySetInnerHTML=${{ __html: inner }} />`;

export const ICONS = {
  // Вкладки
  'house.fill': filled('<path d="M3 10.2a2 2 0 0 1 .71-1.53l7-6a2 2 0 0 1 2.58 0l7 6A2 2 0 0 1 21 10.2V19a2 2 0 0 1-2 2h-4.2v-6.3a1 1 0 0 0-1-1h-3.6a1 1 0 0 0-1 1V21H5a2 2 0 0 1-2-2z"/>'),
  'server.rack': filled('<path fill-rule="evenodd" d="M4 2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm2.2 3a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zM4 14h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2zm2.2 3a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z"/>'),
  'gearshape.fill': filled('<path fill-rule="evenodd" d="M9.67 4.14a2.34 2.34 0 0 1 4.66 0 2.34 2.34 0 0 0 3.32 1.91 2.34 2.34 0 0 1 2.33 4.04 2.34 2.34 0 0 0 0 3.83 2.34 2.34 0 0 1-2.33 4.03 2.34 2.34 0 0 0-3.32 1.92 2.34 2.34 0 0 1-4.66 0 2.34 2.34 0 0 0-3.32-1.92 2.34 2.34 0 0 1-2.33-4.03 2.34 2.34 0 0 0 0-3.83 2.34 2.34 0 0 1 2.33-4.04 2.34 2.34 0 0 0 3.32-1.91zM12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z"/>'),

  // Боковая панель (SF Symbols мак-версии 3.x — контурные)
  house: stroke('<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', 2),
  'server.outline': stroke('<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01"/><path d="M6 18h.01"/>', 2),
  'arrow.up.arrow.down': stroke('<path d="m3 8 4-4 4 4"/><path d="M7 4v16"/><path d="m21 16-4 4-4-4"/><path d="M17 20V4"/>', 2),
  'chart.bar': stroke('<rect x="3" y="12" width="4.5" height="8" rx="1.2"/><rect x="9.75" y="8" width="4.5" height="12" rx="1.2"/><rect x="16.5" y="4" width="4.5" height="16" rx="1.2"/>', 2),
  gearshape: stroke('<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>', 2),
  quit: stroke('<path d="M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8"/><path d="M15 16l4-4-4-4"/><path d="M19 12H9"/>', 2),
  'sidebar.left': stroke('<rect width="18" height="16" x="3" y="4" rx="3"/><path d="M9 4v16"/><path d="M5.6 8h1.2"/><path d="M5.6 11h1.2"/>', 2),
  magnifyingglass: stroke('<circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2"/>', 2.4),
  power: stroke('<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>', 2.8),
  'xmark.circle.fill': filled('<path fill-rule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-3.3 5.3L7.3 8.7 10.6 12l-3.3 3.3 1.4 1.4 3.3-3.3 3.3 3.3 1.4-1.4-3.3-3.3 3.3-3.3-1.4-1.4-3.3 3.3z"/>'),
  'square.and.arrow.up': stroke('<path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M8 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-2"/>', 2.2),
  sparkles: filled('<path d="M10 2.5l1.6 4.4a3 3 0 0 0 1.8 1.8l4.4 1.6-4.4 1.6a3 3 0 0 0-1.8 1.8L10 18.1l-1.6-4.4a3 3 0 0 0-1.8-1.8L2.2 10.3l4.4-1.6a3 3 0 0 0 1.8-1.8z"/><path d="M18.5 13.5l.7 1.8a1.5 1.5 0 0 0 .9.9l1.8.7-1.8.7a1.5 1.5 0 0 0-.9.9l-.7 1.8-.7-1.8a1.5 1.5 0 0 0-.9-.9l-1.8-.7 1.8-.7a1.5 1.5 0 0 0 .9-.9z"/>'),
  'arrow.down.circle.fill': filled('<path fill-rule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1 5v7.6l-3.3-3.3-1.4 1.4L12 18.4l5.7-5.7-1.4-1.4-3.3 3.3V7z"/>'),
  checkmark: stroke('<path d="M20 6 9 17l-5-5"/>', 3.4),

  // Шапка
  plus: stroke('<path d="M5 12h14"/><path d="M12 5v14"/>', 2.8),
  hourglass: stroke('<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>', 2.6),
  minimize: stroke('<path d="M6 12h12"/>', 2),
  close: stroke('<path d="M17 7 7 17"/><path d="m7 7 10 10"/>', 2),

  // Меню добавления
  'doc.on.clipboard': stroke('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h4"/>'),
  'qrcode.viewfinder': stroke('<path d="M17 12v4a1 1 0 0 1-1 1h-4"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M17 8V7"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M7 17h.01"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="5" height="5" rx="1"/>'),
  photo: stroke('<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>'),
  link: stroke('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
  'text.alignleft': stroke('<path d="M21 5H3"/><path d="M15 12H3"/><path d="M17 19H3"/>'),

  // Карточки
  speedometer: stroke('<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>', 2.5),
  pencil: stroke('<path d="M21.17 6.81a1 1 0 0 0-3.98-3.98L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>', 2.5),
  'arrow.clockwise': stroke('<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>', 2.6),
  globe: stroke('<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>', 1.8),
  ellipsis: filled('<circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/>'),

  // Состояния
  'exclamationmark.triangle.fill': filled('<path fill-rule="evenodd" d="M10.27 3.2a2 2 0 0 1 3.46 0l8.02 14A2 2 0 0 1 20.02 20H3.98a2 2 0 0 1-1.73-2.8zM11 8.6h2v5.4h-2zm1 7.2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z"/>'),
  'checkmark.circle.fill': filled('<path fill-rule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm4.3 6.3-5.6 5.6-2.6-2.6-1.4 1.4 4 4 7-7z"/>'),
  'arrow.down.circle': stroke('<circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="m8 12 4 4 4-4"/>', 2.4),
  'exclamationmark.circle': stroke('<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>', 2.4),
  'arrow.uturn.backward.circle': stroke('<circle cx="12" cy="12" r="10"/><path d="M10 15 7 12l3-3"/><path d="M7 12h6.5a3 3 0 0 1 0 6H12"/>', 2.2),
  'largecircle.fill.circle': (size) => html`
    <svg width=${size} height=${size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" />
      <circle cx="12" cy="12" r="5.5" fill="currentColor" />
    </svg>`,
  circle: stroke('<circle cx="12" cy="12" r="10"/>', 2),
  'arrowtriangle.down.fill': filled('<path d="M3 6h18L12 20z"/>'),
  'arrowtriangle.up.fill': filled('<path d="M12 4 21 18H3z"/>')
};

export function Icon({ name, size = 12, style, class: className }) {
  const render = ICONS[name];
  if (!render) return null;
  return html`<span class=${`icon ${className || ''}`} style=${style}>${render(size)}</span>`;
}
