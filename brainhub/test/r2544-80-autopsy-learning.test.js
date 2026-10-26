'use strict';
// R2544.80 (kullanıcı 26.10: "zarar eden işlemlerde kesinlikle neden zarar ettiğini, kâr edenlerde nasıl kazandığını net çıkarım
// yapması ... tek bir kurala odaklanmaması ... her zaman aynı koşulda kazandım veya kaybettim dememeli ... tek düze bir beyin oluşmasın").
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const A=require('../trade-autopsy'),T3=require('../top3-hunter');
const {writeTradingMode}=require('../binance-live-transport');
const M5=300000,H=3600000,T0=1792000000000;
// 5m path: flat 3 h before entry at 100, then the given closes (high/low = close ± 0.05), volume v
function path5(closes,{pre=36,vol=1000,volAfter=null}={}){
  const k=[];for(let i=0;i<pre;i++)k.push([T0-(pre-i)*M5,100,100.05,99.95,100,0,0,vol]);
  closes.forEach((c,i)=>{const o=i?closes[i-1]:100;k.push([T0+i*M5,o,Math.max(o,c)+0.05,Math.min(o,c)-0.05,c,0,0,volAfter??vol]);});return k;
}
const btc=(pct)=>{const k=[];let prev=100;for(let i=-36;i<600;i++){const p=i<0?100:100*(1+pct/100*Math.min(1,(i+1)/2));k.push([T0+i*M5,prev,Math.max(prev,p),Math.min(prev,p),p,0,0,1]);prev=p;}return k;};
const lesson=(o)=>({side:'LONG',entryPrice:100,stopPct:0.02,targetPct:0.06,openedAt:T0+1000,rMultiple:-1.05,exitType:'TOP3_STOP',tags:['STOPPED'],...o});
test('R2544.80 autopsy: a loss whose direction was right (stop hunted, fast reversal) vs a loss whose direction was wrong',()=>{
  // stop (98) hit in the 2nd candle, then price runs to 102.5 (+1R) before 96 (1R beyond the stop)
  const hunt=path5([99.5,97.9,99,100.5,101,102.5,103,...Array(300).fill(103)]);
  const a=A.autopsy(lesson({closedAt:T0+2*M5-1}),hunt,btc(0),{now:T0+3*24*H});
  assert.equal(a.ok,true);assert.equal(a.outcome,'KAYIP');assert.equal(a.direction,'DOGRU');assert.ok(a.causes.includes('STOP_AVI'));assert.ok(a.causes.includes('HIZLI_TERS'));
  assert.equal(a.complete,true);assert.match(a.text,/Yön doğruydu ama zarar/);
  const wrong=path5([99.5,97.9,97,96.5,95.9,95,...Array(300).fill(95)]);
  const b=A.autopsy(lesson({closedAt:T0+2*M5-1}),wrong,btc(-1.2),{now:T0+3*24*H});
  assert.equal(b.direction,'YANLIS');assert.ok(b.causes.includes('YANLIS_YON'));assert.ok(b.causes.includes('PIYASA_TERS'),'BTC fell 1.2 % during a LONG');
  assert.equal(b.factors.btc,'TERS');
  // before 24 h after the exit the direction is not judged as complete
  assert.equal(A.autopsy(lesson({closedAt:T0+2*M5-1}),wrong.slice(0,60),btc(0),{now:T0+5*H}).complete,false);
});
test('R2544.80 autopsy: wins say HOW they won (clean, market support, volume, target too early) - and the same factors are measured for every trade',()=>{
  const run=path5([100.5,101,102,103,104,105,106,106.5,108,110,112,114,...Array(300).fill(114)],{volAfter:3000});
  const a=A.autopsy(lesson({closedAt:T0+6*M5-1,rMultiple:2.9,exitType:'TOP3_TAKE_PROFIT',tags:['TARGET_HIT'],targetPct:0.06}),run,btc(1.0),{now:T0+3*24*H});
  assert.equal(a.outcome,'KAZANC');for(const c of ['TEMIZ_DEVAM','PIYASA_DESTEGI','HACIMLI_TAKIP','HEDEF_ERKEN'])assert.ok(a.causes.includes(c),c);
  assert.deepEqual(Object.keys(a.factors).sort(),['btc','gecGiris','hacim','seviye2R']);
  assert.equal(a.factors.hacim,'GUCLU');
});
test('R2544.80 learning: a factor is a lesson only if it SEPARATES losses from wins; one seen as often in both is "not a cause alone"',()=>{
  const mk=(n,outcome,factors,rule='SHORT_TOP_BREAK')=>Array.from({length:n},(_,i)=>({rule,rMultiple:outcome==='KAYIP'?-1:1.5,autopsy:{ok:true,outcome,direction:outcome==='KAYIP'?(i%2?'YANLIS':'DOGRU'):null,causes:outcome==='KAYIP'?['YANLIS_YON']:['TEMIZ_DEVAM'],factors:typeof factors==='function'?factors(i):factors}}));
  const xs=[...mk(10,'KAYIP',i=>({gecGiris:i<7,hacim:i<6?'YOK':'NORMAL',btc:'NOTR'})),...mk(10,'KAZANC',i=>({gecGiris:i<7,hacim:i<2?'YOK':'NORMAL',btc:i<6?'YONDE':'NOTR'}))];
  const c=T3.causeStats(xs,'SHORT_TOP_BREAK');
  const f=(k,v)=>c.factors.find(x=>x.key===k&&x.value===v);
  assert.equal(f('gecGiris',true).call,'IKI_TARAFTA','70 % of losses AND wins -> not a cause');
  // R2544.81: 'no volume' separates these recent lessons, but over 6 months TEPE SHORT losses and wins have it equally (25 % / 25 %) -> not a lesson
  assert.equal(f('hacim','YOK').call,'TEST_ONLY');assert.ok(c.text.some(t=>/6 ayda TUTMUYOR/.test(t)));
  // 'BTC with the trade' separates the recent lessons AND the 6-month memory (5 % / 31 %) -> a lesson
  assert.equal(f('btc','YONDE').call,'KAZANC_TARAFI');assert.equal(f('btc','YONDE').labWinPct,T3.LAB_FACTORS.SHORT_TOP_BREAK['btc:YONDE'].winPct);
  assert.ok(c.text.some(t=>/6 aylık hafıza/.test(t)&&/giriş kararı değil/.test(t)),'BTC / volume are known only during the trade');
  assert.ok(c.text.some(t=>/Tek başına neden DEĞİL/.test(t)));assert.ok(c.text.some(t=>/Ayırt edici/.test(t)));
  assert.equal(c.lossDirection.DOGRU,5);
  // too few lessons -> no distinction claimed at all
  const few=T3.causeStats(xs.slice(0,5).concat(xs.slice(10,14)),'SHORT_TOP_BREAK');
  assert.ok(few.factors.every(x=>x.call==='AZ_ORNEK'));assert.ok(few.text.some(t=>/en az 8/.test(t)));
});
test('R2544.80 similar cases: many features, at most 2 per coin, outcomes WITH causes, "mixed" and "thin" warnings; never a gate',()=>{
  const f={ind:{ok:true,vdpm:{obstacle2R:false},vwob:{oppIn2R:false},lth:{trend:'WITH'},lrvp:{trendWith:true,deltaWith:true}},entryCtx:{preRunR:0.3,btc1hWith:0.1},stopPct:0.025,levelName:'PWH'};
  const ls=[];for(let i=0;i<12;i++)ls.push({rule:'LONG_EARLY_RETEST',symbol:i<5?'AUSDT':'C'+i+'USDT',openedAt:T0+i*86400000,closedAt:T0+i*86400000+H,stopPct:0.025,rMultiple:i%2?1.2:-1,
    features:{...f,entryCtx:undefined},autopsy:{ok:true,outcome:i%2?'KAZANC':'KAYIP',causes:i%2?['TEMIZ_DEVAM']:['HIZLI_TERS'],metrics:{preRunR:0.3,btc1hWith:0.1}}});
  const s=T3.similarCases(ls,'LONG_EARLY_RETEST',f);
  assert.ok(s.n>=5&&s.n<=8);assert.ok(s.cases.filter(c=>c.symbol==='AUSDT').length<=2,'diversity: max 2 per coin');
  assert.equal(s.mixed,true);assert.match(s.text,/SONUÇLAR KARIŞIK/);assert.match(s.text,/kayıplar: hızlı ters dönüş/);assert.match(s.text,/kazançlar: temiz devam/);
  assert.equal(T3.similarCases([],'LONG_EARLY_RETEST',f).text,'benzer geçmiş durum yok');
  const e=A.entryContext(path5([100,100,100,100,100,101.5]).slice(-6),'LONG',101.5,99.5,btc(0));assert.ok(e.preRunR>=0.7);assert.equal(e.stopPct,Number((2/101.5).toFixed(4)));
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.doesNotMatch(lc,/similar\??\.(avgR|mixed|losses)[^;\n]{0,60}(continue|res\.reason)/,'similar cases never block an entry');
  assert.match(lc,/experienceFor\(top3State\.lessons,x\.rule,\{features:ef\}\)/);assert.match(lc,/similar:top3Lib\.similarForJev\(top3Lib\.similarCases\(z\.lessons,rule,ef\)\)/);
  for(const f2 of ['manage.ps1','jev-brain/JEV-DEPLOY.ps1'])assert.ok(fs.readFileSync(path.join(__dirname,'..',f2),'utf8').includes("'trade-autopsy.js'"),f2);
  const oh=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');assert.match(oh,/neden \/ nasıl/);
  assert.equal((fs.readFileSync(path.join(__dirname,'..','jev-decision.js'),'utf8').match(/laneExperience\.similar = the most similar/g)||[]).length,3);
});
test('R2544.80 live: a closed lesson gets a provisional autopsy after 30 min and the complete one after 24 h (5m candles of the coin and BTC)',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r80-'));fs.mkdirSync(path.join(root,'config'));fs.mkdirSync(path.join(root,'data'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:false,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  writeTradingMode(root,{mode:'TEST',testAutoRun:false});
  const L=lesson({id:'x',symbol:'AUSDT',rule:'LONG_EARLY_RETEST',closedAt:T0+2*M5-1,features:{ind:{ok:true,backfilled:true}}});
  fs.writeFileSync(path.join(root,'data','top3-hunter-state.json'),JSON.stringify({active:{},pendingCloses:[],recentCloses:[],lessons:[L],z5:{lessons:[]},indBackfill:{done:true}}));
  const coin=path5([99.5,97.9,99,100.5,101,102.5,103,...Array(320).fill(103)]),bt=btc(0);let now=T0+40*60000;const calls=[];
  const ok=b=>({ok:true,status:200,async text(){return JSON.stringify(b);}});
  const fetchImpl=async(url)=>{const u=new URL(url),p=u.pathname;calls.push(u.searchParams.get('symbol'));
    if(p==='/fapi/v1/klines'){const src=u.searchParams.get('symbol')==='BTCUSDT'?bt:coin,a=Number(u.searchParams.get('startTime')),b=Number(u.searchParams.get('endTime'));return ok(src.filter(r=>r[0]>=a&&r[0]<=b&&r[0]+M5<=now));}
    if(p==='/fapi/v1/time')return ok({serverTime:now});return ok([]);};
  const ctl=require('../live-controller').createLiveController({root,clock:()=>now,store:{journal:()=>{}},scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),
    credentials:{apiKey:'fake-r80-key',apiSecret:'fake-r80-secret'},fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST',market:{marketStream:{ensureSymbol(){},symbols:new Set()}}});
  await ctl.top3Tick();
  let x=ctl._testTop3State().lessons[0];
  assert.equal(x.autopsy.ok,true);assert.equal(x.autopsy.complete,false,'provisional');assert.ok(calls.includes('BTCUSDT'));
  now=T0+25*H;await ctl.top3Tick();x=ctl._testTop3State().lessons[0];
  assert.equal(x.autopsy.complete,true);assert.equal(x.autopsy.direction,'DOGRU');assert.ok(x.autopsy.causes.includes('STOP_AVI'));
  const n=calls.length;await ctl.top3Tick();assert.equal(calls.filter(c=>c).length,n,'done once complete');
  const st=ctl.top3Status();assert.ok(st.learning.causes.LONG_EARLY_RETEST.some(t=>/Kayıplar \(1\)/.test(t)));assert.match(st.learning.autopsies[0].text,/stop avlandı/);
});
