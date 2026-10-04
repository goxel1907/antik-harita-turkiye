'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {marketPacket}=require('../jev-market-packet');
const {enrichCloses}=require('../office-performance');
const {createJevClient}=require('../jev-decision');
test('nested Binance derivatives survive packet serialization; unknown is not zero',()=>{
 const p=marketPacket({derivatives:{available:true,asOf:10,funding:{lastFundingRate:-.0007},taker:{buySellRatio:1.4},topTraderPosition:{longShortRatio:.8},globalAccount:{longShortRatio:1.1}},microstructure:{bid:99,ask:100}});
 assert.equal(p.derivatives.fundingRate,-.0007);assert.equal(p.derivatives.takerBuySellRatio,1.4);assert.equal(p.derivatives.topTraderLongShortRatio,.8);assert.equal(p.derivatives.globalLongShortRatio,1.1);assert.equal(p.microstructure.bid,99);
 const missing=marketPacket({derivatives:{fundingRate:null},livePrice:null});assert.equal(missing.derivatives.fundingRate,null);assert.equal(missing.derivatives.available,false);assert.equal(missing.livePrice,null);
 assert.equal(marketPacket({derivatives:{available:true,funding:{lastFundingRate:0}}}).derivatives.fundingRate,0);
});
const records=[{id:'entry',kind:'LIVE_EXECUTION',symbol:'X',ts:10000,payload:{eventId:'e1',result:{orderPlaced:true,side:'LONG',executedQty:2},plan:{stopPrice:90}}},{id:'exit',kind:'JEV_POSITION_EXECUTION',symbol:'X',ts:20000,payload:{action:'EXIT_NOW',result:{orderPlaced:true,executedQty:2,side:'LONG',fullyClosed:true,reduceOnly:true}}}];
const close={symbol:'X',side:'LONG',eventId:'e1',openedAt:new Date(10010).toISOString(),closedAt:new Date(21000).toISOString(),entryPrice:100,quantity:0,riskQuote:0,netPnl:-4,exitType:'OTHER_CLOSE'};
test('canonical JEV close recovers original quantity/R without rewriting raw or PnL',()=>{const before=JSON.stringify([close,records]);const [x]=enrichCloses([close],records);assert.equal(x.exitType,'JEV_EXIT_NOW');assert.equal(x.quantity,2);assert.equal(x.riskQuote,20);assert.equal(x.rMultiple,-.2);assert.equal(x.netPnl,-4);assert.equal(JSON.stringify([close,records]),before);});
test('partial and rejected exits do not misclassify final close; next entry bounds lineage',()=>{
 let rs=structuredClone(records);rs[1].payload.action='PARTIAL_TAKE_PROFIT';rs[1].payload.result.fullyClosed=false;
 let [x]=enrichCloses([close],rs);assert.equal(x.exitType,'OTHER_CLOSE');assert.equal(x.partialExitType,'JEV_PARTIAL_TAKE_PROFIT');
 rs[1].payload.result.orderPlaced=false;assert.equal(enrichCloses([close],rs)[0].partialExitType,undefined);
 rs=structuredClone(records);rs.push({...rs[0],id:'later',ts:15000,payload:{...rs[0].payload,eventId:'e2'}});assert.equal(enrichCloses([close],rs)[0].exitType,'OTHER_CLOSE');
 assert.equal(enrichCloses([{...close,eventId:'unknown'}],records)[0].quantity,0);
});
test('exit request retains original thesis and owner context despite placeholder current plan',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jev-loss-'));fs.mkdirSync(path.join(root,'config'));fs.mkdirSync(path.join(root,'docs'));fs.copyFileSync(path.join(__dirname,'../docs/JEV-PRO-TRADER-CORTEX-R2534.md'),path.join(root,'docs/JEV-PRO-TRADER-CORTEX-R2534.md'));fs.writeFileSync(path.join(root,'config/jev.json'),JSON.stringify({enabled:true,dailyCapUsd:100,softBudgetUsd:0}));
 let body;const client=createJevClient({root,apiKey:'sk-or-v1-'+ 'x'.repeat(40),fetchImpl:async(url,opt)=>{body=JSON.parse(opt.body);return {ok:true,status:200,text:async()=>JSON.stringify({answers:{position_action:{value:'HOLD'},partial_fraction:{value:'P33'}}})};}});
 await client.sovereignExit({position:{symbol:'X',side:'LONG',entryPrice:100,markPrice:99,quantity:2},lifecycle:{originTF:'15m',ownerTF:'15m',entryPlanSource:'LIVE_EXECUTION_JOURNAL',entryPlan:{invalidationPrice:91,stopPrice:90,takeProfit1:110},entryContext:{why:'original thesis',setupFamily:'BREAKOUT_RETEST',entryTiming:'MARKET_NOW',edgeBasis:'STRUCTURE_LOCATION',lane:'15M_TRADE'}},currentPlan:{setup:'JEV_SOVEREIGN_POSITION_REVIEW',stopPrice:999},unified:{symbol:'X',dataQuality:{advisoryUsable:true},frames:{'5m':{available:true},'15m':{available:true},'1h':{available:true,close:101}}}});
 assert.equal(body.state.record.lifecycle.initialStop,90);assert.equal(body.state.record.lifecycle.initialInvalidation,91);assert.equal(body.state.record.entryThesis.why,'original thesis');assert.equal(body.state.record.entryThesis.setupFamily,'BREAKOUT_RETEST');assert.equal(body.state.coreMarketPacket.higherContext['1h'].close,101);assert.ok(body.state.record.noisePolicy);
 fs.rmSync(root,{recursive:true,force:true});
});

test('partial reductions cannot shrink original R denominator',()=>{const [x]=enrichCloses([{...close,quantity:.1,riskQuote:1,netPnl:10,rMultiple:10}],records);assert.equal(x.quantity,2);assert.equal(x.riskQuote,20);assert.equal(x.rMultiple,.5);});

test('unavailable flow cannot masquerade as measured zero CVD',()=>{const p=marketPacket({microstructure:{streaming:{cvdQuote120s:0,cvdTrades120s:0},cvdSampleQuote:12,cvdSampleTrades:100},marketMakerEvidence:{orderFlow:{available:false}}});assert.equal(p.microstructure.cvdQuote120s,null);assert.equal(p.microstructure.cvdTrades120s,null);assert.equal(p.microstructure.restTradeSample.quote,12);});
