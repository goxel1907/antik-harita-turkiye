'use strict';
// R2544.148 KEŞİF end to end: a round asks every model for its own forecast, the forecasts are followed on real 5m candles and scored,
// and NOTHING is ever sent to the exchange (shadow).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {writeTradingMode}=require('../binance-live-transport');
const M5=300000,H=3600000;
const FAKE={apiKey:'fake-test-key-r148',apiSecret:'fake-test-secret-r148'}; // made-up, never real
const ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
function fixture({answers,poll=true}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r148-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:false,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify({enabled:false}));
  fs.writeFileSync(path.join(root,'config','zirve5.json'),JSON.stringify({enabled:false}));
  writeTradingMode(root,{mode:'TEST',changedAt:'2026-11-11T08:00:00.000Z',testStartedAt:null,testAutoRun:true});
  const T0=Math.floor(Date.UTC(2026,10,11,12,0)/M5)*M5;
  const state={now:T0+20000,calls:[],asked:[],future:[]}; // future = 5m candles after the round (set by the test)
  const hist=(ms,n,end)=>Array.from({length:n},(_,i)=>{const t=Math.floor(end/ms)*ms-(n-i)*ms,o=100*(1+i*0.0005),c=o*1.0004;return [t,String(o),String(c*1.001),String(o*0.999),String(c),'1000',t+ms-1,'100000',10,'500','50000','0'];});
  const fetchImpl=async(url,o={})=>{const u=new URL(url),p=u.pathname,m=o.method||'GET';state.calls.push({m,p,q:Object.fromEntries(u.searchParams)});
    if(p==='/fapi/v1/time')return ok({serverTime:state.now});
    if(p==='/fapi/v1/exchangeInfo')return ok({symbols:[]});
    if(p==='/fapi/v1/ticker/24hr')return ok([{symbol:'UPUSDT',priceChangePercent:'42',quoteVolume:'90000000',closeTime:state.now},{symbol:'DOWNUSDT',priceChangePercent:'-25',quoteVolume:'50000000',closeTime:state.now},{symbol:'THINUSDT',priceChangePercent:'80',quoteVolume:'1000',closeTime:state.now}]);
    if(p==='/fapi/v1/premiumIndex')return ok({symbol:u.searchParams.get('symbol'),lastFundingRate:'0.0003',markPrice:'104.1',indexPrice:'104'});
    if(p==='/fapi/v1/klines'){const i=u.searchParams.get('interval'),st=u.searchParams.get('startTime');
      if(st)return ok(state.future.filter(r=>r[0]>=Number(st)));
      const ms={'5m':M5,'15m':3*M5,'1h':H,'4h':4*H,'1d':24*H}[i];return ok(hist(ms,80,Number(u.searchParams.get('endTime'))));}
    return ok({});
  };
  const events=[];
  const committee=poll?{poll:async a=>{const per=answers.map(([member])=>typeof a.prompt==='function'?a.prompt(member):a.prompt);state.asked.push({...a,prompt:per[0],perMember:per});const votes=answers.map(([member,text])=>{const v=a.parse(text);return {member,ok:v.ok,vote:v.ok?v:null,error:v.ok?null:v.reason,img:/vision/.test(member)};});
    return {ok:votes.some(v=>v.ok),votes,asked:votes.length};},decide:async()=>({ok:false,reason:'NOT_USED'}),status:()=>({members:[],team:[]})}:{decide:async()=>({ok:false}),status:()=>({members:[],team:[]})};
  const controller=require('../live-controller').createLiveController({root,clock:()=>state.now,store:{journal:(k,s,p)=>events.push({k,s,p}),recordLearning:()=>{}},
    scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),credentials:FAKE,fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST',deskJudges:{committee},
    market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}}}});
  return {root,state,events,controller,T0,kinds:k=>events.filter(e=>e.k===k)};
}
const ANS=[
  ['KILO:vision/a','{"direction":"LONG","stopPct":2,"targetPct":4,"horizonH":2,"confidence":80,"reasonTr":"süpürme sonrası yukarı","wrongIfTr":"dip kırılırsa"}'],
  ['OVH:model-b','{"direction":"LONG","stopPct":3,"targetPct":3,"horizonH":1,"confidence":55,"reasonTr":"trend yukarı"}'],
  ['ROUTER:nvidia/model-c','{"direction":"SHORT","stopPct":2,"targetPct":6,"horizonH":4,"confidence":60,"reasonTr":"tepe yorgun"}'],
  ['ROUTER:nvidia/model-d','{"direction":"LONG","stopPct":2.5,"targetPct":5,"horizonH":3,"confidence":40,"reasonTr":"hacim alıcıda"}'],
  ['KILO:model-e','{"direction":"NONE","confidence":30,"reasonTr":"okunur hamle yok"}'],
  ['OVH:model-f','bozuk cevap']];

