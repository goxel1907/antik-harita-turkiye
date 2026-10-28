'use strict';
// R2544.86 TRADER BEYNİ (kullanıcı 27.10: "erken long için trader gibi düşünen, tüm verileri harmanlamayı bilen, grafikleri tüm zaman
// dilimlerinde ne dediğini anlayan bir robot ... diğer stratejilere de yardımcı"; "ücretsiz şekilde").
// Bir sinyalin "trader ekranı": 5 dk / 15 dk / 1 sa / 4 sa / 1 gün mumlar + kodun hesapladığı yapı özeti (trend, salınımlar, EMA, aralık
// konumu, hacim, taker payı), gün/hafta/ay seviyeleri, BTC, plan (giriş/stop/hedef R). Coin adı ve tarih GİZLİ, fiyatlar giriş = 100
// ölçeğinde: model fiyatı "hatırlayamaz" (sınav dönemi bazı modellerin eğitim verisiyle çakışıyor). Karar: TAKE / SKIP + güven + neden.
// Bu sürümde YALNIZ SINAV: 6 aylık geçmiş sinyaller ücretsiz modele sorulur; giriş kararı vermez.
const TB_VERSION = 'R2544.98-TRADER-BRAIN-PRO';
const ENGINE = require('./engine'); // R2544.88: the same causal chart engine JEV uses (closed candles only)
const TF = { m5:{ ms:300000, n:48, frame:'5m' }, m15:{ ms:900000, n:32, frame:'15m' }, h1:{ ms:3600000, n:36, frame:'1h' }, h4:{ ms:14400000, n:30, frame:'4h' }, d1:{ ms:86400000, n:20, frame:'1d' } };
// candles to fetch per timeframe so the chart engine has >= 52 closed candles (EMA50, swings, FVG history)
const FETCH = { m5:80, m15:80, h1:80, h4:80, d1:80 };
const finite = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const rows = k => (Array.isArray(k) ? k : []).map(r => Array.isArray(r) ? { t:+r[0], o:+r[1], h:+r[2], l:+r[3], c:+r[4], v:+r[5], tb:r.length > 9 ? +r[9] : null } : r).filter(r => Number.isFinite(r.t) && r.c > 0);
const med = a => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
function ema(a, n) { let e = null; const k = 2 / (n + 1); for (const x of a) e = e === null ? x : x * k + e * (1 - k); return e; }
function swings(k, w = 2) {
  const hs = [], ls = [];
  for (let i = w; i < k.length - w; i++) {
    let H = true, L = true; for (let j = i - w; j <= i + w; j++) { if (j === i) continue; if (k[j].h >= k[i].h) H = false; if (k[j].l <= k[i].l) L = false; }
    if (H) hs.push({ i, p:k[i].h }); if (L) ls.push({ i, p:k[i].l });
  }
  return { hs, ls };
}
// a structure summary per timeframe on CLOSED candles only
function structure(k) {
  if (k.length < 12) return null;
  const c = k.map(x => x.c), last = k.at(-1), sw = swings(k), h2 = sw.hs.slice(-2), l2 = sw.ls.slice(-2);
  let trend = 'RANGE';
  if (h2.length === 2 && l2.length === 2) { if (h2[1].p > h2[0].p && l2[1].p > l2[0].p) trend = 'UP'; else if (h2[1].p < h2[0].p && l2[1].p < l2[0].p) trend = 'DOWN'; }
  const e20 = ema(c, 20), e50 = ema(c, Math.min(50, c.length)), w = k.slice(-20), hi = Math.max(...w.map(x => x.h)), lo = Math.min(...w.map(x => x.l));
  const tr = k.slice(-14).map((x, i, a) => i ? Math.max(x.h - x.l, Math.abs(x.h - a[i - 1].c), Math.abs(x.l - a[i - 1].c)) : x.h - x.l), atr = tr.reduce((s, x) => s + x, 0) / tr.length;
  const v3 = k.slice(-3).reduce((s, x) => s + x.v, 0) / 3, vm = med(k.slice(-23, -3).map(x => x.v));
  const tb3 = k.slice(-3).reduce((s, x) => s + (x.tb ?? 0), 0), vv3 = k.slice(-3).reduce((s, x) => s + x.v, 0);
  const lastBreak = (() => { const H = sw.hs.at(-1), L = sw.ls.at(-1); const brokeUp = H && k.slice(H.i + 3).some(x => x.c > H.p), brokeDn = L && k.slice(L.i + 3).some(x => x.c < L.p);
    return brokeUp && !brokeDn ? 'BROKE_SWING_HIGH' : brokeDn && !brokeUp ? 'BROKE_SWING_LOW' : brokeUp && brokeDn ? 'BOTH' : 'NONE'; })();
  return { trend, lastBreak, closeVsEma20:e20 ? +((last.c / e20 - 1) * 100).toFixed(2) : null, ema20VsEma50:e50 ? +((e20 / e50 - 1) * 100).toFixed(2) : null,
    rangePos20:hi > lo ? +((last.c - lo) / (hi - lo)).toFixed(2) : null, change12Pct:k.length > 12 ? +((last.c / k.at(-13).c - 1) * 100).toFixed(2) : null,
    atrPct:+(atr / last.c * 100).toFixed(2), volLast3VsMedian:vm > 0 ? +(v3 / vm).toFixed(2) : null, takerBuyShareLast3:vv3 > 0 && last.tb !== null ? +(tb3 / vv3).toFixed(2) : null,
    lastCandle:{ bodyPct:+((last.c - last.o) / last.o * 100).toFixed(2), upperWickPct:+((last.h - Math.max(last.o, last.c)) / last.o * 100).toFixed(2), lowerWickPct:+((Math.min(last.o, last.c) - last.l) / last.o * 100).toFixed(2) } };
}
// previous day / week / month high-low from daily candles closed before `t`
function htfLevels(d1, t) {
  const day = 86400000, done = d1.filter(x => x.t + day <= t); if (!done.length) return {};
  const pd = done.at(-1), dt = new Date(t), dow = (dt.getUTCDay() + 6) % 7, weekStart = Math.floor(t / day) * day - dow * day;
  const pw = done.filter(x => x.t >= weekStart - 7 * day && x.t < weekStart), ms = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1), pms = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() - 1, 1);
  const pm = done.filter(x => x.t >= pms && x.t < ms), hl = a => a.length ? { high:Math.max(...a.map(x => x.h)), low:Math.min(...a.map(x => x.l)) } : null;
  return { prevDay:{ high:pd.h, low:pd.l }, prevWeek:hl(pw), prevMonth:hl(pm) };
}
// R2544.98: the timeframe each setup is triggered on and the one its idea lives on
const ENTRY_TF = { LONG_EARLY_RETEST:{ trigger:'5m', structure:'15m', context:'1h / 4h / 1d', holdMax:'24h' }, SHORT_TOP_BREAK:{ trigger:'5m', structure:'15m', context:'1h / 4h / 1d', holdMax:'24h' },
  ZIRVE5_FIBO_LONG:{ trigger:'15m', structure:'1h', context:'4h / 1d', holdMax:'24h' }, ZIRVE5_FIBO_SHORT:{ trigger:'15m', structure:'1h', context:'4h / 1d', holdMax:'24h' } };
