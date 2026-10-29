// Разделы боковой панели: перенос HomeTab.swift, ServersTab.swift и
// SettingsTab.swift (там же «Маршрутизация» и «Статистика») мак-версии 3.x.

import { html, useState, useEffect, useRef, useLayoutEffect } from '../vendor/preact-htm.js';
import { Icon } from './icons.js';
import { useApp, font, px, Card, SectionLabel, AccentButton, OutlineButton, Spinner, Toggle, Segmented } from './ui.js';
import { HeroConnectCard, ServerRow, SpeedCard, LatencyCard, BigBytes, RoutingLogCard } from './widgets.js';
import { s, css, gradient, Metrics, PALETTES } from './theme.js';
import { t } from './i18n.js';
import { formatBytes } from './format.js';

const measured = (store, id) => Object.prototype.hasOwnProperty.call(store.pings, id);

function Scroll({ children, gap = 12 }) {
  return html`
    <div class="scroll">
      <div class="stack" style=${{ padding: `0 ${px(Metrics.gutter)} ${px(s(14))}`, gap: px(s(gap)) }}>
        ${children}
      </div>
    </div>`;
}

function InlineNote({ icon, tint, text }) {
  const { palette: p } = useApp();
  return html`
    <div class="inline-note" style=${{ background: css(tint, 0.12), boxShadow: `inset 0 0 0 1px ${css(tint, 0.3)}` }}>
      <${Icon} name=${icon} size=${s(11) * 1.3} style=${{ color: css(tint), marginTop: '1px' }} />
      <span style=${font('body', 11, { color: css(p.textPrimary, 0.85), lineHeight: 1.3 })}>${text}</span>
    </div>`;
}

// ---------------------------------------------------------------------------
// Главная — только подключение и узлы: подписка и скорость живут в
// «Статистике», а действия с подпиской — в «Узлах».
// ---------------------------------------------------------------------------

export function HomeTab({ onAddSubscription, onPaste }) {
  const { palette: p, state, act } = useApp();
  const { store, connection: c } = state;
  const selected = store.servers.find((x) => x.id === store.selectedID) || null;
  const isConnected = c.state.kind === 'connected';
  const isEmpty = store.subscriptions.length === 0 && store.servers.length === 0;

  const currentSubscription = (() => {
    if (selected && selected.subscriptionID) {
      const found = store.subscriptions.find((x) => x.id === selected.subscriptionID);
      if (found) return found;
    }
    return store.subscriptions[0] || null;
  })();

  const visibleServers = (() => {
    const list = currentSubscription ? store.servers.filter((x) => x.subscriptionID === currentSubscription.id) : [];
    return list.length ? list : store.servers;
  })();

  return html`
    <${Scroll}>
      ${c.isPreparingRules && html`<${InlineNote} icon="arrow.down.circle" tint=${p.warn}
          text=${t('Загружаю базы правил маршрутизации…', 'Loading the routing databases…')} />`}
      ${c.routingNotice && html`<${InlineNote} icon="exclamationmark.circle" tint=${p.warn} text=${c.routingNotice} />`}
      ${c.recoveredFromCrash && html`<${InlineNote} icon="arrow.uturn.backward.circle" tint=${p.warn}
          text=${t('Прошлый запуск завершился некорректно — системный прокси снят.', 'The previous run ended abnormally — the system proxy has been cleared.')} />`}

      <${HeroConnectCard} />

      ${isEmpty
        ? html`
          <${Card} title=${t('Начало', 'Getting started')}>
            <span style=${font('heavy', 17, { color: css(p.textPrimary) })}>${t('Здесь пока пусто', 'Nothing here yet')}</span>
            <span style=${font('body', 11.5, { color: css(p.textSecondary), lineHeight: 1.35 })}>
              ${t('Добавьте подписку — узлы подтянутся сами и будут обновляться, когда вы меняете их на панели.',
                'Add a subscription — the nodes come in by themselves and keep updating as you change them on the panel.')}
            </span>
            <div class="row" style=${{ gap: px(s(8)) }}>
              <${AccentButton} onClick=${onAddSubscription}>${t('Добавить подписку', 'Add subscription')}<//>
              <${OutlineButton} onClick=${onPaste}>${t('Из буфера', 'From clipboard')}<//>
            </div>
          <//>`
        : html`
          <div class="glass card" style=${{ padding: px(s(16)) }}>
            <div class="row">
              <${SectionLabel} text=${t(`Узлы · ${visibleServers.length} доступно`, `Nodes · ${visibleServers.length} available`)} />
              <span class="spacer" />
              ${store.isPinging
                ? html`<${Spinner} />`
                : html`
                  <button class="text-btn" style=${font('label', 10.5)} onClick=${() => act('pingAll')} title=${t('Замерить задержку', 'Measure latency')}>
                    <${Icon} name="speedometer" size=${s(10.5) * 1.35} />
                    <span>${t('Замерить', 'Measure')}</span>
                  </button>`}
            </div>
            <div class="server-grid">
              ${visibleServers.map((server) => html`
                <${ServerRow} key=${server.id} server=${server}
                  measured=${measured(store, server.id)}
                  latency=${store.pings[server.id]}
                  isActive=${isConnected && c.activeServer && c.activeServer.id === server.id}
                  isSelected=${store.selectedID === server.id}
                  onSelect=${() => act('select', server.id)}
                  onContext=${() => act('serverMenu', server.id)} />`)}
            </div>
          </div>`}

      ${c.state.kind === 'failed' && html`
        <${Card} title=${t('Ошибка', 'Error')}>
          <div class="row" style=${font('heading', 12, { color: css(p.bad), gap: '6px' })}>
            <${Icon} name="exclamationmark.triangle.fill" size=${14} />
            <span>${t('Соединение не поднялось', 'The connection did not come up')}</span>
          </div>
          <div class="selectable" style=${font('code', 9, { color: css(p.textSecondary), maxHeight: '110px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' })}>${c.state.message}</div>
        <//>`}
    <//>`;
}

