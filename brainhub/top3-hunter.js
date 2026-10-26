'use strict';
// R2544.56 İLK 3 AVCISI (user 12.10.2026: "ilk 10'da işlem alacak ve ilk 3'e girecek coini erken yakalama; ilk 3'e girip
// tepe yapan coinler düşüşte çok kâr bırakıyor; 24 saat TEST, JEV'siz; JEV modu ve canlı düğmesi Office'te").
// Evidence (Claud-Work raporlar 2026-10-12-ilk3-erken-yakalama.md, 659 USDT perps, 6 months, hourly, rules fixed before
// the out-of-sample half):
//  LONG  "6/6": hourly volume >= 33.9x its 7-day hourly median, 24h >= +13.3%, already rank <= 7, was in the top 10 at
//        least once in the previous 7 days, 30-day hourly volatility >= 1.34%, BTC 24h <= +1.29%; on top of the base
//        ignition (1h >= +3%, volume >= 3x, close above the 7-day high). Train +7% / test +33% of margin per 10x trade
//        (stop -8%, target +30%, 24 h); 0.8-1.3 signals a day. Small samples: this lane is a measured experiment.
//  SHORT "S2": in the top 3 within 24 h, close >= 15% below the 24 h peak, red hour with volume >= 3x; stop 1% above the
//        last 3 hours' high (2%..8% away), target -10%, 24 h. +2.2% of margin per 10x trade, positive in both halves.
// This module is pure: features, rules, rank history and config. Orders, stops and bookkeeping live in live-controller.
const fs = require('fs');
const path = require('path');
const PA = require('./pa-core'); // R2544.70 price-action core (sweeps / liquidity / range)

const TOP3_VERSION = 'R2544.58_TOP3_V2';
// rulesVersion 2 (R2544.58, default): 5m EARLY LONG + TOP SHORT at day/week/month zones, risk-sized. rulesVersion 1: the
// R2544.56 hourly rules below (kept for the record and the tests; the hourly scan still keeps the rank book either way).
const DEFAULT_CONFIG = Object.freeze({
  enabled:false, jevMode:false, liveEnabled:false, leverage:10, marginQuote:null, maxActive:2, rulesVersion:2, riskPct:0.02,
  // R2544.69 kâr koruma (user 21.10 PARTI: 2.29R seen, closed -0.12R): at +atR take `share` of the lot (reduce-only take-profit
  // placed at entry), then the rest's stop goes to break-even + fees. 1-month top-5 study (~490 entries, 5m): -0.08R -> +0.10R,
  // both halves of the month, 'saw 1.5R and closed <= 0' 61 -> 0. Office switch per lane.
  partial:Object.freeze({ enabled:true, atR:2, share:0.5, beFee:0.0012 }), // R2544.73 (user 22.10: "1R'ı erken mi alıyor" -> 1 ay ölçüm, bugünkü kurallar n74: 1R yarısı +0,27R, 2R yarısı +0,41R, hiç +0,44R)
  long:Object.freeze({ enabled:true, minR1:0.03, minVrBase:3, minVr1:33.9, minR24:0.133, maxRank:7, minTop10In7d:1, minVol30:0.0134, maxBtc24:0.0129, stopPct:0.08, tpPct:0.30, maxHoldH:24 }),
  short:Object.freeze({ enabled:true, top3WithinH:24, minDropFromPeak:0.15, minVr1:3, stopBufferPct:0.01, minStopPct:0.02, maxStopPct:0.08, tpPct:0.10, maxHoldH:24 }),
  early:Object.freeze({ enabled:true, minRank:4, maxRank:24, climbPlaces:3, climbHours:3, noTop3H:48, minR24:0.05, maxR24:0.40, volMult:3, volBars:288, minVolBars:200,
    retestBars:24, retestTol:0.004, failClose:0.01, stopBuf:0.003, minStopPct:0.012, maxStopPct:0.045, minRoomR:2, noZoneTargetR:3, zoneTpBuf:0.005, maxHoldH:24, cooldownH:24,
    // R2544.58 full research (6 months, 550 coins, fees): week/month-high breakouts and the 1R break-even were better in
    // BOTH halves than the base (L4 -0.04/-0.13R vs L0 -0.10/-0.18R); funding filter unstable between halves (off).
    htfOnly:true, maxFunding:null, beAtR:1 }),
  top:Object.freeze({ enabled:true, top10WithinH:24, hlBars:6, breakBars:12, stopBuf:0.003, minStopPct:0.015, maxStopPct:0.06, zoneAbovePct:0.05, targetR:2.5, maxHoldH:24,
    // a top that took out the previous week high (the short-liquidation zone): S1 -0.04/+0.10R vs S0 -0.16/+0.05R
    // R2544.58 (15.10 indicator test, BigBeluga-style volumetric order block): the last green candle at/before the top has
    // >= 2x the 24 h median volume (distribution at the zone). S1 -0.04/+0.10R -> -0.01/+0.10R, bad days 56 % -> 52 %.
    requireWeeklySwept:true, cooldownH:12, cooldownAfterStopH:24, beAtR:null, minTopVolMult:2,
    // R2544.70 süpürme şartı (kullanıcının PDF'i RektProof + ölçüm 21.10: TEPE SHORT +0,51R n14 -> +0,86R n10, iki yarıda da daha iyi):
    // son 24 mumda bir salınım tepesinin üstüne FİTİL atıp geri içeri kapanan mum (SFP) yoksa SHORT yok. pa-core.sweeps, 5 dk, n=3, 24 sa geriye.
    requireSweep:true, sweepN:3, sweepWithin:24, sweepLookback:288 })
});
const HOUR = 3600000;

const finite = v => { if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const round = (v, d = 6) => v === null || v === undefined ? null : Number(Number(v).toFixed(d));

function configFile(root) { return path.join(String(root || '.'), 'config', 'top3-hunter.json'); }
function readTop3Config(root) {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(configFile(root), 'utf8').replace(/^﻿/, '')) || {}; } catch {}
  const c = { ...DEFAULT_CONFIG, long:{ ...DEFAULT_CONFIG.long }, short:{ ...DEFAULT_CONFIG.short }, early:{ ...DEFAULT_CONFIG.early }, top:{ ...DEFAULT_CONFIG.top }, partial:{ ...DEFAULT_CONFIG.partial } };
  if (raw.partial && typeof raw.partial === 'object' && typeof raw.partial.enabled === 'boolean') c.partial.enabled = raw.partial.enabled;
  if (raw.partial && typeof raw.partial === 'object') { const a = finite(raw.partial.atR), b = finite(raw.partial.share);   // R2544.73 Office level/share
    if (a !== null && a >= 0.5 && a <= 5) c.partial.atR = a; if (b !== null && b >= 0.1 && b <= 0.9) c.partial.share = b; }
  for (const k of ['enabled', 'jevMode', 'liveEnabled']) if (typeof raw[k] === 'boolean') c[k] = raw[k];
  c.committeeMode = raw.committeeMode === true; // R2544.89 karar sahibi KURUL (giriş vetosu + masa yetkisi); varsayılan kapalı
  const lev = finite(raw.leverage); if (lev !== null && lev >= 1 && lev <= 20) c.leverage = Math.floor(lev);
  const mq = finite(raw.marginQuote); if (mq !== null && mq > 0) c.marginQuote = mq;
  const ma = finite(raw.maxActive); if (ma !== null && ma >= 1 && ma <= 4) c.maxActive = Math.floor(ma);
  if (raw.rulesVersion === 1 || raw.rulesVersion === 2) c.rulesVersion = raw.rulesVersion;
  const rp = finite(raw.riskPct); if (rp !== null && rp > 0 && rp <= 0.1) c.riskPct = rp;
  for (const side of ['long', 'short', 'early', 'top']) {
    const src = raw[side] && typeof raw[side] === 'object' ? raw[side] : {};
    // R2544.67: per sub-strategy JEV choice (true / false; absent = the lane's JEV mode)
    if ((side === 'early' || side === 'top') && typeof src.jev === 'boolean') c[side].jev = src.jev;
    for (const [k, v] of Object.entries(DEFAULT_CONFIG[side])) {
      if (typeof v === 'boolean') { if (typeof src[k] === 'boolean') c[side][k] = src[k]; continue; }
      const n = finite(src[k]); if (n !== null && n >= 0) c[side][k] = n;
    }
  }
  return c;
}
// R2544.57: İlk 3 margin (USDT, null = automatic) and leverage (1..20) from Office/API, validated; rules stay in the file.
function writeTop3Settings(root, patch = {}) {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(configFile(root), 'utf8').replace(/^\uFEFF/, '')) || {}; } catch {}
  const out = { ok: true, changed: {} };
  if (Object.prototype.hasOwnProperty.call(patch, 'marginQuote')) {
    const m = patch.marginQuote === null || patch.marginQuote === '' ? null : finite(patch.marginQuote);
    if (patch.marginQuote !== null && patch.marginQuote !== '' && !(m >= 5 && m <= 100000)) return { ok: false, reasons: ['TOP3_MARGIN_INVALID'] };
    if (m === null) delete raw.marginQuote; else raw.marginQuote = Number(m.toFixed(2)); out.changed.marginQuote = m;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'leverage')) {
    const l = finite(patch.leverage);
    if (!(Number.isInteger(l) && l >= 1 && l <= 20)) return { ok: false, reasons: ['TOP3_LEVERAGE_INVALID'] };
    raw.leverage = l; out.changed.leverage = l;
  }
  if (!Object.keys(out.changed).length) return { ok: false, reasons: ['TOP3_SETTING_MISSING'] };
  raw.updatedAt = new Date().toISOString();
  const file = configFile(root); fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(raw, null, 2), 'utf8'); fs.renameSync(tmp, file);
  return { ...out, config: readTop3Config(root) };
}
// Highest leverage whose liquidation lies beyond the stop (same rule as the order path: floor(1 / (stop + 0.5%))).
function safeLeverage(stopPct) { const s = finite(stopPct); return s > 0 ? Math.max(1, Math.floor(1 / (s + 0.005))) : null; }
// Only the three switches can be changed from Office/API; numeric rules stay in the file (user edits) or defaults.
function writeTop3Switches(root, patch = {}) {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(configFile(root), 'utf8').replace(/^﻿/, '')) || {}; } catch {}
  for (const k of ['enabled', 'jevMode', 'liveEnabled', 'committeeMode']) if (typeof patch[k] === 'boolean') raw[k] = patch[k];
  if (typeof patch.topSweep === 'boolean') { raw.top = raw.top && typeof raw.top === 'object' ? raw.top : {}; raw.top.requireSweep = patch.topSweep; } // R2544.70
  if (typeof patch.partialEnabled === 'boolean') { raw.partial = raw.partial && typeof raw.partial === 'object' ? raw.partial : {}; raw.partial.enabled = patch.partialEnabled; }
  // R2544.73: level (R) and share; null = default (2R, 50 %). Ranges are checked by the caller (configureTop3).
  for (const [k, f] of [['partAtR', 'atR'], ['partShare', 'share']]) if (Object.prototype.hasOwnProperty.call(patch, k)) {
    raw.partial = raw.partial && typeof raw.partial === 'object' ? raw.partial : {}; const v = patch[k] === null ? null : finite(patch[k]);
    if (v === null) delete raw.partial[f]; else raw.partial[f] = Number(v.toFixed(2)); }
  // R2544.67 sub-strategies: İLK 3 ERKEN LONG (early) / İLK 3 TEPE SHORT (top) on/off and their own JEV choice (null = lane's)
  for (const [k, side, field] of [['earlyEnabled', 'early', 'enabled'], ['topEnabled', 'top', 'enabled'], ['earlyJev', 'early', 'jev'], ['topJev', 'top', 'jev']]) {
    if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
    const v = patch[k]; if (typeof v !== 'boolean' && !(field === 'jev' && v === null)) continue;
    raw[side] = raw[side] && typeof raw[side] === 'object' ? raw[side] : {};
    if (v === null) delete raw[side][field]; else raw[side][field] = v;
  }
  raw.updatedAt = new Date().toISOString();
  const file = configFile(root); fs.mkdirSync(path.dirname(file), { recursive:true });
  const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(raw, null, 2), 'utf8'); fs.renameSync(tmp, file);
  return readTop3Config(root);
}

