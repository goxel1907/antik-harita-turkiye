'use strict';
// CLAUDE_V113 testleri (Claude, Anthropic): sonuç defteri (kapanan işlem → beyin), pozisyon ekranı,
// Jev tam kanıt (Fib/OB/FVG/likidite/son Vision), hızlı hat uzama filtresi. Ağ yok.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function freshRoot(t, v111 = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-v113-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  fs.mkdirSync(path.join(root, 'config'), { recursive:true });
  fs.mkdirSync(path.join(root, 'data'), { recursive:true });
  fs.writeFileSync(path.join(root, 'config', 'claude-v109.json'), JSON.stringify({ deterministicTriggerMode:'BINDING' }));
  fs.writeFileSync(path.join(root, 'config', 'claude-v111.json'), JSON.stringify({ scalpFastLane:'BINDING', ...v111 }));
  const prev = process.env.BRAINHUB_ROOT;
  process.env.BRAINHUB_ROOT = root;
  require('../claude-v109').resetConfigCache(); require('../claude-v111').resetConfigCache();
  t.after(() => { process.env.BRAINHUB_ROOT = prev; require('../claude-v109').resetConfigCache(); require('../claude-v111').resetConfigCache(); });
  return root;
}
const reply = body => ({ ok:true, status:200, async text() { return JSON.stringify(body); } });

