'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const http = require('./http');
const { t } = require('./l10n');

/**
 * Обновление из релизов GitHub — перенос Updater.swift.
 *
 * Раз в несколько часов (и по кнопке в настройках) спрашивает у GitHub
 * последний релиз. Если его версия новее установленной, интерфейс
 * предлагает обновиться. Обновление — скачать установщик релиза и
 * запустить его в тихом режиме. Запуск делает маленький скрипт PowerShell:
 * он ждёт, пока приложение закроется (при выходе снимается системный
 * прокси), ставит новую версию поверх старой и запускает её.
 *
 * Репозиторий обязан быть публичным: приложение спрашивает GitHub без
 * токена, а встраивать токен в программу нельзя.
 */

const REPOSITORY = 'stailegrow/LifeVPN-Win';
const RELEASES_PAGE = `https://github.com/${REPOSITORY}/releases`;
const PRODUCT = 'lifevpn-windows';

/**
 * Подпись обновлений ключом издателя Life VPN (Ed25519).
 *
 * Установщик не подписан Authenticode, а контрольная сумма из того же
 * релиза от подмены релиза не защищает. Поэтому автоматически ставится
 * только установщик, подписанный ключом, закреплённым в этой программе;
 * ключ, пришедший вместе с обновлением, доверием не считается.
 * Подписывается строка `LifeVPN-update-v1\n<продукт>\n<версия>\n<sha256>\n`.
 */
const UPDATE_PUBLIC_KEY = 'z96lge0uLd3Kmr/kGidg+hI9cH0f5IblP3ukfi32VHs=';

function signedMessage(product, version, sha256) {
  return Buffer.from(`LifeVPN-update-v1\n${product}\n${version}\n${String(sha256).toLowerCase()}\n`, 'utf8');
}

function verifySignature(signature, { product = PRODUCT, version, sha256, publicKey = UPDATE_PUBLIC_KEY }) {
  try {
    const raw = Buffer.from(publicKey, 'base64');
    if (raw.length !== 32) return false;
    const key = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
    return crypto.verify(null, signedMessage(product, version, sha256), key, signature);
  } catch (_) {
    return false;
  }
}

/** Скачиваем только файлы релизов нашего репозитория и только по https. */
function isOwnReleaseAsset(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com' &&
      parsed.pathname.startsWith(`/${REPOSITORY}/releases/download/`);
  } catch (_) {
    return false;
  }
}