function median(a) { const s = a.filter(x => Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

// k: closed 1h candles, oldest first, [openTime, open, high, low, close, volume]. Features at the LAST closed candle,
// computed exactly as in the research (Claud-Work gelistirme/harness/malzeme-lab/top3*.py).
function hourlyFeatures(k) {
  const rows = (Array.isArray(k) ? k : []).map(r => [finite(r[0]), finite(r[1]), finite(r[2]), finite(r[3]), finite(r[4]), finite(r[5])]).filter(r => r.every(x => x !== null));
  const n = rows.length;
  if (n < 200) return { ok:false, reason:'TOP3_HISTORY_TOO_SHORT', bars:n };
  const o = rows.map(r => r[1]), h = rows.map(r => r[2]), l = rows.map(r => r[3]), c = rows.map(r => r[4]), v = rows.map(r => r[5]);
  const last = n - 1, cl = c[last];
  if (!(cl > 0)) return { ok:false, reason:'TOP3_PRICE_INVALID' };
  const volWin = v.slice(Math.max(0, last - 24 - 167), last - 24 + 1);
  const vmed = volWin.length >= 72 ? median(volWin) : null;
  const vr = j => vmed > 0 ? v[j] / vmed : null;
  const hi7Win = h.slice(Math.max(0, last - 168), last);
  const hi7 = hi7Win.length >= 72 ? Math.max(...hi7Win) : null;
  const rets = []; for (let i = Math.max(1, n - 720); i < n; i++) rets.push(c[i] / c[i - 1] - 1);
  const mean = rets.reduce((a, x) => a + x, 0) / rets.length;
  const vol30 = rets.length >= 200 ? Math.sqrt(rets.reduce((a, x) => a + (x - mean) ** 2, 0) / (rets.length - 1)) : null;
  const peak24 = Math.max(...h.slice(last - 23, last + 1));
  return {
    ok:true, openTime:rows[last][0], close:cl, open:o[last],
    r1:cl / c[last - 1] - 1, r3:cl / c[last - 3] - 1, r24:cl / c[last - 24] - 1,
    vr1:vr(last), vmed, breakout7d:hi7 !== null && cl > hi7, hi7, vol30,
    peak24, dropFromPeak:1 - cl / peak24, red:cl < o[last], high3:Math.max(h[last], h[last - 1], h[last - 2])
  };
}

function longSignal(f, ctx = {}, cfg = DEFAULT_CONFIG) {
  const L = cfg.long || DEFAULT_CONFIG.long, reasons = [];
  if (!L.enabled) return { ok:false, side:'LONG', reasons:['TOP3_LONG_DISABLED'] };
  if (!f?.ok) return { ok:false, side:'LONG', reasons:[f?.reason || 'TOP3_FEATURES_MISSING'] };
  if (!(f.r1 >= L.minR1)) reasons.push('R1_BELOW');
  if (!(f.vr1 >= L.minVrBase)) reasons.push('VOLUME_BASE_BELOW');
  if (!f.breakout7d) reasons.push('NO_7D_BREAKOUT');
  if (!(f.vr1 >= L.minVr1)) reasons.push('VOLUME_SURGE_BELOW');
  if (!(f.r24 >= L.minR24)) reasons.push('R24_BELOW');
  if (!(finite(ctx.rank) !== null && ctx.rank <= L.maxRank)) reasons.push('RANK_NOT_TOP');
  if (!(finite(ctx.top10In7d) !== null && ctx.top10In7d >= L.minTop10In7d)) reasons.push('NOT_A_REPEAT_GAINER');
  if (!(f.vol30 >= L.minVol30)) reasons.push('VOLATILITY_BELOW');
  if (!(finite(ctx.btc24) !== null && ctx.btc24 <= L.maxBtc24)) reasons.push('BTC_TOO_STRONG');
  return { ok:reasons.length === 0, side:'LONG', rule:'LONG_6OF6', reasons, stopPct:L.stopPct, tpPct:L.tpPct, maxHoldMs:L.maxHoldH * HOUR };
}

function shortSignal(f, ctx = {}, cfg = DEFAULT_CONFIG) {
  const S = cfg.short || DEFAULT_CONFIG.short, reasons = [];
  if (!S.enabled) return { ok:false, side:'SHORT', reasons:['TOP3_SHORT_DISABLED'] };
  if (!f?.ok) return { ok:false, side:'SHORT', reasons:[f?.reason || 'TOP3_FEATURES_MISSING'] };
  if (ctx.inTop3Within !== true) reasons.push('NOT_IN_TOP3_RECENTLY');
  if (!(f.dropFromPeak >= S.minDropFromPeak)) reasons.push('NOT_FAR_ENOUGH_FROM_PEAK');
  if (!f.red) reasons.push('HOUR_NOT_RED');
  if (!(f.vr1 >= S.minVr1)) reasons.push('VOLUME_BELOW');
  const stopRef = f.high3 * (1 + S.stopBufferPct);
  return { ok:reasons.length === 0, side:'SHORT', rule:'SHORT_TOP_FADE', reasons, stopRef, minStopPct:S.minStopPct, maxStopPct:S.maxStopPct, tpPct:S.tpPct, maxHoldMs:S.maxHoldH * HOUR };
}

// Entry geometry at the real fill price. LONG: fixed % stop/target. SHORT: structural stop above the last 3 hours' high,
// valid only 2%..8% away (fee and 10x liquidation safety); target fixed %.
function entryLevels(sig, price) {
  const p = finite(price); if (!(p > 0) || !sig?.ok) return { ok:false, reason:'TOP3_PRICE_INVALID' };
  if (sig.side === 'LONG') return { ok:true, stopPrice:p * (1 - sig.stopPct), tpPrice:p * (1 + sig.tpPct), stopPct:sig.stopPct };
  const d = finite(sig.stopRef) / p - 1;
  if (!(d >= sig.minStopPct && d <= sig.maxStopPct)) return { ok:false, reason:'TOP3_SHORT_STOP_OUT_OF_RANGE', stopPct:round(d, 4) };
  return { ok:true, stopPrice:sig.stopRef, tpPrice:p * (1 - sig.tpPct), stopPct:d };
}

// ---------------------------------------------------------------------------------------------------------------
// R2544.58 İLK 3 v2 (user 14.10.2026: "1 saatlik muma bakarak girerse sıvar; düşüşü/yükselişi erken mum seviyelerinden
// tespit etmeli; büyük zaman dilimlerinde kurulan likidasyon oyunlarına göre gardını almalı"; 05.10: "kovalama yok, OB /
// FVG / OTE / fibo / likidasyon bölgelerine bakacak"; 12.10: "ilk 3'e girecek coini erken yakala"; 13.10: "market maker
// shortçuları 1G / 1H / 1A likidasyon bölgelerine götürür, sonra oradan short basar"). Decisions on CLOSED 5m candles
// at the previous day / week / month highs (the short-liquidation zones); the same logic as the research script
// Claud-Work gelistirme/harness/malzeme-lab/v2_bt.py (6 months, 5m, fees, no future data).
//  EARLY LONG: a coin ranked 4..24 that climbed >= 3 places in 3 h and was not in the top 3 in 48 h; a 5m candle closes
//    through a day/week/month high with >= 3x its 24 h median 5m volume; NO chase - entry only on the first 5m retest
//    of that level (low within 0.4 %, close back above), stop under the retest; target just under the next higher zone
//    (skipped when that zone is closer than 2R: no long right under a liquidation zone), 3R when no zone is above.
//  TOP SHORT: a coin that was in the top 10 within 24 h makes a new 24 h high on 5m and within 12 candles closes under
//    the low of the 6 candles before that top (5m structure break); stop above the top; skipped when an untaken
//    day/week/month high lies within 5 % above (the market maker goes there first); target 2.5R.
// ---------------------------------------------------------------------------------------------------------------
const M5 = 5 * 60000, DAY = 24 * HOUR;
// 1d candles [openTime, o, h, l, c] oldest first -> highs of CLOSED UTC days before `now` (research: daily highs shifted)
function dailyLevels(kd, now) {
  const today = Math.floor(Number(now) / DAY) * DAY;
  const rows = (Array.isArray(kd) ? kd : []).map(r => [finite(r[0]), finite(r[2]), finite(r[3])]).filter(r => r[0] !== null && r[1] > 0 && r[2] > 0 && r[0] < today).sort((a, b) => a[0] - b[0]);
  const hs = rows.map(r => r[1]), ls = rows.map(r => r[2]);
  // highs drive the rules (research parity); lows are shown on the chart (long-liquidation zones)
  return { day: today, pdh: hs.length ? hs[hs.length - 1] : null, pwh: hs.length >= 3 ? Math.max(...hs.slice(-7)) : null, pmh: hs.length >= 10 ? Math.max(...hs.slice(-30)) : null,
    pdl: ls.length ? ls[ls.length - 1] : null, pwl: ls.length >= 3 ? Math.min(...ls.slice(-7)) : null, pml: ls.length >= 10 ? Math.min(...ls.slice(-30)) : null };
}
const levelList = lv => [lv?.pdh, lv?.pwh, lv?.pmh].map(finite).filter(x => x > 0);
// Hour context of the EARLY LONG at the last closed hour before the breakout candle (rank book + 24 h change).
function earlyLongContext({ rank = null, rankBefore = null, top3Recent = false, r24 = null } = {}, cfg = DEFAULT_CONFIG) {
  const E = cfg.early || DEFAULT_CONFIG.early, reasons = [];
  const rk = finite(rank), rb = finite(rankBefore);
  if (!(rk !== null && rk >= E.minRank && rk <= E.maxRank)) reasons.push('RANK_OUT_OF_BAND');
  if (rk !== null && !(rb === null || rb > E.maxRank || rb - rk >= E.climbPlaces)) reasons.push('NOT_CLIMBING');
  if (top3Recent) reasons.push('WAS_TOP3_RECENTLY');
  const r = finite(r24); if (!(r !== null && r >= E.minR24 && r <= E.maxR24)) reasons.push('R24_OUT_OF_BAND');
  return { ok: reasons.length === 0, reasons };
}
// k5: CLOSED 5m candles [t, o, h, l, c, quoteVolume] oldest first. Is the LAST candle the first valid retest of a fresh
// breakout through a day/week/month high? levelsAt(t) -> dailyLevels at that time, ctxAt(t) -> earlyLongContext result.
function earlyLongTrigger(k5, levelsAt, ctxAt, cfg = DEFAULT_CONFIG) {
  const E = cfg.early || DEFAULT_CONFIG.early;
  const k = (Array.isArray(k5) ? k5 : []).map(r => r.slice(0, 6).map(Number));
  const q = k.length - 1;
  if (q < E.minVolBars + 2) return { ok: false, reason: 'V2_5M_HISTORY_SHORT' };
  let near = null;
  for (let i = q - 1; i >= Math.max(1, q - E.retestBars); i--) {
    const lv = levelsAt(k[i][0]); if (!lv) continue;
    const pc = k[i - 1][4], c = k[i][4];
    // htfOnly: only the previous week / month highs count as zones (not the previous day)
    const brk = (E.htfOnly ? levelList({ pwh: lv.pwh, pmh: lv.pmh }) : levelList(lv)).filter(x => pc <= x && x < c); if (!brk.length) continue;
    const L = Math.max(...brk), t = k[i][0];
    const w = []; for (let j = i - 1; j >= 0 && j >= i - E.volBars; j--) if (k[j][0] >= t - DAY) w.push(k[j][5]);
    if (w.length < E.minVolBars) continue;
    const med = median(w); if (!(med > 0 && k[i][5] >= E.volMult * med)) { near = near || { reason: 'V2_BREAKOUT_VOLUME_LOW', level: L }; continue; }
    const cx = ctxAt(t); if (!cx?.ok) { near = near || { reason: 'V2_CONTEXT', reasons: cx?.reasons || [], level: L }; continue; }
    let first = null, failed = false;
    for (let m = i + 1; m <= q; m++) {
      if (k[m][0] - k[m - 1][0] > 3 * M5) { failed = true; break; }
      if (k[m][4] < L * (1 - E.failClose)) { failed = true; break; }
      if (k[m][3] <= L * (1 + E.retestTol) && k[m][4] >= L) { first = m; break; }
    }
    if (failed) { near = near || { reason: 'V2_BREAKOUT_FAILED', level: L }; continue; }
    if (first === null) return { ok: false, reason: 'V2_WAITING_RETEST', level: L, breakoutAt: t };
    if (first !== q) { near = near || { reason: 'V2_RETEST_ALREADY_PASSED', level: L }; continue; }
    return { ok: true, side: 'LONG', rule: 'LONG_EARLY_RETEST', level: L, retestLow: k[q][3], breakoutAt: t, retestAt: k[q][0], volMult: k[i][5] / med,
      levelName: L === finite(lv.pmh) ? 'PMH' : L === finite(lv.pwh) ? 'PWH' : 'PDH' };
  }
  return { ok: false, reason: near?.reason || 'V2_NO_BREAKOUT', ...(near || {}) };
}
// Stop under the retest (and the level), target just under the next higher zone; no long right under a zone.
function earlyLongPlan(price, trig, lv, cfg = DEFAULT_CONFIG) {
  const E = cfg.early || DEFAULT_CONFIG.early, p = finite(price);
  if (!(p > 0) || !trig?.ok) return { ok: false, reason: 'V2_PRICE_INVALID' };
  const stop = Math.min(trig.retestLow, trig.level) * (1 - E.stopBuf), s = 1 - stop / p;
  if (!(s >= E.minStopPct && s <= E.maxStopPct)) return { ok: false, reason: 'V2_STOP_OUT_OF_RANGE', stopPct: round(s, 4) };
  const above = levelList(lv).filter(x => x > p * 1.001);
  let tp, zone = null;
  if (above.length) { zone = Math.min(...above); if (zone < p * (1 + E.minRoomR * s)) return { ok: false, reason: 'V2_ZONE_TOO_CLOSE', zone, stopPct: round(s, 4) }; tp = zone * (1 - E.zoneTpBuf); }
  else tp = p * (1 + E.noZoneTargetR * s);
  return { ok: true, stopPrice: stop, tpPrice: tp, stopPct: s, targetR: (tp / p - 1) / s, zone };
}
// k5 as above (>= 24 h + 18 candles). Is the LAST candle the first close under the pre-top structure low after a fresh
// 24 h high made within the last 12 candles?
function topShortTrigger(k5, cfg = DEFAULT_CONFIG) {
  const T = cfg.top || DEFAULT_CONFIG.top;
  const k = (Array.isArray(k5) ? k5 : []).map(r => r.slice(0, 6).map(Number));
  const q = k.length - 1, W = 288;
  if (q < W + T.breakBars + T.hlBars) return { ok: false, reason: 'V2_5M_HISTORY_SHORT' };
  const isTop = j => { const w0 = j - W; if (w0 < 0 || k[j][0] - k[w0][0] > DAY + 3 * M5) return false; let mx = -Infinity; for (let m = w0; m < j; m++) if (k[m][2] > mx) mx = k[m][2]; return k[j][2] > mx; };
  if (isTop(q)) return { ok: false, reason: 'V2_NEW_HIGH_NOW' };
  let j = null; for (let m = q - 1; m >= q - T.breakBars; m--) if (isTop(m)) { j = m; break; }
  if (j === null) return { ok: false, reason: 'V2_NO_FRESH_TOP' };
  const top = k[j][2]; let hl = Infinity; for (let m = Math.max(0, j - T.hlBars); m < j; m++) hl = Math.min(hl, k[m][3]);
  for (let m = j + 1; m < q; m++) if (k[m][4] < hl) return { ok: false, reason: 'V2_BREAK_ALREADY_PASSED', top, hl };
  if (!(k[q][4] < hl)) return { ok: false, reason: 'V2_NO_BREAK_YET', top, hl };
  // volumetric top (research F1): the last green candle at/before the top vs the 24 h median 5m volume
  let topVolMult = null;
  if (T.minTopVolMult > 0) {
    let ob = null; for (let m = j; m >= Math.max(0, j - 6); m--) if (k[m][4] > k[m][1]) { ob = m; break; }
    const w = []; for (let m = j - 1; m >= 0 && m >= j - W; m--) if (k[m][0] >= k[j][0] - DAY) w.push(k[m][5]);
    const med = w.length >= 100 ? median(w) : null;
    topVolMult = ob !== null && med > 0 ? k[ob][5] / med : null;
    if (!(topVolMult !== null && topVolMult >= T.minTopVolMult)) return { ok: false, reason: 'V2_TOP_VOLUME_LOW', top, hl, topVolMult };
  }
  // R2544.70: liquidity sweep (SFP) before the short - a candle wicked above a known swing high and closed back below it
  let sweep = null;
  if (T.requireSweep !== false) {
    const cs = k.map(r => ({ openTime:r[0], open:r[1], high:r[2], low:r[3], close:r[4] }));
    const sw = PA.sweeps(cs, q, 'SHORT', { n:T.sweepN || 3, within:T.sweepWithin || 24, lookback:T.sweepLookback || 288 });
    if (!sw.length) return { ok: false, reason: 'V2_NO_SWEEP', top, hl, topVolMult };
    const x = sw[sw.length - 1]; sweep = { at:k[x.at][0] + M5 - 1, level:x.level, extreme:x.extreme, barsAgo:q - x.at };   // at = close of the sweep candle
  }
  return { ok: true, side: 'SHORT', rule: 'SHORT_TOP_BREAK', top, hl, topAt: k[j][0], breakAt: k[q][0], topVolMult, sweep };
}
function topShortPlan(price, trig, lv, cfg = DEFAULT_CONFIG) {
  const T = cfg.top || DEFAULT_CONFIG.top, p = finite(price);
  if (!(p > 0) || !trig?.ok) return { ok: false, reason: 'V2_PRICE_INVALID' };
  const stop = trig.top * (1 + T.stopBuf), s = stop / p - 1;
  if (!(s >= T.minStopPct && s <= T.maxStopPct)) return { ok: false, reason: 'V2_STOP_OUT_OF_RANGE', stopPct: round(s, 4) };
  if (levelList(lv).some(x => x > trig.top && x <= trig.top * (1 + T.zoneAbovePct))) return { ok: false, reason: 'V2_UNSWEPT_ZONE_ABOVE', stopPct: round(s, 4) };
  if (T.requireWeeklySwept && !(finite(lv?.pwh) > 0 && trig.top >= lv.pwh)) return { ok: false, reason: 'V2_WEEKLY_NOT_SWEPT' };
  return { ok: true, stopPrice: stop, tpPrice: p * (1 - T.targetR * s), stopPct: s, targetR: T.targetR };
}
// Position size from the risk budget (user 14.10: one stop cost ~20 % of the account in v1): notional = risk / stop,
// never above margin x leverage. riskQuote = riskPct x equity.
function riskSizedNotional({ equity, riskPct, stopPct, marginCap, leverage }) {
  const e = finite(equity), r = finite(riskPct), s = finite(stopPct), m = finite(marginCap), l = finite(leverage);
  if (!(e > 0 && r > 0 && s > 0 && m > 0 && l >= 1)) return null;
  return Math.min(e * r / s, m * l);
}

// Research dedupe (top3*.py): per coin and rule, a hit counts only if no COUNTED hit of the same rule in the previous
// 24 h (first hit counts, then the next hit at least 24 h later, and so on). hitTimes: candle open times where the rule
// held. Live this keeps a lane that starts late (or after a restart) from entering a move the research entered hours ago.
function countedSignalAt(hitTimes, T, dedupeMs = 24 * HOUR) {
  const hits = [...new Set((hitTimes || []).map(Number).filter(Number.isFinite))].filter(h => h <= T).sort((a, b) => a - b);
  let last = -Infinity; const counted = [];
  for (const h of hits) if (h - last >= dedupeMs) { counted.push(h); last = h; }
  return { counted: counted.includes(Number(T)), countedTimes: counted, firstHit: hits.length ? hits[0] : null, lastCounted: counted.filter(h => h < T).at(-1) ?? null };
}

// Hourly 24h-change ranks of USDT perpetuals (1 = biggest gainer), persisted for the "top 10 in the last 7 days" and
// "top 3 in the last 24 hours" conditions.
class RankBook {
  constructor({ file = null, keepHours = 200 } = {}) { this.file = file; this.keepHours = keepHours; this.hours = {}; this._load(); }
  _load() { if (!this.file) return; try { const x = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (x && typeof x.hours === 'object') this.hours = x.hours; } catch {} }
  save() {
    if (!this.file) return;
    try { fs.mkdirSync(path.dirname(this.file), { recursive:true }); const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ version:TOP3_VERSION, hours:this.hours }), 'utf8'); fs.renameSync(tmp, this.file); } catch {}
  }
  record(hourTs, rankMap) {
    const t = Math.floor(Number(hourTs) / HOUR) * HOUR; if (!Number.isFinite(t)) return;
    const top = {}; for (const [s, r] of Object.entries(rankMap || {})) if (Number(r) <= 50) top[s] = Number(r);   // only the top 50 are ever needed
    this.hours[t] = top;
    const keys = Object.keys(this.hours).map(Number).sort((a, b) => a - b);
    while (keys.length > this.keepHours) delete this.hours[keys.shift()];
  }
  hoursCovered(now, span) { const lo = now - span; return Object.keys(this.hours).map(Number).filter(t => t >= lo && t < now).length; }
  countInTop(symbol, topN, fromTs, toTs) {
    let n = 0; for (const [t, m] of Object.entries(this.hours)) { const tt = Number(t); if (tt >= fromTs && tt < toTs && Number(m[symbol]) <= topN) n++; }
    return n;
  }
  symbolsInTop(topN, fromTs, toTs) {
    const out = new Set(); for (const [t, m] of Object.entries(this.hours)) { const tt = Number(t); if (tt < fromTs || tt >= toTs) continue; for (const [s, r] of Object.entries(m)) if (Number(r) <= topN) out.add(s); }
    return [...out];
  }
}

