'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Все пути, по которым приложение пишет на диск. Корень задаётся при
 * запуске: в приложении это %APPDATA%\LifeVPN, в проверках — временная папка.
 */
let root = null;

function setRoot(dir) {
  root = dir;
  fs.mkdirSync(root, { recursive: true });
}

/** Файлы, где могут быть ключи узлов или следы подключения. */
const PRIVATE_FILES = ['servers.json', 'settings.json', 'config.json', 'proxy-state.json', 'xray.log', 'access.log'];

/**
 * Приводит каталог данных к приватному виду до чтения из него.
 *
 * Каталог и приватные файлы не должны быть символической ссылкой или
 * точкой повторной обработки (junction), у секретных файлов не должно быть
 * жёстких ссылок наружу. На Windows chmod ничего не значит, поэтому каталогу
 * явно выставляется ACL: наследование отключено, полный доступ — только
 * текущему пользователю и SYSTEM; файлы внутри наследуют его. Администратор
 * для этого не нужен: каталог принадлежит пользователю.
 *
 * `icacls` — штатная утилита Windows; `execIcacls` подменяется в проверках.
 */
function secureRoot({ execIcacls = defaultIcacls, platform = process.platform, currentAccount = defaultAccount } = {}) {
  const dir = appSupport();
  const info = fs.lstatSync(dir);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`Data folder is not a plain directory: ${dir}`);
  }
  for (const name of PRIVATE_FILES) {
    const target = path.join(dir, name);
    let stat;
    try {
      stat = fs.lstatSync(target);
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Unsafe object in the data folder: ${target}`);
    if (stat.nlink > 1) throw new Error(`File has hard links outside the data folder: ${target}`);
  }
  if (platform === 'win32') {
    const account = currentAccount();
    execIcacls([dir, '/inheritance:r', '/grant:r', `${account}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '/q']);
    for (const name of PRIVATE_FILES) {
      const target = path.join(dir, name);
      if (fs.existsSync(target)) execIcacls([target, '/reset', '/q']);
    }
  } else {
    fs.chmodSync(dir, 0o700);
    for (const name of PRIVATE_FILES) {
      const target = path.join(dir, name);
      if (fs.existsSync(target)) fs.chmodSync(target, 0o600);
    }
  }
}

/** SID текущего пользователя (`*S-1-5-…`) — однозначнее имени. */
function defaultAccount() {
  const system = process.env.SystemRoot || 'C:\\Windows';
  const out = execFileSync(path.join(system, 'System32', 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'],
    { windowsHide: true, encoding: 'utf8', timeout: 15000 });
  const match = /"(S-1-[0-9-]+)"/.exec(out);
  if (!match) throw new Error('Could not determine the current user SID');
  return `*${match[1]}`;
}

function defaultIcacls(args) {
  const system = process.env.SystemRoot || 'C:\\Windows';
  execFileSync(path.join(system, 'System32', 'icacls.exe'), args, { windowsHide: true, stdio: 'pipe', timeout: 15000 });
}

function appSupport() {
  if (!root) throw new Error('paths: root is not set');
  return root;
}

const file = (name) => path.join(appSupport(), name);

function geoDir() {
  const dir = file('geo');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = {
  setRoot,
  appSupport,
  secureRoot,
  PRIVATE_FILES,
  generatedConfig: () => file('config.json'),
  coreLog: () => file('xray.log'),
  accessLog: () => file('access.log'),
  servers: () => file('servers.json'),
  settings: () => file('settings.json'),
  proxyState: () => file('proxy-state.json'),
  geoDir
};
