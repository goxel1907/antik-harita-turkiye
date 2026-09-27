'use strict';
// CLAUDE_R2543 hedefli testler: ilk miktar/R muhasebesi, çıkış sınıflandırma, order-flow availability,
// türev alan eşlemesi, öğrenme hafızası R koruması. Ağ yok; Binance/JEV çağrısı yok.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createLiveController } = require('../live-controller');
const { buildMarketMakerEvidence } = require('../market-maker-evidence');
const { marketPacket } = require('../jev-market-packet');

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r2543-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive:true });
  fs.mkdirSync(path.join(root, 'data'), { recursive:true });
  fs.mkdirSync(path.join(root, 'logs'), { recursive:true });
  fs.writeFileSync(path.join(root, 'config', 'live-policy.json'), JSON.stringify({
    armMinutes:1440, expectedLeverage:5, maxEntryDeviationPct:0.5,
    limits:{ maxRiskPctPerTrade:0.5, maxNotionalPctPerTrade:10, maxDailyLossPct:100, maxOpenPositions:5, maxFamilyExposurePct:30 }
  }));
  return root;
}
function stubStore(journalRows = []) {
  const written = [];
  return {
    written,
    journal:(kind, symbol, payload) => { written.push({ kind, symbol, payload }); return 'id-' + written.length; },
    recentJournal:(kind, { limit = 30, sinceTs = 0 } = {}) =>
      journalRows.filter(x => x.kind === kind && x.ts >= sinceTs).sort((a, b) => b.ts - a.ts).slice(0, limit),
    latestJournal:() => null,
    officeRecords:() => [],
    recordLearning:() => {},
    learningContext:() => ({}),
    lease:() => ({ ok:true }), claim:() => ({ ok:true }), releaseClaim:() => ({ ok:true })
  };
}
function controller(store) {
  return createLiveController({
    root:tmpRoot(), store, scanner:{ scan:async () => ({ leaders:[] }) },
    pipeline:{ run:async () => ({}) }, committee:async () => ({}), market:{},
    fetchImpl:async () => { throw new Error('NETWORK_MUST_NOT_BE_USED_IN_TEST'); },
    credentials:{}
  });
}

test('CLAUDE_R2543: JEV tam çıkışı JEV_EXIT_NOW olarak sınıflanır, "manuel?" tahmini yapılmaz', () => {
  const { _testHelpers:h } = controller(stubStore());
  const now = Date.now();
  const jevRow = { lastExitExecution:{ by:'JEV', action:'EXIT_NOW', at:now - 45000, fullyClosed:true } };
  assert.equal(h.classifyExit({ runner:null, netPnl:-2.08, riskQuote:10.6, row:jevRow, closedAt:now }), 'JEV_EXIT_NOW');
  const partialRow = { lastExitExecution:{ by:'JEV', action:'PARTIAL_TAKE_PROFIT', at:now - 1000, fullyClosed:true } };
  assert.equal(h.classifyExit({ runner:null, netPnl:1.2, riskQuote:10, row:partialRow, closedAt:now }), 'JEV_PARTIAL_TAKE_PROFIT');
  // BrainHub dışı kapanış: JEV kanıtı yok, stop/TP seviyesinde değil → EXTERNAL_CLOSE (USER_MANUAL uydurulmaz)
  assert.equal(h.classifyExit({ runner:null, netPnl:-0.3, riskQuote:10, row:{}, closedAt:now }), 'EXTERNAL_CLOSE');
  // Eski JEV çıkışı (>15 dk) yeni kapanışa etiket olmaz
  const staleRow = { lastExitExecution:{ by:'JEV', action:'EXIT_NOW', at:now - 40 * 60000, fullyClosed:true } };
  assert.equal(h.classifyExit({ runner:null, netPnl:-0.3, riskQuote:10, row:staleRow, closedAt:now }), 'EXTERNAL_CLOSE');
});