// Rank map from /fapi/v1/ticker/24hr rows (rolling 24 h change, as shown in the Binance gainers list).
function ranksFromTickers(rows, tradable = null) {
  const list = (Array.isArray(rows) ? rows : []).map(x => ({ s:String(x?.symbol || '').toUpperCase(), p:finite(x?.priceChangePercent) }))
    .filter(x => /USDT$/.test(x.s) && x.p !== null && (!tradable || tradable.has(x.s))).sort((a, b) => b.p - a.p);
  const out = {}; list.forEach((x, i) => { out[x.s] = i + 1; }); return out;
}

// ---------------------------------------------------------------------------------------------------------------
// R2544.56 İlk 3 hafızası (user 13.10.2026: "beyin öğreniyor, kesin öğrendiğine emin ol; hatalarını görsün"). Every
// closed lot becomes a deterministic lesson (no model): entry features, the best and worst price excursion while it was
// open (5m candles), result, exit. The lane's own memory aggregates them per rule and signal kind (FRESH = the research
// would count it, REPEAT = the rule had already fired on this coin within 24 h); JEV mode reads it on every decision.
// The rules themselves never change by themselves: a rule change is a measured, user-approved release.
// ---------------------------------------------------------------------------------------------------------------
// candles: [openTime, open, high, low, close, ...] while the lot was open. Signed in the trade's direction:
// mfePct > 0 is the best move in favour, maePct < 0 the worst move against.
function excursions(side, entry, candles) {
  const e = finite(entry);
  const rows = (Array.isArray(candles) ? candles : []).map(r => [finite(r[0]), finite(r[2]), finite(r[3])]).filter(r => r.every(x => x !== null));
  if (!(e > 0) || !rows.length) return null;
  let hi = -Infinity, lo = Infinity, hiAt = null, loAt = null;
  for (const [t, h, l] of rows) { if (h > hi) { hi = h; hiAt = t; } if (l < lo) { lo = l; loAt = t; } }
  return side === 'LONG'
    ? { mfePct: hi / e - 1, maePct: lo / e - 1, mfeAt: hiAt, maeAt: loAt, bars: rows.length }
    : { mfePct: 1 - lo / e, maePct: 1 - hi / e, mfeAt: loAt, maeAt: hiAt, bars: rows.length };
}
const pctTr = v => v === null || v === undefined ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1).replace('.', ',') + '%';
const RULE_TR = { LONG_6OF6: 'LONG 6/6', SHORT_TOP_FADE: 'SHORT tepe sonrası', LONG_EARLY_RETEST: 'Erken LONG (5 dk geri test)', SHORT_TOP_BREAK: 'Tepe SHORT (5 dk kırılım)',
  ZIRVE5_FIBO_LONG: 'ZİRVE-5 LONG (15 dk alan onayı)', ZIRVE5_FIBO_SHORT: 'ZİRVE-5 SHORT (15 dk alan onayı)' }; // R2544.77
