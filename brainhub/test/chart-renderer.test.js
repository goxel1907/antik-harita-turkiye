'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderChartPng } = require('../market');

function chartFixture() {
  const start = Date.UTC(2026,8,17,8,0,0);
  const candles = Array.from({length:80},(_,i)=>{
    const base=100+i*0.12;
    const open=base+(i%2?0.08:-0.05);
    const close=base+(i%3?0.18:-0.12);
    return {
      openTime:start+i*60000,
      closeTime:start+(i+1)*60000-1,
      open,
      high:Math.max(open,close)+0.35,
      low:Math.min(open,close)-0.30,
      close,
      volume:100+i*3,
      quoteVolume:(100+i*3)*close,
      takerBuyQuote:(100+i*3)*close*0.55
    };
  });
  return {
    symbol:'TESTUSDT',
    frame:'1m',
    candles,
    analysis:{
      prior20High:110,
      prior20Low:105,
      liquidity:{equalHigh:{price:109.8},equalLow:{price:105.2}},
      recentFairValueGaps:[{side:'BULL',low:107.1,high:107.5}]
    }
  };
}

test('clean and annotated chart renderer returns valid PNG bytes', () => {
  const c=chartFixture();
  const clean=renderChartPng(c,'clean');
  const annotated=renderChartPng(c,'annotated');
  const sig='89504e470d0a1a0a';
  assert.equal(clean.subarray(0,8).toString('hex'),sig);
  assert.equal(annotated.subarray(0,8).toString('hex'),sig);
  assert.ok(clean.length>1000);
  assert.ok(annotated.length>1000);
  assert.notEqual(clean.toString('base64'),annotated.toString('base64'));
});

test('diagnostic Vision marker changes only the requested probe render', () => {
  const c=chartFixture();
  const normal=renderChartPng(c,'annotated');
  const probeA=renderChartPng(c,'annotated',{visionProbeCell:1});
  const probeB=renderChartPng(c,'annotated',{visionProbeCell:9});
  assert.notEqual(normal.toString('base64'),probeA.toString('base64'));
  assert.notEqual(probeA.toString('base64'),probeB.toString('base64'));
  assert.equal(renderChartPng(c,'annotated',{visionProbeCell:10}).toString('base64'),normal.toString('base64'));
});

test('Vision transport render can downscale PNG without changing default renderer contract', () => {
  const c=chartFixture();
  const full=renderChartPng(c,'annotated');
  const compact=renderChartPng(c,'annotated',{visionProbeCell:5,outputWidth:640,outputHeight:360});
  assert.equal(full.readUInt32BE(16),1280);
  assert.equal(full.readUInt32BE(20),720);
  assert.equal(compact.readUInt32BE(16),640);
  assert.equal(compact.readUInt32BE(20),360);
  assert.ok(compact.length>1000);
  assert.notEqual(compact.toString('base64'),full.toString('base64'));
});

test('invalid chart mode is rejected', () => {
  assert.throws(()=>renderChartPng(chartFixture(),'future-vision'),/invalid chart mode/);
});
