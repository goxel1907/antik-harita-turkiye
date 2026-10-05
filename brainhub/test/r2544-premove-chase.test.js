'use strict';
// CLAUDE_R2544 (Claude Work, 2026-09-28): hareket başlamadan yakalama + kovalama (fiyat kaçması) koruması.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const P=require('../premove');
const engine=require('../engine');
const {framePacket}=(()=>{try{return require('../jev-market-packet');}catch{return {};}})();

function series({n=60,tightFrom=52,buyShare=0.65,volMul=3,drift=0.02,ignite=null}={}){
  const c=[];let p=100;
  for(let i=0;i<n;i++){
    const tight=i>=tightFrom;const r=tight?0.08:0.6;const o=p;
    let cl=p+(tight?drift:(i%2?0.3:-0.3));const qv=tight?100*volMul:100;
    let hi=Math.max(o,cl)+r/2,lo=Math.min(o,cl)-r/2,q=qv,tb=tight?qv*buyShare:qv*0.5;
    if(ignite&&i===n-1){cl=ignite==='UP'?p+1.2:p-1.2;hi=Math.max(o,cl)+0.05;lo=Math.min(o,cl)-0.05;q=1000;tb=ignite==='UP'?800:200;}
    c.push({openTime:i*60000,closeTime:i*60000+59999,open:o,close:cl,high:hi,low:lo,volume:q/p,quoteVolume:q,takerBuyQuote:tb});p=cl;
  }
  return c;
}

test('premove: compression + absorption + buy pressure near high → PRE_MOVE LONG with trigger above box',()=>{
  const c=series();
  const last=c.at(-1).close;
  const s=P.preMoveSignal(c,{frame:'1m',prior20High:last+0.2,prior20Low:last-1});
  assert.equal(s.state,'PRE_MOVE',JSON.stringify(s));
  assert.equal(s.direction,'LONG');
  assert.ok(s.triggers.long>last&&s.invalidation.long<last);
  assert.ok(s.reasons.includes('VOLUME_ABSORPTION'));
});

test('premove: symmetric SHORT (sell pressure near low)',()=>{
  const c=series({buyShare:0.35,drift:-0.02});
  const last=c.at(-1).close;
  const s=P.preMoveSignal(c,{frame:'1m',prior20High:last+1,prior20Low:last-0.2});
  assert.equal(s.direction,'SHORT',JSON.stringify(s));
  assert.ok(['PRE_MOVE','WATCH'].includes(s.state));
});

test('premove: ignition candle is flagged (move started) and a quiet market is NONE',()=>{
  const up=P.preMoveSignal(series({ignite:'UP'}),{frame:'1m'});
  assert.equal(up.state,'IGNITION'); assert.equal(up.direction,'LONG');
  const quiet=P.preMoveSignal(series({tightFrom:999,volMul:1}),{frame:'1m'});
  assert.equal(quiet.state,'NONE');
});

test('premove combine: IGNITION outranks PRE_MOVE; agreeing TFs add priority',()=>{
  const a={available:true,frame:'1m',state:'PRE_MOVE',score:70,direction:'LONG',triggers:{},invalidation:{},reasons:[]};
  const b={available:true,frame:'3m',state:'PRE_MOVE',score:60,direction:'LONG',triggers:{},invalidation:{},reasons:[]};
  const c=P.combinePreMove({'1m':a,'3m':b});
  assert.equal(c.tfAgreement,true); assert.equal(c.priority,2*100+70+25);
  const d=P.combinePreMove({'1m':a,'3m':{...b,state:'IGNITION',direction:'SHORT'}});
  assert.equal(d.state,'IGNITION');
  assert.ok(d.priority>c.priority-100);
});

test('engine: 1m/3m/5m frames carry preMove; higher frames do not',()=>{
  const c=series({n:70});
  const s1=engine.structure(c,'1m'); const s15=engine.structure(c,'15m');
  assert.equal(s1.preMove?.available,true); assert.equal(s15.preMove,undefined);
});