const EXIT_TR = { TOP3_TAKE_PROFIT: 'hedef', TOP3_STOP: 'stop', TOP3_BE_STOP: 'başabaş stop (kâr koruma sonrası)', TOP3_TIME_EXIT: '24 saat doldu', TOP3_STOP_OR_EXTERNAL: 'stop / dış kapanış', TOP3_OTHER_EXIT: 'diğer',
  TOP3_SYSTEM_CLOSE: 'sistem kapattı (durdurma / kurulum / mod geçişi; kural sonucu değil)', TOP3_EXTERNAL_CLOSE: 'dışarıdan kapatıldı (stop / hedef değil)' };
// R2544.57 (14.10 deploy STOP): a lot the core closed itself (STOP, TEST reset, switch to LIVE) or that was closed outside
// the lane without its stop/target is CUT_SHORT - not a stop; the rule never reached its own exit.
const CUT_SHORT_EXITS = new Set(['TOP3_SYSTEM_CLOSE', 'TOP3_EXTERNAL_CLOSE']);
// lot: the closed lot (state record + exitPrice/closedAt); close: the POSITION_CLOSED record; path: excursions() or null.
// R2544.77 (user 23.10: "beyine doğru öğrenim gitmiş mi"): ZİRVE-5 exits (ZIRVE5_*) map to the same tags; a lot whose part was taken
// (kâr koruma) has a BLENDED result - the rest's exit price alone said "kazanç -0,1 %" on a +0,42 R win; a winner that ran >= 3R and
// came back gets GAVE_BACK (AKE 23.10: 6,2R seen, closed at break-even).
const normExit = t => (t ? String(t).replace(/^ZIRVE5_/, 'TOP3_') : null);
function buildLesson(lot, close, path) {
  const side = lot.side, entry = finite(lot.entryPrice), exit = finite(lot.exitPrice) ?? null;
  const stopPct = finite(lot.stopPct), tp = finite(lot.tpPrice);
  const targetPct = entry > 0 && tp > 0 ? (side === 'LONG' ? tp / entry - 1 : 1 - tp / entry) : null;
  // without an exit fill price the result falls back to the booked net result (net PnL / notional)
  const outcome = finite(close?.outcomePct);
  const part = close?.partial && close.partial.taken === true ? close.partial : (lot.part && lot.part.done === true ? { atR:lot.part.atR, share:lot.part.share, taken:true } : null);
  // kâr koruma taken: the result is the whole lot's (net PnL / notional), never the rest's exit price alone
  const resultPct = part && outcome !== null ? outcome / 100 : entry > 0 && exit > 0 ? (side === 'LONG' ? exit / entry - 1 : 1 - exit / entry) : outcome !== null ? outcome / 100 : null;
  const net = finite(close?.netPnl), r = finite(close?.rMultiple);
  const mfe = path ? path.mfePct : finite(lot.sampleMfePct), mae = path ? path.maePct : finite(lot.sampleMaePct);
  const exitType = close?.exitType || null, xt = normExit(exitType);
  const mfeR = stopPct > 0 && mfe !== null ? mfe / stopPct : null;
  const tags = [];
  if (xt === 'TOP3_TAKE_PROFIT') tags.push('TARGET_HIT');
  if (xt === 'TOP3_STOP' || xt === 'TOP3_STOP_OR_EXTERNAL') tags.push('STOPPED');
  if (xt === 'TOP3_TIME_EXIT') tags.push('TIME_EXIT');
  if (xt === 'TOP3_BE_STOP') tags.push('BREAKEVEN_STOP');
  if (CUT_SHORT_EXITS.has(xt)) tags.push('CUT_SHORT', xt === 'TOP3_SYSTEM_CLOSE' ? 'SYSTEM_CLOSE' : 'EXTERNAL_CLOSE');
  if (part) tags.push('PARTIAL_TAKEN');
  if (mfeR !== null && r !== null && mfeR >= 3 && r <= mfeR - 2 && !tags.includes('TARGET_HIT')) tags.push('GAVE_BACK');
  if (tags.includes('STOPPED') && targetPct > 0 && mfe !== null && mfe >= targetPct / 2) tags.push('STOPPED_AFTER_HALF_TARGET');
  if (mfe !== null && mfe < 0.002) tags.push('NEVER_IN_PROFIT');
  if (lot.signalKind === 'REPEAT') tags.push('REPEAT_SIGNAL');
  const holdH = finite(lot.openedAt) && finite(lot.closedAt) ? (lot.closedAt - lot.openedAt) / HOUR : null;
  const verdict = net === null ? 'UNKNOWN' : net > 0 ? 'WIN' : net < 0 ? 'LOSS' : 'FLAT';
  const lessonTr = `${RULE_TR[lot.rule] || lot.rule}${lot.signalKind === 'REPEAT' ? ' (tekrar sinyal)' : ''}: ` +
    `${verdict === 'WIN' ? 'kazanç' : verdict === 'LOSS' ? 'kayıp' : verdict === 'FLAT' ? 'başabaş' : 'sonuç bilinmiyor'} ${pctTr(resultPct)}` +
    `${r !== null ? ' / ' + r.toFixed(2).replace('.', ',') + ' R' : ''}${holdH !== null ? ', ' + holdH.toFixed(1).replace('.', ',') + ' sa' : ''}; ` +
    `en iyi ${pctTr(mfe)}${mfeR !== null ? ' = ' + mfeR.toFixed(1).replace('.', ',') + ' R' : ''}${targetPct > 0 && mfe !== null ? ' (hedefin %' + Math.round(Math.max(0, mfe) / targetPct * 100) + "'i)" : ''}, en kötü ${pctTr(mae)}; çıkış ${EXIT_TR[xt] || exitType || '—'}.` +
    (part ? ` Kâr koruma: %${Math.round((finite(part.share) || 0.5) * 100)}'si ${String(finite(part.atR) ?? 1).replace('.', ',')}R'de alındı (sonuç tüm lotun).` : '') +
    (tags.includes('GAVE_BACK') ? ` ${mfeR.toFixed(1).replace('.', ',')} R gördükten sonra kârın çoğunu geri verdi.` : '') +
    (tags.includes('STOPPED_AFTER_HALF_TARGET') ? ' Hedefin yarısını gördükten sonra stop oldu.' : '') +
    (tags.includes('CUT_SHORT') ? ' Yarıda kesildi: kural kendi stop / hedef / 24 saat çıkışına ulaşmadı.' : '') +
    (tags.includes('NEVER_IN_PROFIT') ? ' Hiç kâra geçmedi.' : '');
  const round4 = v => v === null || v === undefined ? null : Number(Number(v).toFixed(4));
  return {
    // kind UNLABELED: a lot opened before the signal label existed (never counted as FRESH)
    v: 1, id: lot.id, symbol: lot.symbol, side, rule: lot.rule, kind: lot.signalKind || 'UNLABELED', mode: lot.mode || 'TEST',
    openedAt: finite(lot.openedAt), closedAt: finite(lot.closedAt), holdH: round4(holdH), entryPrice: entry, exitPrice: exit,
    stopPct: round4(stopPct), targetPct: round4(targetPct), resultPct: round4(resultPct), resultBasis: part && outcome !== null ? 'NET_PNL_WHOLE_LOT' : exit > 0 ? 'EXIT_PRICE' : resultPct !== null ? 'NET_PNL' : null,
    partial: part ? { atR:finite(part.atR), share:finite(part.share), taken:true } : null,
    netPnl: net, rMultiple: round4(r), verdict, exitType,
    mfePct: round4(mfe), maePct: round4(mae), mfeR: round4(mfeR),
    pathSource: path ? '5m' : (mfe !== null ? 'SAMPLES_30S' : 'NONE'), features: lot.entryFeatures || null, jev: lot.jev?.decision || null, tags, lessonTr
  };
}
// R2544.57 one-time repair of lessons written before the CUT_SHORT label (14.10 deploy STOP booked 4 open lots as
// "stop / dış kapanış"): a TOP3_STOP_OR_EXTERNAL lesson without an exit price whose result is clearly not a stop-out
// (R > -0.9) was closed by the core or outside the lane. Closed together with another lot (within 5 s) = the core's
// STOP; alone = outside. Only the lane memory is relabelled; the closed-trade ledger keeps its raw records.
function repairLessons(lessons) {
  const xs = Array.isArray(lessons) ? lessons : []; let repaired = 0;
  const out = xs.map(l0 => {
    // R2544.77: lessons written before this build - ZİRVE-5 exits had no tags; a kâr koruma lot (break-even exit with R > 0.2) showed
    // the rest's exit % ("kazanç -0,1 %" on a +0,42 R win); "1R sonrası korunan"; no GAVE_BACK. Repaired once (r2544_77 marker).
    let l = l0;
    if (l && !l.r2544_77) {
      const xt = normExit(l.exitType), r = finite(l.rMultiple), sp = finite(l.stopPct), mfeR = finite(l.mfeR) ?? (sp > 0 && finite(l.mfePct) !== null ? l.mfePct / sp : null);
      const tags = Array.isArray(l.tags) ? [...l.tags] : []; let text = String(l.lessonTr || ''), rp = finite(l.resultPct), basis = l.resultBasis || null, changed = false;
      const add = t => { if (!tags.includes(t)) { tags.push(t); changed = true; } };
      if (xt !== l.exitType) { if (xt === 'TOP3_TAKE_PROFIT') add('TARGET_HIT'); if (xt === 'TOP3_STOP') add('STOPPED'); if (xt === 'TOP3_TIME_EXIT') add('TIME_EXIT'); if (xt === 'TOP3_BE_STOP') add('BREAKEVEN_STOP');
        if (CUT_SHORT_EXITS.has(xt)) { add('CUT_SHORT'); add(xt === 'TOP3_SYSTEM_CLOSE' ? 'SYSTEM_CLOSE' : 'EXTERNAL_CLOSE'); } }
      if (xt === 'TOP3_BE_STOP' && r !== null && r > 0.2 && sp > 0 && rp !== null && rp < r * sp - 0.002) {   // a half was taken: whole-lot result ~ R x stop %
        rp = Number((r * sp).toFixed(4)); basis = 'R_X_STOP_WHOLE_LOT'; add('PARTIAL_TAKEN');
        text = text.replace(/(kazanç|kayıp|başabaş) [-+]?[0-9]+,[0-9]+%/, 'kazanç ' + (rp >= 0 ? '+' : '') + (rp * 100).toFixed(1).replace('.', ',') + '%'); changed = true; }
      if (mfeR !== null && r !== null && mfeR >= 3 && r <= mfeR - 2 && !tags.includes('TARGET_HIT')) { add('GAVE_BACK'); text += ' ' + mfeR.toFixed(1).replace('.', ',') + ' R gördükten sonra kârın çoğunu geri verdi.'; }
      if (text.includes('1R sonrası korunan')) { text = text.replace('1R sonrası korunan', 'kâr koruma sonrası'); changed = true; }
      if (xt !== l.exitType && EXIT_TR[xt] && text.includes('çıkış ' + l.exitType)) { text = text.replace('çıkış ' + l.exitType, 'çıkış ' + EXIT_TR[xt]); changed = true; }
      for (const [k, v] of Object.entries(RULE_TR)) if (k.startsWith('ZIRVE5_') && text.startsWith(k + ':')) { text = v + text.slice(k.length); changed = true; }
      if (changed) { repaired++; l = { ...l, tags, lessonTr:text, resultPct:rp, resultBasis:basis, mfeR:mfeR !== null ? Number(mfeR.toFixed(4)) : null, r2544_77:true }; }
    }
    // R2544.62: a close after the break-even move was booked against the moved stop (CTR 42.6R, SIREN 69.4R); the lesson
    // keeps the entry stop %, so R = result % / entry stop % minus the 0.1 % round-trip fee.
    {const r = finite(l?.rMultiple), sp = finite(l?.stopPct), rp = finite(l?.resultPct);
     if (r !== null && r > 10 && sp > 0 && rp !== null) {
       const fixed = Number(((rp - 0.001) / sp).toFixed(4)); repaired++;
       return { ...l, rMultiple: fixed, lessonTr: String(l.lessonTr || '').replace(/ \/ -?[0-9]+,[0-9]+ R/, ' / ' + fixed.toFixed(2).replace('.', ',') + ' R'), repairedFrom: 'R_MOVED_STOP_BASIS' };
     }}
    if (l?.exitType !== 'TOP3_STOP_OR_EXTERNAL' || finite(l.exitPrice) > 0) return l;
    const r = finite(l.rMultiple); if (r === null || r <= -0.9) return l;
    const batch = xs.some(o => o !== l0 && finite(o?.closedAt) !== null && Math.abs(o.closedAt - l.closedAt) <= 5000);
    const entry = finite(l.entryPrice), t = finite(l.targetPct), stopPct = finite(l.stopPct);
    const lot = { id: l.id, symbol: l.symbol, side: l.side, rule: l.rule, signalKind: l.kind === 'UNLABELED' ? undefined : l.kind, mode: l.mode,
      entryPrice: entry, exitPrice: null, stopPct, tpPrice: entry > 0 && t !== null ? (l.side === 'LONG' ? entry * (1 + t) : entry * (1 - t)) : null,
      openedAt: l.openedAt, closedAt: l.closedAt, entryFeatures: l.features, jev: l.jev ? { decision: l.jev } : null, sampleMfePct: l.mfePct, sampleMaePct: l.maePct };
    const outcomePct = stopPct !== null ? r * stopPct * 100 : null; // net R x stop distance = net PnL / notional
    const fixed = buildLesson(lot, { netPnl: l.netPnl, rMultiple: r, exitType: batch ? 'TOP3_SYSTEM_CLOSE' : 'TOP3_EXTERNAL_CLOSE', outcomePct }, null);
    repaired++;
    return { ...fixed, pathSource: l.pathSource, mfeR: l.mfeR, repairedFrom: 'TOP3_STOP_OR_EXTERNAL' };
  });
  return { lessons: out, repaired };
}
const BUCKETS = {
  SHORT_TOP_FADE: { feature: 'dropFromPeak', label: 'tepeden düşüş', edges: [0.15, 0.25, 0.40] },
  LONG_6OF6: { feature: 'r24', label: '24 saat yükseliş', edges: [0.133, 0.30, 0.60] },
  LONG_EARLY_RETEST: { feature: 'r24', label: '24 saat yükseliş', edges: [0.05, 0.15, 0.25] },
  SHORT_TOP_BREAK: { feature: 'r24', label: '24 saat yükseliş', edges: [0, 0.3, 0.6] }
};
function aggregate(xs) {
  const n = xs.length, num = k => xs.map(x => finite(x[k])).filter(v => v !== null);
  const avg = k => { const v = num(k); return v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(4)) : null; };
  const has = t => xs.filter(x => (x.tags || []).includes(t)).length;
  const wins = xs.filter(x => x.verdict === 'WIN').length, losses = xs.filter(x => x.verdict === 'LOSS').length;
  return { n, wins, losses, winRate: n ? Number((wins / n).toFixed(3)) : null, avgR: avg('rMultiple'), avgResultPct: avg('resultPct'), avgMfePct: avg('mfePct'), avgMaePct: avg('maePct'),
    targetHit: has('TARGET_HIT'), stopped: has('STOPPED'), timeExit: has('TIME_EXIT'), stoppedAfterHalfTarget: has('STOPPED_AFTER_HALF_TARGET'), neverInProfit: has('NEVER_IN_PROFIT'),
    cutShort: has('CUT_SHORT'), breakevenStop: has('BREAKEVEN_STOP'),
    netPnl: Number(num('netPnl').reduce((a, b) => a + b, 0).toFixed(4)) };
}
// R2544.79 (kullanıcı 26.10: "beyin doğru çıkarım yapmış mı ... tecrübe kazanmış bir trader gibi"): v2 kuralları ve ZİRVE-5 için
// 'r24' kovası hiç dolmuyordu (v2 giriş özelliklerinde r24 yok -> tüm kovalar n=0, beyin hiçbir koşulu ayıramıyordu). Artık her
// kural, girişte yazılan bilgilere göre KATEGORİ tablosu tutar (indikatör bilgisi, kırılan seviye). Tablo hem JEV'e (laneExperience)
// gider hem de JEV'siz modda gölge 'tecrübe kararı' üretir (karar vermez; kaydedilir, Office'te görünür, sonra ölçülür).
const yn = v => (v === true ? 'EVET' : v === false ? 'HAYIR' : null);
const IND_CATS = Object.freeze([
  { key:'vdpmObstacle2R', label:'2R öncesi karşı hacim seviyesi (VDPM)', get:l => yn(l.features?.ind?.vdpm?.obstacle2R) },
  { key:'vwobOppIn2R', label:'2R öncesi karşı order block (VWOB)', get:l => yn(l.features?.ind?.vwob?.oppIn2R) },
  { key:'lthTrend', label:'trend (LTH)', get:l => l.features?.ind?.lth?.trend || null },
  { key:'lrvp', label:'oturum eğimi + delta (LRVP)', get:l => { const r = l.features?.ind?.lrvp; return r ? (r.trendWith && r.deltaWith ? 'IKISI_YONDE' : !r.trendWith && !r.deltaWith ? 'IKISI_TERS' : 'KARISIK') : null; } }
]);
const CAT_BUCKETS = Object.freeze({
  LONG_EARLY_RETEST:[...IND_CATS, { key:'levelName', label:'kırılan seviye', get:l => l.features?.levelName || null }],
  SHORT_TOP_BREAK:IND_CATS, ZIRVE5_FIBO_LONG:IND_CATS, ZIRVE5_FIBO_SHORT:IND_CATS
});
const EXPERIENCE_MIN_N = 15, EXPERIENCE_EDGE_R = 0.25, EXPERIENCE_OTHER_N = 10, EXPERIENCE_GAP_R = 0.3, LAB_MIN_N = 50, LAB_GAP_R = 0.15;
// Uzun dönem hafızası (6 ay laboratuvar, harness/indikator/lab_priors.js): İlk 3 12.04-10.10 5 dk (CANLI top3-hunter.js girişleri,
// bugünkü yönetim), ZİRVE-5 22.04-19.10 15 dk 222 coin, bugünkü kural (LONG+SHORT birlikte). Değer başına {n, avgR}. Son dersler küçük
// örnekle yanılabilir (TEST'te 'PWH kırılımı kaybettirir' 16 ders -0,59R; 6 ayda PWH +0,03R n221 / PMH +0,02R n283): gölge karar ancak
// son dersler VE bu hafıza aynı yönü gösterirse verilir.
const LAB_PRIORS = Object.freeze({"LONG_EARLY_RETEST":{"vdpmObstacle2R":{"HAYIR":{"n":417,"avgR":0.08},"EVET":{"n":87,"avgR":-0.228}},"vwobOppIn2R":{"HAYIR":{"n":421,"avgR":0.062},"EVET":{"n":83,"avgR":-0.151}},"lthTrend":{"FLAT":{"n":7,"avgR":0.518},"WITH":{"n":495,"avgR":0.024},"AGAINST":{"n":2,"avgR":-1.075}},"lrvp":{"IKISI_YONDE":{"n":402,"avgR":0.054},"KARISIK":{"n":66,"avgR":-0.196},"IKISI_TERS":{"n":12,"avgR":-0.598}},"levelName":{"PWH":{"n":221,"avgR":0.032},"PMH":{"n":283,"avgR":0.023}}},"SHORT_TOP_BREAK":{"vdpmObstacle2R":{"EVET":{"n":430,"avgR":0.033},"HAYIR":{"n":83,"avgR":-0.013}},"vwobOppIn2R":{"HAYIR":{"n":94,"avgR":0.062},"EVET":{"n":419,"avgR":0.017}},"lthTrend":{"AGAINST":{"n":440,"avgR":0.015},"WITH":{"n":7,"avgR":0.278},"FLAT":{"n":66,"avgR":0.069}},"lrvp":{"IKISI_TERS":{"n":327,"avgR":0.065},"KARISIK":{"n":115,"avgR":-0.047},"IKISI_YONDE":{"n":30,"avgR":0.161}}},"ZIRVE5_FIBO_LONG":{"vdpmObstacle2R":{"HAYIR":{"n":169,"avgR":0.171},"EVET":{"n":62,"avgR":-0.244}},"vwobOppIn2R":{"EVET":{"n":63,"avgR":0.034},"HAYIR":{"n":168,"avgR":0.069}},"lthTrend":{"WITH":{"n":112,"avgR":0.095},"AGAINST":{"n":66,"avgR":-0.131},"FLAT":{"n":53,"avgR":0.222}},"lrvp":{"IKISI_YONDE":{"n":100,"avgR":0.013},"IKISI_TERS":{"n":72,"avgR":0.093},"KARISIK":{"n":53,"avgR":-0.003}}},"ZIRVE5_FIBO_SHORT":{"vdpmObstacle2R":{"HAYIR":{"n":169,"avgR":0.171},"EVET":{"n":62,"avgR":-0.244}},"vwobOppIn2R":{"EVET":{"n":63,"avgR":0.034},"HAYIR":{"n":168,"avgR":0.069}},"lthTrend":{"WITH":{"n":112,"avgR":0.095},"AGAINST":{"n":66,"avgR":-0.131},"FLAT":{"n":53,"avgR":0.222}},"lrvp":{"IKISI_YONDE":{"n":100,"avgR":0.013},"IKISI_TERS":{"n":72,"avgR":0.093},"KARISIK":{"n":53,"avgR":-0.003}}}});
function catTable(xs, cats) {
  return cats.map(cat => { const vals = [...new Set(xs.map(cat.get).filter(v => v !== null))].sort();
    return { key:cat.key, label:cat.label, unknown:xs.filter(l => cat.get(l) === null).length, rows:vals.map(v => { const g = aggregate(xs.filter(l => cat.get(l) === v)); return { value:v, n:g.n, wins:g.wins, losses:g.losses, avgR:g.avgR, netPnl:g.netPnl }; }) }; }); // compact: JEV packet
}
// Gölge tecrübe kararı: yeni sinyalin her bilgisi için aynı kuralın aynı değerli dersleri. En az 15 ders, ortalama <= -0,25R, eski
// yarı + yeni yarı ikisi de eksi VE aynı kuralın diğer değerli dersleri (en az 10) en az 0,3R daha iyi -> AVOID ('tecrübe: girme');
// simetriği FAVOR. Diğer değerle ayrışmayan bir koşul (ör. derslerin hepsi 'trend yönde') çıkarım sayılmaz: kuralın genel sonucudur
// (gerçek 68 dersle zaman sıralı yeniden oynatmada ayrışma şartı olmadan AVOID +0,01R / FAVOR -1,09R çıktı). Karar vermez.
function experienceVerdict(lessons, rule, features) {
  const base = { version:'R2544.79-EXPERIENCE', shadow:true, rule, minN:EXPERIENCE_MIN_N, edgeR:EXPERIENCE_EDGE_R };
  const cats = CAT_BUCKETS[rule]; if (!cats) return { ...base, verdict:'NO_TABLE', findings:[], text:'bu kural için tablo yok' };
  const xs = (Array.isArray(lessons) ? lessons : []).filter(l => l && l.rule === rule && finite(l.rMultiple) !== null).sort((a, b) => (finite(a.closedAt) || 0) - (finite(b.closedAt) || 0));
  const me = { features:features || {} }, avg = z => (z.length ? z.reduce((a, l) => a + l.rMultiple, 0) / z.length : null), r3 = v => (v === null ? null : Number(v.toFixed(3)));
  const findings = [];
  for (const cat of cats) {
    const v = cat.get(me); if (v === null) continue;
    const g = xs.filter(l => cat.get(l) === v), n = g.length, h = Math.floor(n / 2), av = avg(g), a1 = avg(g.slice(0, h)), a2 = avg(g.slice(h));
    const o = xs.filter(l => { const w = cat.get(l); return w !== null && w !== v; }), ao = avg(o), sep = o.length >= EXPERIENCE_OTHER_N && ao !== null && av !== null;
    let call = n < EXPERIENCE_MIN_N ? 'FEW' : !sep ? 'NO_CONTRAST'
      : av <= -EXPERIENCE_EDGE_R && a1 < 0 && a2 < 0 && ao - av >= EXPERIENCE_GAP_R ? 'AVOID'
      : av >= EXPERIENCE_EDGE_R && a1 > 0 && a2 > 0 && av - ao >= EXPERIENCE_GAP_R ? 'FAVOR' : 'NEUTRAL';
    // long-term memory check
    const lab = LAB_PRIORS[rule]?.[cat.key], lv = lab?.[v], lo = lab ? Object.entries(lab).filter(([k]) => k !== v).map(([, x]) => x) : [];
    const loN = lo.reduce((a, x) => a + x.n, 0), loAvg = loN ? lo.reduce((a, x) => a + x.n * x.avgR, 0) / loN : null;
    const labAgrees = lv && lv.n >= LAB_MIN_N && loAvg !== null && (call === 'AVOID' ? loAvg - lv.avgR >= LAB_GAP_R : call === 'FAVOR' ? lv.avgR - loAvg >= LAB_GAP_R : false);
    if ((call === 'AVOID' || call === 'FAVOR') && !labAgrees) call = 'LAB_DISAGREES';
    findings.push({ key:cat.key, label:cat.label, value:v, n, avgR:r3(av), older:r3(a1), newer:r3(a2), otherN:o.length, otherAvgR:r3(ao), labN:lv?.n ?? null, labAvgR:lv?.avgR ?? null, labOtherAvgR:r3(loAvg), call });
  }
  const verdict = !findings.length ? 'NO_INFO' : findings.some(f => f.call === 'AVOID') ? 'AVOID' : findings.some(f => f.call === 'FAVOR') ? 'FAVOR' : findings.every(f => f.call === 'FEW' || f.call === 'NO_CONTRAST') ? 'FEW' : 'NEUTRAL';
  const disagree = findings.filter(f => f.call === 'LAB_DISAGREES').map(f => `${f.label} ${f.value}: son ${f.n} ders ${String(f.avgR.toFixed(2)).replace('.', ',')}R ama 6 ay ${f.labN ?? 0} işlem ${f.labAvgR === null ? '—' : String(f.labAvgR.toFixed(2)).replace('.', ',')}R`).join('; ');
  const tr = { AVOID:'tecrübe: GİRME (gölge)', FAVOR:'tecrübe: olumlu (gölge)', FEW:'tecrübe: yeterli ders yok', NEUTRAL:'tecrübe: belirgin fark yok', NO_INFO:'tecrübe: bilgi yok' }[verdict];
  const why = findings.filter(f => f.call === 'AVOID' || f.call === 'FAVOR').map(f => `${f.label} ${f.value}: ${f.n} ders ort ${String(f.avgR.toFixed(2)).replace('.', ',')}R (diğerleri ${f.otherN} ders ${String(f.otherAvgR.toFixed(2)).replace('.', ',')}R)`).join('; ');
  return { ...base, verdict, findings, text:tr + (why ? ' — ' + why : '') + (disagree ? ' • 6 ay aksini söylüyor: ' + disagree : '') };
}
// ===== R2544.80 ÖĞRENME: neden kaybetti / nasıl kazandı, tek düze olmadan (kullanıcı 26.10: "tek bir kurala odaklanmaması ... her
// zaman aynı koşulda kazandım veya kaybettim dememeli ... tek düze bir beyin oluşmasın"). Kaynak: her dersin otopsisi (trade-autopsy.js).
//  1) causeStats: kayıplar nasıl oldu, kazançlar nasıl oldu (sonuç tanımları) + ETKENLERİN ayırt ediciliği: bir etken (geç giriş, BTC,
//     takip hacmi, 2R içinde karşı seviye) ancak kayıplarda ve kazançlarda en az 25 puan farklı sıklıkta ve her iki tarafta en az 8 ders
//     varsa 'ayırt edici' sayılır; ikisinde de benzer sıklıkta görülen etken 'tek başına neden değil' diye yazılır.
//  2) similarCases: yeni sinyal için girişte bilinen ÇOK özellikli benzerlik (indikatör bilgisi, giriş öncesi koşu, BTC son 1 sa, stop
//     genişliği, kırılan seviye, 4 sa yapı) ile en benzer geçmiş dersler; coin başına en çok 2 (çeşitlilik), sonuçları VE nedenleri,
//     karışıksa 'tek düze ders yok' uyarısı. Karar vermez; JEV ve Office okur, kaydedilir.
const DISCRIM_MIN_N = 8, DISCRIM_GAP = 0.25, LAB_FACTOR_GAP = 0.10;
// R2544.81 otopsi etkenlerinin 6 aylık hafızası (harness/indikator/lab_factors.js; İlk 3 504+513 işlem, ZİRVE-5 231 işlem LONG+SHORT birlikte,
// trade-autopsy.js ile aynı tanımlar): etken değerinin kayıplardaki / kazançlardaki sıklığı. TEST'te 18 dersle 'ayırt edici' çıkan
// 'TEPE SHORT: hacim gelmedi' (kayıp %60 / kazanç %25) 6 ayda kayıp %25 / kazanç %25: tesadüf; 30 dk erken çıkış da sonucu bozdu (-0,03R).
// Son dersler bir etkeni ayırt edici gösterse bile bu hafıza aynı yönde en az 10 puan fark göstermiyorsa ders sayılmaz (TEST_ONLY).
const LAB_FACTORS = Object.freeze({"LONG_EARLY_RETEST":{"losses":331,"wins":173,"gecGiris:true":{"lossPct":0.698,"winPct":0.751},"btc:TERS":{"lossPct":0.018,"winPct":0.058},"btc:YONDE":{"lossPct":0.012,"winPct":0.035},"hacim:YOK":{"lossPct":0.112,"winPct":0.075},"hacim:GUCLU":{"lossPct":0.659,"winPct":0.803},"seviye2R:true":{"lossPct":0.193,"winPct":0.133}},"SHORT_TOP_BREAK":{"losses":307,"wins":188,"gecGiris:true":{"lossPct":0,"winPct":0},"btc:TERS":{"lossPct":0.104,"winPct":0.165},"btc:YONDE":{"lossPct":0.052,"winPct":0.314},"hacim:YOK":{"lossPct":0.254,"winPct":0.245},"hacim:GUCLU":{"lossPct":0.27,"winPct":0.271},"seviye2R:true":{"lossPct":0.824,"winPct":0.846}},"ZIRVE5_FIBO_LONG":{"losses":133,"wins":98,"gecGiris:true":{"lossPct":0.12,"winPct":0.122},"btc:TERS":{"lossPct":0.075,"winPct":0.071},"btc:YONDE":{"lossPct":0.068,"winPct":0.122},"hacim:YOK":{"lossPct":0.353,"winPct":0.265},"hacim:GUCLU":{"lossPct":0.241,"winPct":0.418},"seviye2R:true":{"lossPct":0.293,"winPct":0.235}},"ZIRVE5_FIBO_SHORT":{"losses":133,"wins":98,"gecGiris:true":{"lossPct":0.12,"winPct":0.122},"btc:TERS":{"lossPct":0.075,"winPct":0.071},"btc:YONDE":{"lossPct":0.068,"winPct":0.122},"hacim:YOK":{"lossPct":0.353,"winPct":0.265},"hacim:GUCLU":{"lossPct":0.241,"winPct":0.418},"seviye2R:true":{"lossPct":0.293,"winPct":0.235}}});
const CAUSE_SHORT = { HIZLI_TERS:'hızlı ters dönüş', STOP_AVI:'stop avı (yön doğru)', YANLIS_YON:'yön yanlış', KARSI_SEVIYE:'karşı seviyeden döndü', PIYASA_TERS:'BTC ters',
  TAKIP_HACMI_YOK:'hacim gelmedi', GEC_GIRIS:'giriş öncesi koşu', ZAMAN:'süre doldu', BELIRSIZ_YON:'yön belirsiz', TEMIZ_DEVAM:'temiz devam', DIRENC_SONRASI:'sarsılıp döndü',
  PIYASA_DESTEGI:'BTC destekledi', HACIMLI_TAKIP:'hacimli takip', KAR_GERI_VERDI:'kârı geri verdi', HEDEF_ERKEN:'hedef erken', KAR_KORUMA:'kâr koruma + başabaş' };
