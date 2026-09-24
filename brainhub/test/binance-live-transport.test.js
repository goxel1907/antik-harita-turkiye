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
    quantity:0.3,
    entryPrice:100,
    stopPrice:98.8,
    takeProfit1:102,
    takeProfit2:104,
    takeProfit3:106,
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
    if (path === '/fapi/v1/order' && method === 'POST') return ok({ orderId:123, status:'FILLED', executedQty:'0.3' });
    if (path === '/fapi/v1/algoOrder' && method === 'POST') {
      const count = calls.filter(x => x.path === '/fapi/v1/algoOrder' && x.method === 'POST').length;
      return ok({ algoId:455 + count, algoStatus:'NEW' });
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

  assert.equal(result.ok, true);
  assert.equal(result.orderPlaced, true);
  assert.equal(result.stopProtected, true);
  assert.equal(result.liveAllowed, true);
  assert.equal(result.execution, 'LIVE_ENTRY_FULLY_PROTECTED');
  assert.equal(result.entryOrderId, 123);
  assert.equal(result.stopAlgoId, 456);
  assert.equal(result.tpProtected, true);
  assert.deepEqual(result.tpAlgoIds, [457,458,459]);
  assert.deepEqual(calls.map(x => `${x.method} ${x.path}`), [
    'GET /fapi/v1/time',
    'GET /fapi/v1/exchangeInfo',
    'GET /fapi/v1/ticker/price',
    'GET /fapi/v1/positionSide/dual',
    'GET /fapi/v3/positionRisk',
    'POST /fapi/v1/order',
    'POST /fapi/v1/algoOrder',
    'POST /fapi/v1/algoOrder',
    'POST /fapi/v1/algoOrder',
    'POST /fapi/v1/algoOrder'
  ]);
  const entry = calls.find(x => x.path === '/fapi/v1/order' && x.method === 'POST');
  assert.match(entry.body, /type=MARKET/);
  assert.match(entry.body, /positionSide=BOTH/);
  assert.match(entry.body, /newClientOrderId=live-regression-001/);
  const algos = calls.filter(x => x.path === '/fapi/v1/algoOrder');
  const stop = algos[0];
  assert.match(stop.body, /algoType=CONDITIONAL/);
  assert.match(stop.body, /type=STOP_MARKET/);
  assert.match(stop.body, /closePosition=true/);
  const tps = algos.slice(1);
  assert.equal(tps.length, 3);
  assert.match(tps[0].body, /type=TAKE_PROFIT_MARKET/);
  assert.match(tps[0].body, /triggerPrice=102/);
  assert.match(tps[0].body, /reduceOnly=true/);
  assert.match(tps[1].body, /triggerPrice=104/);
  assert.match(tps[2].body, /triggerPrice=106/);
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
      if (orderPosts === 1) return ok({ orderId:123, status:'FILLED', executedQty:'0.3' });
      return ok({ orderId:789, status:'FILLED', executedQty:'0.3' });
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
    if (path === '/fapi/v1/order' && method === 'POST') return ok({ orderId:321, status:'FILLED', executedQty:'0.3' });
    if (path === '/fapi/v1/algoOrder' && method === 'POST') {
      const count = calls.filter(x => x.path === '/fapi/v1/algoOrder' && x.method === 'POST').length;
      return ok({ algoId:653 + count, algoStatus:'NEW' });
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

  assert.equal(result.ok, true);
  assert.equal(result.execution, 'LIVE_ENTRY_FULLY_PROTECTED');
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
    'POST /fapi/v1/algoOrder',
    'POST /fapi/v1/algoOrder',
    'POST /fapi/v1/algoOrder',
    'POST /fapi/v1/algoOrder'
  ]);
});

