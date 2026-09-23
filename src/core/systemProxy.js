'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');
const paths = require('./paths');
const { t } = require('./l10n');
const { writeAtomic, readJSON } = require('./atomic');

/**
 * Системный прокси Windows — аналог networksetup в мак-версии.
 *
 * Работу делает маленький помощник lifevpn-proxy.exe (WinINet): он
 * применяет настройки и к обычной сети, и ко всем RAS-подключениям и сразу
 * оповещает о смене программы.
 *
 * Прежние настройки пользователя запоминаем на диске ДО включения: если
 * приложение упадёт с включённым прокси, при следующем запуске мы должны
 * вернуть всё как было, иначе пользователь останется без интернета.
 */

/** Адреса мимо прокси: локальная сеть и собственные имена машины. */
const BYPASS = [
  'localhost', '127.*', '10.*',
  '172.16.*', '172.17.*', '172.18.*', '172.19.*', '172.20.*', '172.21.*', '172.22.*', '172.23.*',
  '172.24.*', '172.25.*', '172.26.*', '172.27.*', '172.28.*', '172.29.*', '172.30.*', '172.31.*',
  '192.168.*', '169.254.*', '*.local', '<local>'
].join(';');

let helperPath = null;

function setHelper(file) {
  helperPath = file;
}

function run(args) {
  if (process.platform !== 'win32') {
    // Вне Windows прокси не трогаем: сборка и проверки идут где угодно.
    return '';
  }
  if (!helperPath || !fs.existsSync(helperPath)) {
    throw new Error(t('Не найден помощник системного прокси (lifevpn-proxy.exe).', 'The system proxy helper (lifevpn-proxy.exe) is missing.'));
  }
  try {
    return execFileSync(helperPath, args, { windowsHide: true, encoding: 'utf8', timeout: 10000 });
  } catch (error) {
    const output = String((error.stderr || '') + (error.stdout || '')).trim();
    throw new Error(output || t(`Помощник прокси вернул код ${error.status}.`, `The proxy helper returned code ${error.status}.`));
  }
}

/** Текущие настройки — чтобы потом вернуть их на место. */
function query() {
  const lines = run(['query']).split(/\r?\n/);
  return {
    flags: parseInt(lines[0], 10) || 1,
    server: lines[1] || '-',
    bypass: lines[2] || '-',
    autoconfig: lines[3] || '-'
  };
}

const ourServer = (port) => `127.0.0.1:${port}`;

function enable(socksPort, httpPort) {
  // Пишем состояние ДО применения: если процесс умрёт на середине, след
  // останется и мы сможем убрать за собой.
  let previous = null;
  try {
    previous = query();
  } catch (_) { /* вернём прямое подключение */ }

  // Если прежний прокси — наш же (упали и не прибрались), вернуть надо не его.
  if (previous && /^127\.0\.0\.1:\d+$/.test(previous.server) && (previous.flags & 2)) previous = null;

  try {
    writeAtomic(paths.proxyState(), JSON.stringify({ previous, httpPort, socksPort }));
  } catch (_) { /* не критично */ }

  run(['set', ourServer(httpPort), BYPASS]);
}

function disable() {
  const state = readJSON(paths.proxyState());
  const previous = state && state.previous;
  try {
    if (previous && (previous.flags & ~1)) {
      run(['restore', String(previous.flags), previous.server, previous.bypass, previous.autoconfig]);
    } else {
      run(['clear']);
    }
  } catch (_) {
    try { run(['clear']); } catch (__) { /* сделали что могли */ }
  }
  try { fs.unlinkSync(paths.proxyState()); } catch (_) { /* нет файла */ }
}

/** Прошлый запуск оставил прокси включённым — прибираемся на старте. */
function cleanUpAfterCrash() {
  if (!fs.existsSync(paths.proxyState())) return false;
  disable();
  return true;
}

module.exports = { setHelper, enable, disable, cleanUpAfterCrash, query };
