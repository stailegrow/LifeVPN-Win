// Плавающая стеклянная панель — перенос Sidebar.swift.
//
// Сверху — знак и кнопки «добавить» и «свернуть», под ними карточка
// текущего узла с кнопкой питания и поиск по узлам (Ctrl+K). Ниже — разделы
// меню: подсветка активного пункта перетекает между строками, а не
// перепрыгивает. Свёрнутая панель оставляет колонку значков с подсказками.

import { html, useRef, useLayoutEffect } from '../vendor/preact-htm.js';
import { Icon } from './icons.js';
import { useApp, font, px, SectionLabel, AccentButton, Spinner, useNow, uptime } from './ui.js';
import { AppMark, countryCode, titleOf } from './widgets.js';
import { s, css, gradient } from './theme.js';
import { t } from './i18n.js';

export const EXPANDED_WIDTH = s(188);
export const COLLAPSED_WIDTH = s(66);
export const sidebarWidth = (collapsed) => (collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH);

export const TABS = [
  { id: 'home', icon: 'house', title: () => t('Главная', 'Home') },
  { id: 'servers', icon: 'server.outline', title: () => t('Узлы', 'Nodes') },
  { id: 'routing', icon: 'arrow.up.arrow.down', title: () => t('Маршрутизация', 'Routing') },
  { id: 'stats', icon: 'chart.bar', title: () => t('Статистика', 'Statistics') },
  { id: 'logs', icon: 'doc.text', title: () => t('Журнал', 'Logs') },
  { id: 'settings', icon: 'gearshape', title: () => t('Настройки', 'Settings') }
];
const tabInfo = (id) => TABS.find((x) => x.id === id);

function statusOf(p, kind) {
  return {
    connected: { text: t('Подключено', 'Connected'), color: p.good },
    connecting: { text: t('Подключение…', 'Connecting…'), color: p.warn },
    failed: { text: t('Ошибка', 'Error'), color: p.bad },
    disconnected: { text: t('Не подключено', 'Not connected'), color: p.textSecondary }
  }[kind];
}

export function Sidebar({ tab, onTab, collapsed, onToggleCollapse, onFocusSearch, search, onSearch, searchRef, adding, onAdd }) {
  const { palette: p, state, act } = useApp();
  const { store, connection: c } = state;
  const kind = c.state.kind;
  const selected = store.servers.find((x) => x.id === store.selectedID) || null;
  const status = statusOf(p, kind);
  const isOn = kind === 'connected';

  // Подсветка активного пункта — одна на всю панель и перетекает к новой
  // строке (matchedGeometryEffect на маке).
  const navRef = useRef(null);
  const highlightRef = useRef(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    const hl = highlightRef.current;
    if (!nav || !hl) return;
    const row = nav.querySelector(`[data-tab="${tab}"]`);
    if (!row) { hl.style.opacity = '0'; return; }
    hl.style.opacity = '1';
    hl.style.transform = `translateY(${row.offsetTop}px)`;
    hl.style.height = `${row.offsetHeight}px`;
  });

  const roundButton = (icon, title, onClick, disabled) => html`
    <button class="round-btn" title=${title} onClick=${onClick} disabled=${disabled}>
      <${Icon} name=${icon} size=${s(11.5) * 1.3} />
    </button>`;

  const navRow = (id) => {
    const info = tabInfo(id);
    const active = tab === id;
    return html`
      <button class=${`side-row ${active ? 'active' : ''}`} data-tab=${id} onClick=${() => onTab(id)}
              title=${collapsed ? info.title() : ''} style=${font(active ? 'bold' : 'heading', 11.5)}>
        <${Icon} name=${info.icon} size=${s(13) * 1.3} />
        ${!collapsed && html`<span class="truncate">${info.title()}</span>`}
      </button>`;
  };

  const section = (title, content) => html`
    <div class="col side-section">
      ${collapsed
        ? html`<div class="side-rule" />`
        : html`<${SectionLabel} text=${title} style=${{ padding: `0 ${px(s(10))} ${px(s(5))}` }} />`}
      ${content}
    </div>`;

  return html`
    <div class=${`sidebar glass elevated ${collapsed ? 'collapsed' : ''}`} style=${{ width: px(sidebarWidth(collapsed)) }}>
      <div class="side-header">
        ${!collapsed && html`
          <${AppMark} size=${s(20)} colors=${[p.accentStart, p.accentEnd]} />
          <span class="truncate side-title" style=${font('heavy', 14, { color: css(p.textPrimary) })}>Life VPN</span>
          <span class="spacer" />
          ${roundButton(adding ? 'hourglass' : 'plus', t('Добавить подписку или узлы', 'Add a subscription or nodes'), onAdd, adding)}`}
        ${roundButton('sidebar.left', collapsed ? t('Развернуть панель', 'Expand the sidebar') : t('Свернуть панель', 'Collapse the sidebar'), onToggleCollapse)}
      </div>

      <div class="side-profile" onClick=${() => onTab('home')} title=${collapsed ? status.text : ''}>
        <span class="profile-badge" style=${{ background: gradient(p), color: css(p.onAccent), ...font('heavy', 10.5) }}>
          ${selected ? countryCode(selected.displayName) : '—'}
          <span class="profile-dot" style=${{ background: css(status.color), borderColor: css(p.card) }} />
        </span>
        ${!collapsed && html`
          <span class="col" style="gap:1px; min-width:0; flex: 1 1 auto">
            <span class="truncate" style=${font('heading', 12, { color: css(p.textPrimary) })}>${selected ? titleOf(selected.displayName) : t('Нет узла', 'No node')}</span>
            <span class="truncate tabular" style=${font('body', 10.5, { color: css(p.textSecondary) })}>
              ${isOn && c.connectedSince ? html`<${SessionClock} since=${c.connectedSince} />` : status.text}
            </span>
          </span>
          <button class=${`power-btn ${isOn ? 'on' : ''}`} disabled=${!selected || kind === 'connecting'}
                  title=${isOn ? t('Отключить', 'Disconnect') : t('Подключить', 'Connect')}
                  onClick=${(e) => { e.stopPropagation(); act('toggle'); }}>
            <${Icon} name="power" size=${s(12) * 1.25} />
          </button>`}
      </div>

      ${collapsed
        ? html`
          <button class="side-search-collapsed" onClick=${onFocusSearch} title=${t('Поиск узла (Ctrl+K)', 'Search nodes (Ctrl+K)')}>
            <${Icon} name="magnifyingglass" size=${s(12) * 1.25} />
          </button>`
        : html`
          <label class="side-search">
            <${Icon} name="magnifyingglass" size=${s(11.5) * 1.25} />
            <input ref=${searchRef} type="text" spellcheck=${false} value=${search}
                   placeholder=${t('Поиск узла', 'Search nodes')} style=${font('body', 11.5)}
                   onInput=${(e) => onSearch(e.currentTarget.value)}
                   onKeyDown=${(e) => { if (e.key === 'Escape') { onSearch(''); e.currentTarget.blur(); } }} />
            ${search
              ? html`<button class="clear-btn" title=${t('Очистить', 'Clear')} onClick=${(e) => { e.preventDefault(); onSearch(''); }}>
                  <${Icon} name="xmark.circle.fill" size=${s(12) * 1.2} />
                </button>`
              : html`<span class="kbd" style=${font('code', 8.5)}>Ctrl K</span>`}
          </label>`}

      <div class="side-scroll">
        <div class="col side-nav" ref=${navRef}>
          <div class="side-highlight" ref=${highlightRef} />
          ${section(t('Меню', 'Menu'), html`${navRow('home')}${navRow('servers')}${navRow('routing')}${navRow('stats')}${navRow('logs')}`)}
          ${section(t('Общее', 'General'), html`
            ${navRow('settings')}
            <button class="side-row danger" onClick=${() => act('quit')} title=${collapsed ? t('Выход', 'Quit') : ''} style=${font('heading', 11.5)}>
              <${Icon} name="quit" size=${s(13) * 1.3} />
              ${!collapsed && html`<span class="truncate">${t('Выход', 'Quit')}</span>`}
            </button>`)}
        </div>
      </div>

      ${state.updater && state.updater.hasUpdate && html`<${UpdateCard} collapsed=${collapsed} />`}
    </div>`;
}

