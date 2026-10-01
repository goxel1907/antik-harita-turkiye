'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const scanner=require('../scanner');

test('R2544.27d keeps 36-candidate evidence depth while smoothing scanner cadence and fanout',()=>{
  assert.equal(scanner.TARGET_DETAIL_LIMIT,36);
  assert.equal(scanner.SCAN_CACHE_MS,30000);
  assert.equal(scanner.DETAIL_ENRICH_CONCURRENCY,2);
  const src=fs.readFileSync(path.join(__dirname,'..','scanner.js'),'utf8');
  assert.match(src,/mapLimit\(candidates,DETAIL_ENRICH_CONCURRENCY/);
  assert.match(src,/cache&&Date\.now\(\)-cache\.at<SCAN_CACHE_MS/);
});

test('R2544.27d default REST pacing is 50ms without lowering the 36-symbol evidence set',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','binance-rate-limit.js'),'utf8');
  assert.match(src,/DEFAULT_MIN_GAP_MS = 50/);
  assert.equal(scanner.TARGET_DETAIL_LIMIT,36);
});
