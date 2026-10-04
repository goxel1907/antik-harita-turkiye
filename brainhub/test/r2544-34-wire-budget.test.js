'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {encodeMarketPacket,expandMarketPacket}=require('../jev-wire-market');
const J=require('../jev-decision'),{mirrorDigest,marketPacket}=require('../jev-market-packet');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/r2544-34-production-pass1.json'),'utf8'));
const clone=x=>JSON.parse(JSON.stringify(x));

test('R34 captured production PASS-1 fits 42 KB with the identical protected nine-frame truth',()=>{
 const input=clone(fixture),original=JSON.stringify(input),out=J.prepareDecisionRequest(input);
 assert.ok(out.diagnostics.beforeBytes>90000);assert.equal(out.ok,true);
 assert.ok(out.diagnostics.bytes<=42000,JSON.stringify(out.diagnostics));
 assert.equal(Buffer.byteLength(out.serialized),out.diagnostics.bytes);
 assert.equal(JSON.stringify(input),original);assert.deepEqual(J.protectedCoreTruth(out.body),J.protectedCoreTruth(input));
 assert.equal(out.diagnostics.wireEncoding.roundTripVerified,true);
 const decoded=expandMarketPacket(JSON.parse(out.serialized).state.coreMarketPacket);
 assert.deepEqual(decoded.chartOverlayLevels,input.state.coreMarketPacket.chartOverlayLevels);
 assert.deepEqual(decoded.microstructure,input.state.coreMarketPacket.microstructure);
 assert.deepEqual(mirrorDigest(out.body.state.coreMarketPacket),mirrorDigest(decoded));
 assert.ok(out.diagnostics.marketSectionsAfter.chartOverlayLevels<out.diagnostics.marketSectionsBefore.chartOverlayLevels);
});

test('R34 rows round-trip the complete public market fixture, including zero/null/false and timestamps',()=>{
 const p=fixture.state.coreMarketPacket,out=encodeMarketPacket(p);
 assert.equal(out.encoded,true);assert.equal(JSON.stringify(expandMarketPacket(out.packet)),JSON.stringify(p));
 assert.equal(p.wire,undefined);assert.ok(out.afterBytes<out.beforeBytes);
});

test('R34 verbose soft context cannot displace the captured protected numeric packet',()=>{
 const input=clone(fixture);
 input.state.professionalTraderCortex={reference:'Measured context. '.repeat(2000)};
 input.state.dynamicKnowledge={entries:Array.from({length:10},()=>({topic:'SMC',summary:'Optional research. '.repeat(90),keyPoints:['Reference only. '.repeat(20)]}))};
 input.state.experienceMemory={alwaysOn:true,lifetime:{samples:203,netPnl:-181.7,detail:'Measured closed outcomes. '.repeat(600)},caseMemoryByLane:{'5M_SCALP':{samples:50,summary:{wins:24,losses:26},analogs:Array.from({length:8},(_,i)=>({symbol:'TESTUSDT',netPnl:i%2?1:-1,note:'Soft counterexample. '.repeat(100)}))}}};
 const out=J.prepareDecisionRequest(input);assert.equal(out.ok,true);assert.ok(out.diagnostics.bytes<=42000,`bytes=${out.diagnostics.bytes}`);
 assert.deepEqual(J.protectedCoreTruth(out.body),J.protectedCoreTruth(input));
 assert.equal(out.body.state.experienceMemory.lifetime.samples,203);
});

test('R34 small packets retain the standard wire contract and repeated preparation is idempotent',()=>{
 const small={state:{coreMarketPacket:{symbol:'TESTUSDT',livePrice:0,coreFrames:{'5m':{available:false}}}},questions:{}};
 assert.equal(J.prepareDecisionRequest(small).body.state.coreMarketPacket.wire,undefined);
 const once=J.prepareDecisionRequest(fixture),twice=J.prepareDecisionRequest(once.body);
 assert.equal(twice.serialized,once.serialized);assert.equal(twice.diagnostics.coreTruthProtected,true);
});

test('R34 ambiguous or malformed row representations cannot silently change evidence',()=>{
 assert.equal(encodeMarketPacket({x:[['@r1',1,2]],a:{x:1,y:2},b:{x:2,y:3}}).encoded,false);
 const p=encodeMarketPacket(fixture.state.coreMarketPacket).packet;
 const q=clone(p),tag=Object.keys(q.wire.fields)[0];q.wire.fields[tag]=['__proto__','price'];
 assert.throws(()=>expandMarketPacket(q),/SCHEMA_INVALID/);
 const bad=clone(p);bad.coreFrames=['@rUNKNOWN',1];assert.throws(()=>expandMarketPacket(bad),/TAG_UNKNOWN/);
 const short=clone(p);short.coreFrames=[tag];assert.throws(()=>expandMarketPacket(short),/ROW_INVALID/);
});

