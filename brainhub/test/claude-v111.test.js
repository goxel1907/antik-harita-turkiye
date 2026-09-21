'use strict';
// CLAUDE_V111 testleri (Claude, Anthropic): momentum scalp tetiği, sayısal tetik → yeniden doğrulama → Jev,
// iz süren runner stop. Ağ yok: market modülü require.cache ile taklit edilir.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-v111-'));
fs.mkdirSync(path.join(ROOT, 'config'), { recursive:true });
process.env.BRAINHUB_ROOT = ROOT;
function setConfig(v109 = {}, v111 = {}) {
  fs.writeFileSync(path.join(ROOT, 'config', 'claude-v109.json'), JSON.stringify({ deterministicTriggerMode:'SHADOW', ...v109 }));
  fs.writeFileSync(path.join(ROOT, 'config', 'claude-v111.json'), JSON.stringify(v111));
  require('../claude-v109').resetConfigCache();
  require('../claude-v111').resetConfigCache();
}
setConfig();

const v111 = require('../claude-v111');
const tradeLanes = require('../trade-lanes');
const TFS = ['1m','3m','5m','15m','30m','45m','1h','4h','1d'];

// Birleşik bağlam kareleri (pipeline.summarizeFrame çıktısı biçiminde)
function uFrame(tf, o = {}) {
  const side = o.side || 'LONG';
  const long = o.longScore ?? (side === 'LONG' ? 60 : 20);
  const short = o.shortScore ?? (side === 'SHORT' ? 60 : 20);
  return {
    available:true, frame:tf, fresh:o.fresh ?? true, asOf:Date.now() - 1000,
    close:o.close ?? 100, atrPct:o.atrPct ?? 0.5,
    breakOfStructure:o.bos ?? null, prior20High:o.hi ?? 101, prior20Low:o.lo ?? 99,
    swingStructure:o.swing ?? { lastConfirmedSwingLow:{ price:o.swingLow ?? 99.5 }, lastConfirmedSwingHigh:{ price:o.swingHigh ?? 100.5 } },
    opportunity:{ state:'WATCH', preferredSide:long > short ? 'LONG' : short > long ? 'SHORT' : 'NEUTRAL', longScore:long, shortScore:short, originEligible:true, ownerEligible:true },
    breakoutExecution:o.bx ?? { status:'NO_ACTIVE_BREAKOUT', allowed:null }
  };
}
function unifiedOf(frames, livePrice = 102) {
  const u = { symbol:'ABCUSDT', livePrice, frames, dataQuality:{ advisoryUsable:true } };
  const path = side => {
    const key = side === 'LONG' ? 'longScore' : 'shortScore';
    const continuity = TFS.filter(tf => frames[tf]?.available && frames[tf].fresh && (frames[tf].opportunity?.[key] ?? 0) >= 45)
      .map(tf => ({ frame:tf, score:frames[tf].opportunity[key], immediateEligible:frames[tf].breakoutExecution?.status !== 'FAILED_BREAKOUT' }));
    return { side, continuity };
  };
  u.opportunityPaths = { LONG:path('LONG'), SHORT:path('SHORT') };
  return u;
}
const momentumCandidate = { symbol:'ABCUSDT', side:'LONG', leaderState:'TOP3_APPROACH', targetSources:['APP_EARLY_ATTENTION'], spreadBps:3, directionSupport:3 };
const plainCandidate = { symbol:'ABCUSDT', side:'LONG', leaderState:'WATCH', targetSources:[], spreadBps:3, directionSupport:3 };
function watchPlan(o = {}) {
  return { valid:true, status:'WATCH', side:'LONG', originTF:'15m', ownerTF:'1h', vetoTFs:[], supportTFs:['15m'], confidence:48, why:'model WATCH', waitFor:'15m kapanışı 101 üstünde', ...o };
}
function accepted(tf, o = {}) { return uFrame(tf, { bos:'UP', close:101.6, hi:101, bx:{ status:'ACCEPTED', allowed:true }, ...o }); }

test('momentum coin tanımı: erken ilgi / top-3 yaklaşımı / volatilite; spread>8 veya zayıf yön momentum değil', () => {
  assert.equal(v111.isMomentumCandidate(momentumCandidate).momentum, true);
  assert.ok(v111.isMomentumCandidate(momentumCandidate).tags.includes('SRC_APP_EARLY_ATTENTION'));
  assert.equal(v111.isMomentumCandidate(plainCandidate).momentum, false);
  assert.equal(v111.isMomentumCandidate({ ...momentumCandidate, spreadBps:12 }).momentum, false);
  assert.equal(v111.isMomentumCandidate({ ...momentumCandidate, directionSupport:1 }).momentum, false);
  assert.equal(v111.isMomentumCandidate({ ...plainCandidate, range24hPct:18 }).momentum, true);
});

