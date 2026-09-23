'use strict';

const models = require('./models');

/**
 * Сборка config.json для Xray-core.
 *
 * Строим дерево объектов: конфиг Xray разнородный, а параметр `extra` у
 * XHTTP вообще произвольный JSON, который надо влить в настройки транспорта.
 */

function defaultOptions(overrides = {}) {
  return {
    socksPort: 10808,
    httpPort: 10809,
    logLevel: 'warning',
    logPath: null,
    routing: models.PRESETS.find((p) => p.id === 'global').make(),
    ...overrides
  };
}

/** Сериализация с отсортированными ключами — как JSONSerialization .sortedKeys. */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

function makeJSON(config, options = {}) {
  return JSON.stringify(sortKeys(makeTree(config, defaultOptions(options))), null, 2);
}

function makeTree(config, options = {}) {
  const opts = defaultOptions(options);
  const log = { loglevel: opts.logLevel };
  if (opts.logPath) log.error = opts.logPath;

  const root = {
    log,
    inbounds: inbounds(opts),
    outbounds: [outbound(config), directOutbound(), blockOutbound()],
    routing: routing(opts.routing)
  };
  const dnsBlock = dns(opts.routing);
  if (dnsBlock) root.dns = dnsBlock;
  return root;
}

function inbounds(options) {
  const sniffing = () => ({
    enabled: true,
    destOverride: ['http', 'tls', 'quic'],
    // Без этого доменные правила роутинга не увидят имя хоста, когда
    // приложение уже само разрешило его в IP.
    routeOnly: false
  });
  return [
    {
      tag: 'socks',
      listen: '127.0.0.1',
      port: options.socksPort,
      protocol: 'socks',
      settings: { auth: 'noauth', udp: true },
      sniffing: sniffing()
    },
    {
      tag: 'http',
      listen: '127.0.0.1',
      port: options.httpPort,
      protocol: 'http',
      settings: {},
      sniffing: sniffing()
    }
  ];
}

function directOutbound() {
  return { tag: 'direct', protocol: 'freedom', settings: { domainStrategy: 'UseIP' } };
}

function blockOutbound() {
  return { tag: 'block', protocol: 'blackhole', settings: {} };
}

/**
 * Локальные адреса идут мимо туннеля. Диапазоны перечислены явно, а не
 * через `geoip:private`: за именами geoip-групп ядро лезет в geoip.dat, и
 * без базы падает при старте.
 */
const PRIVATE_RANGES = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '100.64.0.0/10',
  '::1/128',
  'fc00::/7',
  'fe80::/10'
];

/**
 * Порядок правил — block, затем proxy, затем direct. Первое совпавшее
 * побеждает; всё, что не совпало ни с чем, уходит в первый outbound —
 * то есть в туннель.
 */
function routing(config) {
  const rules = [];

  // QUIC мимо туннеля не ходит: канал всегда поверх TCP, а ретрансляция
  // UDP-443 через него ненадёжна. Блокируем явно и первым правилом.
  rules.push({ type: 'field', network: 'udp', port: '443', outboundTag: 'block' });

  if (config.bypassLAN) {
    rules.push({ type: 'field', ip: PRIVATE_RANGES.slice(), outboundTag: 'direct' });
  }

  append(rules, config.blockSites, config.blockIP, 'block');
  // Свои домены — раньше правил «через туннель»: список задан руками.
  append(rules, models.effectiveDirectDomains(config), [], 'direct');
  append(rules, config.proxySites, config.proxyIP, 'proxy');
  append(rules, config.directSites, config.directIP, 'direct');

  return { domainStrategy: config.domainStrategy, rules };
}

function append(rules, domains, ips, tag) {
  if (domains && domains.length) rules.push({ type: 'field', domain: domains.slice(), outboundTag: tag });
  if (ips && ips.length) rules.push({ type: 'field', ip: ips.slice(), outboundTag: tag });
}

/**
 * Домены из списка «напрямую» резолвим местным DNS, остальные — удалённым.
 */
