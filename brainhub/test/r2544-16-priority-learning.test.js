'use strict';
// CLAUDE_R2544_16: yeni tarama önceliği, grafik okuma (chart-readout) ve kâr/zarar ders kartları.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os');
const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'bh-r254416-'));
process.env.BRAINHUB_ROOT=TMP;
const R=require('../chart-readout');
const TL=require('../trade-lessons');
const scanner=require('../scanner');
const {openStore}=require('../store');
const src=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');

function candles(n,fn){const out=[];let t=Date.now()-n*9e5;for(let i=0;i<n;i++){const k=fn(i);t+=9e5;out.push({openTime:t-9e5,closeTime:t-1,quoteVolume:1000,takerBuyQuote:500,volume:10,...k});}return out;}

test('readout: dikey yükselişte uzama EXTENDED/EXTREME ve LONG kovalama riski HIGH',()=>{
  const c=candles(120,i=>{const b=100+(i>80?(i-80)*1.5:Math.sin(i/3)*0.5);return {open:b-0.3,high:b+0.4,low:b-0.5,close:b+0.3};});
  const s=R.stretch(c,0.8);
  assert.equal(s.leg,'UP');assert.ok(['EXTENDED','EXTREME'].includes(s.state),s.state);
  assert.equal(s.chaseRisk.LONG,'HIGH');assert.equal(s.zone,'PREMIUM');
});
test('readout: dar yatay piyasada sıkışma ON/ON_NARROW, sonra genişleyince salınım',()=>{
  const flat=candles(60,i=>{const b=100+Math.sin(i)*0.05;return {open:b,high:b+0.3,low:b-0.3,close:b+0.01*(i%2?1:-1)};});
  const q=R.squeeze(flat);assert.ok(['ON','ON_NARROW'].includes(q.state),JSON.stringify(q));
  const burst=flat.concat(candles(4,i=>{const b=100+(i+1)*2;return {open:b-1.8,high:b+0.2,low:b-2,close:b};}));
  const q2=R.squeeze(burst);assert.ok(q2.state==='OFF'?q2.released!==null:true,JSON.stringify(q2));assert.equal(q2.momentum,'UP');
});
test('readout: FVG bırakan yer değiştirme ve bacağın OTE geri çekilmesi',()=>{
  const c=candles(60,i=>{
    if(i<40){const b=100;return {open:b,high:b+0.5,low:b-0.5,close:b+0.1};}
    if(i===40)return {open:100,high:104.2,low:99.9,close:104};
    if(i<45){const b=104+(i-40)*0.8;return {open:b,high:b+0.6,low:b-0.2,close:b+0.5};}
    const b=107.5-(i-45)*0.35;return {open:b+0.1,high:b+0.3,low:b-0.3,close:b};
  });
  const d=R.displacement(c,1.0);
  assert.equal(d.dir,'UP');assert.ok(d.bodyAtr>=1.5&&d.fvgAtr>=0.25,JSON.stringify(d));assert.ok(d.retracePct>0);
});
test('readout: iki tepeden oluşan havuz süpürülüp geri alınırsa SWEPT_RECLAIMED',()=>{
  const c=candles(60,i=>{let b=100+Math.sin(i/2)*0.2;let hi=b+0.3;if(i===20||i===30)hi=102;if(i===50)hi=102.6;return {open:b,high:hi,low:b-0.3,close:b};});
  const pv={highs:[{index:20,price:102},{index:30,price:102}],lows:[]};
  const p=R.liquidityPools(c,0.5,pv);
  assert.equal(p.buySide[0].status,'SWEPT_RECLAIMED');assert.equal(p.buySide[0].touches,2);
});
test('readout özeti kısa (≤260 bayt) ve paket/karar/pipeline/anlatıcı hattına bağlı',()=>{
  const c=candles(120,i=>{const b=100+i*0.2;return {open:b-0.1,high:b+0.3,low:b-0.3,close:b+0.1};});
  const d=R.readoutDigest(R.chartReadout(c,0.5,{highs:[],lows:[]},'15m'));
  assert.equal(d.d,1);assert.ok(JSON.stringify(d).length<=260,JSON.stringify(d));assert.equal(R.readoutDigest(d),d,'özet idempotent');
  assert.match(src('engine.js'),/base\.readout = chartReadout\(c, a14, pv, frame\)/);
  assert.match(src('jev-market-packet.js'),/readout:readoutDigest\(f\.readout\)/);
  assert.match(src('jev-decision.js'),/readout:readoutDigest\(f\.readout\)/);
  assert.match(src('pipeline.js'),/readout:f\.readout \|\| null/);
  assert.match(src('chart-narrator.js'),/readoutText\(f\.readout, true\)/);
  assert.match(src('jev-decision.js'),/Frame readout \(closed candles, compact\)/);
});

