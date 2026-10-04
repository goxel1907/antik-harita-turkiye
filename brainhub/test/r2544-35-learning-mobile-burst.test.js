'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {mobileStatus}=require('../mobile-status'),{exitEvidence}=require('../burst-scalp');
const {buildOutcomePath}=require('../case-memory'),{openStore}=require('../store');
const {createJevClient}=require('../jev-decision');
const {learningQuality}=require('../learning-quality');
test('R35 burst experience survives every regular entry memory compaction',()=>{
 const j=require('../jev-decision'),item={symbol:'ABCUSDT',side:'SHORT',realizedR:-.3,authority:'JEV',measurement:'GROSS_PRICE_PATH_NOT_FEE_RECONCILED_NET_PNL'};
 const mem={burstExperience:[item]};
 for(const f of [j.compactMemoryForDecision,j.compactMemoryForPass1Routing,j.compactMemoryForPass2Final,j.compactMemoryForPass2Residual])assert.deepEqual(f(mem,2).burstExperience,[item]);
});
test('R35 legacy TP/PNL exit guesses are flagged in soft memory while raw history and financial totals stay intact',()=>{
 const raw={exitType:'TP1_BREAKEVEN',netPnl:5.65,rMultiple:.8631,outcomePath:{mfeR:null,maeR:null}},before=JSON.stringify(raw);
 const q=learningQuality(raw);assert.equal(q.exitType,'UNVERIFIED_LEGACY_EXIT');assert.equal(q.recordedExitType,'TP1_BREAKEVEN');assert.equal(q.netPnl,5.65);
 assert.equal(JSON.stringify(raw),before);assert.ok(q.qualityWarnings.includes('EXCURSION_PATH_UNMEASURED'));
 assert.equal(learningQuality({...raw,exitEvidenceVersion:'R2544.35'}).exitType,'TP1_BREAKEVEN');
});
test('R35 mobile projection preserves live truth, decisions and measured totals without market dossiers',()=>{
 const s={armed:true,expiresAt:'2099-01-01',runtimeRelease:'R35',leaderAuto:{enabled:true,lastTickAt:'now',diagnostics:{candidates:[{symbol:'ABCUSDT',jevDecision:{called:true,entryTiming:'WAIT',jevSeen:{frames:{junk:'x'.repeat(100000)}}}}]}},learning:{measuredSampleCount:172,jevLessonCount:24,lifetime:{wins:85},caseMemory:{junk:'x'.repeat(100000)}}};
 const before=JSON.stringify(s),o=mobileStatus(s);
 assert.equal(o.armed,true);assert.equal(o.leaderAuto.enabled,true);assert.equal(o.leaderAuto.diagnostics.candidates[0].jevDecision.entryTiming,'WAIT');
 assert.equal(o.learning.measuredSampleCount,172);assert.equal(o.learning.jevLessonCount,24);assert.ok(Buffer.byteLength(JSON.stringify(o))<2000);assert.equal(JSON.stringify(s),before);
});
test('R35 runner observations populate outcome path and capture, not stale lifecycle fields',()=>{
 const p=buildOutcomePath({row:{openedAt:'2026-10-04T10:00:00Z',guardMfeR:0},runner:{guardMfeR:1.7062,guardMaeR:-0.3015,guardMfeAt:Date.parse('2026-10-04T10:30:00Z'),events:[]},netPnl:5.65,rMultiple:.8631,exitType:'EXTERNAL_CLOSE',closedAt:Date.parse('2026-10-04T11:00:00Z')});
 assert.equal(p.mfeR,1.7062);assert.equal(p.maeR,-.3015);assert.equal(p.timeToMfeMin,30);assert.ok(p.captureEfficiency>.5&&p.captureEfficiency<.51);assert.equal(p.excursionSource,'RUNNER_OBSERVED_MARKS');
});
test('R35 burst profit has no fixed R exit; duration protection uses injected clock',()=>{
 const snap={available:true,ageMs:100,bid:102,ask:102.02,spreadBps:1};
 const a={side:'LONG',entryPrice:100,stopPrice:99,openedAt:1000,mfeR:2,maeR:0};
 assert.equal(exitEvidence(snap,a,6000).exit,false);
 assert.equal(exitEvidence(snap,a,121001).reason,'BURST_TIME_EXIT');
});
test('R35 burst outcomes reach soft memory and a JEV exit request without claiming fee-reconciled net PnL',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'burst-r35-'));
 const store=openStore(root);t.after(()=>{store.db.close();fs.rmSync(root,{recursive:true,force:true});});
 store.recordLearning('BURST_CLOSED','ABCUSDT',{burstId:'b1',side:'LONG',exitReason:'JEV_BURST_EXIT',realizedR:1.2,mfeR:1.5,maeR:-.1,captureEfficiency:.8,authority:'JEV'});
 const memory=store.learningContext({symbol:'ABCUSDT'});
 assert.equal(memory.burstExperience.length,1);assert.equal(memory.measuredSampleCount,0);
 fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config/jev.json'),JSON.stringify({enabled:true,dailyCapUsd:2}));let body;
 const client=createJevClient({root,apiKey:'sk-or-v1-fake',fetchImpl:async(_,opts)=>{body=JSON.parse(opts.body);return {ok:true,status:200,text:async()=>JSON.stringify({answers:{burst_exit:{choice:'EXIT_NOW'}}})};}});
 const out=await client.sovereignBurstExit({active:{burstId:'b2',symbol:'ABCUSDT',side:'SHORT',quantity:10,entryPrice:100,stopPrice:101,leverage:100},stream:{available:true,ageMs:100,bid:99,ask:99.01,spreadBps:1},progress:{progressR:1},learning:memory});
 assert.equal(out.ok,true,JSON.stringify(out));assert.equal(out.action,'EXIT_NOW');assert.equal(body.state.record.position.side,'SHORT');assert.equal(body.state.experienceMemory.burstExperience[0].realizedR,1.2);
 assert.equal(body.state.experienceMemory.burstExperience[0].measurement,'GROSS_PRICE_PATH_NOT_FEE_RECONCILED_NET_PNL');
});