test('momentum coin: 1m kırılımı + 3m hizalı + 15m karşı değil → SCALP_MOMENTUM 1m tetiği', () => {
  const frames = Object.fromEntries(TFS.map(tf => [tf, uFrame(tf)]));
  frames['1m'] = accepted('1m');
  frames['15m'] = uFrame('15m', { longScore:40 }); // 15m destek değil ama taze ve karşı değil
  const u = unifiedOf(frames, 101.8);
  const dt = v111.laneAwareTrigger({ plan:watchPlan(), candidate:momentumCandidate, unified:u });
  assert.equal(dt.ok, true, JSON.stringify(dt.reasons));
  assert.equal(dt.tf, '1m');
  assert.equal(dt.laneName, 'SCALP_MOMENTUM');
  const q = v111.applyLaneTrigger(watchPlan(), dt);
  assert.equal(q.status, 'QUALIFIED');
  assert.equal(q.originTF, '1m');
  assert.match(q.waitFor, /^NONE — Claude v111/);
  const enforced = tradeLanes.enforceQualification(q, u, momentumCandidate);
  assert.equal(enforced.status, 'QUALIFIED', 'v110 hat kuralı: 2/3 alt TF + 15m karşı-veto yok');
});

test('aynı kurulum momentum olmayan coinde 1m ile QUALIFIED olmaz; 15m ana hat beklenir', () => {
  const frames = Object.fromEntries(TFS.map(tf => [tf, uFrame(tf)]));
  frames['1m'] = accepted('1m');
  frames['15m'] = uFrame('15m', { longScore:40 });
  const dt = v111.laneAwareTrigger({ plan:watchPlan(), candidate:plainCandidate, unified:unifiedOf(frames, 101.8) });
  assert.equal(dt.ok, false);
  assert.deepEqual(dt.reasons, ['DT_SCALP_NOT_MOMENTUM_COIN']);
  frames['15m'] = accepted('15m');
  const main = v111.laneAwareTrigger({ plan:watchPlan(), candidate:plainCandidate, unified:unifiedOf(frames, 101.8) });
  assert.equal(main.ok, true);
  assert.equal(main.tf, '15m');
  assert.equal(main.laneName, 'MAIN_15M');
});

test('15m sert karşı yapı scalp ve ana tetiği engeller (SHORT simetrik)', () => {
  const frames = Object.fromEntries(TFS.map(tf => [tf, uFrame(tf, { side:'SHORT' })]));
  frames['1m'] = uFrame('1m', { side:'SHORT', bos:'DOWN', close:98.4, lo:99, bx:{ status:'ACCEPTED', allowed:true } });
  frames['15m'] = uFrame('15m', { side:'SHORT', bos:'UP', close:101.5, hi:101, bx:{ status:'ACCEPTED', allowed:true }, longScore:70, shortScore:20 });
  const short = { ...momentumCandidate, side:'SHORT' };
  const dt = v111.laneAwareTrigger({ plan:watchPlan({ side:'SHORT' }), candidate:short, unified:unifiedOf(frames, 98.2) });
  assert.equal(dt.ok, false);
  assert.deepEqual(dt.reasons, ['DT_15M_HARD_OPPOSITION']);
  frames['15m'] = uFrame('15m', { side:'SHORT', longScore:30, shortScore:40 });
  const ok = v111.laneAwareTrigger({ plan:watchPlan({ side:'SHORT' }), candidate:short, unified:unifiedOf(frames, 98.2) });
  assert.equal(ok.ok, true, JSON.stringify(ok.reasons));
  assert.equal(ok.tf, '1m');
  assert.equal(ok.triggerLevelId, 'PRIOR20_LOW');
});

test('revalidationIntent yalnız worker DETERMINISTIC_NUMERIC tetiği ve açık escalation için üretilir', () => {
  const now = Date.now();
  const row = { symbol:'ABCUSDT', side:'LONG', workerState:'TRIGGERED', workerSource:'DETERMINISTIC_NUMERIC_TRIGGER', workerEscalatedAt:now - 1000, lastAnalyzedAt:now - 600000, triggerValid:true, triggerTF:'15m', triggerPrice:101, invalidationPrice:99 };
  assert.equal(v111.revalidationIntent(row, { now }).triggerPrice, 101);
  assert.equal(v111.revalidationIntent({ ...row, workerSource:'ROUTER' }, { now }), null);
  assert.equal(v111.revalidationIntent({ ...row, lastAnalyzedAt:now }, { now }), null);
  assert.equal(v111.revalidationIntent({ ...row, workerState:'WAIT' }, { now }), null);
});

