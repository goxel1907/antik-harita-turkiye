'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const E=require('../engine'),P=require('../price-action'),M=require('../jev-market-packet'),J=require('../jev-decision'),C=require('../case-memory'),L=require('../trade-lessons'),W=require('../plan-workers');
const {expandMarketPacket}=require('../jev-wire-market');
const bars=require('./fixtures/r37-orca-5m.json').candles,golden=require('./fixtures/r37-pyvsmc-golden.json');
const anchor=Date.parse('2026-10-04T18:49:59.999Z'),confirmed=Date.parse('2026-10-04T19:04:59.999Z');
const target=xs=>xs.find(x=>x.at===anchor&&x.side==='BULL');
const baseFrame=()=>({...E.structure(bars,'5m'),fresh:true,source:'BINANCE_PUBLIC_KLINES'});

test('R37 ORCA internal full-range OB is confirmed before entry, retained on retest, and reaches engine',()=>{
 const a=P.analyzePriceAction(bars),z=target(a.orderBlocks.bullish);
 assert.ok(z);assert.deepEqual([z.low,z.high,z.confirmedAt,z.scope,z.zoneMode],[1.921,1.964,confirmed,'INTERNAL','FULL_RANGE']);
 assert.equal(z.state,'MITIGATED');assert.ok(z.touchAt>z.confirmedAt);
 assert.equal(target(P.analyzePriceAction(bars.filter(k=>k.closeTime<confirmed)).orderBlocks.bullish),undefined);
 assert.ok(target(E.structure(bars,'5m').orderBlocks.bullish));assert.equal(a.executionAuthority,false);
});

test('R37 independent pinned Python FVG-only oracle agrees with every returned JS origin and boundary',()=>{
 for(let n=3;n<=bars.length;n++){
  const pa=P.analyzePriceAction(bars.slice(0,n),{useBos:false});
  for(const z of [...pa.orderBlocks.bullish,...pa.orderBlocks.bearish]){
   const ref=golden.zones.find(x=>x.at===z.at&&x.side===z.side);
   assert.ok(ref,`${n} ${z.side} ${z.at}`);
   assert.deepEqual([z.low,z.high,z.confirmedAt],[ref.low,ref.high,ref.confirmedAt]);
  }
 }
 assert.equal(target(golden.zones).confirmedAt,confirmed);
});

test('R37 prefixes cannot backdate confirmation; adding future bars changes state, never origin geometry',()=>{
 const seen=new Map();
 for(let n=3;n<=bars.length;n++){
  const a=P.analyzePriceAction(bars.slice(0,n));
  for(const z of [...a.orderBlocks.bullish,...a.orderBlocks.bearish]){
   assert.ok(z.confirmedAt<=bars[n-1].closeTime&&z.confirmedAt>z.at);
   const id=z.side+':'+z.at,v=[z.low,z.high,z.confirmedAt,z.impulse,z.scope];
   if(seen.has(id))assert.deepEqual(v,seen.get(id));else seen.set(id,v);
  }
 }
});

test('R37 invalid chronology and malformed OHLC are explicitly unavailable',()=>{
 assert.equal(P.analyzePriceAction([...bars].reverse()).available,false);
 assert.equal(P.analyzePriceAction([{...bars[0],high:NaN},...bars.slice(1)]).available,false);
 assert.equal(P.analyzePriceAction([{...bars[0],low:bars[0].high+1},...bars.slice(1)]).available,false);
});

test('R37 internal BOS uses an already confirmed pivot; equal highs are not unique pivots',()=>{
 const rows=[[1,2,0,1],[1,3,0,2],[2,5,1,4],[4,4.5,2,3],[3,4,2.5,2.8],[2.8,6.5,2.6,6]];
 const c=rows.map(([open,high,low,close],i)=>({open,high,low,close,closeTime:(i+1)*300000}));
 const opts={useFvg:false,scopes:[['INTERNAL',2]]};
 assert.equal(P.analyzePriceAction(c.slice(0,5),opts).events.length,0);
 const a=P.analyzePriceAction(c,opts);assert.deepEqual(a.events,[{side:'BULL',kind:'BOS',scope:'INTERNAL',level:5,confirmedAt:1800000}]);
 assert.deepEqual([a.orderBlocks.bullish[0].low,a.orderBlocks.bullish[0].high,a.orderBlocks.bullish[0].at],[2.5,4,1500000]);
 c[3].high=5;assert.equal(P.analyzePriceAction(c,opts).events.length,0);
});

