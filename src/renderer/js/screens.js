// Три вкладки: перенос HomeTab.swift, ServersTab.swift и SettingsTab.swift.

import { html, useState, useEffect } from '../vendor/preact-htm.js';
import { Icon } from './icons.js';
import { useApp, font, px, Card, AccentButton, OutlineButton, IconButton, Spinner, Toggle, Segmented } from './ui.js';
import { ConnectSlab, ServerRow, TrafficMeter, SpeedCard, LatencyCard } from './widgets.js';
import { s, css, Metrics, PALETTES } from './theme.js';
import { t } from './i18n.js';

const pad = { padding: `0 ${px(Metrics.gutter)} 12px` };

function InlineNote({ icon, tint, text }) {
  const { palette: p } = useApp();
  return html`
    <div class="row" style=${{ alignItems: 'flex-start', gap: '7px', padding: '8px 10px', background: css(tint, 0.16), borderRadius: px(s(14)) }}>
      <${Icon} name=${icon} size=${11.5} style=${{ color: css(tint), marginTop: '1px' }} />
      <span style=${font('body', 10.5, { color: css(p.textSecondary), lineHeight: 1.3 })}>${text}</span>
    </div>`;
}

// ---------------------------------------------------------------------------
// Главная
// ---------------------------------------------------------------------------

export function HomeTab({ onAddSubscription, onPaste, onRename }) {
  const { palette: p, state, act } = useApp();
  const { store, connection: c } = state;
  const selected = store.servers.find((x) => x.id === store.selectedID) || null;
  const isConnected = c.state.kind === 'connected';

  const currentSubscription = (() => {
    if (selected && selected.subscriptionID) {
      const found = store.subscriptions.find((x) => x.id === selected.subscriptionID);
      if (found) return found;
    }
    return store.subscriptions[0] || null;
  })();

  const visibleServers = (() => {
    const list = store.servers.filter((x) => (x.subscriptionID || null) === (currentSubscription ? currentSubscription.id : null));
    return list.length ? list : store.servers;
  })();

  return html`
    <div class="scroll">
      <div class="stack" style=${{ ...pad, gap: '10px' }}>
        <${ConnectSlab} state=${c.state}
                        serverName=${selected ? selected.displayName : null}
                        connectedSince=${c.connectedSince}
                        externalIP=${c.externalIP}
                        enabled=${!!selected && c.state.kind !== 'connecting'}
                        onToggle=${() => act('toggle')} />

        ${c.isPreparingRules && html`<${InlineNote} icon="arrow.down.circle" tint=${p.warn}
            text=${t('Загружаю базы правил маршрутизации…', 'Loading the routing databases…')} />`}
        ${c.routingNotice && html`<${InlineNote} icon="exclamationmark.circle" tint=${p.warn} text=${c.routingNotice} />`}
        ${c.recoveredFromCrash && html`<${InlineNote} icon="arrow.uturn.backward.circle" tint=${p.warn}
            text=${t('Прошлый запуск завершился некорректно — системный прокси снят.', 'The previous run ended abnormally — the system proxy has been cleared.')} />`}

        ${store.subscriptions.length === 0 && store.servers.length === 0
          ? html`<${EmptyState} onAddSubscription=${onAddSubscription} onPaste=${onPaste} />`
          : html`
            ${currentSubscription && html`<${SubscriptionCard} subscription=${currentSubscription} onRename=${onRename} />`}
            <${Card} title=${t('Узлы', 'Nodes')}>
              <div class="row">
                <span style=${font('code', 9.5, { color: css(p.textSecondary) })}>${t(`${visibleServers.length} доступно`, `${visibleServers.length} available`)}</span>
                <span class="spacer" />
                ${store.isPinging
                  ? html`<${Spinner} />`
                  : html`<${IconButton} icon="speedometer" size=${11} title=${t('Замерить задержку', 'Measure latency')} onClick=${() => act('pingAll')} />`}
              </div>
              <div class="col" style=${{ gap: px(Metrics.rowGap) }}>
                ${visibleServers.map((server, index) => html`
                  <${ServerRow} key=${server.id} server=${server} index=${index}
                    measured=${Object.prototype.hasOwnProperty.call(store.pings, server.id)}
                    latency=${store.pings[server.id]}
                    isActive=${isConnected && c.activeServer && c.activeServer.id === server.id}
                    isSelected=${store.selectedID === server.id}
                    onSelect=${() => act('select', server.id)} />`)}
              </div>
            <//>
            <${SpeedCard} />`}

        ${c.state.kind === 'failed' && html`
          <${Card} title=${t('Ошибка', 'Error')}>
            <div class="row" style=${font('heading', 11.5, { color: css(p.bad), gap: '6px' })}>
              <${Icon} name="exclamationmark.triangle.fill" size=${13} />
              <span>${t('Соединение не поднялось', 'The connection did not come up')}</span>
            </div>
            <div class="selectable" style=${font('code', 9, { color: css(p.textSecondary), maxHeight: '110px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' })}>${c.state.message}</div>
          <//>`}
      </div>
    </div>`;
}

function EmptyState({ onAddSubscription, onPaste }) {
  const { palette: p } = useApp();
  return html`
    <${Card} title=${t('Начало', 'Getting started')}>
      <span style=${font('heading', 13, { color: css(p.textPrimary) })}>${t('Здесь пока пусто', 'Nothing here yet')}</span>
      <span style=${font('body', 11.5, { color: css(p.textSecondary), lineHeight: 1.3 })}>
        ${t('Добавь подписку — узлы подтянутся сами и будут обновляться, ', 'Add a subscription — the nodes come in by themselves and keep updating ')
          + t('когда ты меняешь их на панели.', 'as you change them on the panel.')}
      </span>
      <div class="row" style=${{ gap: px(s(8)) }}>
        <${AccentButton} onClick=${onAddSubscription}>${t('Добавить подписку', 'Add subscription')}<//>
        <${OutlineButton} onClick=${onPaste}>${t('Из буфера', 'From clipboard')}<//>
      </div>
      <div class="row" style=${{ gap: px(s(6)), alignItems: 'flex-start' }}>
        <${Icon} name="qrcode.viewfinder" size=${s(10) * 1.25} style=${{ color: css(p.accentStart), marginTop: '1px' }} />
        <span style=${font('body', 10.5, { color: css(p.textSecondary, 0.8), lineHeight: 1.3 })}>
          ${t('QR-код — через «плюс» вверху: камерой или картинкой из файла.', 'QR code — from the “plus” above: by camera or from an image file.')}
        </span>
      </div>
    <//>`;
}

