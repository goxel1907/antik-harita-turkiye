'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('R2541 BrainHub preserves read-only full-overlay JEV live mirror with atomic packet-chart parity',()=>{
  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(server,/\/context\/jev-live-mirror/);
  assert.match(server,/R2541_ATOMIC_TURKISH_MIRROR/);
  assert.match(server,/ATOMIC_CURRENT_RECONSTRUCTED_JEV_DIRECT_NUMERIC_PACKET/);
  assert.match(server,/jevMirrorParity/);
  assert.match(server,/R2538_PACKET_VS_ANNOTATED_CHART_DETERMINISTIC_PARITY/);
  assert.match(server,/JEV_LIVE_MIRROR_READ_ONLY/);
  assert.match(server,/JEV_MIRROR_PACKET_CHART_PARITY/);
  assert.match(server,/JEV_LIVE_MIRROR_FULL_OVERLAYS/);
  assert.match(server,/R2541_ATOMIC_FULL_SMC_TURKISH_LABELS/);
  assert.match(server,/observedLiquidations/);
  assert.match(server,/const mirrorBars=tf==='15m'\?180:72/);
  assert.match(server,/bullishOBBoundedCount/);
  assert.match(server,/bearishOBBoundedCount/);
  assert.match(server,/fvgBoundedCount/);
  assert.match(server,/latestBullishOB/);
  assert.match(server,/latestBearishOB/);
  assert.match(server,/latestFVG/);
});

test('R2538 decision journal preserves exact JEV-seen digest and Vision evidence excerpt',()=>{
  const pipeline=fs.readFileSync(path.join(__dirname,'..','pipeline.js'),'utf8');
  assert.match(pipeline,/mirrorDigest\(marketPacket\(unified\)\)/);
  assert.match(pipeline,/jevSeen:jevSeen\|\|null/);
  assert.match(pipeline,/textExcerpt:String\(vision\.text\|\|''\)\.slice\(0,1600\)/);
});

test('R2541 Office full mirror remains GET-only, Turkish and proxies only validated atomic chart/mirror inputs',()=>{
  const server=fs.readFileSync(path.join(__dirname,'..','office-dashboard','office-server.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.match(server,/2\.0\.8-JEV-ATOMIC-TR-R2541/);
  assert.match(server,/req\.method !== 'GET'/);
  assert.match(server,/\['5m','15m'\]\.includes\(tf\)/);
  assert.match(server,/\['clean','annotated'\]\.includes\(mode\)/);
  assert.match(html,/JEV Canlı Görüş Aynası/);
  assert.match(html,/Piyasa \/ CLEAN/);
  assert.match(html,/JEV \+ Vision \/ FULL ANNOTATED/);
  assert.match(html,/renderMirror\(s\)/);
  assert.match(html,/const mirrorBars=mirrorTf==='15m'\?180:72/);\n  assert.match(html,/snapshotId/);
  assert.match(html,/mirror-wide/);
  assert.match(html,/Aralık ÜST\/ALT\/EQ/);
  assert.match(html,/Gözlenen tasfiye bölgeleri/);
});