test('CLAUDE_R2543: stop / TP / runner sınıflandırması korunur', () => {
  const { _testHelpers:h } = controller(stubStore());
  assert.equal(h.classifyExit({ runner:null, netPnl:-12.09, riskQuote:11.86, row:{}, closedAt:Date.now() }), 'STOP_LOSS');
  assert.equal(h.classifyExit({ runner:null, netPnl:11.0, riskQuote:11.0, row:{}, closedAt:Date.now() }), 'TAKE_PROFIT');
  assert.equal(h.classifyExit({ runner:{ tp1ReachedAt:1, stopMoveCount:3 }, netPnl:10.05, riskQuote:6.44, row:{}, closedAt:Date.now() }), 'TP1_RUNNER_TRAIL');
  assert.equal(h.classifyExit({ runner:{ tp1ReachedAt:1, stopMoveCount:0 }, netPnl:0.25, riskQuote:3.25, row:{}, closedAt:Date.now() }), 'TP1_BREAKEVEN');
  // riskQuote ölçülemiyorsa dürüst etiket
  assert.equal(h.classifyExit({ runner:null, netPnl:-1, riskQuote:null, row:{}, closedAt:Date.now() }), 'OTHER_CLOSE');
});

test('CLAUDE_R2543: ilk miktar kalan miktarla ezilmez (tam çıkış qty=0 ve kısmi çıkış senaryosu)', () => {
  const { _testHelpers:h } = controller(stubStore());
  // ONE senaryosu: JEV tam çıkış sonrası lifecycle.quantity=0
  const one = { side:'LONG', entryPrice:0.0022813, stopPrice:0.0021895471, quantity:0,
    initialQuantity:115723, initialEntryPrice:0.0022813, initialStopPrice:0.0021895471 };
  const r1 = h.recoverInitialEntry(one, 'ONEUSDT');
  assert.equal(r1.quantity, 115723);
  assert.equal(r1.source, 'LIFECYCLE_INITIAL');
  assert.ok(Math.abs(r1.riskQuote - 10.62) < 0.05, 'riskQuote ≈ 10.62, gerçek: ' + r1.riskQuote);
  // TRIA senaryosu: kısmi çıkış sonrası kalan 1447, ilk 4800
  const tria = { side:'LONG', entryPrice:0.0448, stopPrice:0.043738, quantity:1447, initialQuantity:4800 };
  const r2 = h.recoverInitialEntry(tria, 'TRIAUSDT');
  assert.equal(r2.quantity, 4800);
  const rMultiple = 10.046 / r2.riskQuote;
  assert.ok(rMultiple > 1 && rMultiple < 3, 'R makul aralıkta olmalı (65R değil): ' + rMultiple);
});

test('CLAUDE_R2543: initial alanlar yoksa giriş journalinden kurtarılır; kalan miktar son çare ve etiketli', () => {
  const now = Date.now();
  const store = stubStore([{ id:'j1', ts:now - 60000, kind:'LIVE_EXECUTION', symbol:'ESPUSDT',
    payload:{ eventId:'EV1', plan:{ entryPrice:0.100865, stopPrice:0.10538501 },
      result:{ orderPlaced:true, side:'SHORT', executedQty:2617 } } }]);
  const { _testHelpers:h } = controller(store);
  const row = { side:'SHORT', eventId:'EV1', entryOrderAt:now - 60000, quantity:0 };
  const rec = h.recoverInitialEntry(row, 'ESPUSDT');
  assert.equal(rec.quantity, 2617);
  assert.equal(rec.source, 'LIVE_EXECUTION_JOURNAL');
  assert.ok(Math.abs(rec.riskQuote - 11.83) < 0.2, 'riskQuote ≈ 11.83, gerçek: ' + rec.riskQuote);
  // Hiçbir kaynak yoksa: kalan miktara düşer ve bunu riskBasis'te söyler
  const blind = h.recoverInitialEntry({ side:'LONG', entryPrice:10, stopPrice:9, quantity:3 }, 'XUSDT');
  assert.equal(blind.quantity, 3);
  assert.match(blind.source, /REMAINING_FALLBACK/);
  const empty = h.recoverInitialEntry({ side:'LONG', entryPrice:10, stopPrice:9, quantity:0 }, 'XUSDT');
  assert.match(empty.source, /QUANTITY_UNAVAILABLE/);
  assert.equal(empty.riskQuote, null);
});

