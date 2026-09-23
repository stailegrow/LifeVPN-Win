'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Все пути, по которым приложение пишет на диск. Корень задаётся при
 * запуске: в приложении это %APPDATA%\LifeVPN, в проверках — временная папка.
 */
let root = null;

function setRoot(dir) {
  root = dir;
  fs.mkdirSync(root, { recursive: true });
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
  generatedConfig: () => file('config.json'),
  coreLog: () => file('xray.log'),
  servers: () => file('servers.json'),
  settings: () => file('settings.json'),
  proxyState: () => file('proxy-state.json'),
  geoDir
};
