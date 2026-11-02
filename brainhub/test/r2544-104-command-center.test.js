'use strict';
// R2544.104 KOMUTA MERKEZİ (kullanıcı 02.11: "office ... tek bir kartta grafik istatistik tüm bağlamı tek seferde göstermeli; canlıda da aynı
// testte aynı olmalı; JEV'li / JEV'siz / test"). Çekirdek: commandSummary (o anki modun son 30 günü). Office: tek kart + sade görünüm.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const T3=require('../top3-hunter');
const DAY=86400000,now=Date.UTC(2026,10,2,8,0,0);
const L=(rule,R,daysAgo,mode='TEST',desk=null)=>({rule,rMultiple:R,closedAt:now-daysAgo*DAY,mode,desk});
test('R2544.104 commandSummary: only the current mode, last 30 days; per strategy n / win / avg / total; equity curve and max drawdown; daily R; desk decisions',()=>{
  const ls=[L('LONG_EARLY_RETEST',-1,1),L('LONG_EARLY_RETEST',2,2),L('SHORT_TOP_BREAK',2.2,3),L('SHORT_TOP_BREAK',-1,4),L('ZIRVE5_FIBO_LONG',1,5),
    L('LONG_EARLY_RETEST',-1,40),L('SHORT_TOP_BREAK',5,1,'LIVE'),L('ZIRVE5_FIBO_SHORT',-1,0.5,'TEST',{decisions:[{action:'HOLD'},{action:'EXIT',authority:true}]})];
  const c=T3.commandSummary(ls,{mode:'TEST',now});
  assert.equal(c.all.n,6,'40-day-old and LIVE lessons are out');assert.equal(c.all.totR,2.2);assert.equal(c.all.wins,3);assert.equal(c.all.winPct,50);
  const by=Object.fromEntries(c.strategies.map(s=>[s.key,s]));assert.equal(by.ERKEN_LONG.n,2);assert.equal(by.ERKEN_LONG.totR,1);assert.equal(by.TEPE_SHORT.totR,1.2);assert.equal(by.ZIRVE5.n,2);
  // order by time: +1 (5d) -1 (4d) +2.2 (3d) +2 (2d) -1 (1d) -1 (0.5d) -> peak 4.2, end 2.2 -> max DD -2
  assert.deepEqual(c.curve.map(p=>p[1]),[1,0,2.2,4.2,3.2,2.2]);assert.equal(c.all.maxDDR,-2);
  assert.equal(c.days14.length,14);assert.equal(c.desk.decisions,2);assert.equal(c.desk.authorized,1);assert.deepEqual(c.desk.acts,{HOLD:1,EXIT:1});
  const live=T3.commandSummary(ls,{mode:'LIVE',now});assert.equal(live.all.n,1,'LIVE shows LIVE');assert.equal(live.all.totR,5);
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');assert.match(lc,/top3Lib\.commandSummary\(\[\.\.\.\(top3State\.lessons\|\|\[\]\),\.\.\.\(z5State\(\)\.lessons\|\|\[\]\)\],\{mode,now\}\)/);
});
test('R2544.104 Office command center: one card at the top, mode / owner / JEV / committee / balance; same card in TEST and LIVE; the rest folds away but the strategy controls stay',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.ok(html.indexOf('id="ccCard"')<html.indexOf('id="kpis"'),'right under the mode bar');
  for(const id of ['ccMode','ccTotR','ccEq','ccDays','rxHealth','rxCanvas','ccStrats','ccModels','ccJudge','ccNow','rxStrip'])assert.ok(html.includes(`id="${id}"`),id);
  assert.match(html,/const keep=new Set\(\['demoBanner','modeBar','ccCard','top3Card','z5Card','researchCard','moverCard'\]\)/);
  const a=html.indexOf('// ---------- R2544.104 KOMUTA MERKEZİ'),b=html.indexOf('// RX_END');const src=html.slice(a,b);
  const ctx={console,Date,Math,Number,String,JSON,Array,Object,setInterval:()=>0,document:{getElementById:()=>null}};vm.createContext(ctx);vm.runInContext(src+';this.ccModel=ccModel;',ctx);
  const snap=mode=>({status:{tradingMode:{mode,paper:{equity:429.4,net:29.4}},armed:true},account:{equity:1000},
    top3:{tradingMode:mode,running:true,gate:'OPEN',switches:{enabled:true,committeeMode:true,liveEnabled:mode==='LIVE'},cc:{days:30,all:{n:3,totR:1.5},strategies:[{key:'ERKEN_LONG',lane:'ILK3',n:2}]},
      positionDesk:{cmBoard:{rows:[{id:'ROUTER:kr/claude-sonnet-4.5',key:'kr/claude-sonnet-4.5',healthy:true,inTeam:true,live:{n:2,take:{n:0},skip:{n:2,avgR:-1}},exam:{n:7}}],committee:{live:{n:2}}},comparison:{ILK3:{n:1}}},active:[]},
    zirve5:{running:true,gate:'OPEN',switches:{enabled:true,jevMode:true},active:[]}});
  let m=ctx.ccModel(snap('TEST'));assert.equal(m.mode,'TEST');assert.equal(m.bal.equity,429.4,'TEST: virtual account');assert.equal(m.lanes[0].sw.committeeMode,true);assert.equal(m.jevOn,true);
  assert.equal(m.healthy,1);assert.equal(m.models[0].m,'claude-sonnet-4.5');assert.equal(m.models[0].liveN,2);
  m=ctx.ccModel(snap('LIVE'));assert.equal(m.mode,'LIVE');assert.equal(m.bal.equity,1000,'LIVE: the real Binance account');assert.equal(m.bal.src,'Binance');
  assert.doesNotMatch(src,/fetch\(|\/api\/control|top3Control|z5Control/,'display only');
});
test('R2544.104 replacement: 6 failures in a row (not quota / busy) gives the seat away for 3 days; OpenRouter bench is filled from today\'s free catalog (gone ones skipped, at most 10); 9Router extras up to 16',()=>{
  const MC=require('../model-committee'),t=Date.now();
  assert.equal(MC.unusableWhy({lastOk:false,error:'INVALID_RESPONSE',consecutiveFail:6}),'SICK');assert.equal(MC.unusableWhy({lastOk:false,error:'INVALID_RESPONSE',consecutiveFail:5}),null);
  assert.equal(MC.unusableWhy({lastOk:false,error:'MODEL_RATE_LIMIT HTTP 429',consecutiveFail:9}),null,'busy keeps its seat');assert.equal(MC.unusableWhy({lastOk:false,error:'You exceeded your current quota',consecutiveFail:9}),null,'quota keeps its seat');
  assert.ok(MC.isGone({lastOk:false,error:'HTTP 500',consecutiveFail:6,at:t},t));
  const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(sv,/const orIds=\[\.\.\.new Set\(\[\.\.\.\[\.\.\.orVision\]\.filter\(m=>!OR_SKIP\.test\(m\)\),\.\.\.OR_FREE_PREF\.filter\(m=>!catalog\.size\|\|catalog\.has\(m\)\),\.\.\.\[\.\.\.catalog\]\.filter\(m=>\/:free\$\/\.test\(m\)&&!OR_FREE_PREF\.includes\(m\)&&!OR_SKIP\.test\(m\)\)\]\)\]/); // R2544.115 image models first
  assert.match(sv,/\.filter\(m=>!\(ctx\?\.gone&&ctx\.gone\('OR:'\+m\)\)\)\.slice\(0,OR_MAX\)/);assert.match(sv,/OR_MAX=12;/);assert.match(sv,/perProvider:3,max:28,candidates:\[\.\.\.visionFirst,\.\.\.ROUTER_CANDIDATES\]/); // R2544.115
});
test('R2544.104 a dropped model is replaced within minutes: the next candidate (never asked before) is probed on the next 5-min tick, not at the hourly probe',async()=>{
  const MC=require('../model-committee');let t=Date.UTC(2026,10,2,9,0,0);const calls={};let ids=['ROUTER:a/x'];
  const c=MC.createCommittee({clock:()=>t,members:()=>ids.map(id=>({id,call:async()=>{calls[id]=(calls[id]||0)+1;return {ok:true,text:'{"ok":true}'};}}))});
  await c.probe({force:true});assert.deepEqual(calls,{'ROUTER:a/x':1});
  ids=['ROUTER:a/x','ROUTER:b/new'];t+=5*60000;await c.probe();
  assert.deepEqual(calls,{'ROUTER:a/x':1,'ROUTER:b/new':1},'only the new one is asked, 5 min later');assert.ok(c.healthy().some(m=>m.id==='ROUTER:b/new'),'and it can sit at the table');
});
