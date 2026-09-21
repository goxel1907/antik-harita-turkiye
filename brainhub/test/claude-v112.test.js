'use strict';
// CLAUDE_V112 testleri (Claude, Anthropic): Vision'sız momentum scalp hattı → Jev, Vision ile eşzamanlı
// hızlı hat, emir kilidi yalnız emir anında, worker alt-TF tetikleri her turda, 2/3 runner, 21 vakalık
// Vision doğruluk testi. Ağ yok: Binance ve piyasa verisi taklit edilir.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-v112-'));
fs.mkdirSync(path.join(ROOT, 'config'), { recursive:true });
process.env.BRAINHUB_ROOT = ROOT;
function setConfig(root, v109 = {}, v111 = {}) {
  fs.mkdirSync(path.join(root, 'config'), { recursive:true });
  fs.writeFileSync(path.join(root, 'config', 'claude-v109.json'), JSON.stringify({ deterministicTriggerMode:'SHADOW', ...v109 }));
  fs.writeFileSync(path.join(root, 'config', 'claude-v111.json'), JSON.stringify(v111));
  require('../claude-v109').resetConfigCache();
  require('../claude-v111').resetConfigCache();
}
setConfig(ROOT);

const v112 = require('../claude-v112');
const v111 = require('../claude-v111');
const tradeLanes = require('../trade-lanes');
const { preflightRiskGate } = require('../risk-gate');
const TFS = ['1m','3m','5m','15m','30m','45m','1h','4h','1d'];

function uFrame(tf, o = {}) {
  const side = o.side || 'LONG';
  const long = o.longScore ?? (side === 'LONG' ? 60 : 20);
  const short = o.shortScore ?? (side === 'SHORT' ? 60 : 20);
  return {
    available:true, frame:tf, fresh:o.fresh ?? true, asOf:Date.now() - 1000, trend:'UP',
    close:o.close ?? 100, atrPct:o.atrPct ?? 0.5,
    breakOfStructure:o.bos ?? null, prior20High:o.hi ?? 101, prior20Low:o.lo ?? 99,
    swingStructure:{ lastConfirmedSwingLow:{ price:o.swingLow ?? 99.5 }, lastConfirmedSwingHigh:{ price:o.swingHigh ?? 100.5 } },
    opportunity:{ state:'WATCH', preferredSide:long > short ? 'LONG' : short > long ? 'SHORT' : 'NEUTRAL', longScore:long, shortScore:short, originEligible:true, ownerEligible:true },
    breakoutExecution:o.bx ?? { status:'NO_ACTIVE_BREAKOUT', allowed:null }
  };
}
function unifiedOf(frames, livePrice = 101.3) {
  const u = { symbol:'ABCUSDT', livePrice, frames, dataQuality:{ advisoryUsable:true } };
  const p = side => {
    const key = side === 'LONG' ? 'longScore' : 'shortScore';
    return { side, continuity:TFS.filter(tf => frames[tf]?.available && frames[tf].fresh && (frames[tf].opportunity?.[key] ?? 0) >= 45)
      .map(tf => ({ frame:tf, score:frames[tf].opportunity[key], immediateEligible:frames[tf].breakoutExecution?.status !== 'FAILED_BREAKOUT' })) };
  };
  u.opportunityPaths = { LONG:p('LONG'), SHORT:p('SHORT') };
  return u;
}
const momentum = { symbol:'ABCUSDT', side:'LONG', leaderState:'TOP3_APPROACH', targetSources:['APP_EARLY_ATTENTION'], spreadBps:3, directionSupport:3 };
const plain = { symbol:'ABCUSDT', side:'LONG', leaderState:'WATCH', targetSources:[], spreadBps:3, directionSupport:3 };
function scalpFrames(o = {}) {
  const f = Object.fromEntries(TFS.map(tf => [tf, uFrame(tf)]));
  f['1m'] = uFrame('1m', { bos:'UP', close:101.2, hi:101, bx:{ status:'ACCEPTED', allowed:true }, atrPct:0.4, ...o.m1 });
  f['15m'] = uFrame('15m', { longScore:40, ...o.m15 });
  return f;
}

