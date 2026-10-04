'use strict';

const crypto=require('node:crypto');

function finite(v){if(v===null||v===undefined||(typeof v==='string'&&!v.trim()))return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp(v,lo=0,hi=1){return Math.max(lo,Math.min(hi,Number(v)||0));}
function sideSign(side){return String(side||'').toUpperCase()==='SHORT'?-1:1;}
function id(prefix='burst'){return prefix+'_'+crypto.randomBytes(8).toString('hex');}
function ratioFor(flow,side){return finite(side==='SHORT'?flow?.sellRatio:flow?.buyRatio);}
function signedFor(v,side){const n=finite(v);return n===null?null:n*sideSign(side);}
function totalQuote(flow){const a=finite(flow?.buyQuote)||0,b=finite(flow?.sellQuote)||0;return a+b;}

function burstEvidence(snapshot,side,{preMove=null}={}){
  side=String(side||'').toUpperCase();
  const s=sideSign(side), f1=snapshot?.orderFlow?.windows?.['1s']||{}, f3=snapshot?.orderFlow?.windows?.['3s']||{}, f5=snapshot?.orderFlow?.windows?.['5s']||{};
  const o1=snapshot?.level1Ofi?.windows?.['1s']||{},o3=snapshot?.level1Ofi?.windows?.['3s']||{};
  const l2=snapshot?.localL2||{};
  const r1=ratioFor(f1,side),r3=ratioFor(f3,side),r5=ratioFor(f5,side);
  const p1=signedFor(f1?.priceMoveBps,side),p3=signedFor(f3?.priceMoveBps,side);
  const ofi1=signedFor(o1?.normalizedOfi,side),ofi3=signedFor(o3?.normalizedOfi,side);
  const q=signedFor(o1?.queueImbalanceCurrent,side),micro=signedFor(o1?.micropriceBps,side);
  const ml=signedFor(l2?.multiLevelOfi,side),depth=signedFor(l2?.depthImbalance,side);
  const tq1=totalQuote(f1), tq3=totalQuote(f3), accel=tq3>0?(tq1/(tq3/3)):0;
  const spread=finite(snapshot?.spreadBps);
  const pmDir=String(preMove?.direction||'').toUpperCase(), pmState=String(preMove?.state||'').toUpperCase();
  const pmMatch=pmDir===side&&['PRE_MOVE','IGNITION'].includes(pmState);
  const l2Healthy=l2?.available===true&&l2?.sequenceHealthy===true&&finite(l2?.confidence)!==null&&Number(l2.confidence)>=0.55;
  const fresh=snapshot?.available===true&&finite(snapshot?.ageMs)!==null&&Number(snapshot.ageMs)<=2500;

  let score=0;
  if(pmMatch)score+=pmState==='IGNITION'?0.20:0.12;
  if(r1!==null)score+=0.16*clamp((r1-0.50)/0.28);
  if(r3!==null)score+=0.14*clamp((r3-0.50)/0.25);
  if(r5!==null)score+=0.06*clamp((r5-0.50)/0.22);
  if(p1!==null)score+=0.10*clamp(p1/5);
  if(p3!==null)score+=0.08*clamp(p3/10);
  if(ofi1!==null)score+=0.08*clamp((ofi1+0.05)/0.65);
  if(ofi3!==null)score+=0.06*clamp((ofi3+0.05)/0.65);
  if(q!==null)score+=0.04*clamp((q+0.05)/0.55);
  if(micro!==null)score+=0.03*clamp((micro+0.02)/0.9);
  if(ml!==null)score+=0.03*clamp((ml+0.05)/0.65);
  if(depth!==null)score+=0.02*clamp((depth+0.05)/0.65);
  if(accel>=1.4)score+=0.06*clamp((accel-1.4)/2.5+0.25);
  score=clamp(score);

  const contradictions=[];
  if(!fresh)contradictions.push('STREAM_STALE');
  if(!(spread!==null&&spread>=0&&spread<=8))contradictions.push('SPREAD_TOO_WIDE_OR_UNKNOWN');
  if(!l2Healthy)contradictions.push('LOCAL_L2_NOT_HEALTHY');
  if(r1!==null&&r1<0.56)contradictions.push('1S_FLOW_NOT_DIRECTIONAL');
  if(r3!==null&&r3<0.56)contradictions.push('3S_FLOW_NOT_DIRECTIONAL');
  if(p3!==null&&p3<-2)contradictions.push('3S_PRICE_AGAINST_SIDE');
  if(ofi3!==null&&ofi3<-0.12)contradictions.push('L1_OFI_AGAINST_SIDE');
  if(ml!==null&&ml<-0.18)contradictions.push('L2_OFI_AGAINST_SIDE');

  const ignition=score>=0.90&&contradictions.length===0&&pmMatch;
  const strong=score>=0.82&&contradictions.filter(x=>!['1S_FLOW_NOT_DIRECTIONAL'].includes(x)).length===0;
  return {version:'R2544.29',side,score:Number(score.toFixed(4)),ignition,strong,fresh,spreadBps:spread,acceleration:Number(accel.toFixed(3)),preMove:{state:pmState||null,direction:pmDir||null,match:pmMatch},flow:{oneSec:f1,threeSec:f3,fiveSec:f5},l1:{oneSec:o1,threeSec:o3},localL2:{available:l2?.available===true,sequenceHealthy:l2?.sequenceHealthy===true,confidence:finite(l2?.confidence),multiLevelOfi:finite(l2?.multiLevelOfi),depthImbalance:finite(l2?.depthImbalance)},contradictions};
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
  else if(Number(active?.openedAt)>0&&now-Number(active.openedAt)>=120000)reason='BURST_TIME_EXIT';
  if(adverse.score>=0.82&&adverse.fresh)reviewReason='BURST_FLOW_REVERSAL';
  else if(mfe>=0.55&&giveback>=Math.max(0.22,mfe*0.35))reviewReason='BURST_MFE_GIVEBACK';
  return {exit:!!reason,reason,reviewReason,progressR:progress===null?null:Number(progress.toFixed(4)),mfeR:Number(mfe.toFixed(4)),maeR:Number(mae.toFixed(4)),givebackR:Number(giveback.toFixed(4)),adverse};
}

class BurstScalpManager{
  constructor({marketStream,now=()=>Date.now(),maxArmed=4,maxActive=1}={}){this.marketStream=marketStream;this.now=now;this.maxArmed=maxArmed;this.maxActive=maxActive;this.armed=new Map();this.active=new Map();this.history=[];this.pauseExceptionConsumedFor=null;}
  arm(auth){const symbol=String(auth?.symbol||'').toUpperCase(),side=String(auth?.side||'').toUpperCase();if(!/^[A-Z0-9]{1,28}USDT$/.test(symbol)||!['LONG','SHORT'].includes(side))return {ok:false,reason:'BURST_AUTH_INVALID'};const now=this.now(),ttl=Math.max(15000,Math.min(180000,Number(auth?.ttlMs)||120000));
    if(!this.armed.has(symbol)&&this.armed.size>=this.maxArmed){const victim=[...this.armed.values()].sort((a,b)=>a.expiresAt-b.expiresAt)[0];if(victim)this.armed.delete(victim.symbol);}
    const row={authorizationId:String(auth.authorizationId||id('bauth')),symbol,side,armedAt:now,expiresAt:now+ttl,preMove:auth.preMove||null,jevReason:String(auth.jevReason||'').slice(0,300),pauseExceptionAllowed:auth.pauseExceptionAllowed===true,leverageMode:String(auth.leverageMode||'MAX_SAFE'),triggerThreshold:Math.max(0.82,Math.min(0.98,Number(auth.triggerThreshold)||0.90)),source:'JEV_PREAUTHORIZED',authority:'JEV_FINAL_CONDITIONAL'};
    this.armed.set(symbol,row);this.marketStream?.ensureSymbol?.(symbol);this.marketStream?.ensureLocalL2?.(symbol);this._event('ARM',row);return {ok:true,authorization:row};}
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
  _event(kind,data){this.history.unshift({at:new Date(this.now()).toISOString(),kind,...JSON.parse(JSON.stringify(data||{}))});this.history=this.history.slice(0,50);}
}

module.exports={finite,burstEvidence,exitEvidence,BurstScalpManager};