function storedPlan(o = {}, ageMin = 10) {
  return {
    id:'j1', ts:Date.now() - ageMin * 60000,
    payload:{
      plan:watchPlan({ triggerTF:'15m', triggerLevelId:'PRIOR20_HIGH', invalidationLevelId:'PRIOR20_LOW', triggerSpec:{ valid:true, tf:'15m', triggerPrice:101, invalidationPrice:99, triggered:false }, timeframeDiagnostics:{ '15m':{ summary:'15m direnç 101', role:'SUPPORT' } }, ...o }),
      vision:{ ok:true, attached:9, required:9, frames:[] }
    }
  };
}
const intent = { symbol:'ABCUSDT', side:'LONG', triggerTF:'15m', triggerPrice:101, invalidationPrice:99, triggerLevelId:'PRIOR20_HIGH', invalidationLevelId:'PRIOR20_LOW' };

test('yeniden doğrulama: 15m kapanış tetik üstünde, invalidation sağlam, ana hat hazır → QUALIFIED (NONE —)', () => {
  const frames = Object.fromEntries(TFS.map(tf => [tf, uFrame(tf)]));
  frames['15m'] = accepted('15m');
  const r = v111.revalidateTrigger({ stored:storedPlan(), intent, candidate:plainCandidate, unified:unifiedOf(frames, 101.9) });
  assert.equal(r.ok, true, JSON.stringify(r.reasons));
  assert.equal(r.plan.status, 'QUALIFIED');
  assert.equal(r.plan.triggerSpec.triggerPrice, 101, 'saklanan sayısal tetik korunur');
  assert.equal(r.plan.triggerSpec.revalidated, true);
  assert.match(r.plan.waitFor, /^NONE — Claude v111 yeniden doğrulama/);
  assert.ok(r.plan.timeframeDiagnostics, 'Jev için saklanan 9TF Vision teşhisi korunur');
  assert.equal(require('../claude-v109').qualifiedWaitIsNone(r.plan.waitFor), true);
});

test('yeniden doğrulama reddi: fiyat geri döndü / invalidation / eski plan / model vetosu / zaten doğrulanmış', () => {
  const frames = Object.fromEntries(TFS.map(tf => [tf, uFrame(tf)]));
  frames['15m'] = accepted('15m');
  const u = unifiedOf(frames, 101.9);
  const back = v111.revalidateTrigger({ stored:storedPlan(), intent, candidate:plainCandidate, unified:unifiedOf(frames, 100.8) });
  assert.ok(back.reasons.includes('REVAL_PRICE_BACK_INSIDE_TRIGGER'));
  const f2 = { ...frames, '15m':accepted('15m', { close:98.5 }) };
  assert.ok(v111.revalidateTrigger({ stored:storedPlan(), intent, candidate:plainCandidate, unified:unifiedOf(f2, 101.9) }).reasons.includes('REVAL_INVALIDATION_BREACHED'));
  assert.ok(v111.revalidateTrigger({ stored:storedPlan({}, 500), intent, candidate:plainCandidate, unified:u }).reasons.includes('REVAL_STORED_PLAN_TOO_OLD'));
  assert.ok(v111.revalidateTrigger({ stored:storedPlan({ vetoTFs:['15m'] }), intent, candidate:plainCandidate, unified:u }).reasons.some(x => x.startsWith('REVAL_MODEL_VETO_ON_CRITICAL_TF')));
  assert.deepEqual(v111.revalidateTrigger({ stored:storedPlan({ claudeTriggerRevalidation:{ ok:true } }), intent, candidate:plainCandidate, unified:u }).reasons, ['REVAL_ALREADY_REVALIDATED_REQUIRES_FULL_9TF']);
  assert.ok(v111.revalidateTrigger({ stored:storedPlan({ status:'REJECT' }), intent, candidate:plainCandidate, unified:u }).reasons.includes('REVAL_STORED_PLAN_NOT_WATCH'));
});

