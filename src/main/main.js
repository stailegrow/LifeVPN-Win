'use strict';

const path = require('path');
const fs = require('fs');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, nativeTheme,
  clipboard, dialog, shell, session, powerMonitor, Notification
} = require('electron');

const paths = require('../core/paths');
const L = require('../core/l10n');
const models = require('../core/models');
const http = require('../core/http');
const GeoAssets = require('../core/geoAssets');
const SystemProxy = require('../core/systemProxy');
const Xray = require('../core/xray');
const { AppSettings } = require('../core/settings');
const { ServerStore } = require('../core/serverStore');
const { ConnectionManager } = require('../core/connection');
const { formatUpdated } = require('../core/format');

const t = L.t;
const VERSION = app.getVersion();

// Размер окна фиксирован намеренно, как и на маке: раскладка рассчитана под
// одну ширину — ряд из семи кружков тем, вордмарк в шапке, подписи вкладок.
const WINDOW_WIDTH = 368;
const WINDOW_HEIGHT = 660;

app.setAppUserModelId('com.stailegrow.lifevpn');

// Второй экземпляр не запускаем: два ядра и два хозяина системного прокси
// друг другу мешают. Повторный запуск просто показывает окно.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Пути и ресурсы
// ---------------------------------------------------------------------------

const resourcesDir = app.isPackaged
  ? process.resourcesPath
  : path.join(__dirname, '..', '..', 'resources');

function resource(...parts) {
  return path.join(resourcesDir, ...parts);
}

paths.setRoot(path.join(app.getPath('appData'), 'LifeVPN'));
app.setPath('userData', path.join(app.getPath('appData'), 'LifeVPN', 'Chromium'));

Xray.setBinary(process.env.LIFEVPN_XRAY || resource('bin', process.platform === 'win32' ? 'xray.exe' : 'xray'));
SystemProxy.setHelper(resource('bin', 'lifevpn-proxy.exe'));

// ---------------------------------------------------------------------------
// Состояние
// ---------------------------------------------------------------------------

let settings;
let store;
let connection;
const core = { xrayVersion: null, failure: null, isProbing: false };

let mainWindow = null;
let tray = null;
let isQuitting = false;
let pushTimer = null;
let trayHintShown = false;

function snapshot() {
  const lang = L.language();
  const storeState = store.snapshot();
  // Строки, которые зависят от языка и времени, считаем здесь: логика
  // форматирования одна на всё приложение.
  const subscriptions = storeState.subscriptions.map((s) => ({
    ...s,
    displayName: models.subscriptionDisplayName(s),
    trafficSummary: models.trafficSummary(s),
    expirySummary: models.expirySummary(s),
    isExpired: models.isExpired(s),
    updatedText: formatUpdated(s.lastUpdated),
    serverCount: storeState.servers.filter((x) => x.subscriptionID === s.id).length
  }));
  const servers = storeState.servers.map((s) => ({ ...s, displayName: models.displayName(s) }));
  const conn = connection.snapshot();
  if (conn.activeServer) conn.activeServer = { ...conn.activeServer, displayName: models.displayName(conn.activeServer) };

  return {
    version: VERSION,
    lang,
    settings: settings.snapshot(),
    presets: models.PRESETS.map((p) => ({ id: p.id, title: t(p.titleRU, p.titleEN), subtitle: t(p.subtitleRU, p.subtitleEN) })),
    store: { ...storeState, servers, subscriptions },
    connection: conn,
    core,
    geoSummary: GeoAssets.summary()
  };
}

/** Интерфейс получает состояние целиком; частые изменения склеиваем. */
function push() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('state', snapshot());
    }
    updateTray();
  }, 16);
}

// ---------------------------------------------------------------------------
// Окно
// ---------------------------------------------------------------------------

function paletteBackground() {
  const backgrounds = {
    sky: '#F2F7FD', mint: '#EFFAF4', lavender: '#F5F1FC', peach: '#FDF5EC',
    rose: '#FDF0F5', night: '#1B2030', amoled: '#000000'
  };
  return backgrounds[settings.get('paletteID')] || backgrounds.sky;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    show: false,
    title: 'Life VPN',
    backgroundColor: paletteBackground(),
    icon: resource('app-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: true
    }
  });

  mainWindow.setMenu(null);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) mainWindow.show();
  });

  // Закрытие окна не завершает приложение — как на маке, оно остаётся в
  // трее, а вместе с ним и поднятый туннель.
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
    showTrayHintOnce();
  });

  // Внешние ссылки — в браузер, а не внутрь окна приложения.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^ms-settings:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  // Камера — только для сканера QR и только своему окну.
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission === 'media') {
      const types = (details && details.mediaTypes) || [];
      callback(types.every((type) => type === 'video'));
      return;
    }
    callback(permission === 'clipboard-sanitized-write');
  });
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function showTrayHintOnce() {
  if (trayHintShown || !tray) return;
  trayHintShown = true;
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: 'Life VPN',
        body: t('Приложение продолжает работать в трее. Выйти — через правый клик по значку.',
          'The app keeps running in the tray. To quit, right-click its icon.'),
        icon: resource('app-icon.png'),
        silent: true
      }).show();
    }
  } catch (_) { /* не критично */ }
}

