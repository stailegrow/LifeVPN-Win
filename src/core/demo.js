'use strict';

const models = require('./models');

/**
 * Демо-режим для скриншотов и презентаций: запуск с флагом `--demo`.
 * Перенос DemoMode.swift.
 *
 * Вместо настоящих подписок — выдуманная, вместо замеров — правдоподобные
 * цифры, подключение и замер скорости только изображаются. Данные пишутся
 * во временную папку, в сеть приложение не ходит, системный прокси не
 * трогает — настоящие данные и настройки остаются как были.
 */

const isOn = () => process.argv.includes('--demo');

const NODES = [
  { name: '🇳🇱 Amsterdam', host: 'nl.example.com', transport: 'tcp', latency: 38 },
  { name: '🇩🇪 Frankfurt', host: 'de.example.com', transport: 'xhttp', latency: 44 },
  { name: '🇫🇮 Helsinki', host: 'fi.example.com', transport: 'tcp', latency: 51 },
  { name: '🇸🇪 Stockholm', host: 'se.example.com', transport: 'xhttp', latency: 57 },
  { name: '🇬🇧 London', host: 'uk.example.com', transport: 'tcp', latency: 63 },
  { name: '🇺🇸 New York', host: 'us.example.com', transport: 'xhttp', latency: 112 }
];

const WOBBLE = [0, 2, -1, 3, 1, -2, 0, 4, -1, 1, 2, -3];

function latency(server, step) {
  const node = NODES.find((n) => n.name === server.name);
  const base = node ? node.latency : 60;
  const seed = Array.from(server.name).reduce((a, ch) => a + ch.codePointAt(0), 0) % 7;
  return base + WOBBLE[(step + seed) % WOBBLE.length];
}

const SAMPLE_LOG = [
  ['www.youtube.com', '443', 'proxy'], ['yandex.ru', '443', 'direct'],
  ['ads.example.net', '443', 'block'], ['github.com', '443', 'proxy'],
  ['mail.example.com', '443', 'direct'], ['www.google.com', '443', 'proxy'],
  ['vk.com', '443', 'direct'], ['api.telegram.org', '443', 'proxy']
];

function install({ store, connection, settings }) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Настройки: нейтральная маршрутизация с выдуманными доменами, на диск
  // ничего не пишется.
  settings.save = () => {};
  const routing = models.preset('bypass-ru').make();
  routing.directDomains = ['mail.example.com', 'wiki.example.com'];
  settings.data.routing = models.makeRoutingConfig(routing);

  // Подписка и узлы.
  const subscription = models.makeSubscription({
    name: 'Life Premium',
    url: 'https://example.com/sub',
    lastUpdated: new Date(Date.now() - 120000).toISOString(),
    usedBytes: 52184000000,
    expiresAt: new Date(Date.now() + 86400000 * 92).toISOString()
  });
  store.subscriptions = [subscription];
  store.servers = NODES.map((node, index) => models.makeProxyConfig({
    name: node.name,
    address: node.host,
    port: 443,
    userID: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    security: 'reality',
    transport: node.transport,
    sni: 'www.example.com',
    publicKey: 'DEMO-PUBLIC-KEY',
    subscriptionID: subscription.id
  }));
  store.selectedID = store.servers[0].id;
  store.pings = {};
  store.pingHistory = {};
  let step = 0;
  const historyLength = store.constructor.historyLength || 24;
  for (; step < historyLength; step++) {
    for (const server of store.servers) store.record(server.id, latency(server, step));
  }

  store.save = () => {};
  store.refresh = async () => true;
  store.refreshDue = async () => {};
  store.startAutoRefresh = () => {};
  store.prepareOnLaunch = async () => {};
  store.pingAll = async () => {
    step += 1;
    for (const server of store.servers) store.record(server.id, latency(server, step));
    store.changed();
  };
  store.ping = async (id) => {
    const server = store.servers.find((s) => s.id === id);
    if (server) store.record(id, latency(server, step));
    store.changed();
  };

  // Подключение и скорость только изображаются.
  connection.recoveredFromCrash = false;
  connection.connect = async (server) => {
    connection.state = { kind: 'connecting' };
    connection.activeServer = server;
    connection.changed();
    await sleep(1200);
    connection.connectedSince = new Date(Date.now() - 2537000).toISOString();
    connection.externalIP = '203.0.113.24';
    connection.state = { kind: 'connected' };
    fillLog(connection.routingLog);
    connection.changed();
  };
  connection.disconnect = async () => {
    connection.state = { kind: 'disconnected' };
    connection.activeServer = null;
    connection.connectedSince = null;
    connection.externalIP = null;
    connection.changed();
  };
  connection.measureSpeed = async () => {
    connection.isMeasuringSpeed = true;
    connection.changed();
    await sleep(1500);
    connection.speed = {
      mbps: 487.3, bytes: 243650000, seconds: 4.0,
      throughProxy: connection.isConnected, source: 'Cloudflare',
      measuredAt: new Date().toISOString()
    };
    connection.speedError = null;
    connection.isMeasuringSpeed = false;
    connection.changed();
  };
  connection.shutdownSynchronously = () => {};
}

function fillLog(log) {
  log.entries = [];
  log.counts = {};
  const fresh = SAMPLE_LOG.map(([host, port, route], index) => ({
    id: index + 1,
    time: `12:${String(30 + Math.floor(index / 3)).padStart(2, '0')}:${String((index * 7) % 60).padStart(2, '0')}`,
    network: 'TCP',
    host,
    port,
    inbound: 'socks',
    route,
    byDefault: route === 'proxy'
  }));
  log.append(fresh);
}

module.exports = { isOn, install, NODES, latency };
