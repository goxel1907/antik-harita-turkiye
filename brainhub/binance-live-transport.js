'use strict';

const crypto = require('node:crypto');
const { canonicalOrder } = require('./live-authorization');

const DEFAULT_BASE_URL = 'https://fapi.binance.com';
const DEFAULT_RECV_WINDOW_MS = 5000;
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 262144;

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
  }

  async _fetchJson(method, path, { params = {}, credentials = null, signed = false } = {}) {
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
    const query = payload.toString();
    const url = `${this.baseUrl}${path}${isGet && query ? `?${query}` : ''}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
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
    } catch (e) {
      throw new TransportError(e?.name === 'AbortError' ? 'BINANCE_REQUEST_TIMEOUT' : 'BINANCE_NETWORK_ERROR', {
        endpoint:path,
        requestSent:true
      });
    } finally {
      clearTimeout(timer);
    }

    let raw = '';
    try {
      raw = await response.text();
    } catch {
      throw new TransportError('BINANCE_RESPONSE_READ_ERROR', { endpoint:path, status:response.status, requestSent:true });
    }
    if (raw.length > MAX_RESPONSE_BYTES) {
      throw new TransportError('BINANCE_RESPONSE_TOO_LARGE', { endpoint:path, status:response.status, requestSent:true });
    }
    let body = null;
    if (raw) {
      try { body = JSON.parse(raw); }
      catch { body = { msg:raw.slice(0,240) }; }
    }
    if (!response.ok) {
      throw new TransportError(`BINANCE_HTTP_${response.status}`, {
        endpoint:path,
        status:response.status,
        requestSent:true,
        body:sanitizeExchangeError(body)
      });
    }
    return body;
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
    }

    const minNotionalFilter = filterOf(symbolInfo, 'MIN_NOTIONAL');
    const minNotional = finite(minNotionalFilter?.notional ?? minNotionalFilter?.minNotional);
    if (minNotional !== null && qty !== null && livePrice !== null && qty * livePrice < minNotional) reasons.push('MIN_NOTIONAL_NOT_MET');

    const entry = finite(order.entryPrice);
    const maxDeviationPct = Math.max(0.01, Math.min(5, finite(livePolicy?.maxEntryDeviationPct) ?? 0.5));
    if (entry === null || livePrice === null) reasons.push('LIVE_PRICE_CHECK_REQUIRED');
    else {
      const deviationPct = Math.abs(livePrice - entry) / entry * 100;
      if (deviationPct > maxDeviationPct) reasons.push('LIVE_PRICE_DEVIATION_TOO_HIGH');
      if (order.side === 'LONG' && !(stop < livePrice)) reasons.push('LONG_STOP_NOT_BELOW_LIVE_PRICE');
      if (order.side === 'SHORT' && !(stop > livePrice)) reasons.push('SHORT_STOP_NOT_ABOVE_LIVE_PRICE');
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
      const positionRisk = await this._fetchJson('GET', '/fapi/v3/positionRisk', {
        params:{ symbol:normalized.symbol }, credentials, signed:true
      });
      const rows = Array.isArray(positionRisk) ? positionRisk : [];
      if (!rows.length) {
        return {
          ok:false, orderPlaced:false, stopProtected:false, liveAllowed:false, execution:'LIVE_BLOCKED', authorization,
          transport:{ attempted:true, requestSent:true }, reasons:['POSITION_RISK_REQUIRED']
        };
      }
      if (rows.some(x => Math.abs(finite(x?.positionAmt) || 0) > 0)) {
        return {
          ok:false, orderPlaced:false, stopProtected:false, liveAllowed:false, execution:'LIVE_BLOCKED', authorization,
          transport:{ attempted:true, requestSent:true }, reasons:['SYMBOL_POSITION_ALREADY_OPEN']
        };
      }
      const leverages = [...new Set(rows.map(x => finite(x?.leverage)).filter(x => x !== null))];
      if (!leverages.length || leverages.some(x => x !== expectedLeverage)) {
        return {
          ok:false, orderPlaced:false, stopProtected:false, liveAllowed:false, execution:'LIVE_BLOCKED', authorization,
          observedLeverages:leverages,
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
      try {
        const stop = await this._fetchJson('POST', '/fapi/v1/algoOrder', {
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
        const stopAlgoId = stop?.algoId ?? null;
        if (stopAlgoId === null) throw new TransportError('BINANCE_STOP_ACK_INVALID', { endpoint:'/fapi/v1/algoOrder', requestSent:true });
        return {
          ok:true,
          orderPlaced:true,
          stopProtected:true,
          liveAllowed:true,
          execution:'LIVE_ENTRY_PROTECTED',
          authorization,
          symbol:normalized.symbol,
          side:normalized.side,
          positionSide,
          expectedLeverage,
          livePrice,
          entryOrderId,
          entryStatus:text(entry?.status),
          executedQty,
          stopAlgoId,
          stopStatus:text(stop?.algoStatus) || 'NEW',
          transport:{ attempted:true, requestSent:true },
          reasons:[]
        };
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
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_RECV_WINDOW_MS,
  approxMultiple,
  BinanceLiveTransport
};
