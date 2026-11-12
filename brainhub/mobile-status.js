'use strict';
// Android consumes status, decisions and counters, not immutable market dossiers.
// The full endpoint remains available to Office and audit tools.
const DOSSIERS=new Set(['unified','unifiedContext','jevSeen','coreMarketPacket','marketSignature','entryCase','entryContext','entryContextRaw','caseMemory','caseMemoryByLane','frameSnapshot','marketPacket','rawSnapshot','chartOverlayLevels','timeframes','frames','geometry','chartReadingByTf','chartNarratives']);
function project(value){
  if(Array.isArray(value))return value.slice(0,24).map(project);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!DOSSIERS.has(key)).map(([key,v])=>[key,project(v)]));
}
function mobileStatus(status={}){
  const out=project(status);
  if(out.learning){
    const src=status.learning;
    out.learning=Object.fromEntries(['source','lifetime','stats','measuredSampleCount','recentMeasuredDetailCount','jevLessonCount','recentJevLessonCount','jevLessonTotalCount','changesAppliedToHardRisk','rMeasurementPolicy','note'].filter(k=>src[k]!==undefined).map(k=>[k,project(src[k])]));
  }
  // R2544.57: İlk 3 Avcısı for the APK (no lessons text, no scan dumps)
  const t=status.top3;
  const pick=(o,ks)=>o&&typeof o==='object'?Object.fromEntries(ks.filter(k=>o[k]!==undefined).map(k=>[k,o[k]])):null;
  // R2544.76: the kâr koruma state of a lot (level, share, taken, rest at break-even)
  const partOf=p=>p&&typeof p==='object'?(p.skipped?{skipped:p.skipped}:pick(p,['atR','share','price','done','beDone'])):null;
  // R2544.89 kurul: giriş kararı (GİR/GİRME, mutabakat) ve masanın son kararı (yetkili mi)
  // R2544.98 (kullanıcı 28.10: "apk da modellerin toplu halde mutabık kararını da göster"): mutabakat türü ve model oyları da gider
  const vOf=a=>(Array.isArray(a)?a:[]).slice(0,5).map(v=>({m:String(v.m||'').replace(/:free$/,'').split('/').pop().slice(0,28),d:v.d||v.a||null}));
  const cmOf=a=>{const e=a?.entryCommittee,d=a?.deskInfo?.last;return e||d?{entry:e?{d:e.decision||null,cd:e.committeeDecision||null,ag:e.agreed===true,c:e.consensus||null,err:e.error||null,auth:e.authority===true,v:vOf(e.votes)}:null,
    desk:d?{a:d.action,j:d.judge,auth:d.authority===true,c:d.committee?.consensus||null,v:vOf(d.committee?.votes),t:String(d.text||'').slice(0,120),
      // R2544.129 (kullanıcı 04.11 "APK'yı ver"): what happened to the command - done / failed / noise guard / on its way
      f:d.action==='HOLD'?null:d.done?{ok:d.done.ok===true,at:d.done.at||null,px:d.done.price??null,why:d.done.reason||null}:d.guard?{guard:true,min:d.guard.openMin??null,R:d.guard.R??null}:a?.deskInfo?.pending?{pending:true}:null}:null}:null;};
  // R2544.129: the live R of a lot from its minute path (R from the entry stop) and the best R so far
  const rOf=a=>{const lp=Array.isArray(a?.livePath)?a.livePath:[];return lp.length?{R:lp[lp.length-1][1],best:Math.max(...lp.map(p=>p[1]))}:null;};
  if(t&&typeof t==='object'){
    out.top3={version:t.version,tradingMode:t.tradingMode,switches:t.switches,gate:t.gate,running:t.running,settings:t.settings||null,
      testWindow:pick(t.testWindow,['startedAt','endsAt','elapsedH','remainingMin','done','scans','okScans','signals','entries']),
      active:(t.active||[]).slice(0,12).map(a=>({...pick(a,['id','symbol','side','rule','signalKind','mode','entryPrice','stopPrice','tpPrice','markPrice','unrealizedPnl','leverage','leverageBy','marginQuote','remainingMin','riskQuote']),part:partOf(a.part),cm:cmOf(a),r:rOf(a)})),
      lastScan:t.lastScan?{at:t.lastScan.at,candle:t.lastScan.candle,ranked:t.lastScan.ranked,signals:(t.lastScan.signals||[]).slice(0,8).map(x=>({symbol:x.symbol,side:x.side,kind:x.kind||null})),errors:(t.lastScan.errors||[]).slice(0,3)}:null,
      // R2544.58 v2: rules version, risk per trade and the last 5m pass for the phone
      rules:t.rules?{rulesVersion:t.rules.rulesVersion??1,riskPct:t.rules.riskPct??null}:null,
      lastScan5:t.lastScan5?{at:t.lastScan5.at,bar:t.lastScan5.bar,candidates:t.lastScan5.candidates||null,checked:t.lastScan5.checked,
        signals:(t.lastScan5.signals||[]).slice(0,8).map(x=>({symbol:x.symbol,side:x.side,rule:x.rule})),
        waiting:(t.lastScan5.nearMisses||[]).slice(0,6).map(x=>({symbol:x.symbol,side:x.side,reason:x.reason})),errors:(t.lastScan5.errors||[]).slice(0,3)}:null,
      results:t.results||null,windowResults:t.windowResults||null,
      learning:t.learning?{lessons:t.learning.lessons,groups:(t.learning.groups||[]).slice(0,8)}:null};
  }
  // R2544.76 ZİRVE-5 for the APK (user 23.10: "APK'yı da güncelle, canlıya geçtiğimizde sorun olmasın"): switches, size, kâr koruma,
  // open lots, the last scan, the latest decisions with their reasons, results - no zone dumps, no lessons text
  // R2544.89 kurul özeti (telefon kurul masası ve sınav ilerlemesi)
  {const pd=status.top3?.positionDesk||status.zirve5?.positionDesk;if(pd&&pd.committee){const c=pd.committee;
    out.committee={team:(c.team||[]).map(x=>String(x).replace(/^ROUTER:|^FREE:|^OR:/,'').replace(/:free$/,'')),healthy:(c.members||[]).filter(m=>m.healthy).length,members:(c.members||[]).length,
      exam:pd.exam?{answered:pd.exam.answered,total:pd.exam.total,finished:pd.exam.finished===true}:null,entry:pd.entryComparison||null,
      // R2544.103 (kullanıcı 02.11: "modellerin çalıştığına emin ol ... net göster"): her model ve durumu (OK / YOĞUN / KOTA / HASTA)
      models:(pd.cmBoard?.rows||[]).slice(0,24).map(r=>({m:String(r.key||r.id||'').replace(/^ROUTER:|^FREE:|^OR:/,'').replace(/:free$/,'').split('/').pop().slice(0,28),st:r.healthy?'OK':r.quota?(r.quota.kind==='RATE'?'BUSY':'QUOTA'):'SICK',t:r.inTeam===true,why:r.healthy?null:String(r.lastError||'').replace(/\s+/g,' ').slice(0,40)})),
      recent:(pd.cmRecent||[]).slice(0,6).map(x=>({at:x.at,s:String(x.symbol||'').replace(/USDT$/,''),side:x.side,d:x.d,ag:x.ag===true,c:x.c,b:x.blocked===true,v:vOf(x.v)}))};}}
  const z=status.zirve5;
  if(z&&typeof z==='object'&&z.ok!==false){
    const ls=z.lastScan;
    out.zirve5={version:z.version,tradingMode:z.tradingMode,switches:z.switches,partial:z.partial,decisions:z.decisions,gate:z.gate,running:z.running,sizing:z.sizing||null,
      rules:pick(z.rules,['topN','volMult','bodyMin','minStopPct','maxStopPct','maxHoldH']),nextScanAt:z.nextScanAt||null,armedCoins:Array.isArray(z.armed)?z.armed.length:0,
      lastScan:ls?{at:ls.at||null,bar:ls.bar||null,signals:ls.signals??null,armed:ls.armed??null,errors:(ls.errors||[]).slice(0,3),
        top:(ls.top||[]).slice(0,5).map(r=>({symbol:r.symbol,rank:r.rank,zones:Array.isArray(r.zones)?r.zones.length:(r.zones??null),signals:(r.signals||[]).map(g=>({side:g.side,mtf:g.mtf||null}))}))}:null,
      active:(z.active||[]).slice(0,8).map(a=>({...pick(a,['id','symbol','side','entryPrice','stopPrice','tpPrice','stopPct','targetR','markPrice','unrealizedPnl','leverage','leverageBy','marginQuote','remainingMin']),part:partOf(a.part),mtf:a.mtf||null,cm:cmOf(a),r:rOf(a)})),
      recent:(z.recentEntries||[]).slice(0,6).map(x=>pick(x,['at','symbol','side','opened','reason','rank'])),
      results:z.results?{test:z.results.test||null,live:z.results.live||null}:null,learning:z.learning||null};
  }
  // R2544.78 (user 23.10: "apk'da marj ve kaldıraç ayarı, güncel bakiye durumu da olmalı"): the account of the current mode
  // (TEST: the paper account, LIVE: Binance) - wallet, free, equity, open PnL
  const ac=status.account;
  if(ac&&typeof ac==='object')out.account=ac.ok===true?{ok:true,walletBalance:ac.walletBalance,availableBalance:ac.availableBalance,equity:ac.equity,unrealizedPnl:ac.unrealizedPnl,openPositions:ac.openPositions,asOf:ac.asOf}
    :{ok:false,reason:String((ac.reasons||[])[0]||'ACCOUNT_UNREADABLE').slice(0,80)};
  // R2544.129 kâr / zarar (the account ledger; virtual TEST top-ups apart), the brain's last recall + report card, the funnel counts
  const pl=status.top3?.pnl;
  if(pl&&pl.totals){const T=x=>x?{net:x.net,n:x.trades,w:x.wins,R:x.R??null,fee:x.fees}:null;
    out.pnl={mode:pl.mode,at:pl.readAt||null,err:pl.error||null,today:T(pl.totals.today),h24:T(pl.totals.last24h),week:T(pl.totals.week),d30:T(pl.totals.last30d),all:T(pl.totals.all),
      cash:pl.cash?{total:pl.cash.total,n:pl.cash.n}:null,days:(pl.days||[]).slice(-7).map(d=>[d.label,d.net])};}
  const br=status.top3?.brain;
  if(br){const L=br.last,S=br.score,B=S?(S.live&&S.live.n?S.live:S.back):null;
    out.brain={last:L?{s:String(L.symbol||'').replace(/USDT$/,''),side:L.side||null,st:L.status||null,lean:L.lean||null,txt:String(L.sentence||'').slice(0,140),R:L.R??null,hit:L.hit??null,replay:L.replay===true,
      cases:(L.cases||[]).slice(0,5).map(c=>({s:String(c.symbol||'').replace(/USDT$/,''),side:c.side||null,R:c.R,why:String(c.why||'').slice(0,60)}))}:null,
      score:B?{src:S.live&&S.live.n?'live':'back',n:B.n,hit:B.hitPct,neg:S.alwaysNegPct??null,pos:B.olumlu?.avgR??null,negR:B.olumsuz?.avgR??null}:null,lessons:S?.lessons??null};}
  const fu=status.top3?.funnel;
  if(fu)out.funnel={n:fu.signals,opened:fu.opened,blocked:fu.ruleBlocked,skip:fu.committeeSkip,none:fu.noResult,reasons:fu.reasons||{},
    rows:(fu.rows||[]).slice(0,6).map(r=>({at:r.at,l:r.lane,s:String(r.symbol||'').replace(/USDT$/,''),side:r.side,f:r.fate,why:r.reason||null}))};
  // R2544.148 KEŞİF for the phone: the switch, the brain's matrix progress, the last round's forecasts and the top of the karne
  const ks=status.kesif;
  if(ks&&ks.ok!==false){const mx=ks.matrix||{total:{n:0}},lr=(ks.rounds||[])[0],nm=m=>m==='BEYIN'?'BEYİN':m==='ORTAK'?'ORTAK':String(m||'').replace(/:free$/,'').split('/').pop().slice(0,24);
    out.kesif={on:ks.enabled===true,min:ks.cadenceMin,at:ks.lastRoundAt||null,err:ks.lastError||null,mx:{n:mx.total?.n||0,need:mx.minRounds||20,up:mx.total?.UP||0,dn:mx.total?.DOWN||0,fl:mx.total?.FLAT||0,f:mx.formations||0},
      last:lr?{s:String(lr.symbol||'').replace(/USDT$/,''),why:lr.why||null,a:lr.answered,q:lr.asked,b:lr.brain?{ready:lr.brain.ready===true,p:lr.brain.pUp??null}:null,
        f:(lr.forecasts||[]).slice(0,12).map(x=>({m:nm(x.m),d:x.d,s:x.s,g:x.g,h:x.h}))}:null,
      karne:(ks.karne?.rows||[]).slice(0,12).map(r=>({m:nm(r.model),n:r.n,hit:r.hitPct,R:r.avgR,x:r.exBestAvgR,st:r.state})),
      bk:ks.readiness?{st:ks.readiness.state,t:ks.readiness.tr,who:(ks.readiness.ready||[]).slice(0,3).map(r=>({m:nm(r.model),n:r.n,R:r.avgR,r1:r.oneR?.medianUsd??null,ws:r.worstLosingStreak}))}:null,
      ogr:ks.learning?{st:ks.learning.state,t:ks.learning.tr,n:ks.learning.all?.n||0}:null,
      ogr2:ks.learning2?{st:ks.learning2.state,t:ks.learning2.tr,n:ks.learning2.all?.n||0}:null,suru:ks.herd?.avg??null,soz:ks.soz?{e:ks.soz.enabled===true,g:ks.soz.goxelExit===true,h:(ks.soz.holders||[]).length,a:(ks.soz.active||[]).length,r:(ks.soz.recent||[])[0]?{s:ks.soz.recent[0].symbol,d:ks.soz.recent[0].side,o:ks.soz.recent[0].opened===true,w:ks.soz.recent[0].reason||null}:null}:null,
      iz:ks.iz?{at:ks.iz.last?.at||null,c:ks.iz.last?.coins??0,o:ks.iz.open??0,f:(ks.iz.last?.fired||[]).slice(0,8).map(x=>({d:x.d,s:String(x.s||'').replace(/USDT$/,''),side:x.side,st:x.stop}))}:null};}
  out.compact=true;out.mobileContract='R2544.78_PC_STATUS';out.mobileFeatures='R2544.160';return out;
}
module.exports={mobileStatus};