test('scalp yeniden doğrulaması momentum coin + 2/3 alt TF ister', () => {
  const frames = Object.fromEntries(TFS.map(tf => [tf, uFrame(tf)]));
  frames['3m'] = accepted('3m');
  const scalpIntent = { ...intent, triggerTF:'3m' };
  const stored = storedPlan({ originTF:'3m', ownerTF:'15m', triggerTF:'3m', triggerSpec:{ valid:true, tf:'3m', triggerPrice:101, invalidationPrice:99 } }, 5);
  const ok = v111.revalidateTrigger({ stored, intent:scalpIntent, candidate:momentumCandidate, unified:unifiedOf(frames, 101.9) });
  assert.equal(ok.ok, true, JSON.stringify(ok.reasons));
  assert.equal(ok.plan.originTF, '3m');
  assert.equal(ok.info.laneName, 'SCALP_MOMENTUM');
  const no = v111.revalidateTrigger({ stored, intent:scalpIntent, candidate:plainCandidate, unified:unifiedOf(frames, 101.9) });
  assert.ok(no.reasons.includes('REVAL_SCALP_NOT_MOMENTUM_COIN'));
});

// ---------------- pipeline.run uçtan uca (Vision atlanır, Jev çağrılır) ----------------
function engineFrame(tf, o = {}) {
  return {
    available:true, frame:tf, asOf:Date.now() - 5000, closedCandles:120,
    close:o.close ?? 100, ema20:100, ema50:99, rsi14:55, atr14:0.5, atrPct:0.5, trend:'UP',
    prior20High:o.hi ?? 101, prior20Low:o.lo ?? 99, breakOfStructure:o.bos ?? null,
    buySideLiquidity:101, sellSideLiquidity:99, recentFairValueGaps:[], returnPct:0.4,
    candle:null, patterns:[], swingStructure:{ lastConfirmedSwingLow:{ price:99.5 }, lastConfirmedSwingHigh:{ price:100.8 } },
    liquidity:{ equalHigh:null, equalLow:null, lastSweep:null }, smcContext:{ available:false },
    opportunity:{ available:true, frame:tf, state:'WATCH', preferredSide:'LONG', longScore:o.longScore ?? 60, shortScore:20, originEligible:true, ownerEligible:true }
  };
}
function loadPipelineWithMarket(timeframes, mid) {
  const marketPath = require.resolve('../market');
  const pipelinePath = require.resolve('../pipeline');
  const real = require('../market');
  require.cache[marketPath].exports = {
    ...real,
    async symbolContext(symbol) { return { symbol, generatedAt:new Date().toISOString(), timeframes, microstructure:{ available:true, bid:mid - 0.01, ask:mid + 0.01, spreadBps:2 } }; },
    async globalContext() { return {}; },
    async chartContext() { throw new Error('VISION_MUST_NOT_RUN_IN_REVALIDATION'); }
  };
  delete require.cache[pipelinePath];
  const pipeline = require('../pipeline');
  require.cache[marketPath].exports = real;
  return pipeline;
}

test('pipeline.run: sayısal tetik yeniden doğrulaması BINDING modda Vision olmadan QUALIFIED üretir ve Jev çağrılır', async () => {
  setConfig({ deterministicTriggerMode:'BINDING' });
  const tfs = Object.fromEntries(TFS.map(tf => [tf, engineFrame(tf)]));
  tfs['15m'] = engineFrame('15m', { close:101.6, bos:'UP' });
  const pipeline = loadPipelineWithMarket(tfs, 101.9);
  const journal = [];
  let committeeCalls = 0, jevCalls = 0, jevSawPlan = null;
  const out = await pipeline.run({
    scan:{ leaders:[{ ...plainCandidate, attackRank:2, tradeQuality:70, longExpansionScore:60 }] },
    store:{ journal:(k, s, p) => { journal.push({ k, p }); return 'id-' + journal.length; }, latestJournal:(k, s) => k === 'PLAN' && s === 'ABCUSDT' ? storedPlan() : null },
    committee:async () => { committeeCalls++; throw new Error('committee must not run'); },
    decisionJudge:async ({ plan }) => { jevCalls++; jevSawPlan = plan; return { ok:true, configured:true, required:true, called:true, veto:false, probabilities:{ structuralVeto:0.1 }, timeframeConflicts:{} }; },
    executionIntent:{ symbol:'ABCUSDT', triggerRevalidation:intent }
  });
  assert.equal(committeeCalls, 0, '8 dk Vision atlandı');
  assert.equal(jevCalls, 1, 'karar Jev’e ulaştı');
  assert.equal(jevSawPlan.status, 'QUALIFIED');
  assert.equal(out.plan.status, 'QUALIFIED', JSON.stringify(out.plan.lanePolicyReasons || out.plan.reason));
  assert.equal(out.committee.mode, 'claude_v111_trigger_revalidation');
  assert.equal(out.vision.attached, 9);
  assert.ok(journal.some(x => x.k === 'CLAUDE_V111_REVALIDATION' && x.p.applied === true));
  assert.ok(journal.some(x => x.k === 'PLAN'));
  assert.equal(out.dryRunExecutor && typeof out.dryRunExecutor, 'object');
  setConfig();
});

