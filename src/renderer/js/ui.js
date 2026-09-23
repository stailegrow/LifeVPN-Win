// Базовые элементы интерфейса: перенос Components.swift и HUDControls.swift.

import { html, useState, useEffect, useRef, createContext, useContext } from '../vendor/preact-htm.js';
import { Icon } from './icons.js';
import { s, ts, css } from './theme.js';

export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

// ---------------------------------------------------------------------------
// Типографика: роли шрифтов, как Typography.swift.
// ---------------------------------------------------------------------------

const ROLE = {
  hero: { family: 'var(--rounded)', weight: 800 },
  heading: { family: 'var(--rounded)', weight: 700 },
  label: { family: 'var(--rounded)', weight: 600 },
  body: { family: 'var(--body)', weight: 400 },
  code: { family: 'var(--mono)', weight: 400 },
  stencil: { family: 'var(--rounded)', weight: 700 }
};

/** Стиль шрифта роли. Кегль проходит через общий масштаб текста. */
export function font(role, size, extra = {}) {
  const r = ROLE[role];
  return { fontFamily: r.family, fontWeight: r.weight, fontSize: `${ts(size)}px`, ...extra };
}

export const px = (v) => `${v}px`;

// ---------------------------------------------------------------------------
// Панель
// ---------------------------------------------------------------------------

