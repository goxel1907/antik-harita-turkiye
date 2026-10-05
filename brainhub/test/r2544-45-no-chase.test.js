'use strict';
// R45 (user rule 05.10.2026): no chasing, LONG or SHORT. Market entries only when price is not stretched into the
// wrong zone (or is inside the side's own OTE/OB/FVG). Cases mirror real 04-05.10 entries.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {locationChaseGate,stretchOf}=require('../chart-readout');
const J=require('../jev-decision');
const br=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/r45-br-entry-frames.json'),'utf8'));
const dg=(leg,state,zone,pos,ch)=>({readout:{d:1,st:[leg,state,zone,pos],...(ch?{ch}:{})}});

test('R45 the real BR SHORT entry (5m/15m DISCOUNT, EXTENDED/EXTREME, SHORT_HIGH) is a chase and is blocked',()=>{
  const g=locationChaseGate({side:'SHORT',lane:'5M_SCALP',ownerTF:'5m',frames:br.frames,price:br.livePrice});
  assert.equal(g.ok,false);assert.equal(g.reason,'LOCATION_CHASE_BLOCK');assert.equal(g.highChase,true);assert.equal(g.wrongZoneStretched,true);
  assert.deepEqual(g.inZone,[]);
});

test('R45 the same short from inside its own 5m OTE premium zone is a zone entry, not a chase',()=>{
  const ote=br.frames['5m'].oteReference.shortPremiumZone,price=(ote.low+ote.high)/2;
  const g=locationChaseGate({side:'SHORT',lane:'5M_SCALP',ownerTF:'5m',frames:br.frames,price});
  assert.equal(g.ok,true);assert.ok(g.inZone.includes('OTE'));
  // Live unified frames keep OTE under smcContext (the JEV packet flattens it): both shapes count.
  const live={...br.frames,'5m':{...br.frames['5m'],oteReference:undefined,smcContext:{oteReference:br.frames['5m'].oteReference}}};
  assert.equal(locationChaseGate({side:'SHORT',lane:'5M_SCALP',ownerTF:'5m',frames:live,price}).ok,true);
});

test('R45 LONG chase: owner 15m stretched in premium with 5m premium (CARV 11:45) is blocked',()=>{
  const frames={'15m':dg('UP','STRETCHED','PREMIUM',85.9),'5m':dg('UP','STRETCHED','PREMIUM',71.1)};
  assert.equal(locationChaseGate({side:'LONG',lane:'15M_TRADE',ownerTF:'15m',frames,price:1}).ok,false);
});

test('R45 entries in normal stretch stay allowed even in premium/discount (morning BEAMX, ORCA, BAT)',()=>{
  assert.equal(locationChaseGate({side:'SHORT',lane:'5M_SCALP',frames:{'5m':dg('DOWN','NORMAL','DISCOUNT',28),'15m':dg('DOWN','EXTREME','DISCOUNT',44)},price:1}).ok,true);
  assert.equal(locationChaseGate({side:'LONG',lane:'15M_TRADE',frames:{'15m':dg('UP','NORMAL','PREMIUM',61.5),'5m':dg('UP','NORMAL','PREMIUM',61.8)},price:1}).ok,true);
  assert.equal(locationChaseGate({side:'LONG',lane:'5M_SCALP',frames:{'5m':dg('UP','NORMAL','PREMIUM',68.1),'15m':dg('UP','NORMAL','PREMIUM',62.7)},price:1}).ok,true);
});

test('R45 HIGH chase risk on either timeframe blocks; stretched in the right zone does not; missing data never blocks',()=>{
  assert.equal(locationChaseGate({side:'LONG',lane:'5M_SCALP',frames:{'5m':dg('UP','NORMAL','EQUILIBRIUM',50),'15m':dg('UP','EXTREME','PREMIUM',92,'LONG_HIGH')},price:1}).ok,false);
  assert.equal(locationChaseGate({side:'LONG',lane:'5M_SCALP',frames:{'5m':dg('DOWN','EXTENDED','DISCOUNT',15),'15m':dg('DOWN','STRETCHED','DISCOUNT',20)},price:1}).ok,true,'buying a stretched drop in discount is location, not chase');
  const none=locationChaseGate({side:'SHORT',lane:'5M_SCALP',frames:{},price:1});assert.equal(none.ok,true);assert.equal(none.checked,false);
  assert.equal(stretchOf({readout:{stretch:{leg:'UP',state:'EXTENDED',zone:'PREMIUM',rangePosPct:88,chaseRisk:{LONG:'HIGH',SHORT:'LOW'}}}}).chaseRisk.LONG,'HIGH');
});

test('R45 JEV final decision contract states the rule and keeps it whole when compacted',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','jev-decision.js'),'utf8');
  assert.match(src,/'NO_CHASE_ENTER_AT_ZONE'/);assert.match(src,/location:'R2544\.45 no chasing LONG or SHORT/);
  assert.match(src,/location:'No chasing: MARKET_NOW outside the side OTE\/OB\/FVG is not executed when stretched in the wrong zone or chaseRisk is HIGH; wait for the zone\.'/);
});

test('R45 the guard is binding in the final execution gate, after the chase-R guard and before any order sizing',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  const a=src.indexOf('CLAUDE_R2544_CHASE_R_GUARD (bağlayıcı)'),b=src.indexOf('R45 LOCATION_CHASE_GUARD'),c=src.indexOf('const requestedNotional=Number(settings.marginQuote)*Number(settings.leverage);');
  assert.ok(a>0&&b>a&&c>b);assert.match(src,/store\.journal\('LOCATION_CHASE_BLOCK'/);assert.match(src,/LOCATION_CHASE_BLOCK:'kovalama yok/);
});