test('R34 irreducible oversized numeric evidence remains blocked at 48 KB',()=>{
 const input=clone(fixture);input.state.coreMarketPacket.microstructure.irreducible=Array.from({length:16000},(_,i)=>i+0.00001);
 const out=J.prepareDecisionRequest(input);assert.equal(out.ok,false);assert.equal(out.diagnostics.maxBytes,48000);
 assert.equal(out.diagnostics.blockReason,'JEV_CORE_CONTEXT_TOO_LARGE');assert.equal(out.diagnostics.coreTruthProtected,true);
});

function unified(){
 const p=clone(fixture.state.coreMarketPacket),m=p.microstructure;
 const frames={...p.coreFrames,...p.timingFrames,...p.higherContext};
 for(const [tf,f] of Object.entries(frames)){
  f.officeOverlay=p.chartOverlayLevels[tf];
  f.smcContext={...f.smcContext,fibLevels:f.fibLevels||f.smcContext?.fibLevels,oteReference:f.oteReference||f.smcContext?.oteReference};
 }
 return {symbol:p.symbol,livePrice:p.livePrice,frames,global:p.global,dataQuality:p.dataQuality,
  microstructure:{...m,streaming:{...m,cvdCoverageMs:m.cvdCoverageSec*1000},liquidationHistory:p.liquidationHistory},
  marketMakerEvidence:{bookBehavior:m.bookBehavior,preEntryAdverseSelection:m.preEntryAdverseSelection,orderFlow:{available:m.orderFlowAvailable,asOf:m.orderFlowAsOf,ageMs:m.orderFlowAgeMs,source:m.orderFlowSource}},liquidationContext:{...p.observedLiquidations,coverageMs:p.observedLiquidations.observedForSec*1000},derivatives:p.derivatives};
}

for(const mode of ['PASS1','PASS2','BURST'])test(`R34 actual ${mode} client sends bounded UTF-8 JSON and preserves its numeric packet`,async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jev-r34-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config/jev.json'),JSON.stringify({enabled:true,dailyCapUsd:2}));
 let sent=null;const client=J.createJevClient({root,apiKey:'sk-or-v1-fake',fetchImpl:async(_,o)=>{
  sent=o.body;const b=JSON.parse(sent),answers=Object.fromEntries(Object.entries(b.questions).map(([k,v])=>[k,{choice:Object.keys(v.criteria)[0]}]));
  return {ok:true,status:200,text:async()=>JSON.stringify({answers,usage:{cost:0.00001}})};
 }});
 const u=unified(),candidate={symbol:u.symbol,side:'LONG'},packet=marketPacket(u);
 if(mode==='PASS1')await client.sovereignPass1({candidate,unified:u});
 if(mode==='PASS2')await client.sovereignFinal({candidate,unified:u,evidence:{},planOptions:[{id:'L5',side:'LONG',tradeLane:'5M_SCALP',entryPrice:u.livePrice,stopPrice:0.07,takeProfit1:0.077,takeProfit2:0.079,takeProfit3:0.082,originTF:'5m',ownerTF:'5m'}]});
 if(mode==='BURST')await client.sovereignBurstArm({candidate,chartContext:{symbol:u.symbol,available:true,packet,asOf:Date.now(),ageMs:0,source:'CAPTURED_PUBLIC_FIXTURE'}});
 assert.ok(sent,`${mode} did not reach the mock transport`);
 const cap=mode==='PASS1'?42000:mode==='PASS2'?46000:36000;
 assert.ok(Buffer.byteLength(sent)<=cap,`${mode} bytes=${Buffer.byteLength(sent)}`);
 t.diagnostic(`${mode}: ${Buffer.byteLength(sent)} / ${cap} target bytes; protected numeric parity verified`);
 assert.deepEqual(J.protectedCoreTruth(JSON.parse(sent)),J.protectedCoreTruth({state:{coreMarketPacket:packet}}));
 assert.deepEqual(expandMarketPacket(JSON.parse(sent).state.coreMarketPacket).chartOverlayLevels,packet.chartOverlayLevels);
 const metadata=JSON.parse(fs.readFileSync(path.join(root,'logs/jev-request-size.log'),'utf8').trim());
 assert.equal(metadata.bytes,Buffer.byteLength(sent));assert.equal(metadata.coreTruthProtected,true);
});
