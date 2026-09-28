'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildLeaderLiveIntent}=require('../leader-live-intent');

const FILTERS={tickSize:0.000001,lotStep:1,minQty:1,maxQty:10000000,minNotional:5};
function espLike(over={}){
  return {
    candidate:{symbol:'ESPUSDT',side:'SHORT'},
    unified:{symbol:'ESPUSDT',livePrice:0.100865,frames:{'15m':{available:true,fresh:true,atrPct:1.884,prior20High:0.10529,prior20Low:0.0985}}},
    plan:{jevSovereign:true,status:'QUALIFIED',side:'SHORT',originTF:'15m',ownerTF:'15m',
      entryPrice:0.100865,stopPrice:0.10538501,invalidationPrice:0.10529,
      takeProfit1:0.09634498,takeProfit2:0.09182497,takeProfit3:0.08730495},
    marginQuote:20,leverage:12,filters:FILTERS,entryReferencePrice:0.100865,jevFinalAuthority:true,
    ...over
  };
}

test('R2543 exact panel: 20 USDT margin x 12 leverage aynen 240 USDT notional olur',()=>{
  const out=buildLeaderLiveIntent(espLike());
  assert.equal(out.ok,true,JSON.stringify(out.reasons));
  assert.equal(out.riskCapApplied,false);
  assert.equal(out.quantity,out.panelQuantity);
  assert.ok(Math.abs(out.notionalQuote-240)<1,'panel notional ~240: '+out.notionalQuote);
  assert.equal(out.requestedLeverage,12);
});

test('R2543 exact panel: risk cap asilirsa marj/miktar kuculmez, emir fail-closed olur',()=>{
  const equity=77.57,capPct=0.5,riskCapQuote=equity*capPct/100;
  const out=buildLeaderLiveIntent(espLike({riskCapQuote}));
  assert.equal(out.ok,false);
  assert.ok(out.reasons.includes('TRADE_RISK_CAP_EXCEEDED'),JSON.stringify(out.reasons));
  assert.equal(out.riskCapApplied,false);
  assert.equal(out.quantity,out.panelQuantity);
  assert.ok(Math.abs(out.notionalQuote-240)<1,'exact panel notional korunmali: '+out.notionalQuote);
  assert.ok(out.riskQuote>riskCapQuote,'risk asimi raporlanmali ama quantity degismemeli');
  assert.equal(out.requestedLeverage,12);
});

test('R2543 exact panel: cok dusuk risk cap da paneli kucultmez; dogrudan bloklar',()=>{
  const out=buildLeaderLiveIntent(espLike({riskCapQuote:0.02}));
  assert.equal(out.ok,false);
  assert.ok(out.reasons.includes('TRADE_RISK_CAP_EXCEEDED'));
  assert.equal(out.quantity,out.panelQuantity);
  assert.ok(out.notionalQuote>239&&out.notionalQuote<=240);
});

test('R2543 exact panel: dar stop tavana uyarsa 20x12 exact gecer, genis stop ayni panelle bloklanir',()=>{
  const equity=77.57,riskCapQuote=equity*0.5/100;
  const tight=buildLeaderLiveIntent(espLike({riskCapQuote,
    plan:{...espLike().plan,invalidationPrice:0.100870,stopPrice:0.100970,
      takeProfit1:0.100765,takeProfit2:0.100665,takeProfit3:0.100565}}));
  const wide=buildLeaderLiveIntent(espLike({riskCapQuote}));
  assert.equal(tight.ok,true,JSON.stringify(tight.reasons));
  assert.equal(tight.quantity,tight.panelQuantity);
  assert.ok(Math.abs(tight.notionalQuote-240)<1);
  assert.equal(wide.ok,false);
  assert.ok(wide.reasons.includes('TRADE_RISK_CAP_EXCEEDED'));
  assert.equal(wide.quantity,wide.panelQuantity);
  assert.ok(Math.abs(wide.notionalQuote-240)<1);
});

test('R2543 exact panel: iki uygun pozisyonda her biri 20x12 exact kalir; max2 semantigiyle toplam risk <=2x cap',()=>{
  const equity=53.71,capPct=0.5,riskCapQuote=equity*capPct/100;
  const a=buildLeaderLiveIntent(espLike({riskCapQuote,
    plan:{...espLike().plan,invalidationPrice:0.100870,stopPrice:0.100970,
      takeProfit1:0.100765,takeProfit2:0.100665,takeProfit3:0.100565}}));
  const b=buildLeaderLiveIntent(espLike({riskCapQuote,
    candidate:{symbol:'AEROUSDT',side:'SHORT'},
    unified:{symbol:'AEROUSDT',livePrice:0.8534,frames:{'15m':{available:true,fresh:true,atrPct:0.9,prior20High:0.8540,prior20Low:0.8410}}},
    plan:{jevSovereign:true,status:'QUALIFIED',side:'SHORT',originTF:'15m',ownerTF:'15m',
      entryPrice:0.8534,stopPrice:0.8540,invalidationPrice:0.8536,
      takeProfit1:0.8527,takeProfit2:0.8520,takeProfit3:0.8513},
    filters:{tickSize:0.00001,lotStep:0.1,minQty:0.1,maxQty:1000000,minNotional:5}}));
  assert.equal(a.ok,true,JSON.stringify(a.reasons));
  assert.equal(b.ok,true,JSON.stringify(b.reasons));
  assert.equal(a.quantity,a.panelQuantity);assert.equal(b.quantity,b.panelQuantity);
  assert.ok(Math.abs(a.notionalQuote-240)<1);assert.ok(Math.abs(b.notionalQuote-240)<1);
  const total=a.riskQuote+b.riskQuote;
  assert.ok(total<=2*riskCapQuote+1e-9,'max2 toplam risk <= 2 x cap');
});

for(const [marginQuote,leverage] of [[15,10],[22,12],[35,8]])test(`dynamic panel ${marginQuote} x ${leverage} is exact or rejected`,()=>{
 const accepted=buildLeaderLiveIntent(espLike({marginQuote,leverage}));
 const blocked=buildLeaderLiveIntent(espLike({marginQuote,leverage,riskCapQuote:0.001}));
 assert.equal(accepted.ok,true);assert.equal(blocked.ok,false);
 assert.equal(accepted.quantity,blocked.quantity);assert.equal(blocked.requestedLeverage,leverage);
 assert.ok(accepted.notionalQuote<=marginQuote*leverage);
 assert.ok(marginQuote*leverage-accepted.notionalQuote<0.100866);
 assert.ok(blocked.reasons.includes('TRADE_RISK_CAP_EXCEEDED'));
});
