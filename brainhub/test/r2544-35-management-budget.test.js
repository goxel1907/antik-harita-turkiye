'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const J=require('../jev-decision'),{marketPacket}=require('../jev-market-packet');
const {expandMarketPacket}=require('../jev-wire-market');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/r2544-34-production-pass1.json'),'utf8'));
const clone=x=>JSON.parse(JSON.stringify(x));
test('R35 oversized immutable position thesis fails closed instead of trimming entry facts',()=>{
 const packet=clone(fixture.state.coreMarketPacket);
 const body={model:'typesafe/jev-1.13',state:{coreMarketPacket:packet,record:{contract:'R2.5.3.2_JEV_SOVEREIGN_POSITION_MANAGEMENT',entryThesis:{why:'immutable '.repeat(8000),levels:[1,2,3]},position:{quantity:100}}},questions:{action:{type:'choice'}}};
 const before=J.protectedCoreTruth(body),out=J.prepareDecisionRequest(body,{pass:'OTHER'});
 assert.equal(out.ok,false);assert.equal(out.diagnostics.coreTruthProtected,true);assert.match(out.diagnostics.blockReason,/TOO_LARGE/);
 assert.deepEqual(J.protectedCoreTruth(out.body),before);
});
test('R35 actual position manager sends nine-frame protected truth and preserves original thesis below 48 KB',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jev-r35-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config/jev.json'),JSON.stringify({enabled:true,dailyCapUsd:2}));
 const p=clone(fixture.state.coreMarketPacket),m=p.microstructure,frames={...p.coreFrames,...p.timingFrames,...p.higherContext};
 for(const [tf,f] of Object.entries(frames))f.officeOverlay=p.chartOverlayLevels[tf];
 const unified={symbol:p.symbol,livePrice:p.livePrice,frames,global:p.global,dataQuality:{...p.dataQuality,advisoryUsable:true},microstructure:{...m,streaming:{...m,cvdCoverageMs:m.cvdCoverageSec*1000},liquidationHistory:p.liquidationHistory},marketMakerEvidence:{bookBehavior:m.bookBehavior,preEntryAdverseSelection:m.preEntryAdverseSelection},liquidationContext:p.observedLiquidations,derivatives:p.derivatives};
 const pick=f=>({trend:f.trend,breakOfStructure:f.breakOfStructure,rsi14:f.rsi14,atrPct:f.atrPct,swingState:f.structure,patterns:clone(f.patterns||[]).slice(-3),readout:{stretchState:f.readout?.stretchState,zone:f.readout?.zone}});
 const thesis={patterns:[{type:'BREAKOUT',geometry:{price:0.07497,at:123}}],regime5m:pick(frames['5m']),regime15m:pick(frames['15m'])};
 let sent;
 const client=J.createJevClient({root,apiKey:'sk-or-v1-fake',fetchImpl:async(_,opts)=>{
  sent=opts.body;return {ok:true,status:200,text:async()=>JSON.stringify({answers:{position_action:{choice:'HOLD'},partial_fraction:{choice:'P33'}},usage:{cost:0.00001}})};
 }});
 const out=await client.sovereignExit({position:{symbol:p.symbol,side:'LONG',entryPrice:0.07497,markPrice:0.076,quantity:556,unrealizedPnl:0.57},unified,lifecycle:{initialQuantity:3334,initialEntryPrice:0.07497,initialStopPrice:0.07299,ownerTF:'5m',originTF:'5m',entryContext:{marketSignature:thesis,why:'Breakout retest'},managementState:{mfeR:1.7062,maeR:-0.3015},managementContract:{minProgressR:0.25,runnerFloor:0.25}},evidence:{text:'Optional measured evidence. '.repeat(180)}});
 assert.equal(out.called,true,JSON.stringify(out));assert.equal(out.ok,true,JSON.stringify(out));
 assert.ok(sent);assert.ok(Buffer.byteLength(sent)<=48000);
 const body=JSON.parse(sent),before={state:{...body.state,coreMarketPacket:marketPacket(unified)}};
 assert.deepEqual(J.protectedCoreTruth(body),J.protectedCoreTruth(before));
 const record=expandMarketPacket(body.state.record);
 assert.deepEqual(record.entryThesis.marketSignature,clone(thesis));
 assert.equal(record.position.quantity,556);assert.equal(record.lifecycle.initialQuantity,3334);
 assert.equal(record.positionProgress.mfeR,1.7062);
 const log=JSON.parse(fs.readFileSync(path.join(root,'logs/jev-request-size.log'),'utf8').trim());
 assert.equal(log.coreTruthProtected,true);assert.equal(log.blockReason,null);
 t.diagnostic(`POSITION_MANAGEMENT: ${Buffer.byteLength(sent)} / 48000 bytes; protected thesis and market parity`);
});
