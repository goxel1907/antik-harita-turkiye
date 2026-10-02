'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {sovereignFinalConsistency}=require('../jev-decision');
const {guidanceForSide,localL2Usable}=require('../preentry-microstructure');
const {splitTakeProfitQty}=require('../binance-live-transport');
const guard=require('../position-guard');
const v111=require('../claude-v111');
const lessons=require('../trade-lessons');
const cases=require('../case-memory');

test('R2544.28 rejects NONE_WAIT + executable MARKET_NOW (ALICE class)',()=>{
  const x=sovereignFinalConsistency({selectedId:'PLAN_A',selectedPlan:{side:'LONG'},setupFamily:'NONE_WAIT',entryTiming:'MARKET_NOW',waitReasonRaw:'NONE_MARKET_NOW',edgeBasis:'STRUCTURE_LOCATION',preEntryFlowAssessment:'NEUTRAL_OR_MIXED',coreMarket:{}});
  assert.equal(x.ok,false); assert.ok(x.issues.includes('EXECUTABLE_PLAN_WITH_NONE_WAIT'));
});

test('R2544.28 rejects ORDER_FLOW_DEPTH plan against selected-side trap/wait evidence (BULLA class)',()=>{
  const x=sovereignFinalConsistency({selectedId:'PLAN_A',selectedPlan:{side:'SHORT'},setupFamily:'TREND_PULLBACK',entryTiming:'MARKET_NOW',waitReasonRaw:'NONE_MARKET_NOW',edgeBasis:'ORDER_FLOW_DEPTH',preEntryFlowAssessment:'NEUTRAL_OR_MIXED',coreMarket:{microstructure:{preEntryAdverseSelection:{short:{state:'TRAP_RISK_ELEVATED'},entryTimingGuidance:{SHORT:'WAIT_FLOW_NORMALIZATION'}}}}});
  assert.equal(x.ok,false); assert.ok(x.issues.includes('ORDER_FLOW_EDGE_AGAINST_WAIT_GUIDANCE')); assert.ok(x.issues.includes('ORDER_FLOW_EDGE_ON_TRAP_RISK_SIDE'));
});

test('R2544.28 allows coherent location-based MARKET_NOW plan',()=>{
  const x=sovereignFinalConsistency({selectedId:'PLAN_A',selectedPlan:{side:'LONG'},setupFamily:'TREND_PULLBACK',entryTiming:'MARKET_NOW',waitReasonRaw:'NONE_MARKET_NOW',edgeBasis:'STRUCTURE_LOCATION',preEntryFlowAssessment:'NEUTRAL_OR_MIXED',coreMarket:{}});
  assert.equal(x.ok,true);
});

test('R2544.28 healthy sequence-safe local L2 prevents false DATA_INSUFFICIENT',()=>{
  const l2={available:true,sequenceHealthy:true,state:'HEALTHY',confidence:0.88,ageMs:250};
  assert.equal(localL2Usable(l2),true);
  const g=guidanceForSide({state:'CONTINUATION_SUPPORT'}, {usable:false}, {overall:{usable:false}}, l2);
  assert.equal(g,'FLOW_SUPPORTS_ENTRY');
});

test('R2544.28 JEV RUNNER_HEAVY quantities reach Binance split',()=>{
  assert.deepEqual(splitTakeProfitQty(100,1,[0.25,0.25,0.50]),[25,25,50]);
  assert.deepEqual(splitTakeProfitQty(100,1,[0.50,0.25,0.25]),[50,25,25]);
});

test('R2544.28 15M winner is not mechanically cut at +0.5R; ordinary 5M still can be',()=>{
  const snap={side:'LONG',entryPrice:100,markPrice:105.5,qty:10,tickSize:0.01};
  const base={side:'LONG',entryPrice:100,originalStopPrice:90,currentStop:90,createdAt:Date.now()-5*60000};
  const trade=guard.evaluateGuard({row:{...base,lane:'15M_TRADE',partialProfile:'THIRDS'},snap,phase:'INITIAL'});
  assert.notEqual(trade.action,'SCALE_OUT');
  const scalp=guard.evaluateGuard({row:{...base,lane:'5M_SCALP',partialProfile:'THIRDS'},snap,phase:'INITIAL'});
  assert.equal(scalp.action,'SCALE_OUT');
  const heavy=guard.evaluateGuard({row:{...base,lane:'5M_SCALP',partialProfile:'RUNNER_HEAVY'},snap,phase:'INITIAL'});
  assert.notEqual(heavy.action,'SCALE_OUT');
});

test('R2544.28 JEV trail rule is executable',()=>{
  assert.equal(v111.trailTimeframe({originTF:'5m',lane:{},preferredRule:'15M_STRUCTURE'}).tf,'15m');
  assert.equal(v111.trailTimeframe({originTF:'15m',lane:{},preferredRule:'5M_STRUCTURE'}).tf,'5m');
});

test('R2544.28 outcome learns profit capture and ZRO-like fast mixed-flow MARKET_NOW timing loss',()=>{
  const op=cases.buildOutcomePath({row:{openedAt:'2026-10-02T10:09:00Z',guardMfeR:0.83,guardMaeR:-0.08},runner:{events:[]},closedAt:Date.parse('2026-10-02T10:49:00Z'),netPnl:9.58,rMultiple:0.46,exitType:'TAKE_PROFIT',income:{realized:9.58}});
  assert.ok(op.captureEfficiency>0.5&&op.captureEfficiency<0.6);
  const winner=lessons.lessonCard({symbol:'HUMAUSDT',side:'LONG',netPnl:9.58,rMultiple:0.46,holdMinutes:40,exitType:'TAKE_PROFIT',outcomePath:op,entryContext:{setupFamily:'TREND_PULLBACK',entryTiming:'MARKET_NOW'}});
  assert.ok(winner.tags.includes('LOW_PROFIT_CAPTURE'));
  const zro=lessons.lessonCard({symbol:'ZROUSDT',side:'LONG',netPnl:-4.79,rMultiple:-0.96,holdMinutes:4,exitType:'STOP_LOSS',outcomePath:{mfeR:0.05,maeR:-0.96},entryContext:{setupFamily:'TREND_PULLBACK',entryTiming:'MARKET_NOW',preEntryFlowAssessment:'NEUTRAL_OR_MIXED'}});
  assert.ok(zro.tags.includes('MARKET_NOW_MIXED_FLOW_FAST_LOSS'));
});
