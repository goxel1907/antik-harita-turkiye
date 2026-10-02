'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..','..');

test('R2544.29 Android BURST monitor is Codemagic-wired and read-only',()=>{
  const cm=fs.readFileSync(path.join(ROOT,'codemagic.yaml'),'utf8');
  const patch=fs.readFileSync(path.join(ROOT,'futures15m_alarm','v95124_r2544_29_burst_monitor.py'),'utf8');
  assert.match(cm,/v95124_r2544_29_burst_monitor\.py/);
  assert.match(cm,/Futures15mAlarm-PRO-v9\.5\.117-R2544\.29-BURST\.apk/);
  assert.ok(patch.includes('get(c, "/live/burst")'));
  assert.match(patch,/BURST SCALP/);
  assert.match(patch,/ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY/);
  assert.ok(patch.includes('post(c, "/live/burst"'));
  assert.ok(patch.includes('not in client'));
});

test('R2544.29 Android installable identity is separate from PC release',()=>{
  const patch=fs.readFileSync(path.join(ROOT,'futures15m_alarm','v95124_r2544_29_burst_monitor.py'),'utf8');
  assert.match(patch,/9\.5\.117-r2544\.29-burst/);
  assert.match(patch,/26100229/);
});