test('hızlı scalp sinyali: momentum coin + 1m kapanmış kırılım + 3m/5m hizalı + 15m karşı değil', () => {
  const sig = v112.scalpFastLaneSignal({ candidate:momentum, unified:unifiedOf(scalpFrames()) });
  assert.equal(sig.ok, true, JSON.stringify(sig));
  assert.equal(sig.tf, '1m');
  assert.equal(sig.triggerLevelId, 'PRIOR20_HIGH');
  assert.ok(['5m','15m'].includes(sig.ownerTF));
  const plan = v112.fastLanePlan({ signal:sig, unified:unifiedOf(scalpFrames()), candidate:momentum });
  assert.equal(plan.status, 'QUALIFIED');
  assert.match(plan.waitFor, /^NONE — Claude v112 hızlı scalp/);
  assert.equal(require('../claude-v109').qualifiedWaitIsNone(plan.waitFor), true);
  assert.equal(Object.keys(plan.timeframeDiagnostics).length, 9, 'Jev için 9 TF deterministik özet');
  const enforced = tradeLanes.enforceQualification(plan, unifiedOf(scalpFrames()), momentum);
  assert.equal(enforced.status, 'QUALIFIED', 'v110 hat kuralı geçer');
  const pre = preflightRiskGate({ plan:enforced, unified:unifiedOf(scalpFrames()) });
  assert.equal(pre.ok, true, JSON.stringify(pre.reasons));
});

test('hızlı scalp reddi: momentum değil / 15m sert karşı / kovalama çok uzak / fiyat içeri döndü', () => {
  assert.ok(v112.scalpFastLaneSignal({ candidate:plain, unified:unifiedOf(scalpFrames()) }).reasons.includes('FL_NOT_MOMENTUM_COIN'));
  const hard = scalpFrames({ m15:{ bos:'DOWN', close:98.5, lo:99, bx:{ status:'ACCEPTED', allowed:true }, longScore:20, shortScore:70 } });
  assert.ok(v112.scalpFastLaneSignal({ candidate:momentum, unified:unifiedOf(hard) }).reasons.includes('FL_15M_HARD_OPPOSITION'));
  const far = v112.scalpFastLaneSignal({ candidate:momentum, unified:unifiedOf(scalpFrames(), 104.5) });
  assert.equal(far.ok, false);
  assert.ok(far.misses.some(x => x.includes('CHASE_TOO_FAR')), JSON.stringify(far.misses));
  const back = v112.scalpFastLaneSignal({ candidate:momentum, unified:unifiedOf(scalpFrames(), 100.9) });
  assert.equal(back.ok, false);
});

test('hızlı scalp SHORT simetrik', () => {
  const f = Object.fromEntries(TFS.map(tf => [tf, uFrame(tf, { side:'SHORT' })]));
  f['3m'] = uFrame('3m', { side:'SHORT', bos:'DOWN', close:98.8, lo:99, bx:{ status:'ACCEPTED', allowed:true } });
  f['15m'] = uFrame('15m', { side:'SHORT', longScore:30, shortScore:40 });
  const sig = v112.scalpFastLaneSignal({ candidate:{ ...momentum, side:'SHORT' }, unified:unifiedOf(f, 98.7) });
  assert.equal(sig.ok, true, JSON.stringify(sig));
  assert.equal(sig.tf, '3m');
  assert.equal(sig.triggerLevelId, 'PRIOR20_LOW');
});