test('pipeline.run: SHADOW modda yeniden doğrulama yalnız kaydedilir; tam 9TF yolu çalışır', async () => {
  setConfig({ deterministicTriggerMode:'SHADOW' });
  const tfs = Object.fromEntries(TFS.map(tf => [tf, engineFrame(tf)]));
  tfs['15m'] = engineFrame('15m', { close:101.6, bos:'UP' });
  const pipeline = loadPipelineWithMarket(tfs, 101.9);
  const journal = [];
  const out = await pipeline.run({
    scan:{ leaders:[{ ...plainCandidate, attackRank:2, tradeQuality:70, longExpansionScore:60 }] },
    store:{ journal:(k, s, p) => { journal.push({ k, p }); return 'id'; }, latestJournal:() => storedPlan() },
    committee:async () => { throw new Error('unused'); },
    executionIntent:{ symbol:'ABCUSDT', triggerRevalidation:intent }
  });
  const rv = journal.find(x => x.k === 'CLAUDE_V111_REVALIDATION');
  assert.equal(rv.p.ok, true);
  assert.equal(rv.p.applied, false);
  assert.notEqual(out.plan?.status, 'QUALIFIED');
  assert.equal(out.reason || out.plan?.reason, 'VISION_9TF_INCOMPLETE', 'tam 9TF yoluna döndü (test ortamında grafik yok)');
});

// ---------------- runner ----------------
test('runner fazı: TP1 → BREAKEVEN, TP2 → TRAILING, 0 → CLOSED', () => {
  const base = { initialQty:30, tpQty:[10,10,10], stepSize:1 };
  assert.equal(v111.runnerPhase({ ...base, remainingQty:30 }), 'INITIAL');
  assert.equal(v111.runnerPhase({ ...base, remainingQty:20 }), 'BREAKEVEN');
  assert.equal(v111.runnerPhase({ ...base, remainingQty:10 }), 'TRAILING');
  assert.equal(v111.runnerPhase({ ...base, remainingQty:0 }), 'CLOSED');
});

test('runner stop: başabaş + ücret, swing ile izleme, momentum merdiveni, asla genişlemez', () => {
  const cfg = v111.readConfig();
  const be = v111.desiredRunnerStop({ side:'LONG', phase:'BREAKEVEN', entryPrice:100, markPrice:102, currentStop:98, tickSize:0.01, config:cfg });
  assert.equal(be.ok, true);
  assert.ok(be.target > 100 && be.target < 100.2);
  const frames = { '5m':uFrame('5m', { swingLow:101.2, atrPct:0.3 }), '15m':uFrame('15m', { swingLow:100.9 }) };
  const tr = v111.desiredRunnerStop({ side:'LONG', phase:'TRAILING', entryPrice:100, markPrice:103, currentStop:be.target, frames, lane:{ momentumLadder:['1m','3m','5m'], exhausted:false }, originTF:'1m', tickSize:0.01, config:cfg });
  assert.equal(tr.ok, true);
  assert.equal(tr.trail.tf, '5m', 'momentum 5m\'e taşındı → 5m swing');
  assert.ok(tr.target < 101.2 && tr.target > 100.9);
  const widen = v111.desiredRunnerStop({ side:'LONG', phase:'TRAILING', entryPrice:100, markPrice:103, currentStop:101.5, frames, lane:{ momentumLadder:['5m'] }, originTF:'1m', tickSize:0.01, config:cfg });
  assert.equal(widen.ok, false);
  assert.equal(widen.reason, 'RUNNER_WOULD_NOT_TIGHTEN');
  const aboveMark = v111.desiredRunnerStop({ side:'LONG', phase:'BREAKEVEN', entryPrice:100, markPrice:100.05, currentStop:98, tickSize:0.01, config:cfg });
  assert.equal(aboveMark.ok, false);
  const shortTr = v111.desiredRunnerStop({ side:'SHORT', phase:'TRAILING', entryPrice:100, markPrice:97, currentStop:99.9, frames:{ '1m':uFrame('1m', { swingHigh:98.2 }) }, lane:{ momentumLadder:[], exhausted:true }, originTF:'3m', tickSize:0.01, config:cfg });
  assert.equal(shortTr.ok, true);
  assert.equal(shortTr.trail.tf, '1m', 'tükenmede 1m swinge sıkılaşır');
  assert.ok(shortTr.target > 98.2 && shortTr.target < 99.9);
});

