'use strict';
/**
 * Загрузка обновления при сбоях GitHub: 503/504 и таймауты повторяются —
 * сначала обычным путём, затем напрямую мимо прокси; ошибки проверки
 * (подпись, размер, 404) не повторяются.
 */
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('../src/core/http');
const { Updater, isRetryable, isRetryableStatus, DOWNLOAD_PLAN } = require('../src/core/updater');

const body = (text) => new ReadableStream({
  start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); }
});
const reply = (status, text = '') => ({ response: { status, headers: new Map([['content-length', String(text.length)]]), body: body(text) }, done: () => {} });

(async () => {
  for (const code of [408, 429, 500, 502, 503, 504]) assert.ok(isRetryableStatus(code), `код ${code} — повтор`);
  for (const code of [200, 301, 403, 404]) assert.ok(!isRetryableStatus(code), `код ${code} — без повтора`);
  assert.ok(isRetryable(new Error('The request timed out.')));
  assert.ok(isRetryable(new Error('Время ожидания истекло.')));
  assert.ok(isRetryable(new Error('net::ERR_CONNECTION_RESET')));
  assert.ok(!isRetryable(new Error('подпись издателя не прошла проверку')));
  assert.deepEqual(DOWNLOAD_PLAN.map((s) => s.route), ['system', 'system', 'direct', 'direct']);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifevpn-retry-'));
  const target = path.join(dir, 'setup.exe');
  const sleep = async () => {};
  const updater = new Updater({ version: '3.1.7', installed: true, onQuit() {} });

  // 503, 504 обычным путём → третья попытка напрямую успешна.
  let calls = [];
  let answers = [reply(503), reply(504), reply(200, 'MZpayload')];
  http.request = async (url, options) => { calls.push(options.route); return answers.shift(); };
  const route = await updater.downloadWithRetries('https://github.com/x', target, 0, { sleep });
  assert.equal(route, 'direct');
  assert.deepEqual(calls, ['system', 'system', 'direct']);
  assert.equal(fs.readFileSync(target, 'utf8'), 'MZpayload');

  // 404 — сразу ошибка, без повторов.
  calls = [];
  answers = [reply(404)];
  await assert.rejects(updater.downloadWithRetries('https://github.com/x', target, 0, { sleep }), /404/);
  assert.deepEqual(calls, ['system']);

  // Таймауты на всех путях — четыре попытки, затем последняя ошибка.
  calls = [];
  http.request = async (url, options) => { calls.push(options.route); throw new Error('The request timed out.'); };
  await assert.rejects(updater.downloadWithRetries('https://github.com/x', target, 0, { sleep }), /timed out/);
  assert.deepEqual(calls, ['system', 'system', 'direct', 'direct']);

  // Больше объявленного размера — не повторяем.
  calls = [];
  http.request = async (url, options) => { calls.push(options.route); return reply(200, 'MZtoo-long'); };
  await assert.rejects(updater.downloadWithRetries('https://github.com/x', target, 3, { sleep }), /larger|больше/);
  assert.deepEqual(calls, ['system']);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Update retry: 503/504 and timeouts retried (system → direct), 404 and size errors not retried');
})().catch((error) => { console.error(error); process.exitCode = 1; });
