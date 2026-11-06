'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Запись через временный файл: оборванная запись не должна оставить огрызок.
 *
 * Временный файл получает случайное имя и создаётся с флагом `wx` — если
 * на его месте кто-то заранее положил ссылку, запись не пойдёт через неё.
 * Данные сбрасываются на диск до переименования. На Windows права файлу
 * задаёт ACL каталога данных (см. paths.secureRoot), на других системах — 0600.
 */
function writeAtomic(target, data) {
  const staging = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const fd = fs.openSync(staging, 'wx', 0o600);
  try {
    fs.writeSync(fd, typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
    fs.fsyncSync(fd);
  } catch (error) {
    fs.closeSync(fd);
    try { fs.unlinkSync(staging); } catch (_) { /* уже нет */ }
    throw error;
  }
  fs.closeSync(fd);
  try {
    fs.renameSync(staging, target);
  } catch (error) {
    try { fs.unlinkSync(staging); } catch (_) { /* уже нет */ }
    throw error;
  }
}

/** Мягкое чтение для данных, без которых можно обойтись (настройки, узлы). */
function readJSON(target) {
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (_) {
    return null;
  }
}

module.exports = { writeAtomic, readJSON };
