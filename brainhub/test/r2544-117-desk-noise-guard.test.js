'use strict';
// R2544.117 (kullanıcı 03.11: "10 saatlik sonuca bak, trade'i engelleyecek, yanlış karar verdirecek hata var mı"): 02-03.11 ölçüm - masa 5 işlemin
// 5'ini gürültüde kesti (gerçek -0,75R / plana bırakılsa +0,36R; HAEDAL 7. dk -0,18R -> plan +2,25R hedef); Gemini günlük kotası sabah bitti
// (kurul 1/15); TA 06:05 yeniden giriş sessizce atıldı (bekleme süresi); AGT 05:20 fiyat bir kez alınamadı.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const DESK=require('../position-desk');
const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
test('R2544.117 the desk acts only outside the noise: open >= 30 min AND (<= -0.6R or best >= +1R); otherwise recorded, not executed',()=>{
  assert.match(lc,/const DESK_GUARD=\{minOpenMin:30,failR:-0\.6,protectR:1\};/);
  assert.match(lc,/beyondNoise=openMin>=DESK_GUARD\.minOpenMin&&\(\(finite\(rec\.R\)\?\?0\)<=DESK_GUARD\.failR\|\|\(mfe\?\?-9\)>=DESK_GUARD\.protectR\)/);
  assert.match(lc,/if\(auth&&rec\.action!=='HOLD'&&!beyondNoise\)\{rec\.guard=\{code:'NOISE_GUARD'/);
  assert.match(DESK.decisionText({action:'EXIT',reason:'X',guard:{code:'NOISE_GUARD',openMin:7,R:-0.28}}),/GÜRÜLTÜ KORUMASI: uygulanmadı \(7 dk, -0\.28R/);
});
test('R2544.117 the desk looks less often (quota): first look 30 min, then every 30 min or a 0.8R move',()=>{
  const c=DESK.readConfig('C:/__none__');assert.equal(c.cadenceMin,30);assert.equal(c.firstAfterMin,30);assert.equal(c.moveTriggerR,0.8);
});
test('R2544.117 entry learning vote 5 seats; a re-entry on the same coin is a warning; one price retry',()=>{
  assert.match(lc,/const ENTRY_TEAM=5;/);
  assert.match(lc,/const flags=\[\.\.\.\(cd\?\[\{code:cd\}\]:\[\]\),/);assert.doesNotMatch(lc,/if\(cd\)\{res\.reason=cd;continue;\}/);
  assert.match(lc,/await new Promise\(r=>setTimeout\(r,1500\)\);try\{px=await paperPrice\(symbol\);\}catch\{px=null;\}\} \/\/ R2544\.117/);
});

test('R2544.117 a provider that was not connected yet waits 1 h (not 3 days); an old Groq 413 waits 6 h',()=>{
  const MC=require('../model-committee'),t=Date.UTC(2026,10,2,18,6);
  const cf={lastOk:false,consecutiveFail:6,at:t,error:'HTTP 404 {"error":{"message":"No active credentials for provider: cloudflare-ai"}}'};
  assert.equal(MC.unusableWhy(cf),'NOT_CONNECTED');assert.equal(MC.isGone(cf,t+30*60000),true);assert.equal(MC.isGone(cf,t+61*60000),false,'the user connected it: tried again after 1 h');
  const g={lastOk:false,consecutiveFail:1,at:t,error:'HTTP 413 {"error":{"message":"[413]: Request too large for model"}}'};
  assert.equal(MC.isGone(g,t+5*3600000),true);assert.equal(MC.isGone(g,t+7*3600000),false);
  const sick={lastOk:false,consecutiveFail:6,at:t,error:'HTTP 400 model is not supported'};assert.equal(MC.isGone(sick,t+2*24*3600000),true,'others keep 3 days');
});
test('R2544.117 the free daily quota is spread: inside a provider the member used least TODAY sits first',async()=>{
  const MC=require('../model-committee'),os=require('node:os');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'q117-')),hf=path.join(dir,'h.json');
  const day=new Date().toISOString().slice(0,10);
  fs.writeFileSync(hf,JSON.stringify({health:{'ROUTER:gemini/a':{ok:5,fail:0,lastOk:true,at:Date.now(),day,callsToday:90},'ROUTER:gemini/b':{ok:5,fail:0,lastOk:true,at:Date.now(),day,callsToday:3}}}));
  const mk=id=>({id,call:async()=>({ok:true,model:id,text:'{"ok":true}'})});
  const c=MC.createCommittee({size:1,members:[mk('ROUTER:gemini/a'),mk('ROUTER:gemini/b')],healthFile:hf});await c.probe({force:true});
  assert.equal(c.pick()[0].id,'ROUTER:gemini/b');
});

test('R2544.117 Cohere (trial, ~1000 calls a month) gets one seat; Mistral is paid (user) and never joins by itself',()=>{
  const MC=require('../model-committee');assert.equal(MC.PROVIDER_CAP.cohere,1);assert.equal(MC.PROVIDER_CAP.mistral,undefined);
  assert.equal(MC.limitOf('ROUTER:cohere/command-a-vision-07-2025').text,'Cohere deneme ~1000/ay');
  const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');assert.match(sv,/'cohere\/command-a-vision-07-2025'\]/);
});