// ---------------- pipeline.run ----------------
function engineFrame(tf, o = {}) {
  return {
    available:true, frame:tf, asOf:Date.now() - 5000, closedCandles:120,
    close:o.close ?? 100, ema20:100, ema50:99, rsi14:55, atr14:0.4, atrPct:0.4, trend:'UP',
    prior20High:o.hi ?? 101, prior20Low:o.lo ?? 99, breakOfStructure:o.bos ?? null,
    buySideLiquidity:101, sellSideLiquidity:99, recentFairValueGaps:[], returnPct:0.4,
    candle:null, patterns:[], swingStructure:{ lastConfirmedSwingLow:{ price:99.5 }, lastConfirmedSwingHigh:{ price:100.8 } },
    liquidity:{ equalHigh:null, equalLow:null, lastSweep:null }, smcContext:{ available:false },
    opportunity:{ available:true, frame:tf, state:'WATCH', preferredSide:'LONG', longScore:o.longScore ?? 60, shortScore:20, originEligible:true, ownerEligible:true }
  };
}
function scalpEngineFrames() {
  const tfs = Object.fromEntries(TFS.map(tf => [tf, engineFrame(tf)]));
  tfs['1m'] = engineFrame('1m', { close:101.2, bos:'UP' });
  tfs['15m'] = engineFrame('15m', { longScore:40 });
  return tfs;
}
function loadPipelineWithMarket(timeframes, mid) {
  const marketPath = require.resolve('../market');
  const pipelinePath = require.resolve('../pipeline');
  const real = require('../market');
  require.cache[marketPath].exports = {
    ...real,
    async symbolContext(symbol) { return { symbol, generatedAt:new Date().toISOString(), timeframes, microstructure:{ available:true, bid:mid - 0.01, ask:mid + 0.01, spreadBps:2 } }; },
    async globalContext() { return {}; },
    async chartContext() { throw new Error('VISION_MUST_NOT_RUN'); }
  };
  delete require.cache[pipelinePath];
  const pipeline = require('../pipeline');
  require.cache[marketPath].exports = real;
  return pipeline;
}
const scanOf = c => ({ leaders:[{ ...c, attackRank:2, tradeQuality:70, longExpansionScore:60, shortExpansionScore:60 }] });

test('pipeline.run hızlı scalp: Vision çağrılmaz, QUALIFIED plan Jev’e gider, PLAN_FAST olarak saklanır', async () => {
  const pipeline = loadPipelineWithMarket(scalpEngineFrames(), 101.3);
  const journal = [];
  let committeeCalls = 0, jevCalls = 0;
  const sig = v112.scalpFastLaneSignal({ candidate:momentum, unified:unifiedOf(scalpFrames()) });
  const out = await pipeline.run({
    scan:scanOf(momentum),
    store:{ journal:(k, s, p) => { journal.push({ k, p }); return 'id'; } },
    committee:async () => { committeeCalls++; throw new Error('no'); },
    decisionJudge:async ({ plan }) => { jevCalls++; assert.equal(plan.status, 'QUALIFIED'); return { ok:true, called:true, required:true, veto:false, probabilities:{}, timeframeConflicts:{} }; },
    executionIntent:{ symbol:'ABCUSDT', scalpFastLane:{ ...sig, side:'LONG' }, revalidationOnly:true }
  });
  assert.equal(committeeCalls, 0);
  assert.equal(jevCalls, 1);
  assert.equal(out.plan.status, 'QUALIFIED', JSON.stringify(out.plan.lanePolicyReasons || out.plan.reason));
  assert.equal(out.committee.mode, 'claude_v112_scalp_fast_lane');
  assert.ok(journal.some(x => x.k === 'PLAN_FAST'));
  assert.equal(journal.some(x => x.k === 'PLAN'), false, 'yeniden doğrulamanın kullandığı PLAN kaydı kirlenmez');
  assert.equal(out.dryRunExecutor.intent?.scalpFastLane, undefined);
});

test('pipeline.run hızlı scalp: sinyal kaybolduysa REVIEW_REQUIRED, Jev çağrılmaz, Vision’a düşmez', async () => {
  const tfs = scalpEngineFrames();
  tfs['1m'] = engineFrame('1m');
  const pipeline = loadPipelineWithMarket(tfs, 101.3);
  let jevCalls = 0;
  const out = await pipeline.run({
    scan:scanOf(momentum), store:{ journal:() => 'id' },
    committee:async () => { throw new Error('no'); },
    decisionJudge:async () => { jevCalls++; return { ok:true, called:true, veto:false }; },
    executionIntent:{ symbol:'ABCUSDT', scalpFastLane:{ side:'LONG', tf:'1m' }, revalidationOnly:true }
  });
  assert.equal(jevCalls, 0);
  assert.equal(out.plan.status, 'REVIEW_REQUIRED');
  assert.equal(out.plan.reason, 'CLAUDE_V112_FAST_LANE_SIGNAL_GONE');
});