// ---------------- transport: BINDING'de TP3 konmaz ----------------
test('transport BINDING runner modunda TP1/TP2 koyar, TP3 koymaz; stop closePosition kalır', async () => {
  const { BinanceLiveTransport } = require('../binance-live-transport');
  const posted = [];
  const reply = b => ({ ok:true, status:200, async text() { return JSON.stringify(b); } });
  const fetchImpl = async (url, opt = {}) => {
    const u = new URL(url);
    const params = new URLSearchParams(opt.body || u.search.slice(1));
    if (u.pathname === '/fapi/v1/time') return reply({ serverTime:Date.now() });
    if (u.pathname === '/fapi/v1/exchangeInfo') return reply({ symbols:[{ symbol:'ABCUSDT', status:'TRADING', contractType:'PERPETUAL', quoteAsset:'USDT', filters:[
      { filterType:'MARKET_LOT_SIZE', minQty:'1', maxQty:'100000', stepSize:'1' },
      { filterType:'PRICE_FILTER', minPrice:'0.01', maxPrice:'100000', tickSize:'0.01' },
      { filterType:'MIN_NOTIONAL', notional:'5' }] }] });
    if (u.pathname === '/fapi/v1/ticker/price') return reply({ price:'100' });
    if (u.pathname === '/fapi/v1/positionSide/dual') return reply({ dualSidePosition:false });
    if (u.pathname === '/fapi/v3/positionRisk') return reply([{ symbol:'ABCUSDT', positionAmt:'0', leverage:'5', positionSide:'BOTH' }]);
    if (u.pathname === '/fapi/v1/order') { posted.push({ path:u.pathname, type:params.get('type') }); return reply({ orderId:1, executedQty:'30', status:'FILLED' }); }
    if (u.pathname === '/fapi/v1/algoOrder') { posted.push({ path:u.pathname, type:params.get('type'), closePosition:params.get('closePosition'), quantity:params.get('quantity') }); return reply({ algoId:posted.length }); }
    throw new Error('unexpected ' + u.pathname);
  };
  const registry = { consume:() => ({ ok:true, liveAllowed:true }) };
  const t = new BinanceLiveTransport({ registry, fetchImpl });
  const order = { action:'OPEN', symbol:'ABCUSDT', side:'LONG', orderType:'MARKET', quantity:30, entryPrice:100, stopPrice:98, takeProfit1:102, takeProfit2:104, takeProfit3:106, clientOrderId:'LHABCL1', lineageId:'L1' };
  const r = await t.submit({ grantId:'g', order, credentials:{ apiKey:'k'.repeat(10), apiSecret:'s'.repeat(10) }, livePolicy:{ expectedLeverage:5, maxEntryDeviationPct:1, runnerMode:'BINDING' } });
  assert.equal(r.execution, 'LIVE_ENTRY_FULLY_PROTECTED', JSON.stringify(r.reasons));
  const algo = posted.filter(x => x.path === '/fapi/v1/algoOrder');
  assert.equal(algo.filter(x => x.type === 'STOP_MARKET' && x.closePosition === 'true').length, 1);
  assert.equal(algo.filter(x => x.type === 'TAKE_PROFIT_MARKET').length, 2);
  assert.equal(r.runner.enabled, true);
  assert.equal(r.runner.quantity, 10);
  assert.deepEqual(r.tpQuantities, [10,10,10]);
});

