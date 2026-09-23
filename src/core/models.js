'use strict';

const crypto = require('crypto');
const { t } = require('./l10n');
const { formatBytes, formatUpdated, formatDate } = require('./format');

// ---------------------------------------------------------------------------
// Сервер
// ---------------------------------------------------------------------------

const TRANSPORTS = ['tcp', 'ws', 'grpc', 'http', 'xhttp', 'httpupgrade'];
const SECURITIES = ['none', 'tls', 'reality'];

/** Имя ключа настроек транспорта в конфиге Xray. */
function transportSettingsKey(transport) {
  switch (transport) {
    case 'ws': return 'wsSettings';
    case 'grpc': return 'grpcSettings';
    case 'http': return 'httpSettings';
    case 'xhttp': return 'xhttpSettings';
    case 'httpupgrade': return 'httpupgradeSettings';
    default: return null;
  }
}

/** Один сервер. Плоская структура — так проще сериализовать и сравнивать. */
function makeProxyConfig(fields = {}) {
  return {
    id: crypto.randomUUID().toUpperCase(),
    name: '',
    kind: 'vless',
    address: '',
    port: 443,
    userID: '',
    encryption: 'none',
    flow: null,
    security: 'none',
    transport: 'tcp',
    sni: null,
    fingerprint: null,
    publicKey: null,
    shortID: null,
    spiderX: null,
    alpn: [],
    allowInsecure: false,
    path: null,
    host: null,
    serviceName: null,
    headerType: null,
    xhttpMode: null,
    xhttpExtraJSON: null,
    xPaddingBytes: null,
    sourceLink: null,
    subscriptionID: null,
    ...fields
  };
}

/**
 * Ключ, по которому сервер узнаётся при обновлении подписки. Имя в него
 * не входит намеренно: переименование на панели не должно выглядеть как
 * удаление старого сервера и появление нового.
 */
function identityKey(server) {
  return `${server.kind}|${server.address}|${server.port}|${server.userID}|${server.transport}|${server.path || ''}`;
}

function displayName(server) {
  return server.name ? server.name : `${server.address}:${server.port}`;
}

