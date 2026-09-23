'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const paths = require('./paths');
const { t } = require('./l10n');
const models = require('./models');
const Builder = require('./configBuilder');
const GeoAssets = require('./geoAssets');
const IPChecker = require('./ipChecker');
const SpeedTester = require('./speedTester');
const SystemProxy = require('./systemProxy');
const { XrayProcess, readLog } = require('./xray');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Стейт-машина подключения.
 *
 * Интерфейс знает только про `state`, `activeServer` и `externalIP`. Как
 * именно заворачивается трафик — системный прокси — прячется здесь.
 */
class ConnectionManager extends EventEmitter {
  constructor(settings) {
    super();
    this.settings = settings;
    this.state = { kind: 'disconnected' };
    this.activeServer = null;
    this.externalIP = null;
    this.connectedSince = null;
    this.recoveredFromCrash = false;
    this.routingNotice = null;
    this.isPreparingRules = false;
    this.speed = null;
    this.speedError = null;
    this.isMeasuringSpeed = false;
    this.socksPort = 10808;
    this.httpPort = 10809;
    this.proxyApplied = false;

    this.core = new XrayProcess();
    this.core.onUnexpectedExit = (code) => this.handleCoreCrash(code);

    // Прошлый запуск мог оставить системный прокси включённым.
    try {
      this.recoveredFromCrash = SystemProxy.cleanUpAfterCrash();
    } catch (_) {
      this.recoveredFromCrash = false;
    }
  }

  get isConnected() { return this.state.kind === 'connected'; }
  get isBusy() { return this.state.kind === 'connecting'; }

  changed() {
    this.emit('change');
  }

  async connect(server) {
    if (this.isConnected || this.isBusy) await this.disconnect();

    this.socksPort = this.settings.get('socksPort');
    this.httpPort = this.settings.get('httpPort');

    this.state = { kind: 'connecting' };
    this.activeServer = server;
    this.externalIP = null;
    this.routingNotice = null;
    this.speed = null;
    this.speedError = null;
    this.changed();

    const routing = await this.resolvedRouting();

    try {
      const json = Builder.makeJSON(server, {
        socksPort: this.socksPort,
        httpPort: this.httpPort,
        logLevel: 'warning',
        logPath: paths.coreLog(),
        routing
      });
      fs.writeFileSync(paths.generatedConfig(), json);

      this.core.start(paths.generatedConfig(), paths.coreLog());

      // Ядро с битым конфигом умирает почти мгновенно — ловим это здесь,
      // чтобы не успеть перевести систему на неработающий прокси.
      await sleep(700);
      if (!this.core.isRunning) {
        throw exitedImmediately(1, readLog(paths.coreLog()));
      }

      const ip = await IPChecker.externalIP(this.httpPort);
      if (!ip) throw noTunnel(readLog(paths.coreLog()));

      SystemProxy.enable(this.socksPort, this.httpPort);
      this.proxyApplied = true;

      this.externalIP = ip;
      this.connectedSince = new Date().toISOString();
      this.state = { kind: 'connected' };
      this.changed();
    } catch (error) {
      this.tearDown();
      this.connectedSince = null;
      this.state = { kind: 'failed', message: error.message };
      this.changed();
    }
  }

  async disconnect() {
    this.tearDown();
    this.state = { kind: 'disconnected' };
    this.externalIP = null;
    this.connectedSince = null;
    this.speed = null;
    this.speedError = null;
    this.changed();
  }

  async toggle(server) {
    if (this.isConnected && this.activeServer && this.activeServer.id === server.id) {
      await this.disconnect();
    } else {
      await this.connect(server);
    }
  }

  /** При выходе: системный прокси обязан быть снят. */
  shutdownSynchronously() {
    if (this.proxyApplied) {
      SystemProxy.disable();
      this.proxyApplied = false;
    }
    this.core.stop();
  }

  /**
   * Меряем через прокси, когда туннель поднят, и напрямую, когда нет.
   */
  async measureSpeed() {
    if (this.isMeasuringSpeed) return;
    this.isMeasuringSpeed = true;
    this.speedError = null;
    this.changed();
    try {
      this.speed = await SpeedTester.measure(this.isConnected ? this.httpPort : null);
    } catch (error) {
      this.speed = null;
      this.speedError = error.message;
    } finally {
      this.isMeasuringSpeed = false;
      this.changed();
    }
  }

  /**
   * Пресет с обходом РФ опирается на geo-базы. Если их нет, пробуем
   * скачать; не вышло — честно откатываемся на глобальный режим.
   */
  async resolvedRouting() {
    const requested = this.settings.routing;
    if (!models.needsGeoAssets(requested) || GeoAssets.isReady()) return requested;

    this.isPreparingRules = true;
    this.changed();
    try {
      await GeoAssets.download(requested);
      return requested;
    } catch (error) {
      this.routingNotice = t(`Базы правил не загрузились (${error.message}). `, `Routing databases failed to load (${error.message}). `)
        + t('Подключаюсь без обхода — весь трафик пойдёт через VPN.', 'Connecting without bypass — all traffic will go through the VPN.');
      const fallback = models.preset('global').make();
      fallback.bypassLAN = requested.bypassLAN;
      fallback.directDomains = requested.directDomains;
      return fallback;
    } finally {
      this.isPreparingRules = false;
      this.changed();
    }
  }

  tearDown() {
    if (this.proxyApplied) {
      try { SystemProxy.disable(); } catch (_) { /* сделали что могли */ }
      this.proxyApplied = false;
    }
    this.core.stop();
  }

  handleCoreCrash(code) {
    if (!this.isConnected && !this.isBusy) return;
    if (this.proxyApplied) {
      try { SystemProxy.disable(); } catch (_) { /* сделали что могли */ }
      this.proxyApplied = false;
    }
    // На этапе подключения ошибку покажет сам connect — там полнее лог.
    if (this.isBusy) return;
    const log = readLog(paths.coreLog(), 8);
    this.externalIP = null;
    this.connectedSince = null;
    this.state = {
      kind: 'failed',
      message: log
        ? t(`Ядро неожиданно завершилось (код ${code}):\n${log}`, `The core exited unexpectedly (code ${code}):\n${log}`)
        : t(`Ядро неожиданно завершилось (код ${code}).`, `The core exited unexpectedly (code ${code}).`)
    };
    this.changed();
  }

  snapshot() {
    return {
      state: this.state,
      activeServer: this.activeServer,
      externalIP: this.externalIP,
      connectedSince: this.connectedSince,
      recoveredFromCrash: this.recoveredFromCrash,
      routingNotice: this.routingNotice,
      isPreparingRules: this.isPreparingRules,
      speed: this.speed,
      speedError: this.speedError,
      isMeasuringSpeed: this.isMeasuringSpeed
    };
  }
}

function tail(log, lines = 6) {
  return log.split('\n').filter(Boolean).slice(-lines).join('\n');
}

function exitedImmediately(code, log) {
  const last = tail(log);
  return new Error(last
    ? t(`Ядро завершилось сразу с кодом ${code}:\n${last}`, `The core exited immediately with code ${code}:\n${last}`)
    : t(`Ядро завершилось сразу с кодом ${code}.`, `The core exited immediately with code ${code}.`));
}

function noTunnel(log) {
  const base = t('Ядро запустилось, но трафик через него не идёт — внешний IP получить не удалось.',
    'The core started, but no traffic goes through it — the external IP could not be obtained.');
  const last = tail(log);
  return new Error(last ? `${base}\n\n${last}` : base);
}

module.exports = { ConnectionManager };
