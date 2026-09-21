'use strict';
// =====================================================================
// CLAUDE_V111 — Bu dosya Claude (Anthropic, Cowork) tarafından v9.5.111-CLAUDE için
// yazıldı. Temel: ChatGPT'nin v9.5.110 multilane sürümü (futures15m-alarm-public-build
// @0bbabcf). ChatGPT ve diğer ajanlar için işaret: "CLAUDE_V111" etiketli her değişiklik
// brainhub/CLAUDE_V111_CHANGES.md dosyasında gerekçesiyle açıklanmıştır.
//
// Kullanıcı kuralı (21 Eylül): 15m ana işlem bölgesi. 1m/3m/5m tek başına karar vermez;
// fakat volatil / erken ilgi / çok konuşulan / top sıralamaya aday (momentum) coinlerde
// 1m/3m/5m scalp fırsatı ajanlar tarafından değerlendirilmeli ve momentum tükenene kadar
// zaman dilimleri boyunca taşınabilmeli (LONG ve SHORT simetrik). Ayrıca: analist (4B
// Vision) grafiği yorumlayamazsa Jev hiç karar görmüyordu — şimdiye kadar ajanlar/workerlar
// Jev'e tek bir karar götürmedi.
//
// Bu modül:
//  1) laneAwareTrigger: kapanmış-mum kırılımını v110 işlem hatlarına göre seçer
//     (momentum coin + 2/3 alt TF hizalı → 1m/3m/5m; aksi halde yalnız 15m ana hat).
//  2) revalidateTrigger: worker sayısal tetiği gördüğünde 8 dk'lık tam Vision yerine
//     saklanan 9TF planını taze kapanmış mum + hat + invalidation ile yeniden doğrular;
//     geçerse plan QUALIFIED olur ve Jev'e gider. JEV son stratejik karardır; onaydan sonra yalnız hard safety kalır.
//  3) Runner: TP3 yerine iz süren stop. TP1 → stop başabaşa; TP2 → kalan kısım momentum
//     merdiveninin en yüksek destekleyen TF'sindeki onaylı swing ile izlenir; asla genişlemez.
//     Orijinal closePosition stop hiç iptal edilmez (yedek koruma).
// Hiçbir fonksiyon giriş emri göndermez; LIVE'ı yalnız kullanıcı açar.
// =====================================================================

const fs = require('fs');
const path = require('path');
const tradeLanes = require('./trade-lanes');
const claudeV109 = require('./claude-v109');

const CLAUDE_V111 = Object.freeze({
  marker: 'CLAUDE_V111',
  featureVersion: '9.5.111-CLAUDE-VISION',
  builtBy: 'Claude (Anthropic) • Cowork • 2026-09-21 • ChatGPT v9.5.110 (0bbabcf) üzerine',
  baseBranch: 'futures15m-alarm-public-build@0bbabcf (ChatGPT v9.5.110 multilane)',
  changesDoc: 'brainhub/CLAUDE_V111_CHANGES.md',
  features: [
    'CLAUDE_V111_BUILD',
    'CLAUDE_V111_MOMENTUM_SCALP_TRIGGER',
    'CLAUDE_V111_LANE_ENFORCED_AFTER_DT',
    'CLAUDE_V111_TRIGGER_REVALIDATION',
    'CLAUDE_V111_JEV_FINAL_AUTHORITY',
    'CLAUDE_V111_TRAILING_RUNNER',
    'CLAUDE_V111_RUNNER_NEVER_WIDEN',
    'CLAUDE_V111_RUNNER_TP3_FALLBACK',
    'CLAUDE_V111_UPDATER_FILESET'
  ]
});

const FRAMES = ['1m','3m','5m','15m','30m','45m','1h','4h','1d'];
const LOWER = ['1m','3m','5m'];
// İz süren stop yalnız bu TF'lerde yürür (4h/1d stopu likidasyona yaklaştırır).
const TRAIL_TFS = ['1m','3m','5m','15m','30m','1h'];

