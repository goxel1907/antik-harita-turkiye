'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const {createJevClient,compactSovereignEvidence}=require('../jev-decision');
const {buildSovereignPlanOptions}=require('../pipeline');
const {preflightRiskGate}=require('../risk-gate');
const {buildLeaderLiveIntent}=require('../leader-live-intent');

function root(){
  const r=fs.mkdtempSync(path.join(os.tmpdir(),'jev-r2532-'));
  fs.mkdirSync(path.join(r,'config'),{recursive:true});
  fs.mkdirSync(path.join(r,'docs'),{recursive:true});
  fs.copyFileSync(
    path.join(__dirname,'..','docs','JEV-PRO-TRADER-CORTEX-R2533.md'),
    path.join(r,'docs','JEV-PRO-TRADER-CORTEX-R2533.md')
  );
  fs.writeFileSync(path.join(r,'config','jev.json'),JSON.stringify({enabled:true,model:'typesafe/jev-1.13',dailyCapUsd:2,softBudgetUsd:0.25,maxPayloadChars:48000}));
  return r;
}
function response(body){
  return {ok:true,status:200,async text(){return JSON.stringify(body);}};
}
function frame(tf){
  return {
    available:true,fresh:true,asOf:Date.now(),close:100,trend:'MIXED',rsi14:52,atrPct:1,
    breakOfStructure:null,prior20High:102,prior20Low:98,
    swingStructure:{lastConfirmedSwingLow:{price:99},lastConfirmedSwingHigh:{price:101}},
    liquidity:{buySide:102,sellSide:98},patterns:[],candle:{closed:true},smcContext:{}
  };
}
function unified(){
  return {
    symbol:'BTCUSDT',livePrice:100,
    frames:{'1m':frame('1m'),'3m':frame('3m'),'5m':frame('5m'),'15m':frame('15m'),'30m':frame('30m'),'1h':frame('1h'),'4h':frame('4h'),'1d':frame('1d')},
    dataQuality:{advisoryUsable:true,microstructureQuality:'STREAMING_PARTIAL_BOOK'},
    microstructure:{available:true,spreadBps:1,depth20Imbalance:0.1},
    marketMakerEvidence:{participantIdentity:'NOT_IDENTIFIED',participantIntent:'NOT_ASSERTED',orderFlow:{available:true}},
    derivatives:{available:true},
    liquidationContext:{available:false,reason:'NO_RECENT_OBSERVED_FORCE_ORDER_PRINTS'},
    learning:{recent:[],stats:[]},
    opportunityPaths:{LONG:{continuity:[]},SHORT:{continuity:[]}}
  };
}

test('JEV sovereign PASS-1 directly chooses evidence requests without score thresholds',async t=>{
  const r=root();t.after(()=>fs.rmSync(r,{recursive:true,force:true}));
  let seen=null;
  const client=createJevClient({
    root:r,apiKey:'sk-or-v1-'+'x'.repeat(40),
    fetchImpl:async(_url,opt={})=>{
      const body=JSON.parse(opt.body);seen=body;
      const answers={};
      for(const [id,q] of Object.entries(body.questions)){
        assert.equal(q.type,'choice');
        if(id==='lane_focus')answers[id]={type:'choice',choice:'5M_SCALP'};
        else if(id==='direction_focus')answers[id]={type:'choice',choice:'BOTH'};
        else answers[id]={type:'choice',choice:(id==='evidence_tradingview_5m'||id==='evidence_order_flow_cvd')?'REQUEST':'SKIP'};
      }
      return response({answers,usage:{cost:0.00001}});
    }
  });
  const out=await client.sovereignPass1({candidate:{symbol:'BTCUSDT',side:'SHORT',deepScanReason:'CURRENT_ATTACK_TOP10'},unified:unified()});
  assert.equal(out.ok,true);
  assert.equal(out.laneFocus,'5M_SCALP');
  assert.equal(out.directionFocus,'BOTH');
  assert.deepEqual(out.requestedEvidence,['TRADINGVIEW_5M','ORDER_FLOW_CVD']);
  assert.match(seen.state.description,/sole strategic evidence director/i);
  assert.equal(JSON.stringify(seen).includes('0.65'),false);
});

