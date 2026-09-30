'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const episode=require('../episode-memory');
const lessons=require('../trade-lessons');
const {CURATED_OPEN_SOURCE_REPOS,createKnowledgeResearch}=require('../knowledge-research');
const {marketPacket}=require('../jev-market-packet');

const root=path.resolve(__dirname,'..');
const src=f=>fs.readFileSync(path.join(root,f),'utf8');

function currentUnified(){
  return {
    symbol:'EPICUSDT',livePrice:0.542,
    frames:{
      '5m':{available:true,trend:'DOWN',breakOfStructure:'BOS_DOWN',rsi14:33,atrPct:1.03,swingStructure:{state:'MIXED'},
        patterns:[{type:'DOUBLE_TOP',side:'SHORT',status:'CONFIRMED'}],
        readout:{stretch:{state:'STRETCHED',zone:'DISCOUNT',chaseRisk:{LONG:'LOW',SHORT:'HIGH'}},squeeze:{state:'OFF'},displacement:{dir:'DOWN'},effort:{state:'DOWN_EXHAUSTION'}}},
      '15m':{available:true,trend:'MIXED',breakOfStructure:null,rsi14:46,atrPct:1.87,swingStructure:{state:'MIXED'},
        patterns:[{type:'VOLATILITY_COMPRESSION',side:'NEUTRAL',status:'FORMING'}],
        readout:{stretch:{state:'NORMAL',zone:'PREMIUM',chaseRisk:{LONG:'LOW',SHORT:'LOW'}},squeeze:{state:'ON'},displacement:{dir:'DOWN'},effort:{state:'DOWN_EXHAUSTION'}}}
    },
    marketMakerEvidence:{orderFlow:{available:true,source:'BINANCE_AGGTRADE',cvdQuote120s:-2195}},
    microstructure:{available:true,sourceQuality:'STREAMING',depth20Imbalance:-0.12,spreadBps:3.7,streaming:{available:true}},
    derivatives:{available:true,source:'BINANCE_FUTURES',openInterest:{delta5mPct:-0.047},fundingRate:0.00005,takerBuySellRatio:0.344,topTraderLongShortRatio:6.19,globalLongShortRatio:0.97},
    liquidationContext:{available:true,source:'BINANCE_FORCE_ORDER',count:2,longLiquidatedQuote:1485,shortLiquidatedQuote:0,zones:[{price:0.546,side:'LONG_LIQUIDATED',quote:1285},{price:0.5416,side:'LONG_LIQUIDATED',quote:200}]},
    dataQuality:{advisoryUsable:true,websocketConnected:true}
  };
}

test('R2544.19 current episode fingerprint captures observed microstructure without actor claims',()=>{
  const sig=episode.signatureFromUnified(currentUnified(),'SHORT');
  const t=episode.tokens(sig);
  assert.ok(t.includes('SIDE_SHORT'));
  assert.ok(t.includes('5M_TREND_DOWN'));
  assert.ok(t.includes('CVD_SELL'));
  assert.ok(t.includes('DEPTH_ASK_HEAVY'));
  assert.ok(t.includes('OI_FALLING'));
  assert.ok(t.includes('TAKER_BUYSELL_LOW'));
  assert.ok(t.includes('LONG_LIQUIDATION_DOM'));
  const mech=episode.mechanics(sig);
  assert.equal(mech.participantIdentity,'NOT_IDENTIFIED');
  assert.equal(mech.participantIntent,'NOT_ASSERTED');
});

test('R2544.19 contrastive memory shows similar winners and losers instead of a hard rule',()=>{
  const cur=episode.signatureFromUnified(currentUnified(),'SHORT');
  const cards=[
    {symbol:'WINUSDT',side:'SHORT',family:'TREND_PULLBACK',lane:'5M_SCALP',timing:'MARKET_NOW',net:8.2,r:0.8,exit:'TP1_RUNNER_TRAIL',closedMs:10,episodeSignature:cur,mechanics:episode.mechanics(cur),tags:[],tier:'TOP11_24',regime:'X'},
    {symbol:'LOSSUSDT',side:'SHORT',family:'TREND_PULLBACK',lane:'5M_SCALP',timing:'MARKET_NOW',net:-6.1,r:-0.7,exit:'JEV_EXIT_NOW',closedMs:20,episodeSignature:cur,mechanics:episode.mechanics(cur),tags:[],tier:'TOP11_24',regime:'X'}
  ];
  const d=lessons.digest(cards,{currentSignature:cur,candidate:{symbol:'EPICUSDT',side:'SHORT'}});
  assert.equal(d.version,'R2544.19');
  assert.equal(d.similarEpisodes.wins.length,1);
  assert.equal(d.similarEpisodes.losses.length,1);
  assert.equal(d.similarEpisodes.mixedEvidence,true);
  assert.match(d.similarEpisodes.policy,/not a prediction/i);
});

