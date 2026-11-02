'use strict';
// R2544.102 KARAR REAKTÖRÜ (kullanıcı 02.11: "afilli animasyonlar, daha afilli"): yalnız gösterim. Saf veri işlevi rxModel snapshot'tan
// kurulun son ORTAK kararını (masa ya da giriş), her modelin oyunu, pozisyon radarını (şu an / en iyi R, stop, 2R, hedef) ve son 40 işlemi çıkarır.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
const src=html.slice(html.indexOf('// RX_BEGIN'),html.indexOf('// RX_END'));
const ctx={console,Date,Math,Number,String,JSON,Array,Object};vm.createContext(ctx);vm.runInContext(src+';this.rxModel=rxModel;',ctx);
test('R2544.102 reactor model: the latest committee event wins (desk vs entry), every vote kept, radar R from the entry stop, best R from desk decisions, closes newest 40',()=>{
  const lot={symbol:'LABUSDT',side:'LONG',entryPrice:100,stopPrice:99,initialStopPrice:99,tpPrice:120,markPrice:100.55,part:{atR:2,done:false},
    desk:{decisions:[{R:0.7},{R:1.75},{R:1.1}]},deskInfo:{last:{at:2000,action:'TIGHTEN_STOP',authority:true,committee:{consensus:'REDUCE_MAJORITY',votes:[{m:'ROUTER:gemini/gemini-3.5-flash-lite',a:'TIGHTEN_STOP',s:'risk'},{m:'OR:nvidia/nemotron-3-ultra-550b-a55b:free',a:'HOLD',s:'yapı'}]}}}};
  const closes=Array.from({length:45},(_,i)=>({symbol:'C'+i+'USDT',rMultiple:i%3?-1:2,closedAt:new Date(Date.UTC(2026,9,1,0,i)).toISOString(),setup:'TOP3_X'}));
  const s={top3:{active:[lot],recentCloses:closes,positionDesk:{cmRecent:[{at:1000,symbol:'XANUSDT',side:'LONG',d:'SKIP',ag:true,c:'UNANIMOUS',blocked:true,v:[{m:'a',d:'SKIP'}]}],cmBoard:{rows:[{id:'ROUTER:gemini/x',healthy:true,inTeam:true},{id:'OR:y',healthy:false,inTeam:false}]}}},zirve5:{active:[],recentCloses:[]}};
  let m=ctx.rxModel(s);
  assert.equal(m.ev.kind,'MASA');assert.equal(m.ev.final,'TIGHTEN_STOP');assert.equal(m.ev.cons,'REDUCE_MAJORITY');assert.equal(m.ev.auth,true);
  assert.deepEqual(m.members.map(x=>x.m+'='+x.d),['gemini-3.5-flash-lite=TIGHTEN_STOP','nemotron-3-ultra-550b-a55b=HOLD']);
  const r=m.radars[0];assert.ok(Math.abs(r.now-0.55)<1e-9);assert.equal(r.best,1.75);assert.equal(r.stopR,-1);assert.equal(r.targetR,20);assert.equal(r.partR,2);
  assert.equal(m.closes.length,40);assert.equal(m.closes[0].s,'C44','newest first');assert.equal(m.healthy,1);assert.equal(m.total,2);
  assert.ok(m.ticker.some(t=>/XAN LONG: kurul GİRME — OYBİRLİĞİ → İŞLEM AÇILMADI/.test(t)));assert.ok(m.ticker.some(t=>/LAB masa: STOP ↑ — ÇOĞUNLUK: RİSKİ AZALT \(YETKİLİ\)/.test(t)));
  s.top3.positionDesk.cmRecent[0].at=3000;m=ctx.rxModel(s);assert.equal(m.ev.kind,'GİRİŞ');assert.equal(m.ev.final,'SKIP');assert.equal(m.ev.blocked,true);
  s.top3.positionDesk.cmRecent[0].ag=false;m=ctx.rxModel(s);assert.equal(m.ev.final,'RULE','no agreement: the rule decided');
  m=ctx.rxModel({});assert.equal(m.ev,null);assert.equal(m.radars.length,0);assert.equal(m.closes.length,0);
});
test('R2544.102 reactor wiring: section, canvas, ticker and strip exist; it runs on every snapshot; reduced motion respected; display only',()=>{
  assert.match(html,/<div class="cc-panel rx" id="rxCard"/); // R2544.104: inside the command centerassert.match(html,/<canvas id="rxCanvas"/);assert.match(html,/id="rxTrack"/);assert.match(html,/id="rxStrip"/);
  assert.match(html,/try\{renderReactor\(s\);\}catch\(e\)\{console\.warn\('reactor',e\);\}/);assert.match(html,/prefers-reduced-motion: reduce/);assert.match(html,/@media \(prefers-reduced-motion:reduce\)\{\.rx-track,\.rx-sq\{animation:none\}\}/);
  assert.doesNotMatch(src,/fetch\(|\/api\/control|postJson|top3Control|z5Control/,'the reactor never sends anything');
});
