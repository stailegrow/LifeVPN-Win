'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');
const paths = require('./paths');
const { t } = require('./l10n');
const { writeAtomic } = require('./atomic');

/**
 * Системный прокси Windows — аналог networksetup в мак-версии.
 *
 * Работу делает маленький помощник lifevpn-proxy.exe (WinINet): он
 * применяет настройки и к обычной сети, и ко всем RAS-подключениям и сразу
 * оповещает о смене программы.
 *
 * Перед включением на диск пишется журнал восстановления — снимок каждого
 * подключения (LAN и каждого RAS-профиля) по отдельности. Журнал удаляется
 * только после того, как ВСЕ подключения вернулись к своим значениям; при
 * любой ошибке он остаётся байт в байт, ошибка уходит наверх, а новое
 * подключение не начнётся, пока восстановление не пройдёт.
 */

/** Адреса мимо прокси: локальная сеть и собственные имена машины. */
const BYPASS = [
  'localhost', '127.*', '10.*',
  '172.16.*', '172.17.*', '172.18.*', '172.19.*', '172.20.*', '172.21.*', '172.22.*', '172.23.*',
  '172.24.*', '172.25.*', '172.26.*', '172.27.*', '172.28.*', '172.29.*', '172.30.*', '172.31.*',
  '192.168.*', '169.254.*', '*.local', '<local>'
].join(';');

const JOURNAL_VERSION = 2;
const RAS_MISSING = 3;

let helperPath = null;
/** Подмена помощника в проверках: (args) => stdout или throw. */
let runner = null;

function setHelper(file) {
  helperPath = file;
}

function setRunnerForTests(fn) {
  runner = fn;
}

function recoveryFailure() {
  return t('Не удалось вернуть прежние настройки системного прокси. Запись восстановления сохранена — повторите отключение. Новое подключение возможно только после успешного восстановления.',
    'Could not restore the previous system proxy settings. The recovery record is kept — retry disconnecting. A new connection is possible only after a successful restore.');
}

function run(args) {
  if (runner) return runner(args);
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
    const failure = new Error(output || t(`Помощник прокси вернул код ${error.status}.`, `The proxy helper returned code ${error.status}.`));
    failure.status = error.status;
    throw failure;
  }
}

// ---- Протокол помощника: hex кодовых единиц UTF-16, пустое — "-" ----

function encodeHex(value) {
  if (value == null || value === '') return '-';
  let out = '';
  for (let i = 0; i < value.length; i++) out += value.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  return out;
}

function decodeHex(text) {
  if (text === '-') return '';
  if (typeof text !== 'string' || !text.length || text.length % 4 !== 0 || !/^[0-9A-Fa-f]+$/.test(text)) {
    throw new Error('malformed hex value');
  }
  let out = '';
  for (let i = 0; i < text.length; i += 4) {
    const unit = parseInt(text.slice(i, i + 4), 16);
    if (unit === 0) throw new Error('malformed hex value');
    out += String.fromCharCode(unit);
  }
  return out;
}

/**
 * Разбор вывода `snapshot`. Любое отклонение от формата — ошибка: снимок,
 * который мы не поняли целиком, не годится для восстановления.
 */
function parseSnapshot(output) {
  const lines = String(output).split(/\r?\n/).filter((line) => line.length);
  if (lines[0] !== `LIFEVPN-PROXY-SNAPSHOT ${JOURNAL_VERSION}`) throw new Error(t('Помощник прокси вернул неизвестный формат снимка.', 'The proxy helper returned an unknown snapshot format.'));
  const last = lines[lines.length - 1] || '';
  const match = /^END (\d+)$/.exec(last);
  const body = lines.slice(1, -1);
  if (!match || Number(match[1]) !== body.length || body.length < 1) {
    throw new Error(t('Снимок настроек прокси неполный.', 'The proxy settings snapshot is incomplete.'));
  }
  const entries = body.map((line) => {
    const parts = line.split(' ');
    if (parts.length !== 6 || parts[0] !== 'E' || !/^\d+$/.test(parts[2])) {
      throw new Error(t('Снимок настроек прокси повреждён.', 'The proxy settings snapshot is damaged.'));
    }
    const flags = Number(parts[2]);
    if (!Number.isInteger(flags) || flags < 1 || flags > 255) throw new Error(t('Снимок настроек прокси повреждён.', 'The proxy settings snapshot is damaged.'));
    return {
      name: decodeHex(parts[1]),
      flags,
      server: decodeHex(parts[3]),
      bypass: decodeHex(parts[4]),
      autoconfig: decodeHex(parts[5])
    };
  });
  if (entries[0].name !== '') throw new Error(t('Снимок настроек прокси повреждён.', 'The proxy settings snapshot is damaged.'));
  return entries;
}

/** Текущие настройки каждого подключения — чтобы потом вернуть их на место. */
function query() {
  return parseSnapshot(run(['snapshot']));
}

