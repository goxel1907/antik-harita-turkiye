'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('R2542 JEV trader office keeps 5m and 15m decision disciplines explicit',()=>{
  const jev=fs.readFileSync(path.join(__dirname,'..','jev-decision.js'),'utf8');
  assert.match(jev,/5M_SCALP is a professional scalper desk/);
  assert.match(jev,/15M_TRADE is a professional trader desk/);
  assert.match(jev,/WAIT is an active strategic decision that requires a concrete market reason/);
  assert.match(jev,/do not demand textbook confirmation before MARKET_NOW/);
  assert.match(jev,/wait_reason/);
  assert.match(jev,/NONE_MARKET_NOW/);
  assert.match(jev,/LOCATION_POOR/);
  assert.match(jev,/STRUCTURE_UNCONFIRMED/);
  assert.match(jev,/EDGE_INSUFFICIENT/);
});

test('R2542 persists and measures actual entry timing waits',()=>{
  const pipeline=fs.readFileSync(path.join(__dirname,'..','pipeline.js'),'utf8');
  const live=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(pipeline,/waitReason:final\.waitReason/);
  assert.match(pipeline,/waitReason:plan\.waitReason/);
  assert.match(live,/jevEntryTiming/);
  assert.match(live,/jevWaitReason/);
  assert.match(live,/sovereignMarketNow/);
  assert.match(live,/sovereignTimingWaitRatePct/);
  assert.match(live,/sovereignEntryTimingCounts/);
  assert.match(live,/sovereignWaitReasonCounts/);
});
