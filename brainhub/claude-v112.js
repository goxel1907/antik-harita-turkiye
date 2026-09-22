'use strict';
// =====================================================================
// CLAUDE_V112 — Claude (Anthropic, Cowork) • v9.5.112-CLAUDE • 21 Eylül 2026
// Temel: Claude v9.5.111 (418f6c4) ← ChatGPT v9.5.110 (0bbabcf).
// Ayrıntı: brainhub/CLAUDE_V112_CHANGES.md
//
// Kullanıcı: "Jev kararı ön planda; 1m dahil 5m'de oluşacak scalp fırsatları kaçmasın; 15m ana
// işlem yeri; 1m/5m'den başlayan momentum veriler bozuluncaya kadar devam etsin."
//
// v111'de iki darboğaz kaldı: (1) momentum scalp'ı yakalamak için önce ~8 dk'lık tam Vision
// gerekiyordu; (2) Vision sürerken tek yürütme kilidi yüzünden hiçbir tetik Jev'e gidemiyordu.
// CLAUDE_V112_SCALP_FAST_LANE: momentum coinde 2/3 alt TF hizalı + 15m karşı değil + kapanmış
// mum kırılımı → Vision'sız deterministik plan → v110 hat kuralı → Jev → aynı risk/likidasyon/
// kovalama/LIVE kapıları. Ayrı 20 sn döngüde, Vision ile eşzamanlı; emir anı tek kilitte.
// Hiçbir fonksiyon emir göndermez; LIVE'ı yalnız kullanıcı açar.
// =====================================================================

const tradeLanes = require('./trade-lanes');
const claudeV109 = require('./claude-v109');
const claudeV111 = require('./claude-v111');

const CLAUDE_V112 = Object.freeze({
  marker: 'CLAUDE_V112',
  featureVersion: '9.5.113-CLAUDE-VISION',
  builtBy: 'Claude (Anthropic) • Cowork • 2026-09-22 • v9.5.113: sonuç defteri, pozisyon ekranı, Jev tam kanıt (v9.5.112 üzerine)',
  baseBranch: 'futures15m-alarm-public-build@3f45bcd (ChatGPT JEV FINAL AUTHORITY ← Claude v9.5.111 418f6c4)',
  changesDoc: 'brainhub/CLAUDE_V112_CHANGES.md',
  features: [
    'CLAUDE_V112_BUILD',
    'CLAUDE_V112_SCALP_FAST_LANE',
    'CLAUDE_V112_CONCURRENT_REVALIDATION',
    'CLAUDE_V112_EXECUTION_LOCK_ONLY_AT_ORDER',
    'CLAUDE_V112_WORKER_SCALP_EVERY_TICK',
    'CLAUDE_V112_RUNNER_TWO_THIRDS',
    'CLAUDE_V112_VISION_BENCHMARK_21',
    'CLAUDE_V112_BINANCE_V3_POSITION_FIX',
    'CLAUDE_V112_FAST_LANE_JEV_BUDGET',
    'CLAUDE_V112_UPDATER_FILESET',
    'CLAUDE_V112_POSITION_SLOTS_REST',
    'CLAUDE_V113_OUTCOME_LEDGER',
    'CLAUDE_V113_POSITION_LEDGER',
    'CLAUDE_V113_JEV_FULL_EVIDENCE',
    'CLAUDE_V113_FAST_LANE_EXTENSION'
  ]
});