test('sonuç defteri: kapanan işlem Vision beklemeden gerçek PnL + R + çıkış türü + giriş nedeniyle beyne yazılır', async t => {
  const root = freshRoot(t);
  const now0 = Date.now();
  fs.writeFileSync(path.join(root, 'config', 'live-policy.json'), JSON.stringify({
    armMinutes:1440, expectedLeverage:5, maxEntryDeviationPct:0.5,
    limits:{ maxRiskPctPerTrade:0.5, maxNotionalPctPerTrade:10, maxDailyLossPct:100, maxOpenPositions:5, maxFamilyExposurePct:30 },
    apiPermissions:{ configured:true, futuresEnabled:true, withdrawalsEnabled:false, ipRestricted:true }
  }));
  fs.writeFileSync(path.join(root, 'config', 'leader-auto.json'), JSON.stringify({ enabled:true, marginQuote:30, leverage:10, maxOpenPositions:3, allowLong:true, allowShort:true }));
  const row = (sym, side, entry, qty, stop, why) => ({ symbol:sym, side, state:'ACTIVE', setup:'CLAUDE_V112_MOMENTUM_SCALP', originTF:'1m', ownerTF:'3m',
    tradeLaneName:'SCALP_MOMENTUM', entryPrice:entry, quantity:qty, stopPrice:stop, takeProfit1:entry + (entry - stop), activeAt:now0 - 3600000,
    entryContext:{ why, source:'FAST_LANE', extension:{ return1hDirPct:7.8 } } });
  fs.writeFileSync(path.join(root, 'data', 'leader-analysis-state.json'), JSON.stringify({ version:1, updatedAt:now0, cursor:0, bySymbol:{
    COOKIEUSDT:row('COOKIEUSDT', 'LONG', 0.013, 23000, 0.0125, '3m kırılım, 4h +7.8% uzamış'),
    PENGUUSDT:row('PENGUUSDT', 'LONG', 0.009, 33000, 0.0087, 'açık')
  } }));
  const incomeCalls = [];
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url);
    assert.equal(options.method || 'GET', 'GET', 'defter emir göndermez');
    if (u.pathname === '/fapi/v1/time') return reply({ serverTime:Date.now() });
    if (u.pathname === '/fapi/v3/account') return reply({ totalWalletBalance:'110', totalMarginBalance:'108', availableBalance:'50',
      positions:[{ symbol:'PENGUUSDT', positionAmt:'33000', entryPrice:'0.009', markPrice:'0.00905', unrealizedProfit:'1.65', leverage:'10', notional:'298.6' }] });
    if (u.pathname === '/fapi/v1/income') {
      incomeCalls.push(u.searchParams.get('symbol'));
      return reply([
        { symbol:'COOKIEUSDT', incomeType:'REALIZED_PNL', income:'-11.5' },
        { symbol:'COOKIEUSDT', incomeType:'COMMISSION', income:'-0.3' },
        { symbol:'COOKIEUSDT', incomeType:'FUNDING_FEE', income:'-0.02' }
      ]);
    }
    throw new Error('UNEXPECTED_' + u.pathname);
  };
  const journal = [], learning = [];
  const store = {
    journal:(k, s, p) => { journal.push({ k, s, p, ts:Date.now() }); return 'id'; },
    latestJournal:() => null,
    recordLearning:(k, s, p) => { learning.push({ k, s, p }); return 'id'; },
    recentJournal:(kind) => journal.filter(x => x.k === kind).reverse().map(x => ({ id:'x', ts:x.ts, kind:x.k, symbol:x.s, payload:x.p }))
  };
  const { createLiveController } = require('../live-controller');
  const controller = createLiveController({ root, credentials:{ apiKey:'test-api-key', apiSecret:'test-api-secret' }, fetchImpl, store,
    scanner:{ async scan() { return { leaders:[] }; } }, pipeline:{ async run() { throw new Error('VISION_UNUSED'); }, isBusy:() => true }, committee:async () => ({}) });
  const first = await controller.positionLedgerTick();
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.finalized, 0, 'tek anlıkta yok = henüz kapanmış sayılmaz (2 ardışık anlık gerekir)');
  const out = await controller.positionLedgerTick();
  assert.equal(out.finalized, 1, 'Vision meşgulken bile kapanan işlem kaydedilir');
  assert.deepEqual(incomeCalls, ['COOKIEUSDT']);
  const closed = journal.find(x => x.k === 'POSITION_CLOSED');
  assert.ok(closed);
  assert.equal(closed.p.netPnl.toFixed(2), '-11.82');
  assert.equal(closed.p.exitType, 'STOP_LOSS');
  assert.ok(Math.abs(closed.p.rMultiple - (-11.82 / 11.5)) < 0.01, String(closed.p.rMultiple));
  assert.match(closed.p.entryContext.why, /uzamış/);
  const learned = learning.find(x => x.k === 'POSITION_CLOSED');
  assert.ok(learned && Number.isFinite(learned.p.outcomePct), 'beyin sonucu ölçülmüş olarak öğrenir');
  const status = controller.positionsStatus();
  assert.equal(status.openCount, 1);
  assert.equal(status.open[0].symbol, 'PENGUUSDT');
  assert.equal(status.open[0].openedBy, 'BRAINHUB_AUTO');
  assert.equal(status.open[0].stopPrice, 0.0087);
  assert.equal(status.summary.closed, 1);
  assert.equal(status.summary.losses, 1);
  // İkinci tur aynı işlemi tekrar yazmaz.
  assert.equal((await controller.positionLedgerTick()).finalized, 0);
  // Pozisyon yöneticisi kartı defterden açık pozisyonu görür (Vision meşgul olsa da).
  assert.equal(controller.positionManagerStatus().ledger.openCount, 1);
});

