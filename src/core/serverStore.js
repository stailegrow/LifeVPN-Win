'use strict';

const EventEmitter = require('events');
const paths = require('./paths');
const { t } = require('./l10n');
const models = require('./models');
const LinkParser = require('./linkParser');
const Ping = require('./pingTester');
const { merge } = require('./merge');
const { fetchSubscription } = require('./subscriptionFetcher');
const { writeAtomic, readJSON } = require('./atomic');

const HISTORY_LENGTH = 24;

/** Серверы и подписки на диске. */
class ServerStore extends EventEmitter {
  constructor({ version = 'dev' } = {}) {
    super();
    this.version = version;
    this.servers = [];
    this.subscriptions = [];
    this.selectedID = null;
    this.refreshingIDs = new Set();
    /** Задержка в мс; null — сервер не ответил; нет ключа — замера не было. */
    this.pings = {};
    /** История замеров для графиков. Самое свежее — последнее. */
    this.pingHistory = {};
    this.isPinging = false;
    this.autoRefreshTimer = null;
    this.autoPingActive = false;
    this.autoPingTimer = null;
    this.load();
  }

  changed() {
    this.emit('change');
  }

  /** Проверяет расписание раз в четверть часа; решает `isDue` у подписки. */
  startAutoRefresh() {
    if (this.autoRefreshTimer) return;
    const tick = async () => {
      await this.refreshDue();
    };
    this.autoRefreshTimer = setInterval(tick, 900 * 1000);
  }

  get selected() {
    return this.servers.find((s) => s.id === this.selectedID) || null;
  }

  serversIn(subscriptionID) {
    return this.servers.filter((s) => (s.subscriptionID || null) === (subscriptionID || null));
  }

  subscriptionFor(server) {
    if (!server || !server.subscriptionID) return null;
    return this.subscriptions.find((s) => s.id === server.subscriptionID) || null;
  }

  select(id) {
    if (!this.servers.some((s) => s.id === id)) return;
    this.selectedID = id;
    this.save();
    this.changed();
  }

  // ---- Ручное добавление ------------------------------------------------

  add(incoming) {
    let added = 0;
    const existing = new Set(this.servers.map(models.identityKey));
    for (const config of incoming) {
      const key = models.identityKey(config);
      if (existing.has(key)) continue;
      existing.add(key);
      this.servers.push(config);
      added += 1;
    }
    if (!this.selectedID && this.servers.length) this.selectedID = this.servers[0].id;
    if (added > 0) this.save();
    this.changed();
    return added;
  }

  remove(ids) {
    const set = new Set(ids);
    this.servers = this.servers.filter((s) => !set.has(s.id));
    if (this.selectedID && set.has(this.selectedID)) {
      this.selectedID = this.servers.length ? this.servers[0].id : null;
    }
    this.save();
    this.changed();
  }

  // ---- Быстрое добавление -----------------------------------------------

  /**
   * Разбирает произвольный текст и делает то, что он означает: ссылка на
   * подписку — добавляет подписку, ссылки узлов — добавляет узлы.
   */
  async quickAdd(raw) {
    const value = String(raw || '').trim();
    if (!value) return failure(t('Пусто — нечего добавлять.', 'Empty — nothing to add.'));

    const lowered = value.toLowerCase();
    if (lowered.startsWith('http://') || lowered.startsWith('https://')) {
      const subscription = this.addSubscription(value);
      const ok = await this.refresh(subscription.id);
      const stored = this.subscriptions.find((s) => s.id === subscription.id);
      if (!ok || !stored) {
        const message = (stored && stored.lastError) || t('Не удалось загрузить подписку.', 'Could not load the subscription.');
        this.removeSubscription(subscription.id);
        return failure(message);
      }
      const name = models.subscriptionDisplayName(stored);
      const count = this.serversIn(stored.id).length;
      return success(t(`Подписка «${name}» — узлов: ${count}`, `Subscription “${name}” — ${count} nodes`));
    }

    if (value.includes('://')) {
      const parsed = LinkParser.parseMany(value);
      if (!parsed.configs.length) {
        return failure(parsed.errors[0] || t('Ссылки не распознались.', 'The links were not recognised.'));
      }
      const count = this.add(parsed.configs);
      return success(count === 0
        ? t('Новых узлов нет — всё это уже добавлено.', 'No new nodes — all of this is already added.')
        : t(`Добавлено узлов: ${count}`, `Nodes added: ${count}`));
    }

    return failure(t('Это не похоже ни на ссылку подписки, ни на ссылку узла.', 'This looks like neither a subscription link nor a node link.'));
  }

  // ---- Подписки ---------------------------------------------------------

  addSubscription(url, name = '') {
    const subscription = models.makeSubscription({ url: String(url).trim(), name: String(name).trim() });
    this.subscriptions.push(subscription);
    this.save();
    this.changed();
    return subscription;
  }

  /** Удаляет подписку вместе с её серверами — иначе остаются висяки. */
  removeSubscription(id) {
    this.subscriptions = this.subscriptions.filter((s) => s.id !== id);
    const orphans = new Set(this.servers.filter((s) => s.subscriptionID === id).map((s) => s.id));
    this.servers = this.servers.filter((s) => !orphans.has(s.id));
    if (this.selectedID && orphans.has(this.selectedID)) {
      this.selectedID = this.servers.length ? this.servers[0].id : null;
    }
    this.save();
    this.changed();
  }

  renameSubscription(id, name) {
    const subscription = this.subscriptions.find((s) => s.id === id);
    if (!subscription) return;
    subscription.name = String(name || '').trim();
    this.save();
    this.changed();
  }

