'use strict';
// CLAUDE_R2544.5 (29.09.2026): zararlı işlemlerde JEV'e giden verinin Binance ile karşılaştırılması.
// Bulgular: (1) RSI basit-ortalama (Cutler) idi, grafik/Binance Wilder kullanır → PHA 5m 20,8 ↔ 41,9;
// (2) kapanmamış mum pakette yoktu → SOON'da kapalı 15m UP iken açık mum -%2,7 düşüyordu;
// (3) kırpma formasyonları "son 2" ile kesiyordu → karşı yön kanıtı düşebiliyordu.
const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../engine');
const P=require('../jev-market-packet');
const {narrateChart}=require('../chart-narrator');

// PHAUSDT 5m, 71 kapalı mum, son kapanış 28.09 22:24:59Z (JEV kararı 22:28:39Z) — Binance verisi.
const PHA=[0.05967,0.05998,0.05949,0.0593,0.05958,0.05951,0.05952,0.05928,0.06001,0.05953,0.05941,0.05935,0.05928,0.05935,0.05988,0.05992,0.05972,0.05972,0.05982,0.05983,0.05998,0.05992,0.05978,0.05985,0.05996,0.05958,0.05968,0.05977,0.05995,0.06014,0.05944,0.05915,0.05929,0.05926,0.05933,0.05919,0.05937,0.0593,0.05958,0.05982,0.05991,0.05988,0.05994,0.06002,0.06095,0.06064,0.06125,0.0611,0.0614,0.06152,0.06134,0.0611,0.0614,0.06148,0.06153,0.06156,0.06154,0.06134,0.06102,0.05973,0.05958,0.05925,0.05922,0.05896,0.05902,0.05904,0.05895,0.05862,0.05894,0.0593,0.05933];
function cutler(v,p=14){let g=0,l=0;for(let i=v.length-p;i<v.length;i++){const d=v[i]-v[i-1];g+=Math.max(0,d);l+=Math.max(0,-d);}return 100-100/(1+g/l);}

test('RSI Wilder: PHA 5m paketteki 20,84 (Cutler) yerine grafikle uyumlu ~42',()=>{
  assert.ok(Math.abs(cutler(PHA)-20.84)<0.05,'eski yöntem paketteki değeri üretir: '+cutler(PHA));
  const r=E.rsi(PHA);
  assert.ok(r>38&&r<46,'Wilder RSI '+r+' (Binance 1000 mum ile 41,89)');
  assert.equal(E.rsi([1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]),50,'düz seri nötr');
  assert.equal(E.rsi(Array.from({length:30},(_,i)=>i+1)),100);
  assert.equal(E.rsi([1,2,3]),null,'yetersiz veri');
});

function k(ot,o,h,l,c,dur=900000){return [ot,String(o),String(h),String(l),String(c),'100',ot+dur-1,'1000',10,'50','500','0'];}
function upTrend15(){
  const out=[];const t0=1790636400000-179*900000;
  for(let i=0;i<179;i++){const base=0.30+i*0.000237;const o=base,c=base*1.0015;out.push(k(t0+i*900000,o,c*1.002,o*0.998,c));}
  return out;
}

test('kapanmamış mum: yapı kapalı mumdan, açık mum ayrı ve etiketli; SOON senaryosu (kapalı 15m UP, açık mum -%2,7)',()=>{
  const raw=upTrend15();
  const now=1790636971561; // 29.09 02:09:31 İstanbul
  raw.push(k(1790636400000,0.3424,0.3427,0.3322,0.3331)); // SOON açık 15m mumu (1m mumlardan)
  const frames=E.analyzeFrames({'15m':raw},now);
  const f=frames['15m'];
  assert.equal(f.available,true);assert.equal(f.trend,'UP','kapalı mumlar yükseliş');
  assert.equal(f.closedCandles,179,'açık mum yapıya girmez (repaint yok)');
  assert.equal(f.forming.direction,'BEAR');assert.ok(f.forming.changePct<-2.6&&f.forming.changePct>-2.8);
  assert.ok(f.forming.changeAtr<-1,'ATR cinsinden güçlü ters hareket: '+f.forming.changeAtr);
  assert.ok(f.forming.elapsedPct>60&&f.forming.elapsedPct<66);
  const pk=P.framePacket(f,{full:true});
  assert.equal(pk.forming.notClosed,true);assert.equal(pk.forming.direction,'BEAR');
  const n=narrateChart({livePrice:0.33425,frames});
  assert.match(n.frames['15m'].line,/FORMING candle \(NOT closed, \d+% elapsed\): BEAR -2\.\d+% since open/);
  assert.match(n.alignment.formingLine,/15m closed trend UP but forming candle -\d/);
  const mirror=P.mirrorDigest({coreFrames:{'15m':pk}});
  assert.ok(mirror.coreFrames['15m'].forming,'denetim aynası gösterir');
  // Kapanmış son mum: forming yok
  const closedOnly=E.analyzeFrames({'15m':upTrend15()},1790636400000+1);
  assert.equal(closedOnly['15m'].forming,undefined);
});