test('R37 LONG/SHORT mirror and gap-through/reclaim state are symmetric, broken originals never reactivated',()=>{
 const invert=k=>({...k,open:5-k.open,high:5-k.low,low:5-k.high,close:5-k.close});
 const a=P.analyzePriceAction(bars,{useBos:false}),b=P.analyzePriceAction(bars.map(invert),{useBos:false});
 const za=target(a.orderBlocks.bullish),zb=b.orderBlocks.bearish.find(x=>x.at===anchor);
 assert.deepEqual([zb.low,zb.high,zb.confirmedAt,zb.state],[5-za.high,5-za.low,za.confirmedAt,za.state]);
 const create=bars.slice(bars.findIndex(k=>k.closeTime===anchor)-1).filter(k=>k.closeTime<=confirmed);
 const append=(c,o,h,l,cl)=>[...c,{open:o,high:h,low:l,close:cl,closeTime:c.at(-1).closeTime+300000}];
 const broken=append(create,1.90,1.91,1.88,1.89);
 let z=target(P.analyzePriceAction(broken,{useBos:false}).orderBlocks.bullish);
 assert.equal(z.state,'BROKEN');assert.equal(z.mitigated,false,'a gap below is not zone overlap');
 z=target(P.analyzePriceAction(append(broken,1.94,1.96,1.93,1.94),{useBos:false}).orderBlocks.bullish);
 assert.equal(z.state,'BROKEN');assert.equal(z.mitigated,true);assert.equal(z.breaker,true);
 z=target(P.analyzePriceAction(append(broken,1.97,2,1.97,1.99),{useBos:false}).orderBlocks.bullish);
 assert.equal(z.state,'RECLAIMED');assert.equal(z.broken,true);assert.equal(z.breaker,false);
});

test('R37 frame-specific OB levels reach worker, JEV packet, nearest level map and mirror without cross-TF substitution',()=>{
 const f=baseFrame(),u={symbol:'ORCAUSDT',livePrice:f.close,frames:{'5m':f,'15m':{available:false}}};
 const p=M.marketPacket(u);assert.ok(target(p.coreFrames['5m'].orderBlocks.bullish));
 assert.deepEqual(p.coreFrames['5m'].priceAction,f.priceAction);assert.equal(p.coreFrames['15m'].available,false);
 assert.equal(M.mirrorDigest(p).coreFrames['5m'].priceAction.version,P.VERSION);
 assert.ok([...p.levelMap.above,...p.levelMap.below].some(x=>x.k.includes('5m:OB_BULL_INTERNAL')));
 const ctx=W.compactWorkerContext({candidate:{symbol:u.symbol},unified:u});
 assert.deepEqual(ctx.frames['5m'].orderBlocks,f.orderBlocks);assert.deepEqual(ctx.frames['5m'].priceAction,f.priceAction);
 assert.equal(ctx.chartOverlayLevels['5m'].nearestOb.scope,'INTERNAL');
});

test('R37 immutable entry memory retains both sides, exact penny prices and real OTE keys',()=>{
 const f=baseFrame();f.orderBlocks.bullish[0]={...f.orderBlocks.bullish[0],low:0.0000123456789,high:0.0000124456789};
 f.smcContext.oteReference={longDiscountZone:{low:0.00001,high:0.000012},shortPremiumZone:{low:0.00002,high:0.000022}};
 const s=C.frameSnapshot(f);assert.equal(s.orderBlocks.length,4);assert.equal(s.orderBlocks[0].low,0.0000123456789);
 assert.deepEqual(s.ote.long,f.smcContext.oteReference.longDiscountZone);assert.equal(s.priceAction.version,P.VERSION);
 const c={version:'R2544.37',immutable:true,frames:{'5m':s}},hash=C.hashObject(c),compact=C.compactEntryCase(c);
 assert.equal(compact.frames['5m'].orderBlocks[0].low,0.0000123456789);f.orderBlocks.bullish[0].low=999;
 assert.equal(C.hashObject(c),hash,'later mutable market updates do not rewrite entry');
 const card=L.lessonCard({symbol:'NOMUSDT',side:'LONG',netPnl:5,exitType:'EXTERNAL_CLOSE',entryContext:{entryCase:c}});
 assert.equal(card.exitAuthority,'EXTERNAL');assert.equal(card.priceActionAtEntry['5m'].version,P.VERSION);
});

test('R37 price-action cohorts retain winners and losers without inventing missing legacy observations',()=>{
 const frame=C.frameSnapshot(baseFrame()),ec={entryCase:{frames:{'5m':frame}}};
 const cards=[5,-4].map((net,i)=>L.lessonCard({symbol:'NOMUSDT',side:'LONG',netPnl:net,exitType:'EXTERNAL_CLOSE',closedAt:new Date(1800000+i*60000).toISOString(),entryContext:ec}));
 const d=L.digest(cards);assert.ok(d.byPriceAction.length);for(const r of d.byPriceAction){assert.equal(r[1],2);assert.equal(r[2],50);assert.equal(r[3],1);}
 assert.equal(L.digest([L.lessonCard({side:'LONG',netPnl:5}),L.lessonCard({side:'LONG',netPnl:-4})]).byPriceAction.length,0);
 const penny=C.buildEntryCase({unified:{livePrice:0.0000123456789,frames:{}},plan:{side:'LONG',entryPrice:0.0000123456789,stopPrice:0.0000113456789},takeProfit1:0.0000133456789,now:1000000});
 assert.deepEqual([penny.livePrice,penny.risk.entryPrice,penny.risk.stopPrice,penny.risk.takeProfit1],[0.0000123456789,0.0000123456789,0.0000113456789,0.0000133456789]);
});