const ourServer = (port) => `127.0.0.1:${port}`;

// ---- Журнал восстановления ----

function hasPendingRecovery() {
  return fs.existsSync(paths.proxyState());
}

const isString = (value) => typeof value === 'string';

function validEntry(entry) {
  return entry && isString(entry.name) && Number.isInteger(entry.flags) && entry.flags >= 1 && entry.flags <= 255 &&
    isString(entry.server) && isString(entry.bypass) && isString(entry.autoconfig);
}

/**
 * Отсутствие файла и повреждение — разные вещи: первое значит «нечего
 * восстанавливать», второе — ошибку без догадок вроде «просто выключить».
 * Возвращает null, { kind: 'v2', entries } или { kind: 'legacy', previous }.
 */
function loadJournal() {
  let text;
  try {
    text = fs.readFileSync(paths.proxyState(), 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw new Error(t(`Запись восстановления прокси не читается: ${error.message}`, `The proxy recovery record cannot be read: ${error.message}`));
  }
  const corrupted = () => new Error(t('Запись восстановления прокси повреждена. Она сохранена в proxy-state.json; проверьте настройки прокси Windows.',
    'The proxy recovery record is damaged. It is kept in proxy-state.json; check the Windows proxy settings.'));
  let state;
  try { state = JSON.parse(text); } catch (_) { throw corrupted(); }
  if (!state || typeof state !== 'object') throw corrupted();
  if (state.version === JOURNAL_VERSION) {
    if (!Array.isArray(state.entries) || !state.entries.length || !state.entries.every(validEntry)) throw corrupted();
    return { kind: 'v2', entries: state.entries };
  }
  // Формат до 3.1.5: одно значение для всех подключений.
  if (Object.prototype.hasOwnProperty.call(state, 'previous')) {
    const p = state.previous;
    if (p !== null && (!p || !Number.isInteger(p.flags) || !['server', 'bypass', 'autoconfig'].every((key) => isString(p[key])))) {
      throw corrupted();
    }
    return { kind: 'legacy', previous: p };
  }
  throw corrupted();
}

// ---- Включение и выключение ----

function enable(socksPort, httpPort) {
  // Сначала — незавершённое восстановление прошлой сессии. Не удалось —
  // новые значения поверх исходных не пишем.
  if (hasPendingRecovery()) disable();

  // Ошибка снимка — не повод продолжать без него.
  const entries = query();
  // Снимок пишется ДО любых изменений. Не записался — ничего не меняем.
  writeAtomic(paths.proxyState(), JSON.stringify({ version: JOURNAL_VERSION, entries, httpPort, socksPort }));

  try {
    run(['set', ourServer(httpPort), BYPASS]);
  } catch (error) {
    // Часть подключений уже могла получить наш прокси — возвращаем всё.
    try {
      disable();
    } catch (restoreError) {
      throw new Error(`${error.message}\n${restoreError.message}`);
    }
    throw error;
  }
}

/**
 * Возвращает каждое подключение к его снимку. Ошибки всех шагов
 * собираются, остальные шаги не прерываются; журнал удаляется только после
 * полного успеха.
 */
function disable() {
  const journal = loadJournal();
  if (!journal) return;
  const errors = [];

  if (journal.kind === 'v2') {
    for (const entry of journal.entries) {
      try {
        run(['restore-one', encodeHex(entry.name), String(entry.flags), encodeHex(entry.server), encodeHex(entry.bypass), encodeHex(entry.autoconfig)]);
      } catch (error) {
        // RAS-профиль удалили за время сессии — возвращать некуда, это не ошибка.
        if (entry.name && error.status === RAS_MISSING) continue;
        errors.push(`${entry.name || 'LAN'}: ${error.message}`);
      }
    }
  } else {
    const previous = journal.previous;
    try {
      if (previous && (previous.flags & ~1)) {
        run(['restore', String(previous.flags), previous.server, previous.bypass, previous.autoconfig]);
      } else {
        run(['clear']);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (errors.length) {
    throw new Error(`${errors.join('\n')}\n${recoveryFailure()}`);
  }
  try {
    fs.unlinkSync(paths.proxyState());
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw new Error(t(`Настройки возвращены, но запись восстановления не удалилась: ${error.message}`,
        `Settings were restored, but the recovery record could not be removed: ${error.message}`));
    }
  }
}

/** Прошлый запуск оставил журнал — прибираемся на старте. Ошибка — наверх. */
function cleanUpAfterCrash() {
  if (!hasPendingRecovery()) return false;
  disable();
  return true;
}

module.exports = {
  setHelper, enable, disable, cleanUpAfterCrash, query, hasPendingRecovery, recoveryFailure,
  parseSnapshot, encodeHex, decodeHex, loadJournal, setRunnerForTests, JOURNAL_VERSION
};
