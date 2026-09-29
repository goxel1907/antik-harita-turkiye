'use strict';
// CLAUDE_R2544.4 (29.09.2026): 64 gerçek işlemin 1m fiyat yolu analizi → 0,5R kademeli kâr + başabaş,
// JEV kısmi kâr sözleşmesi, runner fazının yönetim azaltmalarından ayrılması, paket son-çare budaması,
// Office görsel katmanının derleme/izolasyon güvencesi.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const G=require('../position-guard');
const V111=require('../claude-v111');
const {prepareDecisionRequest,MAX_DECISION_REQUEST_BYTES}=require('../jev-decision');

const base=(o={})=>({row:{symbol:'ABCUSDT',side:'LONG',entryPrice:100,originalStopPrice:98,currentStop:98,originTF:'15m',lane:'15M_TRADE',createdAt:0,...(o.row||{})},
  snap:{qty:30,entryPrice:100,markPrice:100,tickSize:0.01,...(o.snap||{})},phase:o.phase||'INITIAL',now:o.now??60000,config:{...G.DEFAULTS,...(o.config||{})}});

test('kademeli kâr: 0,5R ve ≥%0,3 harekette bir kez 1/3; sonra başabaş; asla genişletmez',()=>{
  assert.equal(G.evaluateGuard(base({snap:{markPrice:100.9}})).action,'NONE','0,45R: bekle');
  const so=G.evaluateGuard(base({snap:{markPrice:101.0}}));
  assert.equal(so.action,'SCALE_OUT');assert.equal(so.fraction,0.3333);
  const be=G.evaluateGuard(base({row:{scaleOutDone:true},snap:{markPrice:101.0}}));
  assert.equal(be.action,'TIGHTEN_STOP');assert.equal(be.reason,'GUARD_SCALE_OUT_BREAKEVEN');
  assert.ok(be.target>100&&be.target<100.2);
  const done=G.evaluateGuard(base({row:{scaleOutDone:true,currentStop:100.12},snap:{markPrice:101.0}}));
  assert.equal(done.action,'NONE','başabaştan sonra tekrar yok');
  // SHORT simetrik
  const s=G.evaluateGuard(base({row:{side:'SHORT',originalStopPrice:102,currentStop:102},snap:{markPrice:99.0}}));
  assert.equal(s.action,'SCALE_OUT');
  // Küçük R: 0,5R ama hareket %0,15 (<%0,3 ücret eşiği) → kademeli kâr yok
  assert.notEqual(G.evaluateGuard(base({row:{originalStopPrice:99.7,currentStop:99.7},snap:{markPrice:100.16}})).action,'SCALE_OUT');
  // TP1 sonrası (runner fazı) kademeli kâr yapılmaz
  assert.equal(G.evaluateGuard(base({phase:'TRAILING',snap:{markPrice:101.5}})).action,'NONE');
  // kapatılabilir
  assert.equal(G.evaluateGuard(base({config:{scaleOutEnabled:0},snap:{markPrice:101.0}})).action,'NONE');
});

test('JEV kısmi kâr sözleşmesi: ≥0,5R, en çok 2, 10 dk ara; kapalıyken serbest',()=>{
  const now=10*3600000;
  const c=(mark,events=[],cfg={})=>G.partialContract({side:'SHORT',entryPrice:0.01896,initialStop:0.01962,markPrice:mark,partialEvents:events,now,config:{...G.DEFAULTS,...cfg}});
  // AZTEC 29.09 01:00: +0,08R'de kısmi → 0,5R eşiğiyle ertelenir (R2544.7'den beri varsayılan eşik 0R; eşik burada açıkça veriliyor)
  const a=c(0.01891,[],{partialMinR:0.5}); assert.equal(a.allow,false); assert.equal(a.reason,'PARTIAL_DEFERRED_BELOW_MIN_R'); assert.ok(a.progressR<0.1);
  const ok=c(0.01855); assert.equal(ok.allow,true,JSON.stringify(ok)); assert.ok(ok.progressR>=0.6);
  const ev=t=>({action:'PARTIAL_TAKE_PROFIT',at:t});
  assert.equal(c(0.01855,[ev(now-5*60000)]).reason,'PARTIAL_DEFERRED_SPACING');
  assert.equal(c(0.01855,[ev(now-60*60000)]).allow,true);
  assert.equal(c(0.01855,[ev(now-90*60000),ev(now-60*60000)]).reason,'PARTIAL_DEFERRED_MAX_COUNT');
  assert.equal(c(0.01855,[{action:'EXIT_NOW',at:now-60000}]).allow,true,'EXIT olayları sayılmaz');
  assert.equal(c(0.01891,[],{partialContractEnabled:0}).allow,true);
  assert.equal(c(0.01891).allow,true,'R2544.7 varsayılanı: kârdaki kısmi serbest');
  assert.equal(G.partialContract({side:'LONG',entryPrice:1,initialStop:null,markPrice:1.1}).allow,false,'eksik girdi: fail-closed (kısmi yok, TUT)');
});

