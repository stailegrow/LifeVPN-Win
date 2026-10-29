// Живой фон, кнопка подключения, знак, строки узлов и карточки экранов —
// перенос Glass.swift, BlobConnectButton.swift, ConnectOrb.swift,
// Components.swift, LatencyCard.swift и RoutingLogCard.swift.

import { html, useRef, useEffect, useState, useLayoutEffect } from '../vendor/preact-htm.js';
import { Icon } from './icons.js';
import { useApp, font, px, Card, SectionLabel, CircleIconButton, Spinner, useTicker, useNow, uptime } from './ui.js';
import { s, css, gradient } from './theme.js';
import { drawBackground, drawConnect, drawMark, drawSparkline, AMPLITUDES, lerpAmps } from './draw.js';
import { t } from './i18n.js';
import { formatBytes } from './format.js';

// ---------------------------------------------------------------------------
// Живой фон
// ---------------------------------------------------------------------------

export function ObsidianBackground({ animated }) {
  const { palette: p } = useApp();
  const ref = useRef(null);
  const paletteRef = useRef(p);
  paletteRef.current = p;

  useLayoutEffect(() => {
    if (ref.current) drawBackground(ref.current, p, 0, true);
  }, [p, animated]);

  useTicker(animated, (time) => {
    if (ref.current) drawBackground(ref.current, paletteRef.current, time, false);
  });

  return html`<canvas ref=${ref} class="bg-canvas" />`;
}

// ---------------------------------------------------------------------------
// Фирменный знак
// ---------------------------------------------------------------------------

export function AppMark({ size, colors, wobble = 0.8, phase = 0.6, style }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (ref.current) drawMark(ref.current, colors, wobble, phase);
  });
  return html`<canvas ref=${ref} style=${{ width: px(size), height: px(size), display: 'block', flexShrink: 0, ...style }} />`;
}

// ---------------------------------------------------------------------------
// Кнопка подключения из версии 2.2: органическое пятно с мягким ореолом,
// которое дышит, а при подключении вспыхивает искрами.
// ---------------------------------------------------------------------------

const TRANSITION = 0.38;

function interpolated(a, now) {
  const elapsed = now - a.changedAt;
  if (elapsed >= TRANSITION) return a.target;
  const x = Math.max(0, elapsed / TRANSITION);
  // Плавный вход-выход, чтобы переход не начинался рывком.
  return lerpAmps(a.previous, a.target, x * x * (3 - 2 * x));
}

/**
 * Все «часы» анимации считаются от абсолютного времени с постоянным
 * периодом и никогда не перезапускаются от смены состояния — иначе на
 * каждом переключении картинка прыгала бы к началу цикла. От состояния
 * зависит только амплитуда, и она переходит к новому значению плавно.
 *
 * `size` — сторона холста. Само пятно — половина её: остальное занимает
 * ореол, которому нужно место, чтобы сойти на нет внутри холста.
 */
