'use strict';
const { EventEmitter } = require('events');
const http = require('http');
const net = require('net');

// Node HTTP connects directly to loopback, bypassing the system VPN proxy.
function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(null));
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}
class SessionTraffic extends EventEmitter {
  constructor() { super(); this.uplink = 0; this.downlink = 0; this.port = null; this.generation = 0; this.timer = null; this.request = null; this.available = false; }
  reset(port) {
    this.stop(); this.port = port; this.uplink = 0; this.downlink = 0; this.available = false;
  }
  start() {
    this.stop();
    if (!this.port) return;
    const generation = this.generation;
    const loop = async () => {
      await this.poll(generation);
      if (generation === this.generation) this.timer = setTimeout(loop, 2000);
    };
    loop();
  }
  stop() {
    this.generation++;
    clearTimeout(this.timer); this.timer = null;
    if (this.request) this.request.destroy();
    this.request = null;
  }
  poll(generation = this.generation) {
    if (!this.port) return Promise.resolve();
    return new Promise((resolve) => {
      const request = http.get({ hostname: '127.0.0.1', port: this.port, path: '/debug/vars', timeout: 2000, agent: false }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('error', resolve);
        response.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) request.destroy(); });
        response.on('end', () => {
          if (generation !== this.generation || response.statusCode !== 200) return resolve();
          try {
            const proxy = JSON.parse(body).stats.outbound.proxy;
            const up = Number(proxy.uplink), down = Number(proxy.downlink);
            if (!Number.isSafeInteger(up) || !Number.isSafeInteger(down) || up < 0 || down < 0) return resolve();
            this.uplink = Math.max(this.uplink, up); this.downlink = Math.max(this.downlink, down); this.available = true;
            this.emit('change');
          } catch (_) { /* Preserve the last valid reading on malformed data. */ }
          resolve();
        });
      });
      this.request = request;
      request.on('timeout', () => request.destroy());
      request.on('error', resolve);
      request.on('close', () => { if (this.request === request) this.request = null; resolve(); });
    });
  }
  snapshot() { return { uplink:this.uplink, downlink:this.downlink, total:this.uplink+this.downlink, available:this.available }; }
}
module.exports = { SessionTraffic, freePort };
