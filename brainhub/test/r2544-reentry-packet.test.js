'use strict';
// CLAUDE_R2544.3 (28.09.2026 canlı bulgular): MARSCOIN zararla kapandıktan 52 sn sonra yeniden girildi;
// PASS-2 isteklerinin 3/17'si 52 kB tavanını aştı (JEV_REQUEST_CONTEXT_TOO_LARGE).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {prepareDecisionRequest,MAX_DECISION_REQUEST_BYTES}=require('../jev-decision');

function bigFrame(tf,n=1){
  return {available:true,fresh:true,asOf:1,close:1.23,trend:'UP',rsi14:55,atrPct:1.2,prior20High:1.3,prior20Low:1.1,
    swingStructure:{state:'BULLISH',notes:'x'.repeat(300*n)},liquidity:{equalHigh:{price:1.3},notes:'y'.repeat(900*n)},
    orderBlocks:{bullish:[{low:1,high:1.1,text:'z'.repeat(500*n)}],bearish:[]},fibLevels:{a:'q'.repeat(700*n)},patterns:[]};
}
test('PASS-2 aşırı büyük pakette üst bağlam özetlenir; 5m/15m çekirdek aynen kalır; istek tavanın altına iner',()=>{
  const core={'5m':bigFrame('5m',2),'15m':bigFrame('15m',2)};
  const packet={coreFrames:JSON.parse(JSON.stringify(core)),timingFrames:{'1m':bigFrame('1m'),'3m':bigFrame('3m')},
    higherContext:Object.fromEntries(['30m','45m','1h','4h','1d'].map(tf=>[tf,bigFrame(tf,4)]))};
  const input={state:{professionalTraderCortex:{reference:'r'.repeat(3000)},coreMarketPacket:packet,record:{entryThesis:'t'.repeat(3000)}},questions:{trade_plan:{}}};
  const before=Buffer.byteLength(JSON.stringify(input));
  assert.ok(before>MAX_DECISION_REQUEST_BYTES,'test paketi tavanı aşmalı: '+before);
  const out=prepareDecisionRequest(input);
  assert.equal(out.ok,true,JSON.stringify(out.diagnostics.trimStepsApplied));
  assert.ok(out.diagnostics.trimStepsApplied.includes('HIGHER_CONTEXT_SUMMARY'));
  const cmp=out.body.state.coreMarketPacket;
  assert.equal(cmp.higherContext['4h'].compacted,true);
  assert.equal(cmp.higherContext['4h'].trend,'UP');
  assert.equal(cmp.coreFrames['5m'].liquidity.notes.length,1800,'5m çekirdek dokunulmadı');
});

test('zararla kapanış (JEV EXIT_NOW dahil) aynı coine yeniden girişi her yolda soğutur',()=>{
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(lc,/exitType==='STOP_LOSS'\|\|exitType==='TP1_THEN_STOP'\|\|\(finite\(netPnl\)!==null&&netPnl<0\)/);
  assert.match(lc,/\.filter\(x=>!reentryBlock\(x\?\.symbol\)\)/,'ana OTO döngüsü');
  assert.match(lc,/\.filter\(c=>!reentryBlock\(c\?\.symbol\)\)/,'hızlı hat');
  assert.match(lc,/const rs=\['REENTRY_COOLDOWN_AFTER_LOSS'\];/,'son kapı');
  assert.ok(lc.indexOf("REENTRY_COOLDOWN_AFTER_LOSS")<lc.indexOf('const intent = buildLeaderLiveIntent({'),'emir inşasından önce');
});
