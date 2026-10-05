'use strict';
// R44 (user rule 05.10.2026): a JEV request is never blocked and never carries a half sentence. Numbers stay
// complete; if the ceiling still binds, whole narrative lines are omitted (other timeframe before the lane's
// owner) and recorded. Burst-only order books close when their reservation ends so dedicated slots stay free.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const J=require('../jev-decision');
const {expandMarketPacket}=require('../jev-wire-market');
const {LocalL2Manager}=require('../local-l2');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/r42-carv-r41-packet.json'),'utf8'));
const clone=x=>JSON.parse(JSON.stringify(x));
const pad=' Closed-bar reading restated from the numeric frames with every level and every zone kept.';
function inflated(extra){const p=clone(fixture.packet);for(const tf of ['5m','15m'])p.chartNarrative.frames[tf].line=String(p.chartNarrative.frames[tf].line||'')+pad.repeat(extra);return p;}

test('R44 over-ceiling final decision omits the other timeframe line whole and keeps the owner line whole',()=>{
  const packet=inflated(90),orig5=packet.chartNarrative.frames['5m'].line;
  const body={model:'typesafe/jev-1.13',state:{description:'PASS-2 final.',pass1Handoff:{laneFocus:'5M_SCALP'},coreMarketPacket:packet,record:{attention:{symbol:packet.symbol},executablePlanOptions:[]}},questions:{trade_plan:{type:'choice',criteria:{WAIT:'No plan now.'}}}};
  const before=J.protectedCoreTruth(body),out=J.prepareDecisionRequest(body);
  assert.equal(out.ok,true,JSON.stringify(out.diagnostics.fitOmitted));assert.ok(out.diagnostics.bytes<=48000);
  assert.deepEqual(out.diagnostics.fitOmitted,['NARRATIVE_LINE_15M']);
  const sent=expandMarketPacket(out.body.state.coreMarketPacket).chartNarrative;
  assert.equal(sent.frames['15m'].line,undefined);assert.equal(sent.frames['5m'].line,orig5,'owner line is whole, not cut');
  assert.deepEqual(sent.omittedLines,['15m']);
  assert.deepEqual(J.protectedCoreTruth(out.body),before,'numeric truth unchanged');
});

test('R44 a 15m position review drops the 5m line first; no narrative line is ever shortened',()=>{
  const packet=inflated(90),orig15=packet.chartNarrative.frames['15m'].line;
  const body={model:'typesafe/jev-1.13',state:{coreMarketPacket:packet,description:'manage',record:{contract:'R2.5.3.2_JEV_SOVEREIGN_POSITION_MANAGEMENT',position:{symbol:packet.symbol,side:'SHORT',quantity:10},lifecycle:{ownerTF:'15m'},entryThesis:{why:'x'}}},questions:{position_action:{type:'choice'}}};
  const out=J.prepareDecisionRequest(body,{pass:'OTHER'});
  assert.equal(out.ok,true);assert.equal(out.diagnostics.fitOmitted[0],'NARRATIVE_LINE_5M');
  const sent=expandMarketPacket(out.body.state.coreMarketPacket).chartNarrative;
  for(const tf of ['5m','15m']){const line=sent.frames[tf].line;assert.ok(line===undefined||line===(tf==='15m'?orig15:packet.chartNarrative.frames['5m'].line),'line '+tf+' is whole or absent');}
});

test('R44 when both lines must go the owner line goes last and the omission list says so',()=>{
  const packet=inflated(200);
  const body={model:'typesafe/jev-1.13',state:{description:'PASS-2 final.',pass1Handoff:{laneFocus:'15M_TRADE'},coreMarketPacket:packet,record:{attention:{symbol:packet.symbol},executablePlanOptions:[]}},questions:{trade_plan:{type:'choice',criteria:{WAIT:'No plan now.'}}}};
  const out=J.prepareDecisionRequest(body);
  assert.equal(out.ok,true);assert.deepEqual(out.diagnostics.fitOmitted.slice(0,2),['NARRATIVE_LINE_5M','NARRATIVE_LINE_15M']);
});

test('R44 a burst-only book closes when its reservation ends; a book analysis also uses stays',()=>{
  let now=100000;const m=new LocalL2Manager({now:()=>now,maxSymbols:2,burstSlots:2});
  m.ensureSymbol('AAUSDT');m.ensureSymbol('BBUSDT');
  m.ensureSymbol('B1USDT',{priority:'BURST',leaseMs:60000});m.ensureSymbol('B2USDT',{priority:'BURST',leaseMs:60000});
  m.releaseReservation('B1USDT');assert.equal(m.states.has('B1USDT'),false,'burst-only book closed on release');
  m.ensureSymbol('B2USDT');m.releaseReservation('B2USDT');assert.equal(m.states.has('B2USDT'),true,'analysis now uses it');
  assert.ok(m.ensureSymbol('B3USDT',{priority:'BURST',leaseMs:1000}),'freed dedicated slot is reused without eviction');
  assert.equal(m.evictions,0);
  now+=2000;assert.ok(m.ensureSymbol('B4USDT',{priority:'BURST',leaseMs:60000}),'expired burst-only book is closed before the next candidate');
  assert.equal(m.states.has('B3USDT'),false);assert.equal(m.health().burstBooksClosed,2);
  m.setPositionSymbols(['B4USDT']);m.releaseReservation('B4USDT');assert.equal(m.states.has('B4USDT'),true,'position book is never closed');
});

test('R44 Office shows what was omitted for the ceiling',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.match(html,/Sınır için çıkarılan \(sayısal veri tam, yarım metin yok\)/);
  assert.match(fs.readFileSync(path.join(__dirname,'..','office-dashboard','office-server.js'),'utf8'),/fitOmitted: Array\.isArray\(last\?\.fitOmitted\)/);
});
