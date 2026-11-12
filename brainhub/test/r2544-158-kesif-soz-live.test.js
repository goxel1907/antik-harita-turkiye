'use strict';
// R2544.158 KEŞİF-SÖZ end to end (TEST = paper exchange, the same code path as LIVE): a word holder's fresh forecast opens a real lot on its own
// lane (own 2 lots, İlk 3's count untouched), the member's own stop / target from the fill; Goxel reads the lot; a Goxel EXIT closes it.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {writeTradingMode}=require('../binance-live-transport');
const K=require('../kesif');
const M5=300000,H=3600000,T0=Math.floor(Date.UTC(2026,10,12,12,0)/H)*H;
const FAKE={apiKey:'fake-test-key-r158',apiSecret:'fake-test-secret-r158'}; // made-up, never real
const ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
function fixture({soz=null}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r158-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:false,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify({enabled:false,committeeMode:true}));
  fs.writeFileSync(path.join(root,'config','zirve5.json'),JSON.stringify({enabled:false}));
  if(soz)fs.writeFileSync(path.join(root,'config','kesif-soz.json'),JSON.stringify(soz));
  writeTradingMode(root,{mode:'TEST',changedAt:'2026-11-12T10:00:00.000Z',testStartedAt:null,testAutoRun:true});
  const state={now:T0+20000,calls:[],k5:{}},events=[];
  const sym=s=>({symbol:s,contractType:'PERPETUAL',status:'TRADING',quoteAsset:'USDT',filters:[{filterType:'PRICE_FILTER',tickSize:'0.0001'},{filterType:'LOT_SIZE',stepSize:'0.1',minQty:'0.1',maxQty:'10000000'},{filterType:'MIN_NOTIONAL',notional:'5'}]});
  const flat=(ms,n,end)=>Array.from({length:n},(_,i)=>{const t=Math.floor(end/ms)*ms-(n-i)*ms;return [t,'1','1.002','0.998','1','1000',t+ms-1,'1000',10,'500','500','0'];});
  const fetchImpl=async(url,o={})=>{const u=new URL(url),p=u.pathname,m=o.method||'GET';state.calls.push({m,p,q:Object.fromEntries(u.searchParams)});
    if(p==='/fapi/v1/time')return ok({serverTime:state.now});
    if(p==='/fapi/v1/ticker/bookTicker')return ok({symbol:u.searchParams.get('symbol'),bidPrice:'1.0000',askPrice:'1.0010'});
    if(p==='/fapi/v3/account')return ok({availableBalance:'250',totalWalletBalance:'250',positions:[]});
    if(p==='/fapi/v3/positionRisk')return ok([]);
    if(p==='/fapi/v1/positionSide/dual')return ok({dualSidePosition:false});
    if(p==='/fapi/v1/income')return ok([]);
    if(p==='/fapi/v1/exchangeInfo')return ok({symbols:['KSUSDT','BTCUSDT'].map(sym)});
    if(p==='/fapi/v1/ticker/24hr')return ok([{symbol:'KSUSDT',priceChangePercent:'30',quoteVolume:'90000000',closeTime:state.now}]);
    if(p==='/fapi/v1/premiumIndex')return ok({symbol:'KSUSDT',lastFundingRate:'0.0001',markPrice:'1',indexPrice:'1'});
    if(p==='/fapi/v1/leverageBracket')return ok([{symbol:u.searchParams.get('symbol'),brackets:[{bracket:1,initialLeverage:50,notionalCap:1000000,notionalFloor:0}]}]);
    if(p==='/fapi/v1/klines'){const st=u.searchParams.get('startTime');if(st)return ok((state.k5[u.searchParams.get('symbol')]||[]).filter(r=>r[0]>=Number(st)));
      const ms={'5m':M5,'15m':3*M5,'1h':H,'4h':4*H,'1d':24*H}[u.searchParams.get('interval')]||H;return ok(flat(ms,80,Number(u.searchParams.get('endTime'))||state.now));}
    if(p.startsWith('/futures/data/'))return ok([]);
    if(p==='/fapi/v1/depth')return ok({bids:[],asks:[]});
    return ok({});};
  const events2=events,store={journal:(k,s,p)=>events2.push({k,s,p}),recordLearning:(k,s,p)=>events2.push({k:'LEARN:'+k,s,p})};
  const committee={poll:async()=>({ok:false,votes:[],asked:0}),quick:async()=>({ok:false}),decide:async()=>({ok:false,reason:'NOT_USED'}),status:()=>({members:[],team:[]})};
  const controller=require('../live-controller').createLiveController({root,clock:()=>state.now,store,scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),credentials:FAKE,fetchImpl,
    paperAutoTick:false,defaultTradingMode:'TEST',deskJudges:{committee},market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}}}});
  return {root,state,events,controller,kinds:k=>events.filter(e=>e.k===k)};
}
// a member with 25 forward outcomes, mostly targets -> SOZ_SAHIBI in the karne
function seedWord(s,model,now){
  for(let i=0;i<25;i++)s.closed.push({id:'w'+i+':'+model,model,symbol:'XUSDT',side:'LONG',at:now-(30-i)*H,closedAt:now-(29-i)*H,done:true,outcome:i%6===5?'STOP':'TARGET',R:i%6===5?-1.07:1.43,stopPct:2,targetPct:3,horizonH:6});
  s.karne=K.karne(s.closed,{now});
}

