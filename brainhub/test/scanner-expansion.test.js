'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { tfStats, scoreExpansion, selectCandidates } = require('../scanner');

function k(openTime, closeTime, open, high, low, close, quote=1000, takerBuyQuote=550) {
  return [openTime,String(open),String(high),String(low),String(close),'10',closeTime,String(quote),10,'5',String(takerBuyQuote)];
}

test('scanner short-horizon stats ignore the currently forming candle', () => {
  const now = Date.UTC(2026,8,17,12,0,0);
  const rows = [
    k(now-180000,now-120001,100,101,99.5,100.2,1000,520),
    k(now-120000,now-60001,100.2,101.2,100,100.8,1200,700),
    k(now-60000,now+59999,100.8,150,50,140,999999,990000)
  ];
  const s = tfStats(rows, now);
  assert.equal(s.closed, 2);
  assert.ok(s.mom > 0 && s.mom < 2);
  assert.ok(s.taker < 0.7);
  assert.ok(s.volumeAcceleration > 0);
});

test('directional expansion scores stay separate for LONG and SHORT', () => {
  const up = scoreExpansion({
    a:{mom:1.8,taker:0.64,volumeAcceleration:0.8,rangeExpansion:0.5},
    b:{mom:1.2,taker:0.61,volumeAcceleration:0.5,rangeExpansion:0.4},
    c:{mom:0.7,taker:0.58,volumeAcceleration:0.3,rangeExpansion:0.2},
    oiDeltaPct:0.8,spreadBps:2,fundingPct:0.01
  });
  assert.ok(up.longExpansionScore > up.shortExpansionScore);
  assert.ok(up.movementPotential > 0);
  const down = scoreExpansion({
    a:{mom:-1.8,taker:0.36,volumeAcceleration:0.8,rangeExpansion:0.5},
    b:{mom:-1.2,taker:0.39,volumeAcceleration:0.5,rangeExpansion:0.4},
    c:{mom:-0.7,taker:0.42,volumeAcceleration:0.3,rangeExpansion:0.2},
    oiDeltaPct:-0.8,spreadBps:2,fundingPct:-0.01
  });
  assert.ok(down.shortExpansionScore > down.longExpansionScore);
});

test('wide spread reduces directional expansion instead of becoming a hard direction signal', () => {
  const base = {
    a:{mom:1,taker:0.6,volumeAcceleration:0.4,rangeExpansion:0.2},
    b:{mom:0.7,taker:0.58,volumeAcceleration:0.3,rangeExpansion:0.2},
    c:{mom:0.4,taker:0.56,volumeAcceleration:0.2,rangeExpansion:0.1},
    oiDeltaPct:0.3,fundingPct:0
  };
  const tight=scoreExpansion({...base,spreadBps:2});
  const wide=scoreExpansion({...base,spreadBps:20});
  assert.ok(tight.longExpansionScore > wide.longExpansionScore);
  assert.equal(tight.longExpansionScore > tight.shortExpansionScore,true);
  assert.equal(wide.longExpansionScore > wide.shortExpansionScore,true);
});

test('current 24h movers are not forced into the deep-scan candidate set', () => {
  const universe = Array.from({ length: 180 }, (_, i) => ({
    symbol:`C${String(i+1).padStart(3,'0')}USDT`,
    quoteVolume:180-i,
    priceChangePercent:i === 179 ? 80 : 0.2,
    lastPrice:1,
    range24hPct:i === 179 ? 80 : 12-(i*0.01),
    volumeRank:i+1
  }));
  const out = selectCandidates(universe, {}, 32);
  const symbols = new Set(out.candidates.map(x => x.symbol));
  assert.equal(symbols.has('C180USDT'), false);
});

test('prior TOP3/TOP10 approach continuity keeps an accelerating candidate in deep scan before it reaches the leaders', () => {
  const universe = Array.from({ length: 180 }, (_, i) => ({
    symbol:`C${String(i+1).padStart(3,'0')}USDT`,
    quoteVolume:180-i,
    priceChangePercent:0.1,
    lastPrice:1,
    range24hPct:10-(i*0.01),
    volumeRank:i+1
  }));
  const target = universe[169];
  target.priceChangePercent = 0.8;
  target.range24hPct = 2.1;
  const prev = {
    bySymbol:{
      [target.symbol]:{
        rank:14,
        projectedRank:3,
        rankVelocity:5,
        rankAcceleration:2,
        leaderHunterScore:74,
        leaderState:'TOP3_APPROACH',
        side:'LONG'
      },
      C169USDT:{
        rank:17,
        projectedRank:9,
        rankVelocity:4,
        rankAcceleration:1,
        leaderHunterScore:68,
        leaderState:'TOP10_APPROACH',
        side:'SHORT'
      }
    }
  };
  const out = selectCandidates(universe, prev, 32);
  const symbols = out.candidates.map(x => x.symbol);
  assert.ok(symbols.includes(target.symbol));
  assert.ok(symbols.includes('C169USDT'));
  assert.ok(out.continuity.some(x => x.symbol === target.symbol));
  assert.ok(out.continuity.some(x => x.symbol === 'C169USDT'));
});