  async refresh(id) {
    if (this.refreshingIDs.has(id)) return false;
    const stored = this.subscriptions.find((s) => s.id === id);
    if (!stored) return false;
    this.refreshingIDs.add(id);
    this.changed();

    try {
      const payload = await fetchSubscription(stored.url, { version: this.version });
      const parsed = LinkParser.parseMany(payload.links.join('\n')).configs;
      const result = merge(this.servers, parsed, stored.id);
      this.servers = result.servers;

      if (!stored.name && payload.title) stored.name = payload.title;
      stored.announce = payload.announce;
      stored.rawUserInfo = payload.rawUserInfo;
      stored.usedBytes = payload.userInfo.used;
      stored.totalBytes = payload.userInfo.total;
      stored.expiresAt = payload.userInfo.expiresAt;
      if (payload.updateIntervalHours && stored.updateIntervalHours > 0) {
        stored.updateIntervalHours = payload.updateIntervalHours;
      }
      stored.lastUpdated = new Date().toISOString();
      stored.lastError = null;

      if (!this.selectedID || !this.servers.some((s) => s.id === this.selectedID)) {
        this.selectedID = this.servers.length ? this.servers[0].id : null;
      }
    } catch (error) {
      stored.lastError = error.message;
    } finally {
      this.refreshingIDs.delete(id);
    }

    this.save();
    this.changed();
    return stored.lastError == null;
  }

  /** Обновляет всё, что просрочено по расписанию. `force` — всё подряд. */
  async refreshDue(force = false) {
    for (const subscription of this.subscriptions.slice()) {
      if (force || models.isDue(subscription)) await this.refresh(subscription.id);
    }
  }

  /**
   * Сначала подписки — чтобы задержку мерить уже по актуальному списку, —
   * и только потом замер.
   */
  async prepareOnLaunch(measureLatency = true) {
    await this.refreshDue(true);
    if (measureLatency) await this.pingAll();
  }

  // ---- Пинги ------------------------------------------------------------

  /**
   * Задержка меряется напрямую от этой машины до узла, а не через туннель:
   * цифра отвечает на вопрос «как далеко отсюда до этого узла».
   *
   * `light` — фоновый опрос: одно подключение на узел вместо четырёх.
   */
  async pingAll(light = false) {
    if (this.isPinging || !this.servers.length) return;
    // Фоновый опрос не зажигает индикатор занятости.
    const showsBusy = !light;
    if (showsBusy) {
      this.isPinging = true;
      this.changed();
    }
    try {
      const batch = 4;
      const list = this.servers.slice();
      for (let i = 0; i < list.length; i += batch) {
        const slice = list.slice(i, i + batch);
        const values = await Promise.all(slice.map((server) => (light
          ? Ping.latency(server.address, server.port, { samples: 1, warmup: false })
          : Ping.latency(server.address, server.port))));
        slice.forEach((server, index) => this.record(server.id, values[index]));
        this.changed();
      }
      this.save();
    } finally {
      if (showsBusy) {
        this.isPinging = false;
        this.changed();
      }
    }
  }

  /** Фоновый опрос, пока открыт экран со списком узлов. */
  startAutoPing(intervalMs = 10000) {
    if (this.autoPingActive) return;
    this.autoPingActive = true;
    const loop = async () => {
      if (!this.autoPingActive) return;
      if (this.servers.length) await this.pingAll(true);
      if (this.autoPingActive) this.autoPingTimer = setTimeout(loop, intervalMs);
    };
    loop();
  }

  stopAutoPing() {
    this.autoPingActive = false;
    clearTimeout(this.autoPingTimer);
    this.autoPingTimer = null;
  }

  async ping(id) {
    const server = this.servers.find((s) => s.id === id);
    if (!server) return;
    const value = await Ping.latency(server.address, server.port);
    this.record(server.id, value);
    this.save();
    this.changed();
  }

  record(id, value) {
    this.pings[id] = value;
    if (value == null) return;
    const history = (this.pingHistory[id] || []).concat([value]);
    this.pingHistory[id] = history.slice(-HISTORY_LENGTH);
  }

  // ---- Диск -------------------------------------------------------------

  save() {
    const payload = {
      version: 2,
      servers: this.servers,
      subscriptions: this.subscriptions,
      selectedID: this.selectedID,
      pingHistory: this.pingHistory
    };
    try {
      writeAtomic(paths.servers(), JSON.stringify(payload));
    } catch (_) { /* диск недоступен — работаем из памяти */ }
  }

  load() {
    const payload = readJSON(paths.servers());
    if (!payload) return;
    this.servers = (payload.servers || []).map((s) => models.makeProxyConfig(s));
    this.subscriptions = (payload.subscriptions || []).map((s) => models.makeSubscription(s));
    this.selectedID = payload.selectedID || (this.servers[0] && this.servers[0].id) || null;
    this.pingHistory = payload.pingHistory || {};
  }

  snapshot() {
    return {
      servers: this.servers,
      subscriptions: this.subscriptions,
      selectedID: this.selectedID,
      refreshingIDs: Array.from(this.refreshingIDs),
      pings: this.pings,
      pingHistory: this.pingHistory,
      isPinging: this.isPinging,
      historyLength: HISTORY_LENGTH
    };
  }
}

const success = (message) => ({ message, isFailure: false });
const failure = (message) => ({ message, isFailure: true });

module.exports = { ServerStore, HISTORY_LENGTH };
