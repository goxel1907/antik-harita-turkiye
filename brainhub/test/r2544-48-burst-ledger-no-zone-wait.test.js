'use strict';
// R2544.48 (user report 05.10 21:35 / 06.10 00:30): R45's JEV "wait for the zone" sentence stopped all 5m/15m entries;
// a BrainHub burst lot showed as "dış/manuel / ESKİ/ETİKETSİZ", was also judged by the core position review, and its
// close never reached the closed-trades table.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createLiveController}=require('../live-controller');
const {openStore}=require('../store');
const {performanceReport}=require('../office-performance');

const NOW=2_000_000_000_000;
const burstClosed=(id,extra={})=>({burstId:id,symbol:'GRIFFAINUSDT',side:'LONG',quantity:0,initialQuantity:16293,entryPrice:0.01964,stopPrice:0.019561,leverage:20,marginQuote:16,
  openedAt:NOW-125000,closedAt:NOW-5500,mfeR:0.8418,maeR:-0.0696,triggerScore:0.7845,exitReason:'JEV_BURST_EXIT',realizedR:0.4646,jevReason:'NEAR_EXPLOSION|BURST_PREAUTH',...extra});
function controller(journal){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r48-ledger-'));fs.mkdirSync(path.join(root,'config'));fs.mkdirSync(path.join(root,'data'));
  const store={journal(){},latestJournal:()=>null,recentJournal:(kind)=>journal.filter(x=>x.kind===kind)};
  return {root,c:createLiveController({root,store,scanner:{},pipeline:{},committee:async()=>({}),clock:()=>NOW,fetchImpl:async()=>{throw new Error('no network in test');}})};
}

test('R48 a burst close becomes a POSITION_CLOSED with the exchange net, burst context and no core-lane learning',()=>{
  const {root,c}=controller([]);
  try{
    const r=c._testBurstCloseRecord(burstClosed('burst_a'),{realized:0.598,commission:-0.318,funding:0,net:0.28});
    assert.equal(r.netPnl,0.28);assert.equal(r.commission,-0.318);assert.equal(r.exitType,'BURST_JEV_EXIT');assert.equal(r.exitBy,'JEV');
    assert.equal(r.tradeLane,'BURST_SCALP');assert.equal(r.entryContext.lane,'BURST_SCALP');assert.equal(r.entryContext.releaseContract,'R2544.48_BURST_SCALP');
    assert.equal(r.learningAuthority,'EXCLUDED_BURST_LANE');assert.equal(r.eventId,'BURST:burst_a');assert.equal(r.closeBusinessKey,'BURST:burst_a');
    const risk=Math.abs(0.01964-0.019561)*16293;assert.ok(Math.abs(r.rMultiple-0.28/risk)<1e-9);assert.equal(r.holdMinutes,2);
    assert.match(r.entryContext.why,/vur-kaç.*NEAR_EXPLOSION.*0\.7845.*20x/);assert.equal(r.entryContext.burst.grossPriceR,0.4646);
    const noIncome=c._testBurstCloseRecord(burstClosed('burst_b',{exitReason:'EXCHANGE_INVENTORY_EXIT_DETECTED'}),null);
    assert.equal(noIncome.netPnl,null);assert.equal(noIncome.incomeAvailable,false);assert.equal(noIncome.exitType,'BURST_STOP_OR_EXTERNAL');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('R48 after a restart, bursts closed in 48 h without a POSITION_CLOSED are re-queued exactly once',()=>{
  const journal=[{kind:'BURST_CLOSED',symbol:'ORCAUSDT',ts:NOW-3600000,payload:burstClosed('burst_orca',{symbol:'ORCAUSDT'})},
    {kind:'BURST_CLOSED',symbol:'GRIFFAINUSDT',ts:NOW-1800000,payload:burstClosed('burst_griff')},
    {kind:'POSITION_CLOSED',symbol:'ORCAUSDT',ts:NOW-3500000,payload:{eventId:'BURST:burst_orca'}}];
  const {root,c}=controller(journal);
  try{
    assert.deepEqual(c._testBurstClosePending().map(x=>x.burstId),['burst_griff'],'already recorded ORCA is not queued again');
    c._testQueueBurstClose(burstClosed('burst_griff'));c._testRestoreBurstCloses();
    assert.equal(c._testBurstClosePending().length,1,'no duplicate queue entries');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('R48 burst money stays in reports and the burst desk, but not in core-lane lessons',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r48-store-')),s=openStore(root);
  try{
    const {c}=controller([]);
    const rec=c._testBurstCloseRecord(burstClosed('burst_s'),{realized:0.598,commission:-0.318,funding:0,net:0.28});
    s.journal('POSITION_CLOSED','GRIFFAINUSDT',rec);
    assert.equal(s.tradeLessons().cards.length,0,'burst close is not a core-lane lesson');
    const rep=performanceReport(s.officeRecords().slice().reverse(),[],NOW+1);
    assert.ok(Math.abs(rep.total.netPnl-0.28)<1e-9,'money is reported');
    const desk=rep.desks.find(d=>d.desk==='BURST_SCALP');assert.ok(desk,'burst desk exists');
    assert.equal(desk.cohorts.reduce((a,x)=>a+x.closed,0),1);
  }finally{s.db.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('R48 source contract: core review skips live burst lots, Office names the opener, entry price measured after the stop',()=>{
  const live=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(live,/const reviewable=open\.positions\.filter\(p=>\{const row=leaderAnalysisState\.bySymbol\?\.\[p\.symbol\];return String\(row\?\.state\|\|''\)\.toUpperCase\(\)==='ACTIVE'\|\|!activeBurstFor\(p\.symbol\);\}\);/);
  assert.match(live,/reason:'BURST_LOT_OWN_MANAGER'/);
  assert.match(live,/openedBy:own\?'BRAINHUB_AUTO':bl\?'BRAINHUB_BURST':'EXTERNAL'/);
  assert.match(live,/const row=bl\?\{\}:coreRow;/,'a stale core lifecycle row is never read for a burst lot');
  const stopAt=live.indexOf("const stop=await transport.placeRunnerStop({symbol,side,hedgeMode:hedge,quantity:executed");
  const measureAt=live.indexOf("params:{symbol,origClientOrderId:clientId}");
  assert.ok(stopAt>0&&measureAt>stopAt,'the protective stop is placed before the entry price query');
  assert.match(live,/queueBurstClose\(closed\);/);assert.equal((live.match(/queueBurstClose\(closed\);/g)||[]).length,2,'both burst exit paths');
  assert.match(live,/finalized\.push\(\.\.\.await finalizeBurstCloses\(\)\)/);
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.match(html,/p\.openedBy==='BRAINHUB_BURST'\?'OTO vur-kaç'/);assert.match(html,/BURST_JEV_EXIT:'Vur-kaç: JEV çıkışı'/);
});
