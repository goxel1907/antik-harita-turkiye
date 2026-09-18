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
