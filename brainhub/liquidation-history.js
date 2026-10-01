'use strict';
// CLAUDE_R2544_15_LIQUIDATION_HISTORY (Claude Work, 2026-09-29)
// Kullanıcı: "top 3 / top 10 / top 24 / erken ilgi / aday coinlerde geçmiş likidasyon noktaları çok önemli (LONG ve SHORT)".
// Önceki durum: likidasyon yalnız o coin analiz edilirken açılan akıştan, son 15 dk için vardı; coinin geçmişi yoktu.
// Bu modül Binance'in TÜM piyasa likidasyon akışını (!forceOrder@arr) sürekli dinler, son 24 saati saklar (yeniden
// başlatmada data/liquidation-history.json'dan geri yükler) ve sembol başına fiyat kümelerini üretir.
// Sınır: Binance bu akışta sembol başına saniyede en fazla bir likidasyonu yayınlar; bu bir ÖRNEKTİR, tam ısı haritası değildir.
const fs = require('fs');
const path = require('path');

// Birincil: mevcut forceOrder akışıyla aynı "market" uç noktası + SUBSCRIBE. Yedek: klasik doğrudan akış yolu.
const ENDPOINTS = [
  { url: 'wss://fstream.binance.com/market/ws', subscribe: true },
  { url: 'wss://fstream.binance.com/market/ws/!forceOrder@arr', subscribe: false }
];
const SILENT_SWITCH_MS = 3 * 60 * 1000;   // bağlı ama bu süre hiç olay yoksa diğer uç noktaya geç
const RETAIN_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 150000;
const PERSIST_MS = 2 * 60 * 1000;

function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function round(n,d=6){return n===null||!Number.isFinite(n)?null:Number(n.toFixed(d));}
function sig(n){return n===null||!Number.isFinite(n)?null:Number(n.toPrecision(7));}