// ---------------------------------------------------------------------------
// Узлы — по подписке с задержкой, строка поиска из боковой панели
// фильтрует узлы по названию.
// ---------------------------------------------------------------------------

export function ServersTab({ query }) {
  const { palette: p, state, act } = useApp();
  const { store, connection: c } = state;
  const isConnected = c.state.kind === 'connected';

  // Фоновый опрос задержки — пока открыт экран со списком узлов.
  useEffect(() => {
    act('startAutoPing');
    return () => act('stopAutoPing');
  }, []);

  const q = (query || '').trim().toLocaleLowerCase();
  const filtered = (list) => (q ? list.filter((x) => String(x.displayName).toLocaleLowerCase().includes(q)) : list);

  const subtitleOf = (subscription) => {
    if (subscription.lastError) return subscription.lastError;
    const parts = [];
    if (subscription.trafficSummary) parts.push(subscription.trafficSummary);
    parts.push(t(`обновлена ${subscription.updatedText}`, `updated ${subscription.updatedText}`));
    return parts.join(' · ');
  };

  const group = (key, title, subtitle, servers, trailing) => html`
    <${Card} key=${key}>
      <div class="row" style="gap:8px">
        <div class="col" style="gap:2px; min-width:0; flex: 1 1 auto">
          <span class="truncate" style=${font('heavy', 15, { color: css(p.textPrimary) })}>${title}</span>
          ${subtitle && html`<span class="clamp2" style=${font('body', 10, { color: css(p.textSecondary) })}>${subtitle}</span>`}
        </div>
        ${trailing}
      </div>
      ${servers.length === 0
        ? html`<span style=${font('body', 11, { color: css(p.textSecondary) })}>${q ? t('Ничего не найдено', 'Nothing found') : t('Серверов нет', 'No servers')}</span>`
        : html`<div class="col" style=${{ gap: px(Metrics.rowGap) }}>
            ${servers.map((server) => html`
              <${ServerRow} key=${server.id} server=${server}
                measured=${measured(store, server.id)}
                latency=${store.pings[server.id]}
                isActive=${isConnected && c.activeServer && c.activeServer.id === server.id}
                isSelected=${store.selectedID === server.id}
                onSelect=${() => act('select', server.id)}
                onContext=${() => act('serverMenu', server.id)} />`)}
          </div>`}
    <//>`;

  const manual = store.servers.filter((x) => !x.subscriptionID);

  return html`
    <${Scroll} gap=${14}>
      ${store.subscriptions.map((subscription) => {
        const members = filtered(store.servers.filter((x) => x.subscriptionID === subscription.id));
        return html`
          ${group(subscription.id, subscription.displayName, subtitleOf(subscription), members, html`
            <button class="dots-btn" title=${t('Действия', 'Actions')} onClick=${() => act('subscriptionMenu', subscription.id)}>
              <${Icon} name="ellipsis" size=${16} />
            </button>`)}
          ${members.length > 0 && html`<${LatencyCard} key=${`${subscription.id}-latency`} servers=${members} />`}`;
      })}

      ${manual.length > 0 && group('manual', t('Добавлены вручную', 'Added manually'), null, filtered(manual), null)}

      ${store.servers.length === 0 && store.subscriptions.length === 0 && html`
        <${Card} title=${t('Пусто', 'Empty')}>
          <span style=${font('heading', 13, { color: css(p.textPrimary) })}>${t('Список пуст', 'The list is empty')}</span>
          <span style=${font('body', 12, { color: css(p.textSecondary) })}>${t('Добавь подписку или вставь vless:// ссылки.', 'Add a subscription or paste vless:// links.')}</span>
        <//>`}
    <//>`;
}