const causeTr = c => CAUSE_SHORT[c] || c;
const FACTOR_DEFS = [
  ['gecGiris', v => (v === true ? 'girişten önce 30 dk içinde fiyat zaten 1,5R+ yönde gitmişti' : null)],
  ['btc', v => (v === 'TERS' ? 'BTC işlem süresince ters' : v === 'YONDE' ? 'BTC işlem süresince yönde' : null)],
  ['hacim', v => (v === 'YOK' ? 'girişten sonra hacim gelmedi' : v === 'GUCLU' ? 'girişten sonra güçlü hacim' : null)],
  ['seviye2R', v => (v === true ? '2R içinde karşı hacim seviyesi vardı' : null)]
];
function causeStats(lessons, rule) {
  const xs = (Array.isArray(lessons) ? lessons : []).filter(l => l && l.rule === rule && l.autopsy?.ok);
  const loss = xs.filter(l => l.autopsy.outcome === 'KAYIP'), win = xs.filter(l => l.autopsy.outcome === 'KAZANC');
  const dist = z => { const c = {}; for (const l of z) for (const k of l.autopsy.causes || []) c[k] = (c[k] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([code, n]) => ({ code, n, pct:Number((n / z.length).toFixed(2)) })); };
  const factors = [];
  for (const [key, label] of FACTOR_DEFS) {
    const vals = [...new Set(xs.map(l => l.autopsy.factors?.[key]).filter(v => v !== null && v !== undefined && label(v)))];
    for (const v of vals) {
      const lp = loss.length ? loss.filter(l => l.autopsy.factors?.[key] === v).length / loss.length : null, wp = win.length ? win.filter(l => l.autopsy.factors?.[key] === v).length / win.length : null;
      const enough = loss.length >= DISCRIM_MIN_N && win.length >= DISCRIM_MIN_N;
      let call = !enough ? 'AZ_ORNEK' : Math.max(lp, wp) < 0.15 ? 'NADIR' : lp - wp >= DISCRIM_GAP ? 'KAYIP_TARAFI' : wp - lp >= DISCRIM_GAP ? 'KAZANC_TARAFI' : 'IKI_TARAFTA';
      const lab = LAB_FACTORS[rule]?.[key + ':' + v] || null, labDiff = lab ? lab.lossPct - lab.winPct : null;
      if ((call === 'KAYIP_TARAFI' && !(labDiff >= LAB_FACTOR_GAP)) || (call === 'KAZANC_TARAFI' && !(labDiff <= -LAB_FACTOR_GAP))) call = 'TEST_ONLY';
      factors.push({ key, value:v, label:label(v), lossPct:lp === null ? null : Number(lp.toFixed(2)), winPct:wp === null ? null : Number(wp.toFixed(2)), labLossPct:lab?.lossPct ?? null, labWinPct:lab?.winPct ?? null, call });
    }
  }
  const dir = { DOGRU:0, YANLIS:0, BELIRSIZ:0 }; for (const l of loss) if (l.autopsy.direction) dir[l.autopsy.direction]++;
  const pc = v => (v === null ? '—' : '%' + Math.round(v * 100));
  const lines = [];
  if (loss.length) lines.push(`Kayıplar (${loss.length}) nasıl oldu: ` + dist(loss).slice(0, 4).map(x => `${causeTr(x.code)} ${pc(x.pct)}`).join(', ') + ` • yön doğru ${dir.DOGRU} / yanlış ${dir.YANLIS}${dir.BELIRSIZ ? ' / belirsiz ' + dir.BELIRSIZ : ''}`);
  if (win.length) lines.push(`Kazançlar (${win.length}) nasıl oldu: ` + dist(win).slice(0, 4).map(x => `${causeTr(x.code)} ${pc(x.pct)}`).join(', '));
  const d = factors.filter(f => f.call === 'KAYIP_TARAFI' || f.call === 'KAZANC_TARAFI'), same = factors.filter(f => f.call === 'IKI_TARAFTA');
  if (d.length) lines.push('Ayırt edici (son dersler + 6 ay aynı yönde): ' + d.map(f => `${f.label} (kayıp ${pc(f.lossPct)} / kazanç ${pc(f.winPct)}; 6 ay ${pc(f.labLossPct)} / ${pc(f.labWinPct)})`).join('; '));
  if (same.length) lines.push('Tek başına neden DEĞİL (kazançta da kayıpta da benzer): ' + same.map(f => `${f.label} (kayıp ${pc(f.lossPct)} / kazanç ${pc(f.winPct)})`).join('; '));
  const tOnly = factors.filter(f => f.call === 'TEST_ONLY');
  if (tOnly.length) lines.push('Son derslerde ayırt edici görünüyor ama 6 ayda TUTMUYOR (ders sayılmaz): ' + tOnly.map(f => `${f.label} (son: kayıp ${pc(f.lossPct)} / kazanç ${pc(f.winPct)}; 6 ay: ${pc(f.labLossPct)} / ${pc(f.labWinPct)})`).join('; '));
  const labRows = Object.entries(LAB_FACTORS[rule] || {}).filter(([k, x]) => x && x.lossPct !== undefined && Math.abs(x.lossPct - x.winPct) >= LAB_FACTOR_GAP);
  if (labRows.length) lines.push('6 aylık hafıza: ' + labRows.map(([k, x]) => { const [key, val] = k.split(':'), def = FACTOR_DEFS.find(d => d[0] === key), lbl = def ? def[1](val === 'true' ? true : val) : k; return `${lbl} (kayıp ${pc(x.lossPct)} / kazanç ${pc(x.winPct)})`; }).join('; ') + ' — BTC ve hacim işlem sırasında ortaya çıkar: giriş kararı değil, yönetim bilgisi.');
  if (loss.length < DISCRIM_MIN_N || win.length < DISCRIM_MIN_N) lines.push(`Ayırt edicilik için her iki tarafta en az ${DISCRIM_MIN_N} otopsili ders gerekir (şimdi kayıp ${loss.length}, kazanç ${win.length}).`);
  return { version:'R2544.81-LEARN', lessons:xs.length, losses:loss.length, wins:win.length, lossHow:dist(loss), winHow:dist(win), lossDirection:dir, factors, text:lines };
}
// compact forms for the JEV packet (48 kB ceiling): the text already carries the distributions
const learningForJev = c => (c ? { lessons:c.lessons, losses:c.losses, wins:c.wins, lossDirection:c.lossDirection, factors:c.factors.map(f => ({ key:f.key, value:f.value, lossPct:f.lossPct, winPct:f.winPct, labLossPct:f.labLossPct, labWinPct:f.labWinPct, call:f.call })), text:c.text } : null);
const similarForJev = q => (q ? { n:q.n, wins:q.wins, losses:q.losses, avgR:q.avgR, mixed:q.mixed, thin:q.thin, text:q.text, cases:q.cases.map(c => ({ symbol:c.symbol, R:c.R, causes:c.causes })) } : null);
const bucket3 = (v, a, b) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v) < a ? 'L' : Number(v) < b ? 'M' : 'H');
function entryVector(f, autopsy) {
  const x = f || {}, ind = x.ind?.ok ? x.ind : null, ec = x.entryCtx || (autopsy?.metrics ? { preRunR:autopsy.metrics.preRunR, btc1hWith:autopsy.metrics.btc1hWith } : null);
  const lr = ind?.lrvp ? (ind.lrvp.trendWith && ind.lrvp.deltaWith ? 'YY' : !ind.lrvp.trendWith && !ind.lrvp.deltaWith ? 'TT' : 'K') : null;
  return { vdpm:ind ? ind.vdpm?.obstacle2R === true : null, vwob:ind ? ind.vwob?.oppIn2R === true : null, lth:ind?.lth?.trend ?? null, lrvp:lr,
    preRun:bucket3(ec?.preRunR, 0.5, 1.5), btc1h:bucket3(ec?.btc1hWith, -0.3, 0.3), stop:bucket3(finite(x.stopPct) ?? ec?.stopPct, 0.02, 0.04),
    level:x.levelName ?? null, h4:x.mtf ? (x.mtf.against4h === true ? 'TERS' : 'DEGIL') : null };
}
function similarCases(lessons, rule, features, { k = 8, minSim = 0.6, perSymbol = 2 } = {}) {
  const me = entryVector(features), keys = Object.keys(me).filter(q => me[q] !== null);
  const xs = (Array.isArray(lessons) ? lessons : []).filter(l => l && l.rule === rule && finite(l.rMultiple) !== null);
  const scored = [];
  for (const l of xs) { const v = entryVector({ ...(l.features || {}), stopPct:l.stopPct }, l.autopsy); const both = keys.filter(q => v[q] !== null); if (both.length < 3) continue;
    const sim = both.filter(q => v[q] === me[q]).length / both.length; if (sim >= minSim) scored.push({ l, sim, used:both.length }); }
  scored.sort((a, b) => b.sim - a.sim || (b.l.closedAt || 0) - (a.l.closedAt || 0));
  const per = {}, pick = [];
  for (const sc of scored) { if ((per[sc.l.symbol] || 0) >= perSymbol) continue; per[sc.l.symbol] = (per[sc.l.symbol] || 0) + 1; pick.push(sc); if (pick.length >= k) break; }
  const n = pick.length, wins = pick.filter(q => q.l.rMultiple > 0.3).length, losses = pick.filter(q => q.l.rMultiple < -0.3).length, avgR = n ? pick.reduce((a, q) => a + q.l.rMultiple, 0) / n : null;
  const days = new Set(pick.map(q => Math.floor((q.l.openedAt || 0) / 86400000))).size, coins = new Set(pick.map(q => q.l.symbol)).size;
  const how = z => { const c = {}; for (const q of z) for (const w of q.l.autopsy?.causes || []) c[w] = (c[w] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([w]) => causeTr(w)); };
  const mixed = wins >= 2 && losses >= 2, thin = n < 5 || days < 3 || coins < 3;
  const r2 = v => String(Number(v).toFixed(2)).replace('.', ',');
  const text = !n ? 'benzer geçmiş durum yok' : `benzer ${n} durum (${coins} coin, ${days} gün): ${wins} kazanç / ${losses} kayıp, ort ${r2(avgR)}R` +
    (losses ? ` • kayıplar: ${how(pick.filter(q => q.l.rMultiple < -0.3)).join(', ') || '—'}` : '') + (wins ? ` • kazançlar: ${how(pick.filter(q => q.l.rMultiple > 0.3)).join(', ') || '—'}` : '') +
    (mixed ? ' • SONUÇLAR KARIŞIK: bu koşullar tek başına sonucu belirlemiyor' : '') + (thin ? ' • az/dar örnek: anekdot' : '');
  return { version:'R2544.80-SIMILAR', n, wins, losses, avgR:avgR === null ? null : Number(avgR.toFixed(3)), coins, days, mixed, thin, features:me,
    cases:pick.map(q => ({ symbol:q.l.symbol, R:Number(q.l.rMultiple.toFixed(2)), sim:Number(q.sim.toFixed(2)), outcome:q.l.autopsy?.outcome || null, causes:q.l.autopsy?.causes || [], at:q.l.openedAt || null })), text };
}
function bucketsFor(lessons, rule) {
  if (CAT_BUCKETS[rule]) { const xs = lessons.filter(l => l.rule === rule); return { categorical:true, label:'çıkarım tablosu', cats:catTable(xs, CAT_BUCKETS[rule]) }; }
  const b = BUCKETS[rule]; if (!b) return null;
  const xs = lessons.filter(l => l.rule === rule && finite(l.features?.[b.feature]) !== null);
  const rows = b.edges.map((lo, i) => {
    const hi = b.edges[i + 1] ?? Infinity;
    const g = xs.filter(l => l.features[b.feature] >= lo && l.features[b.feature] < hi);
    return { from: lo, to: Number.isFinite(hi) ? hi : null, ...aggregate(g) };
  });
  return { feature: b.feature, label: b.label, rows };
}
function experienceSummary(lessons, { mode = null, recent = 8 } = {}) {
  const xs = (Array.isArray(lessons) ? lessons : []).filter(l => !mode || l.mode === mode);
  const keys = [...new Set(xs.map(l => `${l.mode}|${l.rule}|${l.kind}`))].sort();
  const groups = keys.map(k => { const [m, rule, kind] = k.split('|'); return { mode: m, rule, kind, ...aggregate(xs.filter(l => `${l.mode}|${l.rule}|${l.kind}` === k)) }; });
  const rules = [...new Set(xs.map(l => l.rule))];
  return { lessons: xs.length, groups, buckets: Object.fromEntries(rules.map(r => [r, bucketsFor(xs, r)]).filter(([, v]) => v)),
    recent: xs.slice(-recent).reverse().map(l => ({ symbol: l.symbol, side: l.side, rule: l.rule, kind: l.kind, mode: l.mode, closedAt: l.closedAt, verdict: l.verdict, rMultiple: l.rMultiple, resultPct: l.resultPct, mfePct: l.mfePct, maePct: l.maePct, exitType: l.exitType, tags: l.tags, lessonTr: l.lessonTr })) };
}
// R2544.79: the indicator info travels to JEV as 4 flags (not the whole object) so the 48 kB request ceiling is not pushed
function jevFeatures(f) { if (!f || typeof f !== 'object') return f; const { pa, ...noPa } = f; if (!f.ind) return noPa; const x = f.ind; const { ind, experience, ...rest } = noPa; // past pa dropped: the signal has its own
  return { ...rest, ind:x.ok ? { vdpmObstacle2R:x.vdpm?.obstacle2R ?? null, vwobOppIn2R:x.vwob?.oppIn2R ?? null, lthTrend:x.lth?.trend ?? null, lrvp:x.lrvp ? [x.lrvp.trendWith, x.lrvp.deltaWith] : null } : null, experience:experience?.verdict || null }; }
