'use strict';
// R2544.127 (kullanıcı 04.11: "ister kurul ile ister JEV+kurul+bot ile tek tık canlı"; "JEV'de kredi yoksa kurul her şeyi yönetecek, varsa JEV+kurul")
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const h=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
test('R2544.127 Office: one press to JEV + Kurul + bot, then the normal LIVE confirmation; the committee button turns JEV off; honest warning texts',()=>{
  assert.match(h,/id="btnJkLive"[^>]*>JEV \+ Kurul ile CANLI’ya geç<\/button>/);
  assert.match(h,/top3Control\(\{committeeMode:true,jevMode:true,liveEnabled:true,confirm:'LIVE'\}/);assert.match(h,/z5Control\(\{committeeMode:true,jevMode:true,liveEnabled:true,confirm:'LIVE'\}/);
  assert.match(h,/top3Control\(\{committeeMode:true,jevMode:false,liveEnabled:true,confirm:'LIVE'\}/,'Kurulla CANLI = committee alone');
  assert.match(h,/const g=document\.getElementById\('btnGoLive'\);if\(g&&!g\.disabled\)\{g\.click\(\);modeMsg\('JEV \+ Kurul hazır/,'the last press stays with the user');
  assert.match(h,/JEV cevap veremezse \(OpenRouter kredisi \/ hata\) kurul karar verir/);assert.match(h,/const CM_WARN='Kural \(bot\) her sinyalde işlemi açar; kurul girişte oy verir, engellemez/);
  assert.match(h,/const DEC_TR=d=>d==='RULE_PLUS_JEV_COMMITTEE'\?' • JEV\+Kurul'/);
});
