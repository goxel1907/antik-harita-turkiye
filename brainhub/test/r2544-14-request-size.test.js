'use strict';
// CLAUDE_R2544_14 (29.09 canlı): PASS-2'nin %42'si 52 kB tavanında bloklandı (JEV_REQUEST_CONTEXT_TOO_LARGE).
// Kök nedenler: (1) daha önce işlem açılmış coinlerde ölçülmüş sonuçtaki marketSignature ≈2,6–3,1 kB,
// (2) record.attention.baseFrames, coreMarketPacket 5m/15m'nin kopyası, (3) 1m/3m zamanlama çerçeveleri hiç özetlenmiyordu.
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('fs');const path=require('path');
const J=require('../jev-decision');
const geom={source:'CONFIRMED_PIVOT_GEOMETRY_CLOSED_CANDLES',lines:Array.from({length:4},(_,i)=>({role:'UPPER',from:{index:i,price:1.1+i,at:1790663699999},to:{index:i+20,price:1.3,at:1790670599999}})),pivots:Array.from({length:10},(_,i)=>({role:'HIGH',index:i,price:1.2+i/100,at:1790663699999}))};
const sig={regime5m:{trend:'UP',breakOfStructure:null,rsi14:56.9,atrPct:0.47,swingState:'MIXED',patterns:[{type:'RISING_WEDGE',side:'SHORT',status:'FORMING',at:1,geometry:geom},{type:'DOUBLE_TOP',side:'SHORT',status:'FORMING',neckline:1.4,at:1,geometry:geom}]},
  regime15m:{trend:'DOWN',rsi14:44,atrPct:0.9,swingState:'BEARISH',patterns:[{type:'BEAR_FLAG_OR_PENNANT',side:'SHORT',status:'FORMING',geometry:geom}]}};
const outcome={ts:1,kind:'POSITION_CLOSED',symbol:'PUMPUSDT',side:'LONG',setup:'JEV_R2537_STRUCTURAL_REVERSAL_15M_TRADE',setupFamily:'STRUCTURAL_REVERSAL',entryTiming:'MARKET_NOW',edgeBasis:'LIQUIDITY_SMC',outcomePct:-0.8,rMultiple:-1,exitType:'STOP_LOSS',lane:'15M_TRADE',holdMinutes:40,marketSignature:sig};
test('ölçülmüş sonuç imzası: geometri atılır, rejim özeti ve formasyon adları kalır',()=>{
  const c=J.compactSignature(sig);
  assert.deepEqual(c.regime5m,{trend:'UP',rsi14:56.9,atrPct:0.47,swingState:'MIXED',patterns:['RISING_WEDGE:SHORT:FORMING','DOUBLE_TOP:SHORT:FORMING']});
  assert.equal(c.regime15m.trend,'DOWN');
  const before=JSON.stringify(outcome).length;
  const m=J.compactExperienceMemory({measuredOutcomes:[outcome],jevLessons:[outcome],stats:[]},8500);
  const after=JSON.stringify(m.measuredOutcomes[0]).length;
  assert.ok(before>2000&&after<700,`sonuç ${before} → ${after} bayt`);
  assert.equal(m.measuredOutcomes[0].rMultiple,-1);assert.equal(m.measuredOutcomes[0].setupFamily,'STRUCTURAL_REVERSAL');
});
function body({timingNotes=0,desc=2000}={}){
  const f=(n)=>({available:true,fresh:true,close:1.2,trend:'UP',rsi14:55,atrPct:1,prior20High:1.3,prior20Low:1.1,preMove:{state:'WATCH'},volatility:{spike:null,extAtr:null,trail:null},
    swingStructure:{state:'BULLISH',confirmedPivots:[]},liquidity:{notes:'y'.repeat(n)},patterns:[]});
  const packet={chartNarrative:{t:'n'.repeat(15000)},coreFrames:{'5m':f(6000),'15m':f(6000)},timingFrames:{'1m':f(timingNotes),'3m':f(timingNotes)},
    higherContext:Object.fromEntries(['30m','45m','1h','4h','1d'].map(tf=>[tf,f(300)]))};
  return {model:'m',state:{description:'d'.repeat(desc),professionalTraderCortex:{r:'c'.repeat(1000)},dynamicKnowledge:{r:'k'.repeat(650)},
    experienceMemory:J.compactExperienceMemory({measuredOutcomes:[outcome],jevLessons:[outcome],stats:[]},8500),coreMarketPacket:packet,
    record:{attention:{baseFrames:{'5m':f(2500),'15m':f(2500)},radar:{sideHint:'LONG'}},executablePlanOptions:[{id:'LONG_15M_TRADE',x:'p'.repeat(2500)}],entryThesis:'t'.repeat(900)}},
    questions:{trade_plan:{q:'q'.repeat(8300)}}};
}
test('PASS-2: attention.baseFrames kopyası kimlik satırına iner; 5m/15m çekirdek aynen kalır',()=>{
  const out=J.prepareDecisionRequest(body());
  assert.equal(out.ok,true,JSON.stringify(out.diagnostics.trimStepsApplied));
  assert.ok(out.diagnostics.trimStepsApplied.includes('DUP_ATTENTION_BASEFRAMES'));
  const a=out.body.state.record.attention;
  assert.equal(a.baseFramesDetail,'SEE_CORE_MARKET_PACKET');assert.deepEqual(Object.keys(a.baseFrames['5m']).sort(),['asOf','available','close','fresh','trend'].sort());
  assert.equal(out.body.state.coreMarketPacket.coreFrames['5m'].liquidity.notes.length,6000,'5m çekirdek dokunulmadı');
});
test('son çare: 1m/3m özetlenir, istek tavanın altına iner; ön-hareket ve volatilite korunur',()=>{
  const out=J.prepareDecisionRequest(body({timingNotes:9000}));
  assert.equal(out.ok,true,out.diagnostics.bytes+' '+JSON.stringify(out.diagnostics.trimStepsApplied));
  assert.ok(out.diagnostics.trimStepsApplied.includes('TIMING_FRAMES_SUMMARY'));
  const t=out.body.state.coreMarketPacket.timingFrames['1m'];
  assert.equal(t.compacted,true);assert.equal(t.preMove.state,'WATCH');assert.ok('volatility' in t);assert.equal(t.liquidity,undefined);
  assert.equal(out.body.state.coreMarketPacket.coreFrames['15m'].liquidity.notes.length,6000);
});
test('Office: engelde kök neden önce, saat ve yaş; hacim oranı 2 basamak',()=>{
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(lc,/reasons:\[\.\.\.new Set\(\[\.\.\.\(Array\.isArray\(planResult\?\.riskGate\?\.reasons\)/);
  const oh=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.match(oh,/'ESKİ ENGEL'/);assert.match(oh,/dk önce\)/);assert.match(oh,/Number\(x\.volRel\)\.toFixed\(2\)/);
});