test('hızlı hat: işlem yönünde ~5 saatte %4\'ten fazla uzamış harekette giriş yok; metrikler Jev planında', t => {
  freshRoot(t, {});
  const v112 = require('../claude-v112');
  const TFS = ['1m','3m','5m','15m','30m','45m','1h','4h','1d'];
  const fr = (tf, o = {}) => ({ available:true, frame:tf, fresh:true, asOf:Date.now() - 1000, trend:'UP', close:o.close ?? 100, ema20:o.ema20 ?? 99.6, atrPct:o.atrPct ?? 0.5,
    rsi14:60, returnPct:o.ret ?? 0.5, breakOfStructure:o.bos ?? null, prior20High:o.hi ?? 101, prior20Low:o.lo ?? 99,
    swingStructure:{ lastConfirmedSwingLow:{ price:99.5 }, lastConfirmedSwingHigh:{ price:100.5 } },
    opportunity:{ state:'WATCH', preferredSide:'LONG', longScore:o.ls ?? 60, shortScore:20, originEligible:true, ownerEligible:true },
    breakoutExecution:o.bx ?? { status:'NO_ACTIVE_BREAKOUT', allowed:null } });
  const frames = ret1h => {
    const f = Object.fromEntries(TFS.map(tf => [tf, fr(tf)]));
    f['1m'] = fr('1m', { bos:'UP', close:101.2, hi:101, bx:{ status:'ACCEPTED', allowed:true }, atrPct:0.4 });
    f['15m'] = fr('15m', { ls:40 });
    f['1h'] = fr('1h', { ret:ret1h });
    return f;
  };
  const unified = ret1h => {
    const f = frames(ret1h);
    const cont = TFS.filter(tf => (f[tf].opportunity.longScore) >= 45).map(tf => ({ frame:tf, score:f[tf].opportunity.longScore, immediateEligible:true }));
    return { symbol:'ABCUSDT', livePrice:101.3, frames:f, dataQuality:{ advisoryUsable:true }, opportunityPaths:{ LONG:{ side:'LONG', continuity:cont }, SHORT:{ side:'SHORT', continuity:[] } } };
  };
  const cand = { symbol:'ABCUSDT', side:'LONG', leaderState:'TOP3_APPROACH', targetSources:['APP_EARLY_ATTENTION'], spreadBps:3, directionSupport:3 };
  const late = v112.scalpFastLaneSignal({ candidate:cand, unified:unified(7.8) });
  assert.equal(late.ok, false);
  assert.deepEqual(late.reasons, ['FL_EXTENDED_CHASE_1H']);
  const fresh = v112.scalpFastLaneSignal({ candidate:cand, unified:unified(1.2) });
  assert.equal(fresh.ok, true, JSON.stringify(fresh));
  assert.equal(fresh.extension.return1hDirPct, 1.2);
  assert.ok(fresh.riskGeometry.stopPct > 0 && fresh.riskGeometry.tp1Price > 101.3);
  const plan = v112.fastLanePlan({ signal:fresh, unified:unified(1.2), candidate:cand });
  assert.equal(plan.claudeFastLane.extension.return1hDirPct, 1.2);
  // SHORT'ta işaret ters: -7.8% düşüş SHORT için +7.8% uzama.
  const { extensionMetrics } = v112;
  if (typeof extensionMetrics === 'function') assert.equal(extensionMetrics(unified(-7.8), 'SHORT').return1hDirPct, 7.8);
});

