'use strict';
const KESIF=require('./kesif');
const M5=300000;
const number=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
function advisorRequest(body){
  const state=body?.state||{},r=state.record||{},p=r.position||null;
  const symbol=String(state.coreMarketPacket?.symbol||r.symbol||r.attention?.symbol||p?.symbol||'').toUpperCase();
  if(p?.symbol&&String(p.symbol).toUpperCase()!==symbol)return {valid:false,symbol,reason:'GOXEL_SYMBOL_MISMATCH'};
  return {symbol,position:p&&String(p.symbol||symbol).toUpperCase()===symbol?p:null,lifecycle:r.lifecycle||null};
}
function evaluateGoxel({symbol,position=null,lifecycle=null,sc=null,pk=null,candles=null,at,openedAt=null}={}){
  const base={authority:'EVIDENCE_ONLY',source:'GOXEL_PRO',symbol,at,
    instruction:'Advisory observations only; missing screens are unknown. No entry veto, autonomous order, size change or new loss-exit authority.'};
  if(!pk?.timeframes||!pk.timeframes.m5||!pk.timeframes.m15||!pk.timeframes.h1||!pk.timeframes.h4||!pk.timeframes.d1)return {...base,available:false,reason:'GOXEL_CHARTS_UNAVAILABLE'};
  if(!position)return {...base,available:true,kind:'ENTRY_CONTEXT',
    long:KESIF.goxelEntry('LONG',sc,pk),short:KESIF.goxelEntry('SHORT',sc,pk)};
  const entry=number(position.entryPrice),stop=number(lifecycle?.initialStop)??number(position.stopPrice),start=number(openedAt)??number(position.openedAt);
  if(!(entry>0&&stop>0&&entry!==stop&&start>0)||!['LONG','SHORT'].includes(position.side)){
    return {...base,available:false,kind:'POSITION_CONTEXT',reason:'GOXEL_ORIGINAL_POSITION_CONTEXT_UNAVAILABLE'};
  }
  const rec={side:position.side,entryAt:Math.floor(start/M5)*M5,entryPrice:entry,
    stopPct:Math.abs(entry-stop)/entry*100,horizonH:99999,done:false};
  const look=KESIF.goxelLook(rec,candles,sc,at,{live:true}),pro=look&&KESIF.goxelPro(rec,look,pk);
  if(!pro)return {...base,available:false,kind:'POSITION_CONTEXT',reason:'GOXEL_ENTRY_CANDLES_UNAVAILABLE'};
  return {...base,available:true,kind:'POSITION_CONTEXT',side:position.side,
    entryPrice:entry,initialStop:stop,openedAt:start,curR:pro.curR,peakR:pro.peakR,netR:pro.netR,
    against:pro.against,big:pro.big,profitExitObservation:pro.close===true,
    lossExitShadow:KESIF.goxelLossLook(pro)?.exit===true,
    screens:pro.screens.map(x=>({key:x.key,against:x.against,text:x.txt}))};
}
module.exports={advisorRequest,evaluateGoxel};