test('runner fazı: JEV/guard azaltması TP1 dolumu sayılmaz (MARSCOIN 29.09)',()=>{
  // 1890 adet, TP1 1/3 (630). JEV 630 azalttı → eski davranış TRAILING + başabaş.
  assert.equal(V111.runnerPhase({initialQty:1890,tpQty:[630,630,630],remainingQty:1260,tpPlaced:1}),'TRAILING','eski hesap (düzeltme olmadan)');
  assert.equal(V111.runnerPhase({initialQty:1890,tpQty:[630,630,630],remainingQty:1260+630,tpPlaced:1}),'INITIAL','yönetim azaltması eklenince INITIAL');
  assert.equal(V111.runnerPhase({initialQty:1890,tpQty:[630,630,630],remainingQty:630+630,tpPlaced:1}),'TRAILING','sonra gerçek TP1 dolumu → TRAILING');
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(lc,/remainingQty:snap\.qty\+\(finite\(row\.mgmtReducedQty\)\|\|0\)/);
  assert.match(lc,/rr0\.mgmtReducedQty=\(finite\(rr0\.mgmtReducedQty\)\|\|0\)\+\(finite\(result\?\.executedQty\)\|\|0\)/);
  assert.match(lc,/if\(action==='PARTIAL_TAKE_PROFIT'&&!partialGate\.allow\)/);
  assert.ok(lc.indexOf('partialGate.allow')<lc.indexOf("const bindingReduceAction="),'sözleşme emirden önce');
});

test('controller: 0,5R kademeli kâr reduce-only MARKET 1/3, faz INITIAL kalır, sonra başabaş stop',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r25444-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'config'),{recursive:true});
  fs.writeFileSync(path.join(root,'config','claude-v111.json'),JSON.stringify({runnerMode:'BINDING'}));
  const prevRoot=process.env.BRAINHUB_ROOT; process.env.BRAINHUB_ROOT=root; V111.resetConfigCache();
  t.after(()=>{process.env.BRAINHUB_ROOT=prevRoot;V111.resetConfigCache();});
  const state={qty:30,mark:101.1,now:Date.now(),algo:0};
  const writes=[];
  const reply=b=>({ok:true,status:200,async text(){return JSON.stringify(b);}});
  const fetchImpl=async(url,opt={})=>{
    const u=new URL(url);const method=opt.method||'GET';
    const params=new URLSearchParams(method==='GET'?u.search.slice(1):(opt.body||''));
    if(u.pathname==='/fapi/v1/time')return reply({serverTime:state.now});
    if(u.pathname==='/fapi/v1/positionSide/dual')return reply({dualSidePosition:false});
    if(u.pathname==='/fapi/v3/positionRisk')return reply([{symbol:'ABCUSDT',positionSide:'BOTH',positionAmt:String(state.qty),entryPrice:'100',markPrice:String(state.mark),liquidationPrice:'80',isolatedWallet:'0'}]);
    if(u.pathname==='/fapi/v1/exchangeInfo')return reply({symbols:[{symbol:'ABCUSDT',filters:[{filterType:'MARKET_LOT_SIZE',stepSize:'1',minQty:'1',maxQty:'100000'},{filterType:'PRICE_FILTER',tickSize:'0.01',minPrice:'0.01',maxPrice:'100000'}]}]});
    if(u.pathname==='/fapi/v1/algoOrder'&&method==='POST'){state.algo++;writes.push({op:'POST',type:params.get('type'),qty:params.get('quantity'),trigger:Number(params.get('triggerPrice'))});return reply({algoId:'G'+state.algo});}
    if(u.pathname==='/fapi/v1/algoOrder'&&method==='DELETE'){writes.push({op:'DELETE',algoId:params.get('algoId')});return reply({code:200});}
    if(u.pathname==='/fapi/v1/order'&&method==='POST'){const q=Number(params.get('quantity'));writes.push({op:'MARKET',side:params.get('side'),qty:q,reduceOnly:params.get('reduceOnly')});state.qty-=q;return reply({orderId:78,executedQty:String(q),status:'FILLED'});}
    throw new Error('unexpected '+method+' '+u.pathname);
  };
  const {createLiveController}=require('../live-controller');
  const journal=[];
  const controller=createLiveController({root,credentials:{apiKey:'test-api-key',apiSecret:'test-api-secret'},fetchImpl,clock:()=>state.now,
    store:{journal:(k,s,p)=>{journal.push({k,p});return 'id';}},scanner:{async scan(){throw new Error('unused');}},
    pipeline:{async run(){throw new Error('unused');}},committee:async()=>({})});
  controller._testRegisterRunner({intent:{symbol:'ABCUSDT',side:'LONG',entryPrice:100,stopPrice:98,takeProfit3:106,originTF:'15m',estimatedLiquidationPrice:80},
    result:{symbol:'ABCUSDT',side:'LONG',executedQty:30,tpQuantities:[10,10,10],stopAlgoId:'S1',tpAlgoIds:['T1'],runner:{enabled:true,tpPlaced:1},stopProtected:true},mode:'BINDING',lane:'15M_TRADE'});
  const r1=await controller.runnerTick();
  assert.equal(r1.results[0].action,'GUARD_SCALE_OUT',JSON.stringify(r1));
  const m=writes.find(x=>x.op==='MARKET'); assert.equal(m.qty,9); assert.equal(m.side,'SELL'); assert.equal(m.reduceOnly,'true');
  state.now+=11000;
  const r2=await controller.runnerTick();
  assert.equal(r2.results[0].phase,'INITIAL','kademeli azaltma TP1 dolumu değildir');
  assert.equal(r2.results[0].action,'GUARD_STOP_MOVED',JSON.stringify(r2));
  const stop=writes.filter(x=>x.op==='POST'&&x.type==='STOP_MARKET').pop();
  assert.equal(stop.qty,'21'); assert.ok(stop.trigger>100&&stop.trigger<100.2,'başabaş');
  assert.ok(journal.some(x=>x.k==='CLAUDE_V111_RUNNER'&&x.p.kind==='GUARD_SCALE_OUT'&&x.p.ok===true));
  state.now+=60000;
  const r3=await controller.runnerTick();
  assert.notEqual(r3.results[0].action,'GUARD_SCALE_OUT','ikinci kez yok');
});