test('R2544.158 a word holder\'s fresh forecast opens a real lot on its own lane; a candidate stays in the shadow; Goxel EXIT closes it',async()=>{
  const f=fixture();
  const arm=await f.controller.testSupervisorTick();assert.equal(arm.action,'TEST_ARMED',JSON.stringify(arm));
  f.controller.kesifStatus();const s=f.controller._testKesifState();seedWord(s,'m/word',f.state.now);
  assert.deepEqual(K.karne(s.closed,{now:f.state.now}).leaders,['m/word']);
  s.lastRoundAt=f.state.now;s.lastIzAt=f.state.now;   // no new round / İZ scan in this tick: only the entry is under test
  const fc=o=>K.open({model:o.model,symbol:'KSUSDT',forecast:{ok:true,direction:'LONG',stopPct:2,targetPct:4,horizonH:6,confidence:60},at:f.state.now,round:'rx'});
  s.open.push(fc({model:'m/word'}),fc({model:'m/candidate'}));
  const out=await f.controller._testKesifTick();
  assert.ok(out.soz&&out.soz.length===1,JSON.stringify(out.soz||s.sozRecent));
  assert.equal(out.soz[0].opened,true,JSON.stringify(out.soz[0]));
  const lots=Object.values(f.controller.top3Status().active||[]),st=f.controller.kesifStatus().soz;
  assert.equal(st.active.length,1);const a=st.active[0];
  assert.equal(a.model,'m/word');assert.equal(a.side,'LONG');assert.ok(String(a.id).startsWith('ks'));assert.ok(a.leverage>=10&&a.leverage<=20);
  assert.ok(Math.abs(a.stopPct-0.02)<0.0005,'the member\'s own 2 % stop from the fill: '+a.stopPct);
  assert.deepEqual(lots.map(x=>x.lane),['KESIF'],'R2544.160: the lot is on the status list (Office shows it) with its own lane; the İlk 3 slot count leaves it out');
  assert.equal(f.kinds('KESIF_SOZ_ENTRY').length,1);assert.equal(f.kinds('KESIF_SOZ_ENTRY')[0].p.lane,'KESIF');
  assert.ok(st.holders.includes('m/word')&&!st.holders.includes('m/candidate'));
  assert.equal(s.sozRecent.length,1,'the candidate never reached the order path');
  // the same tick does not open it twice
  const again=await f.controller._testKesifTick();assert.ok(!again.soz);
  // Goxel reads the open lot from its real fill - R2544.163: from the FIRST minute, on the forming candle (no closed candle needed)
  const eAt=Math.floor(a.openedAt/M5)*M5,e=a.entryPrice,c=(i,o,h,l,cl)=>[eAt+i*M5,String(o),String(h),String(l),String(cl),'1000',eAt+(i+1)*M5-1,'1000',10,'500','500','0'];
  f.state.k5.KSUSDT=[c(0,e,e*1.002,e*0.999,e*1.001)];f.state.now=a.openedAt+60000;await f.controller._testGoxelLive();
  assert.ok(Object.values(f.controller._testTop3State().active).find(x=>x.lane==='KESIF').goxel,'Goxel looked one minute after the entry, on the forming candle');
  f.state.k5.KSUSDT=[c(0,e,e*1.004,e*0.999,e*1.003),c(1,e*1.003,e*1.0165,e*1.002,e*1.016),c(2,e*1.016,e*1.0166,e*1.008,e*1.0084)];
  f.state.now=eAt+3*M5+5000;await f.controller._testGoxelLive(); // R2544.163 Goxel's own loop
  const g=f.controller.kesifStatus().soz.active[0].goxel;
  assert.ok(g&&g.watching===true&&g.against>=2,'Goxel read the lot: '+JSON.stringify(g));
  assert.ok(f.controller.kesifStatus().soz.goxelLive.lots.some(x=>x.lane==='KESIF'));
  // Goxel PRO decided on this screen (melting profit + rejection wick at the top + a big screen): his EXIT is a desk EXIT, carried out at once
  assert.equal(f.kinds('GOXEL_LIVE_EXIT').length,1,'Goxel took the money');assert.equal(f.kinds('GOXEL_LIVE_EXIT')[0].p.lane,'KESIF');
  for(let i=0;i<40&&Object.values(f.controller._testTop3State().active).some(x=>x.lane==='KESIF');i++)await new Promise(r=>setTimeout(r,50));
  assert.equal(Object.values(f.controller._testTop3State().active).filter(x=>x.lane==='KESIF').length,0,'closed on the exchange');
  assert.ok(f.kinds('POSITION_DESK_EXIT').some(x=>x.p.by==='GOXEL'&&x.p.lane==='KESIF'),JSON.stringify(f.events.slice(-8).map(e=>e.k)));
  assert.ok(!f.state.calls.some(x=>x.m!=='GET'&&!/order|leverage|algo|listenKey/i.test(x.p)),'orders only through the order endpoints');
});

