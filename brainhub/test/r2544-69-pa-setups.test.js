'use strict';
// R2544.69 FİYAT HAREKETİ KURULUMLARI HER HATTA (user 21.10: "price action stratejilerini topla ... ZİRVE 5, İLK 3 VE NORMAL TRADE'DE
// DE BU STRATEJİLER TANIMLI OLMASI LAZIM"; "JEV'li çalışmasında doğru bilgiler taşıdığına kesinlikle emin ol"). The normal system's
// JEV packet carries the ZİRVE-5 zone state and the İlk 3 levels computed by the SAME functions the rule lanes trade with; the
// section survives the 48 kB trim; the level map carries the zone edges and the highs/lows.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const PA=require('../pa-setups'),Z=require('../zirve5'),T3=require('../top3-hunter');
const J=require('../jev-decision'),{marketPacket}=require('../jev-market-packet');
const M15=900000,DAY=86400000;
// raw Binance klines rows from candle objects
const rows=c=>c.map(x=>[x.openTime,String(x.open),String(x.high),String(x.low),String(x.close),'0',x.closeTime,String(x.quoteVolume),0,'0','0','0']);
function series(points,lastOpen,qv=1000){
  const out=[];for(let s=1;s<points.length;s++){const a=points[s-1],b=points[s];for(let i=1;i<=8;i++){const p=a+(b-a)*(i-1)/8,c=a+(b-a)*i/8;out.push([p,c]);}}
  const t0=lastOpen-(out.length-1)*M15;
  return out.map(([o,c],i)=>({openTime:t0+i*M15,closeTime:t0+(i+1)*M15-1,open:o,close:c,high:Math.max(o,c)+0.05,low:Math.min(o,c)-0.05,quoteVolume:qv}));
}
function z5Candles(lastOpen){
  const P=[100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,103,98,101.5,96,92,99.4];   // >= 128 candles, SHORT zone + confirmation
  const c=series(P,lastOpen-M15);c.push({openTime:lastOpen,closeTime:lastOpen+M15-1,open:99.6,close:98.6,high:99.65,low:98.55,quoteVolume:5000});return c;
}
const daily=now=>Array.from({length:40},(_,i)=>{const t=Math.floor(now/DAY)*DAY-(40-i)*DAY;return [t,'100',String(100+i*0.5),String(90-i*0.2),'100','0',t+DAY-1,'0'];});

test('R2544.69 one source: the packet section = the live ZİRVE-5 scan and the İlk 3 levels, from the same functions',()=>{
  const last=Date.UTC(2026,9,21,10,0),now=last+M15+5000,c=z5Candles(last);
  assert.ok(c.length>=128,'enough candles for parity with the live scan ('+c.length+')');
  const pa=PA.paSetups({rawFrames:{'15m':rows(c),'1d':daily(now)},now});
  assert.equal(pa.version,'R2544.69-PA-SETUPS');assert.equal(pa.readOnly,true);
  const z=pa.zirve5;assert.equal(z.available,true);assert.equal(z.tf,'15m');
  const sh=z.zones.find(x=>x.side==='SHORT'&&Math.abs(x.top-101.55)<1e-6);assert.ok(sh,JSON.stringify(z.zones));
  assert.equal(sh.state,'CONFIRMED');assert.equal(sh.confirmedOnLastCandle,true);assert.equal(sh.stateTr,'ONAY_MUMU_GELDI');
  // parity with what the ZİRVE-5 lane itself sees on the same closed candles
  const live=Z.videoScan(c);assert.equal(live.signals.length,1);
  assert.ok(Math.abs(live.signals[0].top-sh.top)<1e-6&&Math.abs(live.signals[0].bottom-sh.bottom)<1e-6&&Math.abs(live.signals[0].liquidity-sh.liquidityTarget)<1e-4&&Math.abs(live.signals[0].stopPrice-sh.stop)<1e-4);
  // a forming (not yet closed) candle is never used
  const pa2=PA.paSetups({rawFrames:{'15m':rows(c),'1d':daily(now)},now:last+60000});
  assert.notEqual(pa2.zirve5.zones.find(x=>x.side==='SHORT'&&Math.abs(x.top-101.55)<1e-6)?.confirmedOnLastCandle,true,'the confirmation candle is not closed yet');
  // İlk 3 levels = top3-hunter.dailyLevels
  const lv=T3.dailyLevels(daily(now).map(r=>[r[0],Number(r[1]),Number(r[2]),Number(r[3]),Number(r[4])]),now);
  assert.equal(pa.ilk3.available,true);assert.equal(pa.ilk3.levels.prevDayHigh,Number(lv.pdh.toPrecision(7)));assert.equal(pa.ilk3.levels.prev7dHigh,Number(lv.pwh.toPrecision(7)));
  assert.equal(pa.ilk3.levels.prev30dLow,Number(lv.pml.toPrecision(7)));
  // too few candles: says so, never guesses
  assert.equal(PA.paSetups({rawFrames:{'15m':rows(c.slice(-100)),'1d':[]},now}).zirve5.reason,'NEED_128_CLOSED_15M_CANDLES');
});

