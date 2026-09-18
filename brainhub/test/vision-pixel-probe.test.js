'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FRAME_ORDER, visionPixelProbePrompt, evaluateVisionPixelProbe } = require('../pipeline');

function frames() {
  const out={};
  FRAME_ORDER.forEach((tf,i)=>{ out[tf]={ visualLastCandle:i%2===0?'BULL':'BEAR' }; });
  return out;
}
function response(overrides={}) {
  const key={ '1m':'1M','3m':'3M','5m':'5M','15m':'15M','30m':'30M','45m':'45M','1h':'1H','4h':'4H','1d':'1D' };
  const f=frames();
  return FRAME_ORDER.map(tf=>'PROBE_'+key[tf]+': '+(overrides[tf]||f[tf].visualLastCandle)).join('\n');
}

test('Vision pixel probe asks for all 9 TFs without leaking expected candle directions', () => {
  const p=visionPixelProbePrompt();
  for (const tag of ['1M','3M','5M','15M','30M','45M','1H','4H','1D']) assert.match(p,new RegExp('PROBE_'+tag));
  assert.match(p,/forming/i);
  assert.doesNotMatch(p,/1M:\s*BULL\s*$/m);
});

test('Vision pixel verification requires all 9 reported TFs and at least 8 visual matches', () => {
  const expected=frames();
  const perfect=evaluateVisionPixelProbe(response(),expected,8);
  assert.equal(perfect.ok,true);
  assert.equal(perfect.reported,9);
  assert.equal(perfect.matched,9);

  const oneWrong=evaluateVisionPixelProbe(response({'1m':'BEAR'}),expected,8);
  assert.equal(oneWrong.ok,true);
  assert.equal(oneWrong.matched,8);

  const twoWrong=evaluateVisionPixelProbe(response({'1m':'BEAR','5m':'BEAR'}),expected,8);
  assert.equal(twoWrong.ok,false);
  assert.equal(twoWrong.matched,7);

  const missing=evaluateVisionPixelProbe(response().split('\n').slice(0,8).join('\n'),expected,8);
  assert.equal(missing.ok,false);
  assert.equal(missing.reported,8);
});
