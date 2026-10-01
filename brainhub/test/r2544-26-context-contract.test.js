'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('R2544.26 keeps stricter-than-52KB JEV context contract',()=>{
  const s=fs.readFileSync(path.join(__dirname,'../jev-decision.js'),'utf8');
  assert.match(s,/const MAX_DECISION_REQUEST_BYTES=48000;/);
  assert.match(s,/const PASS1_TARGET_BYTES=42000;/);
  assert.match(s,/const PASS2_TARGET_BYTES=46000;/);
  assert.doesNotMatch(s,/MAX_DECISION_REQUEST_BYTES=5[0-9]{4}/);
});