test('pipeline.run revalidationOnly: yeniden doğrulama uygulanmazsa tam Vision çalışmaz', async () => {
  setConfig(ROOT, { deterministicTriggerMode:'SHADOW' });
  const pipeline = loadPipelineWithMarket(scalpEngineFrames(), 101.3);
  const out = await pipeline.run({
    scan:scanOf(momentum), store:{ journal:() => 'id', latestJournal:() => null },
    committee:async () => { throw new Error('committee must not run'); },
    executionIntent:{ symbol:'ABCUSDT', triggerRevalidation:{ side:'LONG', triggerTF:'15m', triggerPrice:101 }, revalidationOnly:true }
  });
  assert.equal(out.reason, 'CLAUDE_V112_REVALIDATION_NOT_APPLIED');
});

// ---------------- controller: hızlı hat, eşzamanlılık, worker ----------------
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
function controllerFixture(t, { v109 = {}, v111cfg = {}, scan, pipelineRun, stateRows = null, leaderAuto = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-v112-ctl-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  setConfig(root, v109, v111cfg);
  const prevRoot = process.env.BRAINHUB_ROOT;
  process.env.BRAINHUB_ROOT = root; require('../claude-v109').resetConfigCache(); v111.resetConfigCache();
  t.after(() => { process.env.BRAINHUB_ROOT = prevRoot; require('../claude-v109').resetConfigCache(); v111.resetConfigCache(); });
  fs.writeFileSync(path.join(root, 'config', 'leader-auto.json'), JSON.stringify({ enabled:true, marginQuote:50, leverage:10, maxOpenPositions:3, allowLong:true, allowShort:true, ...leaderAuto }));
  fs.mkdirSync(path.join(root, 'data'), { recursive:true });
  if (stateRows) fs.writeFileSync(path.join(root, 'data', 'leader-analysis-state.json'), JSON.stringify({ version:1, updatedAt:Date.now(), cursor:0, bySymbol:stateRows }));
  const pipelineReal = require('../pipeline');
  const market = {
    async symbolContext(symbol) { return { symbol, generatedAt:new Date().toISOString(), timeframes:scalpEngineFrames(), microstructure:{ available:true, bid:101.29, ask:101.31, spreadBps:2 } }; },
    async globalContext() { return {}; }
  };
  const journal = [];
  const { createLiveController } = require('../live-controller');
  const controller = createLiveController({
    root, credentials:{}, market,
    store:{ journal:(k, s, p) => { journal.push({ k, s, p }); return 'id'; }, latestJournal:() => null },
    scanner:{ async scan() { return scan; } },
    pipeline:{ buildUnifiedContext:pipelineReal.buildUnifiedContext, run:pipelineRun },
    committee:async () => { throw new Error('router unused'); }
  });
  return { controller, journal, root };
}
const leaderRow = c => ({ ...c, attackRank:1, tradeQuality:70, longExpansionScore:60, shortExpansionScore:60 });

test('hızlı hat SHADOW: sinyal kaydedilir, pipeline/Jev çağrılmaz', async t => {
  let runs = 0;
  const { controller, journal } = controllerFixture(t, { v111cfg:{ scalpFastLane:'SHADOW' }, scan:{ leaders:[leaderRow(momentum)] }, pipelineRun:async () => { runs++; return {}; } });
  const out = await controller.scalpFastLaneTick();
  assert.equal(out.kind, 'SCALP_SIGNAL', JSON.stringify(out));
  assert.equal(out.applied, false);
  assert.equal(runs, 0);
  assert.ok(journal.some(x => x.k === 'CLAUDE_V112_FAST_LANE_SIGNAL' && x.p.applied === false));
  const again = await controller.scalpFastLaneTick();
  assert.equal(again.skipped, true, 'aynı kırılım/sembol tekrar işlenmez');
});

test('hızlı hat BINDING Vision sürerken çalışır; LIVE kapalı → yalnız analiz + Jev, emir yok', async t => {
  const other = { symbol:'XYZUSDT', side:'LONG', leaderState:'WATCH', targetSources:[], spreadBps:2, directionSupport:3 };
  const visionGate = deferred();
  const runs = [];
  const qualified = { valid:true, status:'QUALIFIED', side:'LONG', originTF:'1m', ownerTF:'15m', claudeFastLane:{ applied:true }, jevDecision:{ called:true, veto:false } };
  const { controller } = controllerFixture(t, {
    v111cfg:{ scalpFastLane:'BINDING' },
    scan:{ leaders:[leaderRow(other), { ...leaderRow(momentum), attackRank:2 }] },
    pipelineRun:async args => {
      runs.push(args.executionIntent);
      if (args.executionIntent.scalpFastLane) {
        return { ok:true, candidateFound:true, candidate:momentum, plan:qualified, jevDecision:qualified.jevDecision,
          unifiedContext:{ livePrice:101.3, frames:{}, dataQuality:{ advisoryUsable:true }, opportunityPaths:{} },
          committee:{ mode:'claude_v112_scalp_fast_lane', available:true }, vision:{ attached:0, required:0 } };
      }
      await visionGate.promise; // ana döngünün ~8 dk'lık Vision analizi
      return { ok:true, candidateFound:true, plan:{ valid:true, status:'WATCH', side:'LONG' }, unifiedContext:{ frames:{}, dataQuality:{ advisoryUsable:true } }, committee:{ available:true }, vision:{ attached:9, required:9 } };
    }
  });
  const leaderTick = controller.leaderAutoTick();
  await new Promise(r => setImmediate(r));
  const mobile = await controller.execute({ eventId:'m1', order:{ symbol:'BTCUSDT', side:'LONG' } });
  assert.ok(mobile.reasons.includes('LIVE_EXECUTOR_BUSY'), 'mobil emir Vision sürerken eskisi gibi reddedilir');
  const fast = await controller.scalpFastLaneTick();
  assert.equal(fast.kind, 'SCALP', JSON.stringify(fast));
  assert.equal(fast.symbol, 'ABCUSDT');
  assert.equal(fast.result.execution, 'LEADER_AUTO_WAIT_ARM', JSON.stringify(fast.result));
  assert.equal(fast.result.orderPlaced, false);
  const fastIntent = runs.find(x => x.scalpFastLane);
  assert.equal(fastIntent.revalidationOnly, true, 'hızlı hat tam Vision’a düşemez');
  visionGate.resolve();
  await leaderTick;
  const h = controller.status().leaderAuto?.health || controller.leaderAutoStatus().health || {};
  assert.equal(h.claudeV112?.fastLaneQualified, 1);
  assert.equal(h.claudeV112?.fastLaneJevCalled, 1);
});

test('hızlı hat BINDING: nitelikli değilse takip planı yazılmaz', async t => {
  const { controller } = controllerFixture(t, {
    v111cfg:{ scalpFastLane:'BINDING' },
    scan:{ leaders:[leaderRow(momentum)] },
    pipelineRun:async () => ({ ok:true, candidateFound:true, plan:{ valid:true, status:'WATCH', side:'LONG', reason:'JEV_STRUCTURAL_VETO' }, unifiedContext:{ frames:{}, dataQuality:{ advisoryUsable:true } }, committee:{ mode:'claude_v112_scalp_fast_lane' }, vision:{ attached:0 } })
  });
  const fast = await controller.scalpFastLaneTick();
  assert.ok(fast.result.reasons.includes('CLAUDE_V112_FAST_LANE_NOT_QUALIFIED'));
  const rows = controller.status().leaderAuto?.lifecycle?.rows || controller.leaderAutoStatus().lifecycle?.rows || [];
  assert.equal(rows.some(r => r.symbol === 'ABCUSDT' && r.planStatus === 'WATCH'), false);
});

test('worker: 1m/3m/5m sayısal tetikli planlar her turda kontrol edilir (sıra beklemez)', async t => {
  const now = Date.now();
  const row = (sym, tf) => ({ symbol:sym, side:'LONG', state:'WATCH', setupId:`LHSET:${sym}:LONG:a:b`, planStatus:'WATCH', reanalysisEligible:true, detectedAt:now - 60000, lastAnalyzedAt:now - 60000, triggerValid:true, triggerTF:tf, triggerPrice:105, invalidationPrice:95, waitFor:`${tf} kapanışı 105 üstünde`, originTF:tf, ownerTF:'15m' });
  const { controller, journal } = controllerFixture(t, {
    scan:{ leaders:[] }, pipelineRun:async () => ({}),
    stateRows:{ AAAUSDT:row('AAAUSDT','15m'), BBBUSDT:row('BBBUSDT','1m'), CCCUSDT:row('CCCUSDT','3m'), DDDUSDT:row('DDDUSDT','5m') }
  });
  const out = await controller.planWorkerTick();
  const reviewed = journal.filter(x => x.k === 'PLAN_WORKER_REVIEW').map(x => x.s);
  assert.equal(reviewed.length, 4, JSON.stringify(out));
  for (const s of ['BBBUSDT','CCCUSDT','DDDUSDT']) assert.ok(reviewed.includes(s), s);
});

// ---------------- runner 2/3 ----------------
test('runner 2/3: TP1 dolar dolmaz iz sürme başlar (taban başabaş)', () => {
  assert.equal(v111.runnerPhase({ initialQty:30, tpQty:[10,10,10], remainingQty:30, stepSize:1, tpPlaced:1 }), 'INITIAL');
  assert.equal(v111.runnerPhase({ initialQty:30, tpQty:[10,10,10], remainingQty:20, stepSize:1, tpPlaced:1 }), 'TRAILING');
  assert.equal(v111.runnerPhase({ initialQty:0.003, tpQty:[0.001,0.001,0.001], remainingQty:0.003, stepSize:0.001, tpPlaced:1 }), 'INITIAL');
  const cfg = v111.readConfig();
  const d = v111.desiredRunnerStop({ side:'LONG', phase:'TRAILING', entryPrice:100, markPrice:101.5, currentStop:98, frames:{ '1m':uFrame('1m', { swingLow:99.2 }) }, lane:{ momentumLadder:['1m'] }, originTF:'1m', tickSize:0.01, config:cfg });
  assert.equal(d.ok, true);
  assert.ok(d.target >= 100.1, 'swing başabaşın altındaysa taban başabaş');
});

test('transport 2/3 runner: yalnız TP1 konur, runner miktarı 2/3', async () => {
  const { BinanceLiveTransport } = require('../binance-live-transport');
  const posted = [];
  const reply = b => ({ ok:true, status:200, async text() { return JSON.stringify(b); } });
  const fetchImpl = async (url, opt = {}) => {
    const u = new URL(url); const params = new URLSearchParams(opt.body || u.search.slice(1));
    if (u.pathname === '/fapi/v1/time') return reply({ serverTime:Date.now() });
    if (u.pathname === '/fapi/v1/exchangeInfo') return reply({ symbols:[{ symbol:'ABCUSDT', status:'TRADING', contractType:'PERPETUAL', quoteAsset:'USDT', filters:[
      { filterType:'MARKET_LOT_SIZE', minQty:'1', maxQty:'100000', stepSize:'1' },
      { filterType:'PRICE_FILTER', minPrice:'0.01', maxPrice:'100000', tickSize:'0.01' },
      { filterType:'MIN_NOTIONAL', notional:'5' }] }] });
    if (u.pathname === '/fapi/v1/ticker/price') return reply({ price:'100' });
    if (u.pathname === '/fapi/v1/positionSide/dual') return reply({ dualSidePosition:false });
    if (u.pathname === '/fapi/v3/positionRisk') return reply([{ symbol:'ABCUSDT', positionAmt:'0', leverage:'5', positionSide:'BOTH' }]);
    if (u.pathname === '/fapi/v1/order') return reply({ orderId:1, executedQty:'30', status:'FILLED' });
    if (u.pathname === '/fapi/v1/algoOrder') { posted.push(params.get('type')); return reply({ algoId:posted.length }); }
    throw new Error('unexpected ' + u.pathname);
  };
  const t = new BinanceLiveTransport({ registry:{ consume:() => ({ ok:true, liveAllowed:true }) }, fetchImpl });
  const order = { action:'OPEN', symbol:'ABCUSDT', side:'LONG', orderType:'MARKET', quantity:30, entryPrice:100, stopPrice:98, takeProfit1:102, takeProfit2:104, takeProfit3:106, clientOrderId:'LHABCL2', lineageId:'L2' };
  const r = await t.submit({ grantId:'g', order, credentials:{ apiKey:'k'.repeat(10), apiSecret:'s'.repeat(10) }, livePolicy:{ expectedLeverage:5, maxEntryDeviationPct:1, runnerMode:'BINDING', runnerShare:'TWO_THIRDS' } });
  assert.equal(r.execution, 'LIVE_ENTRY_FULLY_PROTECTED', JSON.stringify(r.reasons));
  assert.deepEqual(posted, ['STOP_MARKET','TAKE_PROFIT_MARKET']);
  assert.equal(r.runner.tpPlaced, 1);
  assert.equal(r.runner.quantity, 20);
});

// ---------------- Vision doğruluk testi ----------------
test('Vision doğruluk testi: 7 sınıf × 3 boyut = 21 sentetik vaka, LONG/SHORT simetrik ve çizilebilir', () => {
  const b = require('../vision-benchmark');
  const market = require('../market');
  const cases = b.syntheticVisionCasesV112();
  assert.equal(cases.length, 21);
  assert.deepEqual([...new Set(cases.map(c => c.label))].sort(), [...b.V112_LABELS].sort());
  assert.deepEqual([...new Set(cases.map(c => c.size.width + 'x' + c.size.height))].sort(), ['640x360','896x504']);
  for (const c of cases) {
    const png = market.renderChartPng(c.chart, 'annotated', { outputWidth:c.size.width, outputHeight:c.size.height });
    assert.equal(png.slice(1,4).toString('ascii'), 'PNG');
  }
  const bos = cases.filter(c => c.label === 'BOS_UP').map(c => c.chart.analysis.breakOfStructure);
  const bosDown = cases.filter(c => c.label === 'BOS_DOWN').map(c => c.chart.analysis.breakOfStructure);
  assert.deepEqual(bos, ['UP','UP','UP']);
  assert.deepEqual(bosDown, ['DOWN','DOWN','DOWN']);
  assert.equal(b.parseBenchmarkLabel('PATTERN: BEAR_FVG'), 'BEAR_FVG');
  assert.equal(b.parseBenchmarkLabel('PATTERN: RANGE'), 'RANGE');
  assert.equal(b.parseBenchmarkLabel('bence BOS_UP'), null);
  const sm = b.summarizeBenchmark([{ expected:'BOS_UP', actual:'BOS_UP', match:true, profile:'main15m' }, { expected:'RANGE', actual:null, match:false, profile:'scalp' }]);
  assert.equal(sm.accuracyPct, 50);
  assert.equal(sm.unparsed, 1);
  assert.equal(sm.byLabel.BOS_UP.accuracyPct, 100);
});

// ---------------- bağımsız inceleme düzeltmeleri ----------------
test('hızlı hat Jev saatlik tavanı ve veto sonrası 30 dk soğuma', async t => {
  const second = { ...momentum, symbol:'DEFUSDT' };
  let runs = 0;
  const { controller } = controllerFixture(t, {
    v111cfg:{ scalpFastLane:'BINDING', fastLaneMaxJevPerHour:1 },
    scan:{ leaders:[leaderRow(momentum), { ...leaderRow(second), attackRank:2 }] },
    pipelineRun:async () => { runs++; return { ok:true, candidateFound:true, plan:{ valid:true, status:'WATCH', side:'LONG', reason:'JEV_STRUCTURAL_VETO' }, unifiedContext:{ frames:{}, dataQuality:{ advisoryUsable:true } }, committee:{ mode:'claude_v112_scalp_fast_lane' }, vision:{ attached:0 } }; }
  });
  const a = await controller.scalpFastLaneTick();
  assert.equal(a.kind, 'SCALP');
  const b = await controller.scalpFastLaneTick();
  assert.equal(b.kind, 'SCALP_SIGNAL');
  assert.equal(b.applied, false);
  assert.equal(b.reason, 'FAST_LANE_JEV_HOURLY_CAP');
  assert.equal(runs, 1);
});

test('runnerShare anahtarı yoksa v111 davranışı (ONE_THIRD) korunur', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-v112-rs-'));
  const prev = process.env.BRAINHUB_ROOT;
  try {
    setConfig(root, {}, { runnerMode:'BINDING' });
    process.env.BRAINHUB_ROOT = root; v111.resetConfigCache();
    assert.equal(v111.readConfig().runnerShare, 'ONE_THIRD');
    setConfig(root, {}, { runnerMode:'BINDING', runnerShare:'TWO_THIRDS' });
    v111.resetConfigCache();
    assert.equal(v111.readConfig().runnerShare, 'TWO_THIRDS');
  } finally { process.env.BRAINHUB_ROOT = prev; v111.resetConfigCache(); fs.rmSync(root, { recursive:true, force:true }); }
});