test('ders kartı: katman eşlemesi, hızlı yeniden giriş, hızlı stop, lider kovalama, R aykırılığı',()=>{
  assert.equal(TL.tierOf({targetSources:['GAINER_TOP3','BINANCE_TOP24_GAINER']}),'TOP3');
  assert.equal(TL.tierOf({attentionSource:'PREV_ATTACK_4_10'}),'TOP4_10');
  assert.equal(TL.tierOf({deepScanReason:'CURRENT_ATTACK_TOP10',targetSources:['PREV_ATTACK_TOP3']}),'TOP3','eski saldırı nedeni katmanı ezmez');
  assert.equal(TL.tierOf({targetSources:['BINANCE_TOP24_GAINER'],gainerRank:7}),'TOP4_10');
  assert.equal(TL.tierOf({targetSources:['NEAR_EXPLOSION']}),'NEAR_EXPLOSION');
  const t0=Date.parse('2026-09-29T14:00:00Z');
  const win={symbol:'CELOUSDT',side:'LONG',netPnl:2.1,rMultiple:0.2,riskQuote:10,initialQuantity:5,exitType:'EXTERNAL_CLOSE',openedAt:new Date(t0).toISOString(),closedAt:new Date(t0+10*6e4).toISOString(),entryContext:{attention:{targetSources:['GAINER_TOP3']}}};
  const loss={symbol:'CELOUSDT',side:'LONG',netPnl:-22.8,rMultiple:-1.58,riskQuote:14.4,initialQuantity:5,exitType:'STOP_LOSS',holdMinutes:3,stopDistancePct:1.75,openedAt:new Date(t0+15*6e4).toISOString(),closedAt:new Date(t0+18*6e4).toISOString(),entryContext:{setupFamily:'FAILED_BREAKOUT',attention:{targetSources:['GAINER_TOP3'],change24hPct:31}}};
  const cards=TL.buildCards([win,loss]);
  const c=cards[1];
  assert.equal(c.tier,'TOP3');assert.equal(c.verdict,'MISTAKE');
  for(const t of ['LOSS_FAST_STOP','RAPID_REENTRY_AFTER_WIN','LEADER_CHASE_LONG','EXTENDED_24H_LONG'])assert.ok(c.tags.includes(t),t);
  assert.match(c.lesson,/kazançtan hemen sonra/);
  assert.equal(TL.canonicalR({rMultiple:65.5,riskQuote:0.15,initialQuantity:10}).r,null,'TRIA benzeri şişmiş R ölçülmüş sayılmaz');
  assert.equal(TL.canonicalR({rMultiple:3,riskQuote:1,initialQuantity:10,stopDistancePct:0.03}).status,'OUTLIER_R');
});
test('ders özeti: ne çalıştı / ne çalışmadı, bu katman ve bu coin; Beta sonrası',()=>{
  const mk=(i,tier,side,fam,net,exit)=>({symbol:'S'+(i%7)+'USDT',side,netPnl:net,rMultiple:net/5,riskQuote:5,initialQuantity:1,exitType:exit,holdMinutes:20,stopDistancePct:1.2,
    openedAt:new Date(Date.parse('2026-09-20T00:00:00Z')+i*36e5).toISOString(),closedAt:new Date(Date.parse('2026-09-20T00:30:00Z')+i*36e5).toISOString(),
    entryContext:{setupFamily:fam,attention:{targetSources:[tier]}}});
  const rows=[];
  for(let i=0;i<8;i++)rows.push(mk(i,'GAINER_TOP3','LONG','TREND_PULLBACK',i%3===0?4:-9,i%3===0?'TP1_BREAKEVEN':'STOP_LOSS'));
  for(let i=8;i<16;i++)rows.push(mk(i,'GAINER_TOP10','SHORT','STRUCTURAL_REVERSAL',i%4===0?-2:7,i%4===0?'STOP_LOSS':'TP1_RUNNER_TRAIL'));
  const cards=TL.buildCards(rows);
  const d=TL.digest(cards,{symbol:'S1USDT',candidate:{symbol:'S1USDT',targetSources:['GAINER_TOP3']}});
  assert.ok(d.worked.some(x=>/4–10 SHORT/.test(x)),JSON.stringify(d.worked));
  assert.ok(d.failed.some(x=>/ilk 3 LONG/.test(x)),JSON.stringify(d.failed));
  assert.equal(d.current.tier,'TOP3');assert.equal(d.current.LONG[0],8);
  assert.ok(d.symbol&&d.symbol.recent.length>=1);
  assert.ok(JSON.stringify(d).length<3500,'özet boyutu');
  const p=TL.posterior(cards.filter(c=>c.tier==='TOP4_10'));assert.ok(p.mean>0.6&&p.p10<p.mean);
});
test('store.tradeLessons: eski kapanışın katmanı giriş anındaki PLAN adayından bulunur; learningContext taşır',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bh-r254416s-'));
  const st=openStore(root);
  const o=Date.now()-3600e3;
  st.db.prepare('INSERT INTO journal(id,ts,kind,symbol,payload) VALUES(?,?,?,?,?)').run('p1',o-60e3,'PLAN','ABCUSDT',JSON.stringify({candidate:{symbol:'ABCUSDT',attentionSource:'PREV_ATTACK_TOP3',targetSources:['PREV_ATTACK_TOP3']}}));
  st.journal('POSITION_CLOSED','ABCUSDT',{side:'LONG',netPnl:-5,rMultiple:-1,riskQuote:5,initialQuantity:1,exitType:'STOP_LOSS',holdMinutes:4,openedAt:new Date(o).toISOString(),closedAt:new Date(o+4*6e4).toISOString(),eventId:'E1',entryContext:{setupFamily:'FAILED_BREAKOUT'}});
  const tl=st.tradeLessons({symbol:'ABCUSDT'});
  assert.equal(tl.total,1);assert.equal(tl.cards[0].tier,'TOP3');assert.ok(tl.cards[0].tags.includes('LEADER_CHASE_LONG'));
  const lc=st.learningContext({symbol:'ABCUSDT',candidate:{symbol:'ABCUSDT',targetSources:['GAINER_TOP3']}});
  assert.equal(lc.tradeLessons.current.tier,'TOP3');assert.equal(lc.tradeLessons.symbol.trades,1);
});
test('deneyim hafızası: tradeLessons korunur, son çare kırpmada bile başlık satırları kalır',()=>{
  const s=src('jev-decision.js');
  assert.match(s,/tradeLessons:src\.tradeLessons&&typeof src\.tradeLessons==='object'\?src\.tradeLessons:null/);
  assert.match(s,/alwaysOn:true,tradeLessons:out\.tradeLessons/);
  assert.match(s,/out\.tradeLessons=\{version:tl\.version/);
  assert.match(s,/experienceMemory\.tradeLessons is YOUR OWN measured P&L/);
  assert.equal((s.match(/experienceMemory\.tradeLessons is YOUR OWN measured P&L/g)||[]).length,3,'PASS-1, PASS-2, pozisyon yöneticisi');
  assert.match(s,/lessonCard:src\.lessonCard/);assert.match(s,/do not answer OBSERVE_MORE/);
});
test('canlı akış: girişte dikkat katmanı, kapanışta TRADE_LESSON_CARD ve JEV öğretmenine kart; Office rotası',()=>{
  const lc=src('live-controller.js');
  assert.match(lc,/attention:tradeLessonsLib\.attentionFromCandidate\(candidate\)/);
  assert.equal((lc.match(/recordJevShadowLesson\((symbol|sym),\{\.\.\.record,\.\.\.closeLessonContext\((symbol|sym),record\)\}\)/g)||[]).length,2);
  assert.match(lc,/store\.journal\('TRADE_LESSON_CARD'/);
  assert.match(lc,/scanner\.recordPreMoveHits\(/);
  const sv=src('server.js');assert.match(sv,/u\.pathname==='\/learning\/trade-lessons'/);
  assert.match(src('manage.ps1'),/'chart-readout\.js','trade-lessons\.js','case-memory\.js','preentry-microstructure\.js','worker-expertise\.js','free-model-registry\.js'\)/);
});
test('ön-hareket kayıtları 20 dk saklanır, yalnız PRE_MOVE/IGNITION yazılır',()=>{
  const now=Date.now();
  const r=scanner.recordPreMoveHits([{symbol:'AAAUSDT',state:'PRE_MOVE',direction:'SHORT',priority:260},{symbol:'BBBUSDT',state:'WATCH',direction:'LONG',priority:140}],'TEST',now);
  assert.equal(r.recorded,1);
  const h=scanner.readPreMoveHits(now+60e3);assert.equal(h.AAAUSDT.direction,'SHORT');assert.equal(h.BBBUSDT,undefined);
  assert.equal(scanner.readPreMoveHits(now+21*60e3).AAAUSDT,undefined,'20 dk sonra düşer');
  // Tarayıcı saklı imzayı patlamaya-yakın havuzuna alır (merdiven dışı bile olsa).
  const uni=Array.from({length:40},(_,i)=>({symbol:'U'+i+'USDT',quoteVolume:1e9-i,priceChangePercent:i<30?30-i:-1,lastPrice:1,range24hPct:5,volumeRank:i+1}));
  uni.push({symbol:'AAAUSDT',quoteVolume:5e6,priceChangePercent:-2,lastPrice:1,range24hPct:4,volumeRank:120});
  const out=scanner.selectCandidates(uni,{ts:now-6e4,bySymbol:{},lightweight:{},ladder:{}},{available:false,rows:[]},36);
  const a=out.candidates.find(x=>x.symbol==='AAAUSDT');
  assert.ok(a&&a.targetSources.includes('NEAR_EXPLOSION'),'saklı ön-hareket imzası havuzda');assert.equal(a.nearExplosion.direction,'SHORT');
});
test('R2544.16 sürüm kimliği',()=>{
  assert.match(src('server.js'),/const RUNTIME_RELEASE='R2544\.37-CAUSAL-PRICE-ACTION';/);
  assert.match(src('scanner.js'),/const TARGET_DETAIL_LIMIT = 36;/);
});

test('öncelik: ilk10 adayı -> 4-10 -> 11-24 -> erken -> patlamaya yakın -> Top3; legacy komite sırayı geri bozamaz',()=>{
  const AP=require('../attention-priority');
  const committee=require('../leader-committee');
  const mk=(symbol,rank,extra={})=>({symbol,side:'LONG',gainerRank:rank,attackRank:rank,spreadBps:1,tradeQuality:80,directionSupport:1,longExpansionScore:70,...extra});
  const scan={
    ladderApproach:[mk('APPUSDT',12,{gainerRankVelocity:8,projectedGainerRank:7})],
    ladderTop10:[mk('FOURUSDT',4)],
    ladderTop24:[mk('ELEVENUSDT',11,{gainerRankVelocity:3})],
    attentionCandidates:[mk('EARLYUSDT',40)],
    nearExplosionCandidates:[mk('NEARUSDT',80,{nearExplosionScore:99})],
    ladderTop3:[mk('ONEUSDT',1)],
    leaders:[mk('ONEUSDT',1),mk('FOURUSDT',4),mk('ELEVENUSDT',11)]
  };
  const p=AP.selectDeterministicCandidates(scan,12);
  const tiers=p.map(x=>x.priorityTier);
  assert.ok(tiers.indexOf('APPROACH')<tiers.indexOf('TOP4_10'));
  assert.ok(tiers.indexOf('TOP4_10')<tiers.indexOf('TOP11_24'));
  assert.ok(tiers.indexOf('TOP11_24')<tiers.indexOf('EARLY'));
  assert.ok(tiers.indexOf('EARLY')<tiers.indexOf('NEAR_EXPLOSION'));
  assert.ok(tiers.indexOf('NEAR_EXPLOSION')<tiers.indexOf('TOP3'));
  assert.equal(committee.pickCandidate(scan).symbol,'APPUSDT','committee yeni discovery sırasını korur');
  const lc=src('leader-committee.js');
  assert.doesNotMatch(lc,/Öncelik sırası: CURRENT_ATTACK_TOP3/);
  assert.match(lc,/GAINER_TOP3 EN SON/);
});

test('JEV HTTP 403: sağlayıcı nedeni görünür, güvenli 60sn cooldown ağ çağrısı yağmurunu keser',async()=>{
  const {createJevClient}=require('../jev-decision');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bh-r254416-auth-'));
  fs.mkdirSync(path.join(root,'config'),{recursive:true});
  fs.writeFileSync(path.join(root,'config','jev.json'),JSON.stringify({enabled:true,dailyCapUsd:100}));
  let calls=0, now=Date.parse('2026-09-30T07:29:00Z');
  const fetchImpl=async()=>{calls++;return {ok:false,status:403,text:async()=>JSON.stringify({error:{code:'model_access_denied',message:'JEV access forbidden'}})}};
  const jev=createJevClient({root,apiKey:'sk-or-v1-'+'x'.repeat(40),fetchImpl,clock:()=>now});
  const a=await jev.sovereignPass1({candidate:{symbol:'AAAUSDT',side:'LONG'},unified:{dataQuality:{advisoryUsable:true}}});
  assert.equal(a.reason,'JEV_HTTP_ERROR');assert.equal(a.httpStatus,403);assert.equal(calls,1);
  assert.equal(jev.localStatus().provider.lastError.category,'FORBIDDEN');
  assert.equal(jev.localStatus().provider.lastError.code,'model_access_denied');
  const b=await jev.sovereignPass1({candidate:{symbol:'BBBUSDT',side:'SHORT'},unified:{dataQuality:{advisoryUsable:true}}});
  assert.equal(b.reason,'JEV_PROVIDER_AUTH_COOLDOWN');assert.equal(calls,1,'cooldown sırasında yeni ağ çağrısı yok');
  now+=61000;
  await jev.sovereignPass1({candidate:{symbol:'CCCUSDT',side:'LONG'},unified:{dataQuality:{advisoryUsable:true}}});
  assert.equal(calls,2,'cooldown sonrası yeniden denenir');
  const log=fs.readFileSync(path.join(root,'logs','jev-http-error.log'),'utf8');
  assert.match(log,/"providerCategory":"FORBIDDEN"/);assert.match(log,/"providerCode":"model_access_denied"/);
  assert.match(src('office-dashboard/office-server.js'),/JEV_PROVIDER_ACCESS/);
  assert.match(src('office-dashboard/public/office.html'),/ERİŞİM REDDİ HTTP/);
});