for(const phase of ['PASS1','PASS2','BURST'])test(`R37 ${phase} client preserves exact price action through bounded serialized wire`,async t=>{
 const b=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/r2544-34-production-pass1.json'),'utf8'));
 const p=b.state.coreMarketPacket,frames={...p.coreFrames,...p.timingFrames,...p.higherContext};
 const f=baseFrame();for(const tf of ['5m','15m']){frames[tf].orderBlocks=f.orderBlocks;frames[tf].priceAction=f.priceAction;}
 for(const [tf,x] of Object.entries(frames)){x.officeOverlay=p.chartOverlayLevels[tf];x.smcContext={...x.smcContext,fibLevels:x.fibLevels||x.smcContext?.fibLevels,oteReference:x.oteReference||x.smcContext?.oteReference};}
 const ms=p.microstructure,u={symbol:p.symbol,livePrice:p.livePrice,frames,global:p.global,dataQuality:p.dataQuality,microstructure:{...ms,streaming:{...ms,cvdCoverageMs:ms.cvdCoverageSec*1000},liquidationHistory:p.liquidationHistory},marketMakerEvidence:{bookBehavior:ms.bookBehavior,preEntryAdverseSelection:ms.preEntryAdverseSelection,orderFlow:{available:ms.orderFlowAvailable,asOf:ms.orderFlowAsOf,ageMs:ms.orderFlowAgeMs,source:ms.orderFlowSource}},derivatives:p.derivatives,liquidationContext:{...p.observedLiquidations,coverageMs:p.observedLiquidations.observedForSec*1000}};
 const packet=M.marketPacket(u),root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'r37-fake-client-'));fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config/jev.json'),JSON.stringify({enabled:true,dailyCapUsd:2}));
 let sent=null;const client=J.createJevClient({root,apiKey:'sk-or-v1-fake',fetchImpl:async(_,opts)=>{sent=opts.body;const body=JSON.parse(sent);return {ok:true,status:200,text:async()=>JSON.stringify({answers:Object.fromEntries(Object.entries(body.questions).map(([k,v])=>[k,{choice:Object.keys(v.criteria)[0]}])),usage:{cost:0}})};}});
 const candidate={symbol:u.symbol,side:'LONG'};
 if(phase==='PASS1')await client.sovereignPass1({candidate,unified:u});
 if(phase==='PASS2')await client.sovereignFinal({candidate,unified:u,evidence:{},planOptions:[{id:'L5',side:'LONG',tradeLane:'5M_SCALP',entryPrice:u.livePrice,stopPrice:0.07,takeProfit1:0.077,takeProfit2:0.079,takeProfit3:0.082,originTF:'5m',ownerTF:'5m'}]});
 if(phase==='BURST')await client.sovereignBurstArm({candidate,chartContext:{symbol:u.symbol,available:true,packet,asOf:Date.now(),ageMs:0,source:'OFFLINE_REGRESSION'}});
 assert.ok(sent,'must reach fake transport');
 const limit=phase==='PASS1'?42000:phase==='PASS2'?46000:36000;
 assert.ok(Buffer.byteLength(sent)<=limit,`${phase}: ${Buffer.byteLength(sent)} / ${limit}`);t.diagnostic(`${phase}: ${Buffer.byteLength(sent)} / ${limit} bytes; fake transport only`);
 assert.deepEqual(J.protectedCoreTruth(JSON.parse(sent)),J.protectedCoreTruth({state:{coreMarketPacket:packet}}));
 assert.deepEqual(expandMarketPacket(JSON.parse(sent).state.coreMarketPacket).coreFrames['5m'].priceAction,f.priceAction);
});

test('R37 annotated chart draws the identified local zone; a broken original is hidden',()=>{
 const {renderChartPng}=require('../market'),f=baseFrame(),z=target(f.orderBlocks.bullish);
 const chart=ob=>renderChartPng({candles:bars,analysis:{orderBlocks:{bullish:ob,bearish:[]}}},'annotated');
 const bare=chart([]),active=chart([z]);assert.notDeepEqual(active,bare);assert.deepEqual(chart([{...z,broken:true}]),bare);
});

test('R37 vendored offline reference hashes match pinned manifest and deploy installs runtime algorithm',()=>{
 const r=path.join(__dirname,'../third-party/price-action'),m=JSON.parse(fs.readFileSync(path.join(r,'SOURCES.json')));
 for(const s of m.sources)for(const [name,hash] of Object.entries(s.files)){
  const folder=s.repo.replace('/','--');assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(r,folder,name))).digest('hex'),hash);
 }
 assert.match(fs.readFileSync(path.join(__dirname,'../manage.ps1'),'utf8'),/'price-action.js'/);
 assert.match(fs.readFileSync(path.join(__dirname,'../market.js'),'utf8'),/IC BOGA OB/);
});