test('R2544.158 the switch: off = no trade (the reason is written), both CANLI buttons carry the lane, the start check counts it',async()=>{
  const f=fixture({soz:{enabled:false}});
  await f.controller.testSupervisorTick();
  f.controller.kesifStatus();const s=f.controller._testKesifState();seedWord(s,'m/word',f.state.now);s.lastRoundAt=f.state.now;s.lastIzAt=f.state.now;
  s.open.push(K.open({model:'m/word',symbol:'KSUSDT',forecast:{ok:true,direction:'SHORT',stopPct:2,targetPct:4,horizonH:6,confidence:60},at:f.state.now,round:'ry'}));
  const out=await f.controller._testKesifTick();
  assert.deepEqual([out.soz[0].opened,out.soz[0].reason],[false,'KESIF_SOZ_DISABLED']);
  const on=f.controller.configureKesif({soz:{enabled:true,goxelExit:true},source:'TEST'});assert.equal(on.ok,true);
  assert.equal(f.controller.kesifStatus().soz.enabled,true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root,'config','kesif-soz.json'),'utf8')).enabled,true);
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(lc,/sozLive=sozC\.enabled===true&&sozWired\(\)/);assert.match(lc,/!normalLive&&!t3Live&&!z5Live&&!sozLive/);
  assert.match(lc,/const t3=top3Lib\.readTop3Config\(root\),cfg=\{\.\.\.t3,marginQuote:scfg\.marginQuote,leverage:sig\.weak\?10:scfg\.leverage\}/,'the lane follows İlk 3\'s decision owner (Kurul / JEV + Kurul)');
});

