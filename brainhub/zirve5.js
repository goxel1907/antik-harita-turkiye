'use strict';
// R2544.64 ZİRVE-5 SHORT (kullanıcı 20.10: "bu yeni strateji 15 m de çalışacak", "stratejilere isim ver"). Kendi adıyla kayıt:
// hat ZIRVE5, kurulum ZIRVE5_FIBO_SHORT. Laboratuvar (ZİRVE-5 testi, 20.09-20.10, piyasa geneli ilk 5 volatil, 15 dk, ücret %0,12,
// fonlama dahil): FiboBuLL SHORT k1.5 2R +0,27R n120 4/5 hafta; LONG her ayarda eksi -> yalnız SHORT.
//  Evren: her kapanan 15 dk mumda Binance USDT-M 24 sa (yüksek-düşük)/son fiyat sırası, 24 sa hacim >= 20M USDT, ilk 5.
//  Bölge: fibo-zones.js (grafikte çizilenle aynı). Dip kırılımı -> SHORT bölgesi [kırılan dip, kırılımı yapan tepe];
//  DENGE (orta) beklenir. Fiyat dengeye değince piyasa emriyle SHORT (laboratuvarda limit dolumu; kayma ücrete dahil).
//  Stop: bölge üstü %0,1 (stop %0,2..%8 dışı -> işlem yok). Hedef 2R. En çok 24 sa. Bölge 48 mum (12 sa) dolmazsa / 15 dk
//  kapanış bölge üstünde -> iptal. Coin başına tek lot. TEST: kendi anahtarı; LIVE: ayrıca liveEnabled (kullanıcı, 'LIVE' onayıyla).
const fs = require('fs');
const path = require('path');
const { fiboZones } = require('./fibo-zones');

const ZIRVE5_VERSION = 'R2544.67.5-ZIRVE5-SHORT';
const LANE = 'ZIRVE5', SETUP = 'ZIRVE5_FIBO_SHORT', RULE = 'ZIRVE5_FIBO_SHORT';
const M15 = 900000;
const DEFAULT_CONFIG = Object.freeze({ enabled:true, liveEnabled:false, jevMode:false, k:1.5, windowBars:48, targetR:2, maxHoldH:24, minStopPct:0.002, maxStopPct:0.08,
  topN:5, minQuote24h:20e6, marginQuote:null, leverage:null,
  // R2544.67.2 (self-audit): at most maxActive open ZİRVE-5 lots in LIVE (İlk 3 has 2); TEST has no limit
  maxActive:2,
  // R2544.67.3 (self-audit): without its own margin the lot is sized by risk - this share of equity lost at the stop
  riskPct:0.02,
  // R2544.67.5 (21.10 night: 5 of 5 SHORTs stopped, 3 of them on coins up +37..+131 % over 24 h): SHORT only a coin that is
  // DOWN over 24 h. Lab (ZİRVE-5, 30 d): 24 h <= 0 +0.57 R n66 5/5 weeks; 24 h > 0 -0.09 R n54; > +30 % -0.31 R n21. On by
  // default, switchable in Office (it was found on the same month's data, so the live result decides).
  requireFalling24h:true });
const finite = v => { if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

function configFile(root) { return path.join(String(root || '.'), 'config', 'zirve5.json'); }
function readConfig(root) {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(configFile(root), 'utf8').replace(/^﻿/, '')) || {}; } catch {}
  const c = { ...DEFAULT_CONFIG };
  for (const k of ['enabled', 'liveEnabled', 'jevMode', 'requireFalling24h']) if (typeof raw[k] === 'boolean') c[k] = raw[k];
  const mq = finite(raw.marginQuote); if (mq !== null && mq >= 5) c.marginQuote = mq;
  const lev = finite(raw.leverage); if (lev !== null && lev >= 1 && lev <= 20) c.leverage = Math.floor(lev);
  const ma = finite(raw.maxActive); if (ma !== null && ma >= 1 && ma <= 5) c.maxActive = Math.floor(ma);
  const rp = finite(raw.riskPct); if (rp !== null && rp > 0 && rp <= 0.05) c.riskPct = rp;
  return c;
}
function writeConfig(root, patch = {}) {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(configFile(root), 'utf8').replace(/^﻿/, '')) || {}; } catch {}
  for (const k of ['enabled', 'liveEnabled', 'jevMode', 'requireFalling24h']) if (typeof patch[k] === 'boolean') raw[k] = patch[k];
  // R2544.67.5 (user 21.10 "marj ayarını istediğim zaman testte değiştiremiyorum"): ZİRVE-5's own margin (null = by risk) and leverage
  if (Object.prototype.hasOwnProperty.call(patch, 'marginQuote')) {
    const m = patch.marginQuote === null || patch.marginQuote === '' ? null : finite(patch.marginQuote);
    if (m === null) delete raw.marginQuote; else if (m >= 5 && m <= 100000) raw.marginQuote = Number(m.toFixed(2)); else return { ok:false, reasons:['ZIRVE5_MARGIN_INVALID'] };
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'leverage')) {
    const l = patch.leverage === null || patch.leverage === '' ? null : finite(patch.leverage);
    if (l === null) delete raw.leverage; else if (Number.isInteger(l) && l >= 1 && l <= 20) raw.leverage = l; else return { ok:false, reasons:['ZIRVE5_LEVERAGE_INVALID'] };
  }
  raw.updatedAt = new Date().toISOString();
  const file = configFile(root); fs.mkdirSync(path.dirname(file), { recursive:true });
  const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(raw, null, 2), 'utf8'); fs.renameSync(tmp, file);
  return readConfig(root);
}

