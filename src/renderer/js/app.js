// Корень интерфейса — перенос RootView.swift мак-версии 3.x.

import { html, render, useState, useEffect, useRef, useMemo } from '../vendor/preact-htm.js';
import { Icon } from './icons.js';
import { AppContext, font, px, MenuPanel, NoticeBanner } from './ui.js';
import { ObsidianBackground, LaunchSplash, SPLASH_DURATION } from './widgets.js';
import { Sidebar, TABS, sidebarWidth } from './sidebar.js';
import { HomeTab, ServersTab, RoutingTab, StatsTab, LogsTab, SettingsTab } from './screens.js';
import { AddSheet, RenameSheet, DirectDomainsSheet, QRScannerSheet, decodeImage } from './sheets.js';
import { palette as paletteOf, cssVariables, css, s, Metrics } from './theme.js';
import { t, setLanguage } from './i18n.js';

const api = window.lifevpn;
const act = (name, ...args) => api.action(name, ...args);

const readCollapsed = () => {
  try { return localStorage.getItem('sidebarCollapsed') === '1'; } catch (_) { return false; }
};
const writeCollapsed = (value) => {
  try { localStorage.setItem('sidebarCollapsed', value ? '1' : '0'); } catch (_) { /* не критично */ }
};

/**
 * Заголовок раздела над контентом: крупное имя, строка пояснения и плашка
 * состояния справа.
 */
function PageHeader({ tab, search, state, p }) {
  const c = state.connection;
  const kind = c.state.kind;
  const info = TABS.find((x) => x.id === tab);

  let subtitle;
  switch (tab) {
    case 'home':
      if (kind === 'connected') {
        const preset = state.presets.find((x) => x.id === state.settings.routing.presetID);
        const name = preset ? preset.title : t('свои правила', 'custom rules');
        subtitle = t(`Туннель поднят · маршрутизация «${name}»`, `Tunnel is up · routing “${name}”`);
      } else {
        subtitle = t('Выберите узел и подключитесь', 'Pick a node and connect');
      }
      break;
    case 'servers':
      subtitle = search ? t(`Поиск: «${search}»`, `Search: “${search}”`) : t('Все узлы и задержка до них', 'All nodes and their latency');
      break;
    case 'routing':
      subtitle = t('Что идёт через туннель, а что — напрямую', 'What goes through the tunnel and what goes direct');
      break;
    case 'stats':
      subtitle = t('Скорость, трафик и история задержки', 'Speed, traffic and latency history');
      break;
    case 'logs':
      subtitle = t('Соединения, маршруты и журнал сессии', 'Connections, routes and session log');
      break;
    default:
      subtitle = t('Тема, язык и поведение', 'Theme, language and behaviour');
  }

  const chip = {
    connected: { text: t('Защищено', 'Protected'), color: p.good },
    connecting: { text: t('Подключение…', 'Connecting…'), color: p.warn },
    failed: { text: t('Сбой', 'Fault'), color: p.bad },
    disconnected: { text: t('Не защищено', 'Not protected'), color: p.textSecondary }
  }[kind];

  return html`
    <div class="page-header">
      <div class="col drag" style=${{ gap: px(s(2)), minWidth: 0, flex: '1 1 auto' }}>
        <span class="truncate" style=${font('heavy', 20, { color: css(p.textPrimary), letterSpacing: '-0.4px' })}>${info.title()}</span>
        <span class="truncate" style=${font('body', 11, { color: css(p.textSecondary) })}>${subtitle}</span>
      </div>
      <div class="status-chip glass" style=${font('heading', 11.5, { color: css(p.textPrimary) })}>
        <span class="status-dot" style=${{ background: css(chip.color), boxShadow: `0 0 5px ${css(chip.color, 0.9)}` }} />
        <span>${chip.text}</span>
      </div>
    </div>`;
}

