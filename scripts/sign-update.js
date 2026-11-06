#!/usr/bin/env node
'use strict';
// Подпись установщика ключом издателя Life VPN (Ed25519).
//
//   UPDATE_SIGNING_KEY=<base64 32 байта> node scripts/sign-update.js <версия> <файл>
//
// Печатает подпись в base64. Формат подписываемой строки совпадает с
// signedMessage в src/core/updater.js (продукт lifevpn-windows).
const crypto = require('crypto');
const fs = require('fs');
const { signedMessage, PRODUCT } = require('../src/core/updater');

const [version, file] = process.argv.slice(2);
const seed = Buffer.from(String(process.env.UPDATE_SIGNING_KEY || '').trim(), 'base64');
if (!version || !file || seed.length !== 32) {
  console.error('usage: UPDATE_SIGNING_KEY=… node scripts/sign-update.js <version> <file>');
  process.exit(2);
}
const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
const key = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
process.stdout.write(crypto.sign(null, signedMessage(PRODUCT, version, sha256), key).toString('base64') + '\n');