const DEFAULT_CONFIG = Object.freeze({
  // Worker sayısal tetiği → saklanan 9TF planını hızlı yeniden doğrula (Vision'sız).
  // Uygulanması claude-v109.json deterministicTriggerMode'a bağlıdır: SHADOW=yalnız kayıt, BINDING=Jev'e git.
  triggerRevalidation: true,
  revalidationMaxAgeMinScalp: 20,
  revalidationMaxAgeMinMain: 120,
  // Momentum coinlerde 1m/3m/5m kapanmış-mum tetiği (2/3 hizalı + 15m sert karşı-veto yok).
  momentumScalpTriggers: true,
  // OFF | SHADOW | BINDING. BINDING: girişte TP3 konmaz; runner iz süren stopla yönetilir.
  runnerMode: 'SHADOW',
  runnerBreakevenBufferPct: 0.12,
  runnerMinImprovePct: 0.08,
  runnerReplaceCooldownSec: 45,
  runnerAtrBufferMultiple: 0.15,
  runnerMaxFailuresBeforeTp3: 3,
  // CLAUDE_V112: runner payı. TWO_THIRDS = TP1 (1/3, 1R) sonrası kalan 2/3 momentum bozulana kadar iz sürer;
  // ONE_THIRD = v111 davranışı (TP1 + TP2, son 1/3 runner).
  runnerShare: 'TWO_THIRDS',
  // CLAUDE_V112_SCALP_FAST_LANE: OFF | SHADOW | BINDING. Vision beklemeden momentum scalp → Jev.
  scalpFastLane: 'SHADOW',
  fastLaneMaxSymbolsPerTick: 3,
  fastLaneSymbolCooldownMin: 5,
  // CLAUDE_V112_WORKER_SCALP_EVERY_TICK: 30 sn'de ek kontrol edilen alt-TF sayısal tetik planı sayısı.
  workerScalpPerTick: 3
});

let cache = { at:0, file:null, value:DEFAULT_CONFIG };
function configPath() {
  const root = process.env.BRAINHUB_ROOT || path.resolve(__dirname, '..');
  return path.join(root, 'config', 'claude-v111.json');
}
function readConfig(now = Date.now()) {
  const file = configPath();
  if (cache.file === file && now - cache.at < 30000) return cache.value;
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch {}
  const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  const mode = String(raw.runnerMode || DEFAULT_CONFIG.runnerMode).toUpperCase();
  const value = Object.freeze({
    triggerRevalidation: raw.triggerRevalidation === undefined ? DEFAULT_CONFIG.triggerRevalidation : raw.triggerRevalidation === true,
    revalidationMaxAgeMinScalp: num(raw.revalidationMaxAgeMinScalp, DEFAULT_CONFIG.revalidationMaxAgeMinScalp, 3, 60),
    revalidationMaxAgeMinMain: num(raw.revalidationMaxAgeMinMain, DEFAULT_CONFIG.revalidationMaxAgeMinMain, 15, 360),
    momentumScalpTriggers: raw.momentumScalpTriggers === undefined ? DEFAULT_CONFIG.momentumScalpTriggers : raw.momentumScalpTriggers === true,
    runnerMode: ['OFF','SHADOW','BINDING'].includes(mode) ? mode : DEFAULT_CONFIG.runnerMode,
    runnerBreakevenBufferPct: num(raw.runnerBreakevenBufferPct, DEFAULT_CONFIG.runnerBreakevenBufferPct, 0.02, 1),
    runnerMinImprovePct: num(raw.runnerMinImprovePct, DEFAULT_CONFIG.runnerMinImprovePct, 0.01, 2),
    runnerReplaceCooldownSec: num(raw.runnerReplaceCooldownSec, DEFAULT_CONFIG.runnerReplaceCooldownSec, 15, 600),
    runnerAtrBufferMultiple: num(raw.runnerAtrBufferMultiple, DEFAULT_CONFIG.runnerAtrBufferMultiple, 0, 1.5),
    runnerMaxFailuresBeforeTp3: num(raw.runnerMaxFailuresBeforeTp3, DEFAULT_CONFIG.runnerMaxFailuresBeforeTp3, 1, 10),
    runnerShare: String(raw.runnerShare || DEFAULT_CONFIG.runnerShare).toUpperCase() === 'ONE_THIRD' ? 'ONE_THIRD' : 'TWO_THIRDS',
    scalpFastLane: ['OFF','SHADOW','BINDING'].includes(String(raw.scalpFastLane || '').toUpperCase()) ? String(raw.scalpFastLane).toUpperCase() : DEFAULT_CONFIG.scalpFastLane,
    fastLaneMaxSymbolsPerTick: Math.round(num(raw.fastLaneMaxSymbolsPerTick, DEFAULT_CONFIG.fastLaneMaxSymbolsPerTick, 1, 6)),
    fastLaneSymbolCooldownMin: num(raw.fastLaneSymbolCooldownMin, DEFAULT_CONFIG.fastLaneSymbolCooldownMin, 1, 60),
    workerScalpPerTick: Math.round(num(raw.workerScalpPerTick, DEFAULT_CONFIG.workerScalpPerTick, 0, 6))
  });
  cache = { at:now, file, value };
  return value;
}
function resetConfigCache() { cache = { at:0, file:null, value:DEFAULT_CONFIG }; }