// ---------------------------------------------------------------------------
// Маршрутизация — что идёт через туннель, а что напрямую.
// ---------------------------------------------------------------------------

export function RoutingTab({ onEditDomains }) {
  const { palette: p, state, act } = useApp();
  const routing = state.settings.routing;
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoError, setGeoError] = useState(null);

  const domains = routing.directDomains || [];
  const domainsSummary = domains.length === 0 ? t('не заданы', 'not set')
    : domains.length <= 2 ? domains.join(', ')
      : domains.slice(0, 2).join(', ') + t(` и ещё ${domains.length - 2}`, ` and ${domains.length - 2} more`);

  const updateGeo = async () => {
    setGeoBusy(true);
    setGeoError(null);
    const result = await act('updateGeo');
    setGeoBusy(false);
    if (!result.ok) setGeoError(result.error);
  };

  return html`
    <${Scroll} gap=${14}>
      <${Card} title=${t('Режим', 'Mode')}>
        <div class="col" style=${{ gap: px(s(8)) }}>
          ${state.presets.map((preset) => {
            const on = routing.presetID === preset.id;
            return html`
              <button class=${`preset-row ${on ? 'on' : ''}`} onClick=${() => act('applyPreset', preset.id)}>
                <span class=${`radio ${on ? 'on' : ''}`}><span /></span>
                <span class="col" style="gap:2px; min-width:0">
                  <span style=${font('heading', 12.5, { color: css(p.textPrimary) })}>${preset.title}</span>
                  <span style=${font('body', 10.5, { color: css(p.textSecondary), lineHeight: 1.3 })}>${preset.subtitle}</span>
                </span>
              </button>`;
          })}
        </div>
      <//>
      <div class="row" style=${{ gap: px(s(14)), alignItems: 'stretch' }}>
        <${Card} title=${t('Свои домены напрямую', 'Own domains direct')} fill>
          <span class="clamp3" style=${font('code', 10, { color: css(p.textPrimary, 0.85), overflowWrap: 'anywhere', lineHeight: 1.35 })}>${domainsSummary}</span>
          <span class="spacer" />
          <div><${OutlineButton} onClick=${onEditDomains}>${t('Изменить', 'Edit')}<//></div>
        <//>
        <${Card} title=${t('Базы правил', 'Rule databases')} fill>
          <span style=${font('code', 9.5, { color: css(geoError ? p.bad : p.textPrimary, geoError ? 1 : 0.85), lineHeight: 1.35 })}>${geoError || state.geoSummary}</span>
          <span class="spacer" />
          <div>${geoBusy ? html`<${Spinner} />` : html`<${OutlineButton} onClick=${updateGeo}>${t('Обновить', 'Refresh')}<//>`}</div>
        <//>
      </div>
    <//>`;
}

// ---------------------------------------------------------------------------
// Статистика — скорость, трафик и история задержки по каждому узлу, ниже
// журнал маршрутизации на всё оставшееся место окна.
// ---------------------------------------------------------------------------

