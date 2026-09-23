// Живой фон, кнопка подключения, знак, строки серверов и прочие
// элементы экранов.

import { html, useRef, useEffect, useState, useLayoutEffect } from '../vendor/preact-htm.js';
import { Icon } from './icons.js';
import { useApp, font, px, Card, OutlineButton, Spinner, useTicker, useNow } from './ui.js';
import { s, css, Metrics } from './theme.js';
import { drawBackground, drawConnect, drawMark, drawSparkline, AMPLITUDES, lerpAmps } from './draw.js';
import { t } from './i18n.js';
import { formatBytes } from './format.js';

// ---------------------------------------------------------------------------
// Живой фон
// ---------------------------------------------------------------------------

export function HUDBackground({ animated }) {
  const { palette: p } = useApp();
  const ref = useRef(null);
  const paletteRef = useRef(p);
  paletteRef.current = p;

  useLayoutEffect(() => {
    if (ref.current) drawBackground(ref.current, p, 0, !animated);
  }, [p, animated]);

  useTicker(animated, (time) => {
    if (ref.current) drawBackground(ref.current, paletteRef.current, time, false);
  });

  return html`<canvas ref=${ref} class="bg-canvas" />`;
}

// ---------------------------------------------------------------------------
// Фирменный знак и вордмарк
// ---------------------------------------------------------------------------

export function AppMark({ size, colors, wobble = 0.8, phase = 0.6, style }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (ref.current) drawMark(ref.current, colors, wobble, phase);
  });
  return html`<canvas ref=${ref} style=${{ width: px(size), height: px(size), display: 'block', ...style }} />`;
}

export function Wordmark() {
  const { palette: p } = useApp();
  return html`
    <div class="row wordmark" style=${{ gap: px(s(9)) }}>
      <${AppMark} size=${s(21)} colors=${[p.accentStart, p.accentEnd]} />
      <span style=${font('stencil', 18, { color: css(p.textPrimary), whiteSpace: 'nowrap' })}>Life VPN</span>
    </div>`;
}

// ---------------------------------------------------------------------------
// Главный переключатель
// ---------------------------------------------------------------------------

const TRANSITION = 0.38;