test('Jev kaydı: Fib, order block, FVG, likidite, swing, EMA/RSI, hızlı hat geometrisi ve son Vision okuması gider; yeni 3 soru', () => {
  const jev = require('../jev-decision');
  const ids = Object.keys(jev.decisionQuestions());
  for (const id of ['extended_entry', 'poor_risk_geometry', 'negative_track_record']) assert.ok(ids.includes(id), id);
  const frame = { available:true, asOf:1, close:1.05, ema20:1.0, ema50:0.98, rsi14:71, atrPct:0.8, returnPct:6.2, prior20High:1.06, prior20Low:0.97,
    swingStructure:{ state:'BULLISH', event:'BOS_UP' }, orderBlocks:{ bullish:[{ low:0.99, high:1.0 }], bearish:[] },
    smcContext:{ available:true, fibLevels:{ retracement:{ '0.618':1.01 } }, fairValueGaps:[{ side:'BULL', low:1.0, high:1.01 }] },
    liquidity:{ equalHigh:{ price:1.07 }, lastSweep:null }, patterns:[{ id:'BULL_FLAG' }], candle:{ direction:'BULL' } };
  const unified = { symbol:'ABCUSDT', frames:Object.fromEntries(['1m','3m','5m','15m','30m','45m','1h','4h','1d'].map(tf => [tf, frame])),
    lastVisionAnalysis:{ ageMin:12, status:'WATCH', visionSummary:'4h direnç altında' } };
  const plan = { status:'QUALIFIED', side:'LONG', claudeFastLane:{ tf:'1m', livePrice:1.05, momentum:{ tags:['VOLATILE_1M'] },
    extension:{ return1hDirPct:6.2 }, riskGeometry:{ stopPct:3.1 } } };
  const rec = JSON.parse(jev.compactDecisionRecord({ candidate:{ symbol:'ABCUSDT', side:'LONG' }, plan, unified }, 64000));
  const f = rec.frames['15m'];
  assert.equal(f.ema20, 1.0); assert.equal(f.rsi14, 71); assert.equal(f.returnPct, 6.2);
  assert.equal(f.orderBlocks.bullish.low, 0.99);
  assert.equal(f.smcContext.fib.r618, 1.01);
  assert.equal(f.smcContext.fairValueGaps, undefined, 'FVG tekrarı atıldı (liquidity.fairValueGaps kalır)');
  assert.equal(f.swing.event, 'BOS_UP');
  assert.equal(rec.plan.fastLane.extension.return1hDirPct, 6.2);
  assert.deepEqual(rec.plan.fastLane.momentumTags, ['VOLATILE_1M']);
  assert.equal(rec.lastVisionAnalysis.visionSummary, '4h direnç altında');
});

test('motor: order block ve Fibonacci seviyeleri kapanmış mumdan üretilir', () => {
  const engine = require('../engine');
  const c = [];
  let p = 100, t = 1_000_000;
  for (let i = 0; i < 60; i++) { const o = p, cl = p + (i % 2 ? -0.2 : 0.2); c.push({ openTime:t, closeTime:t + 59_999, open:o, close:cl, high:Math.max(o, cl) + 0.1, low:Math.min(o, cl) - 0.1, volume:1, quoteVolume:1, takerBuyQuote:0.5 }); p = cl; t += 60_000; }
  // ayı mumu, sonra 1,2 ATR üstü yer değiştiren boğa mumu (önceki 10 tepeyi kırar)
  c.push({ openTime:t, closeTime:t + 59_999, open:p, close:p - 0.3, high:p + 0.05, low:p - 0.35, volume:1, quoteVolume:1, takerBuyQuote:0.5 }); p -= 0.3; t += 60_000;
  c.push({ openTime:t, closeTime:t + 59_999, open:p, close:p + 2.0, high:p + 2.1, low:p - 0.05, volume:1, quoteVolume:1, takerBuyQuote:0.5 }); p += 2; t += 60_000;
  for (let i = 0; i < 3; i++) { c.push({ openTime:t, closeTime:t + 59_999, open:p, close:p + 0.1, high:p + 0.2, low:p - 0.05, volume:1, quoteVolume:1, takerBuyQuote:0.5 }); p += 0.1; t += 60_000; }
  const s = engine.structure(c, '1m');
  assert.equal(s.available, true);
  assert.ok(s.orderBlocks.bullish.length >= 1, JSON.stringify(s.orderBlocks));
  assert.equal(s.orderBlocks.bullish[0].side, 'BULL');
  if (s.smcContext.available) {
    assert.ok(s.smcContext.fibLevels && s.smcContext.fibLevels.retracement['0.618'] !== undefined);
  }
});