export function StatsTab({ onNotice }) {
  const { palette: p, state, act } = useApp();
  const { store } = state;
  const totalUsed = store.subscriptions.reduce((sum, x) => sum + (x.usedBytes || 0), 0);
  const scrollRef = useRef(null);
  const topRef = useRef(null);
  const [logHeight, setLogHeight] = useState(s(210));

  useEffect(() => {
    act('startAutoPing');
    return () => act('stopAutoPing');
  }, []);

  // Журнал занимает всё оставшееся место окна, но не меньше пары десятков
  // строк — при длинном списке узлов экран просто прокручивается.
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const top = topRef.current;
    if (!scroll || !top) return;
    const next = Math.max(s(210), scroll.clientHeight - top.offsetHeight - s(28));
    if (Math.abs(next - logHeight) > 1) setLogHeight(next);
  });

  return html`
    <div class="scroll" ref=${scrollRef}>
      <div class="stack" style=${{ padding: `0 ${px(Metrics.gutter)} ${px(s(14))}`, gap: px(s(14)) }}>
        <div class="stack" ref=${topRef} style=${{ gap: px(s(14)) }}>
          <div class="row" style=${{ gap: px(s(14)), alignItems: 'stretch' }}>
            <${SpeedCard} />
            <${Card} title=${t('Трафик', 'Traffic')} fill>
              <${BigBytes} bytes=${totalUsed} caption=${t('всего', 'total')} />
              ${store.subscriptions.map((subscription) => html`
                <div class="row" style="gap:6px" key=${subscription.id}>
                  <span class="truncate" style=${font('body', 11, { color: css(p.textSecondary) })}>${subscription.displayName}</span>
                  <span class="spacer" />
                  <span style=${font('code', 10, { color: css(p.textPrimary, 0.85), whiteSpace: 'nowrap' })}>${subscription.trafficSummary || '—'}</span>
                </div>`)}
            <//>
          </div>
          ${store.servers.length === 0
            ? html`<${Card} title=${t('Задержка', 'Latency')}>
                <span style=${font('body', 11.5, { color: css(p.textSecondary) })}>${t('Узлов пока нет — добавьте подписку.', 'No nodes yet — add a subscription.')}</span>
              <//>`
            : html`<${LatencyCard} servers=${store.servers} />`}
        </div>
        <${RoutingLogCard} style=${{ height: px(logHeight) }} onNotice=${onNotice} />
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Настройки — тема, поведение, язык, о программе.
// ---------------------------------------------------------------------------

/**
 * Мини-превью темы: фон окна с отсветом акцента, акцентная плашка и две
 * строки «текста». Выбранная — рамка цвета текущей темы и галочка.
 */
function ThemeTile({ option, on, onPick }) {
  const { palette: p } = useApp();
  const name = t(option.nameRU, option.nameEN);
  return html`
    <button class=${`theme-tile ${on ? 'on' : ''}`} onClick=${onPick} title=${name}>
      <span class="theme-preview" style=${{
        background: `radial-gradient(circle at 100% 0%, ${css(option.accentStart, option.isDark ? 0.55 : 0.35)} 0, transparent ${px(s(48))}), ${css(option.background)}`
      }}>
        <span style=${{ width: px(s(22)), height: px(s(6)), background: gradient(option) }} />
        <span style=${{ width: px(s(30)), height: px(s(3.5)), background: css(option.textPrimary, 0.4) }} />
        <span style=${{ width: px(s(19)), height: px(s(3.5)), background: css(option.textPrimary, 0.22) }} />
        ${on && html`<span class="theme-check" style=${{ background: css(p.accentStart), color: css(p.onAccent) }}>
          <${Icon} name="checkmark" size=${s(8) * 1.2} />
        </span>`}
      </span>
      <span class="truncate" style=${font('label', 9.5, { color: css(on ? p.textPrimary : p.textSecondary), maxWidth: '100%' })}>${name}</span>
    </button>`;
}