/** Сравнение «2.10.0» > «2.9.3» по числам, а не по строкам. */
function isNewer(candidate, current) {
  if (!current || current === 'dev') return false;
  const a = String(candidate).split('.').map((x) => parseInt(x, 10) || 0);
  const b = String(current).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

class Updater extends EventEmitter {
  /**
   * `version` — установленная версия; `installed` — стоит ли приложение
   * через установщик (из zip-архива обновляться установщиком нельзя —
   * он поставил бы вторую копию в другое место).
   */
  constructor({ version, installed, onQuit }) {
    super();
    this.version = version;
    this.installed = installed;
    this.onQuit = onQuit;
    this.phase = { kind: 'idle' };
    this.latest = null;
    this.lastChecked = null;
    this.timer = null;
  }

  get hasUpdate() {
    const k = this.phase.kind;
    if (k === 'available' || k === 'downloading' || k === 'installing') return true;
    return k === 'failed' && this.latest != null;
  }

  set(phase) {
    this.phase = phase;
    this.emit('change');
  }

  /** Фоновая проверка: через полминуты после запуска, чтобы не мешать
   *  замеру задержки, и дальше каждые шесть часов. */
  startAutomaticChecks() {
    if (this.timer) return;
    const loop = async () => {
      await this.check();
      this.timer = setTimeout(loop, 6 * 3600 * 1000);
    };
    // Сразу при запуске — чтобы ещё до подключения было видно, что нужно обновиться.
    this.timer = setTimeout(loop, 1000);
  }

  async check() {
    const k = this.phase.kind;
    if (k === 'checking' || k === 'downloading' || k === 'installing') return;
    this.set({ kind: 'checking' });

    try {
      const { response, done } = await http.request(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `LifeVPN/${this.version}` },
        timeout: 20000
      });
      let payload = null;
      try {
        if (response.status === 404) {
          // Релизов ещё нет — это не ошибка, просто обновляться не на что.
          this.lastChecked = new Date().toISOString();
          this.latest = null;
          this.set({ kind: 'upToDate' });
          return;
        }
        if (response.status !== 200) {
          this.lastChecked = new Date().toISOString();
          this.set({ kind: 'failed', message: t(`GitHub ответил кодом ${response.status}`, `GitHub answered with code ${response.status}`) });
          return;
        }
        payload = await response.json();
      } finally {
        done();
      }
      this.lastChecked = new Date().toISOString();

      const version = String(payload.tag_name || '').replace(/^[vV\s]+|\s+$/g, '');
      const assets = payload.assets || [];
      const asset = assets.find((a) => /setup.*\.exe$/i.test(a.name)) || assets.find((a) => /\.exe$/i.test(a.name));
      if (!asset || !version) {
        this.latest = null;
        this.set({ kind: 'upToDate' });
        return;
      }
      const sigAsset = assets.find((a) => a.name === `${asset.name}.sig`);
      if (!isOwnReleaseAsset(asset.browser_download_url)) {
        this.latest = null;
        this.set({ kind: 'upToDate' });
        return;
      }
      if (isNewer(version, this.version)) {
        this.latest = {
          signature: sigAsset && isOwnReleaseAsset(sigAsset.browser_download_url) ? sigAsset.browser_download_url : null,
          version,
          notes: payload.body || '',
          page: payload.html_url || RELEASES_PAGE,
          installer: asset.browser_download_url,
          name: asset.name,
          size: asset.size || 0
        };
        this.set({ kind: 'available' });
      } else {
        this.latest = null;
        this.set({ kind: 'upToDate' });
      }
    } catch (error) {
      this.lastChecked = new Date().toISOString();
      this.set({ kind: 'failed', message: error.message });
    }
  }

  async install(openExternal) {
    const release = this.latest;
    if (!release) return;

    if (!this.installed) {
      // Копия из zip-архива: установщик поставил бы вторую копию — отдаём
      // релиз браузеру.
      openExternal(release.page);
      this.set({
        kind: 'failed',
        message: t('Приложение запущено не из установщика — страница релиза открыта в браузере.',
          'The app was not installed with the installer — the release page opened in the browser.')
      });
      return;
    }

    if (!release.signature) {
      openExternal(release.page);
      this.set({
        kind: 'failed',
        message: t('У релиза нет подписи издателя — автоматическая установка отключена. Страница релиза открыта в браузере.',
          'The release has no publisher signature — automatic install is disabled. The release page opened in the browser.')
      });
      return;
    }

    let work = null;
    try {
      this.set({ kind: 'downloading', fraction: 0 });
      work = fs.mkdtempSync(path.join(os.tmpdir(), 'LifeVPN-update-'));
      const target = path.join(work, release.name.replace(/[^\w.-]/g, '_'));
      await this.download(release.installer, target, release.size);

      // Подпись издателя: без неё установщик не запускаем.
      const signature = await this.fetchSmall(release.signature);
      const sha256 = await sha256File(target);
      if (!verifySignature(signature, { version: release.version, sha256 })) {
        throw new Error(t('подпись издателя не прошла проверку — обновление не установлено',
          'the publisher signature did not verify — the update was not installed'));
      }

      // Простейшая проверка, что пришёл исполняемый файл, а не страница ошибки.
      const head = Buffer.alloc(2);
      const fd = fs.openSync(target, 'r');
      fs.readSync(fd, head, 0, 2, 0);
      fs.closeSync(fd);
      if (head.toString('latin1') !== 'MZ') {
        throw new Error(t('скачанный файл не похож на установщик', 'the downloaded file does not look like an installer'));
      }

      this.set({ kind: 'installing' });
      this.launchSwap(target, work);
      work = null;
      // Выход штатный: снимается системный прокси, останавливается ядро.
      setTimeout(() => this.onQuit(), 400);
    } catch (error) {
      if (work) fs.rm(work, { recursive: true, force: true }, () => {});
      this.set({ kind: 'failed', message: error.message });
    }
  }

  /** Маленький файл релиза (подпись): только https, не больше 4 КиБ. */
  async fetchSmall(url) {
    const { response, done } = await http.request(url, {
      httpsOnly: true,
      headers: { 'User-Agent': `LifeVPN/${this.version}` },
      timeout: 30000
    });
    try {
      if (response.status !== 200) throw new Error(t(`сервер ответил кодом ${response.status}`, `the server answered with code ${response.status}`));
      const text = Buffer.from(await response.arrayBuffer());
      if (text.length > 4096) throw new Error(t('файл подписи слишком большой', 'the signature file is too large'));
      const signature = Buffer.from(text.toString('utf8').trim(), 'base64');
      if (signature.length !== 64) throw new Error(t('файл подписи повреждён', 'the signature file is damaged'));
      return signature;
    } finally {
      done();
    }
  }

  async download(url, target, expected) {
    const { response, done } = await http.request(url, {
      httpsOnly: true,
      headers: { 'User-Agent': `LifeVPN/${this.version}` },
      timeout: 10 * 60000
    });
    try {
      if (response.status !== 200) {
        throw new Error(t(`сервер ответил кодом ${response.status}`, `the server answered with code ${response.status}`));
      }
      const total = Number(response.headers.get('content-length')) || expected || 0;
      const out = fs.createWriteStream(target);
      const reader = response.body.getReader();
      let received = 0;
      let lastEmit = 0;
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        received += value.length;
        // Больше, чем объявлено в релизе, не принимаем.
        if (expected > 0 && received > expected) {
          out.destroy();
          throw new Error(t('файл больше, чем объявлено в релизе', 'the file is larger than the release declares'));
        }
        if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
        const now = Date.now();
        if (total > 0 && now - lastEmit > 150) {
          lastEmit = now;
          this.set({ kind: 'downloading', fraction: Math.min(1, received / total) });
        }
      }
      await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
      if (total > 0 && received < total) throw new Error(t('загрузка оборвалась', 'the download was cut short'));
    } finally {
      done();
    }
  }

  /**
   * Скрипт живёт отдельно от приложения: ждёт, пока процесс закроется,
   * запускает установщик тихо (/S) и после него — новую версию.
   */
  launchSwap(installer, work) {
    const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
    const script = [
      `$p = ${process.pid}`,
      'try { Wait-Process -Id $p -Timeout 60 -ErrorAction SilentlyContinue } catch {}',
      `Start-Process -FilePath ${quote(installer)} -ArgumentList '/S','--force-run' -Wait`,
      `Remove-Item -LiteralPath ${quote(work)} -Recurse -Force -ErrorAction SilentlyContinue`
    ].join('; ');
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();
  }

  snapshot() {
    return {
      phase: this.phase,
      latest: this.latest ? { version: this.latest.version, page: this.latest.page } : null,
      lastChecked: this.lastChecked,
      hasUpdate: this.hasUpdate
    };
  }
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('error', reject).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex')));
  });
}

module.exports = { Updater, isNewer, REPOSITORY, RELEASES_PAGE, verifySignature, signedMessage, isOwnReleaseAsset, PRODUCT };
