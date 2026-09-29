'use strict';
// CLAUDE_R2544.8 (29.09.2026): TAKEUSDT canlı denetimi — kapanmamış mum bağlamının gerçek hatta JEV'e ulaşması,
// Office Canlı Görüş Aynası etiket okunabilirliği, açık pozisyonu otomatik izleme, yakınlaştırma/kaydırma.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const E=require('../engine');
const {buildUnifiedContext}=require('../pipeline');
const {marketPacket,mirrorDigest}=require('../jev-market-packet');
const {renderChartPng}=require('../market');

function synth(iv,n,seed,now){const step={'1m':6e4,'3m':18e4,'5m':3e5,'15m':9e5,'30m':18e5,'1h':36e5,'2h':72e5,'4h':144e5,'1d':864e5}[iv]||9e5;
  let s=seed>>>0;const r=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};const last=Math.floor(now/step)*step;let p=100;const out=[];
  for(let i=n-1;i>=0;i--){const o=last-i*step,op=p,c=p*(1+(r()-0.5)*0.01),hi=Math.max(op,c)*(1+r()*0.004),lo=Math.min(op,c)*(1-r()*0.004),v=1000+r()*500;
    out.push([o,String(op),String(hi),String(lo),String(c),String(v),o+step-1,String(v*c),100,String(v*0.5),String(v*c*0.5),'0']);p=c;}return out;}

test('gerçek hat: analyzeFrames → buildUnifiedContext → paket; kapanmamış mum JEV\'e ulaşır (29.09 TAKE: forming=null idi)',()=>{
  const now=Date.now();const raw={};E.NATIVE_FRAMES.forEach((tf,i)=>{raw[tf]=synth(tf,tf==='15m'?180:72,31+i*7,now);});
  const frames=E.analyzeFrames(raw,now);
  assert.ok(frames['15m'].forming,'engine forming üretir');
  const c=frames['1m'].close;
  const u=buildUnifiedContext({symbol:{symbol:'TAKEUSDT',timeframes:frames,microstructure:{available:true,bid:c*0.9999,ask:c*1.0001}},global:{},candidate:{symbol:'TAKEUSDT',side:'LONG'},now});
  assert.ok(u.frames['15m'].forming,'unified.frames forming taşır');
  assert.ok(Number.isFinite(u.frames['15m'].atr14),'atr14 taşınır');
  const pk=marketPacket(u);
  assert.ok(pk.coreFrames['15m'].forming,'pakette forming var');
  assert.match(pk.chartNarrative.frames['15m'].line,/FORMING candle \(NOT closed/);
  assert.ok(mirrorDigest(pk).coreFrames['5m'].forming,'denetim aynasında görünür');
});

test('grafik: etiket sütunu 270 px, aynı fiyattaki seviyeler tek satır, 6/8/9 glifleri düzgün; PNG boyutu değişmez',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','market.js'),'utf8');
  assert.match(src,/CLAUDE_R2544_8_LABELS/);assert.match(src,/'8':'111101111101111'/);assert.match(src,/'9':'111101111001111'/);assert.match(src,/'6':'111100111101111'/);
  assert.match(src,/if\(Math\.abs\(ty-\(y\+7\)\)>2\)\{line\(right,ty,right\+4,y\+7,g\.col\);\}/,'kayan etiket fiyatına bağlanır');
  const candles=Array.from({length:80},(_,i)=>({openTime:i*9e5,closeTime:i*9e5+899999,open:100+i*0.1,high:100.5+i*0.1,low:99.5+i*0.1,close:100.05+i*0.1,volume:10}));
  const hi=Math.max(...candles.map(x=>x.high)),lo=Math.min(...candles.map(x=>x.low));
  const png=renderChartPng({candles,analysis:{prior20High:hi,prior20Low:lo,smcContext:{dealingRange:{low:lo,high:hi,equilibrium:(hi+lo)/2},fibLevels:{retracement:{'0.5':(hi+lo)/2}}},swingStructure:{lastConfirmedSwingHigh:{price:hi},lastConfirmedSwingLow:{price:lo}}}},'annotated');
  assert.equal(png.readUInt32BE(16),1280);assert.equal(png.readUInt32BE(20),720);
});

test('Office aynası: açık pozisyon başta + yeni pozisyonda otomatik geçiş, yakınlaştırma/kaydırma, alt alta düzen; betik derlenir',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.match(html,/CLAUDE_R2544_8_AUTO_FOLLOW/);assert.match(html,/CLAUDE_R2544_8_MIRROR_ZOOM/);
  assert.match(html,/class="mirror-charts stacked" id="mirrorCharts"/);
  assert.ok(html.indexOf("for(const p of s?.positions?.data?.open||[])add(p?.symbol);")<html.indexOf('add(s?.visionProgress?.data?.symbol);'),'açık pozisyon listenin başında');
  assert.match(html,/addEventListener\('wheel'/);assert.match(html,/addEventListener\('dblclick'/);
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  for(const sc of scripts)new vm.Script(sc);
});

test('TP1 öncesi azaltma payı: JEV kısmi guard kademelisinin yerine geçer, toplam ≤ ilk miktarın 1/3\'ü (TAKE 29.09: runner kalmadı)',()=>{
  const G=require('../position-guard');
  const base={row:{symbol:'TAKEUSDT',side:'LONG',entryPrice:0.05957,originalStopPrice:0.05801,currentStop:0.05971,originTF:'15m',lane:'15M_TRADE',createdAt:0,jevPartialBE:true},
    snap:{qty:3134,entryPrice:0.05957,markPrice:0.06032,tickSize:0.00001},phase:'INITIAL',now:30*60000,config:{...G.DEFAULTS}};
  assert.notEqual(G.evaluateGuard(base).action,'SCALE_OUT','JEV kârlı kısmisinden sonra guard ayrıca 1/3 azaltmaz');
  const c=(rf,phase='INITIAL')=>G.partialContract({side:'LONG',entryPrice:0.05957,initialStop:0.05801,markPrice:0.06077,partialEvents:[{action:'PARTIAL_TAKE_PROFIT',at:0}],now:30*60000,config:G.DEFAULTS,reducedFraction:rf,phase});
  const first=G.partialContract({side:'LONG',entryPrice:0.05957,initialStop:0.05801,markPrice:0.06017,partialEvents:[],now:0,config:G.DEFAULTS,reducedFraction:0,phase:'INITIAL'});
  assert.equal(first.allow,true);assert.ok(Math.abs(first.maxFractionOfInitial-0.3334)<1e-6);
  assert.equal(c(0.3333).reason,'PARTIAL_DEFERRED_PRE_TP1_CAP','07:20 ikinci kısmi ertelenir → TP1 1/3 + runner 1/3 kalır');
  assert.equal(c(0.3333,'TRAILING').allow,true,'TP1 dolduktan sonra runner üzerinde kısmi serbest');
  assert.equal(c(null).allow,true,'runner satırı yoksa eski davranış');
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(lc,/fraction=Math\.max\(0\.01,Math\.min\(fraction,partialGate\.maxFractionOfInitial\*init\/cur\)\)/);
});