function dns(config) {
  const localDomains = models.effectiveDirectDomains(config);
  if (!config.remoteDNS && !config.domesticDNS && localDomains.length === 0) return null;

  const servers = [];
  // Свои домены резолвит система: внутреннее имя знает только
  // корпоративный резолвер.
  if (localDomains.length) {
    servers.push({ address: 'localhost', domains: localDomains, skipFallback: true });
  }
  if (config.domesticDNS && config.directSites.length) {
    servers.push({ address: config.domesticDNS, domains: config.directSites.slice(), skipFallback: true });
  }
  if (config.remoteDNS) servers.push(config.remoteDNS);
  if (servers.length === 0) return null;

  const block = { servers };
  if (config.dnsHosts && Object.keys(config.dnsHosts).length) block.hosts = { ...config.dnsHosts };
  return block;
}

function outbound(config) {
  const user = { id: config.userID, encryption: config.encryption };
  // Vision работает только поверх TCP; на XHTTP его быть не должно.
  if (config.flow && config.transport === 'tcp') user.flow = config.flow;

  return {
    tag: 'proxy',
    protocol: config.kind,
    settings: { vnext: [{ address: config.address, port: config.port, users: [user] }] },
    streamSettings: streamSettings(config)
  };
}

function streamSettings(config) {
  const stream = {
    network: config.transport,
    security: config.security === 'none' ? 'none' : config.security
  };
  if (config.security === 'reality') stream.realitySettings = realitySettings(config);
  if (config.security === 'tls') stream.tlsSettings = tlsSettings(config);

  const key = models.transportSettingsKey(config.transport);
  if (key) stream[key] = transportSettings(config);
  return stream;
}

function realitySettings(config) {
  const reality = { show: false };
  if (config.sni) reality.serverName = config.sni;
  if (config.fingerprint) reality.fingerprint = config.fingerprint;
  if (config.publicKey) reality.publicKey = config.publicKey;
  if (config.shortID) reality.shortId = config.shortID;
  if (config.spiderX) reality.spiderX = config.spiderX;
  return reality;
}

function tlsSettings(config) {
  const tls = { allowInsecure: !!config.allowInsecure };
  if (config.sni) tls.serverName = config.sni;
  if (config.fingerprint) tls.fingerprint = config.fingerprint;
  if (config.alpn && config.alpn.length) tls.alpn = config.alpn.slice();
  return tls;
}

function transportSettings(config) {
  switch (config.transport) {
    case 'ws':
    case 'httpupgrade': {
      const settings = {};
      if (config.path) settings.path = config.path;
      if (config.host) settings.host = config.host;
      return settings;
    }
    case 'grpc': {
      const settings = {};
      const name = config.serviceName || config.path;
      if (name) settings.serviceName = name;
      return settings;
    }
    case 'http': {
      const settings = {};
      if (config.path) settings.path = config.path;
      if (config.host) settings.host = [config.host];
      return settings;
    }
    case 'xhttp':
      return xhttpSettings(config);
    default:
      return {};
  }
}

/**
 * XHTTP собирается в два слоя: сначала произвольный JSON из `extra`, затем
 * поверх кладутся явные параметры ссылки.
 */
function xhttpSettings(config) {
  let settings = {};
  if (config.xhttpExtraJSON) {
    try {
      const parsed = JSON.parse(config.xhttpExtraJSON);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) settings = parsed;
    } catch (_) { /* битый extra игнорируем */ }
  }
  if (config.path) settings.path = config.path;
  if (config.host) settings.host = config.host;
  if (config.xhttpMode) settings.mode = config.xhttpMode;
  if (config.xPaddingBytes) settings.xPaddingBytes = config.xPaddingBytes;
  return settings;
}

module.exports = {
  defaultOptions,
  makeJSON,
  makeTree,
  routing,
  dns,
  outbound,
  streamSettings,
  xhttpSettings,
  PRIVATE_RANGES
};