/** Короткое описание транспорта: "reality · xhttp". */
function summary(server) {
  const parts = [];
  if (server.security !== 'none') parts.push(server.security);
  parts.push(server.transport);
  if (server.flow) parts.push(server.flow);
  if (server.transport === 'xhttp' && server.xhttpMode) parts.push(server.xhttpMode);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Подписка
// ---------------------------------------------------------------------------

function makeSubscription(fields = {}) {
  return {
    id: crypto.randomUUID().toUpperCase(),
    name: '',
    url: '',
    /** 0 — обновлять только вручную. */
    updateIntervalHours: 12,
    lastUpdated: null,
    lastError: null,
    announce: null,
    usedBytes: null,
    totalBytes: null,
    expiresAt: null,
    rawUserInfo: null,
    ...fields
  };
}

function subscriptionDisplayName(subscription) {
  if (subscription.name) return subscription.name;
  try {
    const host = new URL(subscription.url).hostname;
    if (host) return host;
  } catch (_) { /* не ссылка */ }
  return t('Подписка', 'Subscription');
}

function isExpired(subscription) {
  if (!subscription.expiresAt) return false;
  return new Date(subscription.expiresAt).getTime() < Date.now();
}

/**
 * Строка вида «12,4 ГБ из 100 ГБ» либо «12,4 ГБ из ∞».
 * total = 0 у панелей означает безлимит, а не нулевой лимит.
 */
function trafficSummary(subscription) {
  if (subscription.usedBytes == null) return null;
  const used = formatBytes(subscription.usedBytes);
  if (!subscription.totalBytes || subscription.totalBytes <= 0) return t(`${used} из ∞`, `${used} of ∞`);
  const total = formatBytes(subscription.totalBytes);
  return t(`${used} из ${total}`, `${used} of ${total}`);
}

function expirySummary(subscription) {
  if (!subscription.expiresAt) return null;
  return formatDate(subscription.expiresAt);
}

/** Пора ли обновлять по расписанию. */
function isDue(subscription, now = Date.now()) {
  if (!(subscription.updateIntervalHours > 0)) return false;
  if (!subscription.lastUpdated) return true;
  return (now - new Date(subscription.lastUpdated).getTime()) >= subscription.updateIntervalHours * 3600 * 1000;
}

// ---------------------------------------------------------------------------
// Маршрутизация
// ---------------------------------------------------------------------------

/** Сборка hydraponique — та же, что используют клиенты с обходом РФ. */
const DEFAULT_GEOSITE_URL =
  'https://cdn.jsdelivr.net/gh/hydraponique/roscomvpn-geosite@202604152235/release/geosite.dat';
const DEFAULT_GEOIP_URL =
  'https://cdn.jsdelivr.net/gh/hydraponique/roscomvpn-geoip@202604160537/release/geoip.dat';

/** Имена без точки (внутренние хосты вроде `mail`, `wiki`) и зона .local. */
const LOCAL_DOMAIN_PATTERNS = ['regexp:^[^.]+$', 'domain:local'];

function makeRoutingConfig(fields = {}) {
  return {
    presetID: 'global',
    directSites: [],
    directIP: [],
    proxySites: [],
    proxyIP: [],
    blockSites: [],
    blockIP: [],
    /**
     * Локальная сеть мимо туннеля: принтеры, NAS, роутер, соседние машины.
     */
    bypassLAN: true,
    /** Домены, которые всегда идут мимо туннеля и резолвятся системным DNS. */
    directDomains: [],
    /**
     * IPIfNonMatch — если по домену правило не нашлось, домен резолвится и
     * правила прогоняются ещё раз уже по IP.
     */
    domainStrategy: 'IPIfNonMatch',
    /** DNS для доменов из списка «напрямую» — свой, местный. */
    domesticDNS: 'https://77.88.8.8/dns-query',
    /** Для всего остального — через туннель, иначе провайдер видит запросы. */
    remoteDNS: 'https://8.8.8.8/dns-query',
    dnsHosts: {},
    geositeURL: '',
    geoipURL: '',
    ...fields
  };
}

function effectiveDirectDomains(routing) {
  const manual = (routing.directDomains || []).map((d) => String(d).trim()).filter(Boolean);
  return routing.bypassLAN ? manual.concat(LOCAL_DOMAIN_PATTERNS) : manual;
}

/** Правила вида `geosite:` и `geoip:` ядро читает из файлов. */
function needsGeoAssets(routing) {
  const all = [].concat(routing.directSites, routing.proxySites, routing.blockSites,
    routing.directIP, routing.proxyIP, routing.blockIP);
  return all.some((value) => value.startsWith('geosite:') || value.startsWith('geoip:'));
}

const PRESETS = [
  {
    id: 'bypass-ru',
    titleRU: 'Обход РФ',
    titleEN: 'Bypass RU',
    subtitleRU: 'Российские сайты и сервисы идут мимо VPN, остальное — через',
    subtitleEN: 'Russian sites and services go around the VPN, the rest goes through it',
    make() {
      return makeRoutingConfig({
        presetID: 'bypass-ru',
        directSites: [
          'geosite:private',
          'geosite:category-ru',
          'geosite:whitelist',
          'geosite:microsoft',
          'geosite:apple',
          'geosite:epicgames',
          'geosite:riot',
          'geosite:escapefromtarkov',
          'geosite:steam',
          'geosite:twitch',
          'geosite:pinterest',
          'geosite:faceit'
        ],
        directIP: ['geoip:private', 'geoip:direct'],
        proxySites: [
          'geosite:google-play',
          'geosite:github',
          'geosite:twitch-ads',
          'geosite:youtube',
          'geosite:telegram'
        ],
        blockSites: [
          'geosite:win-spy',
          'geosite:torrent',
          'geosite:category-ads'
        ],
        dnsHosts: {
          'lkfl2.nalog.ru': '213.24.64.175',
          'lknpd.nalog.ru': '213.24.64.181'
        },
        geositeURL: DEFAULT_GEOSITE_URL,
        geoipURL: DEFAULT_GEOIP_URL
      });
    }
  },
  {
    id: 'global',
    titleRU: 'Глобально',
    titleEN: 'Global',
    subtitleRU: 'Весь трафик через VPN, мимо идут только локальные адреса',
    subtitleEN: 'All traffic through the VPN; only local addresses go around it',
    make() {
      return makeRoutingConfig({
        presetID: 'global',
        domainStrategy: 'AsIs',
        domesticDNS: '',
        remoteDNS: ''
      });
    }
  }
];

function preset(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

module.exports = {
  TRANSPORTS,
  SECURITIES,
  transportSettingsKey,
  makeProxyConfig,
  identityKey,
  displayName,
  summary,
  makeSubscription,
  subscriptionDisplayName,
  isExpired,
  trafficSummary,
  expirySummary,
  formatUpdated,
  isDue,
  DEFAULT_GEOSITE_URL,
  DEFAULT_GEOIP_URL,
  LOCAL_DOMAIN_PATTERNS,
  makeRoutingConfig,
  effectiveDirectDomains,
  needsGeoAssets,
  PRESETS,
  preset
};
