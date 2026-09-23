'use strict';

const fs = require('fs');
const { spawn, execFile } = require('child_process');
const paths = require('./paths');
const { t } = require('./l10n');

/**
 * Доступ к бандленному ядру Xray-core и его запуск.
 *
 * Вывод ядра уводим прямо в файл — так при ошибке есть что показать.
 */
let binaryPath = null;

function setBinary(file) {
  binaryPath = file;
}

function ensureBinary() {
  if (!binaryPath || !fs.existsSync(binaryPath)) {
    throw new Error(t('Ядро xray.exe не найдено рядом с приложением. Переустановите Life VPN.', 'The xray.exe core is missing next to the app. Reinstall Life VPN.'));
  }
  return binaryPath;
}

/** Первая строка `xray version` — например "Xray 26.6.1 (Xray, Penetrates Everything.)". */
function version() {
  return new Promise((resolve, reject) => {
    let binary;
    try {
      binary = ensureBinary();
    } catch (error) {
      reject(error);
      return;
    }
    execFile(binary, ['version'], { windowsHide: true, timeout: 15000 }, (error, stdout) => {
      if (error && !stdout) {
        reject(new Error(t(`Не удалось запустить xray: ${error.message}`, `Could not start xray: ${error.message}`)));
        return;
      }
      const first = String(stdout).split('\n')[0].trim();
      resolve(first);
    });
  });
}

/** Хвост лога — то, что показываем при ошибке подключения. */
function readLog(file, lines = 40) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-lines).join('\n');
  } catch (_) {
    return '';
  }
}

class XrayProcess {
  constructor() {
    this.child = null;
    /**
     * Номер запуска. Обработчик завершения молчит, если ядро к тому моменту
     * уже перезапустили или остановили сами.
     */
    this.generation = 0;
    this.onUnexpectedExit = null;
  }

  get isRunning() {
    return !!(this.child && this.child.exitCode == null && this.child.signalCode == null);
  }

  start(configPath, logPath) {
    if (this.isRunning) throw new Error(t('Ядро уже запущено.', 'The core is already running.'));
    const binary = ensureBinary();

    const log = fs.openSync(logPath, 'w');
    const child = spawn(binary, ['run', '-c', configPath], {
      cwd: paths.appSupport(),
      env: { ...process.env, XRAY_LOCATION_ASSET: paths.geoDir() },
      stdio: ['ignore', log, log],
      windowsHide: true,
      detached: false
    });
    fs.closeSync(log);

    this.generation += 1;
    const token = this.generation;
    child.once('exit', (code, signal) => {
      if (this.generation !== token) return;
      this.child = null;
      if (this.onUnexpectedExit) this.onUnexpectedExit(code == null ? (signal || -1) : code);
    });
    child.once('error', (error) => {
      if (this.generation !== token) return;
      this.child = null;
      if (this.onUnexpectedExit) this.onUnexpectedExit(error.message);
    });
    this.child = child;
  }

  /** Останавливает ядро. На Windows мягкого сигнала нет — завершаем сразу. */
  stop() {
    this.generation += 1; // обработчик завершения теперь молчит
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode != null) return;
    // На Windows kill — это TerminateProcess: синхронно и без шансов
    // зависнуть, поэтому годится и при выходе из приложения.
    try {
      child.kill();
    } catch (_) { /* уже завершилось */ }
  }
}

module.exports = { setBinary, version, readLog, XrayProcess };
