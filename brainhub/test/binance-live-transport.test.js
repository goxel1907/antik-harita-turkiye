'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BinanceLiveTransport } = require('../binance-live-transport');

function order() {
  return {
    action:'OPEN',
    symbol:'BTCUSDT',
    side:'LONG',
    orderType:'MARKET',
    quantity:0.1,
    entryPrice:100,
    stopPrice:98.8,
    clientOrderId:'live-regression-001',
    lineageId:'lineage-regression-001'
  };
}

function credentials() {
  return { apiKey:'test-api-key-not-secret', apiSecret:'test-api-secret-not-secret' };
}

function ok(body, status = 200) {
  return {
    ok:status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); }
  };
}

function exchangeInfo() {
  return {
    symbols:[{
      symbol:'BTCUSDT',
      status:'TRADING',
      contractType:'PERPETUAL',
      quoteAsset:'USDT',
      filters:[
        { filterType:'MARKET_LOT_SIZE', minQty:'0.001', maxQty:'1000', stepSize:'0.001' },
        { filterType:'PRICE_FILTER', minPrice:'0.1', maxPrice:'1000000', tickSize:'0.1' },
        { filterType:'MIN_NOTIONAL', notional:'5' }
      ]
    }]
  };
}

function authorizedRegistry() {
  return {
    consume({ grantId }) {
      assert.equal(grantId, 'grant-regression-001');
      return {
        ok:true,
        consumed:true,
        liveAllowed:true,
        execution:'LIVE_AUTHORIZED_ONCE',
        grantId,
        lineageId:'lineage-regression-001',
        clientOrderId:'live-regression-001',
        symbol:'BTCUSDT',
        side:'LONG',
        reasons:[]
      };
    }
  };
}

function pathOf(url) {
  return new URL(url).pathname;
}

test('LIVE transport sends no network request without a consumed authorization grant', async () => {
  let calls = 0;
  const transport = new BinanceLiveTransport({
    registry:{ consume:() => ({ ok:false, liveAllowed:false, reasons:['LIVE_GRANT_UNKNOWN_OR_CONSUMED'] }) },
    fetchImpl:async () => { calls++; throw new Error('network must not be touched'); },
    clock:() => 1000000
  });

  const result = await transport.submit({
    grantId:'missing-grant',
    order:order(),
    credentials:credentials(),
    livePolicy:{ expectedLeverage:10 }
  });

  assert.equal(result.ok, false);
  assert.equal(result.orderPlaced, false);
  assert.equal(result.transport.attempted, false);
  assert.equal(result.transport.requestSent, false);
  assert.equal(calls, 0);
  assert.ok(result.reasons.includes('LIVE_GRANT_UNKNOWN_OR_CONSUMED'));
});

test('authorized MARKET entry is submitted only after preflight and returns protected after algo STOP ack', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const path = pathOf(url);
    const method = options.method || 'GET';
    calls.push({ path, method, body:options.body || '' });
    if (path === '/fapi/v1/time') return ok({ serverTime:1000000 });
    if (path === '/fapi/v1/exchangeInfo') return ok(exchangeInfo());
    if (path === '/fapi/v1/ticker/price') return ok({ symbol:'BTCUSDT', price:'100' });
    if (path === '/fapi/v1/positionSide/dual') return ok({ dualSidePosition:false });
    if (path === '/fapi/v3/positionRisk') return ok([{ symbol:'BTCUSDT', positionAmt:'0', leverage:'10', positionSide:'BOTH' }]);
    if (path === '/fapi/v1/order' && method === 'POST') return ok({ orderId:123, status:'FILLED', executedQty:'0.1' });
    if (path === '/fapi/v1/algoOrder' && method === 'POST') return ok({ algoId:456, algoStatus:'NEW' });
    throw new Error(`unexpected mocked request ${method} ${path}`);
  };

  const transport = new BinanceLiveTransport({
    registry:authorizedRegistry(),
    fetchImpl,
    clock:() => 1000000
  });
  const result = await transport.submit({
    grantId:'grant-regression-001',
    order:order(),
    credentials:credentials(),
    livePolicy:{ expectedLeverage:10, maxEntryDeviationPct:0.5 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.orderPlaced, true);
  assert.equal(result.stopProtected, true);
  assert.equal(result.liveAllowed, true);
  assert.equal(result.execution, 'LIVE_ENTRY_PROTECTED');
  assert.equal(result.entryOrderId, 123);
  assert.equal(result.stopAlgoId, 456);
  assert.deepEqual(calls.map(x => `${x.method} ${x.path}`), [
    'GET /fapi/v1/time',
    'GET /fapi/v1/exchangeInfo',
    'GET /fapi/v1/ticker/price',
    'GET /fapi/v1/positionSide/dual',
    'GET /fapi/v3/positionRisk',
    'POST /fapi/v1/order',
    'POST /fapi/v1/algoOrder'
  ]);
  const entry = calls.find(x => x.path === '/fapi/v1/order' && x.method === 'POST');
  assert.match(entry.body, /type=MARKET/);
  assert.match(entry.body, /positionSide=BOTH/);
  assert.match(entry.body, /newClientOrderId=live-regression-001/);
  const stop = calls.find(x => x.path === '/fapi/v1/algoOrder');
  assert.match(stop.body, /algoType=CONDITIONAL/);
  assert.match(stop.body, /type=STOP_MARKET/);
  assert.match(stop.body, /closePosition=true/);
});