function Root({ initial }) {
  const [state, setState] = useState(initial);
  const [tab, setTab] = useState('home');
  const [sheet, setSheet] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const [adding, setAdding] = useState(false);
  const [launching, setLaunching] = useState(true);
  const [collapsed, setCollapsed] = useState(readCollapsed());
  const [search, setSearch] = useState('');
  const noticeTimer = useRef(null);
  const searchRef = useRef(null);

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

  // Переменные палитры — на корень документа.
  useEffect(() => {
    const vars = cssVariables(p);
    for (const [key, value] of Object.entries(vars)) document.documentElement.style.setProperty(key, value);
  }, [p]);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      writeCollapsed(!value);
      return !value;
    });
  };

  // Поиск: ввод в строке переключает на «Узлы».
  const onSearch = (value) => {
    setSearch(value);
    if (value && tab !== 'servers') setTab('servers');
  };

  /** Разворачивает панель, если она свёрнута, и ставит курсор в поиск. */
  const focusSearch = () => {
    if (collapsed) {
      setCollapsed(false);
      writeCollapsed(false);
      setTimeout(() => searchRef.current && searchRef.current.focus(), 260);
    } else if (searchRef.current) {
      searchRef.current.focus();
    }
  };

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

  // Ctrl+V в окне — «Вставить из буфера», если фокус не в поле;
  // Ctrl+K — поиск узла (⌘K на маке).
  useEffect(() => {
    const onKey = (e) => {
      const target = e.target;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      const key = e.key.toLowerCase();
      if (e.ctrlKey && !e.shiftKey && !e.altKey && (key === 'k' || e.code === 'KeyK') && !sheet) {
        e.preventDefault();
        focusSearch();
        return;
      }
      if (e.ctrlKey && !e.shiftKey && !e.altKey && (key === 'v' || e.code === 'KeyV') && !typing && !sheet) {
        e.preventDefault();
        paste();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet, collapsed]);

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

  const context = useMemo(() => ({ palette: p, state, act }), [p, state]);
  const renamed = sheet && sheet.kind === 'rename' ? state.store.subscriptions.find((x) => x.id === sheet.id) : null;

  // Меню «плюс» — у кнопки в шапке боковой панели.
  const menuAnchor = { top: px(s(12) + s(44)), left: px(Math.max(s(12), s(12) + sidebarWidth(collapsed) - s(64))) };

  return html`
    <${AppContext.Provider} value=${context}>
      <div class="window" key=${state.lang}>
        <${ObsidianBackground} animated=${state.settings.backgroundAnimation} />
        <div class="drag-strip" />

        <div class="layout">
          <${Sidebar} tab=${tab} onTab=${(id) => setTab(id)}
                      collapsed=${collapsed} onToggleCollapse=${toggleCollapsed} onFocusSearch=${focusSearch}
                      search=${search} onSearch=${onSearch} searchRef=${searchRef}
                      adding=${adding} onAdd=${() => setMenuOpen(!menuOpen)} />

          <div class="main">
            <${PageHeader} tab=${tab} search=${search} state=${state} p=${p} />
            <div class="content" key=${tab}>
              ${tab === 'home' && html`<${HomeTab} onAddSubscription=${() => setSheet({ kind: 'add', mode: 'subscription' })} onPaste=${paste} />`}
              ${tab === 'servers' && html`<${ServersTab} query=${search} />`}
              ${tab === 'routing' && html`<${RoutingTab} onEditDomains=${() => setSheet({ kind: 'domains' })} />`}
              ${tab === 'stats' && html`<${StatsTab} onNotice=${show} />`}
              ${tab === 'logs' && html`<${LogsTab} onNotice=${show} />`}
              ${tab === 'settings' && html`<${SettingsTab} />`}
            </div>
            ${notice && html`<${NoticeBanner} key=${notice.key} text=${notice.text} isError=${notice.isError} leaving=${notice.leaving} />`}
          </div>
        </div>

        <div class="window-controls">
          <button onClick=${() => act('minimize')} title=${t('Свернуть', 'Minimize')}><${Icon} name="minimize" size=${13} /></button>
          <button class="close" onClick=${() => act('hide')} title=${t('Закрыть', 'Close')}><${Icon} name="close" size=${13} /></button>
        </div>

        ${menuOpen && html`<${MenuPanel} items=${menuItems} anchor=${menuAnchor} onDismiss=${() => setMenuOpen(false)} />`}

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

export { Metrics };