test('formasyon kırpması: son-2 değil önem sırası; iki yön varsa karşı kanıt korunur',()=>{
  const pats=[{type:'DESCENDING_TRIANGLE',side:'SHORT',status:'FORMING'},{type:'SELL_SIDE_SWEEP_RECLAIM',side:'LONG',status:'CONFIRMED'},
    {type:'RISING_CHANNEL',side:'LONG',status:'FORMING'},{type:'DOJI',side:'NEUTRAL',status:'CONFIRMED'},{type:'THREE_WHITE_SOLDIERS',side:'LONG',status:'CONFIRMED'}];
  const top=P.rankPatterns(pats,3);
  assert.equal(top.length,3);
  assert.ok(top.some(p=>p.side==='SHORT'),'tek SHORT kanıt düşmedi');
  assert.ok(top.some(p=>p.type==='SELL_SIDE_SWEEP_RECLAIM'));
  assert.deepEqual(pats.slice(-2).map(p=>p.side),['NEUTRAL','LONG'],'eski son-2 SHORT kanıtı atıyordu');
  const fs=require('node:fs'),path=require('node:path');
  const jd=fs.readFileSync(path.join(__dirname,'..','jev-decision.js'),'utf8');
  assert.match(jd,/f\.patterns=rankPatterns\(f\.patterns,3\)/);assert.ok(!jd.includes('f.patterns.slice(-2)'));
});

test('plan seçenekleri: stop mesafesi ATR cinsinden, gürültü/geniş stop etiketi, açık mum ters hareketi JEV kriterinde',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const pl=fs.readFileSync(path.join(__dirname,'..','pipeline.js'),'utf8');
  assert.match(pl,/if\(stopAtr!==null&&stopAtr<0\.25\)return null;/);
  assert.match(pl,/STOP_INSIDE_'\+tf\+'_NOISE_LT_0\.6ATR/);
  const jd=fs.readFileSync(path.join(__dirname,'..','jev-decision.js'),'utf8');
  assert.match(jd,/'stopDistance='\+p\.stopPct\+'%'/);
  assert.match(jd,/AGAINST this side/);
});

test('plan seçenekleri davranış: COTI benzeri 0,55 ATR stop etiketlenir; <0,25 ATR sunulmaz; açık mum ters ise işaretlenir',()=>{
  const {buildSovereignPlanOptions}=require('../pipeline');
  const frame={available:true,fresh:true,atrPct:1.0,swingStructure:{lastConfirmedSwingHigh:{price:0.012922},lastConfirmedSwingLow:{price:0.0127}},
    prior20High:0.0129225,prior20Low:0.01268,liquidity:{buySide:0.01302,sellSide:0.01268},forming:{direction:'BULL',changeAtr:1.3,elapsedPct:40}};
  const opts=buildSovereignPlanOptions({livePrice:0.0128515,frames:{'15m':frame}});
  const s=opts.find(o=>o.id==='SHORT_15M_TRADE');
  assert.ok(s,'SHORT seçeneği var');
  assert.ok(s.stopAtr>0.5&&s.stopAtr<0.7,'stopAtr '+s.stopAtr);
  assert.match(String(s.geometryNote),/STOP_INSIDE_15m_NOISE/);
  assert.equal(s.formingOwnerTF.againstSide,true,'açık 15m mumu +1,3 ATR: SHORT için ters');
  const l=opts.find(o=>o.id==='LONG_15M_TRADE');
  assert.equal(l.formingOwnerTF.againstSide,false);
  const tight=buildSovereignPlanOptions({livePrice:100,frames:{'15m':{available:true,fresh:true,atrPct:1.0,swingStructure:{lastConfirmedSwingHigh:{price:100.1}},prior20High:null,liquidity:{}}}});
  assert.ok(!tight.some(o=>o.side==='SHORT'&&o.invalidationSource==='SWING'),'0,12 ATR stop dejenere → sunulmaz');
});
