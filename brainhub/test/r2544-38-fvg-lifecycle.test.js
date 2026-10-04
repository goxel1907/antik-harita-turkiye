'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fairValueGaps,VERSION}=require('../fvg-lifecycle'),E=require('../engine'),M=require('../jev-market-packet'),J=require('../jev-decision'),W=require('../plan-workers'),C=require('../case-memory'),L=require('../trade-lessons');
const base=[[9,10,8,9],[9,13,9,12],[12,14,12,13]];
const bars=rows=>rows.map(([open,high,low,close],i)=>({open,high,low,close,volume:100,closeTime:(i+1)*300000}));
const gap=rows=>fairValueGaps(bars(rows)).find(g=>g.at===900000&&g.side==='BULL');

test('R38 gap is unavailable before third close; the creating candle is not a test',()=>{
 assert.equal(fairValueGaps(bars(base.slice(0,2))).length,0);
 const g=gap(base);assert.deepEqual([g.low,g.high,g.ce50],[10,12,11]);
 assert.deepEqual(g.lifecycle,{version:VERSION,state:'UNTESTED',fillPct:0,testCount:0,ce50Touched:false});
});
test('R38 partial penetration, CE50 and separate contiguous visits are measured exactly',()=>{
 let rows=[...base,[13,13.2,11.5,12.5]],g=gap(rows);
 assert.equal(g.lifecycle.fillPct,25);assert.equal(g.lifecycle.testCount,1);assert.equal(g.lifecycle.ce50Touched,false);
 rows.push([12.5,13,11.75,12.8]);g=gap(rows);assert.equal(g.lifecycle.testCount,1);
 rows.push([12.8,13.5,12.4,13]);rows.push([13,13.1,11,11.8]);g=gap(rows);
 assert.equal(g.lifecycle.fillPct,50);assert.equal(g.lifecycle.testCount,2);assert.equal(g.lifecycle.state,'CE50_TESTED');
 assert.deepEqual([g.lifecycle.firstTestAt,g.lifecycle.lastTestStartedAt,g.lifecycle.ce50At],[1200000,2100000,2100000]);
});
test('R38 boundary-only contact does not invent penetration or midpoint contact',()=>{
 const g=gap([...base,[13,14,12,13]]);assert.equal(g.lifecycle.state,'TOUCHED');assert.equal(g.lifecycle.fillPct,0);assert.equal(g.lifecycle.testCount,1);assert.equal(g.lifecycle.ce50Touched,false);
});
test('R38 full wick fill and adverse closed invalidation are different observations',()=>{
 let g=gap([...base,[13,14,10,12.5]]);assert.equal(g.lifecycle.state,'FILLED');assert.equal(g.lifecycle.fillPct,100);assert.equal(g.lifecycle.invalidatedAt,undefined);
 g=gap([...base,[13,14,9,9.5]]);assert.equal(g.lifecycle.state,'INVALIDATED');assert.equal(g.lifecycle.filledAt,1200000);assert.equal(g.lifecycle.invalidatedAt,1200000);
});
test('R38 gap-through invalidation never fabricates a test, actual fill or CE50 contact',()=>{
 const g=gap([...base,[9,9.8,8,9]]);assert.equal(g.filled,true);assert.equal(g.touched,false);
 assert.deepEqual([g.lifecycle.state,g.lifecycle.fillPct,g.lifecycle.testCount,g.lifecycle.ce50Touched],['INVALIDATED',0,0,false]);
 assert.equal(g.lifecycle.reaction,undefined);
});
test('R38 post-touch extrema exclude the touch bar, signed close response is observed not forecast',()=>{
 const rows=[...base,[13,30,11.5,12.5]],g=gap(rows);
 assert.deepEqual(g.lifecycle.reaction,{barsAfterTest:0,closePct:4.167});
 const later=gap([...rows,[12.5,13,12.25,12.75]]);
 assert.deepEqual(later.lifecycle.reaction,{barsAfterTest:1,closePct:6.25,mfePct:8.333,maePct:0});
 assert.equal(g.lifecycle.reaction.mfePct,undefined,'cannot know if touch-bar high came before contact');
});
test('R38 retired gaps freeze their observations and never become active again',()=>{
 const rows=[...base,[13,13.5,10,12.5]],a=gap(rows),b=gap([...rows,[12.5,14,11,13],[13,14,11,13]]);
 assert.deepEqual(a,b);assert.equal(b.lifecycle.testCount,1);
});
test('R38 inverted bull/bear observations are symmetric and preserve price precision',()=>{
 const rows=[...base,[13,13.2,11.5,12.5],[12.5,13,12.25,12.75]];
 const inv=bars(rows).map(k=>({...k,open:40-k.open,high:40-k.low,low:40-k.high,close:40-k.close}));
 const a=gap(rows),b=fairValueGaps(inv).find(g=>g.at===900000&&g.side==='BEAR');
 const {reaction:ar,...al}=a.lifecycle,{reaction:br,...bl}=b.lifecycle;assert.deepEqual(al,bl);assert.deepEqual([b.low,b.high],[40-a.high,40-a.low]);
 assert.equal(ar.barsAfterTest,br.barsAfterTest);
 for(const key of ['closePct','mfePct','maePct'])assert.ok(Math.abs(ar[key]*a.high-br[key]*b.low)<0.025,'same absolute response, percentage normalized to each side entry edge');
 const tiny=bars(base).map(k=>({...k,open:k.open*0.0000001,high:k.high*0.0000001,low:k.low*0.0000001,close:k.close*0.0000001}));
 assert.equal(fairValueGaps(tiny)[0].high,12*0.0000001);
});
test('R38 malformed OHLC and chronology produce no fabricated gaps',()=>{
 const c=bars(base);assert.deepEqual(fairValueGaps([...c].reverse()),[]);
 assert.deepEqual(fairValueGaps(c.map((k,i)=>i===1?{...k,low:k.high+1}:k)),[]);
 assert.deepEqual(fairValueGaps(c.map((k,i)=>i===1?{...k,close:NaN}:k)),[]);
});
test('R38 full-history and incremental prefixes never backdate a test or rewrite zone boundaries',()=>{
 const c=require('./fixtures/r37-orca-5m.json').candles,seen=new Map();
 for(let n=3;n<=c.length;n++)for(const g of fairValueGaps(c.slice(0,n))){
  assert.ok(g.at<=c[n-1].closeTime);for(const t of ['firstTestAt','ce50At','filledAt','invalidatedAt'])if(g.lifecycle[t])assert.ok(g.lifecycle[t]>g.at&&g.lifecycle[t]<=c[n-1].closeTime);
  const key=g.side+':'+g.at;if(seen.has(key)){const old=seen.get(key);assert.deepEqual([g.low,g.high,g.at],[old.low,old.high,old.at]);assert.ok(g.lifecycle.fillPct>=old.lifecycle.fillPct);assert.ok(g.lifecycle.testCount>=old.lifecycle.testCount);}seen.set(key,g);
 }
});
test('R38 engine, worker, mirror, protected packet and immutable memory carry same lifecycle',()=>{
 const f={...E.structure(require('./fixtures/r37-orca-5m.json').candles,'5m'),fresh:true},u={symbol:'ORCAUSDT',livePrice:f.close,frames:{'5m':f}};
 assert.ok(f.recentFairValueGaps.length&&f.fairValueGapHistory.length);
 const p=M.marketPacket(u);assert.deepEqual(p.coreFrames['5m'].recentFairValueGaps,f.recentFairValueGaps);
 assert.deepEqual(p.coreFrames['5m'].fairValueGapHistory,f.fairValueGapHistory);
 assert.deepEqual(M.mirrorDigest(p).coreFrames['5m'].fairValueGapHistory,f.fairValueGapHistory);
 assert.deepEqual(W.compactWorkerContext({unified:u}).frames['5m'].recentFairValueGaps,f.recentFairValueGaps);
 const prepared=J.prepareDecisionRequest({state:{coreMarketPacket:p},questions:{}},{pass:1});assert.equal(prepared.diagnostics.coreTruthProtected,true);
 const ec=C.buildEntryCase({unified:u,plan:{side:'LONG'},now:2000000}),saved=JSON.stringify(ec),compact=C.compactEntryCase(ec);
 assert.deepEqual(compact.frames['5m'].fvg[0].lifecycle,f.recentFairValueGaps[0].lifecycle);
 assert.deepEqual(compact.frames['5m'].fvgHistory[0].lifecycle,f.fairValueGapHistory[0].lifecycle);
 f.recentFairValueGaps[0].lifecycle.testCount=999;assert.equal(JSON.stringify(ec),saved);
});
test('R38 entry lifecycle learning includes both winners and losses; old missing evidence stays unknown',()=>{
 const f=C.frameSnapshot({...E.structure(require('./fixtures/r37-orca-5m.json').candles,'5m'),fresh:true}),entryContext={entryCase:{frames:{'5m':f}}};
 const cards=[5,-4].map((net,i)=>L.lessonCard({symbol:'ORCAUSDT',side:'LONG',netPnl:net,closedAt:new Date(2000000+i*300000).toISOString(),exitType:'EXTERNAL_CLOSE',entryContext}));
 assert.deepEqual(cards[0].priceActionAtEntry['5m'].fvg[0].lifecycle,f.fvg[0].lifecycle);
 const d=L.digest(cards);assert.ok(d.byFvgLifecycle.length);for(const r of d.byFvgLifecycle){assert.equal(r[1],2);assert.equal(r[2],50);assert.equal(r[3],1);}
 assert.equal(L.digest([L.lessonCard({netPnl:5})]).byFvgLifecycle.length,0);
});
test('R38 deploy manifest contains lifecycle module and new feature markers',()=>{
 const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
 assert.match(read('manage.ps1'),/'fvg-lifecycle.js'/);assert.match(read('server.js'),/R2544_38_FVG_LIFECYCLE/);assert.match(read('jev-brain/JEV-DEPLOY.ps1'),/R2544_38_FVG_ENTRY_MEMORY/);
});