// ---------------------------------------------------------------------------
// Трей — аналог значка в строке меню
// ---------------------------------------------------------------------------

function trayImage() {
  let variant;
  if (connection && connection.isConnected) {
    variant = 'connected';
  } else {
    // Цвет под панель задач: на тёмной — светлый значок, на светлой — тёмный.
    const darkTaskbar = typeof nativeTheme.shouldUseDarkColorsForSystemIntegratedUI === 'boolean'
      ? nativeTheme.shouldUseDarkColorsForSystemIntegratedUI
      : nativeTheme.shouldUseDarkColors;
    variant = darkTaskbar ? 'light' : 'dark';
  }
  const image = nativeImage.createFromPath(resource('tray', `tray-${variant}.png`));
  const x2 = resource('tray', `tray-${variant}@2x.png`);
  if (fs.existsSync(x2)) image.addRepresentation({ scaleFactor: 2, dataURL: nativeImage.createFromPath(x2).toDataURL() });
  const x15 = resource('tray', `tray-${variant}@1.5x.png`);
  if (fs.existsSync(x15)) image.addRepresentation({ scaleFactor: 1.5, dataURL: nativeImage.createFromPath(x15).toDataURL() });
  return image;
}

function trayMenu() {
  const items = [];
  const state = connection.state.kind;
  const active = connection.activeServer;

  switch (state) {
    case 'connected':
      items.push({ label: t('Подключено: ', 'Connected: ') + (active ? models.displayName(active) : '—'), enabled: false });
      if (connection.externalIP) items.push({ label: t(`Внешний IP: ${connection.externalIP}`, `External IP: ${connection.externalIP}`), enabled: false });
      break;
    case 'connecting':
      items.push({ label: t('Подключаюсь…', 'Connecting…'), enabled: false });
      break;
    case 'failed':
      items.push({ label: t('Ошибка подключения', 'Connection error'), enabled: false });
      break;
    default:
      items.push({ label: t('Отключено', 'Disconnected'), enabled: false });
  }

  items.push({ type: 'separator' });

  const selected = store.selected;
  if (connection.isConnected) {
    items.push({ label: t('Отключиться', 'Disconnect'), click: () => connection.disconnect() });
  } else if (selected) {
    const name = models.displayName(selected);
    items.push({ label: t(`Подключиться к ${name}`, `Connect to ${name}`), click: () => connection.connect(selected) });
  }

  if (store.servers.length) {
    items.push({
      label: t('Серверы', 'Servers'),
      submenu: store.servers.map((server) => ({
        label: models.displayName(server),
        type: 'checkbox',
        checked: server.id === store.selectedID,
        click: () => {
          store.select(server.id);
          connection.connect(server);
        }
      }))
    });
  }

  items.push({ type: 'separator' });
  items.push({ label: t('Открыть Life VPN', 'Open Life VPN'), click: showWindow });
  items.push({ label: t('Выйти', 'Quit'), click: quit });
  return Menu.buildFromTemplate(items);
}

let lastTrayKey = '';
function updateTray() {
  if (!tray || tray.isDestroyed()) return;
  const key = [connection.state.kind, nativeTheme.shouldUseDarkColors].join('|');
  if (key !== lastTrayKey) {
    lastTrayKey = key;
    tray.setImage(trayImage());
  }
  const status = connection.isConnected
    ? t('подключено', 'connected')
    : connection.isBusy ? t('подключение…', 'connecting…') : t('отключено', 'disconnected');
  tray.setToolTip(`Life VPN — ${status}`);
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('Life VPN');
  // Левый клик — окно, правый — меню: так ведут себя значки в трее Windows.
  tray.on('click', showWindow);
  tray.on('right-click', () => tray.popUpContextMenu(trayMenu()));
  nativeTheme.on('updated', () => { lastTrayKey = ''; updateTray(); });
}

// ---------------------------------------------------------------------------
// Команды интерфейса
// ---------------------------------------------------------------------------