test('JEV packet + evidence frames expose preMove compactly',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','jev-market-packet.js'),'utf8');
  assert.match(src,/preMove:f\.preMove&&f\.preMove\.available\?\{state:f\.preMove\.state/);
  const pl=fs.readFileSync(path.join(__dirname,'..','pipeline.js'),'utf8');
  assert.match(pl,/preMove:f\.preMove&&f\.preMove\.available\?\{state:f\.preMove\.state/);
});

test('fast attention: chase requeue first, then PRE_MOVE/IGNITION ranking over scanner order',()=>{
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(lc,/selection='CHASE_REQUEUE'/);
  assert.match(lc,/\['IGNITION','PRE_MOVE'\]\.includes\(x\.p\.state\)/);
  assert.ok(lc.indexOf("selection='CHASE_REQUEUE'")<lc.indexOf("selection='PRE_MOVE_'"),'kaçan sembol önce');
  assert.match(lc,/market\.preMoveProbe\(symOf\(c\)\)/);
});

test('chase R guard is binding: >0.5R run or breached stop blocks the market order and requeues',()=>{
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(lc,/CLAUDE_R2544_CHASE_R_GUARD/);
  assert.match(lc,/stopBreached\|\|runR>gcfg\.chaseMaxRunR/);
  assert.match(lc,/'CHASE_STOP_ALREADY_BREACHED':'CHASE_EXCEEDS_R_LIMIT'/);
  // guard, intent (emir) inşasından ÖNCE çalışır
  assert.ok(lc.indexOf('CLAUDE_R2544_CHASE_R_GUARD')<lc.indexOf('const intent = buildLeaderLiveIntent({'));
  // JOEUSDT 17:57Z örneği: analiz 0.037915, stop 0.03894 (SHORT), taze 0.03656 → 1.32R kaçış → blok
  const runR=-1*(0.03656-0.037915)/Math.abs(0.037915-0.03894);
  assert.ok(runR>0.5&&Math.abs(runR-1.322)<0.01);
});

test('R2543 devir bulguları: tek seçili aday + JEV_ATTENTION WATCH eski ARMED satırını günceller + runtime kimliği',()=>{
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(lc,/for \(const row of leaderAutoLastDiagnostics\?\.candidates \|\| \[\]\) if \(row !== target\) row\.selected = false;/);
  assert.match(lc,/\(fastMode\.kind==='REVALIDATION'\|\|fastMode\.kind==='JEV_ATTENTION'\) && advisory\?\.plan && advisory\?\.unifiedContext/);
  const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(sv,/const RUNTIME_RELEASE='R2544\.42-JEV-REACH-BUDGET';/);
  assert.equal((sv.match(/runtimeRelease:RUNTIME_RELEASE/g)||[]).length,2,'/health ve /live/status');
  assert.match(sv,/\},10000\);\nif\(typeof claudeRunnerTimer\.unref/,'pozisyon takibi 10 sn');
});

test('R2544 deploy: manage.ps1 sağlık testi R2543 Vision AUDIT_ON_DEMAND plan-worker durumunu kabul eder (28.09 deploy hatası)',()=>{
  const ps=fs.readFileSync(path.join(__dirname,'..','manage.ps1'),'utf8');
  assert.match(ps,/\(-not \[bool\]\(Get-PropValue \$planWorkerStatus 'parallelWithVision' \$false\) -and \[string\]\(Get-PropValue \$planWorkerStatus 'visionMode' ''\) -ne 'AUDIT_ON_DEMAND'\)/);
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(lc,/parallelWithVision:false,\n\s*visionMode:'AUDIT_ON_DEMAND',\n\s*routineRouter:'9ROUTER_FREE_TEXT'/,'canlı durum manage.ps1 beklentisiyle tutarlı');
});