// /fapi/v1/ticker/24hr rows -> ilk N (24 sa aralığı / son fiyat), yalnız tradable (USDT perpetual, işlemde) semboller.
function rankByRange(tickers, cfg = DEFAULT_CONFIG, tradable = null) {
  const rows = [];
  for (const t of Array.isArray(tickers) ? tickers : []) {
    const s = String(t?.symbol || '').toUpperCase();
    if (!/^[A-Z0-9]{2,24}USDT$/.test(s) || (tradable && !tradable.has(s))) continue;
    const hi = finite(t.highPrice), lo = finite(t.lowPrice), last = finite(t.lastPrice), qv = finite(t.quoteVolume);
    if (!(hi > 0 && lo > 0 && last > 0 && hi >= lo) || !(qv >= cfg.minQuote24h)) continue;
    rows.push({ symbol:s, range:(hi - lo) / last, quoteVolume:qv, change:finite(t.priceChangePercent) });
  }
  rows.sort((a, b) => b.range - a.range || a.symbol.localeCompare(b.symbol));
  return rows.slice(0, cfg.topN).map((r, i) => ({ ...r, rank:i + 1, range:Number(r.range.toFixed(5)) }));
}

// Kapanmış 15 dk mumlarından bekleyen SHORT bölgeleri (grafikteki ve laboratuvardaki kural; her bölge bağımsız izlenir):
// dolmamış, kırılmamış, süresi geçmemiş olanlar, eskiden yeniye. candles: [{openTime, closeTime, open, high, low, close}].
function armedShortZones(candles, cfg = DEFAULT_CONFIG) {
  const r = fiboZones(candles, { k:cfg.k, window:cfg.windowBars });
  return r.zones.filter(z => z.side === 'SHORT' && z.state === 'WAITING').map(z => ({ side:'SHORT', top:z.top, bottom:z.bottom,
    equilibrium:z.equilibrium, stopPrice:z.top * 1.001, liquidity:z.liquidity, zoneAt:z.at, expiresAt:z.at + cfg.windowBars * M15, ote:z.ote }));
}

// Dengeye değen fiyattan plan: stop bölge üstü %0,1; hedef targetR x stop mesafesi.
function plan(price, zone, cfg = DEFAULT_CONFIG) {
  const p = finite(price), st = finite(zone?.stopPrice);
  if (!(p > 0 && st > 0)) return { ok:false, reason:'ZIRVE5_PRICE_OR_ZONE_MISSING' };
  const stopPct = st / p - 1;
  if (!(stopPct >= cfg.minStopPct && stopPct <= cfg.maxStopPct)) return { ok:false, reason:'ZIRVE5_STOP_OUT_OF_BAND', stopPct:Number(stopPct.toFixed(5)) };
  return { ok:true, side:'SHORT', stopPrice:st, stopPct:Number(stopPct.toFixed(5)), tpPrice:p * (1 - cfg.targetR * stopPct), targetR:cfg.targetR };
}

// Dengeye dokunuş: SHORT için en iyi alış (bid) dengeye eşit/üstünde ve bölge üstü kırılmamış.
function touched(zone, bid) { const b = finite(bid); return b !== null && b >= zone.equilibrium && b < zone.stopPrice; }

module.exports = { ZIRVE5_VERSION, LANE, SETUP, RULE, M15, DEFAULT_CONFIG, configFile, readConfig, writeConfig, rankByRange, armedShortZones, plan, touched };
