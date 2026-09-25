'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {marketPacket}=require('../jev-market-packet');

function frame(tf){
  return {
    available:true,fresh:true,asOf:1,close:100,ema20:99.8,ema50:99.2,rsi14:57,atr14:1,atrPct:1,returnPct:0.4,
    trend:'UP',breakOfStructure:'UP',prior20High:102,prior20Low:98,candle:{closed:true},
    patterns:[{type:'BULL_FLAG_OR_PENNANT',side:'LONG',status:'FORMING'}],
    swingStructure:{lastConfirmedSwingLow:{price:98,at:1},lastConfirmedSwingHigh:{price:102,at:2}},
    liquidity:{equalHigh:{price:102},equalLow:{price:98},lastSweep:'SELL_SIDE_RECLAIM'},
    recentFairValueGaps:[{side:'BULL',low:99.1,high:99.4,ce50:99.25}],
    orderBlocks:{bullish:[{side:'BULL',low:98.8,high:99.2,broken:false}],bearish:[]},
    smcContext:{
      available:true,dealingRange:{low:98,high:102,equilibrium:100,zone:'EQUILIBRIUM'},
      oteReference:{longDiscountZone:{low:98.84,high:99.52},shortPremiumZone:{low:100.48,high:101.16}},
      fibLevels:{leg:'UP_LEG_LOW_TO_HIGH',retracement:{'0.618':99.528},extension:{'1.272':103.088}},
      fairValueGaps:[{side:'BULL',low:99.1,high:99.4,ce50:99.25}]
    }
  };
}

test('R2537 complete JEV packet keeps Fib, OTE, OB, FVG and observed liquidation zones',()=>{
  const frames=Object.fromEntries(['1m','3m','5m','15m','30m','1h','4h','1d'].map(tf=>[tf,frame(tf)]));
  const out=marketPacket({
    symbol:'BTCUSDT',livePrice:100,frames,
    dataQuality:{advisoryUsable:true,microstructureQuality:'STREAMING_PARTIAL_BOOK'},
    microstructure:{available:true,spreadBps:1,depth20Imbalance:0.2,streaming:{available:true,cvdQuote120s:1200,cvdTrades120s:20}},
    marketMakerEvidence:{participantIdentity:'NOT_IDENTIFIED',participantIntent:'NOT_ASSERTED',orderFlow:{available:true,source:'TEST'}},
    derivatives:{available:true,fundingRate:0.0001,openInterest:{delta5mPct:1.2}},
    liquidationContext:{available:true,source:'BINANCE_FORCE_ORDER',count:2,longLiquidatedQuote:1000,shortLiquidatedQuote:200,zones:[{side:'LONG_LIQUIDATED',price:99.5,observedQuote:1000}]}
  });
  assert.equal(out.contract,'R2537_JEV_CONTEXT_COMPLETE_READ_ONLY');
  assert.equal(out.coreFrames['5m'].smcContext.fibLevels.retracement['0.618'],99.528);
  assert.equal(out.coreFrames['15m'].smcContext.oteReference.longDiscountZone.high,99.52);
  assert.equal(out.coreFrames['5m'].orderBlocks.bullish.length,1);
  assert.equal(out.coreFrames['5m'].recentFairValueGaps.length,1);
  assert.equal(out.observedLiquidations.zones.length,1);
  assert.equal(out.microstructure.participantIdentity,'NOT_IDENTIFIED');
  assert.equal(out.microstructure.participantIntent,'NOT_ASSERTED');
});

test('R2537 pipeline does not authorize an immediate entry unless JEV timing is MARKET_NOW',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','pipeline.js'),'utf8');
  assert.match(src,/const entryNow=Boolean\(chosen\)&&entryTiming==='MARKET_NOW'/);
  assert.match(src,/status:entryNow\?'QUALIFIED':'WATCH'/);
  assert.match(src,/entryMode:entryNow\?'MARKET_NOW':'WAIT_TRIGGER'/);
  assert.match(src,/JEV_R2537_/);
  assert.match(src,/setupFamily/);
  assert.match(src,/edgeBasis/);
});

test('R2537 annotated Vision charts include deterministic OB, OTE and Fib overlays',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','market.js'),'utf8');
  assert.match(src,/orderBlocks\?\.bullish/);
  assert.match(src,/orderBlocks\?\.bearish/);
  assert.match(src,/ote\.longDiscountZone/);
  assert.match(src,/ote\.shortPremiumZone/);
  assert.match(src,/fib\[key\]/);
});


test('R2538 explicit FVG field mirrors the real unified-frame liquidity.fairValueGaps source',()=>{
  const frames=Object.fromEntries(['1m','3m','5m','15m','30m','1h','4h','1d'].map(tf=>{
    const x=frame(tf);
    const fvgs=x.recentFairValueGaps;
    delete x.recentFairValueGaps;
    x.liquidity={...(x.liquidity||{}),fairValueGaps:fvgs};
    return [tf,x];
  }));
  const out=marketPacket({symbol:'ETHUSDT',livePrice:100,frames});
  assert.equal(out.coreFrames['5m'].recentFairValueGaps.length,1);
  assert.equal(out.coreFrames['15m'].recentFairValueGaps.length,1);
  assert.equal(out.coreFrames['5m'].recentFairValueGaps[0].ce50,99.25);
});


test('R2540 annotated Vision charts include range, trend guide, swing structure and observed liquidation levels',()=>{
  const market=fs.readFileSync(path.join(__dirname,'..','market.js'),'utf8');
  const pipeline=fs.readFileSync(path.join(__dirname,'..','pipeline.js'),'utf8');
  assert.match(market,/R2540 FULL MIRROR/);
  assert.match(market,/trendRows/);
  assert.match(market,/dealingRange/);
  assert.match(market,/lastConfirmedSwingHigh/);
  assert.match(market,/lastConfirmedSwingLow/);
  assert.match(market,/options\?\.observedLiquidations/);
  assert.match(pipeline,/observedLiquidations:Array\.isArray\(unified\?\.liquidationContext\?\.zones\)/);
});
