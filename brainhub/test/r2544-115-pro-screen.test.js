'use strict';
// R2544.115 (kullanıcı 02.11: "kendini bir pro trader gibi düşün neyi görmek bilmek istersin trade için ona göre yap"): stop yapı arkasında mı
// gürültüde mi, likidite (hedefe mıknatıs / stopa tuzak), coin 24 sa + fonlama (kalabalık), seans, fikrin geçersiz olduğu yer, beynin benzer
// işlemleri; görebilen modele grafik (aynı ölçekli mumlar, giriş/stop/hedef çizgili); Groq'a kısa ekran; sınav kota bitince dinlenir;
// Office hunisinde kurulun inandığı (ortalama ihtimal / başabaş).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const TB=require('../trader-brain'),{createCommittee}=require('../model-committee'),{createTraderExam}=require('../trader-exam'),market=require('../market');
const H=3600000,T0=Date.UTC(2026,9,20,13,0,0);
const series=(n,ms,start,p0,step)=>Array.from({length:n},(_,i)=>{const p=p0+i*step;return [start+i*ms,p,p*1.004,p*0.996,p+step*0.5,100+i,0,0,0,60];});
const K=()=>({m5:series(80,300000,T0-80*300000,10,0.01),m15:series(80,900000,T0-80*900000,9,0.02),h1:series(80,H,T0-80*H,8,0.03),h4:series(80,4*H,T0-80*4*H,6,0.05),d1:series(80,24*H,T0-80*24*H,3,0.05),btc1h:series(40,H,T0-40*H,60000,10)});
const B=(side,tfs,extra={})=>TB.briefing({side,rule:side==='LONG'?'LONG_EARLY_RETEST':'SHORT_TOP_BREAK',plan:{stop:side==='LONG'?98:102,target:side==='LONG'?106:94,targetR:3,stopDistancePct:2},tfs,levels:[],btc:null,P:x=>x,R:()=>null,...extra});

test('R2544.115 stop: inside noise (< 1 ATR) and a swing beyond the stop are AGAINST; a swing in front of the stop protects it',()=>{
  const noisy=B('LONG',{m5:{structure:{atrPct:2.5},chartReading:{swing:{lastLow:{price:96,R:-2}}}}}).stop;
  assert.match(noisy,/^against: stop = 0\.8 ATR of 5m \(inside normal noise\); the last 5m swing low is beyond the stop \(-2\.00R\): a sweep of it would hit the stop first$/);
  const good=B('LONG',{m5:{structure:{atrPct:1},chartReading:{swing:{lastLow:{price:99,R:-0.5}}}}}).stop;
  assert.equal(good,'for: stop = 2.0 ATR of 5m; stop is beyond the last 5m swing low (-0.50R): structure protects it');
  assert.match(B('SHORT',{m15:{structure:{atrPct:1.6},chartReading:{swing:{lastHigh:{price:101,R:-0.4}}}}}).stop,/^for: stop is beyond the last 15m swing high \(-0\.40R\): structure protects it \| stop = 1\.3 ATR of 15m$/,'1-1.5 ATR: neutral information');
});

test('R2544.115 liquidity: pools ahead within the target pull price (FOR); a pool right behind the stop is a sweep target (AGAINST)',()=>{
  const tfs={h1:{chartReading:{liquidity:{buySide20:{price:104,R:2},sellSide20:{price:97.8,R:-1.1},equalHigh:{price:110,R:5},lastSweep:{side:'SELL',R:-0.6}}}}};
  const l=B('LONG',tfs).liquidity;
  assert.equal(l,'for: 1h buy-side liquidity (stops above highs) at +2.00R: a magnet toward the target | against: 1h sell-side liquidity at -1.10R, next to the stop: a sweep target | 1h last liquidity sweep sell at -0.60R');
  assert.doesNotMatch(l,/equal highs/,'beyond the 3R target: not a magnet');
});