export function BlobConnectButton({ state, enabled, size, onToggle, style }) {
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

  // Нажимается только само пятно, а не прозрачный ореол вокруг.
  const onClick = (e) => {
    if (!enabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    if (Math.hypot(dx, dy) <= rect.width * 0.26) onToggle();
  };

  return html`
    <canvas ref=${ref} class="blob-button"
            title=${kind === 'connected' ? t('Отключиться', 'Disconnect') : t('Подключиться', 'Connect')}
            style=${{ width: px(size), height: px(size), opacity: enabled ? 1 : 0.55, ...style }}
            onClick=${onClick} />`;
}

// ---------------------------------------------------------------------------
// Главная карточка: кнопка, состояние, узел и две плашки — время и пинг.
// ---------------------------------------------------------------------------

const quality = (ms) => (ms < 120 ? 'good' : ms < 250 ? 'fair' : 'poor');
export const pingColor = (p, ms) => (ms == null ? p.textSecondary
  : { good: p.good, fair: p.warn, poor: p.bad }[quality(ms)]);

function StatTile({ label, children }) {
  const { palette: p } = useApp();
  return html`
    <div class="stat-tile">
      <span class="tabular" style=${font('code', 11.5, { color: css(p.textPrimary) })}>${children}</span>
      <span style=${font('label', 9.5, { color: css(p.textSecondary) })}>${label}</span>
    </div>`;
}

function Uptime({ since }) {
  const now = useNow(1000);
  return uptime(since, now);
}

export function HeroConnectCard() {
  const { palette: p, state, act } = useApp();
  const { store, connection: c } = state;
  const kind = c.state.kind;
  const selected = store.servers.find((x) => x.id === store.selectedID) || null;
  const isFailed = kind === 'failed';

  const headline = {
    connected: t('Подключено', 'Connected'),
    connecting: t('Подключение…', 'Connecting…'),
    failed: t('Ошибка', 'Error'),
    disconnected: t('Не подключено', 'Not connected')
  }[kind];

  let caption;
  if (kind === 'connecting') caption = t('устанавливаем защищённый канал', 'establishing a secure channel');
  else if (!selected) caption = t('выберите узел', 'pick a node');
  else {
    const parts = [titleOf(selected.displayName), String(selected.kind).toUpperCase()];
    if (selected.security !== 'none') parts.push(capitalize(selected.security));
    caption = parts.join(' · ');
  }

  const ping = selected ? store.pings[selected.id] : undefined;

  return html`
    <div class="glass hero-card">
      <${BlobConnectButton} state=${c.state} size=${s(196)}
                            enabled=${!!selected && kind !== 'connecting'}
                            onToggle=${() => act('toggle')}
                            style=${{ margin: `${px(-s(12))} ${px(-s(20))} ${px(-s(12))} ${px(-s(16))}` }} />
      <div class="col" style=${{ gap: px(s(12)), minWidth: 0 }}>
        <div class="col" style=${{ gap: px(s(3)), minWidth: 0 }}>
          <span style=${font('bold', 15, { color: css(isFailed ? p.bad : p.textPrimary) })}>${headline}</span>
          <span class="truncate" style=${font('body', 11, { color: css(p.textSecondary) })}>${caption}</span>
        </div>
        <div class="row" style=${{ gap: px(s(8)) }}>
          <${StatTile} label=${t('время', 'time')}>
            ${c.connectedSince && kind === 'connected' ? html`<${Uptime} since=${c.connectedSince} />` : '—'}
          <//>
          <${StatTile} label=${t('пинг', 'ping')}>
            ${typeof ping === 'number'
              ? html`<span style=${{ color: css(pingColor(p, ping)) }}>${ping} ${t('мс', 'ms')}</span>`
              : '—'}
          <//>
        </div>
      </div>
      <span class="spacer" />
    </div>`;
}

const capitalize = (v) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v);

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
        <span style=${font('heavy', 22, { color: css(p.textPrimary), opacity: appeared ? 1 : 0, transition: 'opacity 0.5s' })}>Life VPN</span>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Пинг — моноширинным числом цвета качества. Без полосок: цифра и цвет
// читаются быстрее.
// ---------------------------------------------------------------------------

/** `measured` — был ли замер; `latency` — null, если сервер не ответил. */
export function PingBadge({ measured, latency }) {
  const { palette: p } = useApp();
  if (!measured) return null;
  if (latency == null) {
    return html`<span style=${font('code', 10.5, { color: css(p.bad), whiteSpace: 'nowrap' })}>${t('Н/Д', 'N/A')}</span>`;
  }
  return html`<span class="tabular" style=${font('code', 10.5, { color: css(pingColor(p, latency)), whiteSpace: 'nowrap' })}>${latency} ${t('мс', 'ms')}</span>`;
}

// ---------------------------------------------------------------------------
// Строка узла
// ---------------------------------------------------------------------------

const isLetterOrNumber = (ch) => /[\p{L}\p{N}]/u.test(ch);

/** Флаг из имени уезжает в отдельный значок — в заголовке он лишний. */
export function titleOf(name) {
  const chars = Array.from(String(name || ''));
  let i = 0;
  while (i < chars.length && !isLetterOrNumber(chars[i])) i++;
  const rest = chars.slice(i).join('').trim();
  return rest || name;
}

export function flagOf(name) {
  let flag = '';
  for (const ch of Array.from(String(name || ''))) {
    if (isLetterOrNumber(ch)) break;
    if (/\s/.test(ch)) {
      if (!flag) continue;
      break;
    }
    flag += ch;
  }
  return flag || null;
}

/**
 * Двухбуквенный код страны: из флага (региональные индикаторы — это буквы
 * A–Z, сдвинутые в отдельный блок Юникода), а без флага — первые буквы
 * названия.
 */
export function countryCode(name) {
  const flag = flagOf(name);
  if (flag) {
    const letters = Array.from(flag)
      .map((ch) => ch.codePointAt(0))
      .filter((cp) => cp >= 0x1F1E6 && cp <= 0x1F1FF)
      .map((cp) => String.fromCharCode(cp - 0x1F1E6 + 65));
    if (letters.length === 2) return letters.join('');
  }
  return Array.from(titleOf(name)).filter((ch) => /\p{L}/u.test(ch)).slice(0, 2).join('').toUpperCase();
}