// ---------------- controller runner döngüsü (Binance taklidi) ----------------
function runnerFixture(t, mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-v111-runner-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  fs.mkdirSync(path.join(root, 'config'), { recursive:true });
  fs.writeFileSync(path.join(root, 'config', 'claude-v111.json'), JSON.stringify({ runnerMode:mode }));
  const prevRoot = process.env.BRAINHUB_ROOT;
  process.env.BRAINHUB_ROOT = root; v111.resetConfigCache();
  t.after(() => { process.env.BRAINHUB_ROOT = prevRoot; v111.resetConfigCache(); });
  const state = { qty:30, mark:101, now:Date.now(), algo:0 };
  const writes = [];
  const reply = b => ({ ok:true, status:200, async text() { return JSON.stringify(b); } });
  const fetchImpl = async (url, opt = {}) => {
    const u = new URL(url);
    const method = opt.method || 'GET';
    const params = new URLSearchParams(method === 'GET' ? u.search.slice(1) : (opt.body || ''));
    if (u.pathname === '/fapi/v1/time') return reply({ serverTime:state.now });
    if (u.pathname === '/fapi/v1/positionSide/dual') return reply({ dualSidePosition:false });
    if (u.pathname === '/fapi/v3/positionRisk') return reply([{ symbol:'ABCUSDT', positionSide:'BOTH', positionAmt:String(state.qty), entryPrice:'100', markPrice:String(state.mark) }]);
    if (u.pathname === '/fapi/v1/exchangeInfo') return reply({ symbols:[{ symbol:'ABCUSDT', filters:[{ filterType:'MARKET_LOT_SIZE', stepSize:'1', minQty:'1', maxQty:'100000' }, { filterType:'PRICE_FILTER', tickSize:'0.01', minPrice:'0.01', maxPrice:'100000' }] }] });
    if (u.pathname === '/fapi/v1/algoOrder' && method === 'POST') { state.algo++; writes.push({ op:'POST', type:params.get('type'), qty:params.get('quantity'), trigger:Number(params.get('triggerPrice')), reduceOnly:params.get('reduceOnly'), closePosition:params.get('closePosition'), id:'R' + state.algo }); return reply({ algoId:'R' + state.algo }); }
    if (u.pathname === '/fapi/v1/algoOrder' && method === 'DELETE') { writes.push({ op:'DELETE', algoId:params.get('algoId') }); return reply({ code:200 }); }
    throw new Error('unexpected ' + method + ' ' + u.pathname);
  };
  const pipelineReal = require('../pipeline');
  const market = {
    async symbolContext(symbol) {
      const tfs = Object.fromEntries(TFS.map(tf => [tf, { ...engineFrame(tf), asOf:state.now - 5000, swingStructure:{ lastConfirmedSwingLow:{ price:tf === '5m' ? 102.4 : 101.0 }, lastConfirmedSwingHigh:{ price:105 } } }]));
      return { symbol, timeframes:tfs, microstructure:{ available:true, bid:state.mark - 0.01, ask:state.mark + 0.01 } };
    },
    async globalContext() { return {}; }
  };
  const { createLiveController } = require('../live-controller');
  const journal = [];
  const controller = createLiveController({
    root, credentials:{ apiKey:'test-api-key', apiSecret:'test-api-secret' }, fetchImpl, clock:() => state.now, market,
    store:{ journal:(k, s, p) => { journal.push({ k, p }); return 'id'; } },
    scanner:{ async scan() { throw new Error('unused'); } },
    pipeline:{ buildUnifiedContext:pipelineReal.buildUnifiedContext, async run() { throw new Error('unused'); } },
    committee:async () => ({})
  });
  controller._testRegisterRunner({
    intent:{ symbol:'ABCUSDT', side:'LONG', entryPrice:100, stopPrice:98, takeProfit3:106, originTF:'5m' },
    result:{ symbol:'ABCUSDT', side:'LONG', executedQty:30, tpQuantities:[10,10,10], stopAlgoId:'S1', tpAlgoIds:['T1','T2'], runner:{ enabled:mode === 'BINDING' }, stopProtected:true },
    mode
  });
  return { state, writes, controller, journal };
}

test('runner BINDING: TP1→başabaş stop, TP2→swing izleme (yalnız sıkılaşır), kapanınca artık emirler iptal', async t => {
  const { state, writes, controller } = runnerFixture(t, 'BINDING');
  await controller.runnerTick();
  assert.equal(writes.length, 0, 'TP1 dolmadan dokunulmaz');
  state.qty = 20; state.mark = 102;
  await controller.runnerTick();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].type, 'STOP_MARKET');
  assert.equal(writes[0].reduceOnly, 'true');
  assert.equal(writes[0].closePosition, null, 'yeni stop closePosition değil (orijinal yedek stop kalır)');
  assert.equal(writes[0].qty, '20');
  assert.ok(writes[0].trigger > 100 && writes[0].trigger < 100.2, 'başabaş + ücret');
  state.qty = 10; state.mark = 104; state.now += 60000;
  await controller.runnerTick();
  const trail = writes.filter(x => x.op === 'POST');
  assert.equal(trail.length, 2);
  assert.ok(trail[1].trigger > writes[0].trigger, 'stop yalnız sıkılaşır');
  assert.equal(trail[1].qty, '10');
  assert.ok(writes.some(x => x.op === 'DELETE' && x.algoId === 'R1'), 'önceki runner stop iptal');
  assert.equal(writes.some(x => x.op === 'DELETE' && x.algoId === 'S1'), false, 'orijinal stop açıkken iptal edilmez');
  state.qty = 0; state.now += 60000;
  await controller.runnerTick();
  const deleted = writes.filter(x => x.op === 'DELETE').map(x => x.algoId);
  for (const id of ['R2','T1','T2','S1']) assert.ok(deleted.includes(id), 'kapanışta artık emir iptal: ' + id);
  assert.equal(controller.runnerStatus().rows[0].phase, 'CLOSED');
});

