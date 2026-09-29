'use strict';
// CLAUDE_R2544.7 (29.09.2026): son 5 saatin 11 kapanışı + 92 işlemin 1m yolu ile yönetim sözleşmesi düzeltmesi
// ve JEV bağlam taşması (400 max_tokens_exceeded) için tek yeniden deneme.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const G=require('../position-guard');
const E=require('../engine');
const {createJevClient,prepareDecisionRequest,MAX_DECISION_REQUEST_BYTES}=require('../jev-decision');

test('JEV kısmi sözleşmesi: kârdayken (0R üstü) serbest, zararda ertelenir; sayı/aralık sınırı sürer (LINK 29.09)',()=>{
  const now=10*3600000;
  // LINK LONG 15.604 / stop 14.969: JEV 00:40 +0,19R ve 00:45 +0,23R kısmi istedi. R2544.4 (0,5R) ikisini de erteliyordu → stop 02:50.
  const c=(mark,events=[],cfg={})=>G.partialContract({side:'LONG',entryPrice:15.604,initialStop:14.969,markPrice:mark,partialEvents:events,now,config:{...G.DEFAULTS,...cfg}});
  assert.equal(G.DEFAULTS.partialMinR,0);
  const a=c(15.7249);assert.equal(a.allow,true,JSON.stringify(a));assert.ok(a.progressR>0.18&&a.progressR<0.2);
  const loss=c(15.50);assert.equal(loss.allow,false);assert.equal(loss.reason,'PARTIAL_DEFERRED_BELOW_MIN_R');
  const ev=t=>({action:'PARTIAL_TAKE_PROFIT',at:t});
  assert.equal(c(15.75,[ev(now-5*60000)]).reason,'PARTIAL_DEFERRED_SPACING','5 dk arayla ikinci kısmi yok');
  assert.equal(c(15.75,[ev(now-90*60000),ev(now-60*60000)]).reason,'PARTIAL_DEFERRED_MAX_COUNT');
  assert.equal(c(15.7249,[],{partialMinR:0.5}).allow,false,'eski eşik yapılandırmayla geri alınabilir');
});

test('guard: kârda JEV kısmisinden sonra kalan için stop başabaşa; kapalıyken yok; asla genişlemez',()=>{
  const base=(row={},cfg={},mark=100.3)=>({row:{symbol:'ABCUSDT',side:'LONG',entryPrice:100,originalStopPrice:98,currentStop:98,originTF:'15m',lane:'15M_TRADE',createdAt:0,...row},
    snap:{qty:20,entryPrice:100,markPrice:mark,tickSize:0.01},phase:'INITIAL',now:60000,config:{...G.DEFAULTS,...cfg}});
  assert.equal(G.evaluateGuard(base()).action,'NONE');
  const be=G.evaluateGuard(base({jevPartialBE:true}));
  assert.equal(be.action,'TIGHTEN_STOP');assert.equal(be.reason,'GUARD_JEV_PARTIAL_BREAKEVEN');assert.ok(be.target>=100&&be.target<100.2);
  assert.equal(G.evaluateGuard(base({jevPartialBE:true},{jevPartialBreakeven:0})).action,'NONE');
  assert.equal(G.evaluateGuard(base({jevPartialBE:true,currentStop:100.15})).action,'NONE','zaten başabaşta');
  const s=G.evaluateGuard({...base({side:'SHORT',originalStopPrice:102,currentStop:102,jevPartialBE:true},{},99.7),snap:{qty:20,entryPrice:100,markPrice:99.7,tickSize:0.01}});
  assert.equal(s.action,'TIGHTEN_STOP');assert.ok(s.target<=100&&s.target>99.8);
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(lc,/if\(action==='PARTIAL_TAKE_PROFIT'&&finite\(partialGate\?\.progressR\)!==null&&partialGate\.progressR>0\)\{rr0\.jevPartialBE=true;/);
});

test('prepareDecisionRequest: çağrı başına daha dar bayt sınırı (en fazla 52000)',()=>{
  const body={state:{description:'d'.repeat(1000),professionalTraderCortex:{reference:'c'.repeat(30000)},record:{x:'y'.repeat(100)}},questions:{}};
  const a=prepareDecisionRequest(body);const b=prepareDecisionRequest(body,{maxBytes:20000});const c=prepareDecisionRequest(body,{maxBytes:999999});
  assert.equal(a.diagnostics.maxBytes,MAX_DECISION_REQUEST_BYTES);assert.equal(b.diagnostics.maxBytes,20000);assert.equal(c.diagnostics.maxBytes,MAX_DECISION_REQUEST_BYTES);
  assert.ok(b.diagnostics.bytes<=20000&&b.diagnostics.bytes<a.diagnostics.bytes,JSON.stringify(b.diagnostics.trimStepsApplied));
});

function synth(iv,n,seed){const step={'1m':6e4,'3m':18e4,'5m':3e5,'15m':9e5,'30m':18e5,'1h':36e5,'2h':72e5,'4h':144e5,'1d':864e5}[iv]||9e5;
  let s=seed>>>0;const r=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};const last=Math.floor(Date.now()/step)*step;let p=100;const out=[];
  for(let i=n-1;i>=0;i--){const o=last-i*step,op=p,c=p*(1+(r()-0.5)*0.01),hi=Math.max(op,c)*(1+r()*0.004),lo=Math.min(op,c)*(1-r()*0.004),v=1000+r()*500;
    out.push([o,String(op),String(hi),String(lo),String(c),String(v),o+step-1,String(v*c),100,String(v*0.5),String(v*c*0.5),'0']);p=c;}return out;}