/** «TCP · REALITY», «XHTTP · REALITY» — транспорт и защита. */
export function transportLine(server) {
  const parts = [];
  if (server.kind !== 'vless') parts.push(String(server.kind).toUpperCase());
  parts.push(String(server.transport).toUpperCase());
  if (server.security !== 'none') parts.push(String(server.security).toUpperCase());
  return parts.join(' · ');
}

/** Квадратик с кодом страны вместо флага — спокойно на любой системе. */
function CodeBadge({ name, highlighted }) {
  const { palette: p } = useApp();
  const size = s(25);
  return html`
    <span class="code-badge" style=${{
      width: px(size), height: px(size), borderRadius: px(size * 0.33),
      fontSize: px(size * 0.37), color: css(p.textPrimary),
      background: highlighted ? css(p.accentStart, 0.28) : css(p.hoverFill)
    }}>${countryCode(name)}</span>`;
}

export function ServerRow({ server, measured, latency, isActive, isSelected, onSelect, onContext }) {
  const { palette: p } = useApp();
  return html`
    <div class=${`server-row ${isSelected ? 'selected' : ''}`}
         onClick=${onSelect}
         onContextMenu=${(e) => { e.preventDefault(); if (onContext) onContext(); }}>
      <${CodeBadge} name=${server.displayName} highlighted=${isSelected || isActive} />
      <span class="col" style="gap:2px; min-width:0; flex: 1 1 auto">
        <span class="truncate" style=${font('heading', 12, { color: css(p.textPrimary) })}>${titleOf(server.displayName)}</span>
        <span class="truncate" style=${font('code', 8, { color: css(p.textSecondary), letterSpacing: '0.3px' })}>${transportLine(server)}</span>
      </span>
      <span class="col" style="align-items:flex-end; gap:2px; flex-shrink:0">
        <${PingBadge} measured=${measured} latency=${latency} />
        ${isActive && html`<span style=${font('label', 9, { color: css(p.accentStart) })}>${t('активен', 'active')}</span>`}
      </span>
    </div>`;
}

// ---------------------------------------------------------------------------
// Объём крупно: число отдельно, единица мельче — «153.07 ГБ».
// ---------------------------------------------------------------------------

export function BigBytes({ bytes, caption, size = 20 }) {
  const { palette: p } = useApp();
  const text = formatBytes(bytes);
  const space = text.lastIndexOf(' ');
  const number = space >= 0 ? text.slice(0, space) : text;
  const unit = space >= 0 ? text.slice(space + 1) : '';
  return html`
    <div class="row" style=${{ alignItems: 'baseline', gap: px(s(6)) }}>
      <span style=${font('heavy', size, { color: css(p.textPrimary), letterSpacing: '-0.8px' })}>${number}</span>
      <span class="truncate" style=${font('heading', 11, { color: css(p.textSecondary) })}>${unit}${caption ? ` ${caption}` : ''}</span>
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
    <${Card} title=${t('Скорость', 'Speed')} fill>
      <div class="row" style=${{ gap: px(s(8)) }}>
        <div class="row" style=${{ alignItems: 'baseline', gap: px(s(4)), whiteSpace: 'nowrap' }}>
          <span class="tabular" style=${font('heavy', 20, { color: css(c.speed ? p.textPrimary : p.textSecondary) })}>${c.speed ? c.speed.mbps.toFixed(1) : '—'}</span>
          <span style=${font('heading', 11, { color: css(p.textSecondary) })}>${t('Мбит/с', 'Mbit/s')}</span>
        </div>
        <span class="spacer" style="min-width:4px" />
        ${c.isMeasuringSpeed
          ? html`<${Spinner} small />`
          : html`<${CircleIconButton} icon="speedometer" title=${t('Проверить скорость', 'Test the speed')} onClick=${() => act('measureSpeed')} />`}
      </div>
      <span class="spacer" />
      <span class="clamp2" style=${font('body', 10.5, { color: css(c.speedError ? p.bad : p.textSecondary), lineHeight: 1.3 })}>${detail}</span>
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
                  ${Math.abs(delta) >= 5 && html`<${Icon} name=${delta < 0 ? 'arrowtriangle.down.fill' : 'arrowtriangle.up.fill'} size=${s(6) * 1.2}
                      style=${{ color: css(delta < 0 ? p.good : p.warn) }} />`}
                  <span class="tabular" style=${font('code', 10.5, { color: css(pingColor(p, last)) })}>${last != null ? last : '—'}</span>
                </span>
              </div>`;
          })}
        </div>` : html`
        <span style=${font('body', 11, { color: css(p.textSecondary) })}>${t('Замеров ещё не было — нажми «Пинг».', 'No measurements yet — press “Ping”.')}</span>`}
    <//>`;
}