test('R2544.148 a round: one coin, no plan in the packet, every model its own forecast, the crowd as ORTAK; nothing reaches the exchange', async()=>{
  const f=fixture({answers:ANS});
  const out=await f.controller._testKesifTick();
  assert.deepEqual(out.round,{symbol:'UPUSDT',answered:5,asked:6});
  const a=f.state.asked[0],pk=JSON.parse(a.prompt);
  assert.equal(pk.task,'FORECAST');assert.equal(pk.plan,undefined);assert.ok(!/UPUSDT/.test(a.prompt),'the coin name is hidden');assert.match(a.system,/Nobody hands you a setup/);
  assert.equal(a.filter('ROUTER:gemini/gemini-3.5-flash-lite'),false,'daily-pool members stay with the desk by default');assert.equal(a.filter('FREE:openrouter'),false);assert.equal(a.filter('OVH:x'),true);assert.equal(a.filter('ROUTER:nvidia/y'),true);assert.equal(a.filter('ROUTER:groq/llama-x'),false,'Groq: 8K tokens, the screen would 413');assert.equal(a.filter('ROUTER:cerebras/x'),false,'not free');
  const s=f.controller._testKesifState();
  assert.deepEqual(s.open.filter(r=>r.model!=='_ETIKET').filter(r=>!r.model.startsWith('PUSU:')&&r.model!=='BEYIN2').map(r=>[r.model,r.side]).sort(),[['BEYIN','NONE'],['ORTAK','LONG'],['model-b','LONG'],['model-e','NONE'],['nvidia/model-c','SHORT'],['nvidia/model-d','LONG'],['vision/a','LONG']].sort());
  // the brain: silent while its matrix learns; the neutral label (up / down first by the band in 6 h) carries the formations of the screen
  assert.match(s.open.find(r=>r.model==='BEYIN').why,/matris öğreniyor \(0\/20/);
  const lab=s.open.find(r=>r.model==='_ETIKET');assert.ok(lab&&lab.feats.length>5&&lab.horizonH===6&&lab.stopPct===lab.targetPct);
  {const ps=JSON.parse(f.state.asked[0].perMember.find(x=>JSON.parse(x).brain));assert.match(ps.brain.method,/selective average/,'R2544.152: the learning brain briefs the models');assert.equal(ps.brain.labelledRounds,0);assert.equal(ps.brain.ready,false);assert.ok(Array.isArray(ps.desk.rows));} // a seeing seat (R2544.151: blind seats get no brain summary)
  assert.deepEqual(s.open.find(r=>r.model==='ORTAK').stopPct,2.5,'3 of 5 answers LONG = 60% -> the median stop of those three');
  assert.equal(s.open.find(r=>r.model==='vision/a').img,true);assert.ok(s.open.filter(r=>r.side!=='NONE'&&r.model!=='_ETIKET').every(r=>r.entryAt===f.T0+M5&&r.symbol==='UPUSDT'));
  // R2544.149: the brain learns from every scanned coin (one label per coin and hour), each with its probability written before the outcome
  assert.deepEqual(s.open.filter(r=>r.model==='_ETIKET').map(r=>r.symbol).sort(),['DOWNUSDT','UPUSDT']);assert.ok(s.open.filter(r=>r.model==='_ETIKET').every(r=>Number.isFinite(r.brainP)&&Number.isFinite(r.baseP)));
  assert.equal(f.kinds('KESIF_FORECAST').length,1);assert.equal(f.kinds('KESIF_FORECAST')[0].p.errors[0].m,'model-f');
  assert.ok(fs.existsSync(path.join(f.root,'data','kesif-state.json')));
  // the NONE answer is on the book at once (never scored, never punished)
  const st0=f.controller.kesifStatus();assert.equal(st0.shadow,true);assert.equal(st0.counts.open,13,'7 + 5 ambush twins of the directional forecasts + BEYIN-2 (R2544.150)');
  assert.deepEqual(s.open.filter(r=>r.model.startsWith('PUSU:')).map(r=>[r.model,r.side]).sort(),[['PUSU:ORTAK','SHORT'],['PUSU:model-b','SHORT'],['PUSU:nvidia/model-c','LONG'],['PUSU:nvidia/model-d','SHORT'],['PUSU:vision/a','SHORT']]);
  assert.ok(f.state.asked[0].perMember.every(x=>{const j=JSON.parse(x);return j.yourRole&&j.yourRecord;}),'every model got its own role and record');
  assert.ok(new Set(f.state.asked[0].perMember.map(x=>JSON.parse(x).yourRole.name)).size>=2,'not one lens for everybody');
  // R2544.151 SÜRÜ KIRICI: 6 seats -> 6 different lenses; the blind seats do not see the desk brain or the others' record
  {const pm=f.state.asked[0].perMember.map(x=>JSON.parse(x));assert.equal(new Set(pm.map(j=>j.yourRole.name)).size,pm.length,'no lens twice in a round of <= 7 seats');
   const blind=pm.filter(j=>['PUSU','AVUKAT','LIKIDITE'].includes(j.yourRole.name)),seeing=pm.filter(j=>!['PUSU','AVUKAT','LIKIDITE'].includes(j.yourRole.name));
   assert.ok(blind.length>=2&&seeing.length>=2);assert.ok(blind.every(j=>j.brain===undefined&&j.desk===undefined&&j.yourRole.seat&&j.timeframes&&j.traces!==null),'blind: screen and traces only');assert.ok(seeing.every(j=>j.brain&&j.desk));
   assert.ok(s.open.filter(r=>r.sight).every(r=>r.sight==='KOR'?['PUSU','AVUKAT','LIKIDITE'].includes(r.role):!['PUSU','AVUKAT','LIKIDITE'].includes(r.role)),'every forecast carries its seat');}
  assert.ok(Number.isFinite(f.kinds('KESIF_FORECAST')[0].p.herd));assert.ok(f.kinds('KESIF_FORECAST')[0].p.forecasts.some(x=>x.r),'the role of every forecast is on the book');
  assert.ok(s.open.find(r=>r.model==='_ETIKET'&&r.symbol==='UPUSDT').feats.some(x=>x.startsWith('oy:')),'who voted what is in the brain\'s label');assert.equal(st0.counts.labelsOpen,2);assert.equal(st0.matrix.total.n||0,0);
  assert.ok(!f.state.calls.some(c=>c.m!=='GET'),'only public GET requests');
  // the next tick inside the cadence asks nobody again
  f.state.now+=60000;await f.controller._testKesifTick();assert.equal(f.state.asked.length,1);
});

test('R2544.148 outcomes: the real candles decide (target first, stop first, horizon); the karne is rebuilt; a later round takes the next coin', async()=>{
  const f=fixture({answers:ANS});await f.controller._testKesifTick();
  const E=f.T0+M5,c=(i,o,h,l,cl)=>[E+i*M5,String(o),String(h),String(l),String(cl),'1000',E+(i+1)*M5-1,'100000',10,'500','50000','0'];
  // entry 100: rises to 104.2 on the 3rd candle (the 2% / 4% LONG wins +2R, the SHORT with a 2% stop loses), never touches 97
  f.state.future=[c(0,100,100.4,99.8,100.3),c(1,100.3,101.6,100.2,101.5),c(2,101.5,104.2,101.4,104)];
  f.state.now=E+3*M5+5000;const out=await f.controller._testKesifTick();
  assert.ok(out.resolved>=3);
  const s=f.controller._testKesifState(),by=m=>s.closed.find(r=>r.model===m);
  assert.deepEqual([by('vision/a').outcome,by('vision/a').R],['TARGET',+(2-0.14/2).toFixed(3)]);
  assert.deepEqual([by('nvidia/model-c').outcome,by('nvidia/model-c').R],['STOP',+(-1-0.14/2).toFixed(3)]);
  assert.deepEqual([by('model-b').outcome,by('model-b').R],['TARGET',+(1-0.14/3).toFixed(3)]);
  assert.deepEqual([by('model-e').outcome,by('model-e').R],['NONE',null],'NONE is on the book as an abstention, never scored');
  assert.deepEqual(s.open.filter(r=>!r.done&&r.symbol==='UPUSDT'&&!r.model.startsWith('PUSU:')).map(r=>r.model),['nvidia/model-d'],'the 2,5% / 5% forecast is still running');
  // R2544.150 PUSU: the exact opposite of every forecast is scored too - the LONG that won makes its twin SHORT lose, the SHORT that lost makes its twin LONG still run
  assert.deepEqual([by('PUSU:vision/a').side,by('PUSU:vision/a').outcome],['SHORT','STOP']);
  assert.ok(s.open.some(r=>!r.done&&r.model==='PUSU:nvidia/model-c'&&r.side==='LONG'),'the twin of the losing SHORT is a LONG, still running');
  assert.deepEqual([by('ORTAK').outcome,by('ORTAK').R],['TARGET',+(4/2.5-0.14/2.5).toFixed(3)],'the crowd (median 2,5% stop / 4% target) is scored like a member');
  assert.ok(f.kinds('KESIF_OUTCOME').length>=3);
  // the label of round 1 (band = 1,5 x 1h ATR) resolved UP on the +4% move -> the matrix has its first round and the formations of that screen
  const mx=f.controller.kesifStatus().matrix;assert.equal(mx.total.n,2,'both scanned coins were labelled (R2544.149)');assert.equal(mx.total.UP,2);
  assert.equal(f.controller.kesifStatus().learning.all.n,2);assert.equal(f.controller.kesifStatus().learning.state,'KANIT_YOK','two labels prove nothing');assert.ok(mx.formations>5);assert.equal(f.kinds('KESIF_MATRIX')[0].p.label,'UP');
  assert.ok(!f.controller.kesifStatus().karne.rows.some(r=>r.model==='_ETIKET'));
  const k=f.controller.kesifStatus().karne;assert.equal(k.rows.find(r=>r.model==='vision/a').n,1);assert.equal(k.rows.find(r=>r.model==='vision/a').state,'YENI','one result proves nothing');assert.deepEqual(k.leaders,[]);
  // the same tick was past the 15-minute cadence: the next round looked at the other coin (the first one rests for an hour)
  assert.equal(f.state.asked.length,2);assert.equal(f.kinds('KESIF_FORECAST')[1].s,'DOWNUSDT');
  assert.ok(!f.state.calls.some(c=>c.m!=='GET'),'still no order of any kind');
});

test('R2544.148 the switch: off = no round and no call; settings survive; the committee without poll (old wiring) is simply not asked', async()=>{
  const f=fixture({answers:ANS});
  assert.deepEqual(f.controller.configureKesif({enabled:false,cadenceMin:3,providers:'ALL',source:'OFFICE'}),{ok:true,enabled:false,cadenceMin:5,providers:'ALL'});
  assert.equal(await f.controller._testKesifTick(),null);assert.equal(f.state.asked.length,0);
  f.controller.configureKesif({enabled:true});await f.controller._testKesifTick();assert.equal(f.state.asked.length,1);assert.equal(f.state.asked[0].filter,null,'providers ALL: everybody forecasts');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'data','kesif-state.json'),'utf8')).settings.providers,'ALL');
  const g=fixture({answers:ANS,poll:false});const o=await g.controller._testKesifTick();assert.equal(o.round,null);assert.equal(g.controller.kesifStatus().wired,false);
});