function SubscriptionCard({ subscription, onRename }) {
  const { palette: p, state, act } = useApp();
  const refreshing = state.store.refreshingIDs.includes(subscription.id);
  return html`
    <${Card} title=${t('Подписка', 'Subscription')}>
      <div class="row" style="gap:7px">
        <span class="truncate" style=${font('heading', 12.5, { color: css(p.textPrimary) })}>${subscription.displayName}</span>
        <${IconButton} icon="pencil" size=${9.5} title=${t('Переименовать подписку', 'Rename subscription')} onClick=${() => onRename(subscription.id)} />
        <span class="spacer" style="min-width:6px" />
        ${refreshing
          ? html`<${Spinner} />`
          : html`<${IconButton} icon="arrow.clockwise" size=${11} title=${t('Обновить подписку', 'Refresh subscription')} onClick=${() => act('refresh', subscription.id)} />`}
      </div>

      ${subscription.announce && html`<span style=${font('body', 10.5, { color: css(p.textSecondary), lineHeight: 1.3, whiteSpace: 'pre-wrap' })}>${subscription.announce}</span>`}

      ${subscription.usedBytes != null && html`<${TrafficMeter} used=${subscription.usedBytes} total=${subscription.totalBytes} />`}

      <div class="row" style=${font('code', 9, { color: css(p.textSecondary, 0.85), gap: '6px' })}>
        <span>${t(`Обновлена ${subscription.updatedText}`, `Updated ${subscription.updatedText}`)}</span>
        <span class="spacer" style="min-width:6px" />
        ${subscription.expirySummary && html`<span style=${{ color: css(subscription.isExpired ? p.bad : p.textSecondary) }}>
          ${subscription.isExpired ? t(`истекла ${subscription.expirySummary}`, `expired ${subscription.expirySummary}`) : t(`до ${subscription.expirySummary}`, `until ${subscription.expirySummary}`)}</span>`}
        <span>${t(`${subscription.serverCount} узлов`, `${subscription.serverCount} nodes`)}</span>
      </div>

      ${subscription.lastError && html`<span style=${font('code', 9, { color: css(p.bad) })}>${subscription.lastError}</span>`}
    <//>`;
}

// ---------------------------------------------------------------------------
// Сервера
// ---------------------------------------------------------------------------

