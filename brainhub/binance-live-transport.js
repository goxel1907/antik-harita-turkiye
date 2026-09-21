'use strict';

const crypto = require('node:crypto');
const { canonicalOrder } = require('./live-authorization');

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

function splitTakeProfitQty(totalQty, step) {
  const total = finite(totalQty), s = finite(step);
  if (total === null || s === null || total <= 0 || s <= 0) return null;
  const q1 = floorToStep(total / 3, s);
  const q2 = floorToStep(total / 3, s);
  if (q1 === null || q2 === null) return null;
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
      const split = splitTakeProfitQty(qty, step);
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
      let positionRisk = await this._fetchJson('GET', '/fapi/v3/positionRisk', {
        params:{ symbol:normalized.symbol }, credentials, signed:true
      });
      let rows = Array.isArray(positionRisk) ? positionRisk : [];
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

      let leverages = [...new Set(rows.map(x => finite(x?.leverage)).filter(x => x !== null))];
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
        positionRisk = await this._fetchJson('GET', '/fapi/v3/positionRisk', {
          params:{ symbol:normalized.symbol }, credentials, signed:true
        });
        rows = Array.isArray(positionRisk) ? positionRisk : [];
        leverages = [...new Set(rows.map(x => finite(x?.leverage)).filter(x => x !== null))];
      }
      if (!rows.length || !leverages.length || leverages.some(x => x !== expectedLeverage)) {
        return {
          ok:false, orderPlaced:false, stopProtected:false, liveAllowed:false, execution:'LIVE_BLOCKED', authorization,
          observedLeverages:leverages,
          leverageChanged,
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
      const tpQty = splitTakeProfitQty(executedQty, step);
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
      const runnerShare = String(livePolicy?.runnerShare || 'TWO_THIRDS').toUpperCase() === 'ONE_THIRD' ? 'ONE_THIRD' : 'TWO_THIRDS';
      const tpCount = runnerEnabled ? (runnerShare === 'ONE_THIRD' ? 2 : 1) : 3;
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
        runner:{ enabled:runnerEnabled, share:runnerEnabled ? runnerShare : null, tpPlaced:tpCount, quantity:runnerEnabled ? Number(tpQty.slice(tpCount).reduce((a,b)=>a+b,0).toPrecision(15)) : null, takeProfit2:tpLevels[1], takeProfit3:tpLevels[2], mode:runnerEnabled ? 'BINDING' : 'TP3_FIXED' },
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
        tickSize:finite(priceFilter?.tickSize), stepSize:finite(lot?.stepSize)
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
  splitTakeProfitQty,
  BinanceLiveTransport
};
