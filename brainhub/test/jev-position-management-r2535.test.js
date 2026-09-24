'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('R2535 binds JEV EXIT_NOW and PARTIAL_TAKE_PROFIT to BrainHub-owned reduce-only execution while preserving fail-closed guards',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(src,/JEV_POSITION_REDUCE_BINDING_WHEN_LIVE_ARMED/);
  assert.match(src,/const brainOwned=String\(existing\?\.state\|\|''\)\.toUpperCase\(\)==='ACTIVE'/);
  assert.match(src,/JEV_POSITION_EXTERNAL_ADVISORY_ONLY/);
  assert.match(src,/LIVE_NOT_ARMED_FOR_POSITION_MANAGEMENT/);
  assert.match(src,/LIVE_DISARMED_DURING_POSITION_REVIEW/);
  assert.match(src,/const reviewArmGeneration=armGeneration/);
  assert.match(src,/const reviewLiveArmedAtStart=armedNow\(\)/);
  assert.match(src,/reviewArmGeneration!==armGeneration/);
  assert.match(src,/transport\.reducePositionMarket\(/);
  assert.match(src,/bindingActions:\['EXIT_NOW','PARTIAL_TAKE_PROFIT'\]/);
  assert.match(src,/const fraction=action==='EXIT_NOW'\?1:/);
  assert.match(src,/JEV_POSITION_EXECUTION/);
  assert.match(src,/managementExecution\.orderPlaced===true/);
});

test('R2535 transport exposes a reduction helper but entry submit still requires OPEN authorization',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','binance-live-transport.js'),'utf8');
  assert.match(src,/async reducePositionMarket\(/);
  assert.match(src,/reduceOnly='true'/);
  assert.match(src,/POSITION_NOT_OPEN_OR_SIDE_MISMATCH/);
  assert.match(src,/JEV_EXIT_NOW_REDUCE_ONLY_MARKET/);
  assert.match(src,/if\(normalized\.action !== 'OPEN'\) reasons\.push\('LIVE_OPEN_ACTION_REQUIRED'\)/);
});
