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
  for (const k of ['enabled', 'jevMode', 'liveEnabled']) if (typeof patch[k] === 'boolean') raw[k] = patch[k];
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
const RULE_TR = { LONG_6OF6: 'LONG 6/6', SHORT_TOP_FADE: 'SHORT tepe sonrası', LONG_EARLY_RETEST: 'Erken LONG (5 dk geri test)', SHORT_TOP_BREAK: 'Tepe SHORT (5 dk kırılım)' };
const EXIT_TR = { TOP3_TAKE_PROFIT: 'hedef', TOP3_STOP: 'stop', TOP3_BE_STOP: 'başabaş stop (1R sonrası korunan)', TOP3_TIME_EXIT: '24 saat doldu', TOP3_STOP_OR_EXTERNAL: 'stop / dış kapanış', TOP3_OTHER_EXIT: 'diğer',
  TOP3_SYSTEM_CLOSE: 'sistem kapattı (durdurma / kurulum / mod geçişi; kural sonucu değil)', TOP3_EXTERNAL_CLOSE: 'dışarıdan kapatıldı (stop / hedef değil)' };
// R2544.57 (14.10 deploy STOP): a lot the core closed itself (STOP, TEST reset, switch to LIVE) or that was closed outside
// the lane without its stop/target is CUT_SHORT - not a stop; the rule never reached its own exit.
const CUT_SHORT_EXITS = new Set(['TOP3_SYSTEM_CLOSE', 'TOP3_EXTERNAL_CLOSE']);
// lot: the closed lot (state record + exitPrice/closedAt); close: the POSITION_CLOSED record; path: excursions() or null.
function buildLesson(lot, close, path) {
  const side = lot.side, entry = finite(lot.entryPrice), exit = finite(lot.exitPrice) ?? null;
  const stopPct = finite(lot.stopPct), tp = finite(lot.tpPrice);
  const targetPct = entry > 0 && tp > 0 ? (side === 'LONG' ? tp / entry - 1 : 1 - tp / entry) : null;
  // without an exit fill price the result falls back to the booked net result (net PnL / notional)
  const outcome = finite(close?.outcomePct);
  const resultPct = entry > 0 && exit > 0 ? (side === 'LONG' ? exit / entry - 1 : 1 - exit / entry) : outcome !== null ? outcome / 100 : null;
  const net = finite(close?.netPnl), r = finite(close?.rMultiple);
  const mfe = path ? path.mfePct : finite(lot.sampleMfePct), mae = path ? path.maePct : finite(lot.sampleMaePct);
  const exitType = close?.exitType || null;
  const tags = [];
  if (exitType === 'TOP3_TAKE_PROFIT') tags.push('TARGET_HIT');
  if (exitType === 'TOP3_STOP' || exitType === 'TOP3_STOP_OR_EXTERNAL') tags.push('STOPPED');
  if (exitType === 'TOP3_TIME_EXIT') tags.push('TIME_EXIT');
  if (exitType === 'TOP3_BE_STOP') tags.push('BREAKEVEN_STOP');
  if (CUT_SHORT_EXITS.has(exitType)) tags.push('CUT_SHORT', exitType === 'TOP3_SYSTEM_CLOSE' ? 'SYSTEM_CLOSE' : 'EXTERNAL_CLOSE');
  if (tags.includes('STOPPED') && targetPct > 0 && mfe !== null && mfe >= targetPct / 2) tags.push('STOPPED_AFTER_HALF_TARGET');
  if (mfe !== null && mfe < 0.002) tags.push('NEVER_IN_PROFIT');
  if (lot.signalKind === 'REPEAT') tags.push('REPEAT_SIGNAL');
  const holdH = finite(lot.openedAt) && finite(lot.closedAt) ? (lot.closedAt - lot.openedAt) / HOUR : null;
  const verdict = net === null ? 'UNKNOWN' : net > 0 ? 'WIN' : net < 0 ? 'LOSS' : 'FLAT';
  const lessonTr = `${RULE_TR[lot.rule] || lot.rule}${lot.signalKind === 'REPEAT' ? ' (tekrar sinyal)' : ''}: ` +
    `${verdict === 'WIN' ? 'kazanç' : verdict === 'LOSS' ? 'kayıp' : verdict === 'FLAT' ? 'başabaş' : 'sonuç bilinmiyor'} ${pctTr(resultPct)}` +
    `${r !== null ? ' / ' + r.toFixed(2).replace('.', ',') + ' R' : ''}${holdH !== null ? ', ' + holdH.toFixed(1).replace('.', ',') + ' sa' : ''}; ` +
    `en iyi ${pctTr(mfe)}${targetPct > 0 && mfe !== null ? ' (hedefin %' + Math.round(Math.max(0, mfe) / targetPct * 100) + "'i)" : ''}, en kötü ${pctTr(mae)}; çıkış ${EXIT_TR[exitType] || exitType || '—'}.` +
    (tags.includes('STOPPED_AFTER_HALF_TARGET') ? ' Hedefin yarısını gördükten sonra stop oldu.' : '') +
    (tags.includes('CUT_SHORT') ? ' Yarıda kesildi: kural kendi stop / hedef / 24 saat çıkışına ulaşmadı.' : '') +
    (tags.includes('NEVER_IN_PROFIT') ? ' Hiç kâra geçmedi.' : '');
  const round4 = v => v === null || v === undefined ? null : Number(Number(v).toFixed(4));
  return {
    // kind UNLABELED: a lot opened before the signal label existed (never counted as FRESH)
    v: 1, id: lot.id, symbol: lot.symbol, side, rule: lot.rule, kind: lot.signalKind || 'UNLABELED', mode: lot.mode || 'TEST',
    openedAt: finite(lot.openedAt), closedAt: finite(lot.closedAt), holdH: round4(holdH), entryPrice: entry, exitPrice: exit,
    stopPct: round4(stopPct), targetPct: round4(targetPct), resultPct: round4(resultPct), resultBasis: exit > 0 ? 'EXIT_PRICE' : resultPct !== null ? 'NET_PNL' : null,
    netPnl: net, rMultiple: round4(r), verdict, exitType,
    mfePct: round4(mfe), maePct: round4(mae), mfeR: stopPct > 0 && mfe !== null ? round4(mfe / stopPct) : null,
    pathSource: path ? '5m' : (mfe !== null ? 'SAMPLES_30S' : 'NONE'), features: lot.entryFeatures || null, jev: lot.jev?.decision || null, tags, lessonTr
  };
}
// R2544.57 one-time repair of lessons written before the CUT_SHORT label (14.10 deploy STOP booked 4 open lots as
// "stop / dış kapanış"): a TOP3_STOP_OR_EXTERNAL lesson without an exit price whose result is clearly not a stop-out
// (R > -0.9) was closed by the core or outside the lane. Closed together with another lot (within 5 s) = the core's
// STOP; alone = outside. Only the lane memory is relabelled; the closed-trade ledger keeps its raw records.
function repairLessons(lessons) {
  const xs = Array.isArray(lessons) ? lessons : []; let repaired = 0;
  const out = xs.map(l => {
    // R2544.62: a close after the break-even move was booked against the moved stop (CTR 42.6R, SIREN 69.4R); the lesson
    // keeps the entry stop %, so R = result % / entry stop % minus the 0.1 % round-trip fee.
    {const r = finite(l?.rMultiple), sp = finite(l?.stopPct), rp = finite(l?.resultPct);
     if (r !== null && r > 10 && sp > 0 && rp !== null) {
       const fixed = Number(((rp - 0.001) / sp).toFixed(4)); repaired++;
       return { ...l, rMultiple: fixed, lessonTr: String(l.lessonTr || '').replace(/ \/ -?[0-9]+,[0-9]+ R/, ' / ' + fixed.toFixed(2).replace('.', ',') + ' R'), repairedFrom: 'R_MOVED_STOP_BASIS' };
     }}
    if (l?.exitType !== 'TOP3_STOP_OR_EXTERNAL' || finite(l.exitPrice) > 0) return l;
    const r = finite(l.rMultiple); if (r === null || r <= -0.9) return l;
    const batch = xs.some(o => o !== l && finite(o?.closedAt) !== null && Math.abs(o.closedAt - l.closedAt) <= 5000);
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
function bucketsFor(lessons, rule) {
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
// What JEV sees for one rule: this lane's measured history of that rule (both signal kinds, both modes), its feature
// buckets and the latest lessons with their entry features.
function experienceFor(lessons, rule, { recent = 6 } = {}) {
  const xs = (Array.isArray(lessons) ? lessons : []).filter(l => l.rule === rule);
  const s = experienceSummary(xs, { recent });
  return { rule, closedLots: xs.length, groups: s.groups, buckets: s.buckets[rule] || null,
    recent: xs.slice(-recent).reverse().map(l => ({ symbol: l.symbol, side: l.side, kind: l.kind, mode: l.mode, verdict: l.verdict, rMultiple: l.rMultiple, resultPct: l.resultPct, mfePct: l.mfePct, maePct: l.maePct, exitType: l.exitType, features: l.features, lessonTr: l.lessonTr })),
    note: xs.length < 10 ? 'FEW_SAMPLES_TREAT_AS_ANECDOTE' : 'MEASURED_HISTORY' };
}

// R2544.67: İlk 3's two rules are two named strategies (own switch, own JEV choice, own results; user 20.10)
const TOP3_SUBS = Object.freeze({ early: Object.freeze({ key: 'early', name: 'İLK 3 ERKEN LONG', side: 'LONG', rule: 'LONG_EARLY_RETEST', setup: 'TOP3_LONG_EARLY_RETEST' }),
  top: Object.freeze({ key: 'top', name: 'İLK 3 TEPE SHORT', side: 'SHORT', rule: 'SHORT_TOP_BREAK', setup: 'TOP3_SHORT_TOP_BREAK' }) });
const subOf = side => (side === 'LONG' ? TOP3_SUBS.early : TOP3_SUBS.top);
// effective JEV use of a sub-strategy: its own choice, else the lane's JEV mode
function subJev(cfg, side) { const R = side === 'LONG' ? cfg?.early : cfg?.top; return typeof R?.jev === 'boolean' ? R.jev : cfg?.jevMode === true; }
module.exports = { TOP3_SUBS, subOf, subJev, dailyLevels, earlyLongContext, earlyLongTrigger, earlyLongPlan, topShortTrigger, topShortPlan, riskSizedNotional, M5,
  writeTop3Settings, safeLeverage, excursions, buildLesson, repairLessons, experienceSummary, experienceFor, TOP3_VERSION, DEFAULT_CONFIG, HOUR, readTop3Config, writeTop3Switches, hourlyFeatures, longSignal, shortSignal, entryLevels, countedSignalAt, RankBook, ranksFromTickers, median };
