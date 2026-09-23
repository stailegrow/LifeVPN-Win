// Корень интерфейса — перенос RootView.swift.

import { html, render, useState, useEffect, useRef, useMemo } from '../vendor/preact-htm.js';
import { Icon } from './icons.js';
import { AppContext, font, px, MenuPanel, NoticeBanner } from './ui.js';
import { HUDBackground, Wordmark, TelemetryLine, LaunchSplash, SPLASH_DURATION } from './widgets.js';
import { HomeTab, ServersTab, SettingsTab } from './screens.js';
import { AddSheet, RenameSheet, DirectDomainsSheet, QRScannerSheet, decodeImage } from './sheets.js';
import { palette as paletteOf, cssVariables, css, s } from './theme.js';
import { t, setLanguage } from './i18n.js';

const api = window.lifevpn;
const act = (name, ...args) => api.action(name, ...args);

const TABS = [
  { id: 'home', icon: 'house.fill', title: () => t('ГЛАВНАЯ', 'HOME') },
  { id: 'servers', icon: 'server.rack', title: () => t('СЕРВЕРА', 'SERVERS') },
  { id: 'settings', icon: 'gearshape.fill', title: () => t('НАСТРОЙКИ', 'SETTINGS') }
];

function Root({ initial }) {
  const [state, setState] = useState(initial);
  const [tab, setTab] = useState('home');
  const [sheet, setSheet] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const [adding, setAdding] = useState(false);
  const [launching, setLaunching] = useState(true);
  const noticeTimer = useRef(null);

  setLanguage(state.lang);
  const p = paletteOf(state.settings.paletteID);

  useEffect(() => api.onState(setState), []);
  useEffect(() => api.onUI((message) => {
    if (message.rename) setSheet({ kind: 'rename', id: message.rename });
  }), []);

  // Заставка поверх всего окна уходит сама.
  useEffect(() => {
    const id = setTimeout(() => setLaunching(false), SPLASH_DURATION);
    return () => clearTimeout(id);
  }, []);
  const [splashMounted, setSplashMounted] = useState(true);
  useEffect(() => {
    if (launching) return undefined;
    const id = setTimeout(() => setSplashMounted(false), 500);
    return () => clearTimeout(id);
  }, [launching]);

  // Переменные палитры — на корень документа, чтобы и полоса прокрутки,
  // и фон под окном были в цветах темы.
  useEffect(() => {
    const vars = cssVariables(p);
    for (const [key, value] of Object.entries(vars)) document.documentElement.style.setProperty(key, value);
  }, [p]);

  const show = (text, isError) => {
    clearTimeout(noticeTimer.current);
    setNotice({ text, isError, leaving: false, key: Date.now() });
    noticeTimer.current = setTimeout(() => {
      setNotice((current) => (current && current.text === text ? { ...current, leaving: true } : current));
      noticeTimer.current = setTimeout(() => setNotice((current) => (current && current.text === text ? null : current)), 200);
    }, isError ? 7000 : 4000);
  };

  const add = async (raw) => {
    setAdding(true);
    try {
      const result = await act('quickAdd', raw);
      show(result.message, result.isFailure);
    } finally {
      setAdding(false);
    }
  };

  const paste = async () => {
    const clip = await act('readClipboard');
    if (clip.text) {
      add(clip.text);
      return;
    }
    // В буфере может лежать картинка со скриншотом кода.
    const code = clip.image ? await decodeImage(clip.image).catch(() => null) : null;
    if (code) add(code);
    else show(t('В буфере нет ни ссылки, ни картинки с QR-кодом.', 'The clipboard holds neither a link nor an image with a QR code.'), true);
  };

  const readQRFromFile = async () => {
    const chosen = await act('chooseImage');
    if (chosen.canceled) return;
    const code = chosen.image ? await decodeImage(chosen.image).catch(() => null) : null;
    if (code) add(code);
    else show(t('В этой картинке QR-код не распознался.', 'No QR code was recognised in this image.'), true);
  };

  // Ctrl+V в окне — то же, что «Вставить из буфера», если фокус не в поле.
  useEffect(() => {
    const onKey = (e) => {
      const target = e.target;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'v' && !typing && !sheet) {
        e.preventDefault();
        paste();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);

  const menuItems = [
    { icon: 'doc.on.clipboard', title: t('Вставить из буфера', 'Paste from clipboard'), subtitle: t('добавится сразу', 'added right away'),
      action: () => { setMenuOpen(false); paste(); } },
    { icon: 'qrcode.viewfinder', title: t('Сканировать QR', 'Scan QR'), subtitle: t('камерой', 'by camera'),
      action: () => { setMenuOpen(false); setSheet({ kind: 'scanner' }); } },
    { icon: 'photo', title: t('QR с картинки', 'QR from an image'), subtitle: t('из файла', 'from a file'),
      action: () => { setMenuOpen(false); readQRFromFile(); } },
    { icon: 'link', title: t('Ссылка на подписку', 'Subscription link'), separatorAbove: true,
      action: () => { setMenuOpen(false); setSheet({ kind: 'add', mode: 'subscription' }); } },
    { icon: 'text.alignleft', title: t('Ввести ссылки вручную', 'Enter links manually'),
      action: () => { setMenuOpen(false); setSheet({ kind: 'add', mode: 'links' }); } }
  ];

  const kind = state.connection.state.kind;
  const statusCode = { connected: 'Secure', connecting: t('Связь', 'Linking'), failed: t('Сбой', 'Fault'), disconnected: 'Offline' }[kind];
  const statusColor = { connected: p.good, connecting: p.warn, failed: p.bad, disconnected: p.idleRing }[kind];

  const footerItems = [];
  if (state.core.xrayVersion) footerItems.push(state.core.xrayVersion.split(' ').slice(0, 2).join(' ').toUpperCase());
  const preset = state.presets.find((x) => x.id === state.settings.routing.presetID);
  footerItems.push((preset ? preset.title : t('СВОИ ПРАВИЛА', 'CUSTOM RULES')).toUpperCase());
  footerItems.push('PROXY MODE');

  const context = useMemo(() => ({ palette: p, state, act }), [p, state]);

  const renamed = sheet && sheet.kind === 'rename' ? state.store.subscriptions.find((x) => x.id === sheet.id) : null;

  // Кнопки окна стоят в разметке после шапки намеренно: на Windows область
  // перетаскивания, объявленная позже, перекрывает объявленные раньше
  // кнопки, и клики по ним уходили в перетаскивание окна.
  return html`
    <${AppContext.Provider} value=${context}>
      <div class="window" key=${state.lang}>
        <${HUDBackground} animated=${state.settings.backgroundAnimation} />
        <div class="drag-strip" />

        <div class="header">
          <${Wordmark} />
          <span class="spacer" style="min-width:8px" />
          <div class="status-chip" style=${font('label', 10.5)}>
            <span class="status-dot" style=${{ background: css(statusColor) }} />
            <span>${statusCode}</span>
          </div>
          <button class="add-button" disabled=${adding} onClick=${() => setMenuOpen(!menuOpen)}
                  title=${t('Добавить подписку или узлы', 'Add a subscription or nodes')}>
            <${Icon} name=${adding ? 'hourglass' : 'plus'} size=${s(12) * 1.2} />
          </button>
        </div>

        <div class="content">
          ${tab === 'home' && html`<${HomeTab} onAddSubscription=${() => setSheet({ kind: 'add', mode: 'subscription' })}
                                                onPaste=${paste}
                                                onRename=${(id) => setSheet({ kind: 'rename', id })} />`}
          ${tab === 'servers' && html`<${ServersTab} />`}
          ${tab === 'settings' && html`<${SettingsTab} onEditDomains=${() => setSheet({ kind: 'domains' })} />`}
        </div>

        <div class="tabbar">
          ${TABS.map((item) => html`
            <button class=${`tab ${tab === item.id ? 'active' : ''}`} onClick=${() => setTab(item.id)} style=${font('heading', 8.5)}>
              <${Icon} name=${item.icon} size=${s(12) * 1.2} />
              <span>${item.title()}</span>
            </button>`)}
        </div>
        <${TelemetryLine} items=${footerItems} />

        <div class="window-controls">
          <button onClick=${() => act('minimize')} title=${t('Свернуть', 'Minimize')}><${Icon} name="minimize" size=${12} /></button>
          <button class="close" onClick=${() => act('hide')} title=${t('Закрыть', 'Close')}><${Icon} name="close" size=${12} /></button>
        </div>
        ${menuOpen && html`<${MenuPanel} items=${menuItems} onDismiss=${() => setMenuOpen(false)} />`}
        ${notice && html`<${NoticeBanner} key=${notice.key} text=${notice.text} isError=${notice.isError} leaving=${notice.leaving} />`}

        ${sheet && sheet.kind === 'add' && html`<${AddSheet} initialMode=${sheet.mode} onClose=${() => setSheet(null)} />`}
        ${renamed && html`<${RenameSheet} subscription=${renamed} onClose=${() => setSheet(null)} />`}
        ${sheet && sheet.kind === 'domains' && html`<${DirectDomainsSheet} onClose=${() => setSheet(null)} />`}
        ${sheet && sheet.kind === 'scanner' && html`<${QRScannerSheet} onFound=${add} onClose=${() => setSheet(null)} />`}

        ${splashMounted && html`<${LaunchSplash} gone=${!launching} />`}
      </div>
    <//>`;
}

(async () => {
  const initial = await api.state();
  setLanguage(initial.lang);
  const vars = cssVariables(paletteOf(initial.settings.paletteID));
  for (const [key, value] of Object.entries(vars)) document.documentElement.style.setProperty(key, value);
  // Шрифты до первого кадра — иначе экран дёрнется при подмене.
  await document.fonts.ready.catch(() => {});
  render(html`<${Root} initial=${initial} />`, document.getElementById('root'));
})();
