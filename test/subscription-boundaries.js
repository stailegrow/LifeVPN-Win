'use strict';
const assert = require('assert/strict');
const p = require('../src/core/subscriptionParse');
const link = 'vless://a@h:443';
assert.deepEqual(p.decodeBody(link+'\n'.repeat(8*1024*1024-100)+link),[link,link]);
assert.equal(p.decodeBody((link+'\r\n').repeat(10000)).length,10000);
for (const text of [(link+'\n').repeat(10001),Buffer.from((link+'\r').repeat(10001)).toString('base64')]) {
 assert.throws(()=>p.decodeBody(text),/too many|слишком много/);
}
assert.deepEqual(p.decodeBody(' #comment\r'+link+'\r\n'+link+'\n'),[link,link]);
assert.deepEqual(p.parseUserInfo('upload=100; download=200; total=1000; expire=1000'),{used:300,total:1000,expiresAt:'1970-01-01T00:16:40.000Z'});
for (const value of ['upload=-1; download=3','upload=9007199254740992; download=1','upload=9007199254740991; download=1','upload=bad; download=1']) assert.equal(p.parseUserInfo(value).used,null);
assert.deepEqual(p.parseUserInfo('upload=bad; total=100; expire=9223372036854775807'),{used:null,total:100,expiresAt:null});
assert.equal(p.parseUserInfo('total=-1').total,null);
assert.equal(p.parseUserInfo('expire=0').expiresAt,null);
for (const value of ['Infinity','NaN','1e309','1e307','2garbage','-1','0','']) assert.equal(p.parseUpdateInterval(value),null);
assert.equal(p.parseUpdateInterval('0.5'),12);
console.log('Subscription boundaries: dense delimiters, exact link limit, base64 excess, unsafe numbers, dates and intervals passed');