test('R38 constrained PASS1 and PASS2 preserve measured lifecycle cohorts and exact entry analogs',()=>{
 const f=C.frameSnapshot({...E.structure(require('./fixtures/r37-orca-5m.json').candles,'5m'),fresh:true});
 const cards=[5,-4].map(net=>L.lessonCard({side:'LONG',netPnl:net,exitType:'EXTERNAL_CLOSE',entryContext:{entryCase:{frames:{'5m':f}}}}));
 const lessons=L.digest(cards),analog={side:'LONG',netPnl:5,priceActionAtEntry:cards[0].priceActionAtEntry};
 for(const phase of [1,2]){
  const body=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/r2544-34-production-pass1.json'),'utf8'));
  body.questions=phase===1?{lane_focus:{}}:{trade_plan:{}};
  body.state.experienceMemory={alwaysOn:true,tradeLessons:lessons,caseMemory:{available:true,analogs:[analog,{...analog,netPnl:-4}]}};
  const out=J.prepareDecisionRequest(body,{targetBytes:30000});
  assert.equal(out.ok,true);assert.equal(out.diagnostics.pass,phase);assert.equal(out.diagnostics.coreTruthProtected,true);
  assert.deepEqual(out.body.state.experienceMemory.tradeLessons.byFvgLifecycle,lessons.byFvgLifecycle.slice(0,3));
  assert.deepEqual(out.body.state.experienceMemory.caseMemory.analogs[0].priceActionAtEntry['5m'].fvg[0].lifecycle,f.fvg[0].lifecycle);
  assert.equal(out.body.state.experienceMemory.caseMemory.executionAuthority,false);
 }
});
