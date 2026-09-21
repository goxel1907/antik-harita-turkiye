'use strict';
// =====================================================================
// CLAUDE_V109 — Bu dosya Claude (Anthropic, Cowork) tarafından v9.5.109-CLAUDE
// için yazıldı. ChatGPT ve diğer ajanlar için işaret: "CLAUDE_V109" etiketli her
// değişiklik brainhub/CLAUDE_V109_CHANGES.md dosyasında gerekçesiyle açıklanmıştır.
//
// Temel: ChatGPT'nin brainhub-v95109-signal-flow-hardening dalı (50a2f4a).
// Claude bu dalı doğruladı (185 testin 6'sı kırmızıydı, PC güncelleyici yeni
// dosyaları kopyalamıyordu, tetik-sapma kapısı kırılım girişlerini kilitliyordu,
// risk kapısı kullanıcının gerçek ayarlarıyla matematiksel olarak işlem açtırmıyordu)
// ve eksikleri tamamladı.
//
// Güvenlik ilkesi: hiçbir fonksiyon emir göndermez. LIVE arm/grant/lease/lineage,
// stop-no-widen, likidasyon ve kill-switch kapıları aynen kalır. Deterministik tetik
// ve Jev rol-ağırlıklı veto varsayılan olarak GÖLGE (SHADOW) modundadır; ölçüm
// sonrası kullanıcı config/claude-v109.json ile BINDING'e geçirebilir.
// =====================================================================

const fs = require('fs');
const path = require('path');
const { isNonConcreteWait } = require('./wait-condition');
const { resolveTriggerLevel } = require('./engine');

const CLAUDE_V109 = Object.freeze({
  marker: 'CLAUDE_V109',
  featureVersion: '9.5.109-CLAUDE-VISION',
  androidVersionName: '9.5.109-CLAUDE',
  builtBy: 'Claude (Anthropic) • Cowork • 2026-09-21 • ChatGPT v9.5.109 dalı üzerine',
  baseBranch: 'brainhub-v95109-signal-flow-hardening@50a2f4a (ChatGPT)',
  changesDoc: 'brainhub/CLAUDE_V109_CHANGES.md',
  features: [
    'CLAUDE_V109_BUILD',
    'CLAUDE_V109_CHATGPT_V109_VERIFIED',
    'CLAUDE_V109_TRIGGER_AUTOSELECT',
    'CLAUDE_V109_QUALIFIED_NONE_PREFIX',
    'CLAUDE_V109_NUMERIC_WAIT_FALLBACK',
    'CLAUDE_V109_DETERMINISTIC_TRIGGER_SHADOW',
    'CLAUDE_V109_JEV_ROLE_WEIGHTED_SHADOW',
    'CLAUDE_V109_TRIGGER_CHASE_GATE',
    'CLAUDE_V109_ENTRY_REFERENCE_FRESH',
    'CLAUDE_V109_RISK_AUTHORITY_SWITCH',
    'CLAUDE_V109_ESCALATION_ATTEMPT_COOLDOWN',
    'CLAUDE_V109_SCANNER_NEW_ACCEL_ROUTE',
    'CLAUDE_V109_UPDATER_FILESET',
    'CLAUDE_V109_OFFICE_DASHBOARD'
  ]
});

const FRAMES = ['1m','3m','5m','15m','30m','45m','1h','4h','1d'];
// Tetik zaman dilimi tercih sırası: 15m manuel sistemin çekirdek TF'si.
// 1m (komisyon/gürültü) ve 4h/1d (stop çok geniş → likidasyon riski) otomatik tetik olamaz.
const TRIGGER_TF_PREFERENCE = ['15m','30m','5m','1h','45m','3m'];

