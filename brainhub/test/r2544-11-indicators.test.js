'use strict';
// CLAUDE_R2544_11_INDICATORS: kullanıcının paylaştığı iki TradingView göstergesinden (BigBeluga SMC + Auto-ATR Spike & Trend)
// JEV'e katkı: ani hareket/kovalama bağlamı, 3×ATR iz, OB hacim gücü, breaker, gürültü FVG filtresi.
// Tümü kapalı mumdan, YALNIZ BAĞLAM: kapı, puan eşiği veya veto yok; paket bütçesi korunur.
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('fs');const path=require('path');
const E=require('../engine');const P=require('../jev-market-packet');
const {prepareDecisionRequest}=require('../jev-decision');
const {narrateFrame}=require('../chart-narrator');

// Deterministik sözde-rastgele mum dizisi.
function series(n,seed=7,base=100){
  let s=seed;const rnd=()=>{s=(s*1103515245+12345)%2147483648;return s/2147483648;};
  const out=[];let p=base;
  for(let i=0;i<n;i++){
    const o=p,mv=(rnd()-0.5)*1.2*(rnd()<0.06?5:1),c=o+mv,h=Math.max(o,c)+rnd()*0.5,l=Math.min(o,c)-rnd()*0.5;
    out.push({openTime:i*900000,open:o,high:h,low:l,close:c,volume:10,closeTime:(i+1)*900000-1,quoteVolume:1000+rnd()*500,takerBuyQuote:500});
    p=c;
  }
  return out;
}
// Pine betiğinin (Auto ATR, gövde, ATR 2×, iz 3×) satır satır referans portu — durum makinesi eşdeğerliği için.
function pineRef(c,A){
  let st=0,tr=null;
  for(let i=15;i<c.length;i++){
    const k=c[i],a=A[i];if(!(a>0))continue;
    const range=Math.max(k.close,k.open)-Math.min(k.close,k.open);
    const bigUp=range>a*2&&k.close>k.open,bigDn=range>a*2&&k.close<k.open;
    const up=bigUp&&st!==1,dn=bigDn&&st!==-1;
    if(up&&st<=0){st=1;tr=k.low-a*3;}
    if(dn&&st>=0){st=-1;tr=k.high+a*3;}
    if(st===1){tr=Math.max(tr,k.low-a*3);if(k.close<tr){st=0;tr=null;}}
    else if(st===-1){tr=Math.min(tr,k.high+a*3);if(k.close>tr){st=0;tr=null;}}
  }
  return {st,tr};
}
test('3×ATR iz durum makinesi Pine betiğiyle birebir aynı (40 rastgele seri)',()=>{
  for(let seed=1;seed<=40;seed++){
    const c=series(200,seed),A=E.atrSeries(c,14),ref=pineRef(c,A),v=E.volatilityContext(c,A.at(-1));
    const st=ref.st===1?'UP':ref.st===-1?'DOWN':'NONE';
    assert.equal(v.trail.state,st,'seed '+seed);
    if(st!=='NONE')assert.ok(Math.abs(v.trail.stop-ref.tr)<1e-5,'seed '+seed);
  }
});
test('ATR serisi mevcut atr() ile aynı son değeri verir',()=>{
  const c=series(150,3),A=E.atrSeries(c,14);
  const s=E.structure(c,'15m');
  assert.ok(Math.abs(A.at(-1)-s.atr14)<1e-5);
});
test('ani hareket: yön, kaç mum önce, gövde/ATR, orta seviye ve fiyatın ortadan uzaklığı (ATR)',()=>{
  const c=series(120,11);
  const last=c.at(-1).close;
  // 3 mum önce büyük yükseliş mumu, sonra yatay.
  const k=c[c.length-4];k.open=last;k.close=last+12;k.low=last-0.2;k.high=last+12.3;
  for(let j=c.length-3;j<c.length;j++){const x=c[j];x.open=last+12;x.close=last+12.5;x.high=last+12.9;x.low=last+11.8;}
  const a=E.structure(c,'15m').atr14;
  const v=E.volatilityContext(c,a);
  assert.equal(v.spike.dir,'UP');assert.equal(v.spike.barsAgo,3);
  assert.ok(v.spike.bodyAtr>2);
  assert.ok(Math.abs(v.spike.mid-(last+6))<1e-6);
  assert.ok(Math.abs(v.extAtr-(6.5/a))<0.01,'fiyat ortanın 6,5 birim üstünde');
  assert.equal(v.trail.state,'UP');
  assert.ok(v.trail.stop<c.at(-1).close&&v.trail.distAtr>0);
});
test('yeterli veri yoksa bağlam yok (uydurma yok)',()=>{
  assert.equal(E.volatilityContext(series(20),1),null);
  assert.equal(E.volatilityContext(series(80),0),null);
});
test('order block: yer değiştirme hacmi (volRel) ve breaker (kırılıp geri alınmamış blok)',()=>{
  const c=series(120,5);
  const s=E.structure(c,'15m');
  const all=[...s.orderBlocks.bullish,...s.orderBlocks.bearish];
  for(const o of all){assert.ok(o.volRel===null||o.volRel>0);assert.equal(typeof o.breaker,'boolean');if(!o.broken)assert.equal(o.breaker,false);}
  // Sentetik: ayı mumu → büyük boğa kırılımı (OB) → sonra blok altında kapanış (kırıldı) → geri alınmadı = breaker.
  const d=series(60,9,100).map(x=>({...x}));
  const p=d[40].close;
  d[41]={...d[41],open:p,close:p-0.6,high:p+0.1,low:p-0.7,quoteVolume:1000};
  d[42]={...d[42],open:p-0.6,close:p+8,high:p+8.2,low:p-0.65,quoteVolume:4000};
  for(let j=43;j<52;j++)d[j]={...d[j],open:p+7,close:p+7.2,high:p+7.5,low:p+6.8};
  for(let j=52;j<60;j++)d[j]={...d[j],open:p-2,close:p-2.2,high:p-1.9,low:p-2.5};
  // Legacy prior10 displacement contract remains independent of nearest internal-zone selection.
  const ob=E.orderBlocks(d,E.atrSeries(d).at(-1)).bullish.find(o=>o.broken);
  assert.ok(ob,'kırılan boğa bloğu');assert.equal(ob.breaker,true);assert.ok(ob.volRel>2,'hacim ortalamanın 2 katından fazla');
});
test('ATR\'nin %10\'undan küçük FVG gürültü sayılır: JEV\'e gitmez, sayısı yazılır',()=>{
  const c=series(120,21);
  const s=E.structure(c,'15m');
  for(const g of s.recentFairValueGaps)assert.ok(g.high-g.low>=0.1*s.atr14-1e-9);
  assert.equal(typeof s.minorFairValueGapCount,'number');
});
test('paket: her TF\'de kompakt volatility (≤200 bayt), üst bağlam özetlemesinde de korunur',()=>{
  const c=series(200,13),s=E.structure(c,'15m');
  const f={...s,fresh:true};
  const fp=P.framePacket(f,{full:true}),hp=P.framePacket(f);
  assert.ok(fp.volatility&&hp.volatility!==undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(P.volDigest(s.volatility)))<=200);
  const src=fs.readFileSync(path.join(__dirname,'..','jev-decision.js'),'utf8');
  assert.match(src,/'ema20','ema50','candle','forming','keyLevels','volatility','readout'\];/);
  const big=tf=>({available:true,fresh:true,trend:'UP',volatility:{spike:{dir:'UP',barsAgo:2,bodyAtr:2.4,pct:1.1,mid:1},extAtr:1.8,trail:null},liquidity:{notes:'y'.repeat(9000)}});
  const input={state:{coreMarketPacket:{coreFrames:{'5m':big(),'15m':big()},higherContext:Object.fromEntries(['30m','45m','1h','4h','1d'].map(tf=>[tf,big()]))},record:{entryThesis:'t'.repeat(3000)},professionalTraderCortex:{reference:'r'.repeat(20000)}},questions:{trade_plan:{}}};
  const out=prepareDecisionRequest(input);
  const h=out.body.state.coreMarketPacket.higherContext['4h'];
  assert.ok(out.diagnostics.trimStepsApplied.includes('HIGHER_CONTEXT_SUMMARY'),JSON.stringify(out.diagnostics.trimStepsApplied));
  assert.equal(h.compacted,true);assert.equal(h.volatility.extAtr,1.8,'özetlenen üst bağlamda da kalır');
});
test('JEV\'e anlatı: kovalama riski ve orta seviye cümlesi; kural metni bağlam olduğunu, veto olmadığını söyler',()=>{
  const f={available:true,fresh:true,close:110,trend:'UP',volatility:{spike:{dir:'UP',barsAgo:2,bodyAtr:2.6,pct:1.4,mid:106},extAtr:1.9,trail:{state:'UP',stop:101,distAtr:4.2,barsAgo:2}}};
  const full=narrateFrame('15m',f,110,{full:true}).line;
  assert.match(full,/last displacement candle UP/);assert.match(full,/chasing risk, the midpoint is the retrace level/);assert.match(full,/3-ATR trail UP at 101/);
  const cmp=narrateFrame('1h',f,110,{full:false}).line;
  assert.match(cmp,/spike UP 2\.6ATR 2b ago ext \+1\.9ATR/);
  const src=fs.readFileSync(path.join(__dirname,'..','jev-decision.js'),'utf8');
  assert.match(src,/soft closed-candle context for chase risk and location, never a checklist, threshold or veto/);
  assert.match(src,/soft context for runner management, not automatic exits/);
});
test('kısıtlama yok: yeni alanlar hiçbir kapı/eşik/veto kodunda kullanılmaz',()=>{
  for(const fn of ['risk-gate.js','live-controller.js','position-guard.js','trade-lanes.js','live-authorization.js']){
    const src=fs.readFileSync(path.join(__dirname,'..',fn),'utf8');
    assert.doesNotMatch(src,/volatility\.|extAtr|breaker|volRel/,fn);
  }
});
test('Office aynası JEV\'in gördüğü ani hareket/iz ve blok gücünü gösterir',()=>{
  const oh=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.match(oh,/\['Ani hareket \/ ATR iz \(JEV bağlamı\)', fmtVol\(vol\)\]/);
  assert.match(oh,/kırık → breaker/);
  const scripts=[...oh.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  for(const sc of scripts)new (require('vm').Script)(sc);
});