function findServer(id) {
  return store.servers.find((s) => s.id === id) || null;
}

const actions = {
  async toggle() {
    const server = store.selected;
    if (!server) return;
    await connection.toggle(server);
  },
  async connect(id) {
    const server = findServer(id);
    if (server) {
      store.select(id);
      await connection.connect(server);
    }
  },
  async disconnect() { await connection.disconnect(); },
  select(id) { store.select(id); },
  async pingAll() { await store.pingAll(); },
  async ping(id) { await store.ping(id); },
  startAutoPing() { store.startAutoPing(); },
  stopAutoPing() { store.stopAutoPing(); },
  async refresh(id) { return store.refresh(id); },
  async measureSpeed() { await connection.measureSpeed(); },
  async quickAdd(text) { return store.quickAdd(text); },

  /** Добавление подписки из окна «Добавить»: битую не оставляем висеть. */
  async addSubscription(url, name) {
    const subscription = store.addSubscription(url, name);
    const ok = await store.refresh(subscription.id);
    const stored = store.subscriptions.find((s) => s.id === subscription.id);
    if (ok) return { ok: true };
    const problem = (stored && stored.lastError) || t('Не удалось загрузить подписку.', 'Could not load the subscription.');
    store.removeSubscription(subscription.id);
    return { ok: false, problem };
  },
  addLinks(text) {
    const LinkParser = require('../core/linkParser');
    const parsed = LinkParser.parseMany(text);
    const added = store.add(parsed.configs);
    return { added, parsedCount: parsed.configs.length, errors: parsed.errors };
  },
  renameSubscription(id, name) { store.renameSubscription(id, name); },
  removeSubscription(id) { store.removeSubscription(id); },
  removeServer(id) { store.remove([id]); },

  updateSettings(patch) {
    const languageChanged = patch.language && patch.language !== settings.get('language');
    settings.update(patch);
    if (patch.paletteID && mainWindow) mainWindow.setBackgroundColor(paletteBackground());
    if (languageChanged) lastTrayKey = '';
  },
  applyPreset(id) { settings.applyRoutingPreset(id); },
  setDirectDomains(list) {
    settings.update({ routing: { directDomains: list } });
  },
  async updateGeo() {
    try {
      await GeoAssets.download(settings.routing);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    } finally {
      push();
    }
  },

  readClipboard() {
    const text = clipboard.readText();
    if (text && text.trim()) return { text };
    // В буфере может лежать картинка со скриншотом кода.
    const image = clipboard.readImage();
    if (!image.isEmpty()) return { image: image.toDataURL() };
    // …или путь к файлу с ней (скопированный в Проводнике файл).
    try {
      const raw = clipboard.readBuffer('FileNameW');
      if (raw && raw.length) {
        const file = raw.toString('ucs2').replace(/\0.*$/s, '');
        if (file && fs.existsSync(file)) {
          const fromFile = nativeImage.createFromPath(file);
          if (!fromFile.isEmpty()) return { image: fromFile.toDataURL() };
        }
      }
    } catch (_) { /* формата нет */ }
    return {};
  },
  writeClipboard(text) { clipboard.writeText(String(text || '')); },

  async chooseImage() {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: t('Выбери картинку с QR-кодом', 'Choose an image with a QR code'),
      buttonLabel: t('Прочитать', 'Read'),
      properties: ['openFile'],
      filters: [{ name: t('Картинки', 'Images'), extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] }]
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    const image = nativeImage.createFromPath(result.filePaths[0]);
    if (image.isEmpty()) return {};
    return { image: image.toDataURL() };
  },

  openCameraSettings() { shell.openExternal('ms-settings:privacy-webcam'); },

  /** Контекстное меню строки сервера — системное, как на маке. */
  serverMenu(id) {
    const server = findServer(id);
    if (!server || !mainWindow) return;
    const items = [
      { label: t('Подключиться', 'Connect'), click: () => actions.connect(id) },
      { label: t('Замерить задержку', 'Measure latency'), click: () => store.ping(id) }
    ];
    if (server.sourceLink) {
      items.push({ label: t('Скопировать ссылку', 'Copy link'), click: () => clipboard.writeText(server.sourceLink) });
    }
    if (!server.subscriptionID) {
      items.push({ type: 'separator' });
      items.push({ label: t('Удалить', 'Delete'), click: () => store.remove([id]) });
    }
    Menu.buildFromTemplate(items).popup({ window: mainWindow });
  },

  /** Меню «…» у подписки. Переименование открывает окно в интерфейсе. */
  subscriptionMenu(id) {
    const subscription = store.subscriptions.find((s) => s.id === id);
    if (!subscription || !mainWindow) return;
    Menu.buildFromTemplate([
      { label: t('Переименовать…', 'Rename…'), click: () => mainWindow.webContents.send('ui', { rename: id }) },
      { label: t('Обновить', 'Refresh'), click: () => store.refresh(id) },
      { label: t('Скопировать ссылку', 'Copy link'), click: () => clipboard.writeText(subscription.url) },
      { type: 'separator' },
      { label: t('Удалить подписку', 'Delete subscription'), click: () => store.removeSubscription(id) }
    ]).popup({ window: mainWindow });
  },

  minimize() { if (mainWindow) mainWindow.minimize(); },
  hide() { if (mainWindow) mainWindow.close(); },
  quit() { quit(); }
};