const SETUP_TEXT = {
  LONG_EARLY_RETEST:'EARLY LONG: a coin climbing the gainer list broke a previous day/week/month high on a 5m candle with >= 3x volume and has just retested that level; stop under the retest, target just under the next higher level (or 3R).',
  SHORT_TOP_BREAK:'TOP SHORT: a coin that was a top-10 gainer made a fresh 24h high, swept liquidity above a swing high and the next 5m candles broke the pre-top structure low; stop above the top.',
  ZIRVE5_FIBO_LONG:'ZIRVE-5 LONG: one of the 5 most volatile coins broke its last confirmed 15m swing high; price came back into the breakout zone and a volume-backed bull candle closed in it.',
  ZIRVE5_FIBO_SHORT:'ZIRVE-5 SHORT: one of the 5 most volatile coins broke its last confirmed 15m swing low; price came back into the breakdown zone and a volume-backed bear candle closed in it.'
};
// R2544.88 GRAFİK OKUMASI (kullanıcı 27.10: "verileri ve oluşan formasyonları price action, fvg, fibo, trend ... grafik okumayı hangi model
// yapacak"): grafiği KOD kesin hesaplar (engine.js, JEV ile aynı; yalnız kapanmış mumlar), model yorumlar. Fiyatlar ekran ölçeğinde (P) ve
// işlemin R'si cinsinden uzaklık (R: + işlem yönünde, - aleyhte).
function chartReading(raw, frame, { t, P = x => x, R = () => null } = {}) {
  try {
    const c = ENGINE.parseKlines(Array.isArray(raw) ? raw : [], t); if (c.length < 52) return null;
    const s = ENGINE.structure(c, frame); if (!s?.available) return null;
    const lvl = p => p === null || p === undefined || finite(p) === null ? null : { price:P(p), R:R(p) }, near = (a, f) => (a || []).map(f).filter(Boolean).sort((x, y) => Math.abs(x.R ?? 99) - Math.abs(y.R ?? 99));
    const sw = s.swingStructure || {}, smc = s.smcContext || {}, fib = smc.fibLevels || {}, dr = smc.dealingRange || {}, rd = s.readout || {};
    const bars = at => finite(at) === null ? null : Math.max(0, Math.round((c.at(-1).closeTime - at) / (c.at(-1).closeTime - c.at(-2).closeTime || 1)));
    return {
      trend:s.trend, swing:{ state:sw.state || null, highs:sw.highSequence || null, lows:sw.lowSequence || null, lastHigh:lvl(sw.lastConfirmedSwingHigh?.price), lastLow:lvl(sw.lastConfirmedSwingLow?.price) },
      events:(s.priceAction?.events || []).slice(-4).map(e => ({ side:e.side, kind:e.kind, scope:e.scope, ...lvl(e.level), barsAgo:bars(e.confirmedAt) })),
      openFvg:near(s.recentFairValueGaps, g => g && !g.filled ? { side:g.side, low:P(g.low), high:P(g.high), R:R((g.low + g.high) / 2), state:g.lifecycle?.state || null, tests:g.lifecycle?.testCount ?? null } : null).slice(0, 3),
      fib:fib.retracement ? { leg:fib.leg || null, priceInLegPct:finite(fib.pricePositionPct), levels:Object.fromEntries(['0.382', '0.5', '0.618', '0.786'].filter(k => finite(fib.retracement[k]) !== null).map(k => [k, lvl(fib.retracement[k])])),
        ext1272:lvl(fib.extension?.['1.272']), ext1618:lvl(fib.extension?.['1.618']) } : null,
      dealingRange:dr.zone ? { zone:dr.zone, positionPct:finite(dr.positionPct), equilibrium:lvl(dr.equilibrium) } : null,
      orderBlocks:near([...(s.orderBlocks?.bullish || []), ...(s.orderBlocks?.bearish || [])], o => o && !o.broken && o.state !== 'MITIGATED' ? { side:o.side, state:o.state, low:P(o.low), high:P(o.high), R:R((o.low + o.high) / 2), breaker:o.breaker === true } : null).filter(o => Math.abs(o.R ?? 99) <= 6).slice(0, 4),
      patterns:(s.patterns || []).slice(0, 5).map(p => ({ type:p.type, side:p.side, status:p.status })),
      liquidity:{ equalHigh:lvl(s.liquidity?.equalHigh?.price ?? s.liquidity?.equalHigh), equalLow:lvl(s.liquidity?.equalLow?.price ?? s.liquidity?.equalLow), lastSweep:s.liquidity?.lastSweep ? { side:s.liquidity.lastSweep.side || null, ...lvl(s.liquidity.lastSweep.level ?? s.liquidity.lastSweep.price) } : null,
        buySide20:lvl(s.buySideLiquidity), sellSide20:lvl(s.sellSideLiquidity) },
      momentum:{ rsi14:finite(s.rsi14), squeeze:rd.squeeze?.state || null, displacement:rd.displacement ? { dir:rd.displacement.dir, barsAgo:rd.displacement.barsAgo, retracePct:rd.displacement.retracePct, inOte:rd.displacement.inOte } : null,
        stretchZone:rd.stretch?.zone || null, chaseRisk:rd.stretch?.chaseRisk || null }
    };
  } catch { return null; }
}
// the screen. k = { m5, m15, h1, h4, d1, btc1h } raw klines CLOSED before t; plan = { side, rule, entry, stop, target }
function entryPacket({ k, plan, t, extra = null }) {
  const L = plan.side === 'LONG', s = 100 / plan.entry, P = x => x === null || x === undefined || !Number.isFinite(x) ? null : +(x * s).toFixed(3);
  const risk = Math.abs(plan.entry - plan.stop), R = p => p === null || p === undefined ? null : +(((L ? p - plan.entry : plan.entry - p) / risk)).toFixed(2);
  const tfs = {};
  for (const [name, cfg] of Object.entries(TF)) {
    const kk = rows(k[name]).filter(x => x.t + cfg.ms <= t); if (kk.length < 12) { tfs[name] = null; continue; }
    const vm = med(kk.slice(-20).map(x => x.v)) || 1;
    tfs[name] = { structure:structure(kk), chartReading:chartReading(k[name], cfg.frame, { t, P, R }), candles:{ fields:'[open,high,low,close,volVsMedian20,takerBuyShare] price scaled: entry = 100', rows:kk.slice(-cfg.n).map(x => [P(x.o), P(x.h), P(x.l), P(x.c), +(x.v / vm).toFixed(2), x.tb !== null && x.v > 0 ? +(x.tb / x.v).toFixed(2) : null]) } };
  }
  const d1 = rows(k.d1), lv = htfLevels(d1, t), h24 = rows(k.h1).filter(x => x.t + 3600000 <= t).slice(-24);
  const level = (name, v) => v ? { name, price:P(v), R:R(v) } : null;
  const levels = [level('prevDayHigh', lv.prevDay?.high), level('prevDayLow', lv.prevDay?.low), level('prevWeekHigh', lv.prevWeek?.high), level('prevWeekLow', lv.prevWeek?.low),
    level('prevMonthHigh', lv.prevMonth?.high), level('prevMonthLow', lv.prevMonth?.low), level('high24h', h24.length ? Math.max(...h24.map(x => x.h)) : null), level('low24h', h24.length ? Math.min(...h24.map(x => x.l)) : null)].filter(Boolean);
  const b = rows(k.btc1h).filter(x => x.t + 3600000 <= t), bs = b.length >= 12 ? structure(b) : null;
  return { contract:TB_VERSION, task:'ENTRY', side:plan.side, setup:SETUP_TEXT[plan.rule] || plan.rule, tradeTimeframe:ENTRY_TF[plan.rule] || null,
    plan:{ entry:100, stop:P(plan.stop), target:P(plan.target), targetR:R(plan.target), stopDistancePct:+(risk / plan.entry * 100).toFixed(2),
      management:'half closed at +2R, the rest moved to break-even; exit after 24 h at the latest' },
    timeframes:tfs, levels, btc:bs ? { trend1h:bs.trend, change12hPct:bs.change12Pct, closeVsEma20Pct:bs.closeVsEma20 } : null, extra,
    baseRate:'Over 6 months most signals of this setup lost; the average result was about 0R per trade. Taking every signal earns nothing.' };
}
// R2544.98 (kullanıcı 28.10: "işlem açılan zaman dilimi çok önemli; insan hissi: pro trader burada ne yapardı"): girişte de işlemin kendi
// zaman dilimi ve profesyonelin düşünme sırası açıkça verilir; yön dayatılmaz.
const ENTRY_SYSTEM = 'You are a senior discretionary crypto-futures trader on a professional desk. A fixed rule has fired a trade setup and the desk must agree whether to TAKE it or SKIP it; your vote counts. ' +
  'You see the same screen a desk trader sees: the plan, five timeframes (5m, 15m, 1h, 4h, 1d) with a structure summary AND a chartReading computed by code from closed candles (market structure BOS/CHoCH, open fair value gaps, Fibonacci of the last leg with OTE, dealing range premium/discount, fresh order blocks, candlestick and geometric patterns, equal highs/lows and liquidity sweeps, squeeze and displacement; every level with its distance in R, + in the trade direction) and the recent candles; trust the chartReading numbers over your own estimate from raw candles, the day/week/month levels around the price (with their distance in R), and BTC. ' +
  'Prices are scaled so that entry = 100; the coin name and the date are hidden on purpose. ' +
  'Think like a professional at the screen, in this order: (1) WHAT TRADE IS THIS: tradeTimeframe says the timeframe the trade is triggered on and the one its idea lives on; an intraday trade is won or lost on those, higher timeframes are context. ' +
  '(2) CONTEXT: read top-down (1d and 4h, then 1h): with or against the larger trend, premium or discount, which big levels and liquidity pools sit between entry and target. ' +
  '(3) TRIGGER: is the trigger fresh and clean (volume, taker flow, a real close beyond the level) or late and extended (chasing a move already far from its base)? ' +
  '(4) ROOM AND RISK: is there room to the target before the first opposite level, is the stop behind real structure or in the noise? (5) BTC and flow right now. ' +
  'Decide whether a disciplined professional TAKES this trade or SKIPS it. Most signals of this setup lose, so the edge is in telling the good ones apart: do not skip by habit, and do not take by habit. ' +
  'Before you answer, ask yourself what would have to happen for this trade to fail and how likely that is on this screen. ' +
  'Answer ONLY with JSON: {"decision":"TAKE|SKIP","confidence":0-100,"pTarget":0-100,"reasonTr":"Türkçe 1-2 cümle: hangi zaman dilimi ne diyor","keyRisk":"Türkçe kısa: en büyük risk"}. pTarget = your probability that price reaches the target before the stop.';
