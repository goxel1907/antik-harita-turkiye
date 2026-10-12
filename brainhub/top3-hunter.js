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

const TOP3_VERSION = 'R2544.56_TOP3_HUNTER';
const DEFAULT_CONFIG = Object.freeze({
  enabled:false, jevMode:false, liveEnabled:false, leverage:10, marginQuote:null, maxActive:2,
  long:Object.freeze({ enabled:true, minR1:0.03, minVrBase:3, minVr1:33.9, minR24:0.133, maxRank:7, minTop10In7d:1, minVol30:0.0134, maxBtc24:0.0129, stopPct:0.08, tpPct:0.30, maxHoldH:24 }),
  short:Object.freeze({ enabled:true, top3WithinH:24, minDropFromPeak:0.15, minVr1:3, stopBufferPct:0.01, minStopPct:0.02, maxStopPct:0.08, tpPct:0.10, maxHoldH:24 })
});
const HOUR = 3600000;

const finite = v => { if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const round = (v, d = 6) => v === null || v === undefined ? null : Number(Number(v).toFixed(d));

function configFile(root) { return path.join(String(root || '.'), 'config', 'top3-hunter.json'); }
function readTop3Config(root) {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(configFile(root), 'utf8').replace(/^﻿/, '')) || {}; } catch {}
  const c = { ...DEFAULT_CONFIG, long:{ ...DEFAULT_CONFIG.long }, short:{ ...DEFAULT_CONFIG.short } };
  for (const k of ['enabled', 'jevMode', 'liveEnabled']) if (typeof raw[k] === 'boolean') c[k] = raw[k];
  const lev = finite(raw.leverage); if (lev !== null && lev >= 1 && lev <= 20) c.leverage = Math.floor(lev);
  const mq = finite(raw.marginQuote); if (mq !== null && mq > 0) c.marginQuote = mq;
  const ma = finite(raw.maxActive); if (ma !== null && ma >= 1 && ma <= 4) c.maxActive = Math.floor(ma);
  for (const side of ['long', 'short']) {
    const src = raw[side] && typeof raw[side] === 'object' ? raw[side] : {};
    for (const [k, v] of Object.entries(DEFAULT_CONFIG[side])) {
      if (typeof v === 'boolean') { if (typeof src[k] === 'boolean') c[side][k] = src[k]; continue; }
      const n = finite(src[k]); if (n !== null && n >= 0) c[side][k] = n;
    }
  }
  return c;
}
// Only the three switches can be changed from Office/API; numeric rules stay in the file (user edits) or defaults.
function writeTop3Switches(root, patch = {}) {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(configFile(root), 'utf8').replace(/^﻿/, '')) || {}; } catch {}
  for (const k of ['enabled', 'jevMode', 'liveEnabled']) if (typeof patch[k] === 'boolean') raw[k] = patch[k];
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

module.exports = { TOP3_VERSION, DEFAULT_CONFIG, HOUR, readTop3Config, writeTop3Switches, hourlyFeatures, longSignal, shortSignal, entryLevels, RankBook, ranksFromTickers, median };