const FRAMES = ['1m','3m','5m','15m','30m','45m','1h','4h','1d'];
function finite(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Hızlı scalp sinyali: yalnız kapanmış mum + deterministik bağlam. Model/Vision kullanılmaz.
// CLAUDE_V113_FAST_LANE_EXTENSION: hareket ne kadar uzamış (işlem yönünde). 1h/4h returnPct = son 5 kapanmış
// mumun getirisi (~5 saat / ~20 saat). 15m EMA20 uzaklığı ATR biriminde. Jev'e kanıt + aşırı uzamada giriş yok.
function extensionMetrics(unified, side) {
  const d = side === 'LONG' ? 1 : -1;
  const fr = tf => unified?.frames?.[tf] || {};
  const dir = v => { const n = finite(v); return n === null ? null : Number((d * n).toFixed(3)); };
  const f15 = fr('15m');
  const close15 = finite(f15.close), ema15 = finite(f15.ema20), atr15 = finite(f15.atrPct);
  const emaAtr15 = close15 !== null && ema15 !== null && atr15 !== null && atr15 > 0
    ? Number((d * (close15 - ema15) / (close15 * atr15 / 100)).toFixed(2)) : null;
  return {
    return15mDirPct:dir(fr('15m').returnPct), return1hDirPct:dir(fr('1h').returnPct), return4hDirPct:dir(fr('4h').returnPct),
    ema20Atr15m:emaAtr15, rsi15m:finite(f15.rsi14), rsi1h:finite(fr('1h').rsi14),
    zone15m:f15.smcContext?.dealingRange?.zone || null, zone1h:fr('1h').smcContext?.dealingRange?.zone || null,
    note:'Pozitif = işlem yönünde uzama. return1h = son 5 kapanmış 1h mum (~5 saat).'
  };
}
function scalpFastLaneSignal({ candidate, unified, maxEntryDeviationPct = 0.5 } = {}) {
  const side = String(candidate?.side || '').toUpperCase();
  if (!['LONG','SHORT'].includes(side)) return { ok:false, reasons:['FL_SIDE_INVALID'] };
  if (!unified?.dataQuality?.advisoryUsable) return { ok:false, reasons:['FL_CONTEXT_NOT_USABLE'] };
  const live = finite(unified?.livePrice);
  if (live === null) return { ok:false, reasons:['FL_LIVE_PRICE_MISSING'] };
  const lane = tradeLanes.analyzeTradeLanes(unified, side, candidate);
  const momentum = claudeV111.isMomentumCandidate(candidate, lane);
  const laneInfo = claudeV111.compactLane(lane);
  const reasons = [];
  if (!momentum.momentum) reasons.push('FL_NOT_MOMENTUM_COIN');
  if (!lane.scalpReady) reasons.push('FL_SCALP_LANE_NOT_READY');
  if (lane.hard15mVeto) reasons.push('FL_15M_HARD_OPPOSITION');
  if (lane.exhausted) reasons.push('FL_MOMENTUM_EXHAUSTED');
  if (reasons.length) return { ok:false, reasons, lane:laneInfo, momentum };
  const misses = [];
  for (const tf of tradeLanes.scalpTriggerPreference(lane)) {
    const f = unified?.frames?.[tf];
    if (!claudeV109.acceptedBreakout(f, side)) { misses.push(tf + ':NO_ACCEPTED_BREAKOUT'); continue; }
    const level = side === 'LONG' ? finite(f.prior20High) : finite(f.prior20Low);
    const invalidation = side === 'LONG' ? finite(f.prior20Low) : finite(f.prior20High);
    if (level === null || invalidation === null) { misses.push(tf + ':LEVEL_MISSING'); continue; }
    if (!(side === 'LONG' ? live > level : live < level)) { misses.push(tf + ':PRICE_BACK_INSIDE'); continue; }
    if (!(side === 'LONG' ? live > invalidation : live < invalidation)) { misses.push(tf + ':INVALIDATION'); continue; }
    // Jev'e gitmeden önce yürütmenin kovalama kapısıyla aynı ölçü: geç kalınmış kırılım Jev bütçesi harcamaz.
    const chase = claudeV109.chaseGate({ side, freshPrice:live, triggerPrice:level, atrPct:finite(f.atrPct), maxEntryDeviationPct });
    if (!chase.ok) { misses.push(tf + ':' + chase.reason); continue; }
    const extension = extensionMetrics(unified, side);
    const maxExt = finite(claudeV111.readConfig().fastLaneMaxExtensionPct);
    if (maxExt !== null && maxExt > 0 && extension.return1hDirPct !== null && extension.return1hDirPct > maxExt) {
      return { ok:false, reasons:['FL_EXTENDED_CHASE_1H'], extension, lane:laneInfo, momentum,
        detail:`1h yönde +${extension.return1hDirPct}% > ${maxExt}% (geç giriş)` };
    }
    const stopPct = Number((Math.abs(live - invalidation) / live * 100).toFixed(3));
    const atrPct = finite(f.atrPct);
    const riskGeometry = { stopPct, triggerTfAtrPct:atrPct, stopAtr:atrPct && atrPct > 0 ? Number((stopPct / atrPct).toFixed(2)) : null,
      tp1Pct:stopPct, tp1Price:Number((side === 'LONG' ? live * (1 + stopPct / 100) : live * (1 - stopPct / 100)).toPrecision(8)),
      note:'TP1 = 1R. Risk USDT = notional × stopPct / 100.' };
    let ownerTF = lane.main15Ready ? '15m' : (lane.lowerSupportTfs.at(-1) || tf);
    if (FRAMES.indexOf(ownerTF) < FRAMES.indexOf(tf)) ownerTF = tf;
    return {
      extension, riskGeometry,
      ok:true, version:'CLAUDE_V112', side, tf, ownerTF, level, invalidation,
      triggerLevelId: side === 'LONG' ? 'PRIOR20_HIGH' : 'PRIOR20_LOW',
      invalidationLevelId: side === 'LONG' ? 'PRIOR20_LOW' : 'PRIOR20_HIGH',
      closedClose:finite(f.close), livePrice:live, atrPct:finite(f.atrPct), asOf:f.asOf || null,
      breakoutStatus:String(f.breakoutExecution?.status || ''), chase, lane:laneInfo, momentum, reasons:[]
    };
  }
  return { ok:false, reasons:['FL_NO_CLOSED_LOWER_TF_BREAKOUT'], misses, lane:laneInfo, momentum };
}

function frameDiagnostic(tf, f, side, supportSet) {
  if (!f?.available) return { summary:'veri yok', role:'NEUTRAL', why:'', waitFor:'NONE', formingContext:'', risk:'' };
  const ls = finite(f.opportunity?.longScore), ss = finite(f.opportunity?.shortScore);
  const bx = String(f.breakoutExecution?.status || 'NO_ACTIVE_BREAKOUT');
  return {
    summary:`${tf}: trend ${f.trend || '?'} • BOS ${f.breakOfStructure || 'yok'} • kırılım ${bx} • L/S ${ls ?? '?'}/${ss ?? '?'} • ${f.fresh ? 'taze' : 'bayat'}`.slice(0,240),
    role: supportSet.has(tf) ? 'SUPPORT' : 'NEUTRAL',
    why:'Deterministik kapanmış mum verisi (Vision kullanılmadı).',
    waitFor:'NONE',
    formingContext:'Açık mum teyit olarak kullanılmadı.',
    risk: tf === '15m' ? '15m ana bağlam; sert karşı yapı scalp’ı iptal eder.' : ''
  };
}

// Vision'sız QUALIFIED plan (Jev ve tüm kapılar sonradan uygulanır).
function fastLanePlan({ signal, unified, candidate } = {}) {
  if (!signal?.ok) return null;
  const side = signal.side;
  const lane = signal.lane || {};
  const supportTFs = [...new Set([...(lane.lowerSupportTfs || []), ...(lane.main15Ready ? ['15m'] : [])])];
  const supportSet = new Set(supportTFs);
  const timeframeDiagnostics = Object.fromEntries(FRAMES.map(tf => [tf, frameDiagnostic(tf, unified?.frames?.[tf], side, supportSet)]));
  const dir = side === 'LONG' ? '>' : '<';
  const tags = (signal.momentum?.tags || []).join(',');
  return {
    valid:true,
    status:'QUALIFIED',
    side,
    confidence:60,
    originTF:signal.tf,
    ownerTF:signal.ownerTF,
    setup:'CLAUDE_V112_MOMENTUM_SCALP',
    execPath:'CLAUDE_V112_CLOSED_CANDLE_SCALP_BREAKOUT',
    triggerTF:signal.tf,
    triggerLevelId:signal.triggerLevelId,
    invalidationLevelId:signal.invalidationLevelId,
    waitFor:`NONE — Claude v112 hızlı scalp: ${signal.tf} kapanışı ${signal.closedClose} ${dir} ${signal.level}; alt TF ${(lane.lowerSupportTfs || []).join('/')} hizalı; 15m karşı değil`,
    why:`[Claude v112 hızlı scalp hattı — Vision kullanılmadı] ${String(candidate?.symbol || '')} ${side}: ${signal.tf} kapanmış mum kırılımı ${signal.breakoutStatus} (seviye ${signal.level}, kapanış ${signal.closedClose}, canlı ${signal.livePrice}); alt TF desteği ${(lane.lowerSupportTfs || []).join(',')}; 15m ${lane.main15Ready ? 'destekliyor' : 'bağlam (karşı değil)'}; momentum ${tags}; merdiven ${(lane.momentumLadder || []).join('→')}.`,
    riskNote:'Görsel analiz yok: karar kapanmış mum verisi + Jev hakemi. Alt TF gürültüsü; stop tetik TF prior-20 yapısında, likidasyon kapısı ayrıca uygulanır.',
    formingContext:'Açık (forming) mumlar teyit olarak kullanılmadı.',
    supportTFs,
    vetoTFs:[],
    timeframeDiagnostics,
    visionSummary:'Vision kullanılmadı (CLAUDE_V112 hızlı scalp hattı). 9 zaman diliminin kapanmış mum verisi Jev kaydında.',
    claudeFastLane:{ ...signal, applied:true },
    execution:'ADVISORY_ONLY'
  };
}

module.exports = { ...CLAUDE_V112, CLAUDE_V112, scalpFastLaneSignal, fastLanePlan, extensionMetrics };
