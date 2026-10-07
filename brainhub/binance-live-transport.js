'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalOrder } = require('./live-authorization');
const binanceRate = require('./binance-rate-limit');

const DEFAULT_BASE_URL = 'https://fapi.binance.com';
const DEFAULT_RECV_WINDOW_MS = 5000;
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 262144;
const MAX_EXCHANGE_INFO_RESPONSE_BYTES = 4 * 1024 * 1024;

function text(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function finite(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function decimal(v) {
  const n = finite(v);
  if (n === null) return null;
  return String(n);
}

function approxMultiple(value, step) {
  const v = finite(value), s = finite(step);
  if (v === null || s === null || s <= 0) return false;
  const q = Math.round(v / s);
  const reconstructed = q * s;
  return Math.abs(reconstructed - v) <= Math.max(1e-12, Math.abs(v) * 1e-11);
}

function floorToStep(value, step) {
  const v = finite(value), s = finite(step);
  if (v === null || s === null || s <= 0) return null;
  const units = Math.floor((v / s) + 1e-10);
  const out = units * s;
  return Number(out.toPrecision(15));
}

function normalizePartialFractions(v) {
  if (!Array.isArray(v) || v.length !== 3) return [1/3,1/3,1/3];
  const a=v.map(finite);
  if (a.some(x => x === null || x <= 0)) return [1/3,1/3,1/3];
  const sum=a.reduce((x,y)=>x+y,0);
  if (!(sum > 0) || Math.abs(sum-1)>0.02) return [1/3,1/3,1/3];
  return a.map(x=>x/sum);
}

function splitTakeProfitQty(totalQty, step, partialFractions = null) {
  const total = finite(totalQty), s = finite(step);
  if (total === null || s === null || total <= 0 || s <= 0) return null;
  const f=normalizePartialFractions(partialFractions);
  const q1 = floorToStep(total * f[0], s);
  const q2 = floorToStep(total * f[1], s);
  if (q1 === null || q2 === null) return null;
  // Last bucket absorbs exchange-step rounding so the executable quantity still sums to the fill.
  const q3 = floorToStep(total - q1 - q2, s);
  if (q3 === null) return null;
  return [q1,q2,q3];
}

function filterOf(symbolInfo, type) {
  return Array.isArray(symbolInfo?.filters)
    ? symbolInfo.filters.find(x => x?.filterType === type) || null
    : null;
}

function clientId(prefix, order) {
  const h = crypto.createHash('sha256')
    .update(`${order.clientOrderId}|${order.lineageId}|${prefix}`)
    .digest('hex')
    .slice(0, 30);
  return `${prefix}${h}`;
}

function sanitizeExchangeError(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    code:finite(value.code),
    msg:text(value.msg)?.slice(0, 240) || null
  };
}

class TransportError extends Error {
  constructor(message, { endpoint = null, status = null, requestSent = false, body = null } = {}) {
    super(message);
    this.name = 'TransportError';
    this.endpoint = endpoint;
    this.status = status;
    this.requestSent = requestSent;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// R2544.51 TEST MODE (user 06.10.2026: balance withdrawn; run 24 h in TEST, LIVE/TEST switch in Office).
// In TEST mode every account/order call is answered by this in-process paper exchange in Binance's own
// response format; public market data (time, exchangeInfo, prices) stays real so fills and stop triggers
// follow the live market. A real exchange write in TEST mode is a hard error (fail-safe). The only signed
// call that still reaches Binance is the read-only leverage bracket (needed for sizing).
// ---------------------------------------------------------------------------
const PAPER_TAKER_FEE = 0.0005;
const PAPER_MAINT_RATE = 0.005;
const PAPER_REAL_SIGNED_READS = new Set(['/fapi/v1/leverageBracket']);
const PAPER_ROUTES = new Set([
  'GET /fapi/v3/account','GET /fapi/v3/positionRisk','GET /fapi/v1/positionSide/dual','GET /fapi/v1/symbolConfig',
  'GET /fapi/v1/commissionRate','GET /fapi/v1/order','GET /fapi/v1/income','GET /fapi/v1/userTrades','GET /fapi/v1/allAlgoOrders',
  'POST /fapi/v1/order','POST /fapi/v1/leverage','POST /fapi/v1/algoOrder','DELETE /fapi/v1/algoOrder'
]);
function tradingModeFile(root) { return path.join(String(root || '.'), 'config', 'trading-mode.json'); }
function readTradingMode(root, defaultMode = 'LIVE') {
  try {
    const x = JSON.parse(fs.readFileSync(tradingModeFile(root), 'utf8').replace(/^﻿/, ''));
    const mode = String(x?.mode || '').toUpperCase();
    return { ...x, mode: mode === 'LIVE' ? 'LIVE' : 'TEST', defaulted:false };
  } catch {
    return { mode: String(defaultMode).toUpperCase() === 'TEST' ? 'TEST' : 'LIVE', defaulted:true };
  }
}
function writeTradingMode(root, value) {
  const file = tradingModeFile(root);
  fs.mkdirSync(path.dirname(file), { recursive:true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
function paperError(status, code, msg, endpoint) {
  return new TransportError(`BINANCE_HTTP_${status}`, { endpoint, status, requestSent:true, body:{ code, msg } });
}
const s8 = v => String(Number(Number(v).toPrecision(12)));

class PaperExchange {
  constructor({ root, clock = () => Date.now(), priceOf, defaultMode = 'LIVE', startBalance = 100, autoTick = true } = {}) {
    if (!root) throw new Error('paper exchange root required');
    if (typeof priceOf !== 'function') throw new Error('paper exchange price source required');
    this.root = root; this.clock = clock; this.priceOf = priceOf; this.defaultMode = defaultMode;
    this.file = path.join(String(root), 'data', 'paper-exchange.json');
    this.modeCache = { at:0, value:null };
    this.lastPx = new Map();
    this.lock = Promise.resolve();
    this.state = this._load(startBalance);
    this.timer = null;
    if (autoTick) { this.timer = setInterval(() => { this.tick().catch(() => {}); }, 1000); this.timer.unref?.(); }
  }
  mode() {
    const now = this.clock();
    if (!this.modeCache.value || now - this.modeCache.at > 1000 || now < this.modeCache.at) this.modeCache = { at:now, value:readTradingMode(this.root, this.defaultMode) };
    return this.modeCache.value;
  }
  active() { return this.mode().mode === 'TEST'; }
  invalidateMode() { this.modeCache = { at:0, value:null }; }
  handles(method, p) { return PAPER_ROUTES.has(`${method} ${p}`); }
  _blank(balance) {
    const b = Number(balance) > 0 ? Number(balance) : 100;
    return { version:1, startedAt:this.clock(), startBalance:b, wallet:b, positions:{}, leverage:{}, orders:[], algos:[], trades:[], income:[], nextOrderId:9000000001, nextAlgoId:8000000001, nextTradeId:7000000001, nextTranId:6000000001 };
  }
  _load(balance) {
    try { const x = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (x && x.version === 1 && x.positions && Array.isArray(x.orders)) return x; } catch {}
    return this._blank(balance);
  }
  _save() {
    const s = this.state;
    s.orders = s.orders.slice(-3000); s.algos = s.algos.slice(-3000); s.trades = s.trades.slice(-5000); s.income = s.income.slice(-8000);
    fs.mkdirSync(path.dirname(this.file), { recursive:true });
    const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(s), 'utf8'); fs.renameSync(tmp, this.file);
  }
  reset(balance) { this.state = this._blank(balance); this._save(); return this.summary(); }
  _serial(fn) { const run = this.lock.then(fn, fn); this.lock = run.catch(() => {}); return run; }
  async _px(symbol) {
    const p = await this.priceOf(symbol);
    const bid = finite(p?.bid), ask = finite(p?.ask);
    if (!(bid > 0 && ask > 0 && ask >= bid)) throw paperError(503, -1001, 'TEST mode price unavailable for ' + symbol, '/paper/price');
    const v = { bid, ask, mid:(bid + ask) / 2, at:this.clock() }; this.lastPx.set(symbol, v); return v;
  }
  _pos(symbol) { return this.state.positions[symbol] || { amt:0, entry:0 }; }
  _lev(symbol) { return Math.max(1, Math.min(125, Math.round(finite(this.state.leverage[symbol]) || 20))); }
  _unrealized(symbol) { const p = this._pos(symbol), m = this.lastPx.get(symbol)?.mid; return p.amt && m ? (m - p.entry) * p.amt : 0; }
  _initialMargin() { return Object.entries(this.state.positions).reduce((a, [sym, p]) => a + Math.abs(p.amt) * p.entry / this._lev(sym), 0); }
  _available() { const upl = Object.keys(this.state.positions).reduce((a, s) => a + this._unrealized(s), 0); return this.state.wallet + upl - this._initialMargin(); }
  async _refreshOpen() { for (const sym of Object.keys(this.state.positions)) { try { await this._px(sym); } catch {} } }
  _income(symbol, type, amount, time, tradeId) {
    if (!amount) return;
    this.state.income.push({ symbol, incomeType:type, income:s8(amount), asset:'USDT', info:'', time, tranId:this.state.nextTranId++, tradeId:String(tradeId || '') });
  }
  async _fill({ symbol, side, qty, reduceOnly = false, clientOrderId = null, type = 'MARKET', closePosition = false, endpoint = '/fapi/v1/order' }) {
    const px = await this._px(symbol), now = this.clock();
    const price = side === 'BUY' ? px.ask : px.bid, sgn = side === 'BUY' ? 1 : -1;
    const pos = this._pos(symbol);
    let q = Math.abs(finite(qty) || 0);
    if (closePosition) q = Math.abs(pos.amt);
    if (reduceOnly || closePosition) {
      if (!pos.amt || Math.sign(pos.amt) === sgn) throw paperError(400, -2022, 'ReduceOnly Order is rejected.', endpoint);
      q = Math.min(q, Math.abs(pos.amt));
    }
    if (!(q > 0)) throw paperError(400, -4003, 'Quantity less than or equal to zero.', endpoint);
    const closing = pos.amt && Math.sign(pos.amt) !== sgn ? Math.min(q, Math.abs(pos.amt)) : 0;
    const opening = q - closing;
    const fee = q * price * PAPER_TAKER_FEE;
    if (opening > 0) {
      const need = opening * price / this._lev(symbol) + fee;
      if (need > this._available() + closing * Math.abs(pos.entry) / this._lev(symbol)) throw paperError(400, -2019, 'Margin is insufficient.', endpoint);
    }
    const realized = closing > 0 ? (price - pos.entry) * closing * Math.sign(pos.amt) : 0;
    let amt = pos.amt + sgn * q, entry = pos.entry;
    if (closing === 0) entry = pos.amt ? (pos.entry * Math.abs(pos.amt) + price * q) / (Math.abs(pos.amt) + q) : price;
    else if (opening > 0) entry = price; // flipped through zero
    amt = Number(amt.toPrecision(12));
    if (Math.abs(amt) < 1e-12) { delete this.state.positions[symbol]; } else this.state.positions[symbol] = { amt, entry, updatedAt:now };
    this.state.wallet += realized - fee;
    const orderId = this.state.nextOrderId++, tradeId = this.state.nextTradeId++;
    const order = { orderId, symbol, status:'FILLED', clientOrderId:clientOrderId || ('paper' + orderId), price:'0', avgPrice:s8(price), origQty:s8(q), executedQty:s8(q),
      cumQuote:s8(q * price), timeInForce:'GTC', type, reduceOnly:Boolean(reduceOnly || closePosition), closePosition:Boolean(closePosition), side, positionSide:'BOTH',
      stopPrice:'0', workingType:'CONTRACT_PRICE', priceProtect:false, origType:type, time:now, updateTime:now, paper:true };
    this.state.orders.push(order);
    this.state.trades.push({ symbol, id:tradeId, orderId, side, price:s8(price), qty:s8(q), realizedPnl:s8(realized), quoteQty:s8(q * price), commission:s8(fee), commissionAsset:'USDT',
      time:now, positionSide:'BOTH', buyer:side === 'BUY', maker:false });
    this._income(symbol, 'REALIZED_PNL', realized, now, tradeId);
    this._income(symbol, 'COMMISSION', -fee, now, tradeId);
    return order;
  }
  _positionRow(symbol) {
    const p = this._pos(symbol), m = this.lastPx.get(symbol)?.mid ?? p.entry, lev = this._lev(symbol), now = this.clock();
    const notional = p.amt * m, upl = (m - p.entry) * p.amt, q = Math.abs(p.amt);
    const others = this._initialMargin() - q * p.entry / lev;
    const room = Math.max(0, this.state.wallet - others - q * p.entry * PAPER_MAINT_RATE);
    const liq = q > 0 ? Math.max(0, p.amt > 0 ? p.entry - room / q : p.entry + room / q) : 0;
    return { symbol, positionSide:'BOTH', positionAmt:s8(p.amt), entryPrice:s8(p.entry), breakEvenPrice:s8(p.entry * (1 + Math.sign(p.amt) * PAPER_TAKER_FEE * 2)),
      markPrice:s8(m), unRealizedProfit:s8(upl), liquidationPrice:s8(liq), isolatedMargin:'0', notional:s8(notional), marginAsset:'USDT', isolatedWallet:'0',
      initialMargin:s8(q * m / lev), maintMargin:s8(q * m * PAPER_MAINT_RATE), positionInitialMargin:s8(q * m / lev), openOrderInitialMargin:'0', adl:0,
      bidNotional:'0', askNotional:'0', updateTime:p.updatedAt || now };
  }
  _account() {
    const syms = Object.keys(this.state.positions), upl = syms.reduce((a, s) => a + this._unrealized(s), 0), im = this._initialMargin();
    return { totalInitialMargin:s8(im), totalMaintMargin:s8(syms.reduce((a, s) => a + Math.abs(this._pos(s).amt) * (this.lastPx.get(s)?.mid ?? this._pos(s).entry) * PAPER_MAINT_RATE, 0)),
      totalWalletBalance:s8(this.state.wallet), totalUnrealizedProfit:s8(upl), totalMarginBalance:s8(this.state.wallet + upl), totalPositionInitialMargin:s8(im),
      totalOpenOrderInitialMargin:'0', totalCrossWalletBalance:s8(this.state.wallet), totalCrossUnPnl:s8(upl), availableBalance:s8(this._available()), maxWithdrawAmount:s8(Math.max(0, this._available())),
      assets:[{ asset:'USDT', walletBalance:s8(this.state.wallet), unrealizedProfit:s8(upl), marginBalance:s8(this.state.wallet + upl), availableBalance:s8(this._available()) }],
      positions:syms.map(s => { const r = this._positionRow(s); return { symbol:s, positionSide:'BOTH', positionAmt:r.positionAmt, unrealizedProfit:r.unRealizedProfit, isolatedMargin:'0', notional:r.notional,
        isolatedWallet:'0', initialMargin:r.initialMargin, maintMargin:r.maintMargin, updateTime:r.updateTime }; }), paper:true };
  }
  _wouldTrigger(algo, mid) {
    const t = finite(algo.triggerPrice); if (!(t > 0) || !(mid > 0)) return false;
    if (algo.orderType === 'STOP_MARKET') return algo.side === 'SELL' ? mid <= t : mid >= t;
    if (algo.orderType === 'TAKE_PROFIT_MARKET') return algo.side === 'SELL' ? mid >= t : mid <= t;
    return false;
  }
  async tick() {
    if (!this.active()) return { ok:true, skipped:true };
    const open = this.state.algos.filter(a => a.algoStatus === 'NEW');
    if (!open.length) return { ok:true, triggered:0 };
    return this._serial(async () => {
      let n = 0, changed = false;
      for (const a of this.state.algos.filter(x => x.algoStatus === 'NEW')) {
        let px; try { px = await this._px(a.symbol); } catch { continue; }
        if (!this._wouldTrigger(a, px.mid)) continue;
        const now = this.clock(); a.triggeredAt = now; a.updateTime = now; changed = true;
        try {
          const o = await this._fill({ symbol:a.symbol, side:a.side, qty:a.quantity, reduceOnly:true, closePosition:a.closePosition === true, clientOrderId:a.clientAlgoId, type:a.orderType, endpoint:'/paper/trigger' });
          a.algoStatus = 'FINISHED'; a.actualOrderId = String(o.orderId); a.actualPrice = o.avgPrice; n++;
        } catch { a.algoStatus = 'EXPIRED'; }
      }
      if (changed) this._save();
      return { ok:true, triggered:n };
    });
  }
  summary() {
    const s = this.state, upl = Object.keys(s.positions).reduce((a, x) => a + this._unrealized(x), 0);
    const realized = s.income.filter(x => x.incomeType === 'REALIZED_PNL').reduce((a, x) => a + Number(x.income), 0);
    const fees = s.income.filter(x => x.incomeType === 'COMMISSION').reduce((a, x) => a + Number(x.income), 0);
    // R2544.52 (07.10 user: "PnL differs top and bottom"): one snapshot for every TEST number. net = closed parts only
    // (wallet - start); total = equity - start (open positions included); positions carry their live mark and PnL.
    const positions = Object.entries(s.positions).map(([symbol, p]) => {
      const px = this.lastPx.get(symbol);
      return { symbol, side:p.amt > 0 ? 'LONG' : 'SHORT', quantity:Math.abs(p.amt), entryPrice:p.entry, markPrice:px?.mid ?? null,
        unrealizedPnl:Number(this._unrealized(symbol).toFixed(4)), priceAt:px?.at ? new Date(px.at).toISOString() : null };
    });
    return { startedAt:s.startedAt, startBalance:s.startBalance, wallet:Number(s.wallet.toFixed(4)), equity:Number((s.wallet + upl).toFixed(4)), unrealized:Number(upl.toFixed(4)),
      realized:Number(realized.toFixed(4)), fees:Number(fees.toFixed(4)), net:Number((s.wallet - s.startBalance).toFixed(4)), total:Number((s.wallet + upl - s.startBalance).toFixed(4)),
      available:Number(this._available().toFixed(4)), openPositions:Object.keys(s.positions).length, positions,
      openAlgos:s.algos.filter(a => a.algoStatus === 'NEW').length, fills:s.trades.length };
  }
  hasExposure() { return Object.keys(this.state.positions).length > 0; }
  // R2544.52: before a switch to LIVE (or a TEST reset) every paper lot is closed at market and every open paper
  // stop/TP is cancelled; fills, fees and realised PnL are booked like any other paper close.
  async closeAll(tag = 'TESTCLOSE') {
    return this._serial(async () => {
      const now = this.clock(); let closed = 0, cancelled = 0;
      for (const a of this.state.algos) if (a.algoStatus === 'NEW') { a.algoStatus = 'CANCELED'; a.updateTime = now; cancelled++; }
      for (const [symbol, p] of Object.entries(this.state.positions)) {
        try { await this._fill({ symbol, side:p.amt > 0 ? 'SELL' : 'BUY', qty:Math.abs(p.amt), reduceOnly:true, clientOrderId:`${tag}${now}${closed}`, endpoint:'/paper/closeAll' }); closed++; } catch {}
      }
      this._save();
      return { closed, cancelled, open:Object.keys(this.state.positions).length };
    });
  }
  async handle(method, p, { params = {} } = {}) {
    const key = `${method} ${p}`, P = params || {}, sym = P.symbol ? String(P.symbol).toUpperCase() : null;
    return this._serial(async () => {
      if (key === 'GET /fapi/v1/positionSide/dual') return { dualSidePosition:false };
      if (key === 'GET /fapi/v1/commissionRate') return { symbol:sym, makerCommissionRate:'0.0002', takerCommissionRate:'0.0005' };
      if (key === 'GET /fapi/v1/symbolConfig') { const list = (sym ? [sym] : Object.keys(this.state.leverage)).map(s => ({ symbol:s, marginType:'CROSSED', isAutoAddMargin:'false', leverage:this._lev(s), maxNotionalValue:'1000000' })); return list; }
      if (key === 'POST /fapi/v1/leverage') { const lev = Math.max(1, Math.min(125, Math.round(finite(P.leverage) || 1))); this.state.leverage[sym] = lev; this._save(); return { symbol:sym, leverage:lev, maxNotionalValue:'1000000' }; }
      if (key === 'GET /fapi/v3/account') { await this._refreshOpen(); return this._account(); }
      if (key === 'GET /fapi/v3/positionRisk') { await this._refreshOpen(); return Object.keys(this.state.positions).filter(s => !sym || s === sym).map(s => this._positionRow(s)); }
      if (key === 'POST /fapi/v1/order') {
        if (String(P.type || 'MARKET').toUpperCase() !== 'MARKET') throw paperError(400, -1116, 'TEST mode supports MARKET orders only.', p);
        const side = String(P.side || '').toUpperCase(); if (!['BUY','SELL'].includes(side)) throw paperError(400, -1117, 'Invalid side.', p);
        if (P.newClientOrderId && this.state.orders.some(o => o.symbol === sym && o.clientOrderId === P.newClientOrderId)) throw paperError(400, -4116, 'ClientOrderId is duplicated.', p);
        const o = await this._fill({ symbol:sym, side, qty:P.quantity, reduceOnly:String(P.reduceOnly) === 'true', closePosition:String(P.closePosition) === 'true', clientOrderId:P.newClientOrderId || null, endpoint:p });
        this._save(); return o;
      }
      if (key === 'GET /fapi/v1/order') {
        const o = this.state.orders.slice().reverse().find(x => x.symbol === sym && (P.orderId !== undefined ? String(x.orderId) === String(P.orderId) : x.clientOrderId === P.origClientOrderId));
        if (!o) throw paperError(400, -2013, 'Order does not exist.', p); return o;
      }
      if (key === 'POST /fapi/v1/algoOrder') {
        const type = String(P.type || '').toUpperCase(), side = String(P.side || '').toUpperCase(), trig = finite(P.triggerPrice), closePosition = String(P.closePosition) === 'true';
        if (!['STOP_MARKET','TAKE_PROFIT_MARKET'].includes(type) || !['BUY','SELL'].includes(side) || !(trig > 0) || (!closePosition && !(finite(P.quantity) > 0))) throw paperError(400, -1102, 'Mandatory parameter missing or malformed.', p);
        const px = await this._px(sym), now = this.clock();
        const algo = { algoId:this.state.nextAlgoId++, clientAlgoId:P.clientAlgoId || ('paperalgo' + now), algoType:'CONDITIONAL', orderType:type, symbol:sym, side, positionSide:'BOTH',
          timeInForce:'GTC', quantity:closePosition ? '0' : s8(P.quantity), algoStatus:'NEW', triggerPrice:s8(trig), price:'0', workingType:P.workingType || 'MARK_PRICE',
          priceProtect:String(P.priceProtect) === 'true', reduceOnly:String(P.reduceOnly) === 'true' || closePosition, closePosition, createTime:now, updateTime:now, paper:true };
        if (this._wouldTrigger(algo, px.mid)) throw paperError(400, -2021, 'Order would immediately trigger.', p);
        this.state.algos.push(algo); this._save(); return algo;
      }
      if (key === 'DELETE /fapi/v1/algoOrder') {
        const a = this.state.algos.find(x => x.algoStatus === 'NEW' && (P.algoId !== undefined ? String(x.algoId) === String(P.algoId) : x.clientAlgoId === P.clientAlgoId));
        if (!a) throw paperError(400, -2011, 'Unknown order sent.', p);
        a.algoStatus = 'CANCELED'; a.updateTime = this.clock(); this._save(); return { algoId:a.algoId, clientAlgoId:a.clientAlgoId, code:'200', msg:'success' };
      }
      const t0 = finite(P.startTime) ?? 0, t1 = finite(P.endTime) ?? Infinity, lim = Math.max(1, Math.min(1000, finite(P.limit) || 100));
      if (key === 'GET /fapi/v1/income') return this.state.income.filter(x => (!sym || x.symbol === sym) && (!P.incomeType || x.incomeType === P.incomeType) && x.time >= t0 && x.time <= t1).slice(0, lim);
      if (key === 'GET /fapi/v1/userTrades') return this.state.trades.filter(x => x.symbol === sym && x.time >= t0 && x.time <= t1 && (P.orderId === undefined || String(x.orderId) === String(P.orderId))).slice(-lim);
      if (key === 'GET /fapi/v1/allAlgoOrders') return this.state.algos.filter(x => x.symbol === sym && x.createTime >= t0 && x.createTime <= t1).slice(-lim);
      throw paperError(400, -1000, 'TEST mode endpoint not simulated: ' + key, p);
    });
  }
}

class BinanceLiveTransport {
  constructor({
    registry,
    fetchImpl = globalThis.fetch,
    baseUrl = DEFAULT_BASE_URL,
    recvWindowMs = DEFAULT_RECV_WINDOW_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    clock = () => Date.now()
  } = {}) {
    if (!registry || typeof registry.consume !== 'function') throw new Error('LIVE authorization registry required');
    if (typeof fetchImpl !== 'function') throw new Error('fetch implementation required');
    this.registry = registry;
    this.fetchImpl = fetchImpl;
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.recvWindowMs = Math.max(1000, Math.min(10000, Math.round(Number(recvWindowMs) || DEFAULT_RECV_WINDOW_MS)));
    this.timeoutMs = Math.max(1000, Math.min(30000, Math.round(Number(timeoutMs) || DEFAULT_TIMEOUT_MS)));
    this.clock = clock;
    this.serverOffsetMs = 0;
    this.exchangeInfoCache = { at:0, value:null };
  }

  // R2544.51: TEST mode routing. Simulated routes go to the paper exchange; any other write, and any signed read
  // except the leverage bracket, is refused before a request is built (no real order can leave in TEST mode).
  attachPaper(paper) { this.paper = paper || null; return this; }
  testModeActive() { return Boolean(this.paper && this.paper.active()); }
  async _fetchJson(method, endpoint, opts = {}) {
    if (this.paper && this.paper.active()) {
      if (this.paper.handles(method, endpoint)) return this.paper.handle(method, endpoint, opts);
      if (method !== 'GET' || (opts?.signed && !PAPER_REAL_SIGNED_READS.has(endpoint))) {
        throw new TransportError('TEST_MODE_REAL_EXCHANGE_BLOCKED', { endpoint, requestSent:false, body:{ code:-9999, msg:'TEST mode: real exchange call refused' } });
      }
    }
    return this._fetchJsonReal(method, endpoint, opts);
  }

  async _fetchJsonReal(method, path, { params = {}, credentials = null, signed = false, rateLimitKind = null } = {}) {
    const apiKey = text(credentials?.apiKey);
    const apiSecret = text(credentials?.apiSecret);
    if (signed && (!apiKey || !apiSecret)) throw new TransportError('BINANCE_CREDENTIALS_REQUIRED', { endpoint:path, requestSent:false });

    const payload = new URLSearchParams();
    for (const [k,v] of Object.entries(params || {})) {
      if (v !== null && v !== undefined && v !== '') payload.append(k, String(v));
    }
    if (signed) {
      payload.append('recvWindow', String(this.recvWindowMs));
      payload.append('timestamp', String(Math.round(this.clock() + this.serverOffsetMs)));
      const sig = crypto.createHmac('sha256', apiSecret).update(payload.toString()).digest('hex');
      payload.append('signature', sig);
    }

    const isGet = method === 'GET';
    const isExchangeInfo = isGet && path === '/fapi/v1/exchangeInfo' && !signed;
    const now = this.clock();
    if (isExchangeInfo && this.exchangeInfoCache.value && Number.isFinite(now) &&
        now - this.exchangeInfoCache.at >= 0 && now - this.exchangeInfoCache.at <= 60000) {
      return this.exchangeInfoCache.value;
    }

    const query = payload.toString();
    const url = `${this.baseUrl}${path}${isGet && query ? `?${query}` : ''}`;
    const maxAttempts = isExchangeInfo ? 3 : 1;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response, permit = null;
      try {
        const kind=rateLimitKind || (signed ? (method==='GET'?'LIVE_READ':'LIVE_WRITE') : 'PUBLIC');
        try{permit=await binanceRate.acquire({path:path+(query?`?${query}`:''),kind,maxWaitMs:Math.min(5000,Math.max(1000,this.timeoutMs-250))});}
        catch(e){throw new TransportError(e?.code||'BINANCE_RATE_LIMIT_GUARD',{endpoint:path,requestSent:false,body:{cooldownUntil:e?.cooldownUntil||null,reason:e?.reason||null}});}
        response = await this.fetchImpl(url, {
          method,
          signal:controller.signal,
          headers:{
            Accept:'application/json',
            ...(signed ? { 'X-MBX-APIKEY':apiKey } : {}),
            ...(!isGet ? { 'Content-Type':'application/x-www-form-urlencoded' } : {})
          },
          body:isGet ? undefined : query
        });

        let raw = '';
        try {
          raw = await response.text();
        } catch {
          throw new TransportError('BINANCE_RESPONSE_READ_ERROR', { endpoint:path, status:response.status, requestSent:true });
        }
        const responseLimit = isExchangeInfo ? MAX_EXCHANGE_INFO_RESPONSE_BYTES : MAX_RESPONSE_BYTES;
        if (raw.length > responseLimit) {
          throw new TransportError('BINANCE_RESPONSE_TOO_LARGE', { endpoint:path, status:response.status, requestSent:true });
        }
        let body = null;
        if (raw) {
          try { body = JSON.parse(raw); }
          catch { body = { msg:raw.slice(0,240) }; }
        }
        binanceRate.observeResponse({status:response.status,headers:response.headers,body,path,kind});
        if (!response.ok) {
          throw new TransportError(`BINANCE_HTTP_${response.status}`, {
            endpoint:path,
            status:response.status,
            requestSent:true,
            body:sanitizeExchangeError(body)
          });
        }

        if (isExchangeInfo) {
          if (!Array.isArray(body?.symbols) || body.symbols.length < 1) {
            throw new TransportError('BINANCE_EXCHANGE_INFO_INVALID', { endpoint:path, status:response.status, requestSent:true });
          }
          this.exchangeInfoCache = { at:this.clock(), value:body };
        }
        return body;
      } catch (e) {
        lastError = e instanceof TransportError
          ? e
          : new TransportError(e?.name === 'AbortError' ? 'BINANCE_REQUEST_TIMEOUT' : 'BINANCE_NETWORK_ERROR', {
              endpoint:path,
              requestSent:true
            });
      } finally {
        clearTimeout(timer);
        permit?.release?.();
      }

      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 150 * attempt));
      }
    }

    if (isExchangeInfo && this.exchangeInfoCache.value) {
      const age = this.clock() - this.exchangeInfoCache.at;
      if (Number.isFinite(age) && age >= 0 && age <= 10 * 60 * 1000) {
        return this.exchangeInfoCache.value;
      }
    }
    throw lastError || new TransportError('BINANCE_NETWORK_ERROR', { endpoint:path, requestSent:true });
  }



  async recoveryProbe() {
    const body = await this._fetchJson('GET', '/fapi/v1/time', { rateLimitKind:'RECOVERY_PROBE' });
    const serverTime = finite(body?.serverTime);
    if (serverTime === null) throw new TransportError('BINANCE_RECOVERY_PROBE_INVALID', { endpoint:'/fapi/v1/time', requestSent:true });
    this.serverOffsetMs = serverTime - this.clock();
    return { ok:true, serverTime };
  }

  async _syncServerTime() {
    const t = await this._fetchJson('GET', '/fapi/v1/time');
    const serverTime = finite(t?.serverTime);
    if (serverTime === null) throw new TransportError('BINANCE_SERVER_TIME_INVALID', { endpoint:'/fapi/v1/time', requestSent:true });
    this.serverOffsetMs = serverTime - this.clock();
  }

  _validateRules(order, symbolInfo, livePrice, livePolicy) {
    const reasons = [];
    if (!symbolInfo) reasons.push('SYMBOL_NOT_FOUND_ON_EXCHANGE');
    if (symbolInfo && symbolInfo.status !== 'TRADING') reasons.push('SYMBOL_NOT_TRADING');
    if (symbolInfo && symbolInfo.contractType !== 'PERPETUAL') reasons.push('PERPETUAL_CONTRACT_REQUIRED');
    if (symbolInfo && symbolInfo.quoteAsset !== 'USDT') reasons.push('USDT_QUOTE_REQUIRED');

    const lot = filterOf(symbolInfo, 'MARKET_LOT_SIZE') || filterOf(symbolInfo, 'LOT_SIZE');
    const qty = finite(order.quantity);
    const minQty = finite(lot?.minQty), maxQty = finite(lot?.maxQty), step = finite(lot?.stepSize);
    if (!lot || qty === null || minQty === null || maxQty === null || step === null) reasons.push('MARKET_LOT_FILTER_REQUIRED');
    else {
      if (qty < minQty || qty > maxQty) reasons.push('QUANTITY_OUTSIDE_EXCHANGE_FILTER');
      if (!approxMultiple(qty, step)) reasons.push('QUANTITY_STEP_MISMATCH');
    }

    const priceFilter = filterOf(symbolInfo, 'PRICE_FILTER');
    const stop = finite(order.stopPrice);
    const tick = finite(priceFilter?.tickSize), minPrice = finite(priceFilter?.minPrice), maxPrice = finite(priceFilter?.maxPrice);
    if (!priceFilter || stop === null || tick === null || minPrice === null || maxPrice === null) reasons.push('PRICE_FILTER_REQUIRED');
    else {
      if (stop < minPrice || stop > maxPrice) reasons.push('STOP_OUTSIDE_EXCHANGE_FILTER');
      if (!approxMultiple(stop, tick)) reasons.push('STOP_TICK_MISMATCH');
      const tps = [finite(order.takeProfit1), finite(order.takeProfit2), finite(order.takeProfit3)];
      if (tps.some(x => x === null || x <= 0)) reasons.push('TAKE_PROFIT_LEVELS_REQUIRED');
      else {
        for (const [i,tp] of tps.entries()) {
          if (tp < minPrice || tp > maxPrice) reasons.push(`TP${i+1}_OUTSIDE_EXCHANGE_FILTER`);
          if (!approxMultiple(tp, tick)) reasons.push(`TP${i+1}_TICK_MISMATCH`);
        }
      }
    }

    const minNotionalFilter = filterOf(symbolInfo, 'MIN_NOTIONAL');
    const minNotional = finite(minNotionalFilter?.notional ?? minNotionalFilter?.minNotional);
    if (minNotional !== null && qty !== null && livePrice !== null && qty * livePrice < minNotional) reasons.push('MIN_NOTIONAL_NOT_MET');

    const entry = finite(order.entryPrice);
    const entryReference = finite(order.entryReferencePrice) ?? entry;
    const maxDeviationPct = Math.max(0.01, Math.min(5, finite(livePolicy?.maxEntryDeviationPct) ?? 0.5));
    if (entry === null || entryReference === null || livePrice === null) reasons.push('LIVE_PRICE_CHECK_REQUIRED');
    else {
      const deviationPct = Math.abs(livePrice - entryReference) / entryReference * 100;
      if (deviationPct > maxDeviationPct) reasons.push('LIVE_PRICE_DEVIATION_TOO_HIGH');
      if (order.side === 'LONG' && !(stop < livePrice)) reasons.push('LONG_STOP_NOT_BELOW_LIVE_PRICE');
      if (order.side === 'SHORT' && !(stop > livePrice)) reasons.push('SHORT_STOP_NOT_ABOVE_LIVE_PRICE');
      const tp1 = finite(order.takeProfit1), tp2 = finite(order.takeProfit2), tp3 = finite(order.takeProfit3);
      if (order.side === 'LONG' && !(livePrice < tp1 && tp1 < tp2 && tp2 < tp3)) reasons.push('LONG_TAKE_PROFIT_NOT_ABOVE_LIVE_PRICE');
      if (order.side === 'SHORT' && !(livePrice > tp1 && tp1 > tp2 && tp2 > tp3)) reasons.push('SHORT_TAKE_PROFIT_NOT_BELOW_LIVE_PRICE');
    }

    if (lot && qty !== null && step !== null) {
      const split = splitTakeProfitQty(qty, step, order.partialFractions);
      if (!split || split.some(x => x < minQty || x <= 0)) reasons.push('TAKE_PROFIT_SPLIT_BELOW_MIN_QTY');
      if (minNotional !== null && split) {
        const tps = [finite(order.takeProfit1), finite(order.takeProfit2), finite(order.takeProfit3)];
        if (split.some((x,i) => tps[i] !== null && x * tps[i] < minNotional)) reasons.push('TAKE_PROFIT_SPLIT_BELOW_MIN_NOTIONAL');
      }
    }

    return [...new Set(reasons)];
  }

  async submit({ grantId, order, credentials, livePolicy = {} } = {}) {
    const normalized = canonicalOrder(order);
    const authorization = this.registry.consume({ grantId, order:normalized, now:this.clock() });
    if (!authorization?.ok || authorization?.liveAllowed !== true) {
      return {
        ok:false,
        orderPlaced:false,
        stopProtected:false,
        liveAllowed:false,
        execution:'LIVE_BLOCKED',
        transport:{ attempted:false, requestSent:false },
        reasons:authorization?.reasons || ['LIVE_GRANT_REQUIRED']
      };
    }

    const reasons = [];
    const apiKey = text(credentials?.apiKey), apiSecret = text(credentials?.apiSecret);
    if (!apiKey || apiKey.length < 8) reasons.push('BINANCE_API_KEY_REQUIRED');
    if (!apiSecret || apiSecret.length < 8) reasons.push('BINANCE_API_SECRET_REQUIRED');
    if (normalized.action !== 'OPEN') reasons.push('LIVE_OPEN_ACTION_REQUIRED');
    if (normalized.orderType !== 'MARKET') reasons.push('LIVE_MARKET_ONLY_INITIAL_RELEASE');
    if (!normalized.clientOrderId || normalized.clientOrderId.length > 36) reasons.push('LIVE_CLIENT_ORDER_ID_INVALID');
    const expectedLeverage = Number(livePolicy?.expectedLeverage);
    if (!Number.isInteger(expectedLeverage) || expectedLeverage < 1 || expectedLeverage > 125) reasons.push('EXPECTED_LEVERAGE_REQUIRED');
    if (reasons.length) {
      return {
        ok:false,
        orderPlaced:false,
        stopProtected:false,
        liveAllowed:false,
        execution:'LIVE_BLOCKED',
        authorization,
        transport:{ attempted:false, requestSent:false },
        reasons:[...new Set(reasons)]
      };
    }

    let preflightRequestSent = false;
    try {
      await this._syncServerTime();
      preflightRequestSent = true;
      const exchangeInfo = await this._fetchJson('GET', '/fapi/v1/exchangeInfo');
      const symbolInfo = Array.isArray(exchangeInfo?.symbols)
        ? exchangeInfo.symbols.find(x => x?.symbol === normalized.symbol)
        : null;
      const ticker = await this._fetchJson('GET', '/fapi/v1/ticker/price', { params:{ symbol:normalized.symbol } });
      const livePrice = finite(ticker?.price);
      const ruleReasons = this._validateRules(normalized, symbolInfo, livePrice, livePolicy);
      if (ruleReasons.length) {
        return {
          ok:false,
          orderPlaced:false,
          stopProtected:false,
          liveAllowed:false,
          execution:'LIVE_BLOCKED',
          authorization,
          livePrice,
          transport:{ attempted:true, requestSent:true },
          reasons:ruleReasons
        };
      }

      const mode = await this._fetchJson('GET', '/fapi/v1/positionSide/dual', { credentials, signed:true });
      const hedgeMode = mode?.dualSidePosition === true;
      const positionSide = hedgeMode ? normalized.side : 'BOTH';
      // CLAUDE_V112_BINANCE_V3_POSITION_FIX: /fapi/v3/positionRisk yalnız pozisyonu veya açık emri olan
      // sembolleri döndürür ve kaldıraç alanı içermez (Binance belgesi). Eski kod boş cevabı
      // POSITION_RISK_REQUIRED sayıp HER yeni coinde girişi engelliyordu (21 Eyl 22:12Z ONEUSDT).
      // Boş liste = bu sembolde pozisyon yok. Kaldıraç GET /fapi/v1/symbolConfig ile okunur.
      let positionRisk = await this._fetchJson('GET', '/fapi/v3/positionRisk', {
        params:{ symbol:normalized.symbol }, credentials, signed:true
      });
      if (!Array.isArray(positionRisk)) {
        return {
          ok:false, orderPlaced:false, stopProtected:false, liveAllowed:false, execution:'LIVE_BLOCKED', authorization,
          transport:{ attempted:true, requestSent:true }, reasons:['POSITION_RISK_REQUIRED']
        };
      }
      let rows = positionRisk.filter(x => !x?.symbol || String(x.symbol).toUpperCase() === normalized.symbol);
      if (rows.some(x => Math.abs(finite(x?.positionAmt) || 0) > 0)) {
        return {
          ok:false, orderPlaced:false, stopProtected:false, liveAllowed:false, execution:'LIVE_BLOCKED', authorization,
          transport:{ attempted:true, requestSent:true }, reasons:['SYMBOL_POSITION_ALREADY_OPEN']
        };
      }

      const readSymbolLeverage = async () => {
        try {
          const cfg = await this._fetchJson('GET', '/fapi/v1/symbolConfig', { params:{ symbol:normalized.symbol }, credentials, signed:true });
          const list = Array.isArray(cfg) ? cfg : (cfg && typeof cfg === 'object' ? [cfg] : []);
          const row = list.find(x => String(x?.symbol || '').toUpperCase() === normalized.symbol) || (list.length === 1 ? list[0] : null);
          return finite(row?.leverage);
        } catch {
          return null;
        }
      };
      const rowLeverages = () => [...new Set(rows.map(x => finite(x?.leverage)).filter(x => x !== null))];
      let leverageSource = 'POSITION_RISK';
      let leverages = rowLeverages();
      if (!leverages.length) {
        const lev = await readSymbolLeverage();
        leverageSource = 'SYMBOL_CONFIG';
        leverages = lev === null ? [] : [lev];
      }
      let leverageChanged = false;
      if (!leverages.length || leverages.some(x => x !== expectedLeverage)) {
        const leverageAck = await this._fetchJson('POST', '/fapi/v1/leverage', {
          credentials,
          signed:true,
          params:{ symbol:normalized.symbol, leverage:String(expectedLeverage) }
        });
        const acknowledgedLeverage = finite(leverageAck?.leverage);
        if (acknowledgedLeverage !== null && acknowledgedLeverage !== expectedLeverage) {
          return {
            ok:false, orderPlaced:false, stopProtected:false, liveAllowed:false, execution:'LIVE_BLOCKED', authorization,
            observedLeverages:leverages,
            acknowledgedLeverage,
            transport:{ attempted:true, requestSent:true }, reasons:['BINANCE_LEVERAGE_CHANGE_REJECTED']
          };
        }
        leverageChanged = true;
        if (leverageSource === 'POSITION_RISK') {
          positionRisk = await this._fetchJson('GET', '/fapi/v3/positionRisk', {
            params:{ symbol:normalized.symbol }, credentials, signed:true
          });
          rows = Array.isArray(positionRisk) ? positionRisk.filter(x => !x?.symbol || String(x.symbol).toUpperCase() === normalized.symbol) : [];
          leverages = rowLeverages();
        } else {
          const lev = await readSymbolLeverage();
          leverages = lev !== null ? [lev] : (acknowledgedLeverage !== null ? [acknowledgedLeverage] : []);
        }
      }
      if (!leverages.length || leverages.some(x => x !== expectedLeverage)) {
        return {
          ok:false, orderPlaced:false, stopProtected:false, liveAllowed:false, execution:'LIVE_BLOCKED', authorization,
          observedLeverages:leverages,
          leverageChanged,
          leverageSource,
          transport:{ attempted:true, requestSent:true }, reasons:['BINANCE_LEVERAGE_MISMATCH']
        };
      }

      const entrySide = normalized.side === 'LONG' ? 'BUY' : 'SELL';
      let entry;
      try {
        entry = await this._fetchJson('POST', '/fapi/v1/order', {
          credentials,
          signed:true,
          params:{
            symbol:normalized.symbol,
            side:entrySide,
            positionSide,
            type:'MARKET',
            quantity:decimal(normalized.quantity),
            newClientOrderId:normalized.clientOrderId,
            newOrderRespType:'RESULT'
          }
        });
      } catch (e) {
        return {
          ok:false,
          orderPlaced:null,
          orderState:'UNKNOWN_OR_REJECTED',
          stopProtected:false,
          liveAllowed:false,
          execution:'LIVE_ENTRY_REVIEW_REQUIRED',
          authorization,
          manualReviewRequired:Boolean(e?.requestSent),
          exchangeError:e?.body || null,
          transport:{ attempted:true, requestSent:Boolean(e?.requestSent) },
          reasons:[String(e?.message || 'BINANCE_ENTRY_FAILED')]
        };
      }

      const executedQty = finite(entry?.executedQty);
      const entryOrderId = entry?.orderId ?? null;
      if (executedQty === null || executedQty <= 0 || entryOrderId === null) {
        return {
          ok:false,
          orderPlaced:true,
          orderState:'ACCEPTED_BUT_FILL_STATE_UNCLEAR',
          stopProtected:false,
          liveAllowed:false,
          execution:'LIVE_ENTRY_REVIEW_REQUIRED',
          authorization,
          entryOrderId,
          entryStatus:text(entry?.status),
          manualReviewRequired:true,
          transport:{ attempted:true, requestSent:true },
          reasons:['ENTRY_FILL_STATE_UNCLEAR']
        };
      }

      const stopSide = normalized.side === 'LONG' ? 'SELL' : 'BUY';
      let stop;
      let stopAlgoId = null;
      try {
        stop = await this._fetchJson('POST', '/fapi/v1/algoOrder', {
          credentials,
          signed:true,
          params:{
            algoType:'CONDITIONAL',
            symbol:normalized.symbol,
            side:stopSide,
            positionSide,
            type:'STOP_MARKET',
            triggerPrice:decimal(normalized.stopPrice),
            workingType:'MARK_PRICE',
            closePosition:'true',
            priceProtect:'true',
            clientAlgoId:clientId('S', normalized),
            newOrderRespType:'ACK'
          }
        });
        stopAlgoId = stop?.algoId ?? null;
        if (stopAlgoId === null) throw new TransportError('BINANCE_STOP_ACK_INVALID', { endpoint:'/fapi/v1/algoOrder', requestSent:true });
      } catch (stopError) {
        let emergencyCloseSucceeded = false;
        let emergencyCloseOrderId = null;
        let emergencyError = null;
        try {
          const emergencyParams = {
            symbol:normalized.symbol,
            side:stopSide,
            positionSide,
            type:'MARKET',
            quantity:decimal(executedQty),
            newClientOrderId:clientId('E', normalized),
            newOrderRespType:'RESULT'
          };
          if (!hedgeMode) emergencyParams.reduceOnly = 'true';
          const emergency = await this._fetchJson('POST', '/fapi/v1/order', {
            credentials, signed:true, params:emergencyParams
          });
          emergencyCloseOrderId = emergency?.orderId ?? null;
          emergencyCloseSucceeded = emergencyCloseOrderId !== null && (finite(emergency?.executedQty) || 0) > 0;
        } catch (e) {
          emergencyError = e?.body || { msg:String(e?.message || 'EMERGENCY_CLOSE_FAILED').slice(0,240) };
        }
        return {
          ok:false,
          orderPlaced:true,
          stopProtected:false,
          tpProtected:false,
          liveAllowed:false,
          execution:emergencyCloseSucceeded ? 'LIVE_STOP_FAILED_EMERGENCY_CLOSED' : 'LIVE_STOP_FAILED_MANUAL_INTERVENTION_REQUIRED',
          authorization,
          symbol:normalized.symbol,
          side:normalized.side,
          entryOrderId,
          entryStatus:text(entry?.status),
          executedQty,
          stopError:stopError?.body || { msg:String(stopError?.message || 'STOP_INSTALL_FAILED').slice(0,240) },
          emergencyCloseAttempted:true,
          emergencyCloseSucceeded,
          emergencyCloseOrderId,
          emergencyError,
          manualReviewRequired:!emergencyCloseSucceeded,
          transport:{ attempted:true, requestSent:true },
          reasons:[emergencyCloseSucceeded ? 'PROTECTIVE_STOP_FAILED_POSITION_CLOSED' : 'PROTECTIVE_STOP_FAILED_POSITION_MAY_BE_OPEN']
        };
      }

      const lot = filterOf(symbolInfo, 'MARKET_LOT_SIZE') || filterOf(symbolInfo, 'LOT_SIZE');
      const step = finite(lot?.stepSize);
      const minQty = finite(lot?.minQty);
      const tpQty = splitTakeProfitQty(executedQty, step, normalized.partialFractions);
      if (!tpQty || minQty === null || tpQty.some(x => x < minQty || x <= 0)) {
        return {
          ok:false,
          orderPlaced:true,
          stopProtected:true,
          tpProtected:false,
          liveAllowed:false,
          execution:'LIVE_TP_SPLIT_REVIEW_REQUIRED',
          authorization,
          symbol:normalized.symbol,
          side:normalized.side,
          entryOrderId,
          entryStatus:text(entry?.status),
          executedQty,
          stopAlgoId,
          manualReviewRequired:true,
          transport:{ attempted:true, requestSent:true },
          reasons:['TAKE_PROFIT_SPLIT_INVALID_AFTER_FILL']
        };
      }

      const tpLevels = [normalized.takeProfit1, normalized.takeProfit2, normalized.takeProfit3];
      const tpAlgoIds = [];
      // CLAUDE_V111_TRAILING_RUNNER: BINDING modunda TP3 konmaz; son 1/3 miktar "runner" olarak
      // iz süren stopla yönetilir. Orijinal closePosition stop yerinde kalır (yedek koruma).
      const runnerEnabled = String(livePolicy?.runnerMode || '').toUpperCase() === 'BINDING';
      // CLAUDE_V112_RUNNER_TWO_THIRDS: varsayılan yalnız TP1 (1/3) konur; kalan 2/3 runner.
      const runnerShare = String(livePolicy?.runnerShare || 'ONE_THIRD').toUpperCase() === 'TWO_THIRDS' ? 'TWO_THIRDS' : 'ONE_THIRD';
      // R2544.28: when JEV supplied an explicit partial profile, place TP1+TP2 and preserve bucket 3
      // as the runner. Legacy runnerShare is only a fallback for old/no-profile entries.
      const hasJevFractions=Array.isArray(normalized.partialFractions)&&normalized.partialFractions.length===3;
      const tpCount = runnerEnabled ? (hasJevFractions ? 2 : (runnerShare === 'ONE_THIRD' ? 2 : 1)) : 3;
      try {
        for (let i = 0; i < tpCount; i++) {
          const params = {
            algoType:'CONDITIONAL',
            symbol:normalized.symbol,
            side:stopSide,
            positionSide,
            type:'TAKE_PROFIT_MARKET',
            triggerPrice:decimal(tpLevels[i]),
            workingType:'MARK_PRICE',
            quantity:decimal(tpQty[i]),
            priceProtect:'true',
            clientAlgoId:clientId(`T${i+1}`, normalized),
            newOrderRespType:'ACK'
          };
          if (!hedgeMode) params.reduceOnly = 'true';
          const tp = await this._fetchJson('POST', '/fapi/v1/algoOrder', {
            credentials, signed:true, params
          });
          const id = tp?.algoId ?? null;
          if (id === null) throw new TransportError(`BINANCE_TP${i+1}_ACK_INVALID`, { endpoint:'/fapi/v1/algoOrder', requestSent:true });
          tpAlgoIds.push(id);
        }
      } catch (tpError) {
        return {
          ok:false,
          orderPlaced:true,
          stopProtected:true,
          tpProtected:false,
          liveAllowed:false,
          execution:'LIVE_TP_PARTIAL_MANUAL_REVIEW_REQUIRED',
          authorization,
          symbol:normalized.symbol,
          side:normalized.side,
          positionSide,
          expectedLeverage,
          leverageChanged,
          livePrice,
          entryOrderId,
          entryStatus:text(entry?.status),
          executedQty,
          stopAlgoId,
          stopStatus:text(stop?.algoStatus) || 'NEW',
          tpAlgoIds,
          tpError:tpError?.body || { msg:String(tpError?.message || 'TAKE_PROFIT_INSTALL_FAILED').slice(0,240) },
          manualReviewRequired:true,
          transport:{ attempted:true, requestSent:true },
          reasons:['TAKE_PROFIT_INSTALL_INCOMPLETE_STOP_REMAINS_ACTIVE']
        };
      }

      return {
        ok:true,
        orderPlaced:true,
        stopProtected:true,
        tpProtected:true,
        liveAllowed:true,
        execution:'LIVE_ENTRY_FULLY_PROTECTED',
        authorization,
        symbol:normalized.symbol,
        side:normalized.side,
        positionSide,
        expectedLeverage,
        leverageChanged,
        livePrice,
        entryOrderId,
        entryStatus:text(entry?.status),
        executedQty,
        stopAlgoId,
        stopStatus:text(stop?.algoStatus) || 'NEW',
        tpAlgoIds,
        tpQuantities:tpQty,
        runner:{ enabled:runnerEnabled, share:runnerEnabled ? runnerShare : null, managementProfile:normalized.partialProfile||null, partialFractions:normalized.partialFractions||null, tpPlaced:tpCount, quantity:runnerEnabled ? Number(tpQty.slice(tpCount).reduce((a,b)=>a+b,0).toPrecision(15)) : null, takeProfit2:tpLevels[1], takeProfit3:tpLevels[2], mode:runnerEnabled ? 'BINDING' : 'TP3_FIXED' },
        transport:{ attempted:true, requestSent:true },
        reasons:[]
      };
    } catch (e) {
      return {
        ok:false,
        orderPlaced:false,
        stopProtected:false,
        liveAllowed:false,
        execution:'LIVE_PREFLIGHT_BLOCKED',
        authorization,
        exchangeError:e?.body || null,
        transport:{ attempted:preflightRequestSent || Boolean(e?.requestSent), requestSent:Boolean(e?.requestSent) },
        reasons:[String(e?.message || 'BINANCE_PREFLIGHT_FAILED')]
      };
    }
  }

  // ------------------------------------------------------------------
  // R2535_JEV_POSITION_REDUCTION: JEV position-management actions may reduce an
  // already-open position only. This helper can never increase/reverse exposure.
  // The controller must separately require explicit LIVE arm + BrainHub ownership.
  // ------------------------------------------------------------------
  async reducePositionMarket({ symbol, side, fraction = 1, maxQuantity = null, minRemainingQty = null, clientOrderId = null, credentials, reason = 'JEV_POSITION_MANAGEMENT' } = {}) {
    const sym=text(symbol)?.toUpperCase();
    const s=text(side)?.toUpperCase();
    const f=finite(fraction);
    const apiKey=text(credentials?.apiKey),apiSecret=text(credentials?.apiSecret);
    if(!sym||!/^[A-Z0-9]{1,28}USDT$/.test(sym)||!['LONG','SHORT'].includes(s)||f===null||f<=0||f>1){
      return {ok:false,orderPlaced:false,reason:'POSITION_REDUCE_INPUT_INVALID'};
    }
    if(!apiKey||!apiSecret)return {ok:false,orderPlaced:false,reason:'BINANCE_CREDENTIALS_REQUIRED'};
    if(clientOrderId!==null&&!/^JX[a-f0-9]{30}$/.test(clientOrderId))return {ok:false,orderPlaced:false,requestSent:false,reason:'POSITION_REDUCE_CLIENT_ID_INVALID'};
    const cid=clientOrderId||'JX'+crypto.createHash('sha256').update(sym+'|'+s+'|'+String(this.clock())+'|'+String(f)+'|'+String(reason)).digest('hex').slice(0,30);
    let reductionSent=false;
    try{
      await this._syncServerTime();
      const mode=await this._fetchJson('GET','/fapi/v1/positionSide/dual',{credentials,signed:true});
      const hedgeMode=mode?.dualSidePosition===true;
      const rows=await this._fetchJson('GET','/fapi/v3/positionRisk',{params:{symbol:sym},credentials,signed:true});
      const list=Array.isArray(rows)?rows:[];
      const row=hedgeMode
        ? list.find(x=>text(x?.positionSide)?.toUpperCase()===s)
        : list.find(x=>text(x?.positionSide||'BOTH')?.toUpperCase()==='BOTH');
      const amt=finite(row?.positionAmt)||0;
      const sideMatches=hedgeMode ? Math.abs(amt)>0 : (s==='LONG'?amt>0:amt<0);
      if(!sideMatches)return {ok:false,orderPlaced:false,reason:'POSITION_NOT_OPEN_OR_SIDE_MISMATCH',actualPositionAmt:amt};
      const actualQty=Math.abs(amt);
      const exchangeInfo=await this._fetchJson('GET','/fapi/v1/exchangeInfo');
      const info=Array.isArray(exchangeInfo?.symbols)?exchangeInfo.symbols.find(x=>x?.symbol===sym):null;
      const lot=filterOf(info,'MARKET_LOT_SIZE')||filterOf(info,'LOT_SIZE');
      const step=finite(lot?.stepSize),minQty=finite(lot?.minQty);
      if(step===null||step<=0||minQty===null||minQty<=0)return {ok:false,orderPlaced:false,reason:'POSITION_REDUCE_LOT_FILTER_REQUIRED'};
      let qty=f>=0.999999?floorToStep(actualQty,step):floorToStep(actualQty*f,step);
      if(finite(maxQuantity)!==null)qty=Math.min(qty,floorToStep(maxQuantity,step));
      if(finite(minRemainingQty)!==null)qty=Math.min(qty,floorToStep(Math.max(0,actualQty-minRemainingQty),step));
      if(qty===null||qty<minQty||qty<=0)return {ok:false,orderPlaced:false,reason:'POSITION_REDUCE_QTY_BELOW_MIN',actualQty,fraction:f,step,minQty};
      if(qty>actualQty)qty=floorToStep(actualQty,step);
      const closeSide=s==='LONG'?'SELL':'BUY';
      const params={
        symbol:sym,side:closeSide,positionSide:hedgeMode?s:'BOTH',type:'MARKET',
        quantity:decimal(qty),newClientOrderId:cid,newOrderRespType:'RESULT'
      };
      if(!hedgeMode)params.reduceOnly='true';
      reductionSent=true;
      const ack=await this._fetchJson('POST','/fapi/v1/order',{credentials,signed:true,params});
      const orderId=ack?.orderId??null;
      const executedQty=finite(ack?.executedQty)||0;
      if(orderId===null||executedQty<=0){
        return {ok:false,orderPlaced:orderId!==null,requestSent:true,clientOrderId:cid,reason:'POSITION_REDUCE_FILL_UNCLEAR',symbol:sym,side:s,quantity:qty,orderId,status:text(ack?.status)};
      }
      let remainingQty=null;
      try{
        const after=await this._fetchJson('GET','/fapi/v3/positionRisk',{params:{symbol:sym},credentials,signed:true});
        const rows2=Array.isArray(after)?after:[];
        const r2=hedgeMode
          ? rows2.find(x=>text(x?.positionSide)?.toUpperCase()===s)
          : rows2.find(x=>text(x?.positionSide||'BOTH')?.toUpperCase()==='BOTH');
        const a2=finite(r2?.positionAmt)||0;
        remainingQty=Math.abs(a2);
      }catch{}
      return {
        ok:true,orderPlaced:true,requestSent:true,execution:f>=0.999999?'JEV_EXIT_NOW_REDUCE_ONLY_MARKET':'JEV_PARTIAL_REDUCE_ONLY_MARKET',
        symbol:sym,side:s,fraction:f,clientOrderId:cid,requestedQty:qty,executedQty,remainingQty,
        avgPrice:finite(ack?.avgPrice),fullyClosed:remainingQty===0,closeVerification:remainingQty===null?'UNVERIFIED':'POSITION_RISK_RECHECKED',orderId,status:text(ack?.status),hedgeMode,
        reduceOnly:!hedgeMode,reason:String(reason||'JEV_POSITION_MANAGEMENT').slice(0,80)
      };
    }catch(e){
      // A protective stop may win the race with a reduce-only market request.
      // Confirm exchange inventory before marking it flat; never retry blindly
      // or claim that our rejected order performed the close.
      if(reductionSent&&Number(e?.body?.code)===-2022){
        try{
          const after=await this._fetchJson('GET','/fapi/v3/positionRisk',{params:{symbol:sym},credentials,signed:true});
          const matching=Array.isArray(after)?after.filter(x=>x.symbol===sym&&(x.positionSide===s||x.positionSide==='BOTH')):[];
          if(matching.length&&matching.every(x=>finite(x.positionAmt)===0))return {ok:false,orderPlaced:false,requestSent:true,clientOrderId:cid,fullyClosed:true,remainingQty:0,closeVerification:'POSITION_RISK_RECHECKED',reason:'POSITION_ALREADY_FLAT_AFTER_REJECT',exchangeError:e.body};
        }catch{}
      }
      return {ok:false,orderPlaced:false,requestSent:reductionSent,clientOrderId:cid,reason:String(e?.message||'POSITION_REDUCE_FAILED').slice(0,160),exchangeError:e?.body||null};
    }
  }
  async reductionStatus({symbol,clientOrderId,credentials}={}){
    if(!/^[A-Z0-9]{1,28}USDT$/.test(String(symbol||''))||!/^JX[a-f0-9]{30}$/.test(String(clientOrderId||'')))return {ok:false,reason:'REDUCTION_ID_REQUIRED'};
    try{
      await this._syncServerTime();
      const ack=await this._fetchJson('GET','/fapi/v1/order',{params:{symbol,origClientOrderId:clientOrderId},credentials,signed:true});
      return {ok:true,status:text(ack?.status),avgPrice:finite(ack?.avgPrice),executedQty:finite(ack?.executedQty),orderId:ack?.orderId??null};
    }catch{return {ok:false,reason:'REDUCTION_STATUS_UNAVAILABLE'};}
  }

  // ------------------------------------------------------------------
  // CLAUDE_V111_TRAILING_RUNNER: yalnız koruyucu (reduce-only) emir yönetimi.
  // Giriş/pozisyon açma yetkisi yoktur; grant tüketmez.
  // ------------------------------------------------------------------
  async positionSnapshot({ symbol, side, credentials } = {}) {
    const sym = text(symbol)?.toUpperCase();
    const s = text(side)?.toUpperCase();
    if (!sym || !['LONG','SHORT'].includes(s)) return { ok:false, reason:'RUNNER_SNAPSHOT_INPUT_INVALID' };
    try {
      await this._syncServerTime();
      const mode = await this._fetchJson('GET', '/fapi/v1/positionSide/dual', { credentials, signed:true });
      const hedgeMode = mode?.dualSidePosition === true;
      const rows = await this._fetchJson('GET', '/fapi/v3/positionRisk', { params:{ symbol:sym }, credentials, signed:true });
      const list = Array.isArray(rows) ? rows : [];
      const row = hedgeMode
        ? list.find(x => text(x?.positionSide)?.toUpperCase() === s)
        : list.find(x => text(x?.positionSide || 'BOTH')?.toUpperCase() === 'BOTH');
      const amt = finite(row?.positionAmt) || 0;
      const sideMatches = hedgeMode ? true : (s === 'LONG' ? amt > 0 : amt < 0);
      const qty = sideMatches ? Math.abs(amt) : 0;
      const exchangeInfo = await this._fetchJson('GET', '/fapi/v1/exchangeInfo');
      const info = Array.isArray(exchangeInfo?.symbols) ? exchangeInfo.symbols.find(x => x?.symbol === sym) : null;
      const lot = filterOf(info, 'MARKET_LOT_SIZE') || filterOf(info, 'LOT_SIZE');
      const priceFilter = filterOf(info, 'PRICE_FILTER');
      return {
        ok:true, symbol:sym, side:s, hedgeMode, positionSide:hedgeMode ? s : 'BOTH', qty,
        oppositeOpen:!sideMatches && amt !== 0,
        entryPrice:finite(row?.entryPrice), markPrice:finite(row?.markPrice),
        tickSize:finite(priceFilter?.tickSize), stepSize:finite(lot?.stepSize),
        // CLAUDE_R2544_LIQUIDATION_MODEL: açık pozisyonda Binance likidasyon fiyatı otoritedir.
        liquidationPrice:finite(row?.liquidationPrice), breakEvenPrice:finite(row?.breakEvenPrice),
        isolatedWallet:finite(row?.isolatedWallet),
        marginMode:finite(row?.isolatedWallet)>0||String(row?.marginType||'').toLowerCase()==='isolated'?'ISOLATED':(row?'CROSSED':null)
      };
    } catch (e) {
      return { ok:false, reason:String(e?.message || 'RUNNER_SNAPSHOT_FAILED').slice(0,120), exchangeError:e?.body || null };
    }
  }

  async placeRunnerStop({ symbol, side, positionSide = 'BOTH', hedgeMode = false, quantity, triggerPrice, clientAlgoId, credentials } = {}) {
    const s = text(side)?.toUpperCase();
    const qty = finite(quantity), price = finite(triggerPrice);
    if (!text(symbol) || !['LONG','SHORT'].includes(s) || qty === null || qty <= 0 || price === null || price <= 0) {
      return { ok:false, reason:'RUNNER_STOP_INPUT_INVALID' };
    }
    const params = {
      algoType:'CONDITIONAL',
      symbol:text(symbol).toUpperCase(),
      side:s === 'LONG' ? 'SELL' : 'BUY',
      positionSide:hedgeMode ? s : 'BOTH',
      type:'STOP_MARKET',
      triggerPrice:decimal(price),
      workingType:'MARK_PRICE',
      quantity:decimal(qty),
      priceProtect:'true',
      clientAlgoId:String(clientAlgoId || '').slice(0,36) || undefined,
      newOrderRespType:'ACK'
    };
    if (!hedgeMode) params.reduceOnly = 'true';
    try {
      const ack = await this._fetchJson('POST', '/fapi/v1/algoOrder', { credentials, signed:true, params });
      const algoId = ack?.algoId ?? null;
      if (algoId === null) return { ok:false, requestSent:true, reason:'RUNNER_STOP_ACK_INVALID' };
      return { ok:true, algoId, triggerPrice:price, quantity:qty };
    } catch (e) {
      // HTTP 4xx = borsa reddetti (emir yok); zaman aşımı/ağ = durum bilinmiyor.
      const rejected = Number.isFinite(Number(e?.status)) && Number(e.status) >= 400 && Number(e.status) < 500;
      return { ok:false, requestSent:rejected ? false : Boolean(e?.requestSent), reason:String(e?.message || 'RUNNER_STOP_FAILED').slice(0,120), exchangeError:e?.body || null };
    }
  }

  async placeTakeProfit({ symbol, side, hedgeMode = false, quantity, triggerPrice, clientAlgoId, credentials } = {}) {
    const s = text(side)?.toUpperCase();
    const qty = finite(quantity), price = finite(triggerPrice);
    if (!text(symbol) || !['LONG','SHORT'].includes(s) || qty === null || qty <= 0 || price === null || price <= 0) {
      return { ok:false, reason:'RUNNER_TP_INPUT_INVALID' };
    }
    const params = {
      algoType:'CONDITIONAL',
      symbol:text(symbol).toUpperCase(),
      side:s === 'LONG' ? 'SELL' : 'BUY',
      positionSide:hedgeMode ? s : 'BOTH',
      type:'TAKE_PROFIT_MARKET',
      triggerPrice:decimal(price),
      workingType:'MARK_PRICE',
      quantity:decimal(qty),
      priceProtect:'true',
      clientAlgoId:String(clientAlgoId || '').slice(0,36) || undefined,
      newOrderRespType:'ACK'
    };
    if (!hedgeMode) params.reduceOnly = 'true';
    try {
      const ack = await this._fetchJson('POST', '/fapi/v1/algoOrder', { credentials, signed:true, params });
      const algoId = ack?.algoId ?? null;
      return algoId === null ? { ok:false, reason:'RUNNER_TP_ACK_INVALID' } : { ok:true, algoId };
    } catch (e) {
      return { ok:false, reason:String(e?.message || 'RUNNER_TP_FAILED').slice(0,120), exchangeError:e?.body || null };
    }
  }

  async cancelAlgoOrder({ algoId = null, clientAlgoId = null, credentials } = {}) {
    const hasId = algoId !== null && algoId !== undefined && algoId !== '';
    const hasClient = clientAlgoId !== null && clientAlgoId !== undefined && clientAlgoId !== '';
    if (!hasId && !hasClient) return { ok:false, reason:'RUNNER_CANCEL_INPUT_INVALID' };
    const params = hasId ? { algoId:String(algoId) } : { clientAlgoId:String(clientAlgoId) };
    try {
      await this._fetchJson('DELETE', '/fapi/v1/algoOrder', { params, credentials, signed:true });
      return { ok:true, algoId:hasId ? algoId : null, clientAlgoId:hasClient ? clientAlgoId : null };
    } catch (e) {
      return { ok:false, algoId, clientAlgoId, reason:String(e?.message || 'RUNNER_CANCEL_FAILED').slice(0,120), exchangeError:e?.body || null };
    }
  }
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_RECV_WINDOW_MS,
  approxMultiple,
  floorToStep,
  normalizePartialFractions,
  splitTakeProfitQty,
  BinanceLiveTransport,
  PaperExchange,
  TransportError,
  readTradingMode,
  writeTradingMode,
  PAPER_ROUTES
};