// What JEV sees for one rule: this lane's measured history of that rule (both signal kinds, both modes), its feature
// buckets and the latest lessons with their entry features.
function experienceFor(lessons, rule, { recent = 6, features = null } = {}) {
  const xs = (Array.isArray(lessons) ? lessons : []).filter(l => l.rule === rule);
  const s = experienceSummary(xs, { recent });
  return { rule, closedLots: xs.length, groups: s.groups, buckets: s.buckets[rule] || null, labPriors: LAB_PRIORS[rule] || null,
    learning: CAT_BUCKETS[rule] ? learningForJev(causeStats(xs, rule)) : null, similar: features && CAT_BUCKETS[rule] ? similarForJev(similarCases(xs, rule, features)) : null,
    recent: xs.slice(-recent).reverse().map(l => ({ symbol: l.symbol, side: l.side, kind: l.kind, mode: l.mode, verdict: l.verdict, rMultiple: l.rMultiple, resultPct: l.resultPct, mfePct: l.mfePct, maePct: l.maePct, exitType: l.exitType, features: jevFeatures(l.features), lessonTr: l.lessonTr, autopsy: l.autopsy?.ok ? l.autopsy.text : null })),
    note: xs.length < 10 ? 'FEW_SAMPLES_TREAT_AS_ANECDOTE' : 'MEASURED_HISTORY' };
}