// R2544.87 (kullanıcı 27.10: zaman dilimlerine entegre): kurulda her üyenin bir koltuğu var; aynı ekranı görür ama kendi bölümünden sorumludur
// R2544.93 (TradingAgents fikri: boğa / ayı araştırmacı tartışması; 27.10 sınavda 69/69 GİRME - masada lehte savunan yoktu): koltuk SIRASI
// kurul küçükken hangi koltukların dolduğunu belirler -> 3 üyede de price action + BOĞA + AYI masada olur.
const ENTRY_ROLES = [
  { key:'price action', prefer:['CLAUDE', 'GEMINI', 'GEMMA'], text:'PRICE ACTION READER. You own the chartReading of every timeframe: BOS/CHoCH, open FVGs, Fibonacci/OTE, premium/discount, order blocks, patterns, equal highs/lows and sweeps. Say which of them supports or blocks this trade and where (in R). Judge neutrally.' },
  { key:'boğa', prefer:['DEEPSEEK', 'LLAMA', 'GEMMA', 'NEMOTRON'], text:'BULL ADVOCATE. Build the strongest honest case FOR taking this trade from the evidence on the screen (fresh structure, room to the target, supportive levels, flow). Vote TAKE unless the chart clearly contradicts it; if you vote SKIP, say exactly which evidence forced you.' },
  { key:'ayı', prefer:['GLM', 'NEMOTRON', 'GPTOSS', 'MINIMAX'], text:'BEAR ADVOCATE / RISK OFFICER. Build the strongest honest case AGAINST the trade: stop distance, opposite levels between entry and target, extension, the base rate. Vote SKIP unless the evidence for the trade is clear; if you vote TAKE, say what convinced you.' },
  { key:'1g/4sa', prefer:['GEMINI', 'MINIMAX', 'CLAUDE'], text:'HIGHER-TIMEFRAME ANALYST. You own the 1d and 4h timeframes and the day/week/month levels: the larger trend, where price sits in the larger range, which levels are above and below and how far they are in R. Judge the trade from that context first.' },
  { key:'5dk+akış', prefer:['DEEPSEEK', 'MINIMAX', 'XING'], text:'TRIGGER AND FLOW ANALYST. You own the 5m timeframe: the trigger candle and the last candles, wicks, volume versus median, taker-buy share, and BTC right now.' }];
function parseEntry(text) {
  try { const j = JSON.parse(String(text || '').match(/\{[\s\S]*\}/)?.[0]);
    if (!['TAKE', 'SKIP'].includes(j.decision)) return { ok:false, reason:'TB_DECISION_INVALID' };
    const cl = v => Math.max(0, Math.min(100, finite(v) ?? 50));
    return { ok:true, decision:j.decision, confidence:cl(j.confidence), pTarget:cl(j.pTarget), reasonTr:String(j.reasonTr || '').slice(0, 400), keyRisk:String(j.keyRisk || '').slice(0, 200) };
  } catch { return { ok:false, reason:'TB_JSON_INVALID' }; }
}
const validEntry = text => parseEntry(text).ok;
module.exports = { TB_VERSION, ENTRY_TF, TF, FETCH, chartReading, rows, swings, structure, htfLevels, SETUP_TEXT, entryPacket, ENTRY_SYSTEM, ENTRY_ROLES, parseEntry, validEntry };
