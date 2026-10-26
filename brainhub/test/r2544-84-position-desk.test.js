'use strict';
// R2544.84 POZİSYON MASASI (kullanıcı 26.10: trader ofisi gibi açık pozisyonu grafik ve veriyle yöneten bir trader; "test için ücretsiz,
// canlıda JEV; canlıda ücretsiz kapalıyken de çalışsın"). GÖLGE: karar kaydedilir, emir gönderilmez; kapanınca masa ile kural ölçülür.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const DESK=require('../position-desk');
const M5=300000,T0=1793000000000;
const lot=(o={})=>({id:'x',symbol:'ARIAUSDT',side:'SHORT',rule:'SHORT_TOP_BREAK',mode:'TEST',entryPrice:0.1,initialStopPrice:0.105,stopPrice:0.105,tpPrice:0.0875,
  part:{atR:2,share:0.5,beFee:0.0012,price:0.09,done:false},openedAt:T0,deadline:T0+24*3600000,leverage:10,...o});
const k=(i,o,h,l,c,v=100,tb=50)=>[T0+i*M5,o,h,l,c,v,0,0,0,tb];
test('R2544.84 stop choices only TIGHTEN (never wider) and stay on the safe side of the price',()=>{
  const a=lot(),k5=DESK.rows([k(-6,0.1,0.1015,0.0995,0.101),k(-5,0.101,0.102,0.1,0.1005),k(-4,0.1005,0.1031,0.1,0.1),k(-3,0.1,0.1012,0.098,0.099),k(-2,0.099,0.1,0.097,0.0975),k(-1,0.0975,0.098,0.096,0.0965),k(0,0.0965,0.097,0.095,0.0955)]);
  const c=DESK.stopCandidates(a,0.0955,k5);
  assert.equal(c.KEEP,0.105);assert.ok(c.BREAKEVEN<0.105&&c.BREAKEVEN>0.0955,'SHORT: break-even is below the stop and above the price');
  assert.ok(Math.abs(c.LAST_5M_SWING-0.1031*1.001)<1e-9,'last confirmed 5m swing high + 0.1 %');
  assert.equal(c.LOCK_1R,undefined,'1R lock (0.095) would be beyond the price -> not offered');
  for(const [kk,p] of Object.entries(c))if(kk!=='KEEP')assert.ok(p<a.stopPrice&&p>0.0955*1.001,kk);
  // a decision naming a stop that is not offered is downgraded to HOLD
  assert.equal(DESK.validate({ok:true,action:'TIGHTEN_STOP',stopChoice:'LOCK_1R'},c).action,'HOLD');
  assert.equal(DESK.validate({ok:true,action:'TIGHTEN_STOP',stopChoice:'BREAKEVEN'},c).stopPrice,c.BREAKEVEN);
  assert.equal(DESK.validate({ok:true,action:'TIGHTEN_STOP',stopChoice:'KEEP'},c).action,'HOLD');
});
test('R2544.84 free model answer: strict JSON contract, Turkish reason; anything else is rejected',()=>{
  const d=DESK.parseFree('ok here {"action":"EXIT","stopChoice":"KEEP","reason":"VOLUME_CLIMAX","confidence":140,"reasonTr":"hedefte hacim doruğu","watchTr":"yeni dip"}');
  assert.equal(d.ok,true);assert.equal(d.action,'EXIT');assert.equal(d.confidence,100);assert.equal(d.reasonTr,'hedefte hacim doruğu');
  assert.equal(DESK.parseFree('{"action":"BUY_MORE"}').ok,false,'no adding to a position');
  assert.equal(DESK.parseFree('not json').ok,false);
  assert.equal(DESK.validFree('{"action":"HOLD"}'),true);
  assert.match(DESK.SYSTEM,/HOLD is the measured default|measured default is HOLD/);
});
test('R2544.84 judges: TEST uses the free model; LIVE uses JEV, falls back to free, and works with the free model OFF; none -> rule keeps managing',async()=>{
  const cfg=DESK.readConfig(fs.mkdtempSync(path.join(os.tmpdir(),'desk-')));
  assert.deepEqual(cfg.testJudges,['FREE']);assert.deepEqual(cfg.liveJudges,['JEV','FREE']);assert.equal(cfg.authority,false,'shadow only in this build');
  const calls=[],free={review:async x=>{calls.push('FREE:'+x.role);return {called:true,ok:true,model:'qwen:free',text:'{"action":"HOLD","reason":"STRUCTURE_INTACT","reasonTr":"yapı sağlam"}'};}};
  const jev=async()=>{calls.push('JEV');return {ok:true,called:true,action:'TAKE_PARTIAL',stopChoice:'KEEP',reason:'TARGET_ZONE_NEAR',model:'typesafe/jev-1.13'};};
  const p={symbol:'ARIAUSDT',side:'SHORT'},st={};
  let r=await DESK.judge({packet:p,mode:'TEST',cfg,judges:{free,jev},stats:st});
  assert.equal(r.judge,'FREE');assert.deepEqual(calls,['FREE:POSITION_DESK'],'TEST never spends JEV credit');
  r=await DESK.judge({packet:p,mode:'LIVE',cfg,judges:{free,jev},stats:st});assert.equal(r.judge,'JEV');assert.equal(r.d.action,'TAKE_PARTIAL');
  r=await DESK.judge({packet:p,mode:'LIVE',cfg,judges:{free:null,jev},stats:st});assert.equal(r.judge,'JEV','LIVE works with the free model OFF');
  r=await DESK.judge({packet:p,mode:'LIVE',cfg,judges:{free,jev:async()=>({ok:false,called:true,reason:'JEV_PROVIDER_AUTH_COOLDOWN'})},stats:st});
  assert.equal(r.judge,'FREE','JEV down in LIVE -> free model');assert.ok(r.tried[0].startsWith('JEV:'));
  r=await DESK.judge({packet:p,mode:'LIVE',cfg,judges:{free:null,jev:null},stats:st});assert.equal(r.ok,false);assert.deepEqual(r.tried,['JEV_NOT_WIRED','FREE_NOT_WIRED']);
  st.free=cfg.freeDailyCap;r=await DESK.judge({packet:p,mode:'TEST',cfg,judges:{free,jev},stats:st});assert.deepEqual(r.tried,['FREE_DAILY_CAP']);
});
test('R2544.84 desk vs rule: same 5m path, same rules (stop first, half at 2R then break-even, target, 24 h); decisions apply from the next candle',()=>{
  const a=lot(),plan=DESK.planOf(a);
  // SHORT from 0.1 (risk 0.005): falls to 0.096 (+0.8R), then squeezes to the stop
  const path=DESK.rows([k(0,0.1,0.1005,0.099,0.099),k(1,0.099,0.0995,0.096,0.0965),k(2,0.0965,0.0985,0.0962,0.098),k(3,0.098,0.1052,0.0978,0.105)]);
  assert.equal(DESK.simulate(plan,path,[]),-1,'rule only: stopped at -1R');
  const exit=[{at:T0+2*M5,action:'EXIT',mark:0.0965}];
  assert.equal(DESK.simulate(plan,path,exit),0.7,'desk EXIT at 0.0965 = +0.7R');
  const tight=[{at:T0+2*M5,action:'TIGHTEN_STOP',stopPrice:0.0985}];
  assert.equal(DESK.simulate(plan,path,tight),0.3,'stop tightened to 0.0985 -> +0.3R');
  const cf=DESK.counterfactual({plan,decisions:[{at:T0+M5,action:'HOLD',mark:0.099},...exit]},path.map(x=>[x.t,x.o,x.h,x.l,x.c,x.v]));
  assert.deepEqual([cf.ruleR,cf.deskR,cf.deltaR,cf.acted,cf.reviews],[-1,0.7,1.7,1,2]);
  // half at +2R then break-even: price reaches 0.09 (2R) then returns to entry
  const win=DESK.rows([k(0,0.1,0.1002,0.095,0.096),k(1,0.096,0.096,0.0899,0.091),k(2,0.091,0.1002,0.0905,0.1001)]);
  const r=DESK.simulate(plan,win,[]);assert.ok(Math.abs(r-(0.5*2+0.5*((0.1-0.1*(1-0.0012))/0.005)))<1e-3,'half at 2R, rest at break-even');
  const sum=DESK.summary([{rule:'SHORT_TOP_BREAK',desk:{cf}},{lane:'ZIRVE5',desk:{cf:{ok:true,ruleR:1,deskR:0.5,deltaR:-0.5,acted:1}}}]);
  assert.equal(sum.ILK3.deltaR,1.7);assert.equal(sum.ZIRVE5.worse,1);
});
test('R2544.84 wiring: shadow only (no orders), lessons keep the decisions, counterfactual at the 24 h autopsy, Office shows it, deploy lists',()=>{
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  const i=lc.indexOf('async function positionDeskTick(');const body=lc.slice(i,lc.indexOf('\n  function deskView(',i));
  assert.ok(i>0);assert.doesNotMatch(body,/placeAlgo|placeRunnerStop|placeTakeProfit|top3CloseMarket|cancel|newOrder|_signed/,'the desk never sends an order');
  assert.match(body,/shadow:true/);assert.match(body,/if\(!deskJudges\?\.free&&typeof deskJudges\?\.jev!=='function'\)return/);
  assert.match(lc,/if\(!deskBusy\)positionDeskTick\(\)\.catch\(\(\)=>\{\}\);/,'runs from the tick without blocking the scan');
  assert.match(lc,/lesson\.desk=\{decisions:c\.desk\.decisions\|\|\[\],plan:c\.desk\.plan\|\|DESK\.planOf\(c\)\}/);
  assert.match(lc,/\.\.\.\(c\.desk\?\{desk:\{decisions:c\.desk\.decisions\|\|\[\],plan:c\.desk\.plan\|\|DESK\.planOf\(c\)\}\}:\{\}\),lane:'ZIRVE5'/);
  assert.match(lc,/if\(a\.ok&&a\.complete&&l\.desk\?\.decisions\?\.length&&!l\.desk\.cf\)/);
  assert.match(lc,/positionDesk:deskStatus\(\)/);assert.equal((lc.match(/deskInfo:deskView\(a\)/g)||[]).length,2);
  const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(sv,/deskJudges:\{free:deskFreeWorker,jev:jev\.sovereignPositionDesk\}/);assert.match(sv,/openrouter-free-desk-health\.json/);
  const of=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.match(of,/function deskLine\(d\)/);assert.match(of,/deskLine\(a\.deskInfo\)/);assert.match(of,/deskSummaryLine\(z\.positionDesk,'ZIRVE5'\)/);
  for(const f of ['manage.ps1',path.join('jev-brain','JEV-DEPLOY.ps1')])assert.match(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),/'position-desk\.js'/,f);
  const fw=fs.readFileSync(path.join(__dirname,'..','openrouter-free-worker.js'),'utf8');assert.match(fw,/role==='POSITION_DESK'\?'':roleInstruction\(role\)/);
});
test('R2544.84 JEV desk function: same choices; not configured -> HOLD without a call',async()=>{
  const {createJevClient}=require('../jev-decision');const j=createJevClient({root:fs.mkdtempSync(path.join(os.tmpdir(),'jevd-')),apiKey:''});
  const r=await j.sovereignPositionDesk({packet:{symbol:'ARIAUSDT',side:'SHORT',stopChoices:{KEEP:0.105}}});
  assert.equal(r.called,false);assert.equal(r.action,'HOLD');
});