function uptime(startISO, now) {
  const total = Math.max(0, Math.floor((now - new Date(startISO).getTime()) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const two = (v) => String(v).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}

function StatPill({ label, children }) {
  const { palette: p } = useApp();
  return html`
    <div class="col" style=${{ alignItems: 'center', gap: '1px', padding: `${px(s(9))} ${px(s(15))}`, background: css(p.card), borderRadius: px(s(16)) }}>
      ${children}
      <span style=${font('label', 9, { color: css(p.textSecondary) })}>${label}</span>
    </div>`;
}

function Uptime({ since }) {
  const { palette: p } = useApp();
  const now = useNow(1000);
  return html`<span class="tabular" style=${font('code', 12.5, { color: css(p.textPrimary) })}>${uptime(since, now)}</span>`;
}

/**
 * Органическое пятно с мягким ореолом, а под ним — состояние и имя узла.
 * Часы анимации идут от абсолютного времени и никогда не перезапускаются
 * от смены состояния; от состояния зависит только амплитуда, и она
 * переходит к новому значению плавно, за 0,38 секунды.
 */
export function ConnectSlab({ state, serverName, connectedSince, externalIP, enabled, onToggle }) {
  const { palette: p } = useApp();
  const kind = state.kind;
  const ref = useRef(null);
  const anim = useRef({ previous: AMPLITUDES[kind], target: AMPLITUDES[kind], changedAt: 0, connectedAt: null, kind });
  const paletteRef = useRef(p);
  paletteRef.current = p;

  if (anim.current.kind !== kind) {
    const now = performance.now() / 1000;
    anim.current.previous = interpolated(anim.current, now);
    anim.current.target = AMPLITUDES[kind];
    anim.current.changedAt = now;
    anim.current.connectedAt = kind === 'connected' ? now : null;
    anim.current.kind = kind;
  }

  useTicker(true, () => {
    if (!ref.current) return;
    const now = performance.now() / 1000;
    const a = anim.current;
    const clock = Date.now() / 1000 - 978307200;
    drawConnect(ref.current, paletteRef.current, a.kind, interpolated(a, now), clock,
      a.connectedAt != null ? now - a.connectedAt : null, s);
  });

  const isFailed = kind === 'failed';
  const headline = {
    connected: t('Подключено', 'Connected'),
    connecting: t('Подключение', 'Connecting'),
    failed: t('Ошибка', 'Error'),
    disconnected: t('Не подключено', 'Not connected')
  }[kind];
  const caption = isFailed ? state.message
    : kind === 'connecting' ? t('устанавливаем защищённый канал', 'establishing a secure channel')
      : (serverName || t('выберите узел', 'pick a node'));

  const size = s(250);
  return html`
    <div class="col" style=${{ alignItems: 'center', padding: `${px(s(14))} 0`, opacity: enabled ? 1 : 0.55, width: '100%', marginTop: '4px' }}
         onClick=${() => { if (enabled) onToggle(); }}>
      <canvas ref=${ref} style=${{ width: px(size), height: px(size), display: 'block' }} />
      <div style=${{ height: px(s(14)) }} />
      <div style=${font('hero', 18, { color: css(isFailed ? p.bad : p.textPrimary) })}>${headline}</div>
      <div class="truncate" style=${font('body', 12.5, { color: css(p.textSecondary), maxWidth: '100%', padding: '0 8px', textAlign: 'center' })}>${middleTruncate(caption, 46)}</div>
      ${kind === 'connected' && (connectedSince || externalIP) && html`
        <div style=${{ height: px(s(13)) }} />
        <div class="row" style=${{ gap: px(s(10)) }}>
          ${connectedSince && html`<${StatPill} label=${t('время', 'time')}><${Uptime} since=${connectedSince} /><//>`}
          ${externalIP && html`<${StatPill} label="IP"><span style=${font('code', 12.5, { color: css(p.textPrimary) })}>${externalIP}</span><//>`}
        </div>`}
    </div>`;
}

function interpolated(a, now) {
  const elapsed = now - a.changedAt;
  if (elapsed >= TRANSITION) return a.target;
  const x = Math.max(0, elapsed / TRANSITION);
  // Плавный вход-выход, чтобы переход не начинался рывком.
  return lerpAmps(a.previous, a.target, x * x * (3 - 2 * x));
}

/** Усечение посередине — как truncationMode(.middle). */
function middleTruncate(text, max) {
  const value = String(text || '').split('\n')[0];
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

// ---------------------------------------------------------------------------
// Экран запуска
// ---------------------------------------------------------------------------

export const SPLASH_DURATION = 1700;

export function LaunchSplash({ gone }) {
  const { palette: p } = useApp();
  const [appeared, setAppeared] = useState(false);
  const bgRef = useRef(null);
  const markRef = useRef(null);
  const haloRef = useRef(null);
  const paletteRef = useRef(p);
  paletteRef.current = p;

  useEffect(() => {
    const id = requestAnimationFrame(() => setAppeared(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useTicker(!gone, (time) => {
    const pal = paletteRef.current;
    if (bgRef.current) drawBackground(bgRef.current, pal, time, false);
    const breathe = ((time % 3.2) / 3.2) * 2 * Math.PI;
    if (markRef.current) {
      drawMark(markRef.current, [pal.accentStart, pal.accentEnd], 0.9, breathe);
      markRef.current.style.transform = `rotate(${3 * Math.sin(breathe)}deg)`;
    }
    if (haloRef.current) haloRef.current.style.transform = `scale(${1 + 0.06 * Math.sin(breathe)})`;
  });

  return html`
    <div class=${`splash ${gone ? 'gone' : ''}`}>
      <canvas ref=${bgRef} class="bg-canvas" />
      <div class=${`splash-inner ${appeared ? 'appeared' : ''}`}>
        <div style=${{ position: 'relative', width: px(s(220)), height: px(s(220)), display: 'flex', alignItems: 'center', justifyContent: 'center', margin: `-${px(s(44))} 0` }}>
          <div ref=${haloRef} style=${{ position: 'absolute', inset: 0, borderRadius: '50%', background: `radial-gradient(circle, ${css(p.accentStart, 0.55)} 0%, ${css(p.accentStart, 0)} 70.7%)` }} />
          <canvas ref=${markRef} style=${{ position: 'relative', width: px(s(132)), height: px(s(132)) }} />
        </div>
        <span style=${font('stencil', 22, { color: css(p.textPrimary), opacity: appeared ? 1 : 0, transition: 'opacity 0.5s' })}>Life VPN</span>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Пинг
// ---------------------------------------------------------------------------

const quality = (ms) => (ms < 120 ? 'good' : ms < 250 ? 'fair' : 'poor');
export const pingColor = (p, ms) => (ms == null ? p.textSecondary
  : { good: p.good, fair: p.warn, poor: p.bad }[quality(ms)]);

function Bars({ active, color }) {
  const { palette: p } = useApp();
  return html`
    <span class="row" style="align-items:flex-end; gap:1.5px">
      ${[0, 1, 2].map((i) => html`<span style=${{ width: '2px', height: px(3 + i * 2), background: css(i < active ? color : p.cardBorder) }} />`)}
    </span>`;
}

/** `measured` — был ли замер; `latency` — null, если сервер не ответил. */
export function PingBadge({ measured, latency }) {
  const { palette: p } = useApp();
  if (!measured) return null;
  if (latency == null) {
    return html`
      <span class="row" style=${{ gap: '4px', color: css(p.textSecondary) }}>
        <${Bars} active=${0} color=${p.bad} />
        <span style=${font('code', 9)}>${t('Н/Д', 'N/A')}</span>
      </span>`;
  }
  const color = pingColor(p, latency);
  const active = { good: 3, fair: 2, poor: 1 }[quality(latency)];
  return html`
    <span class="row" style="gap:4px; align-items:center">
      <${Bars} active=${active} color=${color} />
      <span class="tabular" style=${font('code', 10, { color: css(color) })}>${latency}</span>
      <span style=${font('code', 8, { color: css(p.textSecondary) })}>ms</span>
    </span>`;
}

// ---------------------------------------------------------------------------
// Строка сервера
// ---------------------------------------------------------------------------

const isLetterOrNumber = (ch) => /[\p{L}\p{N}]/u.test(ch);

/** Флаг из имени уезжает в отдельный значок — в заголовке он лишний. */
export function titleOf(name) {
  const chars = Array.from(name);
  let i = 0;
  while (i < chars.length && !isLetterOrNumber(chars[i])) i++;
  const rest = chars.slice(i).join('').trim();
  return rest || name;
}

export function flagOf(name) {
  let flag = '';
  for (const ch of Array.from(name)) {
    if (isLetterOrNumber(ch)) break;
    if (/\s/.test(ch)) {
      if (!flag) continue;
      break;
    }
    flag += ch;
  }
  return flag || null;
}

function FlagBadge({ name, isActive }) {
  const { palette: p } = useApp();
  const flag = flagOf(name);
  return html`
    <span class="flag-badge" style=${{ background: isActive ? css(p.accentStart, 0.22) : css(p.background, 0.6) }}>
      ${flag
        ? html`<span style=${{ fontSize: px(s(13) * 1.05) }}>${flag}</span>`
        : html`<${Icon} name="globe" size=${s(10) * 1.2} style=${{ color: css(p.textSecondary) }} />`}
    </span>`;
}

function Chip({ text, filled }) {
  const { palette: p } = useApp();
  return html`
    <span class="chip" style=${font('code', 7.5, {
      color: filled ? css(p.accentStart) : css(p.textSecondary, 0.9),
      background: filled ? css(p.accentStart, 0.13) : css(p.cardBorder, 0.4)
    })}>${text}</span>`;
}

export function ServerRow({ server, index, measured, latency, isActive, isSelected, onSelect, onContext }) {
  const { palette: p } = useApp();
  const [hover, setHover] = useState(false);
  const background = isSelected ? css(p.accentStart, 0.09) : hover ? css(p.background, 0.9) : css(p.background, 0.45);
  return html`
    <div class="server-row"
         style=${{ background, boxShadow: `inset 0 0 0 1px ${css(p.accentStart, isSelected ? 0.35 : 0)}` }}
         onMouseEnter=${() => setHover(true)} onMouseLeave=${() => setHover(false)}
         onClick=${onSelect}
         onContextMenu=${(e) => { e.preventDefault(); if (onContext) onContext(); }}>
      <span style=${font('code', 9, { width: px(s(15)), flexShrink: 0, color: isSelected ? css(p.accentStart, 0.9) : css(p.textSecondary, 0.5) })}>
        ${String(index + 1).padStart(2, '0')}
      </span>
      <${FlagBadge} name=${server.displayName} isActive=${isActive} />
      <span class="col" style="gap:2px; min-width:0; flex: 0 1 auto">
        <span class="truncate" style=${font('heading', 11.5, { letterSpacing: '0.2px', color: css(p.textPrimary) })}>${titleOf(server.displayName)}</span>
        <span class="row" style="gap:3px">
          <${Chip} text=${server.kind} filled=${true} />
          <${Chip} text=${server.transport} filled=${false} />
          ${server.security !== 'none' && html`<${Chip} text=${server.security} filled=${false} />`}
        </span>
      </span>
      <span class="spacer" style="min-width:4px" />
      <span class="col" style="align-items:flex-end; gap:2px; flex-shrink:0">
        <${PingBadge} measured=${measured} latency=${latency} />
        ${isActive && html`<span style=${font('label', 9, { color: css(p.accentStart) })}>${t('Активен', 'Active')}</span>`}
      </span>
    </div>`;
}

// ---------------------------------------------------------------------------
// Строка технических данных
// ---------------------------------------------------------------------------

export function TelemetryLine({ items }) {
  return html`
    <div class="footer" style=${font('code', 8.5)}>
      ${items.map((item, i) => html`${i > 0 && html`<span class="dot">·</span>`}<span>${item}</span>`)}
    </div>`;
}

// ---------------------------------------------------------------------------
// Трафик подписки
// ---------------------------------------------------------------------------

/**
 * Когда лимита нет, шкале нечего показывать: залитая на всю ширину полоса
 * выглядит как исчерпанный лимит. Поэтому при безлимите полосы нет вовсе.
 */
export function TrafficMeter({ used, total }) {
  const { palette: p } = useApp();
  const fraction = used != null && total > 0 ? Math.min(1, Math.max(0, used / total)) : null;
  const text = font('code', 9, { color: css(p.textSecondary) });
  if (fraction != null) {
    return html`
      <div class="col" style="gap:5px">
        <div style=${{ position: 'relative', height: '4px', background: css(p.cardBorder) }}>
          <div style=${{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `max(2px, ${fraction * 100}%)`, background: `linear-gradient(135deg, ${css(p.accentStart)}, ${css(p.accentEnd)})` }} />
          ${[1, 2, 3].map((q) => html`<div style=${{ position: 'absolute', top: 0, bottom: 0, left: `${q * 25}%`, width: '1px', background: css(p.background, 0.9) }} />`)}
        </div>
        <div class="row" style=${{ ...text, gap: '4px' }}>
          <span style=${{ color: css(p.textPrimary) }}>${formatBytes(used || 0)}</span>
          <span>${t(`из ${formatBytes(total || 0)}`, `of ${formatBytes(total || 0)}`)}</span>
          <span class="spacer" />
          <span style=${{ color: fraction > 0.9 ? css(p.bad) : css(p.textSecondary) }}>${Math.round(fraction * 100)}%</span>
        </div>
      </div>`;
  }
  return html`
    <div class="row" style=${{ ...text, gap: '6px' }}>
      <span style=${{ width: '5px', height: '5px', borderRadius: '50%', background: `linear-gradient(135deg, ${css(p.accentStart)}, ${css(p.accentEnd)})` }} />
      <span style=${{ color: css(p.textPrimary) }}>${formatBytes(used || 0)}</span>
      <span>${t('израсходовано', 'used')}</span>
      <span class="spacer" />
      <span>${t('безлимит', 'unlimited')}</span>
      <span style=${{ color: css(p.accentStart) }}>∞</span>
    </div>`;
}

// ---------------------------------------------------------------------------
// Скорость
// ---------------------------------------------------------------------------

export function SpeedCard() {
  const { palette: p, state, act } = useApp();
  const c = state.connection;
  const isConnected = c.state.kind === 'connected';
  let detail;
  if (c.speedError) {
    detail = c.speedError;
  } else if (!c.speed) {
    detail = isConnected ? t('замер пойдёт через туннель', 'the test runs through the tunnel')
      : t('замер пойдёт напрямую, мимо VPN', 'the test runs directly, around the VPN');
  } else {
    const volume = formatBytes(c.speed.bytes);
    const seconds = c.speed.seconds.toFixed(1);
    const route = c.speed.throughProxy ? t('через туннель', 'through the tunnel') : t('напрямую, мимо VPN', 'directly, around the VPN');
    detail = t(`${route} · ${c.speed.source} · ${volume} за ${seconds} с`, `${route} · ${c.speed.source} · ${volume} in ${seconds} s`);
  }
  return html`
    <${Card} title=${t('Скорость', 'Speed')}>
      <div class="row" style="gap:10px">
        <div class="col" style="gap:1px; min-width:0">
          <div class="row" style="align-items:baseline; gap:4px">
            <span style=${font('hero', 21, { color: css(c.speed ? p.textPrimary : p.textSecondary) })}>${c.speed ? c.speed.mbps.toFixed(1) : '—'}</span>
            <span style=${font('code', 9, { color: css(p.textSecondary) })}>${t('Мбит/с', 'Mbit/s')}</span>
          </div>
          <span style=${font('code', 8.5, { color: css(c.speedError ? p.bad : p.textSecondary), display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' })}>${detail}</span>
        </div>
        <span class="spacer" style="min-width:6px" />
        ${c.isMeasuringSpeed
          ? html`<${Spinner} small />`
          : html`<${OutlineButton} onClick=${() => act('measureSpeed')}>${t('Проверить', 'Test')}<//>`}
      </div>
    <//>`;
}

// ---------------------------------------------------------------------------
// Задержка — мини-графики по каждому узлу, у каждой строки своя шкала.
// ---------------------------------------------------------------------------

function bounds(values) {
  if (!values.length) return [0, 1];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const middle = Math.floor((low + high) / 2);
  const minimumSpan = Math.max(10, Math.floor(middle / 4));
  const span = Math.max(high - low, minimumSpan);
  const padding = Math.max(1, Math.floor(span / 8));
  const half = Math.floor(span / 2);
  return [Math.max(0, middle - half - padding), middle + half + padding];
}

function Sparkline({ values, low, high, line, endpoint }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (ref.current) drawSparkline(ref.current, values, low, high, line, endpoint);
  });
  return html`<canvas ref=${ref} style=${{ flex: '1 1 auto', minWidth: 0, height: px(s(22)), display: 'block' }} />`;
}

export function LatencyCard({ servers }) {
  const { palette: p, state } = useApp();
  const history = state.store.pingHistory || {};
  const series = servers.map((server) => ({ server, values: history[server.id] || [] }));
  const any = series.some((x) => x.values.length);
  const length = state.store.historyLength;

  return html`
    <${Card} title=${t('Задержка', 'Latency')}>
      ${any ? html`
        <div class="row" style=${font('code', 8.5, { color: css(p.textSecondary, 0.8) })}>
          <span>${t(`опрос каждые 10 с · последние ${length}`, `polled every 10 s · last ${length}`)}</span>
          <span class="spacer" />
          <span>${t('своя шкала у строки', 'own scale per row')}</span>
        </div>
        <div class="col" style=${{ gap: px(s(7)) }}>
          ${series.map(({ server, values }) => {
            const [low, high] = bounds(values);
            const last = values.length ? values[values.length - 1] : null;
            const delta = values.length >= 2 ? values[values.length - 1] - values[values.length - 2] : 0;
            return html`
              <div class="row" style=${{ gap: px(s(9)) }} key=${server.id}>
                <span class="truncate" style=${font('label', 10.5, { color: css(p.textSecondary), width: px(s(76)), flexShrink: 0 })}>${titleOf(server.displayName)}</span>
                <${Sparkline} values=${values} low=${low} high=${high} line=${p.accentStart} endpoint=${pingColor(p, last)} />
                <span class="row" style=${{ gap: '2px', width: px(s(42)), justifyContent: 'flex-end', flexShrink: 0 }}>
                  ${Math.abs(delta) >= 5 && html`<${Icon} name=${delta < 0 ? 'arrowtriangle.down.fill' : 'arrowtriangle.up.fill'} size=${s(6) * 1.1}
                      style=${{ color: css(delta < 0 ? p.good : p.warn) }} />`}
                  <span class="tabular" style=${font('code', 10.5, { color: css(pingColor(p, last)) })}>${last != null ? last : '—'}</span>
                </span>
              </div>`;
          })}
        </div>` : html`
        <span style=${font('body', 11, { color: css(p.textSecondary) })}>${t('Замеров ещё не было — нажми «Пинг».', 'No measurements yet — press “Ping”.')}</span>`}
    <//>`;
}

export const gutter = Metrics.gutter;