function SessionClock({ since }) {
  const now = useNow(1000);
  return uptime(since, now);
}

/**
 * «Доступна новая версия» внизу панели: кнопка обновления, а во время
 * загрузки — полоска прогресса. В свёрнутой панели — круглая кнопка.
 */
function UpdateCard({ collapsed }) {
  const { palette: p, state, act } = useApp();
  const u = state.updater;
  const version = u.latest ? u.latest.version : '';
  const title = t(`Доступна версия ${version}`, `Version ${version} is out`);
  const busy = u.phase.kind === 'downloading' || u.phase.kind === 'installing';

  if (collapsed) {
    return html`
      <button class="update-collapsed" disabled=${busy} title=${title} onClick=${() => act('installUpdate')}>
        <${Icon} name="arrow.down.circle.fill" size=${s(18) * 1.2} />
      </button>`;
  }

  let body;
  switch (u.phase.kind) {
    case 'downloading': {
      const percent = Math.round((u.phase.fraction || 0) * 100);
      body = html`
        <div class="progress"><div style=${{ width: `${percent}%` }} /></div>
        <span style=${font('body', 10.5, { color: css(p.textSecondary) })}>${t(`Загрузка… ${percent}%`, `Downloading… ${percent}%`)}</span>`;
      break;
    }
    case 'installing':
      body = html`
        <div class="row" style="gap:6px">
          <${Spinner} />
          <span style=${font('body', 10.5, { color: css(p.textSecondary) })}>${t('Устанавливаю и перезапускаю…', 'Installing and relaunching…')}</span>
        </div>`;
      break;
    case 'failed':
      body = html`
        <span class="clamp3" style=${font('body', 10.5, { color: css(p.bad) })}>${u.phase.message}</span>
        <${AccentButton} onClick=${() => act('installUpdate')}>${t('Повторить', 'Retry')}<//>`;
      break;
    default:
      body = html`
        <span style=${font('body', 10.5, { color: css(p.textSecondary), lineHeight: 1.3 })}>
          ${t('VPN ненадолго отключится, приложение перезапустится само.', 'The VPN drops for a moment; the app relaunches by itself.')}
        </span>
        <${AccentButton} onClick=${() => act('installUpdate')}>${t('Обновить', 'Update')}<//>`;
  }

  return html`
    <div class="update-card">
      <div class="row" style="gap:8px">
        <${Icon} name="sparkles" size=${s(12) * 1.25} style=${{ color: css(p.accentStart) }} />
        <span class="truncate" style=${font('heading', 12, { color: css(p.textPrimary) })}>${title}</span>
      </div>
      ${body}
    </div>`;
}