test('geçmiş işlemler: LIVE_EXECUTION kayıtlarından gerçek sonuç bir kez beyne yazılır; açık olan ve tekrar yazılmaz', async t => {
  const root = freshRoot(t);
  fs.writeFileSync(path.join(root, 'config', 'live-policy.json'), JSON.stringify({ armMinutes:1440, expectedLeverage:5, maxEntryDeviationPct:0.5,
    limits:{ maxRiskPctPerTrade:0.5, maxNotionalPctPerTrade:10, maxDailyLossPct:100, maxOpenPositions:5, maxFamilyExposurePct:30 },
    apiPermissions:{ configured:true, futuresEnabled:true, withdrawalsEnabled:false, ipRestricted:true } }));
  const now = Date.now();
  const exec = (sym, side, ts, qty, entry, stop, why) => ({ id:sym + ts, ts, kind:'LIVE_EXECUTION', symbol:sym, payload:{ eventId:'LH:' + sym + ':' + ts,
    plan:{ side, setup:'CLAUDE_V112_MOMENTUM_SCALP', originTF:'1m', why, claudeFastLane:{ momentum:{ tags:['VOLATILE_1M'] } }, jevDecision:{ called:true, veto:false } },
    riskGate:{ structuralStop:{ entryPrice:entry, stopPrice:stop } }, sizing:{ riskPctOfEquity:9 },
    result:{ orderPlaced:true, side, executedQty:qty } } });
  const journal = [
    exec('COOKIEUSDT', 'LONG', now - 7 * 3600e3, 24398, 0.012296, 0.011622, 'ilk COOKIE'),
    exec('COOKIEUSDT', 'LONG', now - 2 * 3600e3, 23069, 0.013004, 0.012496, 'ikinci COOKIE'),
    exec('TAOUSDT', 'LONG', now - 3600e3, 0.929, 322.66, 313.3, 'açık TAO')
  ];
  const incomeCalls = [];
  const reply2 = body => ({ ok:true, status:200, async text() { return JSON.stringify(body); } });
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/fapi/v1/time') return reply2({ serverTime:Date.now() });
    if (u.pathname === '/fapi/v3/positionRisk') return reply2([{ symbol:'TAOUSDT', positionAmt:'0.929', entryPrice:'322.66', markPrice:'323', unRealizedProfit:'0.3' }]);
    if (u.pathname === '/fapi/v1/income') {
      const st = Number(u.searchParams.get('startTime')), en = Number(u.searchParams.get('endTime'));
      incomeCalls.push([u.searchParams.get('symbol'), st, en]);
      const first = st < now - 5 * 3600e3;
      return reply2([{ incomeType:'REALIZED_PNL', income:first ? '-16.4' : '-11.7', time:String(first ? now - 6.5 * 3600e3 : now - 1.5 * 3600e3) }, { incomeType:'COMMISSION', income:'-0.3', time:'0' }]);
    }
    throw new Error('UNEXPECTED_' + u.pathname);
  };
  const written = [];
  const store = {
    journal:(k, s, p) => { written.push({ k, s, p, ts:Date.now() }); return 'id'; }, latestJournal:() => null, recordLearning:() => 'id',
    recentJournal:(kind) => kind === 'LIVE_EXECUTION' ? journal : written.filter(x => x.k === kind).map(x => ({ id:'w', ts:x.ts, kind:x.k, symbol:x.s, payload:x.p }))
  };
  const { createLiveController } = require('../live-controller');
  const controller = createLiveController({ root, credentials:{ apiKey:'test-api-key', apiSecret:'test-api-secret' }, fetchImpl, store,
    scanner:{ async scan() { return { leaders:[] }; } }, pipeline:{ async run() { return {}; } }, committee:async () => ({}) });
  const out = await controller.backfillClosedOutcomes({ sinceTs:0 });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.written, 2, 'iki kapanmış COOKIE yazılır, açık TAO yazılmaz');
  const rows = written.filter(x => x.k === 'POSITION_CLOSED');
  assert.equal(rows[0].p.netPnl.toFixed(1), '-16.7');
  assert.equal(rows[0].p.exitType, 'STOP_LOSS');
  assert.match(rows[0].p.entryContext.why, /ilk COOKIE/);
  assert.ok(incomeCalls[0][2] < journal[1].ts, 'ilk işlemin gelir penceresi ikinci girişten önce biter');
  assert.equal((await controller.backfillClosedOutcomes({ sinceTs:0 })).written, 0, 'tekrar yazılmaz');
});
