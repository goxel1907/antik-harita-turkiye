'use strict';
// CLAUDE_R2544.6 (29.09.2026): JEV'e giden TÜM verilerin karar anındaki Binance verisiyle karşılaştırılması sonucu
// bulunan tanım hataları: ATR (basit ortalama), üç asker/karga (gövdesiz mumlar), harami (yanlış ana mum),
// "flip acceptance" (ilk kırılım mumu), dolmuş FVG'ler, prior20 (19 mum), CVD penceresi (yeni abonelikte birkaç sn),
// OI değişimi (USD değeri → fiyat etkisi).
const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../engine');
const P=require('../jev-market-packet');

let T0=1790600000000;
const K=(o,h,l,c,i)=>({openTime:T0+i*300000,open:o,high:h,low:l,close:c,volume:10,closeTime:T0+i*300000+299999,quoteVolume:1000,takerBuyQuote:500});
function base(n=60,px=100){const out=[];for(let i=0;i<n;i++){const o=px+Math.sin(i/3)*0.3,c=px+Math.sin((i+1)/3)*0.3;out.push(K(o,Math.max(o,c)+0.1,Math.min(o,c)-0.1,c,i));}return out;}
const types=s=>s.patterns.map(p=>p.type);

test('ATR Wilder (RMA) bağımsız hesapla aynı',()=>{
  const c=base(70);
  const tr=[];for(let i=1;i<c.length;i++){const x=c[i],p=c[i-1];tr.push(Math.max(x.high-x.low,Math.abs(x.high-p.close),Math.abs(x.low-p.close)));}
  let a=tr.slice(0,14).reduce((s,v)=>s+v,0)/14;for(let i=14;i<tr.length;i++)a=(a*13+tr[i])/14;
  const s=E.structure(c,'5m');
  assert.ok(Math.abs(s.atr14-a)<1e-6,s.atr14+' vs '+a);
});

test('prior20: son kapalı mum hariç 20 mum',()=>{
  const c=base(70);c[c.length-21].high=150; // tam 20 mum önce
  const s=E.structure(c,'5m');
  assert.equal(s.prior20High,150);
});

test('üç beyaz asker: gövdesiz/doji mumlar sayılmaz; güçlü üç mum sayılır',()=>{
  const weak=base(60,100);const n=weak.length;
  weak[n-3]={...weak[n-3],open:99.0,close:99.35,high:99.4,low:98.95};weak[n-2]={...weak[n-2],open:99.3,close:99.7,high:99.75,low:99.25};weak[n-1]={...weak[n-1],open:99.70,close:99.71,high:99.9,low:99.6};
  assert.ok(!types(E.structure(weak,'5m')).includes('THREE_WHITE_SOLDIERS'),'PHA 5m benzeri: 3. mum doji');
  const strong=base(60,100);
  strong[n-3]={...strong[n-3],open:99.0,close:100.0,high:100.05,low:98.95};strong[n-2]={...strong[n-2],open:99.8,close:100.9,high:100.95,low:99.75};strong[n-1]={...strong[n-1],open:100.7,close:101.8,high:101.85,low:100.65};
  assert.ok(types(E.structure(strong,'5m')).includes('THREE_WHITE_SOLDIERS'));
});

test('harami: ana mum bir önceki mum',()=>{
  const c=base(60,100);const n=c.length;
  c[n-3]={...c[n-3],open:100.2,close:99.0,high:100.3,low:98.9}; // eski kodun baktığı mum (ayı)
  c[n-2]={...c[n-2],open:99.0,close:100.5,high:100.6,low:98.9};  // ana mum (boğa, büyük)
  c[n-1]={...c[n-1],open:100.2,close:99.6,high:100.3,low:99.5};  // içeride küçük ayı
  const t=types(E.structure(c,'5m'));
  assert.ok(t.includes('BEARISH_HARAMI'),t.join(','));
  assert.ok(!t.includes('BULLISH_HARAMI'));
});