export function Card({ title, children, style }) {
  return html`
    <div class="card" style=${style}>
      ${title && html`<div class="card-title" style=${font('label', 10)}>${title}</div>`}
      <div class="card-body">${children}</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Кнопки
// ---------------------------------------------------------------------------

export function AccentButton({ children, onClick, disabled, title }) {
  return html`<button class="btn-accent" style=${font('heading', 11)} onClick=${onClick} disabled=${disabled} title=${title}>${children}</button>`;
}

export function OutlineButton({ children, onClick, disabled, title }) {
  return html`<button class="btn-outline" style=${font('heading', 11)} onClick=${onClick} disabled=${disabled} title=${title}>${children}</button>`;
}

export function DangerButton({ children, onClick }) {
  return html`<button class="btn-danger" style=${font('heading', 11)} onClick=${onClick}>${children}</button>`;
}

export function IconButton({ icon, size = 11, onClick, title, style }) {
  return html`
    <button class="icon-btn" onClick=${onClick} title=${title} style=${style}>
      <${Icon} name=${icon} size=${size * 1.15} />
    </button>`;
}

export function Spinner({ small }) {
  return html`<span class=${small ? 'spinner small' : 'spinner'} />`;
}

// ---------------------------------------------------------------------------
// Переключатель — свой, системный крупнее всего остального в интерфейсе.
// ---------------------------------------------------------------------------

export function Toggle({ label, value, onChange }) {
  const { palette: p } = useApp();
  return html`
    <div class=${`toggle ${value ? 'on' : ''}`} onClick=${() => onChange(!value)} style=${font('body', 11.5, { color: css(p.textSecondary) })}>
      <span>${label}</span>
      <span class="spacer" style="min-width:8px" />
      <span class="toggle-track" style=${{ background: value ? css(p.accentStart, 0.45) : css(p.idleRing, 0.55) }}>
        <span class="toggle-knob" style=${{ background: value ? `linear-gradient(135deg, ${css(p.accentStart)}, ${css(p.accentEnd)})` : 'rgba(255,255,255,0.9)' }} />
      </span>
    </div>`;
}

// ---------------------------------------------------------------------------
// Переключатель разделов
// ---------------------------------------------------------------------------

export function Segmented({ value, options, onChange }) {
  return html`
    <div class="segmented">
      ${options.map((o) => html`
        <button class=${`segment ${o.value === value ? 'active' : ''}`} style=${font('heading', 11)}
                onClick=${() => onChange(o.value)}>${o.title}</button>`)}
    </div>`;
}

// ---------------------------------------------------------------------------
// Поля ввода
// ---------------------------------------------------------------------------

export function TextField({ placeholder, value, onInput, monospaced, autoFocus, onEnter }) {
  const ref = useRef(null);
  useEffect(() => {
    if (autoFocus && ref.current) ref.current.focus();
  }, []);
  return html`
    <input ref=${ref} class="field" type="text" spellcheck=${false}
           style=${monospaced ? font('code', 11.5) : font('body', 12)}
           placeholder=${placeholder} value=${value}
           onInput=${(e) => onInput(e.currentTarget.value)}
           onKeyDown=${(e) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } }} />`;
}

export function TextArea({ value, onInput, height = 130, autoFocus }) {
  const ref = useRef(null);
  useEffect(() => {
    if (autoFocus && ref.current) ref.current.focus();
  }, []);
  return html`
    <textarea ref=${ref} class="field" spellcheck=${false}
              style=${{ ...font('code', 11), height: px(height) }}
              value=${value} onInput=${(e) => onInput(e.currentTarget.value)} />`;
}

// ---------------------------------------------------------------------------
// Каркас окна — общий для всех отдельных окон.
// ---------------------------------------------------------------------------

export function Sheet({ title, subtitle, children, footer, onClose }) {
  const { palette: p } = useApp();
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && onClose) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return html`
    <div class="sheet-backdrop" onMouseDown=${(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div class="sheet">
        <div class="sheet-head">
          <span style=${font('heading', 13, { color: css(p.textPrimary) })}>${title}</span>
        </div>
        <div class="sheet-rule" />
        <div class="sheet-body">
          ${subtitle && html`<div style=${font('body', 11, { color: css(p.textSecondary) })}>${subtitle}</div>`}
          ${children}
        </div>
        <div class="sheet-rule" />
        <div class="sheet-foot">${footer}</div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Своё меню — системное всплывающее не поддаётся оформлению.
// ---------------------------------------------------------------------------

export function MenuPanel({ items, onDismiss }) {
  const { palette: p } = useApp();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return html`
    <div class="overlay-layer" onMouseDown=${(e) => { if (e.target === e.currentTarget) onDismiss(); }}>
      <div class="menu-panel">
        ${items.map((item) => html`
          ${item.separatorAbove && html`<div class="menu-separator" />`}
          <button class="menu-row" onClick=${item.action}>
            <${Icon} name=${item.icon} size=${s(11) * 1.2} />
            <span class="col" style="gap:1px">
              <span style=${font('body', 12, { color: css(p.textPrimary) })}>${item.title}</span>
              ${item.subtitle && html`<span style=${font('code', 9, { color: css(p.textSecondary, 0.8) })}>${item.subtitle}</span>`}
            </span>
          </button>`)}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Всплывающее уведомление
// ---------------------------------------------------------------------------

export function NoticeBanner({ text, isError, leaving }) {
  const { palette: p } = useApp();
  const tint = isError ? p.bad : p.accentStart;
  return html`
    <div class=${`notice ${leaving ? 'leaving' : ''}`}>
      <${Icon} name=${isError ? 'exclamationmark.triangle.fill' : 'checkmark.circle.fill'} size=${s(11) * 1.25}
               style=${{ color: css(tint), marginTop: '1px' }} />
      <span style=${font('body', 11, { color: css(p.textPrimary), lineHeight: 1.3 })}>${text}</span>
    </div>`;
}

// ---------------------------------------------------------------------------
// Диалог подтверждения (confirmationDialog на маке)
// ---------------------------------------------------------------------------

export function Confirm({ title, message, buttons, onCancel }) {
  const { palette: p } = useApp();
  return html`
    <div class="confirm-backdrop" onMouseDown=${(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div class="confirm">
        <div style=${font('heading', 12.5, { color: css(p.textPrimary), textAlign: 'center' })}>${title}</div>
        <div style=${font('body', 11, { color: css(p.textSecondary), textAlign: 'center', marginBottom: '4px' })}>${message}</div>
        ${buttons.map((b) => (b.role === 'destructive'
          ? html`<${DangerButton} onClick=${b.action}>${b.title}<//>`
          : b.role === 'default'
            ? html`<${AccentButton} onClick=${b.action}>${b.title}<//>`
            : html`<${OutlineButton} onClick=${b.action}>${b.title}<//>`))}
      </div>
    </div>`;
}

/** Хук анимационного цикла: вызывает `frame(time)` ~30 раз в секунду. */
export function useTicker(active, frame, fps = 30) {
  const frameRef = useRef(frame);
  frameRef.current = frame;
  useEffect(() => {
    if (!active) return undefined;
    let raf = 0;
    let last = 0;
    const interval = 1000 / fps;
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      if (now - last < interval - 1) return;
      last = now;
      frameRef.current(performance.timeOrigin / 1000 + now / 1000);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, fps]);
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
