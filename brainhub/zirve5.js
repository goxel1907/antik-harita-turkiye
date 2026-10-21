'use strict';
// R2544.68 ZİRVE-5 (FiboBuLL videosu, sesli transkriptiyle birebir; kullanıcı 21.10: "ilk 5'e yapacağız ve LONG SHORT olacak").
// Evren: her kapanan 15 dk mumda Binance USDT-M 24 sa (yüksek-düşük)/son fiyat sırası, 24 sa hacim >= 20M USDT, ilk 5.
// Videodaki kural ("trend is my friend"):
//  - TEPE kırılımı (15 dk kapanış son onaylı tepenin üstünde) -> LONG alanı = [tepeyi kırdıran dip, kırılan tepe].
//  - DİP kırılımı -> SHORT alanı = [kırılan dip, dibi kırdıran tepe] (aynası). Dip/tepe = fibo-zones.js ATR ZigZag (grafikle aynı).
//  - Giriş körlemesine değil: alanın başı/ortası/dibi olabilir; alanın içinde "hacimli, güçlü, kaslı bir boğa" (SHORT: ayı) mumu
//    kapanınca girilir. Hacimli = mumun USDT hacmi önceki 96 mumun (24 sa) ortancasının >= volMult katı; güçlü = gövde mum
//    boyunun >= bodyMin'i, yön doğru, kapanış alanı kaybetmemiş.
//  - Stop alanın altı (SHORT: üstü) %0,1; hedef kırılımdan sonraki uç (likidite), 1R'den yakınsa 1R. En çok 24 sa.
//  - Alan, kapanışla kaybedilirse ya da 48 mumda (12 sa) onay gelmezse biter. Her alana tek deneme.
// Laboratuvar (ZİRVE-5 verisi 20.09-20.10, ücret %0,12, kod: harness/zirve5/z5_video.py, mgmt3.js): canlıya uygun sayımla (aynı coinde
// açık lot varken doğan alanlar da sayılır) n 62, -0,02 R (ilk 3 hafta +0,12 R, son hafta -0,44 R); 21.10'a kadar söylenen n 55 +0,10 R
// iyimserdi (o alanları atlıyordu). İlk 15 dk içinde stop %0 (kör denge girişinde %20). Küçük örnek: karar canlı TEST sonucuyla verilir.
const fs = require('fs');
const path = require('path');
const { fiboZones } = require('./fibo-zones');

const ZIRVE5_VERSION = 'R2544.68-ZIRVE5-VIDEO';
const LANE = 'ZIRVE5';
const SETUP_LONG = 'ZIRVE5_FIBO_LONG', SETUP_SHORT = 'ZIRVE5_FIBO_SHORT';
const SETUP = 'ZIRVE5_FIBO', RULE = 'ZIRVE5_FIBO';
const setupFor = side => side === 'LONG' ? SETUP_LONG : SETUP_SHORT;
const M15 = 900000;
const DEFAULT_CONFIG = Object.freeze({ enabled:true, liveEnabled:false, jevMode:false,
  longEnabled:true, shortEnabled:true,                       // her yön kendi anahtarıyla (Office)
  k:1.5, windowBars:48, maxHoldH:24, minStopPct:0.002, maxStopPct:0.08,
  volMult:1.5, bodyMin:0.5, volLookback:96,                   // onay mumu
  topN:5, minQuote24h:20e6, marginQuote:null, leverage:null,
  maxActive:2,                                                // CANLI'da en çok açık lot; TEST'te sınır yok
  riskPct:0.02,                                               // kendi marjı yokken stopta hesabın bu payı
  // R2544.69 kâr koruma: +1R'de lotun yarısı (girişte konan reduce-only hedef), kalanın stopu başabaş + ücret (Office anahtarı)
  partialEnabled:true, partAtR:1, partShare:0.5, partBeFee:0.0012 });
