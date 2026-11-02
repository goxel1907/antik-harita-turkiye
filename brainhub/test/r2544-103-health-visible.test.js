'use strict';
// R2544.103 (kullanıcı 02.11: "modellerin çalıştığına emin ol ve office de net göster"). Office 0/25 sağlıklı gösteriyordu: kurul üyeleri
// bir işlevden her çağrıda YENİ nesnelerle geliyor, status() includes(m) ile bakıyordu -> hep false (R2544.92'den beri). Kurul doğru seçiyordu.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const MC=require('../model-committee');
test('R2544.103 status() marks healthy members when the members come from a function (new objects every call)',async()=>{
  const c=MC.createCommittee({members:()=>[{id:'ROUTER:gemini/a',call:async()=>({ok:true,text:'{"ok":true}'})},{id:'ROUTER:kr/b',call:async()=>({ok:false,reason:'HTTP 500'})}]});
  await c.probe({force:true});const st=c.status();
  assert.deepEqual(st.members.map(m=>m.id+'='+m.healthy),['ROUTER:gemini/a=true','ROUTER:kr/b=false']);assert.deepEqual(st.team,['ROUTER:gemini/a']);
  const b=MC.board({status:st,now:Date.now()});assert.equal(b.rows.filter(r=>r.healthy).length,1,'the Office board now sees it');
});
test('R2544.103 Groq: one member at most and a 1500-token answer budget (prompt + max_tokens must fit ~8K/min); others keep 4096',()=>{
  assert.equal(MC.PROVIDER_CAP.groq,1);
  const out=MC.pickRouterExtras(['groq/openai/gpt-oss-120b','groq/qwen/qwen3.8-27b'],{strong:/./,candidates:[]});assert.deepEqual(out,['groq/openai/gpt-oss-120b']);
  const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');assert.ok(sv.includes(String.raw`{maxTokens:small||/^groq\//.test(m)?1500:4096,validate}`),'R2544.115: routerAsk keeps the Groq budget');assert.ok(sv.includes('const routerCall=m=>a=>routerAsk(m,a);'));
});
test('R2544.103 Office health strip + phone model list: every model with a plain state and reason',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  const src=html.slice(html.indexOf('// RX_BEGIN'),html.indexOf('// RX_END'));const ctx={console,Date,Math,Number,String,JSON,Array,Object};vm.createContext(ctx);vm.runInContext(src+';this.rxModel=rxModel;',ctx);
  const rows=[{id:'ROUTER:gemini/gemini-3.5-flash-lite',key:'gemini/gemini-3.5-flash-lite',healthy:true,inTeam:true},{id:'ROUTER:ollama/gpt-oss:120b',key:'ollama/gpt-oss:120b',healthy:false,lastError:'HTTP 503 [402]: Add usage credits'},
    {id:'ROUTER:kr/glm-5',key:'kr/glm-5',healthy:false,quota:{kind:'MONTHLY'},lastError:'[402] MONTHLY_REQUEST_COUNT'},{id:'OR:x',key:'x',healthy:false,quota:{kind:'RATE'},lastError:'MODEL_RATE_LIMIT HTTP 429'},{id:'ROUTER:gc/y',key:'gc/y',healthy:false,lastError:'The operation was aborted due to timeout'}];
  const m=ctx.rxModel({top3:{positionDesk:{cmBoard:{rows}}}});
  assert.equal(m.healthy,1);assert.equal(m.health[0].m,'gemini-3.5-flash-lite');assert.equal(m.health[0].st,'ok');
  const by=Object.fromEntries(m.health.map(h=>[h.m,h.st+'/'+h.why]));
  assert.equal(by['gpt-oss:120b'],'quota/kredi istiyor');assert.equal(by['glm-5'],'quota/aylık kota');assert.equal(by['x'],'busy/yoğun');assert.equal(by['y'],'sick/zaman aşımı');
  assert.match(html,/<div class="rx-health" id="rxHealth"/);assert.match(html,/KURUL SAĞLIĞI <b/);
  const {mobileStatus}=require('../mobile-status');const o=mobileStatus({top3:{positionDesk:{committee:{team:[],members:[]},cmBoard:{rows}}}});
  assert.deepEqual(o.committee.models.map(x=>x.m+'='+x.st),['gemini-3.5-flash-lite=OK','gpt-oss:120b=SICK','glm-5=QUOTA','x=BUSY','y=SICK']);
});