// R2544.67: İlk 3's two rules are two named strategies (own switch, own JEV choice, own results; user 20.10)
const TOP3_SUBS = Object.freeze({ early: Object.freeze({ key: 'early', name: 'İLK 3 ERKEN LONG', side: 'LONG', rule: 'LONG_EARLY_RETEST', setup: 'TOP3_LONG_EARLY_RETEST' }),
  top: Object.freeze({ key: 'top', name: 'İLK 3 TEPE SHORT', side: 'SHORT', rule: 'SHORT_TOP_BREAK', setup: 'TOP3_SHORT_TOP_BREAK' }) });
const subOf = side => (side === 'LONG' ? TOP3_SUBS.early : TOP3_SUBS.top);
// effective JEV use of a sub-strategy: its own choice, else the lane's JEV mode
function subJev(cfg, side) { const R = side === 'LONG' ? cfg?.early : cfg?.top; return typeof R?.jev === 'boolean' ? R.jev : cfg?.jevMode === true; }
module.exports = { TOP3_SUBS, subOf, subJev, dailyLevels, earlyLongContext, earlyLongTrigger, earlyLongPlan, topShortTrigger, topShortPlan, riskSizedNotional, M5,
  writeTop3Settings, safeLeverage, excursions, buildLesson, repairLessons, experienceSummary, experienceFor, experienceVerdict, CAT_BUCKETS, EXPERIENCE_MIN_N, LAB_PRIORS, causeStats, similarCases, entryVector, learningForJev, similarForJev, LAB_FACTORS, TOP3_VERSION, DEFAULT_CONFIG, HOUR, readTop3Config, writeTop3Switches, hourlyFeatures, longSignal, shortSignal, entryLevels, countedSignalAt, RankBook, ranksFromTickers, median };