const finite = v => { if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

function configFile(root) { return path.join(String(root || '.'), 'config', 'zirve5.json'); }
function readRaw(root) { try { return JSON.parse(fs.readFileSync(configFile(root), 'utf8').replace(/^﻿/, '')) || {}; } catch { return {}; } }
function readConfig(root) {
  const raw = readRaw(root), c = { ...DEFAULT_CONFIG };
  for (const k of ['enabled', 'liveEnabled', 'jevMode', 'longEnabled', 'shortEnabled', 'partialEnabled']) if (typeof raw[k] === 'boolean') c[k] = raw[k];
  const mq = finite(raw.marginQuote); if (mq !== null && mq >= 5) c.marginQuote = mq;
  const lev = finite(raw.leverage); if (lev !== null && lev >= 1 && lev <= 20) c.leverage = Math.floor(lev);
  const ma = finite(raw.maxActive); if (ma !== null && ma >= 1 && ma <= 5) c.maxActive = Math.floor(ma);
  const rp = finite(raw.riskPct); if (rp !== null && rp > 0 && rp <= 0.05) c.riskPct = rp;
  return c;
}
function writeConfig(root, patch = {}) {
  const raw = readRaw(root);
  for (const k of ['enabled', 'liveEnabled', 'jevMode', 'longEnabled', 'shortEnabled', 'partialEnabled']) if (typeof patch[k] === 'boolean') raw[k] = patch[k];
  delete raw.requireFalling24h;                               // R2544.67.5'in yanlış şartı: dosyada kalmışsa silinir
  // ZİRVE-5'in kendi marjı (null = riske göre) ve kaldıracı (null = İlk 3'ünki)
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

const median = xs => { const a = xs.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
// Onay mumu: yönde, gövde >= bodyMin x boy, hacim >= volMult x önceki volLookback mumun ortancası (en az yarısı dolu), alanın içine
// dokunmuş ve alanı kapanışla kaybetmemiş.
function confirmation(candles, m, zone, cfg = DEFAULT_CONFIG) {
  const x = candles[m], o = Number(x.open), h = Number(x.high), l = Number(x.low), c = Number(x.close), qv = Number(x.quoteVolume);
  const prev = candles.slice(Math.max(0, m - cfg.volLookback), m).map(y => Number(y.quoteVolume));
  if (prev.length < cfg.volLookback / 2) return { ok:false, reason:'VOLUME_HISTORY_SHORT' };
  const med = median(prev), rng = h - l;
  if (!(med > 0) || !(rng > 0) || !Number.isFinite(qv)) return { ok:false, reason:'DATA' };
  const long = zone.side === 'LONG';
  const dirOk = long ? c > o : c < o, body = Math.abs(c - o) / rng, vol = qv / med;
  const inZone = long ? (l <= zone.top && c >= zone.bottom) : (h >= zone.bottom && c <= zone.top);
  return { ok:dirOk && body >= cfg.bodyMin && vol >= cfg.volMult && inZone, body:Number(body.toFixed(3)), volMult:Number(vol.toFixed(2)), inZone, dirOk };
}

// Kapanmış 15 dk mumlarından (quoteVolume dahil): son mumda onay gelen alanlar (signals) ve hâlâ onay bekleyenler (waiting).
// Laboratuvarla aynı sıra: önce kapanışla kayıp (alan biter), sonra onay mumu, sonra likidite ucu güncellenir.
// Bir alanın video kuralına göre durumu: BROKEN (kapanışla kaybedildi), CONFIRMED (onay mumu; tek deneme), EXPIRED, WAITING.
function trackVideo(candles, z, cfg = DEFAULT_CONFIG) {
  const n = candles.length, long = z.side === 'LONG';
  const H = i => Number(candles[i].high), L = i => Number(candles[i].low), C = i => Number(candles[i].close);
  let ext = long ? H(z.index) : L(z.index);
  for (let m = z.index + 1; m < n && m <= z.index + cfg.windowBars; m++) {
    if (long ? C(m) < z.bottom : C(m) > z.top) return { state:'BROKEN', endIndex:m, liquidity:ext };
    const cf = confirmation(candles, m, z, cfg);
    if (cf.ok) return { state:'CONFIRMED', confirmIndex:m, liquidity:ext, confirm:{ body:cf.body, volMult:cf.volMult } };
    ext = long ? Math.max(ext, H(m)) : Math.min(ext, L(m));
  }
  return { state:z.index + cfg.windowBars < n - 1 ? 'EXPIRED' : 'WAITING', liquidity:ext };
}
// Kapanmış mumlar (forming olanlar atılır) -> fibo-zones bölgeleri + her birinin video durumu (grafik ve canlı tarama aynı kaynak).
function videoStates(allCandles, cfg = DEFAULT_CONFIG) {
  const candles = (Array.isArray(allCandles) ? allCandles : []).filter(x => x && x.forming !== true);
  const fz = fiboZones(candles, { k:cfg.k, window:cfg.windowBars });
  return { ...fz, candles, zones:fz.zones.map(z => {
    if (!(z.top > z.bottom)) return { ...z, video:{ state:'INVALID' } };
    const v = trackVideo(candles, z, cfg), long = z.side === 'LONG';
    return { ...z, video:{ ...v, confirmAt:v.confirmIndex !== undefined ? Number(candles[v.confirmIndex].closeTime) : null,
      stopPrice:long ? z.bottom * 0.999 : z.top * 1.001 } };
  }) };
}
function videoScan(candles, cfg = DEFAULT_CONFIG) {
  const n = candles.length, out = { signals:[], waiting:[] };
  if (n < 60) return out;
  const fz = fiboZones(candles, { k:cfg.k, window:cfg.windowBars });
  for (const z of fz.zones) {
    if (!(z.top > z.bottom) || z.index + cfg.windowBars < n - 1 || z.index >= n - 1) continue;   // süresi geçmiş / henüz takip yok
    const long = z.side === 'LONG', v = trackVideo(candles, z, cfg), base = { side:z.side, top:z.top, bottom:z.bottom, equilibrium:(z.top + z.bottom) / 2,
      liquidity:v.liquidity, zoneAt:Number(candles[z.index].closeTime) };
    if (v.state === 'CONFIRMED' && v.confirmIndex === n - 1)                                     // onay mumu SON kapanan mum: şimdi gir
      out.signals.push({ ...base, stopPrice:long ? z.bottom * 0.999 : z.top * 1.001, confirmAt:Number(candles[n - 1].closeTime), confirm:v.confirm, refPrice:Number(candles[n - 1].close) });
    else if (v.state === 'WAITING' || v.state === 'EXPIRED') out.waiting.push({ ...base, expiresAt:base.zoneAt + cfg.windowBars * M15 });
  }
  return out;
}

// Gerçek giriş fiyatından plan: stop alan dışı %0,1 (bant %0,2..%8), hedef likidite, 1R'den yakınsa 1R.
function target(entry, stop, liq, long) {
  const s = long ? 1 - stop / entry : stop / entry - 1, oneR = long ? entry * (1 + s) : entry * (1 - s);
  const tp = liq > 0 ? (long ? Math.max(liq, oneR) : Math.min(liq, oneR)) : oneR;
  return { tpPrice:tp, targetR:Number(((long ? tp / entry - 1 : 1 - tp / entry) / s).toFixed(3)) };
}
function plan(price, sig, cfg = DEFAULT_CONFIG) {
  const p = finite(price), st = finite(sig?.stopPrice), liq = finite(sig?.liquidity), long = sig?.side === 'LONG';
  if (!(p > 0 && st > 0)) return { ok:false, reason:'ZIRVE5_PRICE_OR_ZONE_MISSING' };
  const stopPct = long ? 1 - st / p : st / p - 1;
  if (!(stopPct >= cfg.minStopPct && stopPct <= cfg.maxStopPct)) return { ok:false, reason:'ZIRVE5_STOP_OUT_OF_BAND', stopPct:Number(stopPct.toFixed(5)) };
  return { ok:true, side:long ? 'LONG' : 'SHORT', stopPrice:st, stopPct:Number(stopPct.toFixed(5)), ...target(p, st, liq, long) };
}

module.exports = { ZIRVE5_VERSION, LANE, SETUP, RULE, SETUP_LONG, SETUP_SHORT, setupFor, M15, DEFAULT_CONFIG, configFile, readConfig, writeConfig, rankByRange, confirmation, trackVideo, videoStates, videoScan, plan, target };