test('kırılım: ilk kırılım mumu BREAKOUT_CLOSE; FLIP_ACCEPTANCE yalnız kırılım + yeniden test',()=>{
  const c=base(60,100);const n=c.length;
  c[n-1]={...c[n-1],open:100.2,close:101.5,high:101.6,low:100.1};
  let t=types(E.structure(c,'5m'));
  assert.ok(t.includes('BREAKOUT_CLOSE'));assert.ok(!t.includes('RESISTANCE_FLIP_ACCEPTANCE'),'ilk kırılım kabul değildir');
  const d=base(61,100);const m=d.length;
  d[m-2]={...d[m-2],open:100.2,close:101.2,high:101.3,low:100.1};   // kırılım (önceki mum)
  d[m-1]={...d[m-1],open:101.1,close:101.4,high:101.5,low:100.35};   // seviyeye dönüş ve tutunma
  t=types(E.structure(d,'5m'));
  assert.ok(t.includes('RESISTANCE_FLIP_ACCEPTANCE'),t.join(','));
});

test('FVG: dolmuş boşluk açık FVG diye gönderilmez',()=>{
  const c=base(60,100);const n=c.length;
  c[n-6]={...c[n-6],open:99.8,close:100.0,high:100.0,low:99.7};
  c[n-5]={...c[n-5],open:100.0,close:101.0,high:101.1,low:99.95};
  c[n-4]={...c[n-4],open:101.0,close:101.3,high:101.4,low:100.6}; // BULL FVG 100.0-100.6
  c[n-3]={...c[n-3],open:101.3,close:100.2,high:101.3,low:99.9}; // boşluğu tamamen doldurur
  const s=E.structure(c,'5m');
  assert.ok(!s.recentFairValueGaps.some(g=>Math.abs(g.low-100.0)<1e-9&&Math.abs(g.high-100.6)<1e-9),'dolmuş FVG listede yok');
  assert.ok(s.filledFairValueGapCount>=1);
});

test('CVD: kapsamı <60 sn olan pencere "120 sn CVD" diye gönderilmez; tam pencere ve REST dolgu gönderilir',()=>{
  const u=s=>({microstructure:{streaming:s},marketMakerEvidence:{orderFlow:{available:true}}});
  const cold=P.marketPacket(u({cvdQuote120s:-209.76,cvdTrades120s:1,cvdCoverageMs:5000,cvdComplete:false}));
  assert.equal(cold.microstructure.cvdQuote120s,null);assert.match(cold.microstructure.orderFlowReason,/CVD_WINDOW_INCOMPLETE_5S/);
  const warm=P.marketPacket(u({cvdQuote120s:-37371.89,cvdTrades120s:173,cvdCoverageMs:120000,cvdComplete:true,cvdSource:'BINANCE_REST_AGGTRADES_120S'}));
  assert.equal(warm.microstructure.cvdQuote120s,-37371.89);assert.equal(warm.microstructure.cvdSource,'BINANCE_REST_AGGTRADES_120S');
});

test('REST CVD dolgusu ve OI değişimi (sözleşme adedi) — Binance yanıtı taklidi',async t=>{
  const real=globalThis.fetch;t.after(()=>{globalThis.fetch=real;});
  const now=1790629973770;
  globalThis.fetch=async url=>{const u=new URL(String(url));const ok=b=>new Response(JSON.stringify(b),{status:200,headers:{'content-type':'application/json'}});
    if(u.pathname==='/fapi/v1/aggTrades')return ok([{p:'0.5',q:'100',m:true,T:now-100000},{p:'0.5',q:'40',m:false,T:now-50000},{p:'0.5',q:'10',m:true,T:now-1000}]);
    if(u.pathname==='/futures/data/openInterestHist')return ok([{sumOpenInterest:'1000',sumOpenInterestValue:'1000'},{sumOpenInterest:'1001',sumOpenInterestValue:'980'}]);
    if(u.pathname==='/fapi/v1/openInterest')return ok({openInterest:'1001',time:now});
    return ok([]);};
  const M=require('../market');
  const cv=await M.restCvd120('PONSUSDT',now);
  assert.equal(cv.trades,3);assert.equal(cv.cvdQuote,-35);assert.equal(cv.complete,true);
  const d=await M.derivativesContext('TESTOIUSDT');
  assert.equal(d.openInterest.delta5mPct,0.1,'sözleşme +%0,1 (USD değeri -%2 fiyat etkisi)');
  assert.equal(d.openInterest.valueDelta5mPct,-2);
  assert.equal(d.openInterest.deltaBasis,'CONTRACTS_LAST_TWO_5M_BUCKETS');
});
