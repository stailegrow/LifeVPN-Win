'use strict';
// HTTPS-подписки: http не отправляется вовсе, HTTPS → HTTPS (CDN) проходит,
// HTTPS → HTTP блокируется ДО запроса, цепочка перенаправлений ограничена,
// слушатель внешнего AbortSignal снимается.
const assert = require('node:assert/strict');
const http = require('../src/core/http');
let requests = [];
let handler;
const session = {
  setProxy: async () => {},
  closeAllConnections: async () => {},
  fetch: async (url, options) => { requests.push(String(url)); return handler(String(url), options); }
};
http.init({ fromPartition: () => session });
(async () => {
  handler = () => new Response('ok');
  await assert.rejects(http.request('http://example.com/sub', { httpsOnly: true }));
  assert.equal(requests.length, 0, 'http не должен уходить в сеть');

  handler = (url) => url.endsWith('/sub')
    ? new Response('', { status: 302, headers: { location: 'https://cdn.example.net/final' } })
    : new Response('ok');
  let result = await http.request('https://example.com/sub', { httpsOnly: true });
  assert.equal(await result.response.text(), 'ok');
  result.done();
  assert.deepEqual(requests, ['https://example.com/sub', 'https://cdn.example.net/final']);

  requests = [];
  handler = () => new Response('', { status: 302, headers: { location: 'http://example.com/plain' } });
  await assert.rejects(http.request('https://example.com/sub', { httpsOnly: true }), /HTTPS/);
  assert.equal(requests.length, 1, 'downgrade блокируется до запроса');

  requests = [];
  handler = () => new Response('', { status: 302, headers: { location: '/sub' } });
  await assert.rejects(http.request('https://example.com/sub', { httpsOnly: true }), /redirect|перенаправлен/i);
  assert.equal(requests.length, 6, 'не больше 5 перенаправлений');

  requests = [];
  handler = () => new Response('', { status: 302 });
  await assert.rejects(http.request('https://example.com/sub', { httpsOnly: true }));

  // Общий срок не обнуляется на каждом шаге цепочки.
  requests = [];
  handler = (url, options) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(new Response('', { status: 302, headers: { location: `/r${requests.length}` } })), 40);
    options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal.reason); });
  });
  await assert.rejects(http.request('https://example.com/sub', { httpsOnly: true, timeout: 100, maxRedirects: 50 }));
  assert.ok(requests.length <= 4, `общий дедлайн: ${requests.length} запросов`);

  // Внешний сигнал: слушатель снимается после done().
  const outer = new AbortController();
  let listeners = 0;
  const add = outer.signal.addEventListener.bind(outer.signal);
  const remove = outer.signal.removeEventListener.bind(outer.signal);
  outer.signal.addEventListener = (...a) => { listeners++; add(...a); };
  outer.signal.removeEventListener = (...a) => { listeners--; remove(...a); };
  handler = () => new Response('ok');
  result = await http.request('https://example.com/sub', { httpsOnly: true, signal: outer.signal });
  result.done();
  assert.equal(listeners, 0, 'слушатель AbortSignal снят');

  handler = (url, options) => { assert.equal(options.redirect, 'follow'); return new Response('ok'); };
  result = await http.request('http://example.com/plain');
  result.done();
  console.log('HTTPS subscriptions: initial HTTP blocked, CDN redirect accepted, downgrade blocked before request, 5-redirect limit, shared deadline, listener released');
})().catch((e) => { console.error(e); process.exitCode = 1; });