export function SettingsTab() {
  const { palette: p, state, act } = useApp();
  const settings = state.settings;
  const routing = settings.routing;
  const update = (patch) => act('updateSettings', patch);
  const u = state.updater;

  const themeRow = (title, options) => html`
    <div class="col" style=${{ gap: px(s(7)) }}>
      <span style=${font('label', 10.5, { color: css(p.textSecondary) })}>${title}</span>
      <div class="theme-grid">
        ${options.map((option) => html`<${ThemeTile} key=${option.id} option=${option} on=${settings.paletteID === option.id}
                                                      onPick=${() => update({ paletteID: option.id })} />`)}
      </div>
    </div>`;

  // «Xray 26.10.21» — без девиза, хеша сборки и версии Go.
  const coreVersion = state.core.xrayVersion
    ? state.core.xrayVersion.split(' ').slice(0, 2).join(' ')
    : state.core.failure || t('проверяю…', 'checking…');

  const updateStatus = (() => {
    switch (u.phase.kind) {
      case 'checking': return t('проверяю…', 'checking…');
      case 'upToDate': return t('установлена последняя версия', 'you have the latest version');
      case 'available': return t(`доступна версия ${u.latest ? u.latest.version : ''}`, `version ${u.latest ? u.latest.version : ''} is out`);
      case 'downloading': return t(`загрузка ${Math.round((u.phase.fraction || 0) * 100)}%`, `downloading ${Math.round((u.phase.fraction || 0) * 100)}%`);
      case 'installing': return t('устанавливаю…', 'installing…');
      case 'failed': return u.phase.message;
      default: return t('проверяются автоматически', 'checked automatically');
    }
  })();

  const row = (title, value) => html`
    <div class="row" style="align-items:flex-start">
      <span style=${font('body', 11.5, { color: css(p.textSecondary) })}>${title}</span>
      <span class="spacer" style="min-width:10px" />
      <span class="selectable" style=${font('body', 11.5, { color: css(p.textPrimary), textAlign: 'right' })}>${value}</span>
    </div>`;

  return html`
    <${Scroll} gap=${14}>
      <${Card} title=${t('Тема', 'Theme')}>
        ${themeRow(t('Тёмные', 'Dark'), PALETTES.filter((x) => x.isDark))}
        ${themeRow(t('Светлые', 'Light'), PALETTES.filter((x) => !x.isDark))}
      <//>

      <${Card} title=${t('Поведение', 'Behaviour')}>
        <${Toggle} label=${t('Обход локальной сети', 'Bypass the local network')} value=${routing.bypassLAN}
                   onChange=${(v) => update({ routing: { bypassLAN: v } })} />
        <span style=${font('body', 10, { color: css(p.textSecondary, 0.8), lineHeight: 1.3, marginTop: px(-s(4)) })}>
          ${t('Принтеры, NAS, роутер и соседние машины остаются доступны, пока VPN включён.',
            'Printers, NAS, the router and neighbouring machines stay reachable while the VPN is on.')}
        </span>
        <${Toggle} label=${t('Живой фон', 'Animated background')} value=${settings.backgroundAnimation}
                   onChange=${(v) => update({ backgroundAnimation: v })} />
        <${Toggle} label=${t('Замерять задержку при запуске', 'Measure latency at launch')} value=${settings.pingOnLaunch}
                   onChange=${(v) => update({ pingOnLaunch: v })} />
        <${Toggle} label=${t('Подключаться при запуске', 'Connect at launch')} value=${settings.autoConnectOnLaunch}
                   onChange=${(v) => update({ autoConnectOnLaunch: v })} />
      <//>

      <${Card} title=${t('Язык', 'Language')}>
        <${Segmented} value=${settings.language}
                      options=${[{ value: 'ru', title: 'Русский' }, { value: 'en', title: 'English' }]}
                      onChange=${(language) => update({ language })} />
      <//>

      <${Card} title=${t('О программе', 'About')}>
        ${row(t('Версия', 'Version'), `Life VPN ${state.version}`)}
        ${row(t('Ядро', 'Core'), coreVersion)}
        <div style=${{ height: '1px', background: css(p.glassEdge) }} />
        <div class="row" style=${{ gap: px(s(10)) }}>
          <div class="col" style="gap:2px; min-width:0; flex: 1 1 auto">
            <span style=${font('body', 11.5, { color: css(p.textSecondary) })}>${t('Обновления', 'Updates')}</span>
            <span style=${font('body', 10.5, { color: css(u.phase.kind === 'failed' ? p.bad : p.textPrimary, u.phase.kind === 'failed' ? 1 : 0.85), lineHeight: 1.3 })}>${updateStatus}</span>
          </div>
          ${u.phase.kind === 'checking'
            ? html`<${Spinner} />`
            : u.phase.kind === 'available'
              ? html`<${AccentButton} onClick=${() => act('installUpdate')}>${t('Обновить', 'Update')}<//>`
              : html`<${OutlineButton} onClick=${() => act('checkUpdates')}>${t('Проверить', 'Check')}<//>`}
        </div>
      <//>
    <//>`;
}

export { formatBytes };