test('TP failure leaves protective STOP active and requires manual review without emergency close', async () => {
  let algoPosts = 0;
  let orderPosts = 0;
  const fetchImpl = async (url, options = {}) => {
    const path = pathOf(url);
    const method = options.method || 'GET';
    if (path === '/fapi/v1/time') return ok({ serverTime:1000000 });
    if (path === '/fapi/v1/exchangeInfo') return ok(exchangeInfo());
    if (path === '/fapi/v1/ticker/price') return ok({ symbol:'BTCUSDT', price:'100' });
    if (path === '/fapi/v1/positionSide/dual') return ok({ dualSidePosition:false });
    if (path === '/fapi/v3/positionRisk') return ok([{ symbol:'BTCUSDT', positionAmt:'0', leverage:'10', positionSide:'BOTH' }]);
    if (path === '/fapi/v1/order' && method === 'POST') {
      orderPosts++;
      return ok({ orderId:123, status:'FILLED', executedQty:'0.3' });
    }
    if (path === '/fapi/v1/algoOrder' && method === 'POST') {
      algoPosts++;
      if (algoPosts === 3) return ok({ code:-1, msg:'mock TP2 reject' }, 400);
      return ok({ algoId:500 + algoPosts, algoStatus:'NEW' });
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
  assert.equal(result.stopProtected, true);
  assert.equal(result.tpProtected, false);
  assert.equal(result.execution, 'LIVE_TP_PARTIAL_MANUAL_REVIEW_REQUIRED');
  assert.equal(result.manualReviewRequired, true);
  assert.deepEqual(result.tpAlgoIds, [502]);
  assert.equal(orderPosts, 1);
  assert.ok(result.reasons.includes('TAKE_PROFIT_INSTALL_INCOMPLETE_STOP_REMAINS_ACTIVE'));
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
      return ok({ orderId:999, status:'FILLED', executedQty:'0.3' });
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

// CLAUDE_V112_BINANCE_V3_POSITION_FIX: gerçek Binance v3 davranışı — pozisyonu olmayan sembol için
// /fapi/v3/positionRisk boş dizi döner ve kaldıraç alanı yoktur; kaldıraç /fapi/v1/symbolConfig'ten okunur.
function v3Fetch({ symbolLeverage = 10, ackLeverage = 10, symbolConfigFails = false, openAmt = null, calls }) {
  let levNow = symbolLeverage;
  return async (url, options = {}) => {
    const path = new URL(url).pathname;
    const method = options.method || 'GET';
    calls.push(`${method} ${path}`);
    if (path === '/fapi/v1/time') return ok({ serverTime:1000000 });
    if (path === '/fapi/v1/exchangeInfo') return ok(exchangeInfo());
    if (path === '/fapi/v1/ticker/price') return ok({ symbol:'BTCUSDT', price:'100' });
    if (path === '/fapi/v1/positionSide/dual') return ok({ dualSidePosition:false });
    if (path === '/fapi/v3/positionRisk') return ok(openAmt === null ? [] : [{ symbol:'BTCUSDT', positionSide:'BOTH', positionAmt:String(openAmt), entryPrice:'100', markPrice:'100' }]);
    if (path === '/fapi/v1/symbolConfig') {
      if (symbolConfigFails) return ok({ code:-1000, msg:'unknown' }, 400);
      return ok([{ symbol:'BTCUSDT', marginType:'CROSSED', isAutoAddMargin:false, leverage:levNow, maxNotionalValue:'1000000' }]);
    }
    if (path === '/fapi/v1/leverage' && method === 'POST') { levNow = ackLeverage; return ok({ symbol:'BTCUSDT', leverage:ackLeverage, maxNotionalValue:'1000000' }); }
    if (path === '/fapi/v1/order' && method === 'POST') return ok({ orderId:777, status:'FILLED', executedQty:'0.3' });
    if (path === '/fapi/v1/algoOrder' && method === 'POST') return ok({ algoId:calls.length, algoStatus:'NEW' });
    throw new Error(`unexpected mocked request ${method} ${path}`);
  };
}
async function submitV3(opts) {
  const calls = [];
  const transport = new BinanceLiveTransport({ registry:authorizedRegistry(), fetchImpl:v3Fetch({ ...opts, calls }), clock:() => 1000000 });
  const result = await transport.submit({ grantId:'grant-regression-001', order:order(), credentials:credentials(), livePolicy:{ expectedLeverage:10, maxEntryDeviationPct:0.5 } });
  return { result, calls };
}

test('Binance v3: pozisyonsuz sembolde boş positionRisk girişi engellemez (eski POSITION_RISK_REQUIRED hatası)', async () => {
  const { result, calls } = await submitV3({ symbolLeverage:10 });
  assert.equal(result.execution, 'LIVE_ENTRY_FULLY_PROTECTED', JSON.stringify(result.reasons));
  assert.ok(calls.includes('GET /fapi/v1/symbolConfig'));
  assert.equal(calls.includes('POST /fapi/v1/leverage'), false, 'kaldıraç zaten doğruysa değiştirilmez');
});

test('Binance v3: kaldıraç farklıysa POST /fapi/v1/leverage + symbolConfig ile yeniden doğrulanır', async () => {
  const { result, calls } = await submitV3({ symbolLeverage:5, ackLeverage:10 });
  assert.equal(result.execution, 'LIVE_ENTRY_FULLY_PROTECTED', JSON.stringify(result.reasons));
  assert.equal(result.leverageChanged, true);
  assert.deepEqual(calls.slice(4, 8), ['GET /fapi/v3/positionRisk','GET /fapi/v1/symbolConfig','POST /fapi/v1/leverage','GET /fapi/v1/symbolConfig']);
});

test('Binance v3: kaldıraç değişikliği reddedilirse giriş yok; symbolConfig yoksa onay kaldıraçla doğrulanır', async () => {
  const rejected = await submitV3({ symbolLeverage:5, ackLeverage:8 });
  assert.equal(rejected.result.orderPlaced, false);
  assert.ok(rejected.result.reasons.includes('BINANCE_LEVERAGE_CHANGE_REJECTED'));
  assert.equal(rejected.calls.includes('POST /fapi/v1/order'), false);
  const fallback = await submitV3({ symbolConfigFails:true, ackLeverage:10 });
  assert.equal(fallback.result.execution, 'LIVE_ENTRY_FULLY_PROTECTED', JSON.stringify(fallback.result.reasons));
  assert.equal(fallback.result.leverageChanged, true);
});

test('Binance v3: sembolde açık pozisyon varsa ikinci giriş engellenir', async () => {
  const { result, calls } = await submitV3({ openAmt:0.3 });
  assert.equal(result.orderPlaced, false);
  assert.ok(result.reasons.includes('SYMBOL_POSITION_ALREADY_OPEN'));
  assert.equal(calls.includes('POST /fapi/v1/order'), false);
});


test('R2535 JEV EXIT_NOW closes only the existing LONG quantity with reduce-only MARKET in one-way mode', async () => {
  const calls=[];
  let positionReads=0;
  const fetchImpl=async (url,options={})=>{
    const path=pathOf(url), method=options.method||'GET';
    calls.push({path,method,body:options.body||''});
    if(path==='/fapi/v1/time')return ok({serverTime:1000000});
    if(path==='/fapi/v1/positionSide/dual')return ok({dualSidePosition:false});
    if(path==='/fapi/v3/positionRisk'){
      positionReads++;
      return ok(positionReads===1
        ? [{symbol:'BTCUSDT',positionSide:'BOTH',positionAmt:'0.300',entryPrice:'100',markPrice:'99'}]
        : [{symbol:'BTCUSDT',positionSide:'BOTH',positionAmt:'0',entryPrice:'0',markPrice:'99'}]);
    }
    if(path==='/fapi/v1/exchangeInfo')return ok(exchangeInfo());
    if(path==='/fapi/v1/order'&&method==='POST')return ok({orderId:991,status:'FILLED',executedQty:'0.300'});
    throw new Error(`unexpected mocked request ${method} ${path}`);
  };
  const transport=new BinanceLiveTransport({registry:{consume:()=>({ok:false})},fetchImpl,clock:()=>1000000});
  const out=await transport.reducePositionMarket({
    symbol:'BTCUSDT',side:'LONG',fraction:1,credentials:credentials(),reason:'JEV_EXIT_NOW'
  });
  assert.equal(out.ok,true,JSON.stringify(out));
  assert.equal(out.orderPlaced,true);
  assert.equal(out.execution,'JEV_EXIT_NOW_REDUCE_ONLY_MARKET');
  assert.equal(out.fullyClosed,true);
  assert.equal(out.remainingQty,0);
  const close=calls.find(x=>x.path==='/fapi/v1/order'&&x.method==='POST');
  assert.ok(close);
  assert.match(close.body,/side=SELL/);
  assert.match(close.body,/type=MARKET/);
  assert.match(close.body,/quantity=0.3/);
  assert.match(close.body,/reduceOnly=true/);
  assert.equal(calls.filter(x=>x.path==='/fapi/v1/order'&&x.method==='POST').length,1);
});

test('R2535 position reduction refuses side mismatch without sending a MARKET order', async () => {
  const calls=[];
  const fetchImpl=async (url,options={})=>{
    const path=pathOf(url),method=options.method||'GET';
    calls.push({path,method,body:options.body||''});
    if(path==='/fapi/v1/time')return ok({serverTime:1000000});
    if(path==='/fapi/v1/positionSide/dual')return ok({dualSidePosition:false});
    if(path==='/fapi/v3/positionRisk')return ok([{symbol:'BTCUSDT',positionSide:'BOTH',positionAmt:'-0.300',entryPrice:'100',markPrice:'101'}]);
    throw new Error(`unexpected mocked request ${method} ${path}`);
  };
  const transport=new BinanceLiveTransport({registry:{consume:()=>({ok:false})},fetchImpl,clock:()=>1000000});
  const out=await transport.reducePositionMarket({symbol:'BTCUSDT',side:'LONG',fraction:1,credentials:credentials(),reason:'JEV_EXIT_NOW'});
  assert.equal(out.ok,false);
  assert.equal(out.orderPlaced,false);
  assert.equal(out.reason,'POSITION_NOT_OPEN_OR_SIDE_MISMATCH');
  assert.equal(calls.some(x=>x.path==='/fapi/v1/order'&&x.method==='POST'),false);
});