test('R2544.69 normal system packet: priceActionSetups + level map labels; the section is protected core truth in every JEV request',()=>{
  const last=Date.UTC(2026,9,21,10,0),now=last+M15+5000;
  const pa=PA.paSetups({rawFrames:{'15m':rows(z5Candles(last)),'1d':daily(now)},now});
  const u={symbol:'TESTUSDT',livePrice:98.7,frames:{},paSetups:pa};
  const p=marketPacket(u);
  assert.deepEqual(p.priceActionSetups,pa);
  const labels=[...(p.levelMap?.above||[]),...(p.levelMap?.below||[])].map(x=>x.k).join(' ');
  assert.match(labels,/Z5_SHORT_ZONE_TOP/);assert.match(labels,/Z5_SHORT_LIQ_TARGET/);
  const truth=J.protectedCoreTruth({state:{coreMarketPacket:p}});assert.deepEqual(truth.priceActionSetups,pa,'kept through every trim step');
  // wiring: market symbol context -> pipeline unified context -> packet
  const src=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
  assert.match(src('market.js'),/paSetups: \(\(\)=>\{try\{return require\('\.\/pa-setups'\)\.paSetups\(\{rawFrames:frames\.value\.rawFrames\|\|null,now\}\);\}catch\{return null;\}\}\)\(\)/);
  assert.match(src('pipeline.js'),/paSetups:symbol\?\.paSetups \|\| null/);
  assert.match(src('jev-market-packet.js'),/priceActionSetups:u\?\.paSetups\|\|null/);
});

test('R2544.69 the real 86 kB packet + priceActionSetups still fits 48 kB in a JEV request and keeps the section',async t=>{
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/r42-carv-r41-packet.json'),'utf8')).packet;
  const last=Date.UTC(2026,9,21,10,0),now=last+M15+5000;
  const pa=PA.paSetups({rawFrames:{'15m':rows(z5Candles(last)),'1d':daily(now)},now});
  const p={...JSON.parse(JSON.stringify(fixture)),priceActionSetups:pa};
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r69pa-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config','jev.json'),JSON.stringify({enabled:true,dailyCapUsd:2}));
  let sent=null;const reply=b=>({ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(b)});
  const c=J.createJevClient({root,apiKey:'sk-or-v1-fake',clock:()=>now,fetchImpl:async(_,o)=>{sent=o.body;return reply({answers:{zirve5_decision:{choice:'APPROVE_ENTRY'},zirve5_reason:{choice:'WEAK_RETEST'}},usage:{cost:0}});}});
  const zone={side:'SHORT',top:101.55,bottom:97.95,equilibrium:99.75,liquidity:91.95,zoneAt:last-20*M15,confirmAt:last+M15-1};
  const out=await c.sovereignZirve5Gate({symbol:p.symbol,signal:{ok:true,side:'SHORT',rule:'ZIRVE5_FIBO_SHORT',zone,maxHoldMs:24*3600000},features:{ok:true,rank:1,range24:0.3,change24:5,confirmBody:0.9,confirmVolMult:5,confirmClose:98.6},
    candle:last,chartContext:{available:true,symbol:p.symbol,packet:p,asOf:now,ageMs:1000,source:'TEST'}});
  assert.equal(out.ok,true,JSON.stringify(out));assert.ok(Buffer.byteLength(sent)<=48000,'bytes '+Buffer.byteLength(sent));
  const truth=J.protectedCoreTruth(JSON.parse(sent));assert.deepEqual(truth.priceActionSetups,pa);
});