test('paket: deneyim hafızası son çare olarak özetlenir; piyasa gerçeği kırpılmaz; kırpılamayan gerçek yine fail-closed',()=>{
  const frame=()=>({available:true,close:1,trend:'UP',rsi14:50,atrPct:1,patterns:[],notes:'n'.repeat(3000)});
  const mem={stats:Array.from({length:6},(_,i)=>({k:i,t:'m'.repeat(900)})),measuredOutcomes:Array.from({length:6},(_,i)=>({k:i,t:'o'.repeat(900)})),text:'x'.repeat(8000)};
  const input={state:{experienceMemory:mem,coreMarketPacket:{coreFrames:{'5m':frame(),'15m':frame()},timingFrames:{'1m':frame(),'3m':frame()}},
    record:{truth:'p'.repeat(MAX_DECISION_REQUEST_BYTES-20000)}},questions:{trade_plan:{}}};
  const out=prepareDecisionRequest(input);
  assert.equal(out.ok,true,JSON.stringify(out.diagnostics.trimStepsApplied)+' '+out.diagnostics.bytes);
  assert.ok(out.diagnostics.trimStepsApplied.includes('EXPERIENCE_MEMORY_MIN'));
  assert.equal(out.body.state.coreMarketPacket.coreFrames['5m'].notes.length,3000,'5m çekirdek aynen');
  assert.equal(out.body.state.record.truth.length,MAX_DECISION_REQUEST_BYTES-20000,'kayıt gerçeği aynen');
  const huge=prepareDecisionRequest({state:{record:{truth:'q'.repeat(MAX_DECISION_REQUEST_BYTES+100)}},questions:{}});
  assert.equal(huge.ok,false,'kırpılamayan gerçek → fail-closed');
});

test('JEV pozisyon paketi sözleşmeyi açıkça taşır (sessiz düşürme yok)',()=>{
  const jd=fs.readFileSync(path.join(__dirname,'..','jev-decision.js'),'utf8');
  assert.match(jd,/managementContract:lifecycle\?\.managementContract\|\|null/);
  assert.match(jd,/record\.managementContract states the execution contract for PARTIAL_TAKE_PROFIT/);
});