class LiquidationHistory {
  constructor({ root = process.env.BRAINHUB_ROOT || path.resolve(__dirname, '..'), WebSocketImpl = (typeof WebSocket === 'function' ? WebSocket : null), now = () => Date.now(), persist = true } = {}) {
    this.root = root; this.WebSocketImpl = WebSocketImpl; this.now = now; this.persist = persist;
    this.file = path.join(root, 'data', 'liquidation-history.json');
    this.events = [];            // [at, symbol, sideCode(1=LONG_LIQUIDATED,-1=SHORT_LIQUIDATED), price, quote]
    this.ws = null; this.connecting = false; this.timer = null; this.retryMs = 1000; this.started = false; this.stopped = false;
    this.lastEventAt = 0; this.connectedAt = 0; this.persistTimer = null; this.loadedFromDisk = 0; this.endpointIndex = 0; this.watchTimer = null;
  }
  start() {
    if (this.started) return this;
    this.started = true;
    this.load();
    this.connect();
    if (this.persist) { this.persistTimer = setInterval(() => this.save(), PERSIST_MS); this.persistTimer.unref?.(); }
    return this;
  }
  stop() { this.stopped = true; try { this.ws?.close?.(); } catch {} if (this.persistTimer) clearInterval(this.persistTimer); this.save(); }
  load() {
    if (!this.persist) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^﻿/, ''));
      const cut = this.now() - RETAIN_MS;
      this.events = (Array.isArray(raw?.events) ? raw.events : []).filter(e => Array.isArray(e) && finite(e[0]) > cut).slice(-MAX_EVENTS);
      this.loadedFromDisk = this.events.length;
    } catch { this.events = []; }
  }
  save() {
    if (!this.persist) return;
    try {
      this.prune();
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ savedAt: this.now(), retainMs: RETAIN_MS, events: this.events }), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch {}
  }
  prune() {
    const cut = this.now() - RETAIN_MS;
    let i = 0; while (i < this.events.length && this.events[i][0] <= cut) i++;
    if (i) this.events.splice(0, i);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }
  connect() {
    if (this.stopped || !this.WebSocketImpl || this.ws || this.connecting) return;
    this.connecting = true;
    let ws;
    const ep = ENDPOINTS[this.endpointIndex % ENDPOINTS.length];
    try { ws = new this.WebSocketImpl(ep.url); } catch { this.connecting = false; this.endpointIndex++; this.reconnect(); return; }
    this.ws = ws;
    const on = (n, f) => { if (typeof ws.addEventListener === 'function') ws.addEventListener(n, f); else ws['on' + n] = f; };
    on('open', () => {
      if (this.ws !== ws) return;
      this.connecting = false; this.retryMs = 1000; this.connectedAt = this.now();
      if (ep.subscribe) { try { ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: ['!forceOrder@arr'], id: 1 })); } catch {} }
      const openedAt = this.now();
      if (this.watchTimer) clearTimeout(this.watchTimer);
      this.watchTimer = setTimeout(() => {
        // Bağlandı ama hiç likidasyon gelmediyse (uç nokta akışı desteklemiyor olabilir) diğer uç noktayı dene.
        if (this.ws === ws && this.lastEventAt < openedAt) { this.endpointIndex++; try { ws.close(); } catch {} }
      }, SILENT_SWITCH_MS);
      this.watchTimer.unref?.();
    });
    on('message', async ev => {
      try {
        let raw = ev?.data;
        if (raw && typeof raw.text === 'function') raw = await raw.text();
        else if (raw instanceof ArrayBuffer) raw = Buffer.from(raw).toString('utf8');
        else if (ArrayBuffer.isView(raw)) raw = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8');
        this.ingest(typeof raw === 'string' ? JSON.parse(raw) : raw);
      } catch {}
    });
    on('error', () => {});
    on('close', () => { if (this.ws !== ws) return; this.ws = null; if (this.connecting) this.endpointIndex++; this.connecting = false; this.reconnect(); });
  }
  reconnect() {
    if (this.stopped || !this.WebSocketImpl || this.timer) return;
    const d = Math.min(this.retryMs, 30000); this.retryMs = Math.min(d * 2, 30000);
    this.timer = setTimeout(() => { this.timer = null; this.connect(); }, d); this.timer.unref?.();
  }
  ingest(msg) {
    const data = msg?.data || msg;
    if (!data || data.e !== 'forceOrder') return false;
    const o = data.o || {};
    const symbol = String(o.s || '').toUpperCase();
    if (!/^[A-Z0-9]{1,28}USDT$/.test(symbol)) return false;
    const price = finite(o.ap) > 0 ? finite(o.ap) : finite(o.p);
    const qty = finite(o.z) > 0 ? finite(o.z) : finite(o.q);
    const S = String(o.S || '').toUpperCase();
    if (!(price > 0) || !(qty > 0) || !['BUY', 'SELL'].includes(S)) return false;
    const at = finite(o.T) ?? finite(data.E) ?? this.now();
    // SELL emri = LONG pozisyon tasfiye edildi (fiyat düşerken); BUY emri = SHORT tasfiye edildi (fiyat yükselirken).
    this.events.push([at, symbol, S === 'SELL' ? 1 : -1, price, round(price * qty, 2)]);
    this.lastEventAt = Math.max(this.lastEventAt, at);
    if (this.events.length > MAX_EVENTS + 5000) this.prune();
    return true;
  }
  // Sembolün son `sinceMs` içindeki likidasyonlarını fiyat kümelerine ayırır (binPct genişliğinde), en büyük `top` küme.
  clusters(symbol, refPrice = null, { sinceMs = RETAIN_MS, binPct = 0.35, top = 8 } = {}) {
    symbol = String(symbol || '').toUpperCase();
    const cut = this.now() - sinceMs;
    const rows = this.events.filter(e => e[1] === symbol && e[0] > cut);
    const ref = finite(refPrice) || (rows.length ? rows[rows.length - 1][3] : null);
    const out = { available: rows.length > 0, symbol, windowH: round(sinceMs / 3600000, 1), count: rows.length, longLiquidatedQuote: 0, shortLiquidatedQuote: 0,
      coverageFromMs: this.events.length ? Math.max(0, this.now() - this.events[0][0]) : 0, clusters: [], semantics: 'OBSERVED_BINANCE_ALL_MARKET_FORCE_ORDER_SAMPLE_24H' };
    if (!rows.length || !ref) return out;
    const width = ref * binPct / 100;
    // Sabit kova sınırı yakın fiyatları bölüyordu; her taraf fiyata göre sıralanıp küme genişliği binPct'i aşana kadar birleştirilir.
    const bins = [];
    for (const side of [1, -1]) {
      const list = rows.filter(e => e[2] === side).sort((x, y) => x[3] - y[3]);
      let cur = null;
      for (const [at, , , price, quote] of list) {
        if (side === 1) out.longLiquidatedQuote += quote; else out.shortLiquidatedQuote += quote;
        if (!cur || price - cur.lo > width) { cur = { side, quote: 0, pq: 0, count: 0, lastAt: 0, lo: price, hi: price }; bins.push(cur); }
        cur.quote += quote; cur.pq += price * quote; cur.count++; cur.lastAt = Math.max(cur.lastAt, at); cur.hi = Math.max(cur.hi, price);
      }
    }
    out.longLiquidatedQuote = round(out.longLiquidatedQuote, 0); out.shortLiquidatedQuote = round(out.shortLiquidatedQuote, 0);
    out.clusters = bins.sort((a, b) => b.quote - a.quote).slice(0, top).map(b => {
      const p = b.pq / b.quote;
      return { price: sig(p), side: b.side === 1 ? 'LONG_LIQUIDATED' : 'SHORT_LIQUIDATED', quote: round(b.quote, 0), count: b.count,
        lo: sig(b.lo), hi: sig(b.hi), hoursAgo: round((this.now() - b.lastAt) / 3600000, 1), distPct: round((p - ref) / ref * 100, 2) };
    });
    return out;
  }
  health() {
    return { started: this.started, connected: Boolean(this.ws && this.ws.readyState === 1), endpoint: ENDPOINTS[this.endpointIndex % ENDPOINTS.length].url, events: this.events.length, loadedFromDisk: this.loadedFromDisk,
      coverageH: this.events.length ? round((this.now() - this.events[0][0]) / 3600000, 2) : 0, lastEventAgeMs: this.lastEventAt ? this.now() - this.lastEventAt : null };
  }
}

module.exports = { LiquidationHistory, RETAIN_MS };
