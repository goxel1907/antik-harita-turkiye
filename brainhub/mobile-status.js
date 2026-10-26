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
  const cmOf=a=>{const e=a?.entryCommittee,d=a?.deskInfo?.last;return e||d?{entry:e?{d:e.decision||null,c:e.consensus||null,err:e.error||null,auth:e.authority===true}:null,desk:d?{a:d.action,j:d.judge,auth:d.authority===true,t:String(d.text||'').slice(0,120)}:null}:null;};
  if(t&&typeof t==='object'){
    out.top3={version:t.version,tradingMode:t.tradingMode,switches:t.switches,gate:t.gate,running:t.running,settings:t.settings||null,
      testWindow:pick(t.testWindow,['startedAt','endsAt','elapsedH','remainingMin','done','scans','okScans','signals','entries']),
      active:(t.active||[]).slice(0,12).map(a=>({...pick(a,['symbol','side','rule','signalKind','mode','entryPrice','stopPrice','tpPrice','markPrice','unrealizedPnl','leverage','marginQuote','remainingMin','riskQuote']),part:partOf(a.part),cm:cmOf(a)})),
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
    out.committee={team:(c.team||[]).map(x=>String(x).replace(/^ROUTER:|^FREE:/,'')),healthy:(c.members||[]).filter(m=>m.healthy).length,members:(c.members||[]).length,
      exam:pd.exam?{answered:pd.exam.answered,total:pd.exam.total,finished:pd.exam.finished===true}:null,entry:pd.entryComparison||null};}}
  const z=status.zirve5;
  if(z&&typeof z==='object'&&z.ok!==false){
    const ls=z.lastScan;
    out.zirve5={version:z.version,tradingMode:z.tradingMode,switches:z.switches,partial:z.partial,decisions:z.decisions,gate:z.gate,running:z.running,sizing:z.sizing||null,
      rules:pick(z.rules,['topN','volMult','bodyMin','minStopPct','maxStopPct','maxHoldH']),nextScanAt:z.nextScanAt||null,armedCoins:Array.isArray(z.armed)?z.armed.length:0,
      lastScan:ls?{at:ls.at||null,bar:ls.bar||null,signals:ls.signals??null,armed:ls.armed??null,errors:(ls.errors||[]).slice(0,3),
        top:(ls.top||[]).slice(0,5).map(r=>({symbol:r.symbol,rank:r.rank,zones:Array.isArray(r.zones)?r.zones.length:(r.zones??null),signals:(r.signals||[]).map(g=>({side:g.side,mtf:g.mtf||null}))}))}:null,
      active:(z.active||[]).slice(0,8).map(a=>({...pick(a,['symbol','side','entryPrice','stopPrice','tpPrice','stopPct','targetR','markPrice','unrealizedPnl','leverage','marginQuote','remainingMin']),part:partOf(a.part),mtf:a.mtf||null,cm:cmOf(a)})),
      recent:(z.recentEntries||[]).slice(0,6).map(x=>pick(x,['at','symbol','side','opened','reason','rank'])),
      results:z.results?{test:z.results.test||null,live:z.results.live||null}:null,learning:z.learning||null};
  }
  // R2544.78 (user 23.10: "apk'da marj ve kaldıraç ayarı, güncel bakiye durumu da olmalı"): the account of the current mode
  // (TEST: the paper account, LIVE: Binance) - wallet, free, equity, open PnL
  const ac=status.account;
  if(ac&&typeof ac==='object')out.account=ac.ok===true?{ok:true,walletBalance:ac.walletBalance,availableBalance:ac.availableBalance,equity:ac.equity,unrealizedPnl:ac.unrealizedPnl,openPositions:ac.openPositions,asOf:ac.asOf}
    :{ok:false,reason:String((ac.reasons||[])[0]||'ACCOUNT_UNREADABLE').slice(0,80)};
  out.compact=true;out.mobileContract='R2544.78_PC_STATUS';return out;
}
module.exports={mobileStatus};
