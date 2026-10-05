'use strict';

const crypto=require('node:crypto');

function finite(v){if(v===null||v===undefined||(typeof v==='string'&&!v.trim()))return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp(v,lo=0,hi=1){return Math.max(lo,Math.min(hi,Number(v)||0));}
function sideSign(side){return String(side||'').toUpperCase()==='SHORT'?-1:1;}
function id(prefix='burst'){return prefix+'_'+crypto.randomBytes(8).toString('hex');}
function ratioFor(flow,side){return finite(side==='SHORT'?flow?.sellRatio:flow?.buyRatio);}
function signedFor(v,side){const n=finite(v);return n===null?null:n*sideSign(side);}
function totalQuote(flow){const a=finite(flow?.buyQuote)||0,b=finite(flow?.sellQuote)||0;return a+b;}

// R2544.46 (user rule 05.10.2026: burst must actually trade, thin coins included).
// The R2544.29 trigger read fixed 1s/3s windows with fixed bps scales and vetoed on ANY missing
// component; on altcoins the 1s window is usually empty, so in 118 live watch samples the best
// score was 0.80 against a 0.82 floor and the burst never fired. Now:
// - flow windows run on a trade clock (fast >=20 trades, slow >=60 trades; market.js tradeClock),
// - price moves are measured in the coin's own typical 20-trade move (noiseBps20), not fixed bps,
// - trade intensity is compared to the coin's own 120 s baseline,
// - a missing optional component (OFI, L2 depth) is neutral: its weight is dropped, never a veto,
// - only genuinely thin flow (<8 fast / <12 slow trades within 15 s / 45 s) is TRIGGER_WINDOW_INCOMPLETE.
const BURST_TRIGGER_VERSION='R2544.46';
const BURST_WEIGHTS={rFast:0.18,rSlow:0.16,zFast:0.14,zSlow:0.10,intensity:0.10,ofiFast:0.08,ofiSlow:0.06,queue:0.04,micro:0.03,l2Ofi:0.03,depth:0.02};
// Pre-move bonus is equal for PRE_MOVE and IGNITION: the thresholds below were calibrated with 0.10, and a larger
// IGNITION bonus would silently lower the bar by 0.08 (most live candidates are IGNITION).
const BURST_BASE_SCALE=0.82, BURST_PREMOVE_BONUS={IGNITION:0.10,PRE_MOVE:0.10};
// JEV picks one of these trigger levels at pre-authorization. Calibration 05.10.2026 20:42-20:56, 17 active coins,
// 4908 samples, live public stream, burst stop/fast-fail rules, 0.10% fees: >=0.74 avg net -0.04% (n=10),
// >=0.78 +0.04% (n=5), >=0.82 +0.14% (n=4), >=0.86 +0.98% (n=1). Small sample; floor 0.78, default 0.82.
const BURST_STRICTNESS={TRIGGER_STANDARD:0.78,TRIGGER_STRICT:0.82,TRIGGER_VERY_STRICT:0.86};
const BURST_PAUSE_EXCEPTION_MIN=0.90;
const BURST_TTL_MS={TTL_120S:120000,TTL_180S:180000};
function burstClockWindows(snapshot){
  const tc=snapshot?.orderFlow?.tradeClock,ec=snapshot?.level1Ofi?.eventClock;
  if(tc&&typeof tc==='object')return {clock:'TRADES',fast:tc.fast||{},slow:tc.slow||{},noiseBps:finite(tc.noiseBps20),intensity:finite(tc.intensityRatio),ofiFast:ec?.fast||{},ofiSlow:ec?.slow||{}};
  // Legacy snapshot (no trade clock): 1s/3s windows, fixed bps scale, quote acceleration as intensity.
  const w=snapshot?.orderFlow?.windows||{},o=snapshot?.level1Ofi?.windows||{};
  const tq1=totalQuote(w['1s']),tq3=totalQuote(w['3s']);
  return {clock:'LEGACY_1S_3S',fast:w['1s']||{},slow:w['3s']||{},noiseBps:null,intensity:tq3>0?tq1/(tq3/3):null,ofiFast:o['1s']||{},ofiSlow:o['3s']||{}};
}
function burstEvidence(snapshot,side,{preMove=null}={}){
  side=String(side||'').toUpperCase();
  const win=burstClockWindows(snapshot),f1=win.fast,f3=win.slow,o1=win.ofiFast,o3=win.ofiSlow;
  const l2=snapshot?.localL2||{};
  const r1=ratioFor(f1,side),r3=ratioFor(f3,side);
  const p1=signedFor(f1?.priceMoveBps,side),p3=signedFor(f3?.priceMoveBps,side);
  // Move in units of the coin's typical 20-trade move; a slow window of n trades scales by sqrt(n/20).
  const unit=n=>win.noiseBps>0?win.noiseBps*Math.sqrt(Math.max(1,(finite(n)||20))/20):null;
  // Without a noise estimate the R2544.29 scale is kept: full credit at 5 bps (fast) / 10 bps (slow).
  const z1=p1===null?null:unit(f1?.trades)?p1/unit(f1.trades):p1/2;
  const z3=p3===null?null:unit(f3?.trades)?p3/unit(f3.trades):p3*0.3;
  const ofi1=o1?.available===false?null:signedFor(o1?.normalizedOfi,side),ofi3=o3?.available===false?null:signedFor(o3?.normalizedOfi,side);
  const q=o1?.available===false?null:signedFor(o1?.queueImbalanceCurrent,side),micro=o1?.available===false?null:signedFor(o1?.micropriceBps,side);
  const ml=signedFor(l2?.multiLevelOfi,side),depth=signedFor(l2?.depthImbalance,side);
  const spread=finite(snapshot?.spreadBps);
  const pmDir=String(preMove?.direction||'').toUpperCase(), pmState=String(preMove?.state||'').toUpperCase();
  const pmMatch=pmDir===side&&['PRE_MOVE','IGNITION'].includes(pmState);
  const l2Healthy=l2?.available===true&&l2?.sequenceHealthy===true&&finite(l2?.confidence)!==null&&Number(l2.confidence)>=0.55;
  const fresh=snapshot?.available===true&&finite(snapshot?.ageMs)!==null&&Number(snapshot.ageMs)<=2500;

  const parts={
    rFast:r1===null?null:clamp((r1-0.50)/0.25), rSlow:r3===null?null:clamp((r3-0.50)/0.20),
    zFast:z1===null?null:clamp(z1/2.5), zSlow:z3===null?null:clamp(z3/3),
    intensity:win.intensity===null?null:clamp((win.intensity-1)/2),
    ofiFast:ofi1===null?null:clamp((ofi1+0.05)/0.65), ofiSlow:ofi3===null?null:clamp((ofi3+0.05)/0.65),
    queue:q===null?null:clamp((q+0.05)/0.55), micro:micro===null?null:clamp((micro+0.02)/0.9),
    l2Ofi:ml===null?null:clamp((ml+0.05)/0.65), depth:depth===null?null:clamp((depth+0.05)/0.65)
  };
  let wSum=0,acc=0;for(const [k,w] of Object.entries(BURST_WEIGHTS))if(parts[k]!==null){wSum+=w;acc+=w*parts[k];}
  const coreReady=parts.rFast!==null&&parts.rSlow!==null&&parts.zFast!==null&&parts.zSlow!==null;
  const base=wSum>0&&coreReady?acc/wSum:0;
  const score=clamp(BURST_BASE_SCALE*base+(pmMatch?BURST_PREMOVE_BONUS[pmState]:0));

  // Thin flow: trade clock needs >=8 fast / >=12 slow trades (within 15 s / 45 s); legacy 3s keeps its old >=2.
  const n1=finite(f1?.trades),n3=finite(f3?.trades);
  const thin=win.clock==='TRADES'?((n1??0)<8||(n3??0)<12):(n3!==null&&n3<2);
  const contradictions=[];
  if(!fresh)contradictions.push('STREAM_STALE');
  if(!(spread!==null&&spread>=0&&spread<=8))contradictions.push('SPREAD_TOO_WIDE_OR_UNKNOWN');
  if(!l2Healthy)contradictions.push('LOCAL_L2_NOT_HEALTHY');
  if(!coreReady||thin)contradictions.push('TRIGGER_WINDOW_INCOMPLETE');
  if(r1!==null&&r1<0.55)contradictions.push('1S_FLOW_NOT_DIRECTIONAL');
  if(r3!==null&&r3<0.55)contradictions.push('3S_FLOW_NOT_DIRECTIONAL');
  if(z3!==null&&z3<-0.5)contradictions.push('3S_PRICE_AGAINST_SIDE');
  if(ofi3!==null&&ofi3<-0.12)contradictions.push('L1_OFI_AGAINST_SIDE');
  if(ml!==null&&ml<-0.18)contradictions.push('L2_OFI_AGAINST_SIDE');

  const ignition=score>=0.90&&contradictions.length===0&&pmMatch;
  const strong=score>=0.82&&contradictions.filter(x=>!['1S_FLOW_NOT_DIRECTIONAL'].includes(x)).length===0;
  const r4=x=>x===null?null:Number(x.toFixed(4));
  return {version:BURST_TRIGGER_VERSION,clock:win.clock,side,score:Number(score.toFixed(4)),base:r4(base),ignition,strong,fresh,spreadBps:spread,acceleration:win.intensity===null?null:Number(win.intensity.toFixed(3)),
    moveUnits:{fast:r4(z1),slow:r4(z3),noiseBps20:win.noiseBps},parts:Object.fromEntries(Object.entries(parts).map(([k,v])=>[k,r4(v)])),
    preMove:{state:pmState||null,direction:pmDir||null,match:pmMatch},flow:{oneSec:f1,threeSec:f3},l1:{oneSec:o1,threeSec:o3},localL2:{available:l2?.available===true,sequenceHealthy:l2?.sequenceHealthy===true,confidence:finite(l2?.confidence),multiLevelOfi:finite(l2?.multiLevelOfi),depthImbalance:finite(l2?.depthImbalance)},contradictions};
}

// R2544.49 scalper entry (user 06.10.2026: "trade it the way a scalper does"; research in Claud-Work raporlar
// 2026-10-06-vurkac-scalper-tasarimi.md). The trade-clock burst is the IMPULSE, never the entry: R46/R47 bought the
// tip (5 of 6 live bursts lost, 4 never went green). A scalper waits for the first shallow pullback with weak
// opposite aggression, enters when the move resumes, and puts the stop where the read fails (beyond the pullback
// extreme). No pullback in time = no trade (no chasing).
const PULLBACK_RULES={minRetrace:0.20,maxRetrace:0.62,resumeFrac:0.30,maxOppositeRatio:0.60,minSideRatioResume:0.55,
  impulseMaxWaitMs:90000,pullbackMaxMs:120000,minStopPct:0.15,maxStopPct:0.60,stopBufferUnits:0.25};
const HARD_DATA_CONTRADICTIONS=['STREAM_STALE','SPREAD_TOO_WIDE_OR_UNKNOWN','LOCAL_L2_NOT_HEALTHY'];
function midOf(s){const b=finite(s?.bid),a=finite(s?.ask);return b>0&&a>0?(a+b)/2:null;}
class PullbackEntry{
  constructor({side,rules={}}={}){this.side=String(side||'').toUpperCase();this.sg=sideSign(this.side);this.r={...PULLBACK_RULES,...rules};this.state='WATCH';this.impulse=null;this.lastReset=null;this.impulses=0;}
  reset(reason){this.state='WATCH';this.impulse=null;this.lastReset=reason;return {state:'WATCH',reason};}
  // evidence = burstEvidence(snapshot, side, {preMove}); impulse = evidence clears the armed threshold with no contradiction.
  step({snapshot,evidence,threshold,now}){
    const mid=midOf(snapshot),sg=this.sg,signed=x=>x*sg;
    if(mid===null||!evidence)return {state:this.state,reason:'NO_PRICE_OR_EVIDENCE'};
    const hard=(evidence.contradictions||[]).filter(x=>HARD_DATA_CONTRADICTIONS.includes(x));
    if(this.state==='WATCH'){
      if(!(evidence.score>=threshold)||(evidence.contradictions||[]).length)return {state:'WATCH'};
      if(evidence.preMove?.match!==true)return {state:'WATCH',reason:'PREMOVE_NOT_ALIGNED'};
      if(!(finite(evidence.moveUnits?.noiseBps20)>0))return {state:'WATCH',reason:'COIN_UNIT_NOT_READY'};
      const slow=finite(evidence.flow?.threeSec?.priceMoveBps);
      if(!(slow!==null&&signed(slow)>0))return {state:'WATCH',reason:'NO_IMPULSE_LEG'};
      this.impulse={at:now,legStart:mid/(1+slow/10000),extreme:mid,pullbackExtreme:null,pullbackAt:null,score:evidence.score};
      this.state='IMPULSE';this.impulses++;return {state:'IMPULSE'};
    }
    const im=this.impulse;
    if(signed(mid)>signed(im.extreme)){im.extreme=mid;im.pullbackExtreme=null;im.pullbackAt=null;this.state='IMPULSE';}
    const leg=signed(im.extreme)-signed(im.legStart);
    if(!(leg>0))return this.reset('LEG_INVALID');
    const retrace=(signed(im.extreme)-signed(mid))/leg;
    if(retrace>this.r.maxRetrace)return this.reset('PULLBACK_TOO_DEEP');
    if(this.state==='IMPULSE'){
      if(now-im.at>this.r.impulseMaxWaitMs)return this.reset('NO_PULLBACK_IN_TIME');
      if(retrace>=this.r.minRetrace){this.state='PULLBACK';im.pullbackAt=now;im.pullbackExtreme=mid;}
      return {state:this.state,retrace:Number(retrace.toFixed(3))};
    }
    if(now-im.pullbackAt>this.r.pullbackMaxMs)return this.reset('PULLBACK_STALLED');
    if(signed(mid)<signed(im.pullbackExtreme))im.pullbackExtreme=mid;
    const depth=signed(im.extreme)-signed(im.pullbackExtreme),bounce=signed(mid)-signed(im.pullbackExtreme);
    const fast=evidence.flow?.oneSec||{},sideRatio=ratioFor(fast,this.side),oppRatio=ratioFor(fast,this.side==='LONG'?'SHORT':'LONG');
    const base={state:'PULLBACK',retrace:Number(retrace.toFixed(3)),bounceFrac:depth>0?Number((bounce/depth).toFixed(3)):0};
    if(hard.length)return {...base,reason:hard[0]};
    if(oppRatio!==null&&oppRatio>this.r.maxOppositeRatio)return {...base,reason:'OPPOSITE_AGGRESSION'};
    if(!(depth>0&&bounce>=this.r.resumeFrac*depth&&(sideRatio??0)>=this.r.minSideRatioResume))return base;
    const unit=finite(evidence.moveUnits?.noiseBps20),spread=finite(snapshot?.spreadBps)||0;
    const bufBps=Math.max(spread,unit>0?unit*this.r.stopBufferUnits:2);
    const entryPx=this.side==='LONG'?finite(snapshot.ask):finite(snapshot.bid);
    const stopPx=im.pullbackExtreme*(1-sg*bufBps/10000);
    const structuralStopPct=Math.abs(entryPx-stopPx)/entryPx*100;
    if(structuralStopPct>this.r.maxStopPct)return this.reset('STRUCTURAL_STOP_TOO_WIDE');
    this.state='ENTER';
    return {state:'ENTER',entry:{side:this.side,price:entryPx,stopPrice:stopPx,stopPct:Number(Math.max(this.r.minStopPct,structuralStopPct).toFixed(4)),structuralStopPct:Number(structuralStopPct.toFixed(4)),
      pullbackExtreme:im.pullbackExtreme,impulseExtreme:im.extreme,legStart:im.legStart,retraceAtEntry:Number(retrace.toFixed(3)),impulseScore:im.score,impulseAgeMs:now-im.at}};
  }
}

// R43 (user rule 05.10.2026): no fixed burst margin. Flat account -> half of the panel margin;
// with an open position -> half of the remaining free margin. Leverage is chosen separately (maximum safe).
function burstMarginRule({flat,panelMarginQuote,availableBalance}={}){
  const panel=finite(panelMarginQuote),avail=finite(availableBalance);
  if(flat){
    const m=panel!==null&&panel>0?panel*0.5:null;
    if(m===null||avail===null||avail<m)return {ok:false,reason:'BURST_PANEL_MARGIN_UNAVAILABLE'};
    return {ok:true,marginQuote:m,rule:'FLAT_HALF_PANEL_MARGIN'};
  }
  const m=avail!==null&&avail>0?avail*0.5:0;
  return m>0?{ok:true,marginQuote:m,rule:'IN_POSITION_HALF_FREE_MARGIN'}:{ok:false,reason:'BURST_MARGIN_UNAVAILABLE'};
}
function exitEvidence(snapshot,active,now=Date.now()){
  const side=String(active?.side||'').toUpperCase(),opp=side==='LONG'?'SHORT':'LONG';
  const adverse=burstEvidence(snapshot,opp,{preMove:null});
  const livePrice=finite(snapshot?.bid)&&finite(snapshot?.ask)?(Number(snapshot.bid)+Number(snapshot.ask))/2:null;
  const entry=finite(active?.entryPrice),stop=finite(active?.stopPrice);
  const oneR=entry!==null&&stop!==null?Math.abs(entry-stop):null;
  const progress=livePrice!==null&&entry!==null&&oneR>0?((livePrice-entry)*sideSign(side)/oneR):null;
  const mfe=Math.max(finite(active?.mfeR)||0,finite(progress)||0), mae=Math.min(finite(active?.maeR)||0,finite(progress)||0);
  const giveback=mfe>0&&progress!==null?mfe-progress:0;
  let reason=null,reviewReason=null;
  if(progress!==null&&progress<=-0.45)reason='BURST_FAST_FAIL';
  else if(Number(active?.openedAt)>0&&now-Number(active.openedAt)>=120000){
    // R43 (user rule 05.10.2026): exits belong to JEV, no fixed target. After 120 s the burst continues only
    // while it is in profit and JEV's latest review (<=10 s old) is HOLD. Exchange stop and fast-fail stay;
    // absolute ceiling 10 minutes.
    const j=active?.jevExitDecision,jAt=Number(j?.receivedAt||j?.at||0);
    const jevHold=j?.action==='HOLD'&&jAt>0&&now-jAt<=10000&&progress!==null&&progress>0;
    if(!jevHold||now-Number(active.openedAt)>=600000)reason='BURST_TIME_EXIT';
  }
  // R2544.46: adverse evidence carries no pre-move bonus, so the reversal review reads the 0-1 base
  // (>=0.90 ~ the old 0.82 of a 0.86 maximum). This only asks JEV to review; it never exits by itself.
  if((adverse.base??0)>=0.90&&adverse.fresh&&!adverse.contradictions.includes('TRIGGER_WINDOW_INCOMPLETE'))reviewReason='BURST_FLOW_REVERSAL';
  else if(mfe>=0.55&&giveback>=Math.max(0.22,mfe*0.35))reviewReason='BURST_MFE_GIVEBACK';
  return {exit:!!reason,reason,reviewReason,progressR:progress===null?null:Number(progress.toFixed(4)),mfeR:Number(mfe.toFixed(4)),maeR:Number(mae.toFixed(4)),givebackR:Number(giveback.toFixed(4)),adverse};
}

class BurstScalpManager{
  constructor({marketStream,now=()=>Date.now(),maxArmed=4,maxActive=1,onEvent=()=>{}}={}){this.marketStream=marketStream;this.now=now;this.maxArmed=maxArmed;this.maxActive=maxActive;this.onEvent=onEvent;this.armed=new Map();this.active=new Map();this.history=[];this.pauseExceptionConsumedFor=null;}
  arm(auth){const symbol=String(auth?.symbol||'').toUpperCase(),side=String(auth?.side||'').toUpperCase();if(!/^[A-Z0-9]{1,28}USDT$/.test(symbol)||!['LONG','SHORT'].includes(side))return {ok:false,reason:'BURST_AUTH_INVALID'};const now=this.now(),ttl=Math.max(BURST_TTL_MS.TTL_120S,Math.min(BURST_TTL_MS.TTL_180S,Number(auth?.ttlMs)||BURST_TTL_MS.TTL_120S));
    if(!this.armed.has(symbol)&&this.armed.size>=this.maxArmed){const victim=[...this.armed.values()].sort((a,b)=>a.expiresAt-b.expiresAt)[0];if(victim)this.armed.delete(victim.symbol);}
    const row={authorizationId:String(auth.authorizationId||id('bauth')),symbol,side,armedAt:now,expiresAt:now+ttl,preMove:auth.preMove||null,jevReason:String(auth.jevReason||'').slice(0,300),pauseExceptionAllowed:auth.pauseExceptionAllowed===true,leverageMode:String(auth.leverageMode||'MAX_SAFE'),triggerThreshold:Math.max(BURST_STRICTNESS.TRIGGER_STANDARD,Math.min(0.98,Number(auth.triggerThreshold)||BURST_STRICTNESS.TRIGGER_STRICT)),source:'JEV_PREAUTHORIZED',authority:'JEV_FINAL_CONDITIONAL'};
    this.armed.set(symbol,row);this.marketStream?.ensureSymbol?.(symbol);this.marketStream?.ensureLocalL2?.(symbol,{priority:'BURST',leaseMs:ttl+1000});this._event('ARM',row);return {ok:true,authorization:row};}
  disarm(symbol,reason='EXPIRED'){symbol=String(symbol||'').toUpperCase();const row=this.armed.get(symbol);if(row){this.armed.delete(symbol);this._event('DISARM',{symbol,reason,authorizationId:row.authorizationId});}return !!row;}
  cleanup(){const now=this.now();for(const [s,a] of this.armed)if(a.expiresAt<=now)this.disarm(s,'TTL_EXPIRED');}
  canStart(){return this.active.size<this.maxActive;}
  evaluateArmed(symbol){this.cleanup();symbol=String(symbol||'').toUpperCase();const a=this.armed.get(symbol);if(!a)return {ok:false,reason:'NOT_ARMED'};const snap=this.marketStream?.snapshot?.(symbol,this.now());const ev=burstEvidence(snap,a.side,{preMove:a.preMove});return {ok:true,authorization:a,snapshot:snap,evidence:ev,trigger:ev.score>=a.triggerThreshold&&ev.preMove.match&&ev.contradictions.length===0};}
  start(row){if(!this.canStart())return {ok:false,reason:'BURST_SLOT_FULL'};const symbol=String(row?.symbol||'').toUpperCase();const active={burstId:String(row?.burstId||id('burst')),authorizationId:row.authorizationId,symbol,side:row.side,quantity:finite(row.quantity),entryPrice:finite(row.entryPrice),stopPrice:finite(row.stopPrice),takeProfitPrice:finite(row.takeProfitPrice),leverage:finite(row.leverage),marginQuote:finite(row.marginQuote),openedAt:this.now(),mfeR:0,maeR:0,syntheticAddon:row.syntheticAddon===true,pauseExceptionUsed:row.pauseExceptionUsed===true};this.active.set(active.burstId,active);this.armed.delete(symbol);this._event('START',active);return {ok:true,active};}
  evaluateActive(burstId){const a=this.active.get(burstId);if(!a)return {ok:false,reason:'BURST_NOT_ACTIVE'};const snap=this.marketStream?.snapshot?.(a.symbol,this.now());const ex=exitEvidence(snap,a,this.now());a.mfeR=Math.max(a.mfeR,finite(ex.mfeR)||0);a.maeR=Math.min(a.maeR,finite(ex.maeR)||0);return {ok:true,active:{...a},snapshot:snap,exit:ex};}
  finish(burstId,result={}){const a=this.active.get(burstId);if(!a)return null;this.active.delete(burstId);const closed={...a,closedAt:this.now(),...result};this._event('CLOSE',closed);return closed;}
  consumePauseException(pauseKey){if(!pauseKey)return false;if(this.pauseExceptionConsumedFor===pauseKey)return false;this.pauseExceptionConsumedFor=pauseKey;return true;}
  pauseExceptionAvailable(pauseKey){return !!pauseKey&&this.pauseExceptionConsumedFor!==pauseKey;}
  status(pause=null){this.cleanup();return {ok:true,version:'R2544.30',mode:'BURST_SCALP',maxArmed:this.maxArmed,maxActive:this.maxActive,watchIntervalMs:1000,armed:[...this.armed.values()].map(x=>{
    let e;try{e=burstEvidence(this.marketStream?.snapshot?.(x.symbol,this.now()),x.side,{preMove:x.preMove});}catch{e=null;}
    return {...x,remainingMs:Math.max(0,x.expiresAt-this.now()),telemetry:{score:e?.score??null,threshold:x.triggerThreshold,state:!e||!e.fresh?'DATA_NOT_READY':e.score>=x.triggerThreshold&&e.preMove.match&&e.contradictions.length===0?'TRIGGER_READY':'WAIT_TRIGGER',contradictions:e?.contradictions||['STREAM_UNAVAILABLE']}};
  }),active:[...this.active.values()].map(x=>({...x})),pause:{active:!!pause,key:pause?.pauseStartedAt||null,exceptionAvailable:pause?this.pauseExceptionAvailable(String(pause.pauseStartedAt||pause.until||'')):false},history:this.history.slice(0,20)};}
  _event(kind,data){const event={at:new Date(this.now()).toISOString(),kind,...JSON.parse(JSON.stringify(data||{}))};this.history.unshift(event);this.history=this.history.slice(0,50);try{this.onEvent(event);}catch{}}
}

module.exports={finite,burstEvidence,exitEvidence,burstMarginRule,BurstScalpManager,PullbackEntry,PULLBACK_RULES,BURST_STRICTNESS,BURST_PAUSE_EXCEPTION_MIN,BURST_TTL_MS,BURST_TRIGGER_VERSION};
