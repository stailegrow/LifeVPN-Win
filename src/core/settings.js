'use strict';

const EventEmitter = require('events');
const paths = require('./paths');
const L = require('./l10n');
const models = require('./models');
const { writeAtomic, readJSON } = require('./atomic');

/**
 * Пользовательские настройки. Живут отдельно от списка серверов, чтобы
 * сброс одного не тянул за собой другое.
 */
class AppSettings extends EventEmitter {
  constructor(systemLocale) {
    super();
    const defaults = {
      paletteID: 'sky',
      language: null,
      socksPort: 10818,
      httpPort: 10819,
      autoConnectOnLaunch: false,
      pingOnLaunch: true,
      backgroundAnimation: true,
      routing: models.preset('bypass-ru').make()
    };
    const stored = readJSON(paths.settings()) || {};
    this.data = { ...defaults, ...stored };
    // Старый файл без части полей должен читаться, а не сбрасывать всё.
    this.data.routing = models.makeRoutingConfig({ ...defaults.routing, ...(stored.routing || {}) });
    if (!this.data.language) this.data.language = L.systemLanguage(systemLocale);
    L.setLanguage(this.data.language);
  }

  get(key) {
    return this.data[key];
  }

  get routing() {
    return this.data.routing;
  }

  /** Частичное обновление. Язык применяется сразу. */
  update(patch) {
    const next = { ...this.data, ...patch };
    if (patch.routing) next.routing = models.makeRoutingConfig({ ...this.data.routing, ...patch.routing });
    if (patch.socksPort != null) next.socksPort = clampPort(patch.socksPort, this.data.socksPort);
    if (patch.httpPort != null) next.httpPort = clampPort(patch.httpPort, this.data.httpPort);
    this.data = next;
    L.setLanguage(this.data.language);
    this.save();
    this.emit('change');
  }

  applyRoutingPreset(id) {
    const preset = models.preset(id);
    if (!preset) return;
    this.data.routing = preset.make();
    this.save();
    this.emit('change');
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.data));
  }

  save() {
    try {
      writeAtomic(paths.settings(), JSON.stringify(this.data, null, 2));
    } catch (_) { /* диск недоступен — работаем из памяти */ }
  }
}

function clampPort(value, fallback) {
  const port = parseInt(value, 10);
  return port >= 1 && port <= 65535 ? port : fallback;
}

module.exports = { AppSettings };