test('R2544.19 pipeline supplies current market to persistent learning memory',()=>{
  const pipeline=src('pipeline.js');
  const store=src('store.js');
  assert.match(pipeline,/learningContext\(\{symbol:candidate\.symbol,candidate,currentContext:unified\}\)/);
  assert.match(store,/episodeMemory\.signatureFromUnified\(currentContext,candidate\?\.side\|\|null\)/);
  assert.match(store,/contextualEpisodeMemory:'R2544\.19 contrastive nearest-context memory/);
});

test('R2544.19 JEV packet carries explicit provenance and anti-hallucination semantics',()=>{
  const u=currentUnified();
  const p=marketPacket(u);
  assert.equal(p.provenance.graph.source,'DETERMINISTIC_NUMERIC_CLOSED_CANDLES');
  assert.equal(p.provenance.graph.formingCandle,'CONTEXT_ONLY_NOT_CONFIRMED');
  assert.equal(p.provenance.liquidations.semantics,'OBSERVED_FORCE_ORDER_ONLY_NO_HIDDEN_HEATMAP');
  assert.equal(p.provenance.participantIdentity,'NOT_IDENTIFIED');
  assert.equal(p.provenance.participantIntent,'NOT_ASSERTED');
});

test('R2544.19 OSS registry adds official Binance, normalized feed/replay, and offline-learning references transparently',()=>{
  const names=new Set(CURATED_OPEN_SOURCE_REPOS.map(x=>x.repo));
  assert.equal(CURATED_OPEN_SOURCE_REPOS.length,18);
  assert.ok(names.has('binance/binance-connector-python'));
  assert.ok(names.has('bmoscon/cryptofeed'));
  assert.ok(names.has('AI4Finance-Foundation/FinRL'));
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jev-r254419-'));
  const k=createKnowledgeResearch({root:tmp});
  const st=k.status();
  const cf=st.openSourceRepos.find(x=>x.repo==='bmoscon/cryptofeed');
  assert.equal(cf.license,'AGPL-3.0-or-later');
  assert.equal(cf.authority,'REFERENCE_ONLY');
  assert.match(cf.howUsed,/VERIFIED_REFERENCE/);
});

test('R2544.19 Office exposes the OSS-to-JEV chain and deployment includes episode memory',()=>{
  const html=src('office-dashboard/public/office.html');
  const office=src('office-dashboard/office-server.js');
  const manage=src('manage.ps1');
  const server=src('server.js');
  assert.match(html,/JEV Açık Kaynak Bilgi Zinciri/);
  assert.match(html,/id="ossTable"/);
  assert.match(html,/VERIFIED_REFERENCE/);
  assert.match(office,/OFFICE_VERSION = '2\.4\.0-R2544\.19-JEV-Brain'/);
  assert.match(office,/brainGet\('\/jev\/knowledge'\)/);
  assert.match(manage,/episode-memory\.js/);
  assert.match(server,/R2544\.19-CONTEXTUAL-EPISODE-MEMORY/);
  assert.match(server,/CONTEXTUAL_EPISODE_MEMORY/);
});

test('R2544.19 JEV prompt explicitly compares similar winners and losers',()=>{
  const jev=src('jev-decision.js');
  assert.match(jev,/similarEpisodes is contrastive episode memory/);
  assert.match(jev,/nearest historical winners AND losers/);
  assert.match(jev,/Participant identity is NOT_IDENTIFIED/);
  assert.match(jev,/similarEpisodes:tl\.similarEpisodes/);
});

test('R2544.19 future entry signatures persist positioning and liquidation-side context',()=>{
  const live=src('live-controller.js');
  assert.match(live,/topTraderRatio:finite/);
  assert.match(live,/globalRatio:finite/);
  assert.match(live,/longQuote:finite\(liq\?\.longLiquidatedQuote\)/);
  assert.match(live,/shortQuote:finite\(liq\?\.shortLiquidatedQuote\)/);
});
