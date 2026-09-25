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
  assert.match(server,/releaseVersion:'R2541-ATOMIC-TURKISH-SAFE'/);
  assert.match(server,/x-brainhub-snapshot-id/);
  assert.match(server,/MIRROR_SNAPSHOT_EXPIRED_OR_UNKNOWN/);
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
  assert.match(patch,/GERİ ÇEKİLME BEKLENİYOR/);
  assert.match(patch,/ŞİMDİ PİYASA GİRİŞİ/);
  assert.match(patch,/KIRILIM \+ GERİ TEST/);
  assert.match(cm,/GERİ ÇEKİLME BEKLENİYOR.*AutoDecisionCard/);
});


test('R2541 confirmed pivot indices stay aligned to the full candle time axis',()=>{
  const engine=require('../engine');
  const candles=[];
  for(let i=0;i<100;i++){
    const base=100+i*0.03+Math.sin(i/2.2)*2.2;
    const open=base-Math.sin(i)*0.15, close=base+Math.cos(i)*0.12;
    candles.push({
      openTime:i*300000,closeTime:(i+1)*300000-1,
      open,high:Math.max(open,close)+0.7,low:Math.min(open,close)-0.7,close,
      volume:1000+i,quoteVolume:100000+i,takerBuyQuote:50000+i
    });
  }
  const s=engine.structure(candles,'5m');
  const piv=[...(s.swingStructure?.confirmedPivots?.highs||[]),...(s.swingStructure?.confirmedPivots?.lows||[])];
  assert.ok(piv.length>=2);
  assert.ok(piv.every(p=>p.index>=60&&p.index<100));
  assert.ok(piv.every(p=>candles[p.index]?.closeTime===p.at));
  const tls=[s.swingStructure?.trendLines?.upSupport,s.swingStructure?.trendLines?.downResistance].filter(Boolean);
  assert.ok(tls.every(x=>candles[x.from.index]?.closeTime===x.from.at));
  assert.ok(tls.every(x=>candles[x.to.index]?.closeTime===x.to.at));
  assert.ok(tls.every(x=>x.projected.index===99));
});


test('R2541 daily loss cap remains binding and visible',()=>{
  const risk=require('../risk-gate');
  const blocked=risk.accountRiskCaps({
    account:{available:true,equity:1000,dailyRealizedPnl:-30,openPositions:0},
    intent:{riskQuote:5,notionalQuote:100,family:'ALL_USDT_PERP',familyExposureAfterQuote:100},
    limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:50,maxDailyLossPct:2,maxOpenPositions:3,maxFamilyExposurePct:100}
  });
  assert.ok(blocked.reasons.includes('DAILY_LOSS_CAP_REACHED'));
  const office=read('office-dashboard/public/office.html');
  assert.ok(office.includes('Günlük zarar freni'));
  assert.ok(office.includes('GÜNLÜK ZARAR TAVANI DOLDU'));
  assert.ok(office.includes('Stop sonrası yeniden giriş'));
});


test('R2541 renderer refuses stale geometry time-axis snapping',()=>{
  const market=read('market.js');
  assert.match(market,/R2541_STRICT_TIME_AXIS/);
  assert.match(market,/dist<=stepMs\*0\.5/);
  assert.match(market,/if\(d===0\)return xAt\(i\)/);
});


test('R2541 structural parity covers trend and pattern geometry',()=>{
  const server=read('server.js');
  assert.match(server,/R2541_STRUCTURAL_PARITY/);
  assert.match(server,/addTrendParity\('upSupport'/);
  assert.match(server,/addTrendParity\('downResistance'/);
  assert.match(server,/name\+'ProjectedPrice'/);
  assert.match(server,/patternGeometryDigest/);
  assert.match(server,/R2541_PACKET_VS_CHART_SWING_TREND_PATTERN_PARITY/);
});


test('R2541 installer fails closed on structural parity',()=>{
  const ps=read('INSTALL-R2541-ATOMIC-TURKISH-SAFE.ps1');
  assert.match(ps,/R2541 structural packet\/chart parity failed/);
  assert.match(ps,/R2541_PACKET_VS_CHART_SWING_TREND_PATTERN_PARITY/);
  assert.match(ps,/R2541_STRUCTURAL_TREND_PATTERN_PARITY_OK/);
  assert.match(ps,/mismatches -ne 0/);
});


test('R2541 Office hides stale chart while a new atomic snapshot is loading',()=>{
  const office=read('office-dashboard/public/office.html');
  assert.match(office,/Yeni atomik snapshot yükleniyor/);
  assert.match(office,/function loadMirrorImage/);
  assert.match(office,/await Promise\.all\(\[/);
  assert.match(office,/loadMirrorImage\(clean,cleanUrl,seq\)/);
  assert.match(office,/loadMirrorImage\(annotated,annotatedUrl,seq\)/);
});

test('R2541 Office fully translates historical JEV entry reasons and event blockers',()=>{
  const office=read('office-dashboard/public/office.html');
  assert.match(office,/JEV FINAL selected \(\[A-Z0-9_\]\+\) after directing evidence collection/);
  assert.match(office,/LONG_5M_SCALP:'5 DK ALIŞ SCALP'/);
  assert.match(office,/SHORT_5M_SCALP:'5 DK SATIŞ SCALP'/);
  assert.match(office,/FRESH_SCANNER_SELECTION:'YENİ TARAYICI SEÇİMİ'/);
  assert.match(office,/LEADER_AUTO_BLOCKED:'OTO YÜRÜTME ENGELLENDİ'/);
  assert.match(office,/akış sembol kapasitesi dolu/);
});


test('R2541 live Office funnel and mode labels stay Turkish',()=>{
  const office=read('office-dashboard/public/office.html');
  const server=read('office-dashboard/office-server.js');
  for(const s of ['LEADER_AUTO_WAIT:\'OTO LİDER BEKLİYOR\'','MARKET_SETUP_FAMILY_TIMING_EDGE:\'PİYASA / SETUP AİLESİ / ZAMANLAMA / AVANTAJ\'','BEARISH_ENGULFING:\'AYI YUTAN FORMASYONU\'']){
    assert.ok(office.includes(s),s);
  }
  assert.ok(server.includes("label: 'JEV PASS-2 • SON KARAR'"));
  assert.ok(server.includes("label: 'ALIŞ + SATIŞ son karar'"));
  assert.ok(server.includes("label: 'JEV BEKLE'"));
  assert.ok(server.includes("label: 'Zorunlu güvenlik geçti'"));
});


test('R2541 JEV paid decision hard cap is five dollars and legacy two-dollar config migrates',()=>{
  const jev=read('jev-decision.js');
  const manage=read('manage.ps1');
  assert.match(jev,/dailyCapUsd:5\.00/);
  assert.doesNotMatch(jev,/dailyCapUsd:2\.00/);
  assert.match(manage,/NotePropertyName dailyCapUsd -NotePropertyValue 5\.00/);
  assert.match(manage,/Abs\(\$daily - 2\.00\).*\$jev\.dailyCapUsd = 5\.00/s);
  assert.match(manage,/dailyCapUsd = 5\.00/);
  assert.match(manage,/hardUsd=5\.00/);
});
