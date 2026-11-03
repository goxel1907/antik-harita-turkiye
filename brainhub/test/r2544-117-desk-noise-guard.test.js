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

test('R2544.119 Mistral and Cohere are paid (user 03.11): neither joins by itself',()=>{
  const MC=require('../model-committee');assert.equal(MC.PROVIDER_CAP.cohere,undefined);assert.equal(MC.PROVIDER_CAP.mistral,undefined);
  const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');assert.doesNotMatch(sv,/'cohere\//);
  const FREE=new Function('return '+sv.match(/const ROUTER_FREE_PROVIDERS=(\/.*\/i?);/)[1])();assert.ok(!FREE.test('cohere/x')&&!FREE.test('mistral/x'));
});

test('R2544.117 brain: a trade the desk cut is learned on the plan\'s own result (a desk exit at -0.2R / +0.1R made 5 of 6 trades BASABAS); a guarded order never counts as executed',()=>{
  const AUT=require('../trade-autopsy'),t0=Date.UTC(2026,10,2,23,10),M5=300000;
  const k5=Array.from({length:400},(_,i)=>{const t=t0-10*3600000+i*M5,p=100-(t>t0?(t-t0)/3600000*0.6:0);return [t,p,p+0.1,p-0.1,p,1000,0,0,0,500];});
  const btc=k5.map(r=>[r[0],50000,50010,49990,50000,10,0,0,0,5]);
  const lesson={side:'SHORT',entryPrice:100,stopPct:0.036,openedAt:t0,closedAt:t0+7*60000,rMultiple:-0.21,targetPct:0.09,exitType:'TOP3_DESK_EXIT',features:{},tags:[]};
  const now=t0+30*3600000,real=AUT.autopsy(lesson,k5,btc,{now}),plan=AUT.autopsy(lesson,k5,btc,{now,planR:2.25});
  assert.equal(real.outcome,'BASABAS');assert.equal(real.basis,'REAL');
  assert.equal(plan.outcome,'KAZANC');assert.equal(plan.basis,'PLAN');assert.equal(plan.realR,-0.21);assert.equal(plan.judgedR,2.25);
  assert.equal(AUT.autopsy(lesson,k5,btc,{now,planR:null}).basis,'REAL','null is not 0');
  const DESK=require('../position-desk');const plan0={side:'SHORT',entry:100,stop:103.6,target:91,partAtR:2,partShare:0.5};
  const k=k5.map(r=>[r[0],r[1],r[2],r[3],r[4],r[5]]);
  const g=DESK.counterfactual({plan:plan0,decisions:[{at:t0+5*60000,action:'EXIT',authority:true,guard:{code:'NOISE_GUARD'}}]},k);
  assert.equal(g.acted,0,'a guarded EXIT was never executed');assert.equal(g.deltaR,0);
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(lc,/if\(deskActed\)\{try\{const cf=DESK\.counterfactual\(l\.desk,k5w\);if\(cf\?\.ok&&finite\(cf\.ruleR\)!==null\)planR=cf\.ruleR;\}catch\{\}\}/);
  assert.match(lc,/l\.autopsy\.basis!=='PLAN'&&deskCut\(l\)&&\(l\.autopsyTries\|\|0\)<8/);
});

test('R2544.119 Cloudflare: the full @cf ids (03.11 "No such model glm-5.3-flash"), mapped to the catalog for the image flag; the unconnected cloudflare-workers-ai candidates are gone',()=>{
  const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  for(const m of ['cf/@cf/moonshotai/kimi-k2.6','cf/@cf/zai-org/glm-4.7-flash','cf/@cf/mistralai/mistral-small-3.1-24b-instruct'])assert.ok(sv.includes("'"+m+"'"),m);
  assert.doesNotMatch(sv,/'cloudflare-workers-ai\/glm-5\.3-flash'|'cloudflare-ai\/glm-5\.3-flash'/);
  const re=new Function('return '+sv.match(/k=String\(m\)\.replace\((\/.*?\/),/)[1])();assert.equal('cloudflare-ai/@cf/zai-org/glm-5.3-flash'.replace(re,'$1/'),'cloudflare-ai/glm-5.3-flash');
});

test('R2544.119 Requesty (free plan, verified on its pricing page 03.11): only its FREE model ids can be called; Z.ai is gone (it asked the user to pay)',()=>{
  const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  const FREE=new Function('return '+sv.match(/const ROUTER_FREE_PROVIDERS=(\/.*\/i?);/)[1])();
  const fo=new Function('return '+sv.match(/const FREE_ONLY=(\[\[[\s\S]*?\]\]);/)[1])();const ok=m=>{for(const [p,o] of fo)if(p.test(m))return o.test(m);return true;};
  for(const m of ['requesty/google/gemma-4-31b-it','requesty/nvidia/nemotron-3-ultra-550b-a55b'])assert.ok(FREE.test(m)&&ok(m),m);assert.ok(!FREE.test('zai/glm-4.6v-flash'),'Z.ai: paid for the user');
  for(const m of ['requesty/openai/gpt-6-luna','requesty/anthropic/claude-x'])assert.ok(!ok(m),m+' is paid: never called');
  assert.ok(ok('gemini/gemini-3.6-flash'),'other providers untouched');
  assert.ok(FREE.test('Requesty/google/gemma-4-31b-it')&&ok('Requesty/google/gemma-4-31b-it')&&!ok('Requesty/particle/particle-1'),'a capital R prefix works the same; a model off the free list is never called');
  assert.match(sv,/candidates:\[\.\.\.visionFirst,\.\.\.ROUTER_CANDIDATES\]\.filter\(freeModelOk\)/);assert.match(sv,/ROUTER_FREE_PROVIDERS\.test\(m\)&&freeModelOk\(m\)/);
  const re=new Function('return '+sv.match(/const COMMITTEE_VISION=(\/.*\/i);/)[1])();assert.ok(re.test('requesty/meta/muse-glimmer-30b')&&re.test('requesty/google/gemma-4-31b-it'));
  const MC=require('../model-committee');assert.equal(MC.PROVIDER_CAP.requesty,2);assert.equal(MC.limitOf('ROUTER:requesty/google/gemma-4-31b-it').perDay,200);
});