test('R2544.115 coin: 24h move from the 1h candles, funding crowding judged for the side, rank; session; invalidation; brain experience',()=>{
  const k=K(),t=T0;
  const L=TB.entryPacket({k,plan:{side:'LONG',rule:'LONG_EARLY_RETEST',entry:10.8,stop:10.6,target:11.4},t,trigger:{level:10.7},context:{fund:0.0008,premium:0.003,rank:5,rankName:'24h gainer rank'},experience:{n:6,wins:2,losses:4,avgR:-0.21,thin:true}}).screen;
  assert.match(L.coin,/^against: funding 0\.080% per 8 h: longs crowded and paying \| coin \+\d+\.\d\d% in 24 h, now at \d+% of its 24h range; mark above index by 0\.30%; 24h gainer rank #5$/);
  const S=TB.entryPacket({k,plan:{side:'SHORT',rule:'SHORT_TOP_BREAK',entry:10.8,stop:11,target:10.3},t,context:{fund:0.0008}}).screen;
  assert.match(S.coin,/^for: funding 0\.080% per 8 h: longs crowded and paying/);
  assert.equal(L.session,'London / New York overlap (12-16 UTC): the most volume');
  assert.equal(L.invalidation,'the idea is wrong if a 5m candle closes back below the broken level 99.074 (-0.50R)');
  assert.match(L.experience,/^brain: 6 similar past trades of this rule by entry facts - 2 won, 4 lost, average -0\.21R \(thin sample\)\. .*weigh this lightly/);
  assert.equal(S.experience,null);assert.doesNotMatch(JSON.stringify(L),/USDT|2026/,'still no symbol, no date (only the hour of day)');
});

test('R2544.115 chart for vision models: the packet\'s own scaled candles, ENTRY / STOP / TARGET lines, a real PNG; compact screen for Groq',()=>{
  const pk=TB.entryPacket({k:K(),plan:{side:'LONG',rule:'LONG_EARLY_RETEST',entry:10.8,stop:10.6,target:11.4},t:T0});
  const sp=TB.chartSpecs(pk);assert.deepEqual(sp.map(c=>c.tf),['5m','15m','1h']);
  assert.equal(sp[0].candles.length,48);assert.equal(sp[0].candles.at(-1).close,pk.timeframes.m5.candles.rows.at(-1)[3],'same scaled candles');
  assert.deepEqual(sp[0].lines.slice(0,3).map(l=>l.name),['ENTRY 100','STOP -1R','TARGET +3.00R']);assert.equal(sp[0].lines[1].price,pk.plan.stop);
  const png=market.renderChartPng({candles:sp[0].candles},'annotated',{htfLevels:sp[0].lines.map(l=>({...l,tf:sp[0].tf}))});
  assert.equal(png.subarray(1,4).toString(),'PNG');assert.ok(png.length>5000);
  const c=JSON.parse(TB.compactPacket(JSON.stringify(pk)));
  assert.equal(c.screen.trade,pk.screen.trade);assert.ok(c.timeframes.m5.chartReading!==undefined&&!('candles' in c.timeframes.m5));
  assert.ok(JSON.stringify(c).length<JSON.stringify(pk).length*0.8,'clearly smaller');assert.equal(TB.compactPacket('{"task":"DESK"}'),null);
});

test('R2544.115 server wiring: vision members get chart images, Groq the compact screen, an image error retries text-only, a 413 retries compact',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  const re=new Function('return '+src.match(/const COMMITTEE_VISION=(\/.*\/i);/)[1])();
  for(const m of ['gemini/gemini-3.6-flash','gemini/gemma-4-31b-it','nvidia/nvidia/nemotron-3.5-super-vl-120b-a12b','nvidia/google/gemma-4-31b-it'])assert.ok(re.test(m),m);
  for(const m of ['groq/openai/gpt-oss-120b','nvidia/minimaxai/minimax-m3.1-flash','cloudflare-ai/glm-5.3-flash'])assert.ok(!re.test(m),m);
  assert.match(src,/if\(\/\^groq\\\/\/\.test\(m\)\)\{const c=TB\.compactPacket\(user\)/);
  assert.match(src,/if\(img&&!\/timeout\|aborted\|COOLDOWN\|429\/i\.test\(msg\)\)\{imgError=msg\.slice\(0,120\);img=false;try\{const out=await ask\(user\)/);
  assert.match(src,/if\(!compact&&\/413\|too large\|context length\|maximum context\/i\.test\(msg\)\)/);
  assert.match(src,/market\.renderChartPng\(\{candles:c\.candles\},'annotated'/);assert.match(src,/const TB=require\('\.\/trader-brain'\)/);
  assert.doesNotMatch(src,/'github\/gemini-3\.6-flash'/,'GitHub answered 400 "model not supported" for it');
  assert.match(src,/'Claud-Work','sinav','r2544-115'/);
});

test('R2544.115 every vote keeps whether the member saw the chart or the compact screen (committee -> gate record / exam answers)',async()=>{
  const ok='{"ok":true}',J=d=>JSON.stringify({decision:d,confidence:60,pTarget:35,reasonTr:'x'});
  const mk=(id,flags)=>{const a=[ok,J('SKIP')];return {id,call:async()=>({ok:true,model:id,text:a.shift(),...flags})};};
  const c=createCommittee({members:[mk('ROUTER:gemini/gemini-3.6-flash',{img:true}),mk('ROUTER:groq/openai/gpt-oss-120b',{compact:true})],healthFile:path.join(fs.mkdtempSync(path.join(os.tmpdir(),'c115-')),'h.json')});
  await c.probe({force:true});const r=await c.decide({system:'S',prompt:'P',validate:TB.validEntry,parse:TB.parseEntry,field:'decision',fallback:'SKIP'});
  const v=Object.fromEntries(r.votes.map(x=>[x.member,x]));
  assert.equal(v['ROUTER:gemini/gemini-3.6-flash'].img,true);assert.equal(v['ROUTER:groq/openai/gpt-oss-120b'].compact,true);assert.equal(v['ROUTER:groq/openai/gpt-oss-120b'].img,false);
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.equal((lc.match(/\.\.\.\(v\.img\?\{img:true\}:\{\}\),\.\.\.\(v\.compact\?\{cmp:true\}:\{\}\)/g)||[]).length,2,'gate record and shadow record');
  assert.match(lc,/context:\{rank:ef\.rank,rankName:'24h gainer rank',fund:ef\.fund,premium:ef\.premium\},experience:ef\.similar/);
  assert.match(lc,/context:\{rank:sg\.rank,rankName:'volatility rank \(top 5\)'\},experience:ef\.similar/);
  assert.match(lc,/\/fapi\/v1\/premiumIndex',\{params:\{symbol\}\}/);
});

test('R2544.115 exam rests for the UTC day after 2+ quota errors in one question (the live gate keeps the free quota)',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ex115-'));
  fs.writeFileSync(path.join(dir,'packets.jsonl'),['q1','q2'].map(id=>JSON.stringify({id,rule:'LONG_EARLY_RETEST',packet:{}})).join('\n')+'\n');
  let now=Date.UTC(2026,10,2,10);const q={member:'ROUTER:gemini/x',ok:false,error:'HTTP 503 [429] RESOURCE_EXHAUSTED'};
  const committee={decide:async()=>({ok:true,final:'SKIP',consensus:'UNANIMOUS',rounds:1,voters:2,votes:[{member:'ROUTER:a',ok:true,vote:{decision:'SKIP'},img:true},{...q},{...q,member:'ROUTER:gemini/y'}],round2:null})};
  const ex=createTraderExam({dir,committee,clock:()=>now});
  assert.equal((await ex.tick()).id,'q1');now+=46000;assert.deepEqual(await ex.tick(),{skipped:'QUOTA_REST'});
  const a=JSON.parse(fs.readFileSync(path.join(dir,'answers.jsonl'),'utf8').trim());assert.equal(a.round1[0].img,true);
  now=Date.UTC(2026,10,3,0,1);assert.equal((await ex.tick()).id,'q2','a new UTC day: the exam goes on');
});

test('R2544.115 Office funnel: a committee SKIP shows the average pTarget against the break-even hit rate and flags a self-contradicting SKIP',()=>{
  const {writeTradingMode}=require('../binance-live-transport');const root=fs.mkdtempSync(path.join(os.tmpdir(),'r115-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify({enabled:true}));writeTradingMode(root,{mode:'TEST',changedAt:'2026-10-20T08:00:00.000Z',testStartedAt:null,testAutoRun:true});
  const now=Date.UTC(2026,10,2,16),M=60000;
  const J={TOP3_SIGNAL:[{ts:now-60*M,symbol:'HOTUSDT',payload:{side:'LONG',rule:'LONG_EARLY_RETEST',gate:'OPEN'}}],
    TOP3_COMMITTEE_SKIP:[{ts:now-58*M,symbol:'HOTUSDT',payload:{consensus:'UNANIMOUS',plan:{targetR:2.5},screenTally:'leaning FOR this LONG: 4h, 15m, 5m; leaning AGAINST: 1d, 1h',
      votes:[{m:'gemini/a',d:'SKIP',p:30,why:'1h aşırı gerilmiş',img:true},{m:'nvidia/b',d:'SKIP',p:40,why:'direnç'},{m:'or',d:'ERR',p:null,why:'x'}]}}]};
  const store={journal:()=>{},recordLearning:()=>{},recentJournal:(k,{sinceTs=0}={})=>(J[k]||[]).filter(x=>x.ts>=sinceTs).map((x,i)=>({id:i,kind:k,...x}))};
  const c=require('../live-controller').createLiveController({root,clock:()=>now,store,scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),
    credentials:{apiKey:'fake-r115',apiSecret:'fake-r115'},fetchImpl:async()=>({ok:true,status:200,async text(){return '{}';}}),paperAutoTick:false,defaultTradingMode:'TEST',market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}}}});
  const r=c.top3Status().funnel.rows[0];
  assert.deepEqual(r.committee,{pAvg:35,breakEven:29,voters:2,img:1,tally:'leaning FOR this LONG: 4h, 15m, 5m; leaning AGAINST: 1d, 1h',why:'1h aşırı gerilmiş'});
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.match(html,/function funCm\(c\)/);assert.match(html,/kendi tahminiyle çelişkili GİRME/);assert.match(html,/\$\{pc\(r\.stopPct\)\}\$\{funCm\(r\.committee\)\}/);
});