test('protective STOP rejection triggers one emergency reduce-only MARKET close in one-way mode', async () => {
  let orderPosts = 0;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const path = pathOf(url);
    const method = options.method || 'GET';
    calls.push({ path, method, body:options.body || '' });
    if (path === '/fapi/v1/time') return ok({ serverTime:1000000 });
    if (path === '/fapi/v1/exchangeInfo') return ok(exchangeInfo());
    if (path === '/fapi/v1/ticker/price') return ok({ symbol:'BTCUSDT', price:'100' });
    if (path === '/fapi/v1/positionSide/dual') return ok({ dualSidePosition:false });
    if (path === '/fapi/v3/positionRisk') return ok([{ symbol:'BTCUSDT', positionAmt:'0', leverage:'10', positionSide:'BOTH' }]);
    if (path === '/fapi/v1/algoOrder' && method === 'POST') return ok({ code:-4120, msg:'mock stop rejected' }, 400);
    if (path === '/fapi/v1/order' && method === 'POST') {
      orderPosts++;
      if (orderPosts === 1) return ok({ orderId:123, status:'FILLED', executedQty:'0.1' });
      return ok({ orderId:789, status:'FILLED', executedQty:'0.1' });
    }
    throw new Error(`unexpected mocked request ${method} ${path}`);
  };

  const transport = new BinanceLiveTransport({
    registry:authorizedRegistry(),
    fetchImpl,
    clock:() => 1000000
  });
  const result = await transport.submit({
    grantId:'grant-regression-001',
    order:order(),
    credentials:credentials(),
    livePolicy:{ expectedLeverage:10, maxEntryDeviationPct:0.5 }
  });

  assert.equal(result.ok, false);
  assert.equal(result.orderPlaced, true);
  assert.equal(result.stopProtected, false);
  assert.equal(result.liveAllowed, false);
  assert.equal(result.execution, 'LIVE_STOP_FAILED_EMERGENCY_CLOSED');
  assert.equal(result.emergencyCloseAttempted, true);
  assert.equal(result.emergencyCloseSucceeded, true);
  assert.equal(result.emergencyCloseOrderId, 789);
  assert.equal(orderPosts, 2);
  const emergency = calls.filter(x => x.path === '/fapi/v1/order' && x.method === 'POST')[1];
  assert.match(emergency.body, /reduceOnly=true/);
  assert.match(emergency.body, /side=SELL/);
});