test('CLAUDE_R2543: orderFlow.available gerçek kanıta göre üretilir, CVD değeri silinmez', () => {
  const healthy = buildMarketMakerEvidence({ streaming:{ available:true, ageMs:1200, cvdQuote120s:-15234.5, cvdTrades120s:412, depth20Imbalance:-0.12, spreadBps:1.8, cvdAsOf:1790500000000, orderFlow:{ windows:{} } } });
  assert.equal(healthy.orderFlow.available, true);
  assert.equal(healthy.orderFlow.cvdQuote120s, -15234.5);
  assert.equal(healthy.orderFlow.reason, null);
  assert.equal(healthy.orderFlow.sampleTrades, 412);
  const noSample = buildMarketMakerEvidence({ streaming:{ available:true, ageMs:1000, cvdQuote120s:0, cvdTrades120s:0 } });
  assert.equal(noSample.orderFlow.available, false);
  assert.equal(noSample.orderFlow.reason, 'NO_TRADE_SAMPLE');
  const stale = buildMarketMakerEvidence({ streaming:{ available:true, ageMs:90000, cvdQuote120s:-100, cvdTrades120s:5 } });
  assert.equal(stale.orderFlow.available, false);
  assert.equal(stale.orderFlow.reason, 'STALE_STREAM');
  const missing = buildMarketMakerEvidence({ streaming:{} });
  assert.equal(missing.orderFlow.available, false);
  assert.equal(missing.orderFlow.cvdQuote120s, null, 'veri yoksa uydurulmaz');
});

test('CLAUDE_R2543: JEV paketi — CVD null\'a düşmez, 4 türev alanı kaynaktan doğru okunur', () => {
  const unified = {
    symbol:'AEROUSDT', livePrice:0.8534, frames:{},
    microstructure:{ available:true, bid:0.8533, ask:0.8535, spreadBps:2.3, depth20Imbalance:-0.2,
      streaming:{ available:true, ageMs:900, cvdQuote120s:-88421.25, cvdTrades120s:377 },
      cvdSampleQuote:-88421.25, cvdSampleTrades:377, cvdWindow:'120s' },
    derivatives:{ available:true, asOf:1790500000000, source:'Binance USD-M public REST',
      openInterest:{ current:123456, delta5mPct:-0.42 },
      funding:{ lastFundingRate:0.00011, markPrice:0.8534 },
      taker:{ buySellRatio:0.87 },
      topTraderPosition:{ longShortRatio:1.42 },
      globalAccount:{ longShortRatio:2.31 } },
    liquidationContext:{ available:false, reason:'NO_RECENT_OBSERVED_FORCE_ORDER_PRINTS' },
    dataQuality:{ advisoryUsable:true }
  };
  unified.marketMakerEvidence = buildMarketMakerEvidence({ streaming:unified.microstructure.streaming, derivatives:unified.derivatives, microstructure:unified.microstructure });
  const p = marketPacket(unified);
  assert.equal(p.microstructure.cvdQuote120s, -88421.25, 'CVD değeri gönderilmeli');
  assert.equal(p.microstructure.cvdTrades120s, 377);
  assert.equal(p.microstructure.orderFlowAvailable, true);
  assert.equal(p.derivatives.fundingRate, 0.00011);
  assert.equal(p.derivatives.takerBuySellRatio, 0.87);
  assert.equal(p.derivatives.topTraderLongShortRatio, 1.42);
  assert.equal(p.derivatives.globalLongShortRatio, 2.31);
  assert.equal(p.derivatives.oiDelta5mPct, -0.42);
  assert.equal(p.observedLiquidations.available, false, 'gözlenmeyen likidasyon uydurulmaz');
  // kaynak yoksa null kalır, 0 ile doldurulmaz
  const empty = marketPacket({ symbol:'X', livePrice:1, frames:{}, derivatives:{ available:false }, microstructure:{ available:false } });
  assert.equal(empty.derivatives.fundingRate, null);
  assert.equal(empty.derivatives.takerBuySellRatio, null);
  assert.equal(empty.microstructure.cvdQuote120s, null);
});
