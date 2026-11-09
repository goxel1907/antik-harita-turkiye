'use strict';
// R2544.133 TEST = CANLI: "Durdur" never closes positions (6.11 16:37 the TEST stop closed ONE at +11,9R; its plan made +28R)
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
test('R2544.133 STOP keeps open lots in both modes; Office says so; a flat TEST is the reset',()=>{
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8'),h=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  const stop=lc.slice(lc.indexOf("if(act==='STOP'){"),lc.indexOf("if(busy)return {ok:false,reasons:['SWITCH_IN_PROGRESS']"));
  assert.ok(stop.length>100);assert.doesNotMatch(stop,/closeAll\(/,'STOP closes nothing');assert.match(stop,/top3OpenSnapshot\('USER_STOP'\)/);
  assert.match(h,/TEST = CANLI: yeni sanal işlem açılmaz; açık sanal pozisyonlar sanal borsadaki stop\/TP ile korunur, kapatılmaz/);
  assert.doesNotMatch(h,/Sistemi kapat \(TEST: sanal pozisyonlar kapatılır\)/);
});