const DEFAULT_CONFIG = Object.freeze({
  // SHADOW: yalnız "QUALIFIED olurdu" diye kaydeder. BINDING: WATCH→QUALIFIED yükseltir
  // (Jev + risk + likidasyon + LIVE kapıları yine uygulanır).
  deterministicTriggerMode: 'SHADOW',
  // V108_ANY_065: ChatGPT/v108 kuralı (21 sorudan herhangi biri ≥0,65 → veto).
  // CLAUDE_V109_ROLE_WEIGHTED: rol-ağırlıklı kural bağlayıcı olur. İki kural da her zaman hesaplanır.
  jevVetoPolicy: 'V108_ANY_065',
  // Kırılım sonrası kovalamaca sınırı: max(maxEntryDeviationPct, ATR% × çarpan), üst sınır capPct.
  chaseAtrMultiple: 1.0,
  chaseCapPct: 3.0
});

let configCache = { at:0, value:DEFAULT_CONFIG, file:null };
function configPath() {
  const root = process.env.BRAINHUB_ROOT || path.resolve(__dirname, '..');
  return path.join(root, 'config', 'claude-v109.json');
}
function readConfig(now = Date.now()) {
  const file = configPath();
  if (configCache.file === file && now - configCache.at < 30000) return configCache.value;
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch {}
  const mode = String(raw.deterministicTriggerMode || DEFAULT_CONFIG.deterministicTriggerMode).toUpperCase();
  const jev = String(raw.jevVetoPolicy || DEFAULT_CONFIG.jevVetoPolicy).toUpperCase();
  const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  const value = Object.freeze({
    deterministicTriggerMode: mode === 'BINDING' ? 'BINDING' : 'SHADOW',
    jevVetoPolicy: jev === 'CLAUDE_V109_ROLE_WEIGHTED' ? 'CLAUDE_V109_ROLE_WEIGHTED' : 'V108_ANY_065',
    chaseAtrMultiple: num(raw.chaseAtrMultiple, DEFAULT_CONFIG.chaseAtrMultiple, 0.25, 3),
    chaseCapPct: num(raw.chaseCapPct, DEFAULT_CONFIG.chaseCapPct, 0.5, 5)
  });
  configCache = { at:now, value, file };
  return value;
}
function resetConfigCache() { configCache = { at:0, value:DEFAULT_CONFIG, file:null }; }