test('R2544.154 GOXEL in the core: after each closed 5m candle he reads the screens of the forecasts that pay and takes the money; the plan keeps running', async()=>{
  const f=fixture({answers:ANS});await f.controller._testKesifTick();
  const E=f.T0+M5,c=(i,o,h,l,cl)=>[E+i*M5,String(o),String(h),String(l),String(cl),'1000',E+(i+1)*M5-1,'100000',10,'500','50000','0'];
  // entry 100: up to 101.6 (+0,8R for the 2 % stop), the last candle makes the top and closes at 100.9: rejection wick + melting profit
  f.state.future=[c(0,100,100.4,99.8,100.3),c(1,100.3,101.6,100.2,101.5),c(2,101.5,101.6,100.85,100.9)];
  f.state.now=E+3*M5+5000;await f.controller._testKesifTick();
  const s=f.controller._testKesifState(),by=m=>s.open.find(r=>r.model===m);
  assert.equal(by('vision/a').done,false,'the plan is still running');
  assert.deepEqual([by('vision/a').gx.by,by('vision/a').gx.R],['GOXEL',+(0.45-0.14/2).toFixed(3)]);
  assert.match(by('vision/a').gx.why,/iğne/);assert.match(by('vision/a').gx.why,/kâr eriyor/);
  assert.equal(by('nvidia/model-c').gx,undefined,'the losing SHORT is not his to manage');
  assert.ok(!s.open.some(r=>r.model.startsWith('PUSU:')&&r.gx),'twins are not watched');
  assert.ok(f.kinds('GOXEL_EXIT').length>=1);
  assert.ok(f.state.calls.some(c=>c.p==='/futures/data/takerlongshortRatio')&&f.state.calls.some(c=>c.p==='/fapi/v1/depth'),'he looked at the takers and the book');
  assert.ok(!f.state.calls.some(c=>c.m!=='GET'),'only public GET requests');
  const st=f.controller.kesifStatus().goxel;assert.ok(st.since<=f.T0+20000);assert.ok(st.proSince<=f.T0+20000);
  // R2544.155 GOXEL PRO read the big timeframes of the coin too (1h / 4h / 1d candles) and shows his four extra screens
  assert.ok(f.state.calls.some(c=>c.p==='/fapi/v1/klines'&&c.q.interval==='4h'&&c.q.endTime),'he looked at the 4h chart');
  assert.ok(st.last.watch.some(w=>w.pro&&w.pro.screens.length===4&&w.pro.screens.map(x=>x.key).join()==='TREND,SEVIYE,FORMASYON,TESTERE'));assert.ok(st.last.watch.length>=1&&st.last.watch[0].screens.length===5&&st.last.watch[0].spark.length>=3);
  // then the price runs to the target: the plan wins +2R, Goxel kept his +0,38R -> the book shows he cut a winner
  f.state.future.push(c(3,100.9,104.2,100.8,104));f.state.now=E+4*M5+5000;await f.controller._testKesifTick();
  const b=f.controller.kesifStatus().goxel.book,cl=f.controller._testKesifState().closed.find(r=>r.model==='vision/a');
  assert.deepEqual([cl.outcome,cl.gx.by,cl.gx.R],['TARGET','GOXEL',+(0.45-0.14/2).toFixed(3)]);
  assert.ok(b.n>=1&&b.took>=1&&b.cutWinner>=1);assert.deepEqual(b.rows.map(r=>r.key),['PLAN','GOXEL']);
  assert.ok(['PRO','PLAN'].includes(cl.gp.by)&&Number.isFinite(cl.gp.R),'PRO has his own result on the same forecast');assert.deepEqual(b.pro.rows.map(r=>r.key),['PLAN','GOXEL','PRO']);
});
