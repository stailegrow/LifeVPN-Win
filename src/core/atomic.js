'use strict';

const fs = require('fs');

/** Запись через временный файл: оборванная запись не должна оставить огрызок. */
function writeAtomic(target, data) {
  const staging = `${target}.tmp`;
  fs.writeFileSync(staging, data);
  fs.renameSync(staging, target);
}

function readJSON(target) {
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (_) {
    return null;
  }
}

module.exports = { writeAtomic, readJSON };