test('Office: betik derlenir; görsel kat (masa/dinlenme/pano) ana render\'dan yalıtılmıştır; 60 dk paket sağlığı okunur',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  const code=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n;\n');
  assert.doesNotThrow(()=>new vm.Script(code),'office.html betiği sözdizimsel olarak geçerli (R2544.3 "rc" çakışması)');
  assert.match(html,/try\{ renderFloorShift\(s, la, st\); \}catch/);
  for(const id of ['loungeSvg','tradeBoardSvg','RESTERS','o-desk away','tb-t','last60'])assert.ok(html.includes(id),id);
  const srv=require('../office-dashboard/office-server.js');
  const sum=srv.summarizeJournal([{ts:1,kind:'R2542_OFFICE_EVENT',payload:{kind:'TICK_RESULT',orderPlaced:false,reasons:['X']}},
    {ts:2,kind:'R2542_OFFICE_EVENT',payload:{kind:'EXECUTION_BLOCK',reasons:['REENTRY_COOLDOWN_AFTER_LOSS']},symbol:'MARSCOINUSDT'},
    {ts:3,kind:'JEV_PARTIAL_DEFERRED',symbol:'AZTECUSDT',payload:{contract:{reason:'PARTIAL_DEFERRED_BELOW_MIN_R',progressR:0.08,reviewPartialsTaken:0,maxReviewPartials:2}}}]);
  assert.equal(sum.events.length,2,'emirsiz TICK_RESULT akışa yazılmaz');
  assert.ok(sum.events.some(e=>/EXECUTION_BLOCK/.test(e.title)&&/REENTRY/.test(e.detail)));
  assert.ok(sum.events.some(e=>/ertelendi/.test(e.title)));
});

test('seri zarar molası: 2 zararlı kapanış → 30 dk tüm giriş yolları kapalı; kazanç seriyi sıfırlar; yeniden başlatmada geri kurulur',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r25444s-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const G2=require('../position-guard');
  assert.equal(G2.DEFAULTS.lossStreakPauseCount,2);assert.equal(G2.DEFAULTS.lossStreakPauseMin,30);
  let now=Date.parse('2026-09-28T22:46:02Z');
  const closes=[{symbol:'PHAUSDT',payload:{side:'SHORT',netPnl:-3.95,exitType:'JEV_EXIT_NOW',closedAt:'2026-09-28T22:46:02Z',eventId:'a'}},
                {symbol:'PENDLEUSDT',payload:{side:'SHORT',netPnl:-0.93,exitType:'JEV_EXIT_NOW',closedAt:'2026-09-28T22:51:02Z',eventId:'b'}}];
  const mk=()=>require('../live-controller').createLiveController({root,credentials:{},fetchImpl:async()=>{throw new Error('net');},clock:()=>now,
    store:{journal(){return 'id';},recentJournal:(k)=>k==='POSITION_CLOSED'?closes.map((c,i)=>({ts:Date.parse(c.payload.closedAt),...c})):[]},
    scanner:{async scan(){throw new Error('unused');}},pipeline:{async run(){throw new Error('unused');}},committee:async()=>({})});
  now=Date.parse('2026-09-28T23:02:12Z'); // COTI girişi anı (29.09 02:02 yerel)
  const c=mk();
  const p=c._testLossStreakPause();
  assert.ok(p,'yeniden başlatma sonrası mola geri kuruldu');assert.equal(p.reason,'LOSS_STREAK_PAUSE');assert.equal(p.streak,2);
  assert.ok(p.remainingMin>0&&p.remainingMin<=30);
  assert.ok(c._testReentryBlock('PENDLEUSDT'),'zararlı kapanış soğuması da geri kuruldu');
  now=Date.parse('2026-09-28T23:22:00Z');
  assert.equal(c._testLossStreakPause(),null,'30 dk sonra biter');
  c._testNoteClosedForStreak('XUSDT',1.2,now);
  c._testNoteClosedForStreak('YUSDT',-1,now);
  assert.equal(c._testLossStreakPause(),null,'kazanç seriyi sıfırladı; tek zarar mola açmaz');
  c._testNoteClosedForStreak('ZUSDT',-1,now);
  assert.ok(c._testLossStreakPause(),'yeniden 2 zarar → mola');
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  for(const m of ["execution:'LEADER_AUTO_REST_LOSS_STREAK'","reason:'FAST_LANE_REST_LOSS_STREAK'","const rs=['LOSS_STREAK_PAUSE'];"])assert.ok(lc.includes(m),m);
  assert.ok(lc.indexOf("const rs=['LOSS_STREAK_PAUSE'];")<lc.indexOf('const intent = buildLeaderLiveIntent({'),'emir inşasından önce');
});
