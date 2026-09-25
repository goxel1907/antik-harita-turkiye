'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

test('R2541 atomic packet/chart contract is wired end-to-end',()=>{
  const market=read('market.js'), server=read('server.js'), office=read('office-dashboard/public/office.html');
  assert.match(market,/R2541_ATOMIC_PACKET_CHART/);
  assert.match(market,/atomicMirrorContext/);
  assert.match(server,/R2541_ATOMIC_TURKISH_MIRROR/);
  assert.match(server,/x-brainhub-snapshot-id/);
  assert.match(office,/snapshotId/);
});

test('R2541 structural drawings use confirmed pivots and pattern geometry',()=>{
  const engine=read('engine.js'), market=read('market.js');
  assert.match(engine,/CONFIRMED_PIVOTS_CLOSED_CANDLES/);
  assert.match(engine,/trendLines:\{upSupport,downResistance\}/);
  assert.match(engine,/CONFIRMED_PIVOT_GEOMETRY_CLOSED_CANDLES/);
  assert.match(engine,/ABOVE_RANGE_EXTENSION/);
  assert.match(engine,/BELOW_RANGE_EXTENSION/);
  assert.match(market,/R2541_CONFIRMED_SWING_TRENDLINES/);
  assert.match(market,/R2541_PATTERN_GEOMETRY/);
  assert.doesNotMatch(market,/close-regression pseudo trend line[^\n]*enabled/i);
});

test('R2541 Office exposes Turkish decisions and stale-decision warning',()=>{
  const office=read('office-dashboard/public/office.html');
  for(const s of ['GERİ ÇEKİLME BEKLENİYOR','YAPI KAPANIŞI BEKLENİYOR','ŞİMDİ PİYASA GİRİŞİ','KIRILIM + GERİ TEST','ESKİ KARAR — ŞİMDİKİ PİYASA İLE KARIŞTIRMA']){
    assert.ok(office.includes(s),s);
  }
  assert.ok(office.includes('JEV SON KARAR → zorunlu güvenlik → emir'));
});

test('R2541 Android build preserves PC-only fail-closed boundary',()=>{
  const cm=read('../codemagic.yaml');
  const patch=read('../futures15m_alarm/v95122_r2541_turkish_contract.py');
  assert.match(cm,/V122_ANDROID_R2541_CONTRACT_OK/);
  assert.match(cm,/Futures15mAlarm-PRO-v9\.5\.115-R2541\.apk/);
  assert.match(patch,/ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY/);
  assert.match(patch,/post\(c, "\/live\/execute", intent, true\).*not in/s);
  assert.match(patch,/versionName '9\.5\.115-r2541'/);
});
