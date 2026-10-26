'use strict';
// R2544.79 (kullanıcı 26.10: "önerilerini yap ... beyin doğru çıkarımlar yapmış mı ... jevli/jevsiz canlıda bu çıkarımlarla karar verecek mi"):
// (1) 4 indikatörün giriş bilgisi YALNIZ BİLGİ olarak ZİRVE-5 ve İlk 3 v2 girişlerine yazılır; (2) v2/ZİRVE-5 kovaları boştu ('r24' v2
// özelliklerinde yok) -> kategori çıkarım tablosu; (3) gölge 'tecrübe kararı' (en az 15 ders, iki yarı aynı yön) kaydedilir ama girişi
// ENGELLEMEZ/AÇMAZ; (4) eski derslere indikatör bilgisi bir kez giriş anındaki mumlarla eklenir.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const IND=require('../ind-info'),T3=require('../top3-hunter');
const {writeTradingMode}=require('../binance-live-transport');
const M15=900000,M5=300000;
// strictly rising highs/lows, one spike (the only swing high) 30 bars back, strictly falling after it -> exactly one VDPM level above
function series(n,step=M15,t0=1790000000000){
  const c=[],k=n-30;
  for(let i=0;i<n;i++){const p=i<=k?100+i*0.05:100+k*0.05-(i-k)*0.03,o=p,cl=p+0.01,h=p+0.2,l=p-0.2;c.push([t0+i*step,o,h,l,cl,1e6]);}
  c[k][2]=c[k][4]+6;
  return c;
}
test('R2544.79 ind-info: information only; a shown opposite volume-pivot level inside 2R is an obstacle, beyond 2R is not',()=>{
  const c=series(600),last=c.at(-1)[4],pivot=c[c.length-30][2];
  const near=IND.infoAt(c,'LONG',last,last-(pivot-last)/1.5);          // level at 1.5R
  assert.equal(near.ok,true);assert.equal(near.informationOnly,true);assert.equal(near.version,'R2544.79-IND-INFO');
  assert.equal(near.vdpm.obstacle2R,true);assert.ok(near.vdpm.nearestR<=2);
  const far=IND.infoAt(c,'LONG',last,last-(pivot-last)/3);             // level at 3R
  assert.equal(far.vdpm.obstacle2R,false);
  assert.ok(['WITH','AGAINST','FLAT'].includes(near.lth.trend));assert.equal(typeof near.lrvp.trendWith,'boolean');assert.equal(typeof near.vwob.oppIn2R,'boolean');
  assert.equal(IND.infoAt(c.slice(0,20),'LONG',last,last-1).ok,false,'too few candles');
  assert.equal(IND.infoAt(c,'LONG',last,last+1).ok,false,'stop on the wrong side');
  assert.match(IND.infoText(near),/2R öncesi karşı hacim seviyesi VAR/);
});
test('R2544.79 inference table: v2 rules and ZİRVE-5 get categorical tables (the old r24 buckets were always empty for v2)',()=>{
  const ls=[];for(let i=0;i<6;i++)ls.push({rule:'LONG_EARLY_RETEST',verdict:i%2?'WIN':'LOSS',rMultiple:i%2?1:-1,closedAt:i,features:{levelName:'PWH',ind:{ok:true,vdpm:{obstacle2R:i<3},vwob:{oppIn2R:false},lth:{trend:'WITH'},lrvp:{trendWith:true,deltaWith:false}}}});
  const b=T3.experienceFor(ls,'LONG_EARLY_RETEST').buckets;
  assert.equal(b.categorical,true);
  const v=b.cats.find(c=>c.key==='vdpmObstacle2R');assert.deepEqual(v.rows.map(r=>[r.value,r.n]),[['EVET',3],['HAYIR',3]]);
  assert.ok(b.cats.find(c=>c.key==='levelName').rows[0].n===6);
  assert.equal(b.cats.find(c=>c.key==='lrvp').rows[0].value,'KARISIK');
  assert.equal(T3.experienceSummary([{rule:'ZIRVE5_FIBO_SHORT',rMultiple:-1,mode:'TEST',kind:'FRESH',features:{}}]).buckets.ZIRVE5_FIBO_SHORT.categorical,true);
  // v1 rules keep their numeric buckets
  assert.equal(T3.experienceFor([{rule:'SHORT_TOP_FADE',rMultiple:1,features:{dropFromPeak:0.3}}],'SHORT_TOP_FADE').buckets.feature,'dropFromPeak');
});
test('R2544.79 shadow experience: AVOID/FAVOR need >= 15 lots, both halves, a contrast with the other value AND the 6-month memory agreeing; never a gate',()=>{
  const mk=(n,r,obs,rule='ZIRVE5_FIBO_LONG',t0=0)=>Array.from({length:n},(_,i)=>({rule,rMultiple:typeof r==='function'?r(i):r,closedAt:t0+i,features:{ind:{ok:true,vdpm:{obstacle2R:obs}}}}));
  const f={ind:{ok:true,vdpm:{obstacle2R:true}}},good=mk(12,0.5,false,'ZIRVE5_FIBO_LONG',100);
  assert.equal(T3.experienceVerdict([...mk(14,-1,true),...good],'ZIRVE5_FIBO_LONG',f).verdict,'FEW');
  assert.equal(T3.experienceVerdict(mk(20,-1,true),'ZIRVE5_FIBO_LONG',f).findings[0].call,'NO_CONTRAST','no other-value lessons: the whole rule, not an inference');
  const a=T3.experienceVerdict([...mk(16,i=>i%4===0?0.5:-1,true),...good],'ZIRVE5_FIBO_LONG',f);
  assert.equal(a.verdict,'AVOID','recent lessons and the 6-month memory (obstacle -0.24R vs +0.17R) agree');assert.equal(a.shadow,true);assert.match(a.text,/tecrübe: GİRME \(gölge\)/);
  assert.equal(a.findings[0].labN,T3.LAB_PRIORS.ZIRVE5_FIBO_LONG.vdpmObstacle2R.EVET.n);
  // negative on average but the newer half is positive -> not AVOID
  assert.notEqual(T3.experienceVerdict([...mk(16,i=>i<8?-1.5:0.3,true),...good],'ZIRVE5_FIBO_LONG',f).verdict,'AVOID');
  // FAVOR: no obstacle wins, obstacle loses, and the 6-month memory agrees
  const fv=T3.experienceVerdict([...mk(20,i=>i%3===0?-0.5:1,false),...mk(12,-1,true,'ZIRVE5_FIBO_LONG',100)],'ZIRVE5_FIBO_LONG',{ind:{ok:true,vdpm:{obstacle2R:false}}});
  assert.equal(fv.verdict,'FAVOR');
  // recent lessons say PWH breakouts lose, 6 months say no difference -> no AVOID, the text says so
  const pw=(n,r)=>Array.from({length:n},(_,i)=>({rule:'LONG_EARLY_RETEST',rMultiple:r,closedAt:i,features:{levelName:'PWH'}})),pm=Array.from({length:12},(_,i)=>({rule:'LONG_EARLY_RETEST',rMultiple:0.4,closedAt:50+i,features:{levelName:'PMH'}}));
  const d=T3.experienceVerdict([...pw(18,-0.6),...pm],'LONG_EARLY_RETEST',{levelName:'PWH'});
  assert.notEqual(d.verdict,'AVOID');assert.equal(d.findings.find(x=>x.key==='levelName').call,'LAB_DISAGREES');assert.match(d.text,/6 ay aksini söylüyor/);
  assert.equal(T3.experienceVerdict([],'SHORT_TOP_FADE',f).verdict,'NO_TABLE');
  assert.ok(T3.experienceFor([],'LONG_EARLY_RETEST').labPriors.vdpmObstacle2R.EVET.n>=50,'JEV gets the long-term memory too');
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(lc,/ef\.experience=top3Lib\.experienceVerdict\(z\.lessons,rule,ef\)/);assert.match(lc,/ef\.experience=top3Lib\.experienceVerdict\(top3State\.lessons,x\.rule,ef\)/);
  assert.doesNotMatch(lc,/experience\??\.verdict\s*===?\s*'AVOID'/,'the shadow verdict never blocks an entry');
  assert.doesNotMatch(lc,/ind\??\.vdpm\??\.obstacle2R\s*\)?\s*\{?\s*res\.reason|obstacle2R[^;\n]{0,40}continue/,'the indicator info never blocks an entry');
});
test('R2544.79 wiring: ZİRVE-5 and İlk 3 v2 signals carry the indicator info (1000 closed candles); Office shows it; deploy lists the module',()=>{
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8'),oh=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.match(lc,/s\.ind=await indInfoFor\(r\.symbol,'15m',bar\+z5Lib\.M15-1,s\.side,c\.at\(-1\)\.close,s\.stopPrice,2\*24\*TOP3_HOUR\)/);
  assert.match(lc,/const ind=await top3IndFor\(s,side,tr,k5,lvAt,cfg,bar\)/);assert.match(lc,/limit:'1000'/);
  assert.match(lc,/mtf:sg\.mtf\|\|null,ind:sg\.ind\|\|null\}/);assert.match(lc,/pa:x\.pa\|\|null,ind:x\.ind\|\|null\}/);
  assert.match(oh,/function indLine\(ind,exp\)/);assert.match(oh,/catTables\(rule,b\)/);assert.match(oh,/indLine\(a\.indInfo,a\.experienceInfo\)/);assert.match(oh,/indLine\(a\.ind,a\.experience\)/);
  for(const f of ['manage.ps1','jev-brain/JEV-DEPLOY.ps1'])assert.ok(fs.readFileSync(path.join(__dirname,'..',f),'utf8').includes("'ind-info.js'"),f);
  assert.equal((fs.readFileSync(path.join(__dirname,'..','jev-decision.js'),'utf8').match(/state\.inferenceNote=/g)||[]).length,3,'all three JEV gates');
});
test('R2544.79 backfill: older v2 / ZİRVE-5 lessons get the indicator info once from the candles before their entry; v1 lessons are left alone',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r79-'));fs.mkdirSync(path.join(root,'config'));fs.mkdirSync(path.join(root,'data'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:false,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  writeTradingMode(root,{mode:'TEST',testAutoRun:false});
  const now=1792000000000,k15=series(1000,M15,now-1100*M15),k5=series(1000,M5,now-1100*M5);
  const e15=k15.at(-1)[4],e5=k5.at(-1)[4];
  const lessons=[{id:'a',symbol:'AUSDT',side:'LONG',rule:'LONG_EARLY_RETEST',entryPrice:e5,stopPct:0.02,openedAt:k5.at(-1)[0]+M5+5000,closedAt:now-1000,rMultiple:-1,features:{levelName:'PDH'}},
    {id:'b',symbol:'BUSDT',side:'SHORT',rule:'SHORT_TOP_FADE',entryPrice:1,stopPct:0.02,openedAt:now-5e6,closedAt:now-1000,rMultiple:1,features:{}}];
  const z5Lessons=[{id:'c',symbol:'CUSDT',side:'SHORT',rule:'ZIRVE5_FIBO_SHORT',entryPrice:e15,stopPct:0.03,openedAt:k15.at(-1)[0]+M15+9000,closedAt:now-1000,rMultiple:0.5,features:{}}];
  fs.writeFileSync(path.join(root,'data','top3-hunter-state.json'),JSON.stringify({active:{},pendingCloses:[],recentCloses:[],lessons,z5:{lessons:z5Lessons}}));
  const calls=[];const ok=b=>({ok:true,status:200,async text(){return JSON.stringify(b);}});
  const fetchImpl=async(url,o={})=>{const u=new URL(url),p=u.pathname;calls.push(p+'?'+u.searchParams.toString());
    if(p==='/fapi/v1/klines'){const iv=u.searchParams.get('interval'),src=iv==='15m'?k15:k5,end=Number(u.searchParams.get('endTime'));return ok(src.filter(r=>r[0]<=end).map(r=>[r[0],String(r[1]),String(r[2]),String(r[3]),String(r[4]),'0',r[0]+1,String(r[5])]));}
    if(p==='/fapi/v1/time')return ok({serverTime:now});
    return ok([]);};
  const ctl=require('../live-controller').createLiveController({root,clock:()=>now,store:{journal:()=>{}},scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),
    credentials:{apiKey:'fake-r79-key',apiSecret:'fake-r79-secret'},fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST',market:{marketStream:{ensureSymbol(){},symbols:new Set()}}});
  for(let i=0;i<3;i++)await ctl.top3Tick();
  const st=ctl._testTop3State();
  const A=st.lessons.find(l=>l.id==='a'),B=st.lessons.find(l=>l.id==='b'),Cz=st.z5.lessons.find(l=>l.id==='c');
  assert.equal(A.features.ind.ok,true);assert.equal(A.features.ind.backfilled,true);assert.equal(A.features.levelName,'PDH','other features kept');
  assert.equal(Cz.features.ind.ok,true);
  assert.equal(B.features.ind,undefined,'v1 rule untouched');
  assert.equal(st.indBackfill.done,true);
  // the candles are the ones BEFORE the entry (endTime before openedAt), 5m for İlk 3, 15m for ZİRVE-5
  const kl=calls.filter(c=>c.startsWith('/fapi/v1/klines'));
  assert.ok(kl.some(c=>/interval=5m/.test(c)&&Number(new URLSearchParams(c.split('?')[1]).get('endTime'))<A.openedAt));
  assert.ok(kl.some(c=>/interval=15m/.test(c)&&Number(new URLSearchParams(c.split('?')[1]).get('endTime'))<Cz.openedAt));
  const n=kl.length;await ctl.top3Tick();assert.equal(calls.filter(c=>c.startsWith('/fapi/v1/klines')).length,n,'runs once');
});
