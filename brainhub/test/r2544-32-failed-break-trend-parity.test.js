'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {structure,breakoutEvidence,swingStructure,analyzeFrames,FRAMES}=require('../engine');
const {buildUnifiedContext}=require('../pipeline');
const {marketPacket,chartOverlayLevels,mirrorDigest}=require('../jev-market-packet');
const {prepareDecisionRequest,protectedCoreTruth}=require('../jev-decision');
const {renderChartPng}=require('../market');
const now=Date.parse('2026-10-04T01:00:00Z');
const durations={'1m':60000,'3m':180000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000};
function candles(tf='5m'){
 const d=durations[tf]||60000;
 return Array.from({length:70},(_,i)=>({openTime:now-(70-i)*d,closeTime:now-(69-i)*d-1,open:100,high:110,low:90,close:100,volume:10,quoteVolume:1000,takerBuyQuote:500}));
}
function reflect(c){return c.map(x=>({...x,open:200-x.open,high:200-x.low,low:200-x.high,close:200-x.close}));}
function fail(c){c.at(-3).high=114;c.at(-3).close=112;c.at(-2).open=112;c.at(-2).close=113;c.at(-2).high=115;c.at(-1).open=113;c.at(-1).high=114;c.at(-1).close=108;return c;}
for(const tf of ['1m','3m','5m','15m','30m','1h','4h'])test('R32 '+tf+' wick rejection and failed closing breakout are symmetric measured evidence',()=>{
 const c=candles(tf);c.at(-1).high=113;c.at(-1).close=105;
 const wick=structure(c,tf).breakoutEvidence.events.find(e=>e.type==='WICK_SWEEP_REJECTION'&&e.direction==='UP');
 assert.equal(wick.level,110);assert.equal(wick.barsToReturn,0);assert.equal(wick.at,c.at(-1).closeTime);
 const up=breakoutEvidence(fail(candles(tf)),tf).events.find(e=>e.type==='CLOSE_BREAK_FAILED'&&e.direction==='UP');
 const down=breakoutEvidence(reflect(fail(candles(tf))),tf).events.find(e=>e.type==='CLOSE_BREAK_FAILED'&&e.direction==='DOWN');
 assert.equal(up.level,110);assert.equal(down.level,90);assert.equal(up.barsToReturn,2);assert.equal(down.barsToReturn,2);assert.equal(up.stillInside,true);
});
test('R32 accepted breakout, insignificant wick and stale event are not current fake-break proof',()=>{
 const c=candles();c.at(-1).close=112;c.at(-1).high=114;
 assert.deepEqual(breakoutEvidence(c,'5m').events,[]);
 c.at(-1).close=105;c.at(-1).high=110.000001;
 assert.deepEqual(breakoutEvidence(c,'5m').events,[]);
 const old=candles();old[40].high=114;old[40].close=112;old[41].close=108;
 assert.deepEqual(breakoutEvidence(old,'5m').events,[]);
});
test('R32 unfinished candle cannot produce confirmed failure or future pivot reference',()=>{
 const c=candles('5m'),raw=c.map(x=>[x.openTime,x.open,x.high,x.low,x.close,10,x.closeTime,1000,0,0,500]);
 raw.push([now,100,120,80,100,10,now+300000-1,1000,0,0,500]);
 assert.deepEqual(analyzeFrames({'5m':raw},now)['5m'].breakoutEvidence.events,[]);
 const broken=fail(candles());const short=breakoutEvidence(broken.slice(0,-2),'5m');
 assert.equal(short.events.some(x=>x.type==='CLOSE_BREAK_FAILED'),false,'return not known at initial break');
});
function trendFixture(){
 const c=candles();c.forEach(x=>{x.open=106;x.close=106;x.high=108;x.low=100;});
 const pv={highs:[],lows:[{index:40,price:90,at:c[40].closeTime},{index:50,price:95,at:c[50].closeTime}]};
 return {c,pv};
}
test('R32 trendline uses exact pivot prices/time and validates every intervening close',()=>{
 const {c,pv}=trendFixture();const tl=swingStructure(pv,.1,c.at(-1).close,69,c.at(-1).closeTime,c).trendLines.upSupport;
 assert.equal(tl.active,true);assert.equal(tl.projected.price,104.5);assert.equal(tl.confirmedAt,c[52].closeTime);
 c[55].close=95;
 const broken=swingStructure(pv,.1,c.at(-1).close,69,c.at(-1).closeTime,c).trendLines.upSupport;
 assert.equal(broken.active,false);assert.equal(broken.invalidatedAt,c[55].closeTime);assert.equal(broken.invalidatedByClose,95);
 const dn=swingStructure({lows:[],highs:pv.lows.map(x=>({...x,price:200-x.price}))},.1,94,69,c.at(-1).closeTime,reflect(c)).trendLines.downResistance;
 assert.equal(dn.active,false);assert.equal(dn.invalidatedAt,c[55].closeTime);
});
test('R32 support cutting through a closed body between anchors is inactive',()=>{
 const {c,pv}=trendFixture();c[45].close=91;
 assert.equal(swingStructure(pv,.1,106,69,c.at(-1).closeTime,c).trendLines.upSupport.active,false);
});
test('R32 Office renderer draws only active correctly positioned confirmed trend lines',()=>{
 const {c,pv}=trendFixture();const analysis={swingStructure:swingStructure(pv,.1,106,69,c.at(-1).closeTime,c)};
 const active=renderChartPng({candles:c,analysis},'annotated');
 const removed=renderChartPng({candles:c,analysis:{}},'annotated');
 assert.notDeepEqual(active,removed);
 // Decode the actual PNG and sample the renderer's expected candle/price coordinate.
 const idat=[];for(let offset=8;offset<active.length;){const n=active.readUInt32BE(offset);if(active.toString('ascii',offset+4,offset+8)==='IDAT')idat.push(active.subarray(offset+8,offset+8+n));offset+=n+12;}
 const raw=require('node:zlib').inflateSync(Buffer.concat(idat)),stride=1280*4+1;
 const i=63,x=Math.round(24+(950-24)/c.length*(i+.5)),price=90+.5*(i-40),y=Math.round(22+(108+.48-price)/(8+.96)*(555-22));
 let found=false;for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++){const k=(y+dy)*stride+1+(x+dx)*4;if(raw[k]===0&&raw[k+1]===230&&raw[k+2]===118)found=true;}
 assert.equal(found,true,'green support must occupy the correct time/price coordinate');
 analysis.swingStructure.trendLines.upSupport.active=false;
 assert.deepEqual(renderChartPng({candles:c,analysis},'annotated'),removed,'broken trend not drawn');
});
test('R32 all nine TF trend/rejection evidence survives actual serialized post-trim payload and mirror',()=>{
 const frames={};for(const tf of FRAMES){const c=fail(candles(tf));const f=structure(c,tf);f.swingStructure.trendLines={upSupport:{active:false,from:{price:1.23456789,at:c[40].closeTime},to:{price:1.34567891,at:c[50].closeTime},projected:{price:1.55678912,at:c.at(-1).closeTime},invalidatedAt:c[55].closeTime},downResistance:null};frames[tf]=f;}
 const u=buildUnifiedContext({symbol:{symbol:'TESTUSDT',timeframes:frames},now}),p=marketPacket(u),overlays=chartOverlayLevels(frames);
 assert.deepEqual(p.chartOverlayLevels,overlays);assert.equal(p.chartOverlayLevels['1h'].trendLines.upSupport.from.price,1.23456789);
 for(const questions of [{lane_focus:{type:'choice',criteria:{BOTH:'Both'}}},{trade_plan:{type:'choice',criteria:{WAIT:'Wait'}}}]){
  const input={state:{coreMarketPacket:p,professionalTraderCortex:{reference:'optional '.repeat(9000)}},questions};
  const result=prepareDecisionRequest(input);assert.equal(result.ok,true,JSON.stringify(result.diagnostics));
  const sent=JSON.parse(result.serialized||JSON.stringify(result.body));assert.deepEqual(sent.state.coreMarketPacket.chartOverlayLevels,overlays);
  assert.deepEqual(protectedCoreTruth(result.body),protectedCoreTruth(input));assert.ok(result.diagnostics.bytes<=48000);
  assert.deepEqual(mirrorDigest(sent.state.coreMarketPacket).chartOverlayLevels,overlays);
 }
});