test('requested leverage is applied and re-verified before LIVE entry', async () => {
  let positionReads = 0;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const path = pathOf(url);
    const method = options.method || 'GET';
    calls.push({ path, method, body:options.body || '' });
    if (path === '/fapi/v1/time') return ok({ serverTime:1000000 });
    if (path === '/fapi/v1/exchangeInfo') return ok(exchangeInfo());
    if (path === '/fapi/v1/ticker/price') return ok({ symbol:'BTCUSDT', price:'100' });
    if (path === '/fapi/v1/positionSide/dual') return ok({ dualSidePosition:false });
    if (path === '/fapi/v3/positionRisk') {
      positionReads++;
      return ok([{ symbol:'BTCUSDT', positionAmt:'0', leverage:positionReads === 1 ? '5' : '10', positionSide:'BOTH' }]);
    }
    if (path === '/fapi/v1/leverage' && method === 'POST') {
      assert.match(options.body || '', /symbol=BTCUSDT/);
      assert.match(options.body || '', /leverage=10/);
      return ok({ symbol:'BTCUSDT', leverage:10, maxNotionalValue:'1000000' });
    }
    if (path === '/fapi/v1/order' && method === 'POST') return ok({ orderId:321, status:'FILLED', executedQty:'0.1' });
    if (path === '/fapi/v1/algoOrder' && method === 'POST') return ok({ algoId:654, algoStatus:'NEW' });
    throw new Error(`unexpected mocked request ${method} ${path}`);
  };

  const transport = new BinanceLiveTransport({
    registry:authorizedRegistry(),
    fetchImpl,
    clock:() => 1000000
  });
  const result = await transport.submit({
    grantId:'grant-regression-001',
    order:order(),
    credentials:credentials(),
    livePolicy:{ expectedLeverage:10, maxEntryDeviationPct:0.5 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.execution, 'LIVE_ENTRY_PROTECTED');
  assert.equal(result.expectedLeverage, 10);
  assert.equal(result.leverageChanged, true);
  assert.equal(positionReads, 2);
  assert.deepEqual(calls.map(x => `${x.method} ${x.path}`), [
    'GET /fapi/v1/time',
    'GET /fapi/v1/exchangeInfo',
    'GET /fapi/v1/ticker/price',
    'GET /fapi/v1/positionSide/dual',
    'GET /fapi/v3/positionRisk',
    'POST /fapi/v1/leverage',
    'GET /fapi/v3/positionRisk',
    'POST /fapi/v1/order',
    'POST /fapi/v1/algoOrder'
  ]);
});

test('LIVE entry stays fail-closed when requested leverage is not acknowledged', async () => {
  let entryPosts = 0;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const path = pathOf(url);
    const method = options.method || 'GET';
    calls.push({ path, method, body:options.body || '' });
    if (path === '/fapi/v1/time') return ok({ serverTime:1000000 });
    if (path === '/fapi/v1/exchangeInfo') return ok(exchangeInfo());
    if (path === '/fapi/v1/ticker/price') return ok({ symbol:'BTCUSDT', price:'100' });
    if (path === '/fapi/v1/positionSide/dual') return ok({ dualSidePosition:false });
    if (path === '/fapi/v3/positionRisk') return ok([{ symbol:'BTCUSDT', positionAmt:'0', leverage:'5', positionSide:'BOTH' }]);
    if (path === '/fapi/v1/leverage' && method === 'POST') return ok({ symbol:'BTCUSDT', leverage:5 });
    if (path === '/fapi/v1/order' && method === 'POST') {
      entryPosts++;
      return ok({ orderId:999, status:'FILLED', executedQty:'0.1' });
    }
    throw new Error(`unexpected mocked request ${method} ${path}`);
  };

  const transport = new BinanceLiveTransport({
    registry:authorizedRegistry(),
    fetchImpl,
    clock:() => 1000000
  });
  const result = await transport.submit({
    grantId:'grant-regression-001',
    order:order(),
    credentials:credentials(),
    livePolicy:{ expectedLeverage:10, maxEntryDeviationPct:0.5 }
  });

  assert.equal(result.ok, false);
  assert.equal(result.orderPlaced, false);
  assert.equal(result.liveAllowed, false);
  assert.equal(result.execution, 'LIVE_BLOCKED');
  assert.ok(result.reasons.includes('BINANCE_LEVERAGE_CHANGE_REJECTED'));
  assert.equal(entryPosts, 0);
  assert.equal(calls.some(x => x.path === '/fapi/v1/order' && x.method === 'POST'), false);
});