test('JEV sovereign PASS-2 selects a concrete LONG/SHORT 5m or 15m plan by choice',async t=>{
  const r=root();t.after(()=>fs.rmSync(r,{recursive:true,force:true}));
  const plans=buildSovereignPlanOptions(unified());
  assert.ok(plans.some(x=>x.id==='LONG_5M_SCALP'));
  assert.ok(plans.some(x=>x.id==='SHORT_5M_SCALP'));
  assert.ok(plans.some(x=>x.id==='LONG_15M_TRADE'));
  assert.ok(plans.some(x=>x.id==='SHORT_15M_TRADE'));
  const client=createJevClient({
    root:r,apiKey:'sk-or-v1-'+'x'.repeat(40),
    fetchImpl:async(_url,opt={})=>{
      const body=JSON.parse(opt.body);
      assert.equal(body.questions.trade_plan.type,'choice');
      assert.ok(body.questions.trade_plan.criteria.WAIT);
      assert.ok(body.questions.trade_plan.criteria.LONG_5M_SCALP);
      return response({answers:{
        trade_plan:{type:'choice',choice:'LONG_5M_SCALP'},
        management_style:{type:'choice',choice:'TP1_BE_TRAIL'},
        target_profile:{type:'choice',choice:'RUNNER_EXTENDED'},
        partial_profile:{type:'choice',choice:'RUNNER_HEAVY'},
        breakeven_rule:{type:'choice',choice:'AFTER_TP1'},
        trail_rule:{type:'choice',choice:'5M_STRUCTURE'}
      },usage:{cost:0.00001}});
    }
  });
  const out=await client.sovereignFinal({candidate:{symbol:'BTCUSDT'},unified:unified(),evidence:{requested:['TRADINGVIEW_5M']},planOptions:plans});
  assert.equal(out.ok,true);
  assert.equal(out.finalAuthority,true);
  assert.equal(out.selectedPlan.side,'LONG');
  assert.equal(out.selectedPlan.originTF,'5m');
  assert.equal(out.managementStyle,'TP1_BE_TRAIL');
  assert.equal(out.targetProfile,'RUNNER_EXTENDED');
  assert.equal(out.partialProfile,'RUNNER_HEAVY');
  assert.equal(out.breakevenRule,'AFTER_TP1');
  assert.equal(out.trailRule,'5M_STRUCTURE');
});

test('post-JEV sovereign preflight checks integrity but does not re-vote structure or side-path scores',()=>{
  const u=unified();
  u.frames['5m'].breakoutExecution={status:'FAILED_BREAKOUT'};
  const plan={valid:true,status:'QUALIFIED',side:'LONG',originTF:'5m',ownerTF:'5m',jevSovereign:true};
  const out=preflightRiskGate({plan,unified:u});
  assert.equal(out.ok,true,JSON.stringify(out.reasons));
  assert.equal(out.strategicRevote,false);
  assert.equal(out.reasons.includes('ORIGIN_NOT_IN_SIDE_PATH'),false);
  assert.equal(out.reasons.includes('FAILED_BREAKOUT_REQUIRES_RECLAIM'),false);
});

test('live intent accepts JEV direction over scanner hint and preserves JEV structural geometry',()=>{
  const u=unified();
  const plan={
    valid:true,status:'QUALIFIED',side:'LONG',originTF:'5m',ownerTF:'5m',jevSovereign:true,
    invalidationPrice:99,stopPrice:98.9,takeProfit1:101.1,takeProfit2:102.2,takeProfit3:103.3
  };
  const out=buildLeaderLiveIntent({
    candidate:{symbol:'BTCUSDT',side:'SHORT'},unified:u,plan,
    marginQuote:30,leverage:10,
    filters:{tickSize:0.1,lotStep:0.001,minQty:0.001,maxQty:1000,minNotional:5},
    takerCommissionRate:0.0005,entryReferencePrice:100,jevFinalAuthority:true
  });
  assert.equal(out.ok,true,JSON.stringify(out.reasons));
  assert.equal(out.side,'LONG');
  assert.equal(out.stopPrice,98.9);
  assert.equal(out.takeProfit1,101.1);
  assert.ok(out.softWarnings.includes('SCANNER_SIDE_HINT_OVERRIDDEN_BY_JEV'));
});


test('JEV sovereign position manager chooses HOLD/PROTECT/PARTIAL/EXIT directly by choice',async t=>{
  const r=root();t.after(()=>fs.rmSync(r,{recursive:true,force:true}));
  const client=createJevClient({
    root:r,apiKey:'sk-or-v1-'+'x'.repeat(40),
    fetchImpl:async(_url,opt={})=>{
      const body=JSON.parse(opt.body);
      assert.equal(body.questions.position_action.type,'choice');
      assert.deepEqual(Object.keys(body.questions.position_action.criteria).sort(),['EXIT_NOW','HOLD','PARTIAL_TAKE_PROFIT','PROTECT_PROFIT'].sort());
      return response({answers:{position_action:{type:'choice',choice:'EXIT_NOW'}},usage:{cost:0.00001}});
    }
  });
  const out=await client.sovereignExit({
    position:{symbol:'BTCUSDT',side:'LONG',entryPrice:100,markPrice:99,quantity:1,unrealizedPnl:-1},
    lifecycle:{originTF:'5m',ownerTF:'15m',setup:'JEV_SOVEREIGN_5M_SCALP'},
    currentPlan:{status:'QUALIFIED',side:'LONG',originTF:'5m',ownerTF:'15m',jevSovereign:true},
    unified:unified(),
    evidence:{requested:['TRADINGVIEW_5M']}
  });
  assert.equal(out.ok,true);
  assert.equal(out.finalAuthority,true);
  assert.equal(out.action,'EXIT_NOW');
  assert.equal(out.mode,'SOVEREIGN_CHOICE');
});


