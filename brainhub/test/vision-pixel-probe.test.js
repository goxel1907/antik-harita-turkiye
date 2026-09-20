'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FRAME_ORDER, formatSingleVisionPixelReply, visionPixelProbePrompt, evaluateVisionPixelProbe } = require('../pipeline');

const CELLS={
  '1m':7,'3m':2,'5m':9,'15m':4,'30m':1,
  '45m':8,'1h':5,'4h':3,'1d':6
};
function frames() {
  const out={};
  FRAME_ORDER.forEach(tf=>{ out[tf]={ visionProbeCell:CELLS[tf] }; });
  return out;
}
function response(overrides={}) {
  const key={ '1m':'1M','3m':'3M','5m':'5M','15m':'15M','30m':'30M','45m':'45M','1h':'1H','4h':'4H','1d':'1D' };
  return FRAME_ORDER.map(tf=>'PROBE_'+key[tf]+': '+(overrides[tf]||CELLS[tf])).join('\n');
}

test('Vision pixel probe asks for all 9 TF grid cells without leaking the hidden mapping', () => {
  const p=visionPixelProbePrompt();
  for (const tag of ['1M','3M','5M','15M','30M','45M','1H','4H','1D']) assert.match(p,new RegExp('PROBE_'+tag));
  assert.match(p,/3x3/);
  assert.match(p,/1\.\.9/);
  assert.doesNotMatch(p,/PROBE_1M:\s*7/);
  assert.doesNotMatch(p,/PROBE_1D:\s*6/);
});

test('Vision pixel verification requires exact hidden cell matches for all 9 images', () => {
  const expected=frames();

  const perfect=evaluateVisionPixelProbe(response(),expected);
  assert.equal(perfect.ok,true);
  assert.equal(perfect.reported,9);
  assert.equal(perfect.matched,9);
  assert.equal(perfect.threshold,9);

  const oneWrong=evaluateVisionPixelProbe(response({'1m':1}),expected);
  assert.equal(oneWrong.ok,false);
  assert.equal(oneWrong.matched,8);

  const missing=evaluateVisionPixelProbe(response().split('\n').slice(0,8).join('\n'),expected);
  assert.equal(missing.ok,false);
  assert.equal(missing.reported,8);
});


test('single-image pixel formatting labels only an exact observed digit and never guesses malformed replies',()=>{
  assert.equal(formatSingleVisionPixelReply('1m',' 3\n'),'PROBE_1M: 3');
  assert.equal(formatSingleVisionPixelReply('4h','7'),'PROBE_4H: 7');
  for(const bad of ['PROBE_7M: N','PROBE_4H: 3','3 or 7','0','10','',null,'The cell is 3'])
    assert.throws(()=>formatSingleVisionPixelReply('4h',bad),/PIXEL_CELL_CONTRACT/);
  assert.throws(()=>formatSingleVisionPixelReply('7m','3'),/PIXEL_TIMEFRAME_INVALID/);
});
