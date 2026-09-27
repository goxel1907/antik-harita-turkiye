'use strict';
// CLAUDE_R2543: 52 kB istek tavanı korunurken kırpma önceliği + exit paketinde risk ölçüsü.
// Ağ yok: fetch enjekte edilir, gerçek JEV çağrısı yapılmaz.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareDecisionRequest, MAX_DECISION_REQUEST_BYTES, createJevClient } = require('../jev-decision');

function frame(tf, filler) {
  return {
    available:true, fresh:true, asOf:1790500000000, close:0.8598, ema20:0.861, ema50:0.8625,
    rsi14:24.32, atr14:0.0031, atrPct:0.361, returnPct:-0.8, trend:'DOWN', breakOfStructure:null,
    prior20High:0.8773, prior20Low:0.8566,
    candle:{ direction:'BULL', bodyPct:12, rangeAtr:0.806 },
    patterns:Array.from({ length:6 }, (_, i) => ({
      type:'HEAD_AND_SHOULDERS', side:'SHORT', status:'FORMING', neckline:0.8568, at:1790500000000 + i,
      geometry:{ source:'CONFIRMED_PIVOT_GEOMETRY_CLOSED_CANDLES',
        pivots:Array.from({ length:40 }, (_, j) => ({ role:'TOP', index:j, price:0.86 + j / 10000, at:1790490000000 + j * 900000 })),
        lines:Array.from({ length:20 }, (_, j) => ({ role:'UPPER', from:{ index:j, price:0.87, at:1 }, to:{ index:j + 1, price:0.86, at:2 } })) } })),
    swingStructure:{ state:'BEARISH' }, liquidity:{ equalHigh:null, equalLow:null, lastSweep:null },
    smcContext:{ available:true, dealingRange:{ high:0.8773, low:0.8566, zone:'DISCOUNT' } },
    filler
  };
}
function bigBody() {
  const filler = 'x'.repeat(400);
  return {
    model:'typesafe/jev-1.13',
    state:{
      description:'d'.repeat(700),
      professionalTraderCortex:{ reference:'C'.repeat(15000) },
      dynamicKnowledge:{ entries:Array.from({ length:8 }, (_, i) => ({ id:i, summary:'K'.repeat(1200), keyPoints:['a'.repeat(300), 'b'.repeat(300), 'c'.repeat(300)], sourceUrls:['https://x/'+i] })), text:'T'.repeat(6000) },
      experienceMemory:{ stats:Array.from({ length:20 }, (_, i) => ({ setup:'S'+i, samples:3 })), measuredOutcomes:Array.from({ length:20 }, (_, i) => ({ r:i })), jevLessons:Array.from({ length:20 }, (_, i) => ({ l:i })) },
      record:{
        symbol:'AEROUSDT', livePrice:0.85355,
        experienceMemory:{ duplicated:'M'.repeat(4000) },
        coreFrames:{ '5m':frame('5m', filler), '15m':frame('15m', filler) },
        timingFrames:{ '1m':frame('1m', filler), '3m':frame('3m', filler) },
        higherContext:{ '30m':frame('30m', filler), '1h':frame('1h', filler), '4h':frame('4h', filler), '1d':frame('1d', filler) },
        microstructure:{ available:true, cvdQuote120s:-88421.25, spreadBps:2.3, orderFlowAvailable:true },
        derivatives:{ available:true, fundingRate:0.00011, takerBuySellRatio:0.87, topTraderLongShortRatio:1.42, globalLongShortRatio:2.31, oiDelta5mPct:-0.42 },
        observedLiquidations:{ available:false, reason:'NO_RECENT_OBSERVED_FORCE_ORDER_PRINTS' },
        entryThesis:{ why:'W'.repeat(3000), setupFamily:'BREAKOUT_RETEST', entryTiming:'MARKET_NOW' },
        requestedEvidence:{ visual:{ observations:'V'.repeat(6000) } },
        riskState:{ plannedRiskQuote:0.38, currentR:-0.11 }
      }
    },
    questions:{ trade_plan:{ type:'choice', instructions:'Q'.repeat(1500) } }
  };
}