test('runner SHADOW: Binance’e hiçbir yazma isteği gitmez, yalnız hedef stop kaydedilir', async t => {
  const { state, writes, controller, journal } = runnerFixture(t, 'SHADOW');
  state.qty = 20; state.mark = 102;
  await controller.runnerTick();
  state.qty = 0;
  await controller.runnerTick();
  assert.equal(writes.length, 0);
  assert.ok(journal.some(x => x.k === 'CLAUDE_V111_RUNNER' && x.p.kind === 'SHADOW_STOP'));
});

// ---------------- Leader AUTO: sayısal tetik → yeniden doğrulama önceliği (5 dk soğuma yok) ----------------
test('Leader AUTO sayısal tetikli satırı ilk sıraya alır ve pipeline’a triggerRevalidation geçirir', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-v111-leader-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  fs.mkdirSync(path.join(root, 'data'), { recursive:true });
  fs.mkdirSync(path.join(root, 'config'), { recursive:true });
  const now = Date.now();
  fs.writeFileSync(path.join(root, 'data', 'leader-analysis-state.json'), JSON.stringify({ version:1, updatedAt:now, cursor:0, bySymbol:{
    ABCUSDT:{ symbol:'ABCUSDT', side:'LONG', state:'WATCH', setupId:'LHSET:ABCUSDT:LONG:abc:def', planStatus:'WATCH', detectedAt:now - 3600000,
      workerState:'TRIGGERED', workerSource:'DETERMINISTIC_NUMERIC_TRIGGER', workerEscalatedAt:now - 1000, lastAnalyzedAt:now - 120000,
      triggerValid:true, triggerTF:'15m', triggerPrice:101, invalidationPrice:99, triggerLevelId:'PRIOR20_HIGH', invalidationLevelId:'PRIOR20_LOW', reanalysisEligible:true }
  } }));
  const other = { symbol:'XYZUSDT', side:'LONG', attackRank:1, spreadBps:2, tradeQuality:70, directionSupport:3, longExpansionScore:60 };
  const target = { ...plainCandidate, attackRank:2, tradeQuality:70, longExpansionScore:60 };
  const runs = [];
  const { createLiveController } = require('../live-controller');
  const controller = createLiveController({
    root, credentials:{}, clock:() => now,
    store:{ journal() { return 'id'; } },
    scanner:{ async scan() { return { leaders:[other, target] }; } },
    pipeline:{ async run(args) {
      runs.push(args);
      return { ok:true, candidateFound:true, candidate:target,
        plan:{ valid:true, status:'QUALIFIED', side:'LONG', originTF:'15m', ownerTF:'15m', claudeTriggerRevalidation:{ ok:true }, jevDecision:{ called:true, veto:false } },
        jevDecision:{ called:true, veto:false },
        unifiedContext:{ livePrice:101.9, frames:{}, dataQuality:{ advisoryUsable:true }, opportunityPaths:{} },
        committee:{ mode:'claude_v111_trigger_revalidation', available:true }, vision:{ attached:9, required:9 } };
    } },
    committee:async () => { throw new Error('worker must not run for an unresolved escalation'); }
  });
  const out = await controller.executeLeader({ analysisOnly:true, allowLong:true, allowShort:false });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].executionIntent.symbol, 'ABCUSDT', 'tetiklenen coin 1. sıradaki coinin önüne geçti');
  assert.equal(runs[0].executionIntent.triggerRevalidation.triggerPrice, 101);
  assert.equal(out.execution, 'LEADER_AUTO_WAIT_ARM', 'LIVE kapalı: yalnız analiz, emir yok');
  const h = controller.status().leaderAuto?.health || controller.leaderAutoStatus().health || {};
  assert.equal(h.claudeV111?.revalidated, 1);
  assert.equal(h.claudeV111?.jevCalledAfterCode, 1);
});