function finite(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const uniq = xs => [...new Set(xs)];
const lc = v => String(v || '').trim().toLowerCase();

// ---------------------------------------------------------------------
// 1) Momentum coin tanımı (kullanıcı: volatil, erken ilgi, çok konuşulan, top sıralamaya aday)
// ---------------------------------------------------------------------
const MOMENTUM_STATES = new Set(['TOP3_APPROACH','TOP5_CONFIRMED','TOP10_APPROACH','EARLY_TOP5','EARLY_EXPANSION','RISING']);
const MOMENTUM_SOURCES = new Set(['APP_EARLY_ATTENTION','LIGHTWEIGHT_NEW_ACCELERATION','LIGHTWEIGHT_ACCELERATION','BINANCE_TOP24_GAINER']);
function isMomentumCandidate(candidate, lane = null) {
  const c = candidate && typeof candidate === 'object' ? candidate : {};
  const tags = [];
  const state = String(c.leaderState || '').toUpperCase();
  if (MOMENTUM_STATES.has(state)) tags.push('STATE_' + state);
  for (const s of Array.isArray(c.targetSources) ? c.targetSources : []) {
    const u = String(s || '').toUpperCase();
    if (MOMENTUM_SOURCES.has(u)) tags.push('SRC_' + u);
  }
  const r24 = finite(c.range24hPct);
  if (r24 !== null && r24 >= 12) tags.push('VOLATILE_24H');
  const r1 = finite(c.avgRange1mPct);
  if (r1 !== null && r1 >= 0.35) tags.push('VOLATILE_1M');
  if (lane?.priority === true) tags.push('LANE_PRIORITY');
  const spread = finite(c.spreadBps);
  const direction = finite(c.directionSupport);
  const spreadOk = spread === null || spread <= 8;
  const directionOk = direction === null || direction >= 2;
  return { momentum: tags.length > 0 && spreadOk && directionOk, tags: uniq(tags), spreadOk, directionOk };
}

function compactLane(lane) {
  if (!lane || typeof lane !== 'object') return null;
  return {
    stage: lane.stage || null,
    lowerSupportTfs: Array.isArray(lane.lowerSupportTfs) ? lane.lowerSupportTfs : [],
    scalpReady: lane.scalpReady === true,
    main15Ready: lane.main15Ready === true,
    hard15mVeto: lane.hard15mVeto === true,
    exhausted: lane.exhausted === true,
    momentumLadder: Array.isArray(lane.momentumLadder) ? lane.momentumLadder : [],
    highestSupportTf: lane.highestSupportTf || null,
    priority: lane.priority === true
  };
}

// ---------------------------------------------------------------------
// 2) Hat-farkında kapanmış-mum tetiği (v109 DT yerine)
// ---------------------------------------------------------------------
function laneAwareTrigger({ plan, candidate, unified, config = readConfig() } = {}) {
  const reasons = [];
  const side = String(plan?.side || '').toUpperCase();
  const status = String(plan?.status || '').toUpperCase();
  const candidateSide = String(candidate?.side || '').toUpperCase();
  if (!['LONG','SHORT'].includes(side)) reasons.push('DT_SIDE_INVALID');
  if (candidateSide && side && candidateSide !== side) reasons.push('DT_MODEL_SIDE_DIFFERS_FROM_SCANNER');
  if (status === 'REJECT') reasons.push('DT_MODEL_REJECTED');
  if (!['WATCH','QUALIFIED'].includes(status)) reasons.push('DT_PLAN_NOT_WATCH_OR_QUALIFIED');
  if (plan?.valid !== true) reasons.push('DT_PLAN_CONTRACT_INVALID');
  if (!unified?.dataQuality?.advisoryUsable) reasons.push('DT_CONTEXT_NOT_USABLE');
  const live = finite(unified?.livePrice);
  if (live === null) reasons.push('DT_LIVE_PRICE_MISSING');
  const vetoSet = new Set((Array.isArray(plan?.vetoTFs) ? plan.vetoTFs : []).map(lc));
  for (const tf of [plan?.originTF, plan?.ownerTF].map(lc)) {
    if (tf && vetoSet.has(tf)) reasons.push('DT_MODEL_ORIGIN_OWNER_VETO:' + tf);
  }
  if (reasons.length) return { ok:false, reasons:uniq(reasons) };

  const lane = tradeLanes.analyzeTradeLanes(unified, side, candidate);
  const momentum = isMomentumCandidate(candidate, lane);
  const laneInfo = compactLane(lane);
  if (lane.hard15mVeto) return { ok:false, reasons:['DT_15M_HARD_OPPOSITION'], lane:laneInfo, momentum };
  const order = [];
  if (config.momentumScalpTriggers && momentum.momentum && lane.scalpReady) {
    for (const tf of tradeLanes.scalpTriggerPreference(lane)) order.push({ tf, laneName:'SCALP_MOMENTUM' });
  }
  if (lane.main15Ready) order.push({ tf:'15m', laneName:'MAIN_15M' });
  if (!order.length) {
    const why = lane.scalpReady && !momentum.momentum ? 'DT_SCALP_NOT_MOMENTUM_COIN' : 'DT_NO_READY_TRADE_LANE';
    return { ok:false, reasons:[why], lane:laneInfo, momentum };
  }
  for (const c of order) {
    if (vetoSet.has(c.tf)) continue;
    const f = unified?.frames?.[c.tf];
    if (!claudeV109.acceptedBreakout(f, side)) continue;
    const level = side === 'LONG' ? finite(f.prior20High) : finite(f.prior20Low);
    if (level === null) continue;
    if (!(side === 'LONG' ? live > level : live < level)) continue;
    const ownerTF = c.laneName === 'MAIN_15M'
      ? '15m'
      : (lane.main15Ready ? '15m' : (lane.lowerSupportTfs.at(-1) || c.tf));
    return {
      ok:true, tf:c.tf, ownerTF, laneName:c.laneName, level,
      triggerLevelId: side === 'LONG' ? 'PRIOR20_HIGH' : 'PRIOR20_LOW',
      invalidationLevelId: side === 'LONG' ? 'PRIOR20_LOW' : 'PRIOR20_HIGH',
      closedClose: finite(f.close), livePrice: live,
      status: String(f?.breakoutExecution?.status || ''),
      lane: laneInfo, momentum, reasons:[]
    };
  }
  return { ok:false, reasons:['DT_NO_CLOSED_CANDLE_BREAKOUT_ON_LANE_TF'], lane:laneInfo, momentum };
}

function applyLaneTrigger(plan, dt) {
  if (!plan || !dt?.ok) return plan;
  const base = claudeV109.applyDeterministicTrigger(plan, dt);
  if (String(plan.status || '').toUpperCase() === 'QUALIFIED') return base;
  const dir = String(plan.side || '').toUpperCase() === 'SHORT' ? '<' : '>';
  return {
    ...base,
    originTF: dt.tf,
    ownerTF: dt.ownerTF,
    triggerTF: dt.tf,
    triggerLevelId: dt.triggerLevelId,
    invalidationLevelId: dt.invalidationLevelId,
    waitFor: `NONE — Claude v111 kod-tetik: ${dt.tf} kapanışı ${dt.closedClose} ${dir} ${dt.level} (${dt.laneName})`,
    why: `[Claude v111 ${dt.laneName}: ${dt.tf} kapanmış mum kırılımı kabul edildi (${dt.status}); canlı ${dt.livePrice}${dt.momentum?.tags?.length ? '; momentum: ' + dt.momentum.tags.join(',') : ''}] ` + String(plan.why || ''),
    execPath: 'CLAUDE_V111_LANE_CLOSED_CANDLE_BREAKOUT',
    reason: 'CLAUDE_V111_DETERMINISTIC_TRIGGER',
    claudeDeterministicTrigger: { ...dt, applied:true, mode:'BINDING', version:'CLAUDE_V111' }
  };
}

// ---------------------------------------------------------------------
// 3) Sayısal tetik → hızlı yeniden doğrulama → Jev
// ---------------------------------------------------------------------
function revalidationIntent(row, { now = Date.now(), config = readConfig() } = {}) {
  if (!config.triggerRevalidation || !row || typeof row !== 'object') return null;
  const state = String(row.workerState || '').toUpperCase();
  const source = String(row.workerSource || '').toUpperCase();
  const side = String(row.side || '').toUpperCase();
  if (state !== 'TRIGGERED' || !source.startsWith('DETERMINISTIC_NUMERIC')) return null;
  if (!(Number(row.workerEscalatedAt || 0) >= Number(row.lastAnalyzedAt || 0))) return null;
  if (row.triggerValid !== true || !['LONG','SHORT'].includes(side)) return null;
  const tf = lc(row.triggerTF);
  const triggerPrice = finite(row.triggerPrice);
  if (!FRAMES.includes(tf) || triggerPrice === null) return null;
  const escalatedAt = Number(row.workerEscalatedAt || 0);
  if (escalatedAt > 0 && now - escalatedAt > 30 * 60000) return null;
  return {
    symbol: String(row.symbol || '').toUpperCase(),
    side, triggerTF: tf, triggerPrice,
    invalidationPrice: finite(row.invalidationPrice),
    triggerLevelId: row.triggerLevelId || null,
    invalidationLevelId: row.invalidationLevelId || null,
    tradeLaneName: row.tradeLaneName || null,
    escalatedAt: escalatedAt || null
  };
}

// Piyasa verisi gerektirmeyen ön kontrol (Leader AUTO sıralayıcısı 5 dk soğumayı yalnız bu geçerse atlar).
function revalidationPrecheck({ stored, intent, now = Date.now(), config = readConfig() } = {}) {
  const r = revalidateTrigger({ stored, intent, candidate:null, unified:{ dataQuality:{ advisoryUsable:true } }, now, config, precheckOnly:true });
  return { ok:r.ok === true, reasons:r.reasons || [] };
}

function revalidateTrigger({ stored, intent, candidate, unified, now = Date.now(), config = readConfig(), precheckOnly = false } = {}) {
  const reasons = [];
  const rawPlan = stored?.plan ?? stored?.payload?.plan;
  const plan = rawPlan && typeof rawPlan === 'object' ? rawPlan : null;
  const storedAt = finite(stored?.ts);
  if (!plan) return { ok:false, reasons:['REVAL_STORED_PLAN_MISSING'] };
  // Jev'in daha önce gördüğü yeniden doğrulanmış plan tekrar hızlı yoldan geçmez: tam 9TF gerekir.
  if (plan.claudeTriggerRevalidation?.ok === true && plan.claudeTriggerRevalidation?.applied !== false) return { ok:false, reasons:['REVAL_ALREADY_REVALIDATED_REQUIRES_FULL_9TF'] };
  const side = String(plan.side || '').toUpperCase();
  if (!['LONG','SHORT'].includes(side)) reasons.push('REVAL_SIDE_INVALID');
  const iSide = String(intent?.side || '').toUpperCase();
  if (iSide && iSide !== side) reasons.push('REVAL_TRACKED_SIDE_MISMATCH');
  const cSide = String(candidate?.side || '').toUpperCase();
  if (cSide && cSide !== side) reasons.push('REVAL_SCANNER_SIDE_MISMATCH');
  if (String(plan.status || '').toUpperCase() !== 'WATCH') reasons.push('REVAL_STORED_PLAN_NOT_WATCH');
  if (plan.valid !== true) reasons.push('REVAL_STORED_PLAN_CONTRACT_INVALID');
  const spec = plan.triggerSpec && typeof plan.triggerSpec === 'object' ? plan.triggerSpec : {};
  const tf = lc(intent?.triggerTF || spec.tf || plan.triggerTF);
  const triggerPrice = finite(intent?.triggerPrice ?? spec.triggerPrice);
  const invalidationPrice = finite(intent?.invalidationPrice ?? spec.invalidationPrice);
  if (spec.valid !== true) reasons.push('REVAL_TRIGGER_SPEC_INVALID');
  if (!FRAMES.includes(tf) || triggerPrice === null) reasons.push('REVAL_TRIGGER_MISSING');
  const specPrice = finite(spec.triggerPrice);
  if (specPrice !== null && triggerPrice !== null && Math.abs(specPrice - triggerPrice) > Math.abs(triggerPrice) * 1e-6) reasons.push('REVAL_TRIGGER_CHANGED_SINCE_PLAN');
  if (lc(spec.tf) && tf && lc(spec.tf) !== tf) reasons.push('REVAL_TRIGGER_TF_CHANGED_SINCE_PLAN');
  if (!unified?.dataQuality?.advisoryUsable) reasons.push('REVAL_CONTEXT_NOT_USABLE');
  const scalp = LOWER.includes(tf);
  const maxAgeMin = scalp ? config.revalidationMaxAgeMinScalp : config.revalidationMaxAgeMinMain;
  const ageMin = storedAt === null ? null : (now - storedAt) / 60000;
  if (ageMin === null || ageMin < 0 || ageMin > maxAgeMin) reasons.push('REVAL_STORED_PLAN_TOO_OLD');
  const vetoSet = new Set((Array.isArray(plan.vetoTFs) ? plan.vetoTFs : []).map(lc));
  for (const x of uniq([lc(plan.originTF), lc(plan.ownerTF), tf]).filter(Boolean)) {
    if (vetoSet.has(x)) reasons.push('REVAL_MODEL_VETO_ON_CRITICAL_TF:' + x);
  }
  if (reasons.length) return { ok:false, reasons:uniq(reasons) };
  if (precheckOnly) return { ok:true, reasons:[] };

  const f = unified?.frames?.[tf];
  const close = finite(f?.close);
  const live = finite(unified?.livePrice);
  const beyond = (p, lvl) => side === 'LONG' ? p > lvl : p < lvl;
  if (!f?.available || f.fresh !== true || close === null) reasons.push('REVAL_TRIGGER_FRAME_NOT_FRESH');
  else {
    if (!beyond(close, triggerPrice)) reasons.push('REVAL_CLOSED_CANDLE_NOT_BEYOND_TRIGGER');
    if (invalidationPrice !== null && !beyond(close, invalidationPrice)) reasons.push('REVAL_INVALIDATION_BREACHED');
    if (String(f.breakoutExecution?.status || '').toUpperCase() === 'FAILED_BREAKOUT') reasons.push('REVAL_FAILED_BREAKOUT');
  }
  if (live === null) reasons.push('REVAL_LIVE_PRICE_MISSING');
  else if (!beyond(live, triggerPrice)) reasons.push('REVAL_PRICE_BACK_INSIDE_TRIGGER');
  const lane = tradeLanes.analyzeTradeLanes(unified, side, candidate);
  const momentum = isMomentumCandidate(candidate, lane);
  const laneName = scalp ? 'SCALP_MOMENTUM' : 'MAIN_15M';
  if (scalp) {
    if (!lane.scalpReady) reasons.push('REVAL_SCALP_LANE_NOT_READY');
    if (!(Array.isArray(lane.lowerSupportTfs) && lane.lowerSupportTfs.includes(tf))) reasons.push('REVAL_SCALP_TRIGGER_TF_NOT_SUPPORTING');
    if (!momentum.momentum) reasons.push('REVAL_SCALP_NOT_MOMENTUM_COIN');
  } else if (!lane.main15Ready) reasons.push('REVAL_MAIN_15M_NOT_READY');
  if (lane.hard15mVeto) reasons.push('REVAL_15M_HARD_OPPOSITION');
  if (lane.exhausted) reasons.push('REVAL_MOMENTUM_EXHAUSTED');
  if (reasons.length) return { ok:false, reasons:uniq(reasons), lane:compactLane(lane), momentum };

  const planOrigin = lc(plan.originTF), planOwner = lc(plan.ownerTF);
  const originTF = scalp ? tf : (tf === '15m' || LOWER.includes(planOrigin) || !planOrigin ? '15m' : planOrigin);
  const ownerTF = scalp
    ? (lane.main15Ready ? '15m' : (lane.lowerSupportTfs.at(-1) || tf))
    : (!planOwner || LOWER.includes(planOwner) ? '15m' : planOwner);
  const dir = side === 'LONG' ? '>' : '<';
  const info = {
    ok:true, applied:true, version:'CLAUDE_V111', laneName, tf, triggerPrice, invalidationPrice,
    closedClose:close, livePrice:live, storedPlanAt:new Date(storedAt).toISOString(),
    storedPlanAgeMin:Number(ageMin.toFixed(2)), momentumTags:momentum.tags, lane:compactLane(lane)
  };
  const next = {
    ...plan,
    valid:true,
    previousStatus:'WATCH',
    modelStatus:'WATCH',
    status:'QUALIFIED',
    originTF, ownerTF,
    triggerTF:tf,
    triggerLevelId:intent?.triggerLevelId || plan.triggerLevelId || spec.triggerLevelId || null,
    invalidationLevelId:intent?.invalidationLevelId || plan.invalidationLevelId || spec.invalidationLevelId || null,
    triggerSpec:{ ...spec, valid:true, tf, triggerPrice, invalidationPrice, closedPrice:close, triggered:true, invalidated:false, revalidated:true, closedCandleOnly:true },
    waitFor:`NONE — Claude v111 yeniden doğrulama: ${tf} kapanışı ${close} ${dir} tetik ${triggerPrice}; canlı ${live} (${laneName})`,
    why:`[Claude v111 sayısal tetik yeniden doğrulandı: ${tf} kapanmış mum ${close} ${dir} ${triggerPrice}, invalidation ${invalidationPrice ?? 'yok'} korunuyor, hat ${laneName}${momentum.tags.length ? ', momentum ' + momentum.tags.join(',') : ''}; 9TF Vision planı ${info.storedPlanAgeMin} dk önce] ` + String(plan.why || ''),
    execPath:'CLAUDE_V111_TRIGGER_REVALIDATED',
    reason:'CLAUDE_V111_TRIGGER_REVALIDATED',
    confidence:Math.max(Number(plan.confidence) || 0, 55),
    claudeTriggerRevalidation:info,
    execution:'ADVISORY_ONLY'
  };
  delete next.jevDecision;
  delete next.jevShadowDecision;
  delete next.lanePolicyReasons;
  return { ok:true, reasons:[], plan:next, info };
}

// ---------------------------------------------------------------------
// 4) Runner (TP3 yerine iz süren stop)
// ---------------------------------------------------------------------
function runnerPhase({ initialQty, tpQty, remainingQty, stepSize = null, tpPlaced = 2 } = {}) {
  const q0 = finite(initialQty), rem = finite(remainingQty);
  const q = Array.isArray(tpQty) ? tpQty.map(finite) : [];
  if (q0 === null || q0 <= 0 || rem === null) return 'UNKNOWN';
  if (rem <= 0) return 'CLOSED';
  // Yarım lot adımı: tam adım toleransı 1 adımlık TP dilimlerinde fazı erken ilerletiyordu (inceleme bulgusu #1).
  const tol = Math.max((finite(stepSize) || 0) / 2, q0 * 1e-9);
  if (q.length === 3 && q.every(x => x !== null && x > 0)) {
    // CLAUDE_V112: yalnız TP1 konduysa (2/3 runner) TP1 dolar dolmaz iz sürme başlar (taban: başabaş).
    if (Number(tpPlaced) === 1) return rem <= q0 - q[0] + tol ? 'TRAILING' : 'INITIAL';
    if (rem <= q[2] + tol) return 'TRAILING';
    if (rem <= q0 - q[0] + tol) return 'BREAKEVEN';
    return 'INITIAL';
  }
  return 'INITIAL';
}

function roundToTick(price, tick, side, kind = 'STOP') {
  const p = finite(price), t = finite(tick);
  if (p === null) return null;
  if (t === null || t <= 0) return p;
  // LONG stop aşağı yuvarlanır (daha güvenli değil ama tetiklenmeyi mark altında tutar); SHORT stop yukarı.
  const units = side === 'LONG' ? Math.floor(p / t + 1e-9) : Math.ceil(p / t - 1e-9);
  return Number((units * t).toPrecision(12));
}

function trailTimeframe({ originTF, lane }) {
  const origin = lc(originTF);
  if (lane?.exhausted === true) return { tf:'1m', reason:'MOMENTUM_EXHAUSTED_TIGHTEN' };
  const ladder = (Array.isArray(lane?.momentumLadder) ? lane.momentumLadder : []).map(lc).filter(x => TRAIL_TFS.includes(x));
  const floorIdx = Math.max(0, TRAIL_TFS.indexOf(TRAIL_TFS.includes(origin) ? origin : '15m'));
  // Scalp runner en fazla 15m swing'e, ana hat runner en fazla 1h swing'e taşınır.
  const capIdx = TRAIL_TFS.indexOf(LOWER.includes(origin) ? '15m' : '1h');
  let best = TRAIL_TFS[floorIdx];
  for (const tf of ladder) {
    const i = TRAIL_TFS.indexOf(tf);
    if (i > TRAIL_TFS.indexOf(best) && i <= capIdx) best = tf;
  }
  return { tf:best, reason: best === TRAIL_TFS[floorIdx] ? 'ORIGIN_TF' : 'MOMENTUM_LADDER_EXTENDED' };
}

function desiredRunnerStop({ side, phase, entryPrice, markPrice, currentStop, frames = {}, lane = null, originTF, tickSize = null, config = readConfig() } = {}) {
  const s = String(side || '').toUpperCase();
  const entry = finite(entryPrice), mark = finite(markPrice), cur = finite(currentStop);
  if (!['LONG','SHORT'].includes(s) || entry === null || mark === null || entry <= 0 || mark <= 0) return { ok:false, reason:'RUNNER_INPUT_INVALID' };
  if (!['BREAKEVEN','TRAILING'].includes(phase)) return { ok:false, reason:'RUNNER_WAIT_TP1' };
  const dirSign = s === 'LONG' ? 1 : -1;
  const be = entry * (1 + dirSign * config.runnerBreakevenBufferPct / 100);
  let target = be, basis = 'BREAKEVEN_PLUS_FEES', trail = null;
  if (phase === 'TRAILING') {
    trail = trailTimeframe({ originTF, lane });
    const f = frames?.[trail.tf];
    const swing = s === 'LONG' ? finite(f?.swingStructure?.lastConfirmedSwingLow?.price) : finite(f?.swingStructure?.lastConfirmedSwingHigh?.price);
    const atrPct = finite(f?.atrPct);
    if (f?.available !== false && f?.fresh !== false && swing !== null) {
      const buffer = atrPct !== null && atrPct > 0 ? swing * atrPct / 100 * config.runnerAtrBufferMultiple : 0;
      const swingStop = swing - dirSign * buffer;
      if (s === 'LONG' ? swingStop > target : swingStop < target) { target = swingStop; basis = 'SWING_' + trail.tf; }
    }
  }
  // Mark fiyatına en az %0,05 mesafe: aksi halde Binance "hemen tetiklenir" reddi.
  const markGap = mark * 0.0005;
  if (s === 'LONG' && target >= mark - markGap) return { ok:false, reason:'RUNNER_TARGET_AT_OR_ABOVE_MARK', target, trail };
  if (s === 'SHORT' && target <= mark + markGap) return { ok:false, reason:'RUNNER_TARGET_AT_OR_BELOW_MARK', target, trail };
  target = roundToTick(target, tickSize, s);
  if (target === null || target <= 0) return { ok:false, reason:'RUNNER_TARGET_INVALID' };
  // CLAUDE_V111_RUNNER_NEVER_WIDEN
  if (cur !== null) {
    const improve = (target - cur) * dirSign;
    if (improve <= 0) return { ok:false, reason:'RUNNER_WOULD_NOT_TIGHTEN', target, current:cur, trail };
    if (improve / mark * 100 < config.runnerMinImprovePct) return { ok:false, reason:'RUNNER_IMPROVEMENT_TOO_SMALL', target, current:cur, trail };
  }
  return { ok:true, target, basis, phase, trail, breakeven:roundToTick(be, tickSize, s) };
}

module.exports = {
  ...CLAUDE_V111,
  CLAUDE_V111,
  DEFAULT_CONFIG,
  readConfig,
  resetConfigCache,
  isMomentumCandidate,
  compactLane,
  laneAwareTrigger,
  applyLaneTrigger,
  revalidationIntent,
  revalidationPrecheck,
  revalidateTrigger,
  runnerPhase,
  roundToTick,
  trailTimeframe,
  desiredRunnerStop
};