// ---------------------------------------------------------------------------
// Журнал маршрутизации на экране «Статистика»: какой адрес ушёл в туннель,
// какой — напрямую, а какой отсечён. «Выгрузить» сохраняет журнал всей
// сессии в .txt.
// ---------------------------------------------------------------------------

const ROUTE_TITLES = {
  proxy: () => t('Туннель', 'Tunnel'),
  direct: () => t('Напрямую', 'Direct'),
  block: () => t('Блок', 'Blocked'),
  other: () => t('Другое', 'Other')
};

export function RoutingLogCard({ style, onNotice }) {
  const { palette: p, state, act } = useApp();
  const [filter, setFilter] = useState(null);
  const log = state.routingLog || { entries: [], counts: {} };
  const entries = log.entries || [];
  const counts = log.counts || {};
  const shown = filter ? entries.filter((e) => e.route === filter) : entries;
  const isConnected = state.connection.state.kind === 'connected';

  const color = (route) => ({ proxy: p.accentStart, direct: p.good, block: p.bad }[route] || p.textSecondary);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const exportLog = async () => {
    const result = await act('exportRoutingLog');
    if (result && result.ok && onNotice) onNotice(t('Журнал сохранён.', 'The log has been saved.'), false);
    else if (result && result.ok === false && onNotice) onNotice(result.error, true);
  };

  const chip = (route, title, count) => {
    const on = filter === route;
    return html`
      <button class=${`log-chip ${on ? 'on' : ''}`} style=${font('bold', 10)} onClick=${() => setFilter(route)}>
        ${route && html`<span class="dot" style=${{ background: css(color(route)) }} />`}
        <span>${title}</span>
        <span class="tabular count">${count}</span>
      </button>`;
  };

  const emptyText = !isConnected
    ? t('Подключитесь — здесь появится, куда идёт каждое соединение', 'Connect to see where each connection goes')
    : filter == null ? t('Соединений пока нет', 'No connections yet') : t('В этой группе пока пусто', 'Nothing here yet');

  return html`
    <div class="glass card log-card" style=${style}>
      <div class="row" style=${{ gap: px(s(8)) }}>
        <${SectionLabel} text=${t('Журнал маршрутизации', 'Routing log')} />
        <span class="spacer" style="min-width:6px" />
        <button class="pill-btn" style=${font('heading', 10.5)} disabled=${!entries.length} onClick=${exportLog}
                title=${t('Сохранить журнал сессии в текстовый файл', 'Save the session log as a text file')}>
          <${Icon} name="square.and.arrow.up" size=${s(10.5) * 1.25} />
          <span>${t('Выгрузить', 'Export')}</span>
        </button>
      </div>
      <div class="row" style=${{ gap: px(s(6)) }}>
        ${chip(null, t('Все', 'All'), total)}
        ${['proxy', 'direct', 'block'].map((route) => chip(route, ROUTE_TITLES[route](), counts[route] || 0))}
      </div>
      ${shown.length === 0
        ? html`<div class="log-empty" style=${font('body', 11, { color: css(p.textSecondary) })}>${emptyText}</div>`
        : html`
          <div class="log-list">
            ${shown.map((entry) => html`
              <div class="log-row" key=${entry.id}
                   title=${entry.byDefault ? t('Ни одно правило не совпало — маршрут по умолчанию', 'No rule matched — default route')
                     : t('Сработало правило маршрутизации', 'Matched a routing rule')}>
                <span class="tabular" style=${font('code', 9.5, { color: css(p.textSecondary, 0.8) })}>${entry.time}</span>
                <span class="route-badge" style=${font('bold', 9, { color: css(color(entry.route)), background: css(color(entry.route), 0.14) })}>${ROUTE_TITLES[entry.route]()}</span>
                <span class="truncate" style=${font('code', 10.5, { flex: '1 1 auto' })}>
                  <span style=${{ color: css(p.textPrimary) }}>${entry.host}</span><span style=${{ color: css(p.textSecondary, 0.7) }}>:${entry.port}</span>
                </span>
                ${entry.network === 'UDP' && html`<span style=${font('code', 9, { color: css(p.textSecondary, 0.7) })}>UDP</span>`}
              </div>`)}
          </div>`}
    </div>`;
}

export { gradient };
