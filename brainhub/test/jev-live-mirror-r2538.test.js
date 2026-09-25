'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('R2538 BrainHub exposes read-only JEV live mirror with deterministic packet-chart parity',()=>{
  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(server,/\/context\/jev-live-mirror/);
  assert.match(server,/R2538_JEV_LIVE_MIRROR/);
  assert.match(server,/CURRENT_RECONSTRUCTED_JEV_DIRECT_NUMERIC_PACKET/);
  assert.match(server,/jevMirrorParity/);
  assert.match(server,/R2538_PACKET_VS_ANNOTATED_CHART_DETERMINISTIC_PARITY/);
  assert.match(server,/JEV_LIVE_MIRROR_READ_ONLY/);
  assert.match(server,/JEV_MIRROR_PACKET_CHART_PARITY/);
});

test('R2538 decision journal preserves exact JEV-seen digest and Vision evidence excerpt',()=>{
  const pipeline=fs.readFileSync(path.join(__dirname,'..','pipeline.js'),'utf8');
  assert.match(pipeline,/mirrorDigest\(marketPacket\(unified\)\)/);
  assert.match(pipeline,/jevSeen:jevSeen\|\|null/);
  assert.match(pipeline,/textExcerpt:String\(vision\.text\|\|''\)\.slice\(0,1600\)/);
});

test('R2538 Office mirror remains GET-only and proxies only validated chart/mirror inputs',()=>{
  const server=fs.readFileSync(path.join(__dirname,'..','office-dashboard','office-server.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.match(server,/2\.0\.6-JEV-LIVE-MIRROR-R2538/);
  assert.match(server,/req\.method !== 'GET'/);
  assert.match(server,/\['5m','15m'\]\.includes\(tf\)/);
  assert.match(server,/\['clean','annotated'\]\.includes\(mode\)/);
  assert.match(html,/JEV Canlı Görüş Aynası/);
  assert.match(html,/Piyasa \/ CLEAN/);
  assert.match(html,/JEV kanıt aynası \/ ANNOTATED/);
  assert.match(html,/renderMirror\(s\)/);
});