export function ServersTab() {
  const { palette: p, state, act } = useApp();
  const { store, connection: c } = state;
  const isConnected = c.state.kind === 'connected';

  // Фоновый опрос задержки — пока открыт экран со списком узлов.
  useEffect(() => {
    act('startAutoPing');
    return () => act('stopAutoPing');
  }, []);

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
          <span class="truncate" style=${font('heading', 13, { color: css(p.textPrimary) })}>${title}</span>
          ${subtitle && html`<span style=${font('body', 10, { color: css(p.textSecondary), display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' })}>${subtitle}</span>`}
        </div>
        ${trailing}
      </div>
      ${servers.length === 0
        ? html`<span style=${font('body', 11, { color: css(p.textSecondary) })}>${t('Серверов нет', 'No servers')}</span>`
        : html`<div class="col" style=${{ gap: px(Metrics.rowGap) }}>
            ${servers.map((server, index) => html`
              <${ServerRow} key=${server.id} server=${server} index=${index}
                measured=${Object.prototype.hasOwnProperty.call(store.pings, server.id)}
                latency=${store.pings[server.id]}
                isActive=${isConnected && c.activeServer && c.activeServer.id === server.id}
                isSelected=${store.selectedID === server.id}
                onSelect=${() => act('select', server.id)}
                onContext=${() => act('serverMenu', server.id)} />`)}
          </div>`}
    <//>`;

  const manual = store.servers.filter((x) => !x.subscriptionID);

  return html`
    <div class="scroll">
      <div class="stack" style=${{ padding: `12px ${px(Metrics.gutter)}`, gap: '14px' }}>
        ${store.subscriptions.map((subscription) => {
          const members = store.servers.filter((x) => x.subscriptionID === subscription.id);
          return html`
            ${group(subscription.id, subscription.displayName, subtitleOf(subscription), members, html`
              <button class="icon-btn" style="width:22px; height:22px" title=${t('Действия', 'Actions')}
                      onClick=${() => act('subscriptionMenu', subscription.id)}>
                <${Icon} name="ellipsis" size=${16} />
              </button>`)}
            ${members.length > 0 && html`<${LatencyCard} key=${`${subscription.id}-latency`} servers=${members} />`}`;
        })}

        ${manual.length > 0 && group('manual', t('Добавлены вручную', 'Added manually'), null, manual, null)}

        ${store.servers.length === 0 && store.subscriptions.length === 0 && html`
          <${Card} title=${t('Пусто', 'Empty')}>
            <span style=${font('heading', 13, { color: css(p.textPrimary) })}>${t('Список пуст', 'The list is empty')}</span>
            <span style=${font('body', 12, { color: css(p.textSecondary) })}>${t('Добавь подписку или вставь vless:// ссылки.', 'Add a subscription or paste vless:// links.')}</span>
          <//>`}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Настройки
// ---------------------------------------------------------------------------

export function SettingsTab({ onEditDomains }) {
  const { palette: p, state, act } = useApp();
  const settings = state.settings;
  const routing = settings.routing;
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

  const rule = html`<div style=${{ height: '1px', background: css(p.cardBorder) }} />`;
  const update = (patch) => act('updateSettings', patch);

  return html`
    <div class="scroll">
      <div class="stack" style=${{ padding: `12px ${px(Metrics.gutter)}`, gap: '12px' }}>

        <${Card} title=${t('Маршрутизация', 'Routing')}>
          ${state.presets.map((preset) => {
            const active = routing.presetID === preset.id;
            return html`
              <button class="row" style="align-items:flex-start; gap:8px; text-align:left" onClick=${() => act('applyPreset', preset.id)}>
                <${Icon} name=${active ? 'largecircle.fill.circle' : 'circle'} size=${12.5}
                         style=${{ color: css(active ? p.accentStart : p.textSecondary), marginTop: '1px' }} />
                <span class="col" style="gap:2px">
                  <span style=${font('heading', 11.5, { color: css(p.textPrimary) })}>${preset.title}</span>
                  <span style=${font('body', 10, { color: css(p.textSecondary), lineHeight: 1.3 })}>${preset.subtitle}</span>
                </span>
              </button>`;
          })}
          ${rule}
          <div class="row" style=${{ alignItems: 'flex-start', gap: px(s(10)) }}>
            <div class="col" style="gap:2px; min-width:0; flex: 1 1 auto">
              <span style=${font('heading', 10.5, { color: css(p.textSecondary) })}>${t('Свои домены напрямую', 'Own domains direct')}</span>
              <span style=${font('code', 9.5, { color: css(p.textSecondary, 0.75), display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-all' })}>${domainsSummary}</span>
            </div>
            <${OutlineButton} onClick=${onEditDomains}>${t('Изменить', 'Edit')}<//>
          </div>
          ${rule}
          <div class="row" style="gap:8px">
            <div class="col" style="gap:2px; min-width:0; flex: 1 1 auto">
              <span style=${font('heading', 10.5, { color: css(p.textSecondary) })}>${t('Базы правил', 'Rule databases')}</span>
              <span style=${font('code', 9, { color: css(geoError ? p.bad : p.textSecondary) })}>${geoError || state.geoSummary}</span>
            </div>
            ${geoBusy ? html`<${Spinner} />` : html`<${OutlineButton} onClick=${updateGeo}>${t('Обновить', 'Refresh')}<//>`}
          </div>
        <//>

        <${Card} title=${t('Язык', 'Language')}>
          <${Segmented} value=${settings.language}
                        options=${[{ value: 'ru', title: 'Русский' }, { value: 'en', title: 'English' }]}
                        onChange=${(language) => update({ language })} />
        <//>

        <${Card} title=${t('Тема', 'Theme')}>
          <div class="row" style=${{ gap: px(s(5)) }}>
            ${PALETTES.map((option) => {
              const active = settings.paletteID === option.id;
              return html`
                <button class="col" style=${{ flex: '1 1 0', alignItems: 'center', gap: px(s(5)), minWidth: 0 }}
                        onClick=${() => update({ paletteID: option.id })} title=${t(option.nameRU, option.nameEN)}>
                  <span style=${{
                    position: 'relative', width: px(s(31)), height: px(s(31)), borderRadius: '50%',
                    background: css(option.background),
                    boxShadow: active ? `inset 0 0 0 2px ${css(option.accentStart)}` : 'none'
                  }}>
                    <span style=${{
                      position: 'absolute', inset: px(s(5) - s(3.5) / 2), borderRadius: '50%',
                      padding: px(s(3.5)),
                      background: `linear-gradient(135deg, ${css(option.accentStart)}, ${css(option.accentEnd)})`,
                      WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
                      WebkitMaskComposite: 'xor', maskComposite: 'exclude'
                    }} />
                  </span>
                  <span class="truncate" style=${font('label', 8.5, { color: css(active ? p.textPrimary : p.textSecondary), maxWidth: '100%' })}>${t(option.nameRU, option.nameEN)}</span>
                </button>`;
            })}
          </div>
        <//>

        <${Card} title=${t('Поведение', 'Behaviour')}>
          <${Toggle} label=${t('Обход локальной сети', 'Bypass the local network')} value=${routing.bypassLAN}
                     onChange=${(v) => update({ routing: { bypassLAN: v } })} />
          <span style=${font('body', 10, { color: css(p.textSecondary, 0.75), lineHeight: 1.3 })}>
            ${t('Принтеры, NAS, роутер и соседние машины остаются доступны, ', 'Printers, NAS, the router and neighbouring machines stay reachable ')
              + t('пока VPN включён.', 'while the VPN is on.')}
          </span>
          <${Toggle} label=${t('Живой фон', 'Animated background')} value=${settings.backgroundAnimation}
                     onChange=${(v) => update({ backgroundAnimation: v })} />
          <${Toggle} label=${t('Замерять задержку при запуске', 'Measure latency at launch')} value=${settings.pingOnLaunch}
                     onChange=${(v) => update({ pingOnLaunch: v })} />
          <${Toggle} label=${t('Подключаться при запуске', 'Connect at launch')} value=${settings.autoConnectOnLaunch}
                     onChange=${(v) => update({ autoConnectOnLaunch: v })} />
        <//>

        <${Card} title=${t('О программе', 'About')}>
          ${aboutRow(p, t('Версия', 'Version'), `Life VPN ${state.version}`)}
          ${aboutRow(p, t('Ядро', 'Core'), state.core.xrayVersion || state.core.failure || t('проверяю…', 'checking…'))}
        <//>
      </div>
    </div>`;
}

function aboutRow(p, title, value) {
  return html`
    <div class="row" style="align-items:flex-start">
      <span style=${font('body', 11, { color: css(p.textSecondary) })}>${title}</span>
      <span class="spacer" style="min-width:10px" />
      <span class="selectable" style=${font('body', 11, { color: css(p.textPrimary), textAlign: 'right' })}>${value}</span>
    </div>`;
}