test('R2544.159 the lane uses the margin and leverage the user wrote for İlk 3 (app / Office); 10x floor; its own file wins; a toggle does not freeze them',async()=>{
  const f=fixture();fs.writeFileSync(path.join(f.root,'config','top3-hunter.json'),JSON.stringify({enabled:false,committeeMode:true,marginQuote:25,leverage:12}));
  let c=f.controller.kesifStatus().soz;assert.deepEqual([c.marginQuote,c.marginFrom,c.leverage,c.maxActive],[25,'ILK3',12,2]);
  f.controller.configureKesif({soz:{goxelExit:false},source:'TEST'});
  fs.writeFileSync(path.join(f.root,'config','top3-hunter.json'),JSON.stringify({enabled:false,committeeMode:true,marginQuote:40,leverage:5}));
  c=f.controller.kesifStatus().soz;assert.deepEqual([c.marginQuote,c.leverage,c.goxelExit],[40,10,false],'follows the app after a toggle; leverage never under 10x');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'config','kesif-soz.json'),'utf8')).marginQuote,undefined,'the toggle did not write a margin');
  fs.writeFileSync(path.join(f.root,'config','kesif-soz.json'),JSON.stringify({marginQuote:15}));
  assert.deepEqual([f.controller.kesifStatus().soz.marginQuote,f.controller.kesifStatus().soz.marginFrom],[15,'KESIF']);
});

// R2544.162: nobody holds the word -> the best candidate trades, WEAK: Goxel PRO's look first, leverage 10x
function seedCandidate(s,model,now){for(let i=0;i<22;i++){const w=i<11;s.closed.push({id:'c'+i+':'+model,model,symbol:'XUSDT',side:'LONG',at:now-(40-i)*H,closedAt:now-(39-i)*H,done:true,outcome:w?'TARGET':'STOP',R:w?1.43:-1.07,stopPct:2,targetPct:3,horizonH:6});}s.karne=K.karne(s.closed,{now});}
test('R2544.162 no word holder: the best candidate trades weak (Goxel looks first, 10x); a lower candidate does not',async()=>{
  const f=fixture({});fs.writeFileSync(path.join(f.root,'config','top3-hunter.json'),JSON.stringify({enabled:false,committeeMode:true,marginQuote:30,leverage:15}));
  await f.controller.testSupervisorTick();
  f.controller.kesifStatus();const s=f.controller._testKesifState();seedCandidate(s,'m/best',f.state.now);
  for(let i=0;i<20;i++)s.closed.push({id:'d'+i,model:'m/low',symbol:'XUSDT',side:'LONG',at:f.state.now-(30-i)*H,closedAt:f.state.now-(29-i)*H,done:true,outcome:i%2?'TARGET':'STOP',R:i%2?1.2:-1.07,stopPct:2,targetPct:3,horizonH:6});
  s.karne=K.karne(s.closed,{now:f.state.now});
  assert.deepEqual(s.karne.leaders,[],'nobody holds the word');assert.equal(K.bestCandidate(s.karne),'m/best');
  s.lastRoundAt=f.state.now;s.lastIzAt=f.state.now;
  const fc=m=>K.open({model:m,symbol:'KSUSDT',forecast:{ok:true,direction:'LONG',stopPct:2,targetPct:4,horizonH:6,confidence:60},at:f.state.now,round:'rz'});
  s.open.push(fc('m/best'),fc('m/low'));
  const out=await f.controller._testKesifTick();
  assert.equal(out.soz.length,1,JSON.stringify(s.sozRecent));assert.equal(out.soz[0].weak,true);
  assert.equal(out.soz[0].opened,true,JSON.stringify(out.soz[0]));assert.equal(out.soz[0].leverage,10,'weak = 10x even when İlk 3 is set to 15x');
  const lot=Object.values(f.controller._testTop3State().active).find(x=>x.lane==='KESIF');
  assert.equal(lot.entryFeatures.kesif.weak,true);assert.equal(lot.entryFeatures.goxelEntry.checked,true,'Goxel looked at the screens: '+JSON.stringify(lot.entryFeatures.goxelEntry));
  assert.equal(f.controller.kesifStatus().soz.weakHolder,'m/best');
});