test('CLAUDE_R2543: 52 kB tavanı aşan PASS-2 isteği artık gönderilebiliyor; piyasa gerçeği korunuyor', () => {
  const body = bigBody();
  const before = Buffer.byteLength(JSON.stringify(body), 'utf8');
  assert.ok(before > MAX_DECISION_REQUEST_BYTES, 'fixture tavanı aşmalı: ' + before);
  const prepared = prepareDecisionRequest(body);
  assert.equal(prepared.ok, true, 'kırpma sonrası gönderilebilmeli (' + prepared.diagnostics.bytes + ' bayt)');
  assert.ok(prepared.diagnostics.bytes <= MAX_DECISION_REQUEST_BYTES);
  const r = prepared.body.state.record;
  // korunanlar
  assert.equal(r.livePrice, 0.85355);
  assert.equal(r.coreFrames['15m'].prior20High, 0.8773);
  assert.equal(r.coreFrames['5m'].close, 0.8598);
  assert.equal(r.timingFrames['1m'].available, true);
  assert.equal(r.higherContext['4h'].available, true);
  assert.equal(r.microstructure.cvdQuote120s, -88421.25);
  assert.equal(r.derivatives.fundingRate, 0.00011);
  assert.equal(r.derivatives.topTraderLongShortRatio, 1.42);
  assert.equal(r.observedLiquidations.available, false);
  assert.equal(r.riskState.currentR, -0.11);
  assert.equal(r.entryThesis.setupFamily, 'BREAKOUT_RETEST');
  assert.ok(prepared.body.questions.trade_plan, 'sorular kırpılmaz');
  // kırpılanlar
  assert.equal(r.experienceMemory, undefined, 'tekrarlanan experienceMemory düşer');
  const p = r.coreFrames['15m'].patterns[0];
  assert.equal(p.type, 'HEAD_AND_SHOULDERS', 'formasyonun kendisi kalır');
  assert.equal(p.neckline, 0.8568);
  assert.equal(p.geometry, undefined, 'pivot geometrisi kırpılır');
});

test('CLAUDE_R2543: her şeye rağmen tavan aşılıyorsa fail-closed korunur (istek gönderilmez)', () => {
  const body = bigBody();
  body.state.record.hugeNumericBlob = Array.from({ length:20000 }, (_, i) => ({ i, v:i * 1.5 }));
  const prepared = prepareDecisionRequest(body);
  assert.equal(prepared.ok, false, 'tavan aşıldığında istek bloke edilmeli');
  assert.ok(prepared.diagnostics.bytes > MAX_DECISION_REQUEST_BYTES);
});

test('CLAUDE_R2543: exit paketinde initialStop/initialInvalidation/plannedRisk/currentR var ve currentStop ayrı', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r2543jev-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive:true });
  fs.mkdirSync(path.join(root, 'data'), { recursive:true });
  fs.mkdirSync(path.join(root, 'logs'), { recursive:true });
  fs.writeFileSync(path.join(root, 'config', 'jev.json'), JSON.stringify({ enabled:true, model:'typesafe/jev-1.13', dailyCapUsd:100, softBudgetUsd:0, maxPayloadChars:48000 }));
  let captured = null;
  const fetchImpl = async (url, opts) => { captured = JSON.parse(opts.body); return { ok:true, status:200, async text() { return JSON.stringify({ answers:{ position_action:{ choice:'HOLD' } } }); } }; };
  const jev = createJevClient({ root, apiKey:'sk-or-v1-testkey', fetchImpl });
  const unified = { symbol:'ONEUSDT', livePrice:0.00227173, frames:{}, dataQuality:{ advisoryUsable:true },
    microstructure:{ available:true, streaming:{ available:true, ageMs:800, cvdQuote120s:-1200, cvdTrades120s:90 } },
    derivatives:{ available:true, funding:{ lastFundingRate:0.0001 } }, liquidationContext:{ available:false } };
  await jev.sovereignExit({
    position:{ symbol:'ONEUSDT', side:'LONG', entryPrice:0.0022816615, markPrice:0.00227173, unrealizedPnl:-1.14912939, quantity:115723 },
    lifecycle:{ originTF:'15m', ownerTF:'15m', setup:'JEV_R2537_BREAKOUT_RETEST_15M_TRADE',
      initialQuantity:115723, initialEntryPrice:0.0022813, initialStopPrice:0.0021895471, initialInvalidationPrice:0.00219,
      stopPrice:0.0022400, plannedRiskQuote:10.62, stopDistancePct:3.93,
      entryContext:{ why:'JEV BREAKOUT_RETEST', setupFamily:'BREAKOUT_RETEST', entryTiming:'MARKET_NOW', edgeBasis:'STRUCTURE_LOCATION', lane:'15M_TRADE' } },
    currentPlan:{ originTF:'15m' }, unified
  });
  assert.ok(captured, 'istek gövdesi yakalanmalı');
  const rec = captured.state.record;
  assert.equal(rec.lifecycle.initialStop, 0.0021895471, 'ilk stop taşınmalı');
  assert.equal(rec.lifecycle.currentStop, 0.00224, 'güncel (taşınmış) stop AYRI alan');
  assert.equal(rec.lifecycle.initialInvalidation, 0.00219);
  assert.equal(rec.lifecycle.initialQuantity, 115723);
  assert.equal(rec.riskState.plannedRiskQuote, 10.62);
  assert.equal(rec.riskState.currentR, Number((-1.14912939 / 10.62).toFixed(3)));
  assert.ok(Math.abs(rec.riskState.currentR + 0.108) < 0.01, 'ONE çıkışı ≈ -0,11R olarak ölçülebilir: ' + rec.riskState.currentR);
  assert.equal(rec.riskState.stopDistancePct, 3.93);
  assert.ok(Math.abs(rec.riskState.movedShareOfStopDistance + 0.111) < 0.02, 'stop mesafesinin ~%11\'i: ' + rec.riskState.movedShareOfStopDistance);
  assert.equal(rec.entryThesis.setupFamily, 'BREAKOUT_RETEST', 'giriş tezi korunur');
});
