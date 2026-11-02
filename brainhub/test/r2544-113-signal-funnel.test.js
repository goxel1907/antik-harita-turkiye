'use strict';
// R2544.113 (kullanıcı 02.11: "hâlâ işlem yok, SIREN'de takılı kalmış gibi"): son 24 saatin sinyal hunisi - her sinyalin akıbeti ve nedeni, saatiyle
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {writeTradingMode}=require('../binance-live-transport');
const ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
test('R2544.113 sinyal hunisi: açıldı / kural eledi (neden, stop) / kurul GİRME / ZİRVE-5 notu; en yeni üstte',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r113-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify({enabled:true}));
  writeTradingMode(root,{mode:'TEST',changedAt:'2026-10-20T08:00:00.000Z',testStartedAt:null,testAutoRun:true});
  const now=Date.UTC(2026,10,2,14,0),M=60000;
  const J={TOP3_SIGNAL:[{ts:now-300*M,symbol:'OGNUSDT',payload:{side:'LONG',rule:'LONG_EARLY_RETEST',gate:'OPEN'}},{ts:now-240*M,symbol:'LYNUSDT',payload:{side:'SHORT',rule:'SHORT_TOP_BREAK',gate:'OPEN'}},
      {ts:now-180*M,symbol:'SIRENUSDT',payload:{side:'SHORT',rule:'SHORT_TOP_BREAK',gate:'OPEN'}},{ts:now-30*M,symbol:'IDOLUSDT',payload:{side:'SHORT',rule:'SHORT_TOP_BREAK',gate:'OPEN'}},
      {ts:now-25*60*M,symbol:'OLDUSDT',payload:{side:'LONG',gate:'OPEN'}}],
    TOP3_ENTRY:[{ts:now-299*M,symbol:'OGNUSDT',payload:{}}],
    TOP3_BLOCKED:[{ts:now-240*M+1000,symbol:'LYNUSDT',payload:{result:{reason:'V2_STOP_OUT_OF_RANGE',stopPct:0.1392}}}],
    TOP3_COMMITTEE_SKIP:[{ts:now-177*M,symbol:'SIRENUSDT',payload:{consensus:'UNANIMOUS'}}],
    ZIRVE5_BLOCKED:[{ts:now-200*M,symbol:'JCTUSDT',payload:{side:'SHORT',reason:'ZIRVE5_STOP_OUT_OF_BAND',stopPct:0.107}}]};
  const store={journal:()=>{},recordLearning:()=>{},recentJournal:(k,{sinceTs=0}={})=>(J[k]||[]).filter(x=>x.ts>=sinceTs).map((x,i)=>({id:i,kind:k,...x}))};
  const c=require('../live-controller').createLiveController({root,clock:()=>now,store,scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),
    credentials:{apiKey:'fake-r113',apiSecret:'fake-r113'},fetchImpl:async()=>ok({}),paperAutoTick:false,defaultTradingMode:'TEST',market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}}}});
  c._testZ5State().recent=[{at:new Date(now-60*M).toISOString(),symbol:'AKEUSDT',side:'SHORT',opened:false,reason:'LIVE_NOT_ARMED'}];
  const f=c.top3Status().funnel;
  assert.equal(f.signals,6,'24 saatten eski sinyal sayılmaz');assert.equal(f.opened,1);assert.equal(f.committeeSkip,1);assert.equal(f.ruleBlocked,2);assert.equal(f.paused,1,'sistem duraklaması kural elemesi sayılmaz');assert.equal(f.noResult,1);
  assert.deepEqual(f.rows.map(r=>r.symbol),['IDOLUSDT','AKEUSDT','SIRENUSDT','JCTUSDT','LYNUSDT','OGNUSDT']);
  const lyn=f.rows.find(r=>r.symbol==='LYNUSDT');assert.equal(lyn.fate,'RULE_BLOCKED');assert.equal(lyn.reason,'V2_STOP_OUT_OF_RANGE');assert.equal(lyn.stopPct,0.1392);
  assert.equal(f.rows.find(r=>r.symbol==='SIRENUSDT').reason,'UNANIMOUS');assert.equal(f.rows.find(r=>r.symbol==='AKEUSDT').reason,'LIVE_NOT_ARMED');assert.equal(f.rows.find(r=>r.symbol==='AKEUSDT').fate,'PAUSED');
  assert.equal(f.reasons.V2_STOP_OUT_OF_RANGE,1);assert.equal(f.reasons.ZIRVE5_STOP_OUT_OF_BAND,1);
});

test('R2544.113 Office: reaktörde sinyal hunisi, şeritte saat, grafik en yeni sinyali izler, beyin özeti, arşiv etiketi, JEV kapalıyken GitHub listesi ve grafik okuma gizli, kaçan hareket özeti',()=>{
  const h=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.ok(h.includes('id="rxFunnel"'));assert.ok(h.includes('function renderFunnel(s)'));assert.ok(h.includes("try{renderFunnel(s);}catch(e)"));
  assert.ok(h.includes('ticker.push(`${rxT(x.at)}🤝'));assert.ok(h.includes('ticker.push(`${rxT(c.at)}'));
  assert.ok(h.includes("localStorage.setItem('jev-mirror-manual-at'"));assert.ok(h.includes('Date.now()-man>30*60000'));
  assert.ok(h.includes('BEYİN NE ÖĞRENDİ'));assert.ok(h.includes('SABİT ÖLÇÜM ARŞİVİ'));assert.ok(h.includes('if(repos.length&&jevLiveR)h+='));
  assert.ok(h.includes('if(narrEl&&!jevLiveN)'));assert.ok(h.includes('class="mv-sum"'));
  const js=h.match(/<script>([\s\S]*?)<\/script>/)[1];assert.doesNotThrow(()=>new Function(js),'satır içi betik derlenir');
});
