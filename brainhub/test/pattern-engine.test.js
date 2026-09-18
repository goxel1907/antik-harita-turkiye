'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { structure, detectPatterns, smcContext } = require('../engine');

function candle(i, open, high, low, close) {
  return { openTime:i*60000, open, high, low, close, volume:10, closeTime:(i+1)*60000-1, quoteVolume:1000, takerBuyQuote:520 };
}

test('pattern engine distinguishes wick sweep/reclaim from close acceptance', () => {
  const c = [
    candle(0,100,101,99,100.5),
    candle(1,100.5,101.2,100,100.8),
    candle(2,100.8,101.1,100.2,100.7),
    candle(3,100.7,102.2,100.5,101.4)
  ];
  const p = detectPatterns(c, 1, 102, 99, null, 0.1);
  assert.ok(p.some(x => x.type === 'BUY_SIDE_SWEEP_REJECT' && x.side === 'SHORT'));
});

test('SMC context derives premium/discount, OTE and FVG CE50 only from confirmed swing range', () => {
  const smc=smcContext({
    state:'BULLISH',
    event:'CHOCH_UP',
    lastConfirmedSwingHigh:{ price:120, at:10 },
    lastConfirmedSwingLow:{ price:100, at:5 }
  }, 106, [
    { side:'BULL', low:104, high:108, at:11 }
  ]);
  assert.equal(smc.available,true);
  assert.equal(smc.dealingRange.low,100);
  assert.equal(smc.dealingRange.high,120);
  assert.equal(smc.dealingRange.equilibrium,110);
  assert.equal(smc.dealingRange.zone,'DISCOUNT');
  assert.equal(smc.dealingRange.positionPct,30);
  assert.ok(smc.oteReference.longDiscountZone.low >= 100);
  assert.ok(smc.oteReference.longDiscountZone.high <= 120);
  assert.ok(smc.oteReference.shortPremiumZone.low >= 100);
  assert.ok(smc.oteReference.shortPremiumZone.high <= 120);
  assert.equal(smc.fairValueGaps[0].ce50,106);
  assert.equal(smc.semantics,'SOFT_STRUCTURAL_CONTEXT_ONLY');

  const missing=smcContext({
    state:'MIXED',
    lastConfirmedSwingHigh:null,
    lastConfirmedSwingLow:{ price:100, at:5 }
  }, 105, []);
  assert.equal(missing.available,false);
  assert.equal(missing.reason,'CONFIRMED_DEALING_RANGE_UNAVAILABLE');
});

test('structure exposes swing structure and multi-pattern context on closed candles', () => {
  const c=[];
  let p=100;
  for(let i=0;i<70;i++){
    const wave=Math.sin(i/3)*1.8;
    const center=100+i*0.05+wave;
    const open=p;
    const close=center;
    const high=Math.max(open,close)+0.6;
    const low=Math.min(open,close)-0.6;
    c.push(candle(i,open,high,low,close));
    p=close;
  }
  const s=structure(c,'15m');
  assert.equal(s.available,true);
  assert.ok(s.swingStructure);
  assert.ok(['BULLISH','BEARISH','MIXED'].includes(s.swingStructure.state));
  assert.ok(s.smcContext);
  if(s.smcContext.available){
    assert.ok(['DISCOUNT','EQUILIBRIUM','PREMIUM'].includes(s.smcContext.dealingRange.zone));
  }
  assert.ok(Array.isArray(s.patterns));
  assert.equal(s.opportunity.available,true);
});
