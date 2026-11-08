'use strict';
const assert = require('assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const {SessionTraffic} = require('../src/core/sessionTraffic');
const Builder = require('../src/core/configBuilder');
const Parser = require('../src/core/linkParser');

(async()=>{
 let up=12,down=34,invalid=false;
 const server=http.createServer((req,res)=>{
   assert.equal(req.url,`http://${Builder.METRICS_HOST}/debug/vars`);
   res.end(invalid?'invalid':JSON.stringify({stats:{outbound:{proxy:{uplink:up,downlink:down},direct:{uplink:9999,downlink:9999}}}}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const meter=new SessionTraffic();
 try {
  meter.reset(server.address().port);await meter.poll();assert.equal(meter.snapshot().total,46);
  up=1;down=2;await meter.poll();assert.equal(meter.snapshot().total,46,'counters never regress');
  invalid=true;await meter.poll();assert.equal(meter.snapshot().total,46,'malformed reply preserves reading');
  meter.reset(server.address().port);assert.equal(meter.snapshot().total,0,'new session resets counters');
  invalid=false;up=50;down=100;await meter.poll();assert.equal(meter.snapshot().total,150);
 } finally {meter.stop();await new Promise(resolve=>server.close(resolve));}
 const tree=Builder.makeTree(Parser.parse('vless://00000000-0000-4000-8000-000000000001@vpn.example.com:443?encryption=none&type=tcp&security=tls&sni=vpn.example.com#Test'), {metrics:true,selfProcess:[process.execPath]});
 assert.deepEqual(tree.metrics,{tag:'metrics'});
 assert.equal(tree.policy.system.statsOutboundDownlink,true);assert.deepEqual(tree.stats,{});
 const xray=process.env.LIFEVPN_XRAY;
 if (xray) {
   const filename=path.join(require('os').tmpdir(),`lifevpn-metrics-check-${process.pid}.json`);
   fs.writeFileSync(filename,JSON.stringify(tree));
   try {require('child_process').execFileSync(xray,['run','-test','-config',filename],{stdio:'pipe'});} finally {fs.unlinkSync(filename);}
 }
 console.log('Session traffic: counters, session reset, direct-traffic exclusion and metrics config passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
