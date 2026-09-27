'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { StreamingMarket } = require('../market');

test('streaming market keeps rolling CVD, partial depth and observed liquidation semantics', () => {
  let now = Date.UTC(2026, 8, 17, 10, 0, 0);
  const stream = new StreamingMarket({ WebSocketImpl:null, now:() => now });
  stream.ensureSymbol('BTCUSDT');
  stream.ingest({ e:'bookTicker', E:now, s:'BTCUSDT', b:'100', B:'5', a:'100.1', A:'3' });
  stream.ingest({ e:'depthUpdate', E:now, s:'BTCUSDT', b:[['100','5'],['99.9','2']], a:[['100.1','2'],['100.2','1']] });
  stream.ingest({ e:'aggTrade', E:now, T:now, s:'BTCUSDT', p:'100', q:'2', m:false });
  stream.ingest({ e:'aggTrade', E:now, T:now, s:'BTCUSDT', p:'100', q:'1', m:true });
  stream.ingest({ e:'forceOrder', E:now, o:{ s:'BTCUSDT', S:'SELL', ap:'99.9', q:'3', z:'3', T:now } });

  const snapshot = stream.snapshot('BTCUSDT', now);
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.cvdQuote120s, 100);
  assert.ok(snapshot.depth20Imbalance > 0);
  assert.ok(snapshot.depthSoftContext);
  assert.ok(snapshot.depthSoftContext.normalizedEntropy >= 0 && snapshot.depthSoftContext.normalizedEntropy <= 1);
  assert.ok(snapshot.depthSoftContext.concentration >= 0 && snapshot.depthSoftContext.concentration <= 1);
  assert.ok(snapshot.depthSoftContext.bidWallShare > snapshot.depthSoftContext.askWallShare);
  assert.ok(snapshot.depthSoftContext.wallPressure > 0);
  assert.ok(snapshot.depthSoftContext.microprice > 100 && snapshot.depthSoftContext.microprice < 100.1);
  assert.ok(Number.isFinite(snapshot.depthSoftContext.micropriceBps));
  assert.equal(snapshot.depthSoftContext.semantics, 'SOFT_MICROSTRUCTURE_CONTEXT_ONLY');
  assert.equal(snapshot.observedLiquidations.count, 1);
  assert.equal(snapshot.observedLiquidations.zones[0].side, 'LONG_LIQUIDATED');
  assert.match(snapshot.observedLiquidations.note, /not a complete liquidation heatmap/);
  assert.match(snapshot.limitations.join(' '), /not true OFI/);

  now += 121000;
  const aged = stream.snapshot('BTCUSDT', now);
  assert.equal(aged.cvdTrades120s, 0);
  assert.equal(aged.available, false);
  assert.equal(aged.depthSoftContext, null);
  stream.shutdown();
});


test('streaming market emits evidence-only order-flow, absorption and liquidation-cascade context', () => {
  let now = Date.UTC(2026, 8, 23, 16, 0, 0);
  const stream = new StreamingMarket({ WebSocketImpl:null, now:() => now });
  stream.ensureSymbol('ETHUSDT');
  const depth = () => ({
    e:'depthUpdate', E:now, s:'ETHUSDT',
    b:[['100','120'],['99.98','20'],['99.96','15']],
    a:[['100.02','12'],['100.04','10'],['100.06','8']]
  });
  stream.ingest({ e:'bookTicker', E:now, s:'ETHUSDT', b:'100', B:'120', a:'100.02', A:'12' });
  stream.ingest(depth());
  for(let i=0;i<6;i++){
    now += 1000;
    stream.ingest({ e:'aggTrade', E:now, T:now, s:'ETHUSDT', p:String(100 - i*0.002), q:'20', m:true });
    stream.ingest(depth());
  }
  for(let i=0;i<3;i++){
    now += 1000;
    stream.ingest({ e:'forceOrder', E:now, o:{ s:'ETHUSDT', S:'SELL', ap:'99.98', q:'150', z:'150', T:now } });
  }
  const snap=stream.snapshot('ETHUSDT',now);
  assert.ok(snap.orderFlow?.windows?.['30s']);
  assert.ok(snap.orderFlow.windows['30s'].sellRatio > 0.6);
  assert.equal(snap.depthDynamics.available,true);
  assert.ok(Array.isArray(snap.depthDynamics.bidWalls));
  assert.equal(snap.depthDynamics.absorption.available,true);
  assert.equal(snap.depthDynamics.absorption.type,'SELL_AGGRESSION_ABSORBED_AT_BID');
  assert.equal(snap.observedLiquidations.cascade.available,true);
  assert.equal(snap.observedLiquidations.cascade.type,'LONG_LIQUIDATION_CASCADE');
  stream.shutdown();
});