function finite(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ChatGPT'nin ortak normalizasyonu (wait-condition.js) tek kaynak olarak kullanılır.
function nonConcreteWait(value) { return isNonConcreteWait(value); }

// CLAUDE_V109_QUALIFIED_NONE_PREFIX: QUALIFIED planında "NONE — tetik oluştu" da NONE sayılır.
function qualifiedWaitIsNone(value) {
  return /^(NONE|YOK)(?=$|[\s—–\-(:;,.!])/i.test(String(value || '').trim());
}

function frameOf(unified, tf) {
  const f = unified?.frames?.[tf];
  return f && typeof f === 'object' ? f : null;
}

// CLAUDE_V109_TRIGGER_AUTOSELECT
// ChatGPT v109 şeması WATCH/QUALIFIED için TRIGGER_LEVEL_ID + TRIGGER_TF + INVALIDATION_LEVEL_ID
// zorunlu kıldı. 4B yerel model bu üç alanı eksik/geçersiz yazarsa plan REVIEW_REQUIRED'a düşüyordu.
// Fiyat yine modelden alınmaz: kod, deterministik adaylardan (prior-20) seçer ve bunu işaretler.
function autoSelectTrigger({ plan, unified } = {}) {
  const side = String(plan?.side || '').toUpperCase();
  if (!['LONG','SHORT'].includes(side)) return { ok:false, reason:'AUTOSELECT_SIDE_INVALID' };
  const trigId = side === 'LONG' ? 'PRIOR20_HIGH' : 'PRIOR20_LOW';
  const invId = side === 'LONG' ? 'PRIOR20_LOW' : 'PRIOR20_HIGH';
  const order = [
    String(plan?.triggerTF || '').toLowerCase(),
    String(plan?.originTF || '').toLowerCase(),
    ...TRIGGER_TF_PREFERENCE
  ].filter((x, i, a) => x && FRAMES.includes(x) && x !== '1m' && x !== '4h' && x !== '1d' && a.indexOf(x) === i);
  for (const tf of order) {
    const f = frameOf(unified, tf);
    if (!f?.available || f.fresh !== true) continue;
    const modelTrig = String(plan?.triggerLevelId || '').toUpperCase();
    const modelInv = String(plan?.invalidationLevelId || '').toUpperCase();
    const useModelTrig = tf === String(plan?.triggerTF || '').toLowerCase() && modelTrig && resolveTriggerLevel(f, side, modelTrig, 'TRIGGER');
    const useModelInv = tf === String(plan?.triggerTF || '').toLowerCase() && modelInv && resolveTriggerLevel(f, side, modelInv, 'INVALIDATION');
    const trigger = useModelTrig ? modelTrig : trigId;
    const invalidation = useModelInv ? modelInv : invId;
    if (!resolveTriggerLevel(f, side, trigger, 'TRIGGER') || !resolveTriggerLevel(f, side, invalidation, 'INVALIDATION')) continue;
    return {
      ok:true, triggerTF:tf, triggerLevelId:trigger, invalidationLevelId:invalidation,
      keptModelTrigger:Boolean(useModelTrig), keptModelInvalidation:Boolean(useModelInv),
      reason:'CLAUDE_V109_TRIGGER_AUTOSELECT'
    };
  }
  return { ok:false, reason:'AUTOSELECT_NO_FRESH_PRIOR20_FRAME' };
}

// Kapanmış mumda, istenen yönde kabul edilmiş kırılım var mı?
function acceptedBreakout(frame, side) {
  if (!frame || frame.available === false || frame.fresh !== true) return false;
  const bos = String(frame.breakOfStructure || '').toUpperCase();
  const status = String(frame.breakoutExecution?.status || '').toUpperCase();
  const dirOk = (side === 'LONG' && bos === 'UP') || (side === 'SHORT' && bos === 'DOWN');
  return dirOk && (status === 'ACCEPTED' || status === 'RECLAIMED');
}

function prior20Level(frame, side) {
  if (!frame) return null;
  return side === 'LONG' ? finite(frame.prior20High) : side === 'SHORT' ? finite(frame.prior20Low) : null;
}

// CLAUDE_V109_DETERMINISTIC_TRIGGER_SHADOW
// Model WATCH dediği halde kapanmış mumda kabul edilmiş kırılım var mı? Varsayılan: yalnız ölçüm.
// Model yetkisi korunur: REJECT, yön farkı, origin/owner TF vetosu varsa hiçbir modda yükseltme yok.
function deterministicTrigger({ plan, candidate, unified } = {}) {
  const reasons = [];
  const side = String(plan?.side || '').toUpperCase();
  const candidateSide = String(candidate?.side || '').toUpperCase();
  const status = String(plan?.status || '').toUpperCase();
  if (!['LONG','SHORT'].includes(side)) reasons.push('DT_SIDE_INVALID');
  if (candidateSide && side && candidateSide !== side) reasons.push('DT_MODEL_SIDE_DIFFERS_FROM_SCANNER');
  if (status === 'REJECT') reasons.push('DT_MODEL_REJECTED');
  if (!['WATCH','QUALIFIED'].includes(status)) reasons.push('DT_PLAN_NOT_WATCH_OR_QUALIFIED');
  if (plan?.valid !== true) reasons.push('DT_PLAN_CONTRACT_INVALID');
  if (!unified?.dataQuality?.advisoryUsable) reasons.push('DT_CONTEXT_NOT_USABLE');
  if (finite(unified?.livePrice) === null) reasons.push('DT_LIVE_PRICE_MISSING');
  const pathRow = ['LONG','SHORT'].includes(side) ? unified?.opportunityPaths?.[side] : null;
  const continuity = Array.isArray(pathRow?.continuity) ? pathRow.continuity.filter(x => x?.immediateEligible === true) : [];
  if (!continuity.length) reasons.push('DT_NO_ELIGIBLE_OPPORTUNITY_PATH');
  const vetoSet = new Set((Array.isArray(plan?.vetoTFs) ? plan.vetoTFs : []).map(x => String(x).toLowerCase()));
  for (const tf of [plan?.originTF, plan?.ownerTF].map(x => String(x || '').toLowerCase())) {
    if (tf && vetoSet.has(tf)) reasons.push('DT_MODEL_ORIGIN_OWNER_VETO:' + tf);
  }
  if (reasons.length) return { ok:false, reasons:[...new Set(reasons)] };

  const eligibleSet = new Set(continuity.map(x => x.frame));
  let chosen = null;
  for (const tf of TRIGGER_TF_PREFERENCE) {
    if (!eligibleSet.has(tf) || vetoSet.has(tf)) continue;
    if (acceptedBreakout(frameOf(unified, tf), side)) { chosen = tf; break; }
  }
  if (!chosen) return { ok:false, reasons:['DT_NO_CLOSED_CANDLE_BREAKOUT_ON_TRIGGER_TF'] };
  const idx = FRAMES.indexOf(chosen);
  const owners = continuity.map(x => x.frame).filter(tf => FRAMES.indexOf(tf) >= idx && !vetoSet.has(tf));
  const ownerTF = owners.length ? owners[owners.length - 1] : chosen;
  const f = frameOf(unified, chosen);
  const level = prior20Level(f, side);
  const live = finite(unified?.livePrice);
  if (level === null) return { ok:false, reasons:['DT_TRIGGER_LEVEL_MISSING'] };
  const stillBeyond = side === 'LONG' ? live > level : live < level;
  if (!stillBeyond) return { ok:false, reasons:['DT_PRICE_BACK_INSIDE_RANGE'] };
  return {
    ok:true, tf:chosen, ownerTF, level,
    triggerLevelId: side === 'LONG' ? 'PRIOR20_HIGH' : 'PRIOR20_LOW',
    closedClose:finite(f?.close), livePrice:live,
    status:String(f?.breakoutExecution?.status || ''), reasons:[]
  };
}

// Yalnız BINDING modunda çağrılır: WATCH→QUALIFIED.
function applyDeterministicTrigger(plan, dt) {
  if (!plan || !dt?.ok) return plan;
  const status = String(plan.status || '').toUpperCase();
  if (status === 'QUALIFIED') return { ...plan, claudeDeterministicTrigger:{ ...dt, applied:false, note:'MODEL_ALREADY_QUALIFIED' } };
  return {
    ...plan,
    valid:true,
    previousStatus:status || null,
    modelStatus:status || null,
    status:'QUALIFIED',
    waitFor:'NONE',
    originTF:dt.tf,
    ownerTF:dt.ownerTF,
    triggerTF:dt.tf,
    triggerLevelId:dt.triggerLevelId,
    invalidationLevelId:String(plan.side || '').toUpperCase() === 'SHORT' ? 'PRIOR20_HIGH' : 'PRIOR20_LOW',
    execPath:'CLAUDE_V109_CLOSED_CANDLE_BREAKOUT',
    reason:'CLAUDE_V109_DETERMINISTIC_TRIGGER',
    confidence:Math.max(Number(plan.confidence) || 0, 55),
    claudeDeterministicTrigger:{ ...dt, applied:true, mode:'BINDING' },
    execution:'ADVISORY_ONLY'
  };
}

// CLAUDE_V109_NUMERIC_WAIT_FALLBACK: yerel Vision semantik onarımı somut WAIT üretemezse
// v108/ChatGPT v109 tüm Vision sonucunu throw ile çöpe atıyordu. Kod, seçilen tetik adayından
// (yoksa prior-20'den) sayısal bekleme metni yazar.
function numericWaitText({ side, unified, originTF, triggerTF, triggerLevelId, triggerCandidates } = {}) {
  const s = String(side || '').toUpperCase();
  if (!['LONG','SHORT'].includes(s)) return null;
  const dir = s === 'LONG' ? 'üstünde' : 'altında';
  const list = Array.isArray(triggerCandidates) ? triggerCandidates : [];
  const wantTf = String(triggerTF || '').toLowerCase();
  const wantId = String(triggerLevelId || '').toUpperCase();
  const picked = list.find(x => String(x?.tf || '').toLowerCase() === wantTf && String(x?.id || '').toUpperCase() === wantId && finite(x?.price) !== null);
  if (picked) return { tf:wantTf, level:finite(picked.price), id:wantId, text:`${wantTf} kapanışı ${finite(picked.price)} ${dir} (CLAUDE_V109 sayısal tetik ${wantId})` };
  const order = [String(triggerTF || '').toLowerCase(), String(originTF || '').toLowerCase(), ...TRIGGER_TF_PREFERENCE]
    .filter((x, i, a) => x && FRAMES.includes(x) && a.indexOf(x) === i && x !== '1m' && x !== '4h' && x !== '1d');
  for (const tf of order) {
    const level = prior20Level(frameOf(unified, tf), s);
    if (level === null) continue;
    const id = s === 'LONG' ? 'PRIOR20_HIGH' : 'PRIOR20_LOW';
    return { tf, level, id, text:`${tf} kapanışı ${level} ${dir} (CLAUDE_V109 sayısal tetik ${id})` };
  }
  return null;
}

// CLAUDE_V109_JEV_ROLE_WEIGHTED_SHADOW
// v108/ChatGPT: 12 kontrol + 9 TF sorusundan HERHANGİ BİRİ ≥0,65 → veto (her soru %5 yanlış
// alarm verse planların ~%66'sı düşer). Claude kuralı (varsayılan yalnız ölçüm):
//  - sert: paket bütünlüğü, veri kalitesi ≥0,65 · yapısal veto ≥0,75
//  - origin/owner TF çelişkisi ≥0,65
//  - yumuşak kontroller: en az ikisi ≥0,75 veya herhangi biri ≥0,90
const JEV_HARD = { symbolPackageIntegrity:0.65, dataQualityInsufficient:0.65, structuralVeto:0.75 };
function jevRoleWeightedVeto({ probabilities = {}, timeframeConflicts = {}, plan = {} } = {}) {
  const hard = [], soft = [];
  for (const [k, th] of Object.entries(JEV_HARD)) if (finite(probabilities[k]) !== null && probabilities[k] >= th) hard.push(k);
  const softKeys = Object.keys(probabilities || {}).filter(k => !(k in JEV_HARD));
  const softHigh = softKeys.filter(k => finite(probabilities[k]) !== null && probabilities[k] >= 0.75);
  const softExtreme = softKeys.filter(k => finite(probabilities[k]) !== null && probabilities[k] >= 0.90);
  if (softHigh.length >= 2) soft.push(...softHigh);
  else if (softExtreme.length) soft.push(...softExtreme);
  const critical = [plan?.originTF, plan?.ownerTF].map(x => String(x || '').toLowerCase()).filter(x => FRAMES.includes(x));
  const conflictingCriticalTFs = [...new Set(critical.filter(tf => finite(timeframeConflicts?.[tf]) !== null && timeframeConflicts[tf] >= 0.65))];
  const contextualTFs = FRAMES.filter(tf => !critical.includes(tf) && finite(timeframeConflicts?.[tf]) !== null && timeframeConflicts[tf] >= 0.65);
  const reasons = [
    ...hard.map(k => 'JEV_RW_HARD:' + k),
    ...soft.map(k => 'JEV_RW_SOFT:' + k),
    ...conflictingCriticalTFs.map(tf => 'JEV_RW_CRITICAL_TF:' + tf)
  ];
  return { policy:'CLAUDE_V109_ROLE_WEIGHTED', veto:reasons.length > 0, hardKeys:hard, softKeys:soft, conflictingCriticalTFs, contextualTFs, reasons };
}

// Jev kararına rol-ağırlıklı değerlendirmeyi ekler; BINDING ise vetoyu onunla değiştirir.
function annotateJevDecision(decision, plan, mode = readConfig().jevVetoPolicy) {
  if (!decision || typeof decision !== 'object' || decision.called !== true || !decision.probabilities) return decision;
  const rw = jevRoleWeightedVeto({ probabilities:decision.probabilities, timeframeConflicts:decision.timeframeConflicts || {}, plan });
  const out = { ...decision, claudeRoleWeighted:{ ...rw, binding:mode === 'CLAUDE_V109_ROLE_WEIGHTED' } };
  if (mode === 'CLAUDE_V109_ROLE_WEIGHTED' && decision.ok === true && decision.shadow !== true) {
    out.v108Veto = decision.veto === true;
    out.v108VetoReasons = Array.isArray(decision.vetoReasons) ? decision.vetoReasons : [];
    out.veto = rw.veto;
    out.vetoReasons = rw.veto ? rw.reasons : [];
    out.vetoPolicy = 'CLAUDE_V109_ROLE_WEIGHTED';
  } else {
    out.vetoPolicy = 'V108_ANY_065';
  }
  return out;
}

// CLAUDE_V109_TRIGGER_CHASE_GATE
// ChatGPT v109: transport sapmasını tetik seviyesine göre %0,5 ile ölçüyordu. 15m kırılım mumu
// çoğu altcoinde tetikten %0,5'ten fazla uzakta kapanır → neredeyse her kırılım
// LIVE_PRICE_DEVIATION_TOO_HIGH. (Bu öneri Claude'un ilk PDF'indeydi; ölçek ATR'ye bağlanarak düzeltildi.)
// Kural: tetikten lehte uzaklık ≤ max(maxEntryDeviationPct, ATR%×çarpan), en fazla capPct.
// Tetik yoksa referans analiz fiyatıdır. Aleyhte hareket: tetik içine dönüş veya limit kadar ters.
function chaseGate({ side, freshPrice, analyzedPrice, triggerPrice, atrPct, maxEntryDeviationPct = 0.5, config = readConfig() } = {}) {
  const s = String(side || '').toUpperCase();
  const fresh = finite(freshPrice);
  const ref = finite(triggerPrice) ?? finite(analyzedPrice);
  if (!['LONG','SHORT'].includes(s) || fresh === null || fresh <= 0 || ref === null || ref <= 0) {
    return { ok:false, reason:'CLAUDE_V109_CHASE_INPUT_INVALID' };
  }
  const base = Math.max(0.05, finite(maxEntryDeviationPct) ?? 0.5);
  const atr = finite(atrPct);
  const limitPct = Math.min(config.chaseCapPct, Math.max(base, atr !== null && atr > 0 ? atr * config.chaseAtrMultiple : base));
  const signedPct = (fresh - ref) / ref * 100 * (s === 'LONG' ? 1 : -1);
  const usingTrigger = finite(triggerPrice) !== null;
  const out = { ok:true, reference:usingTrigger ? 'TRIGGER' : 'ANALYSIS_PRICE', referencePrice:ref, freshPrice:fresh, favourablePct:Number(signedPct.toFixed(4)), limitPct:Number(limitPct.toFixed(4)), atrPct:atr };
  if (usingTrigger && signedPct <= 0) return { ...out, ok:false, reason:'CLAUDE_V109_PRICE_BACK_INSIDE_TRIGGER' };
  if (signedPct > limitPct) return { ...out, ok:false, reason:usingTrigger ? 'CLAUDE_V109_TRIGGER_CHASE_TOO_FAR' : 'CLAUDE_V109_PRICE_RAN_AWAY_SINCE_ANALYSIS' };
  if (!usingTrigger && signedPct < -limitPct) return { ...out, ok:false, reason:'CLAUDE_V109_PRICE_MOVED_AGAINST_SINCE_ANALYSIS' };
  return out;
}

module.exports = {
  ...CLAUDE_V109,
  CLAUDE_V109,
  TRIGGER_TF_PREFERENCE,
  DEFAULT_CONFIG,
  readConfig,
  resetConfigCache,
  nonConcreteWait,
  qualifiedWaitIsNone,
  autoSelectTrigger,
  acceptedBreakout,
  deterministicTrigger,
  applyDeterministicTrigger,
  numericWaitText,
  jevRoleWeightedVeto,
  annotateJevDecision,
  chaseGate
};
