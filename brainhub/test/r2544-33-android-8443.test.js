const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..','..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('R2544.33 Android transport hotfix builds BrainHub on 8443 and preserves PC-only execution',()=>{
  const cm=read('codemagic.yaml');
  const patch=read('futures15m_alarm/v95130_r2544_33_brainhub_8443.py');
  assert.match(cm,/v95130_r2544_33_brainhub_8443\.py/);
  assert.match(cm,/https:\/\/8z9rvd\.tail8c30c4\.ts\.net:8443/);
  assert.match(cm,/versionName '9\.5\.122-r2544\.33-brainhub-8443'/);
  assert.match(cm,/versionCode 26100401/);
  assert.match(cm,/Futures15mAlarm-PRO-v9\.5\.122-R2544\.33-BRAINHUB-8443\.apk/);
  assert.match(patch,/FIXED_ENDPOINT/);
  assert.match(patch,/ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY/);
  assert.match(patch,/no_live_execute/);
  assert.match(patch,/no_burst_post/);
});
