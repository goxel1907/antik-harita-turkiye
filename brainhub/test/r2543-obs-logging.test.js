'use strict';
// CLAUDE_R2543_OBS (Claude Work, 2026-09-28): salt gözlem yaması regresyonu.
// Karar/boyut mantığı DEĞİŞMEZ; yalnız blok/budama nedenleri sayılarıyla görünür olur.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {prepareDecisionRequest,MAX_DECISION_REQUEST_BYTES}=require('../jev-decision');

test('R2543 OBS: küçük istekte budama adımı kaydedilmez',()=>{
  const out=prepareDecisionRequest({state:{record:{symbol:'XUSDT'}},questions:{lane_focus:{}}});
  assert.equal(out.ok,true);
  assert.deepEqual(out.diagnostics.trimStepsApplied,[]);
  assert.equal(out.diagnostics.marketTrimApplied,false);
});

test('R2543 OBS: tavan aşılınca çalışan budama adımları sırayla kaydedilir, tavan korunur',()=>{
  const big='x'.repeat(20000);
  const patterns=Array.from({length:40},(_,i)=>({type:'P'+i,geometry:{points:Array.from({length:60},(_,k)=>[k,k*1.5])}}));
  const input={state:{
    professionalTraderCortex:{reference:big},
    dynamicKnowledge:{entries:Array.from({length:10},()=>({summary:big.slice(0,3000),keyPoints:['a','b','c'],sourceUrls:['u1','u2']})),text:big},
    experienceMemory:{stats:Array.from({length:20},()=>({k:big.slice(0,500)}))},
    record:{frames:{'5m':{patterns},'15m':{patterns}}}
  },questions:{lane_focus:{}}};
  const out=prepareDecisionRequest(input);
  const steps=out.diagnostics.trimStepsApplied;
  assert.ok(Array.isArray(steps)&&steps.length>0);
  assert.equal(steps[0],'SEMANTIC_OPTIONAL_CONTEXT_PROJECTION');
  assert.ok(out.diagnostics.bytes<=MAX_DECISION_REQUEST_BYTES);
  assert.equal(out.ok,true);
  assert.equal(out.diagnostics.marketTrimApplied,steps.some(x=>['PATTERN_GEOMETRY','SWING_PIVOTS_TRENDLINES','DUP_FVG_SMC_TEXT','FIB_OTE_RAW','PATTERNS_TOP3_BOTH_SIDES_PER_TF','HIGHER_CONTEXT_SUMMARY','TIMING_FRAMES_SUMMARY'].includes(x)));assert.equal(out.diagnostics.coreTruthProtected,true);
});

test('R2543 OBS: HARD_BLOCK olayı ve sonucu risk sayılarını taşır; fast-lane logu nedenleri yazar',()=>{
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(lc,/function intentRiskContext\(intent,riskCapContext,settings\)/);
  assert.match(lc,/stage:'HARD_BLOCK',symbol:candidate\.symbol,reasons:intent\.reasons\|\|\[\],riskContext\}/);
  assert.match(lc,/retryable:false,\n        riskContext,\n        execution:'LEADER_AUTO_BLOCKED'/);
  const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(sv,/function fastLaneObsSuffix\(result\)/);
  assert.match(sv,/plan='\+\(out\.result\?\.plan\?\.status\|\|'-'\)\+fastLaneObsSuffix\(out\.result\)\);/);
});

test('R2543 OBS: gözlem yaması güvenlik sözleşmesini değiştirmez (exact panel + fail-closed risk tavanı)',()=>{
  const li=fs.readFileSync(path.join(__dirname,'..','leader-live-intent.js'),'utf8');
  assert.match(li,/const riskCapApplied = false;/);
  assert.match(li,/reasons\.push\('TRADE_RISK_CAP_EXCEEDED'\)/);
  assert.match(li,/reasons\.push\('STOP_BEYOND_LIQUIDATION'\)/);
});