test('JEV 400 max_tokens_exceeded: paket 44 kB\'a budanıp yalnız BİR kez yeniden gönderilir (OP 29.09 03:20)',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bh-r25447-'));fs.mkdirSync(path.join(root,'config'));fs.mkdirSync(path.join(root,'logs'));
  fs.writeFileSync(path.join(root,'config','jev.json'),JSON.stringify({enabled:true,model:'typesafe/jev-1.13',decisionsUrl:'https://example.test/api/alpha/decisions',keyUrl:'https://example.test/api/v1/key',dailyCapUsd:0.25,timeoutMs:5000,reservePerCallUsd:0.01}));
  const raw={};E.NATIVE_FRAMES.forEach((tf,i)=>{raw[tf]=synth(tf,tf==='15m'?180:72,97+i*13);});
  const frames=E.analyzeFrames(raw,Date.now());for(const f of Object.values(frames))if(f&&f.available)f.fresh=true;
  const unified={symbol:'SOLUSDT',livePrice:frames['1m'].close,frames,dataQuality:{advisoryUsable:true},learning:{text:'m'.repeat(9000)}};
  const run=async(statuses)=>{const sizes=[];const resp=(st,o)=>({ok:st>=200&&st<300,status:st,async text(){return JSON.stringify(o);}});
    const client=createJevClient({root,apiKey:'sk-or-v1-test_key_12345678901234567890',fetchImpl:async(u,o)=>{sizes.push(Buffer.byteLength(o.body));const st=statuses[Math.min(sizes.length-1,statuses.length-1)];
      return st===400?resp(400,{error:{code:'max_tokens_exceeded'}}):resp(st,{error:'bad'});}});
    const out=await client.sovereignExit({position:{symbol:'SOLUSDT',side:'LONG',entryPrice:1,markPrice:1.01,quantity:1,unrealizedPnl:1},
      lifecycle:{originTF:'5m',ownerTF:'15m',setup:'x',entryPlan:{entryPrice:1,stopPrice:0.98},entryContext:{why:'w'.repeat(3000)}},currentPlan:{status:'WATCH'},unified,evidence:{text:'e'.repeat(20000)}});
    return {sizes,out};};
  const a=await run([400,400,400]);
  assert.equal(a.sizes.length,2,'tam olarak bir yeniden deneme');assert.ok(a.sizes[0]>44000&&a.sizes[1]<=44000,JSON.stringify(a.sizes));
  assert.equal(a.out.finalAuthority===true,false,'başarısız yanıt karar yetkisi vermez');
  const b=await run([422]);assert.equal(b.sizes.length,1,'başka hata kodunda yeniden deneme yok');
  const log=fs.readFileSync(path.join(root,'logs','jev-request-size.log'),'utf8');assert.match(log,/"retryAfter":"MAX_TOKENS_EXCEEDED"/);
  fs.rmSync(root,{recursive:true,force:true});
});