ipcMain.handle('action', async (_event, name, ...args) => {
  const handler = actions[name];
  if (!handler) throw new Error(`unknown action ${name}`);
  return handler(...args);
});
ipcMain.handle('state', () => snapshot());

// ---------------------------------------------------------------------------
// Жизненный цикл
// ---------------------------------------------------------------------------

async function probeCore() {
  core.isProbing = true;
  push();
  try {
    const version = await Xray.version();
    core.xrayVersion = version || t('неизвестна', 'unknown');
    core.failure = null;
  } catch (error) {
    core.xrayVersion = null;
    core.failure = error.message;
  } finally {
    core.isProbing = false;
    push();
  }
}

/** Системный прокси обязан сниматься при выходе — иначе пользователь
 *  остаётся без интернета и без приложения, которое это чинит. */
function shutdown() {
  try {
    if (connection) connection.shutdownSynchronously();
  } catch (_) { /* сделали что могли */ }
}

function quit() {
  isQuitting = true;
  shutdown();
  app.quit();
}

app.on('second-instance', showWindow);

app.on('before-quit', () => {
  isQuitting = true;
  shutdown();
});

// Приложение живёт в трее и без окна.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  settings = new AppSettings(app.getLocale());
  store = new ServerStore({ version: VERSION });
  connection = new ConnectionManager(settings);

  http.init(session);

  settings.on('change', push);
  store.on('change', push);
  connection.on('change', push);

  createWindow();
  createTray();

  // Выключение или выход из учётной записи Windows: снимаем прокси.
  powerMonitor.on('shutdown', shutdown);
  app.on('session-end', shutdown);

  probeCore();
  store.startAutoRefresh();

  // Базы правил — отдельной задачей: они ни от чего не зависят и не
  // должны задерживать замер задержки. Обновляются каждый запуск.
  GeoAssets.refreshOnLaunch(settings.routing).then(push);

  await store.prepareOnLaunch(settings.get('pingOnLaunch'));

  if (settings.get('autoConnectOnLaunch') && store.selected && !connection.isConnected && !connection.isBusy) {
    connection.connect(store.selected);
  }
});

// Скриншоты для проверки вёрстки — только в разработке.
if (!app.isPackaged && process.env.LIFEVPN_SHOTS) {
  app.whenReady().then(() => {
    require('../../scripts/shots')(() => mainWindow, app, {
      setPalette: async (id) => { actions.updateSettings({ paletteID: id }); },
      setLanguage: async (lang) => { actions.updateSettings({ language: lang }); },
      e2e: async () => {
        const added = await store.quickAdd(process.env.LIFEVPN_E2E_LINK);
        const server = store.servers.find((x) => x.address === '127.0.0.1');
        store.select(server.id);
        await connection.connect(server);
        return { added, state: connection.state, ip: connection.externalIP };
      },
      speed: async () => { await connection.measureSpeed(); },
      speedState: () => ({ speed: connection.speed, error: connection.speedError }),
      disconnect: async () => { await connection.disconnect(); },
      fakeState: async (kind) => {
        const server = store.selected;
        connection.activeServer = server;
        connection.state = kind === 'failed'
          ? { kind, message: 'Ядро завершилось сразу с кодом 1:\nFailed to start: main: failed to load config files' }
          : { kind };
        connection.externalIP = kind === 'connected' ? '185.22.153.41' : null;
        connection.connectedSince = kind === 'connected' ? new Date(Date.now() - 754000).toISOString() : null;
        connection.changed();
      }
    });
  });
}

process.on('uncaughtException', (error) => {
  // Падение главного процесса не должно оставить систему на мёртвом прокси.
  shutdown();
  try { dialog.showErrorBox('Life VPN', String(error && error.stack || error)); } catch (_) { /* нет окна */ }
  app.exit(1);
});