test('sovereign plan options expose JEV-selectable invalidation bases without score gates',()=>{
  const u=unified();
  u.frames['5m'].swingStructure={lastConfirmedSwingLow:{price:99.4},lastConfirmedSwingHigh:{price:100.6}};
  u.frames['5m'].prior20Low=98.8;
  u.frames['5m'].prior20High=101.2;
  const plans=buildSovereignPlanOptions(u);
  const longs=plans.filter(x=>x.side==='LONG'&&x.lane==='5M_SCALP');
  assert.ok(longs.length>=2,JSON.stringify(longs));
  assert.ok(longs.every(x=>['SWING','PRIOR20','LIQUIDITY','ATR_FALLBACK'].includes(x.invalidationSource)));
  assert.equal(plans.some(x=>Object.prototype.hasOwnProperty.call(x,'score')),false);
});

test('bounded sovereign evidence prevents oversized final decision payloads',()=>{
  const huge={
    requested:['TRADINGVIEW_5M','TRADINGVIEW_15M','ORDER_FLOW_CVD','DERIVATIVES'],
    visual:{authority:'EVIDENCE_ONLY',requestedFrames:['5m','15m'],attached:2,required:2,source:'TEST',text:'x'.repeat(80000),frames:{'5m':{blob:'y'.repeat(20000)}}},
    historyOutcome:{recentOutcomes:Array.from({length:50},(_,i)=>({i,text:'z'.repeat(1000)})),stats:[]}
  };
  const out=compactSovereignEvidence(huge,12000);
  assert.ok(JSON.stringify(out).length<=12000,JSON.stringify(out).length);
  assert.equal(out.requested.includes('TRADINGVIEW_5M'),true);
});


test('JEV shadow teacher keeps outcome learning shadow-only',async t=>{
  const r=root();t.after(()=>fs.rmSync(r,{recursive:true,force:true}));
  const client=createJevClient({
    root:r,apiKey:'sk-or-v1-'+'x'.repeat(40),
    fetchImpl:async(_url,opt={})=>{
      const body=JSON.parse(opt.body);
      assert.equal(body.state.record.authority.application,'SHADOW_ONLY');
      assert.equal(body.state.record.authority.selfModify,false);
      assert.equal(body.state.record.authority.autoPromotion,false);
      assert.equal(body.state.professionalTraderCortex.version,'R2.5.3.3');
      assert.equal(body.state.professionalTraderCortex.mode,'SHADOW_KNOWLEDGE_REFERENCE');
      assert.match(body.state.professionalTraderCortex.reference,/Market regime/i);
      assert.match(body.state.professionalTraderCortex.reference,/5m scalp expertise/i);
      assert.match(body.state.professionalTraderCortex.reference,/No fixed score/i);
      return response({answers:{
        lesson_focus:{type:'choice',choice:'ENTRY_TIMING'},
        evidence_focus:{type:'choice',choice:'ORDER_FLOW'},
        lesson_action:{type:'choice',choice:'OBSERVE_MORE'},
        scope:{type:'choice',choice:'THIS_SETUP_ONLY'}
      },usage:{cost:0.00001}});
    }
  });
  const out=await client.sovereignLesson({
    symbol:'BTCUSDT',
    outcome:{side:'LONG',tradeLane:'5M_SCALP',setup:'JEV_SOVEREIGN_5M_SCALP',originTF:'5m',ownerTF:'5m',entryPrice:100,stopPrice:99,outcomePct:-0.2,rMultiple:-0.5,netPnl:-1,exitType:'STOP_LOSS',holdMinutes:8}
  });
  assert.equal(out.ok,true);
  assert.equal(out.teacher,'JEV');
  assert.equal(out.application,'SHADOW_ONLY');
  assert.equal(out.selfModify,false);
  assert.equal(out.autoPromotion,false);
  assert.equal(out.lessonFocus,'ENTRY_TIMING');
  assert.equal(out.evidenceFocus,'ORDER_FLOW');
});
